'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../scream-synth-state.js');

const EXPECTED_PRESETS = Object.freeze({
    'frustrated-sigh': ['L'],
    'voice-grit': ['M'],
    fry: ['H'],
    'low-voice': ['L', 'M'],
    'voice-fry': ['M', 'H'],
    'low-fry': ['L', 'H'],
    'full-scream': ['L', 'M', 'H'],
});

test('the register bank contains every nonempty three-rank combination exactly once', () => {
    assert.deepEqual(State.RANKS, ['L', 'M', 'H']);
    assert.equal(State.PRESETS.length, 7);

    const actual = Object.fromEntries(
        State.PRESETS.map((preset) => [preset.id, [...preset.ranks]])
    );
    assert.deepEqual(actual, EXPECTED_PRESETS);

    const combinationKeys = State.PRESETS.map((preset) => State.normalizeRanks(preset.ranks).join(''));
    assert.equal(new Set(combinationKeys).size, 7);
    assert.ok(combinationKeys.every(Boolean));
});

test('rank normalization, equality, and preset lookup share one canonical ordering', () => {
    assert.deepEqual(State.normalizeRanks(['H', 'L', 'H', 'unknown']), ['L', 'H']);
    assert.deepEqual(State.normalizeRanks(new Set(['M', 'L'])), ['L', 'M']);
    assert.deepEqual(State.normalizeRanks(null), []);

    assert.equal(State.sameRanks(['H', 'L'], ['L', 'H']), true);
    assert.equal(State.sameRanks(['L'], ['L', 'M']), false);

    for (const [id, ranks] of Object.entries(EXPECTED_PRESETS)) {
        assert.equal(State.findPresetId([...ranks].reverse()), id);
    }
    assert.equal(State.findPresetId([]), null);
});

test('level compensation is finite, bounded, and silent when all ranks are off', () => {
    assert.equal(State.activeLayerCompensation([]), 0);
    assert.equal(State.activeLayerCompensation(['L']), 1);
    assert.equal(State.activeLayerCompensation(['L', 'M']), 1 / Math.sqrt(2));
    assert.equal(State.activeLayerCompensation(['L', 'M', 'H']), 1 / Math.sqrt(3));
    assert.equal(State.activeLayerCompensation(['L', 'M'], { L: 1, M: 0 }), 1);
    assert.equal(State.activeLayerCompensation(['L', 'M'], { L: 0, M: 0 }), 0);
    assert.ok(State.activeLayerCompensation(['L', 'M'], { L: 1, M: 0.1 }) > 0.99);

    for (const preset of State.PRESETS) {
        const compensation = State.activeLayerCompensation(preset.ranks);
        assert.equal(Number.isFinite(compensation), true);
        assert.ok(compensation > 0 && compensation <= 1);
    }
});

test('pitch and peak helpers remain finite and clamp unsafe inputs', () => {
    assert.equal(State.midiToNoteName(52), 'E3');
    assert.ok(Math.abs(State.midiToFrequency(69) - 440) < 1e-9);
    assert.equal(State.midiToFrequency(Number.NaN), State.midiToFrequency(24));
    assert.equal(State.clamp(Number.POSITIVE_INFINITY, 0, 1), 0);
    assert.equal(State.dbFromPeak(0), -Infinity);

    for (const peak of [0.0001, 0.25, 0.5, 0.94, 1, 4, Number.NaN]) {
        const decibels = State.dbFromPeak(peak);
        assert.ok(decibels === -Infinity || Number.isFinite(decibels));
        assert.ok(decibels <= 20 * Math.log10(4));
    }
});
