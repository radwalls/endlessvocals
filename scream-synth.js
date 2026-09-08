(function () {
    'use strict';

    const root = document.querySelector('[data-scream-synth]');
    const State = window.ScreamSynthState;
    if (!root || !State) return;

    const DEFAULTS = Object.freeze({
        ranks: ['M'],
        levels: Object.freeze({ L: 0.72, M: 0.74, H: 0.62 }),
        midi: 52,
        vowel: 'Ah',
        grit: 0.38,
        expression: 0.70,
        master: 0.32,
        irregularity: 0.72,
        noise: 0.34,
        tone: 0.56,
        modulation: 0.42,
    });

    const LAYER_OUTPUT_GAINS = Object.freeze({ L: 0.8, M: 0.72, H: 2.2 });

    function finite(value, fallback) {
        return Number.isFinite(Number(value)) ? Number(value) : fallback;
    }

    function normalizedInput(input) {
        return State.clamp(finite(input.value, 0) / 100, 0, 1);
    }

    function makeRegisterSymbol(ranks, extraClass) {
        const active = new Set(State.normalizeRanks(ranks));
        const symbol = document.createElement('span');
        symbol.className = `ss-register-symbol${extraClass ? ` ${extraClass}` : ''}`;
        symbol.setAttribute('aria-hidden', 'true');
        ['H', 'M', 'L'].forEach((rank) => {
            const dot = document.createElement('span');
            dot.className = `ss-register-dot${active.has(rank) ? ' is-on' : ''}`;
            dot.dataset.rank = rank;
            symbol.appendChild(dot);
        });
        return symbol;
    }

    class ScreamAudioEngine {
        constructor(onContextState) {
            this.context = null;
            this.onContextState = onContextState;
            this.initialized = false;
            this.playing = false;
            this.contextCreateCount = 0;
            this.sourceStartCount = 0;
            this.sources = [];
            this.rankGains = {};
            this.levelGains = {};
            this.layerTargetGains = { L: 0, M: 0, H: 0 };
            this.settings = {
                ranks: new Set(DEFAULTS.ranks),
                levels: { ...DEFAULTS.levels },
                midi: DEFAULTS.midi,
                vowel: DEFAULTS.vowel,
                grit: DEFAULTS.grit,
                expression: DEFAULTS.expression,
                master: DEFAULTS.master,
                irregularity: DEFAULTS.irregularity,
                noise: DEFAULTS.noise,
                tone: DEFAULTS.tone,
                modulation: DEFAULTS.modulation,
            };
        }

        async enable() {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                throw new Error('This browser does not support the Web Audio API.');
            }

            if (!this.context || this.context.state === 'closed') {
                this.teardownGraph();
                try {
                    this.context = new AudioContextClass({ latencyHint: 'interactive' });
                } catch (error) {
                    this.context = new AudioContextClass();
                }
                this.contextCreateCount += 1;
                const currentContext = this.context;
                currentContext.addEventListener('statechange', () => {
                    if (typeof this.onContextState === 'function') {
                        this.onContextState(currentContext.state);
                    }
                });
            }

            if (!this.initialized) {
                try {
                    this.buildGraph();
                } catch (error) {
                    this.teardownGraph();
                    throw new Error(`Scream Synth could not initialize: ${error && error.message ? error.message : 'unknown audio error'}`);
                }
            }

            if (this.context.state !== 'running') {
                await this.context.resume();
            }

            if (this.context.state !== 'running') {
                throw new Error(`Audio could not start (state: ${this.context.state}). Tap Enable Audio again.`);
            }

            if (typeof this.onContextState === 'function') {
                this.onContextState(this.context.state);
            }
            return this.context.state;
        }

        teardownGraph() {
            this.playing = false;
            this.sources.forEach((source) => {
                try { source.stop(); } catch (error) { /* Source may not have started. */ }
                try { source.disconnect(); } catch (error) { /* Source may already be disconnected. */ }
            });
            this.sources.length = 0;
            [this.mixBus, this.mixCompensation, this.expressionGain, this.playGate, this.masterGain, this.peakControl, this.safetyShaper, this.analyser].forEach((node) => {
                if (!node) return;
                try { node.disconnect(); } catch (error) { /* Partial graphs may already be disconnected. */ }
            });
            this.rankGains = {};
            this.levelGains = {};
            this.mixBus = null;
            this.mixCompensation = null;
            this.expressionGain = null;
            this.playGate = null;
            this.masterGain = null;
            this.peakControl = null;
            this.safetyShaper = null;
            this.analyser = null;
            this.initialized = false;
        }

        buildGraph() {
            if (!this.context || this.initialized) return;
            const audio = this.context;

            this.mixBus = audio.createGain();
            this.mixCompensation = audio.createGain();
            this.expressionGain = audio.createGain();
            this.playGate = audio.createGain();
            this.masterGain = audio.createGain();
            this.peakControl = audio.createDynamicsCompressor();
            this.safetyShaper = audio.createWaveShaper();
            this.analyser = audio.createAnalyser();

            this.mixBus.connect(this.mixCompensation);
            this.mixCompensation.connect(this.expressionGain);
            this.expressionGain.connect(this.playGate);
            this.playGate.connect(this.masterGain);
            this.masterGain.connect(this.peakControl);
            this.peakControl.connect(this.safetyShaper);
            this.safetyShaper.connect(this.analyser);
            this.analyser.connect(audio.destination);

            this.mixBus.gain.value = 1;
            this.playGate.gain.value = 0;
            this.peakControl.threshold.value = -14;
            this.peakControl.knee.value = 8;
            this.peakControl.ratio.value = 10;
            this.peakControl.attack.value = 0.003;
            this.peakControl.release.value = 0.11;
            this.safetyShaper.curve = this.makeSafetyCurve();
            this.safetyShaper.oversample = '4x';
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.72;
            this.analyser.minDecibels = -90;
            this.analyser.maxDecibels = -10;

            this.buildSighLayer();
            this.buildVoiceLayer();
            this.buildFryLayer();
            this.initialized = true;
            this.applyAll(true);
        }

        addSource(source) {
            source.start();
            this.sources.push(source);
            this.sourceStartCount += 1;
            return source;
        }

        createPanner(amount) {
            if (typeof this.context.createStereoPanner !== 'function') return null;
            const panner = this.context.createStereoPanner();
            panner.pan.value = amount;
            return panner;
        }

        connectLayer(rank, input, panAmount) {
            const level = this.context.createGain();
            const register = this.context.createGain();
            const panner = this.createPanner(panAmount);
            input.connect(level);
            level.connect(register);
            if (panner) {
                register.connect(panner);
                panner.connect(this.mixBus);
            } else {
                register.connect(this.mixBus);
            }
            this.levelGains[rank] = level;
            this.rankGains[rank] = register;
        }

        buildSighLayer() {
            const audio = this.context;
            this.sighSourceBus = audio.createGain();
            this.sighMovement = audio.createGain();
            this.sighDirectFilter = audio.createBiquadFilter();
            this.sighDirectGain = audio.createGain();
            this.sighFormantOne = audio.createBiquadFilter();
            this.sighFormantTwo = audio.createBiquadFilter();
            this.sighFormantOneGain = audio.createGain();
            this.sighFormantTwoGain = audio.createGain();
            this.sighLayerBus = audio.createGain();

            this.sighOscillatorOne = audio.createOscillator();
            this.sighOscillatorTwo = audio.createOscillator();
            const sighOscillatorOneGain = audio.createGain();
            const sighOscillatorTwoGain = audio.createGain();
            this.sighOscillatorOne.type = 'sawtooth';
            this.sighOscillatorTwo.type = 'triangle';
            this.sighOscillatorTwo.detune.value = -9;
            sighOscillatorOneGain.gain.value = 0.32;
            sighOscillatorTwoGain.gain.value = 0.38;
            this.sighOscillatorOne.connect(sighOscillatorOneGain).connect(this.sighSourceBus);
            this.sighOscillatorTwo.connect(sighOscillatorTwoGain).connect(this.sighSourceBus);
            this.addSource(this.sighOscillatorOne);
            this.addSource(this.sighOscillatorTwo);

            this.sighLfo = audio.createOscillator();
            this.sighLfoDepth = audio.createGain();
            this.sighLfo.type = 'sine';
            this.sighLfo.frequency.value = 2.15;
            this.sighLfo.connect(this.sighLfoDepth).connect(this.sighMovement.gain);
            this.addSource(this.sighLfo);

            this.sighSourceBus.connect(this.sighMovement);
            this.sighMovement.gain.value = 0.72;
            this.sighMovement.connect(this.sighDirectFilter).connect(this.sighDirectGain).connect(this.sighLayerBus);
            this.sighMovement.connect(this.sighFormantOne).connect(this.sighFormantOneGain).connect(this.sighLayerBus);
            this.sighMovement.connect(this.sighFormantTwo).connect(this.sighFormantTwoGain).connect(this.sighLayerBus);
            this.sighDirectFilter.type = 'lowpass';
            this.sighDirectFilter.Q.value = 0.65;
            this.sighDirectGain.gain.value = 0.58;
            this.sighFormantOne.type = 'bandpass';
            this.sighFormantOne.frequency.value = 430;
            this.sighFormantOne.Q.value = 1.1;
            this.sighFormantOneGain.gain.value = 0.44;
            this.sighFormantTwo.type = 'bandpass';
            this.sighFormantTwo.frequency.value = 880;
            this.sighFormantTwo.Q.value = 1.5;
            this.sighFormantTwoGain.gain.value = 0.22;

            this.sighNoiseSource = audio.createBufferSource();
            this.sighNoiseSource.buffer = this.makeNoiseBuffer(2.2);
            this.sighNoiseSource.loop = true;
            this.sighNoiseFilter = audio.createBiquadFilter();
            this.sighNoiseGain = audio.createGain();
            this.sighNoiseFilter.type = 'bandpass';
            this.sighNoiseFilter.frequency.value = 520;
            this.sighNoiseFilter.Q.value = 0.72;
            this.sighNoiseSource.connect(this.sighNoiseFilter).connect(this.sighNoiseGain).connect(this.sighLayerBus);
            this.addSource(this.sighNoiseSource);

            this.connectLayer('L', this.sighLayerBus, -0.12);
        }

        buildVoiceLayer() {
            const audio = this.context;
            this.voiceSourceBus = audio.createGain();
            this.voiceDryGain = audio.createGain();
            this.voicePreDrive = audio.createGain();
            this.voiceWetGain = audio.createGain();
            this.voiceShaper = audio.createWaveShaper();
            this.voiceBlend = audio.createGain();
            this.voiceFormantOne = audio.createBiquadFilter();
            this.voiceFormantTwo = audio.createBiquadFilter();
            this.voiceFormantOneGain = audio.createGain();
            this.voiceFormantTwoGain = audio.createGain();
            this.voiceBodyFilter = audio.createBiquadFilter();
            this.voiceBodyGain = audio.createGain();
            this.voiceLayerBus = audio.createGain();

            this.voiceOscillators = [
                { ratio: 1, type: 'sawtooth', gain: 0.36, detune: 0 },
                { ratio: 1, type: 'triangle', gain: 0.44, detune: 5 },
                { ratio: 2, type: 'sine', gain: 0.18, detune: -4 },
            ].map((definition) => {
                const oscillator = audio.createOscillator();
                const gain = audio.createGain();
                oscillator.type = definition.type;
                oscillator.detune.value = definition.detune;
                gain.gain.value = definition.gain;
                oscillator.connect(gain).connect(this.voiceSourceBus);
                this.addSource(oscillator);
                return { node: oscillator, ratio: definition.ratio };
            });

            this.voiceSourceBus.gain.value = 0.68;
            this.voiceSourceBus.connect(this.voiceDryGain).connect(this.voiceBlend);
            this.voiceSourceBus.connect(this.voicePreDrive).connect(this.voiceShaper).connect(this.voiceWetGain).connect(this.voiceBlend);
            this.voiceShaper.curve = this.makeDistortionCurve(0.06);
            this.voiceShaper.oversample = '4x';

            this.voiceBlend.connect(this.voiceFormantOne).connect(this.voiceFormantOneGain).connect(this.voiceLayerBus);
            this.voiceBlend.connect(this.voiceFormantTwo).connect(this.voiceFormantTwoGain).connect(this.voiceLayerBus);
            this.voiceBlend.connect(this.voiceBodyFilter).connect(this.voiceBodyGain).connect(this.voiceLayerBus);
            this.voiceFormantOne.type = 'bandpass';
            this.voiceFormantOne.Q.value = 4.1;
            this.voiceFormantOneGain.gain.value = 0.92;
            this.voiceFormantTwo.type = 'bandpass';
            this.voiceFormantTwo.Q.value = 4.8;
            this.voiceFormantTwoGain.gain.value = 0.64;
            this.voiceBodyFilter.type = 'lowpass';
            this.voiceBodyFilter.Q.value = 0.5;
            this.voiceBodyGain.gain.value = 0.3;

            this.connectLayer('M', this.voiceLayerBus, 0);
        }

        buildFryLayer() {
            const audio = this.context;
            this.fryRegularSource = audio.createBufferSource();
            this.fryIrregularSource = audio.createBufferSource();
            this.fryRegularSource.buffer = this.makePulseBuffer(false);
            this.fryIrregularSource.buffer = this.makePulseBuffer(true);
            this.fryRegularSource.loop = true;
            this.fryIrregularSource.loop = true;
            this.fryRegularGain = audio.createGain();
            this.fryIrregularGain = audio.createGain();
            this.frySourceBus = audio.createGain();
            this.fryHighpass = audio.createBiquadFilter();
            this.fryFocus = audio.createBiquadFilter();
            this.fryLowpass = audio.createBiquadFilter();
            this.fryLayerBus = audio.createGain();

            this.fryRegularSource.connect(this.fryRegularGain).connect(this.frySourceBus);
            this.fryIrregularSource.connect(this.fryIrregularGain).connect(this.frySourceBus);
            this.frySourceBus.connect(this.fryHighpass).connect(this.fryFocus).connect(this.fryLowpass).connect(this.fryLayerBus);
            this.fryHighpass.type = 'highpass';
            this.fryHighpass.frequency.value = 145;
            this.fryHighpass.Q.value = 0.55;
            this.fryFocus.type = 'bandpass';
            this.fryFocus.frequency.value = 1700;
            this.fryFocus.Q.value = 0.9;
            this.fryLowpass.type = 'lowpass';
            this.fryLowpass.frequency.value = 3900;
            this.fryLowpass.Q.value = 0.7;
            this.addSource(this.fryRegularSource);
            this.addSource(this.fryIrregularSource);

            this.connectLayer('H', this.fryLayerBus, 0.12);
        }

        makeNoiseBuffer(seconds) {
            const sampleRate = this.context.sampleRate;
            const length = Math.max(1, Math.floor(sampleRate * seconds));
            const buffer = this.context.createBuffer(1, length, sampleRate);
            const data = buffer.getChannelData(0);
            let previous = 0;
            for (let index = 0; index < length; index += 1) {
                const white = Math.random() * 2 - 1;
                previous = previous * 0.985 + white * 0.015;
                data[index] = State.clamp((white * 0.34) + (previous * 2.3), -1, 1);
            }
            this.fadeBufferEdges(data, 640);
            return buffer;
        }

        fadeBufferEdges(data, requestedSamples) {
            const fadeSamples = Math.min(requestedSamples, Math.floor(data.length / 4));
            for (let index = 0; index < fadeSamples; index += 1) {
                const fade = Math.sin((index / Math.max(1, fadeSamples - 1)) * Math.PI * 0.5);
                data[index] *= fade;
                data[data.length - 1 - index] *= fade;
            }
        }

        makePulseBuffer(irregular) {
            const sampleRate = this.context.sampleRate;
            const length = Math.floor(sampleRate * 2.4);
            const buffer = this.context.createBuffer(1, length, sampleRate);
            const data = buffer.getChannelData(0);
            let position = 0;

            while (position < length - 640) {
                const seconds = irregular
                    ? 0.022 + (Math.random() * Math.random() * 0.105)
                    : 0.047 + ((Math.random() - 0.5) * 0.006);
                position += Math.max(24, Math.floor(seconds * sampleRate));
                const amplitude = irregular ? 0.42 + Math.random() * 0.52 : 0.62 + Math.random() * 0.12;
                const pulseLength = irregular ? 100 + Math.floor(Math.random() * 260) : 190;
                const ringFrequency = irregular ? 520 + Math.random() * 1500 : 820;
                for (let offset = 0; offset < pulseLength && position + offset < length; offset += 1) {
                    const envelope = Math.exp(-offset / (irregular ? 58 : 74));
                    const ring = Math.sin((Math.PI * 2 * ringFrequency * offset) / sampleRate);
                    const crackle = (Math.random() * 2 - 1) * (irregular ? 0.65 : 0.34);
                    data[position + offset] += State.clamp((ring * 0.72 + crackle) * envelope * amplitude, -1, 1);
                }
                if (irregular && Math.random() > 0.68) {
                    position += Math.floor(sampleRate * (0.004 + Math.random() * 0.012));
                }
            }

            this.fadeBufferEdges(data, 640);
            return buffer;
        }

        makeDistortionCurve(amount) {
            const samples = 4096;
            const curve = new Float32Array(samples);
            const drive = 1.2 + (State.clamp(amount, 0, 1) * 26);
            const normalizer = Math.tanh(drive) || 1;
            for (let index = 0; index < samples; index += 1) {
                const x = (index * 2) / (samples - 1) - 1;
                curve[index] = Math.tanh(x * drive) / normalizer;
            }
            return curve;
        }

        makeSafetyCurve() {
            const samples = 4096;
            const curve = new Float32Array(samples);
            const knee = 0.82;
            const ceiling = 0.96;
            for (let index = 0; index < samples; index += 1) {
                const x = (index * 2) / (samples - 1) - 1;
                const sign = x < 0 ? -1 : 1;
                const magnitude = Math.abs(x);
                if (magnitude <= knee) {
                    curve[index] = x;
                } else {
                    const progress = (magnitude - knee) / (1 - knee);
                    const softened = knee + (ceiling - knee) * (1 - Math.pow(1 - progress, 3));
                    curve[index] = sign * softened;
                }
            }
            return curve;
        }

        setParam(param, value, rampSeconds, immediate) {
            if (!param || !this.context) return;
            const safeValue = Number.isFinite(value) ? value : 0;
            const now = this.context.currentTime;
            if (immediate) {
                param.cancelScheduledValues(now);
                param.setValueAtTime(safeValue, now);
                return;
            }
            if (typeof param.cancelAndHoldAtTime === 'function') {
                param.cancelAndHoldAtTime(now);
            } else {
                param.cancelScheduledValues(now);
                param.setValueAtTime(finite(param.value, 0), now);
            }
            param.linearRampToValueAtTime(safeValue, now + (rampSeconds || 0.025));
        }

        applyAll(immediate) {
            this.applyPitch(immediate);
            this.applyVowel(immediate);
            this.applyGrit(immediate);
            this.applyIrregularity(immediate);
            this.applyNoise(immediate);
            this.applyTone(immediate);
            this.applyModulation(immediate);
            this.applyExpression(immediate);
            this.applyMaster(immediate);
            State.RANKS.forEach((rank) => this.applyLayerLevel(rank, immediate));
            this.applyRegisters(immediate);
        }

        setRegisters(ranks) {
            this.settings.ranks = new Set(State.normalizeRanks(ranks));
            if (this.initialized) this.applyRegisters(false);
        }

        applyRegisters(immediate) {
            const activeRanks = State.normalizeRanks(this.settings.ranks);
            State.RANKS.forEach((rank) => {
                const target = activeRanks.includes(rank) ? 1 : 0;
                this.layerTargetGains[rank] = target * this.settings.levels[rank];
                this.setParam(this.rankGains[rank].gain, target, 0.028, immediate);
            });
            this.applyMixCompensation(immediate);
        }

        applyMixCompensation(immediate) {
            const activeRanks = State.normalizeRanks(this.settings.ranks);
            const strongestBase = Math.max(...Object.values(LAYER_OUTPUT_GAINS));
            const effectiveLevels = Object.fromEntries(State.RANKS.map((rank) => [
                rank,
                this.settings.levels[rank] * (LAYER_OUTPUT_GAINS[rank] / strongestBase),
            ]));
            this.setParam(
                this.mixCompensation.gain,
                State.activeLayerCompensation(activeRanks, effectiveLevels),
                0.04,
                immediate,
            );
        }

        setLayerLevel(rank, level) {
            if (!State.RANKS.includes(rank)) return;
            this.settings.levels[rank] = State.clamp(level, 0, 1);
            this.layerTargetGains[rank] = this.settings.ranks.has(rank) ? this.settings.levels[rank] : 0;
            if (this.initialized) {
                this.applyLayerLevel(rank, false);
                this.applyMixCompensation(false);
            }
        }

        applyLayerLevel(rank, immediate) {
            const base = LAYER_OUTPUT_GAINS[rank];
            this.setParam(this.levelGains[rank].gain, base * this.settings.levels[rank], 0.025, immediate);
        }

        setPitch(midi) {
            this.settings.midi = Math.round(State.clamp(midi, 36, 83));
            if (this.initialized) this.applyPitch(false);
        }

        applyPitch(immediate) {
            const frequency = State.midiToFrequency(this.settings.midi);
            this.setParam(this.sighOscillatorOne.frequency, frequency * 0.31, 0.032, immediate);
            this.setParam(this.sighOscillatorTwo.frequency, frequency * 0.52, 0.032, immediate);
            if (this.voiceOscillators) {
                this.voiceOscillators.forEach((oscillator) => {
                    this.setParam(oscillator.node.frequency, frequency * oscillator.ratio, 0.032, immediate);
                });
            }
            const fryRate = State.clamp(Math.sqrt(frequency / 164.81), 0.62, 1.58);
            this.setParam(this.fryRegularSource && this.fryRegularSource.playbackRate, fryRate, 0.04, immediate);
            this.setParam(this.fryIrregularSource && this.fryIrregularSource.playbackRate, fryRate, 0.04, immediate);
            this.applyVowel(immediate);
        }

        setVowel(vowel) {
            this.settings.vowel = State.VOWELS[vowel] ? vowel : 'Ah';
            if (this.initialized) this.applyVowel(false);
        }

        applyVowel(immediate) {
            const formants = State.VOWELS[this.settings.vowel] || State.VOWELS.Ah;
            const fundamental = State.midiToFrequency(this.settings.midi);
            const keepAboveFundamental = (formant, ceiling) => {
                let adjusted = formant;
                while (adjusted < fundamental * 1.12 && adjusted * 2 <= ceiling) adjusted *= 2;
                return adjusted;
            };
            this.setParam(this.voiceFormantOne && this.voiceFormantOne.frequency, keepAboveFundamental(formants[0], 3600), 0.045, immediate);
            this.setParam(this.voiceFormantTwo && this.voiceFormantTwo.frequency, keepAboveFundamental(formants[1], 6800), 0.045, immediate);
        }

        setGrit(amount) {
            this.settings.grit = State.clamp(amount, 0, 1);
            if (this.initialized) this.applyGrit(false);
        }

        applyGrit(immediate) {
            const grit = this.settings.grit;
            const dry = Math.cos(grit * Math.PI * 0.5);
            const wet = Math.sin(grit * Math.PI * 0.5) * (0.62 + grit * 0.25);
            this.setParam(this.voicePreDrive && this.voicePreDrive.gain, 1 + grit * 7, 0.03, immediate);
            this.setParam(this.voiceDryGain && this.voiceDryGain.gain, dry, 0.03, immediate);
            this.setParam(this.voiceWetGain && this.voiceWetGain.gain, wet, 0.03, immediate);
        }

        setExpression(amount) {
            this.settings.expression = State.clamp(amount, 0, 1);
            if (this.initialized) this.applyExpression(false);
        }

        applyExpression(immediate) {
            this.setParam(this.expressionGain && this.expressionGain.gain, this.settings.expression, 0.035, immediate);
        }

        setMaster(amount) {
            this.settings.master = State.clamp(amount, 0, 1);
            if (this.initialized) this.applyMaster(false);
        }

        applyMaster(immediate) {
            this.setParam(this.masterGain && this.masterGain.gain, this.settings.master * 1.25, 0.035, immediate);
        }

        setIrregularity(amount) {
            this.settings.irregularity = State.clamp(amount, 0, 1);
            if (this.initialized) this.applyIrregularity(false);
        }

        applyIrregularity(immediate) {
            const amount = this.settings.irregularity;
            this.setParam(this.fryRegularGain && this.fryRegularGain.gain, Math.cos(amount * Math.PI * 0.5) * 0.76, 0.035, immediate);
            this.setParam(this.fryIrregularGain && this.fryIrregularGain.gain, Math.sin(amount * Math.PI * 0.5) * 0.88, 0.035, immediate);
        }

        setNoise(amount) {
            this.settings.noise = State.clamp(amount, 0, 1);
            if (this.initialized) this.applyNoise(false);
        }

        applyNoise(immediate) {
            this.setParam(this.sighNoiseGain && this.sighNoiseGain.gain, this.settings.noise * 0.34, 0.035, immediate);
        }

        setTone(amount) {
            this.settings.tone = State.clamp(amount, 0, 1);
            if (this.initialized) this.applyTone(false);
        }

        applyTone(immediate) {
            const amount = this.settings.tone;
            this.setParam(this.sighDirectFilter && this.sighDirectFilter.frequency, 650 + amount * 1900, 0.045, immediate);
            this.setParam(this.voiceBodyFilter && this.voiceBodyFilter.frequency, 1250 + amount * 4700, 0.045, immediate);
            this.setParam(this.fryFocus && this.fryFocus.frequency, 850 + amount * 2250, 0.045, immediate);
            this.setParam(this.fryLowpass && this.fryLowpass.frequency, 2200 + amount * 3400, 0.045, immediate);
        }

        setModulation(amount) {
            this.settings.modulation = State.clamp(amount, 0, 1);
            if (this.initialized) this.applyModulation(false);
        }

        applyModulation(immediate) {
            this.setParam(this.sighLfoDepth && this.sighLfoDepth.gain, 0.025 + this.settings.modulation * 0.17, 0.035, immediate);
            this.setParam(this.sighLfo && this.sighLfo.frequency, 1.35 + this.settings.modulation * 3.1, 0.035, immediate);
        }

        startSound() {
            if (!this.initialized || !this.context || this.context.state !== 'running') return false;
            this.playing = true;
            this.setParam(this.playGate.gain, 1, 0.04, false);
            return true;
        }

        stopSound(immediate) {
            this.playing = false;
            if (!this.initialized || !this.playGate) return;
            this.setParam(this.playGate.gain, 0, immediate ? 0.008 : 0.035, false);
        }

        forceSilence() {
            this.playing = false;
            if (!this.context || !this.playGate) return;
            const now = this.context.currentTime;
            this.playGate.gain.cancelScheduledValues(now);
            this.playGate.gain.setValueAtTime(0, now);
        }

        getAnalyser() {
            return this.analyser || null;
        }

        dispose() {
            this.forceSilence();
            this.teardownGraph();
            const context = this.context;
            this.context = null;
            if (context && context.state !== 'closed') {
                context.close().catch(() => {});
            }
        }
    }

    class ScreamSynthInterface {
        constructor(element) {
            this.root = element;
            this.activeRanks = new Set(DEFAULTS.ranks);
            this.playing = false;
            this.latched = false;
            this.holdActive = false;
            this.activeNotePointers = new Set();
            this.activeKeyboardKeys = new Set();
            this.pendingActions = 0;
            this.playRequest = 0;
            this.midi = DEFAULTS.midi;
            this.keyboardOctave = 3;
            this.vowel = DEFAULTS.vowel;
            this.grit = DEFAULTS.grit;
            this.expression = DEFAULTS.expression;
            this.audioError = '';
            this.scopeAnimation = 0;
            this.scopeData = null;
            this.frequencyData = null;
            this.lastDrawTimestamp = 0;
            this.outputPeak = 0;
            this.maxObservedPeak = 0;
            this.outputRms = 0;
            this.outputCentroidHz = 0;
            this.nonFiniteSampleCount = 0;
            this.audioFaulted = false;
            this.destroyed = false;
            this.engine = new ScreamAudioEngine((state) => this.handleContextState(state));
            this.collectElements();
            this.renderPresetButtons();
            this.renderKeyboard();
            this.bindEvents();
            this.syncControlsToEngine();
            this.renderAll();
            this.drawOutput();
        }

        collectElements() {
            this.elements = {
                status: this.root.querySelector('[data-audio-status]'),
                error: this.root.querySelector('[data-audio-error]'),
                meterWrap: this.root.querySelector('[data-output-meter-wrap]'),
                meter: this.root.querySelector('[data-output-meter]'),
                meterReadout: this.root.querySelector('[data-meter-readout]'),
                scope: this.root.querySelector('[data-output-scope]'),
                presetGrid: this.root.querySelector('[data-register-presets]'),
                mainSymbol: this.root.querySelector('[data-main-register-symbol]'),
                activeRegister: this.root.querySelector('[data-active-register]'),
                bellows: this.root.querySelector('[data-bellows]'),
                enable: this.root.querySelector('[data-enable-audio]'),
                hold: this.root.querySelector('[data-hold-play]'),
                stop: this.root.querySelector('[data-stop-all]'),
                latch: this.root.querySelector('[data-latch]'),
                pitch: this.root.querySelector('[data-pitch]'),
                pitchReadout: this.root.querySelector('[data-pitch-readout]'),
                vowel: this.root.querySelector('[data-vowel]'),
                vowelReadout: this.root.querySelector('[data-vowel-readout]'),
                grit: this.root.querySelector('[data-grit]'),
                expression: this.root.querySelector('[data-expression]'),
                master: this.root.querySelector('[data-master]'),
                irregularity: this.root.querySelector('[data-irregularity]'),
                noise: this.root.querySelector('[data-noise]'),
                tone: this.root.querySelector('[data-tone]'),
                modulation: this.root.querySelector('[data-modulation]'),
                keyboard: this.root.querySelector('[data-keyboard]'),
                octaveReadout: this.root.querySelector('[data-octave-readout]'),
            };
        }

        renderPresetButtons() {
            this.elements.presetGrid.textContent = '';
            State.PRESETS.forEach((preset) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ss-register-switch';
                button.dataset.screamPreset = preset.id;
                button.setAttribute('aria-pressed', 'false');
                button.setAttribute('aria-label', `${preset.label}: ${preset.ranks.join(' plus ')}`);
                button.appendChild(makeRegisterSymbol(preset.ranks));
                const label = document.createElement('span');
                label.textContent = preset.label;
                button.appendChild(label);
                button.addEventListener('click', () => this.selectPreset(preset));
                this.elements.presetGrid.appendChild(button);
            });
        }

        renderKeyboard() {
            this.elements.keyboard.textContent = '';
            const blackKeys = new Set([1, 3, 6, 8, 10]);
            State.NOTE_NAMES.forEach((name, semitone) => {
                const key = document.createElement('button');
                key.type = 'button';
                key.className = `ss-key${blackKeys.has(semitone) ? ' is-black' : ''}`;
                key.dataset.semitone = String(semitone);
                key.setAttribute('aria-pressed', 'false');
                key.textContent = name;
                this.bindNoteKey(key, semitone);
                this.elements.keyboard.appendChild(key);
            });
            this.updateKeyboardLabels();
        }

        bindEvents() {
            this.root.querySelectorAll('[data-rank-toggle]').forEach((button) => {
                button.addEventListener('click', () => {
                    const rank = button.dataset.rank;
                    if (this.activeRanks.has(rank)) this.activeRanks.delete(rank);
                    else this.activeRanks.add(rank);
                    this.applyRegisters();
                });
            });

            this.root.querySelectorAll('[data-layer-level]').forEach((input) => {
                input.addEventListener('input', () => {
                    this.updatePercentOutput(input);
                    this.engine.setLayerLevel(input.dataset.layerLevel, normalizedInput(input));
                });
            });

            this.elements.pitch.addEventListener('input', () => {
                this.setPitch(Number(this.elements.pitch.value), true);
            });

            this.elements.vowel.addEventListener('change', () => {
                this.vowel = this.elements.vowel.value;
                this.engine.setVowel(this.vowel);
                this.renderSoundReadouts();
            });

            this.bindNormalizedRange(this.elements.grit, (amount) => {
                this.grit = amount;
                this.engine.setGrit(amount);
            });
            this.bindNormalizedRange(this.elements.expression, (amount) => {
                this.expression = amount;
                this.engine.setExpression(amount);
                this.renderPlaybackState();
            });
            this.bindNormalizedRange(this.elements.master, (amount) => this.engine.setMaster(amount));
            this.bindNormalizedRange(this.elements.irregularity, (amount) => this.engine.setIrregularity(amount));
            this.bindNormalizedRange(this.elements.noise, (amount) => this.engine.setNoise(amount));
            this.bindNormalizedRange(this.elements.tone, (amount) => this.engine.setTone(amount));
            this.bindNormalizedRange(this.elements.modulation, (amount) => this.engine.setModulation(amount));

            this.elements.enable.addEventListener('click', () => this.enableAudio());
            this.bindHoldButton();
            this.elements.stop.addEventListener('click', () => this.stopAll(true, false));
            this.elements.latch.addEventListener('change', () => {
                this.latched = this.elements.latch.checked;
                if (!this.latched && !this.holdActive && this.activeNotePointers.size === 0 && this.activeKeyboardKeys.size === 0) {
                    this.stopPlayback(false);
                }
                this.renderPlaybackState();
            });

            this.root.querySelector('[data-octave-down]').addEventListener('click', () => this.changeOctave(-1));
            this.root.querySelector('[data-octave-up]').addEventListener('click', () => this.changeOctave(1));

            window.addEventListener('blur', () => this.stopAll(true, true));
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this.stopAll(true, true);
            });
            window.addEventListener('pagehide', (event) => {
                this.stopAll(true, true);
                if (!event.persisted) this.destroy();
            });
        }

        bindNormalizedRange(input, callback) {
            input.addEventListener('input', () => {
                this.updatePercentOutput(input);
                callback(normalizedInput(input));
            });
        }

        bindHoldButton() {
            const begin = (event) => {
                if (event.type === 'keydown') {
                    if (!['Enter', ' '].includes(event.key) || event.repeat) return;
                    event.preventDefault();
                }
                if (event.pointerId !== undefined) {
                    event.preventDefault();
                    this.elements.hold.setPointerCapture(event.pointerId);
                }
                this.holdActive = true;
                this.requestPlayback();
            };
            const end = (event) => {
                if (event.type === 'keyup') {
                    if (!['Enter', ' '].includes(event.key)) return;
                    event.preventDefault();
                }
                this.holdActive = false;
                if (!this.latched) this.stopPlayback(false);
            };
            this.elements.hold.addEventListener('pointerdown', begin);
            this.elements.hold.addEventListener('pointerup', end);
            this.elements.hold.addEventListener('pointercancel', end);
            this.elements.hold.addEventListener('lostpointercapture', () => {
                if (this.holdActive) end({ type: 'lostpointercapture' });
            });
            this.elements.hold.addEventListener('keydown', begin);
            this.elements.hold.addEventListener('keyup', end);
        }

        bindNoteKey(key, semitone) {
            const begin = (event) => {
                if (event.type === 'keydown') {
                    if (!['Enter', ' '].includes(event.key) || event.repeat) return;
                    event.preventDefault();
                    this.activeKeyboardKeys.add(key);
                }
                if (event.pointerId !== undefined) {
                    event.preventDefault();
                    key.setPointerCapture(event.pointerId);
                    this.activeNotePointers.add(event.pointerId);
                }
                this.setPitch((this.keyboardOctave + 1) * 12 + semitone, false);
                this.requestPlayback();
            };
            const end = (event) => {
                if (event.type === 'keyup') {
                    if (!['Enter', ' '].includes(event.key)) return;
                    event.preventDefault();
                    this.activeKeyboardKeys.delete(key);
                }
                if (event.pointerId !== undefined) this.activeNotePointers.delete(event.pointerId);
                if (!this.latched && this.activeNotePointers.size === 0 && this.activeKeyboardKeys.size === 0 && !this.holdActive) {
                    this.stopPlayback(false);
                }
            };
            key.addEventListener('pointerdown', begin);
            key.addEventListener('pointerup', end);
            key.addEventListener('pointercancel', end);
            key.addEventListener('lostpointercapture', (event) => {
                if (this.activeNotePointers.has(event.pointerId)) end(event);
            });
            key.addEventListener('keydown', begin);
            key.addEventListener('keyup', end);
        }

        syncControlsToEngine() {
            this.engine.setRegisters(this.activeRanks);
            this.root.querySelectorAll('[data-layer-level]').forEach((input) => {
                this.engine.setLayerLevel(input.dataset.layerLevel, normalizedInput(input));
            });
            this.engine.setPitch(this.midi);
            this.engine.setVowel(this.vowel);
            this.engine.setGrit(this.grit);
            this.engine.setExpression(this.expression);
            this.engine.setMaster(normalizedInput(this.elements.master));
            this.engine.setIrregularity(normalizedInput(this.elements.irregularity));
            this.engine.setNoise(normalizedInput(this.elements.noise));
            this.engine.setTone(normalizedInput(this.elements.tone));
            this.engine.setModulation(normalizedInput(this.elements.modulation));
        }

        selectPreset(preset) {
            this.activeRanks = new Set(preset.ranks);
            this.applyRegisters();
        }

        applyRegisters() {
            this.engine.setRegisters(this.activeRanks);
            this.renderRegisterState();
            this.renderPlaybackState();
            this.renderStatus();
        }

        setPitch(midi, followPitchOctave) {
            this.midi = Math.round(State.clamp(midi, 36, 83));
            this.elements.pitch.value = String(this.midi);
            if (followPitchOctave) this.keyboardOctave = Math.floor(this.midi / 12) - 1;
            this.engine.setPitch(this.midi);
            this.updateKeyboardLabels();
            this.renderSoundReadouts();
            this.renderStatus();
        }

        changeOctave(direction) {
            const next = Math.round(State.clamp(this.keyboardOctave + direction, 2, 5));
            if (next === this.keyboardOctave) return;
            const semitone = ((this.midi % 12) + 12) % 12;
            this.keyboardOctave = next;
            this.setPitch((next + 1) * 12 + semitone, false);
        }

        async enableAudio() {
            this.audioError = '';
            this.audioFaulted = false;
            this.pendingActions += 1;
            this.renderError();
            try {
                await this.engine.enable();
                this.syncControlsToEngine();
                this.root.dataset.audioState = 'running';
                this.elements.enable.textContent = 'Audio Enabled';
            } catch (error) {
                this.audioError = error && error.message ? error.message : 'Audio could not be initialized.';
                this.root.dataset.audioState = 'error';
            } finally {
                this.pendingActions = Math.max(0, this.pendingActions - 1);
                this.renderError();
                this.renderStatus();
            }
        }

        async requestPlayback() {
            const request = ++this.playRequest;
            this.pendingActions += 1;
            try {
                await this.enableAudio();
                const stillWanted = this.holdActive || this.latched || this.activeNotePointers.size > 0 || this.activeKeyboardKeys.size > 0;
                if (request !== this.playRequest || !stillWanted || this.audioError) return;
                this.playing = this.engine.startSound();
            } finally {
                this.pendingActions = Math.max(0, this.pendingActions - 1);
                this.renderPlaybackState();
                this.renderStatus();
            }
        }

        stopPlayback(immediate) {
            this.playRequest += 1;
            this.playing = false;
            this.engine.stopSound(Boolean(immediate));
            this.renderPlaybackState();
            this.renderStatus();
        }

        stopAll(immediate, hardSilence) {
            this.latched = false;
            this.holdActive = false;
            this.elements.latch.checked = false;
            this.activeNotePointers.clear();
            this.activeKeyboardKeys.clear();
            this.playRequest += 1;
            this.playing = false;
            if (hardSilence) this.engine.forceSilence();
            else this.engine.stopSound(Boolean(immediate));
            this.renderPlaybackState();
            this.renderStatus();
        }

        handleContextState(state) {
            if (this.destroyed) return;
            this.root.dataset.audioState = state === 'running' ? 'running' : 'disabled';
            if (state !== 'running') {
                this.playing = false;
                this.latched = false;
                this.holdActive = false;
                this.elements.latch.checked = false;
                this.activeNotePointers.clear();
                this.activeKeyboardKeys.clear();
                this.playRequest += 1;
                this.engine.forceSilence();
            }
            this.renderPlaybackState();
            this.renderStatus();
        }

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            if (this.scopeAnimation) window.cancelAnimationFrame(this.scopeAnimation);
            this.scopeAnimation = 0;
            this.engine.dispose();
        }

        updatePercentOutput(input) {
            const output = this.root.querySelector(`[data-output-for="${input.id}"]`);
            if (output) output.textContent = `${Math.round(finite(input.value, 0))}%`;
        }

        updateKeyboardLabels() {
            this.elements.octaveReadout.textContent = String(this.keyboardOctave);
            this.elements.keyboard.querySelectorAll('[data-semitone]').forEach((key) => {
                const midi = (this.keyboardOctave + 1) * 12 + Number(key.dataset.semitone);
                const label = State.midiToNoteName(midi);
                key.setAttribute('aria-label', `Play ${label}`);
                key.setAttribute('aria-pressed', String(this.playing && midi === this.midi));
            });
        }

        renderRegisterState() {
            const normalized = State.normalizeRanks(this.activeRanks);
            const selectedPreset = State.findPresetId(normalized);
            this.root.querySelectorAll('[data-scream-preset]').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.dataset.screamPreset === selectedPreset));
            });
            this.root.querySelectorAll('[data-rank-toggle]').forEach((button) => {
                button.setAttribute('aria-pressed', String(this.activeRanks.has(button.dataset.rank)));
            });
            this.elements.mainSymbol.querySelectorAll('[data-rank]').forEach((dot) => {
                dot.classList.toggle('is-on', this.activeRanks.has(dot.dataset.rank));
            });
            const preset = State.PRESETS.find((item) => item.id === selectedPreset);
            this.elements.activeRegister.textContent = preset ? preset.label : 'All ranks off · Silent';
        }

        renderSoundReadouts() {
            const frequency = State.midiToFrequency(this.midi);
            this.elements.pitchReadout.textContent = `${State.midiToNoteName(this.midi)} · ${frequency.toFixed(1)} Hz`;
            this.elements.vowelReadout.textContent = this.vowel;
            this.updateKeyboardLabels();
        }

        renderPlaybackState() {
            const audiblePlayback = this.playing && this.activeRanks.size > 0 && this.expression > 0;
            this.root.dataset.playing = String(audiblePlayback);
            this.elements.hold.textContent = this.playing ? (this.latched ? 'Playing · Latched' : 'Playing') : 'Hold to Play';
            this.elements.bellows.style.setProperty('--ss-expression', String(this.expression));
            const speed = 2.05 - this.expression * 1.05;
            this.elements.bellows.style.setProperty('--ss-bellows-speed', `${speed.toFixed(2)}s`);
            this.updateKeyboardLabels();
        }

        renderStatus() {
            if (this.audioError) {
                this.elements.status.textContent = 'Audio unavailable.';
                return;
            }
            const contextState = this.engine.context ? this.engine.context.state : 'disabled';
            if (contextState !== 'running') {
                this.elements.status.textContent = 'Audio is off. Select Enable Audio to begin.';
                return;
            }
            const name = State.PRESETS.find((item) => item.id === State.findPresetId(this.activeRanks));
            if (this.playing && this.activeRanks.size === 0) {
                this.elements.status.textContent = 'Audio running · all ranks off (silent).';
            } else if (this.playing) {
                this.elements.status.textContent = `Playing ${State.midiToNoteName(this.midi)} · ${name ? name.label : 'manual register'}.`;
            } else {
                this.elements.status.textContent = `Audio ready · ${name ? name.label : 'all ranks off'} selected.`;
            }
        }

        renderError() {
            this.elements.error.textContent = this.audioError;
        }

        renderAll() {
            this.root.querySelectorAll('input[type="range"]').forEach((input) => this.updatePercentOutput(input));
            this.renderRegisterState();
            this.renderSoundReadouts();
            this.renderPlaybackState();
            this.renderError();
            this.renderStatus();
        }

        handleAudioFault() {
            if (this.audioFaulted) return;
            this.audioFaulted = true;
            this.audioError = 'Audio stopped because the output contained an invalid sample. Select Enable Audio to retry.';
            this.latched = false;
            this.holdActive = false;
            this.elements.latch.checked = false;
            this.activeNotePointers.clear();
            this.activeKeyboardKeys.clear();
            this.playRequest += 1;
            this.playing = false;
            this.engine.forceSilence();
            this.renderPlaybackState();
            this.renderError();
            this.renderStatus();
        }

        drawOutput(timestamp) {
            if (this.destroyed) return;
            const now = Number.isFinite(timestamp) ? timestamp : performance.now();
            if (document.hidden || (this.lastDrawTimestamp && now - this.lastDrawTimestamp < 32)) {
                this.scopeAnimation = window.requestAnimationFrame((nextTimestamp) => this.drawOutput(nextTimestamp));
                return;
            }
            this.lastDrawTimestamp = now;
            const canvas = this.elements.scope;
            const drawing = canvas.getContext('2d');
            const analyser = this.engine.getAnalyser();
            const width = canvas.width;
            const height = canvas.height;
            drawing.clearRect(0, 0, width, height);
            drawing.fillStyle = '#05080d';
            drawing.fillRect(0, 0, width, height);
            drawing.strokeStyle = 'rgba(120, 155, 180, .12)';
            drawing.lineWidth = 1;
            for (let row = 1; row < 4; row += 1) {
                drawing.beginPath();
                drawing.moveTo(0, (height / 4) * row);
                drawing.lineTo(width, (height / 4) * row);
                drawing.stroke();
            }

            let peak = 0;
            let squaredTotal = 0;
            if (analyser) {
                if (!this.scopeData || this.scopeData.length !== analyser.fftSize) {
                    this.scopeData = new Float32Array(analyser.fftSize);
                }
                if (!this.frequencyData || this.frequencyData.length !== analyser.frequencyBinCount) {
                    this.frequencyData = new Float32Array(analyser.frequencyBinCount);
                }
                analyser.getFloatTimeDomainData(this.scopeData);
                analyser.getFloatFrequencyData(this.frequencyData);
            } else {
                this.scopeData = this.scopeData || new Float32Array(512);
            }

            const colors = [];
            if (this.activeRanks.has('L')) colors.push('#f3a13a');
            if (this.activeRanks.has('M')) colors.push('#bb71ff');
            if (this.activeRanks.has('H')) colors.push('#59ddff');
            drawing.strokeStyle = colors[colors.length - 1] || '#736d68';
            drawing.lineWidth = 2;
            drawing.beginPath();
            const data = this.scopeData;
            let invalidThisFrame = 0;
            for (let index = 0; index < data.length; index += 1) {
                const isFiniteSample = Number.isFinite(data[index]);
                if (!isFiniteSample) {
                    invalidThisFrame += 1;
                    this.nonFiniteSampleCount += 1;
                }
                const sample = isFiniteSample ? data[index] : 0;
                peak = Math.max(peak, Math.abs(sample));
                squaredTotal += sample * sample;
                const x = (index / Math.max(1, data.length - 1)) * width;
                const y = (0.5 - sample * 0.43) * height;
                if (index === 0) drawing.moveTo(x, y);
                else drawing.lineTo(x, y);
            }
            drawing.stroke();

            const safePeak = State.clamp(peak, 0, 1);
            this.outputPeak = peak;
            this.maxObservedPeak = Math.max(this.maxObservedPeak, peak);
            this.outputRms = Math.sqrt(squaredTotal / Math.max(1, data.length));
            this.outputCentroidHz = 0;
            if (analyser && this.frequencyData) {
                let magnitudeTotal = 0;
                let weightedTotal = 0;
                const binWidth = this.engine.context.sampleRate / analyser.fftSize;
                for (let index = 0; index < this.frequencyData.length; index += 1) {
                    const decibels = this.frequencyData[index];
                    const magnitude = Number.isFinite(decibels) ? Math.pow(10, decibels / 20) : 0;
                    magnitudeTotal += magnitude;
                    weightedTotal += magnitude * index * binWidth;
                }
                if (magnitudeTotal > 0) this.outputCentroidHz = weightedTotal / magnitudeTotal;
            }
            this.elements.meter.style.width = `${(safePeak * 100).toFixed(1)}%`;
            const db = State.dbFromPeak(safePeak);
            this.elements.meterReadout.textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB` : '−∞ dB';
            this.elements.meterReadout.style.color = safePeak >= 0.9 ? '#ff7770' : '';
            this.elements.meterWrap.setAttribute('aria-valuenow', safePeak.toFixed(3));
            this.elements.meterWrap.setAttribute('aria-valuetext', Number.isFinite(db) ? `${db.toFixed(1)} decibels peak` : 'Silent');
            if (invalidThisFrame > 0) this.handleAudioFault();
            this.scopeAnimation = window.requestAnimationFrame((nextTimestamp) => this.drawOutput(nextTimestamp));
        }

        diagnostics() {
            const selectedPreset = State.findPresetId(this.activeRanks);
            return Object.freeze({
                activeRanks: State.normalizeRanks(this.activeRanks),
                selectedPreset,
                playing: this.playing,
                latched: this.latched,
                pitchMidi: this.midi,
                pitchName: State.midiToNoteName(this.midi),
                vowel: this.vowel,
                grit: this.grit,
                expression: this.expression,
                contextState: this.engine.context ? this.engine.context.state : 'disabled',
                contextCreateCount: this.engine.contextCreateCount,
                sourceStartCount: this.engine.sourceStartCount,
                layerTargetGains: { ...this.engine.layerTargetGains },
                pendingActions: this.pendingActions,
                activePointerCount: this.activeNotePointers.size,
                activeKeyboardKeyCount: this.activeKeyboardKeys.size,
                analyserReady: Boolean(this.engine.getAnalyser()),
                outputPeak: this.outputPeak,
                maxObservedPeak: this.maxObservedPeak,
                outputRms: this.outputRms,
                outputCentroidHz: this.outputCentroidHz,
                nonFiniteSampleCount: this.nonFiniteSampleCount,
            });
        }
    }

    const screamSynth = new ScreamSynthInterface(root);
    window.__screamSynthDiagnostics = function () {
        return screamSynth.diagnostics();
    };
}());
