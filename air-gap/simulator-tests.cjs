'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./simulator.js');
for (const sampleRate of [44100, 48000]) for (const frequency of [1000, 15000]) {
  test(`shared PCM frequency pipeline ${frequency}Hz at ${sampleRate}`, () => {
    const report = S.evaluateFrequency({ sampleRate, frequency, duration: 1.5 });
    assert.equal(report.detectionRate, 1); assert.equal(report.falsePositiveRate, 0); assert.ok(report.lockMs < 700); assert.ok(report.lossMs < 600);
  });
}
test('frequency-switch follows ground truth with capture latency counted', () => {
  const result = S.evaluateFrequency({ mode: 'switch', duration: 2.4, interval: 0.8 });
  assert.equal(result.detectionRate, 1); assert.ok(result.changes.every(c => c.followMs != null && c.followMs < 700));
});
for (const mode of ['silence', 'noise', 'interference', 'weak', 'impulse', 'dropout']) {
  test(`frequency simulator scenario: ${mode}`, () => {
    const report = S.evaluateFrequency({ mode, noise: mode === 'noise' ? 0.1 : 0.002, duration: 2, target: 1000 });
    assert.ok(report.records.length > 20);
    if (['silence', 'noise'].includes(mode)) assert.equal(report.falsePositiveRate, 0);
    else assert.ok(report.detectionRate > 0.6);
  });
}
test('fixed seed gives exactly the same PCM, truth and evaluation', () => {
  assert.deepEqual(S.frequencySignal({ seed: 123 }).pcm, S.frequencySignal({ seed: 123 }).pcm);
  assert.notEqual(S.frequencySignal({ seed: 123 }).offset, S.frequencySignal({ seed: 124 }).offset);
  const a = S.evaluateFrequency({ seed: 123 }), b = S.evaluateFrequency({ seed: 123 });
  delete a.processingMs; delete b.processingMs; assert.deepEqual(a, b);
});
test('invalid and excessive simulator parameters are rejected', () => {
  for (const options of [{ duration: Infinity }, { duration: 100 }, { sampleRate: 1 }, { noise: NaN }, { frequency: 30000 }]) assert.throws(() => S.frequencySignal(options));
});
