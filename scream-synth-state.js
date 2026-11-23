(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ScreamSynthState = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const RANKS = Object.freeze(['L', 'M', 'H']);

    const PRESETS = Object.freeze([
        Object.freeze({ id: 'frustrated-sigh', label: 'Frustrated Sigh', ranks: Object.freeze(['L']) }),
        Object.freeze({ id: 'voice-grit', label: 'Voice / Grit', ranks: Object.freeze(['M']) }),
        Object.freeze({ id: 'fry', label: 'Fry', ranks: Object.freeze(['H']) }),
        Object.freeze({ id: 'low-voice', label: 'Low + Voice', ranks: Object.freeze(['L', 'M']) }),
        Object.freeze({ id: 'voice-fry', label: 'Voice + Fry', ranks: Object.freeze(['M', 'H']) }),
        Object.freeze({ id: 'low-fry', label: 'Low + Fry', ranks: Object.freeze(['L', 'H']) }),
        Object.freeze({ id: 'full-scream', label: 'Full Scream', ranks: Object.freeze(['L', 'M', 'H']) }),
    ]);

    const VOWELS = Object.freeze({
        Ah: Object.freeze([760, 1160]),
        Ee: Object.freeze([350, 2250]),
        Oh: Object.freeze([470, 820]),
        Oo: Object.freeze([310, 690]),
    });

    const NOTE_NAMES = Object.freeze(['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']);

    function clamp(value, minimum, maximum) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return minimum;
        return Math.min(maximum, Math.max(minimum, numeric));
    }

    function normalizeRanks(input) {
        const values = input instanceof Set ? [...input] : Array.isArray(input) ? input : [];
        return RANKS.filter((rank) => values.includes(rank));
    }

    function sameRanks(left, right) {
        const a = normalizeRanks(left);
        const b = normalizeRanks(right);
        return a.length === b.length && a.every((rank, index) => rank === b[index]);
    }

    function findPresetId(ranks) {
        const preset = PRESETS.find((item) => sameRanks(item.ranks, ranks));
        return preset ? preset.id : null;
    }

    function midiToFrequency(midi, tuning) {
        const safeMidi = clamp(midi, 24, 96);
        const safeTuning = clamp(tuning === undefined ? 440 : tuning, 400, 480);
        return safeTuning * Math.pow(2, (safeMidi - 69) / 12);
    }

    function midiToNoteName(midi) {
        const safeMidi = Math.round(clamp(midi, 24, 96));
        const octave = Math.floor(safeMidi / 12) - 1;
        return `${NOTE_NAMES[safeMidi % 12]}${octave}`;
    }

    function activeLayerCompensation(ranks, levels) {
        const weights = normalizeRanks(ranks)
            .map((rank) => clamp(levels && levels[rank] !== undefined ? levels[rank] : 1, 0, 1))
            .filter((level) => level > 0.0001);
        if (weights.length === 0) return 0;
        const strongest = Math.max(...weights);
        const energy = Math.sqrt(weights.reduce((total, level) => total + level * level, 0));
        return strongest / energy;
    }

    function dbFromPeak(peak) {
        const safePeak = clamp(peak, 0, 4);
        if (safePeak <= 0.00001) return -Infinity;
        return 20 * Math.log10(safePeak);
    }

    return Object.freeze({
        RANKS,
        PRESETS,
        VOWELS,
        NOTE_NAMES,
        clamp,
        normalizeRanks,
        sameRanks,
        findPresetId,
        midiToFrequency,
        midiToNoteName,
        activeLayerCompensation,
        dbFromPeak,
    });
}));
