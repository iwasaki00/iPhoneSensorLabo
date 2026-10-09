'use strict';
// Synthetic tests only. These do not measure a real speaker or microphone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('./analysis.js');

function synthetic(frequency, rate, size, amplitude = 0.08) {
  const samples = Float32Array.from({ length: size }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
  // Independent radix-2 FFT with the Blackman window used by Web Audio AnalyserNode.
  const re = Float64Array.from(samples, (n, i) => n * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / size) + 0.08 * Math.cos(4 * Math.PI * i / size)));
  const im = new Float64Array(size);
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let length = 2; length <= size; length *= 2) {
    for (let base = 0; base < size; base += length) {
      for (let j = 0; j < length / 2; j++) {
        const angle = -2 * Math.PI * j / length, other = base + j + length / 2, index = base + j;
        const tr = re[other] * Math.cos(angle) - im[other] * Math.sin(angle);
        const ti = re[other] * Math.sin(angle) + im[other] * Math.cos(angle);
        re[other] = re[index] - tr; im[other] = im[index] - ti;
        re[index] += tr; im[index] += ti;
      }
    }
  }
  const spectrum = Float32Array.from({ length: size / 2 }, (_, i) => 20 * Math.log10(Math.max(1e-8, Math.hypot(re[i], im[i]) / size)));
  return { spectrum, samples };
}
function settle(spectrum, samples, rate, size, target = null, tolerance = 50) {
  let result, history = [];
  for (let i = 0; i < 5; i++) { result = A.analyze(spectrum, samples, rate, size, target, tolerance, history); history = result.history; }
  return result;
}
test('FFT bin to Hz follows sample rate and FFT size', () => {
  assert.equal(A.binHz(100, 48000, 16384), 292.96875);
  assert.equal(A.binHz(100, 44100, 8192), 538.330078125);
});
test('quadratic interpolation refines a sub-bin peak', () => {
  const data = Float32Array.from([-30, -10, -6, -8, -20]);
  const peak = A.peakAt(data, 2, 48000, 8192);
  assert.ok(Math.abs(peak.frequency - A.binHz(2 + 1 / 6, 48000, 8192)) < 1e-6);
});
for (const rate of [32000, 44100, 48000]) for (const size of [8192, 16384]) {
  for (const frequency of [100, 1000.7, 8000, 15000, ...(rate > 32000 ? [17000.4, 19000, 20000] : [])]) {
    test(`synthetic sine ${frequency}Hz / ${rate}Hz / FFT ${size}`, () => {
      const { spectrum, samples } = synthetic(frequency, rate, size);
      const result = settle(spectrum, samples, rate, size, Math.round(frequency));
      assert.equal(result.state, 'DETECTED');
      assert.ok(Math.abs(result.frequency - frequency) < rate / size * 0.25, `detected ${result.frequency}`);
    });
  }
}
test('silence and non-finite FFT values produce NO SIGNAL', () => {
  const result = settle(new Float32Array(8192).fill(-Infinity), new Float32Array(16384), 48000, 16384);
  assert.equal(result.state, 'NO SIGNAL'); assert.equal(result.frequency, null); assert.equal(result.hz, null);
});
test('broadband noise does not become a tone', () => {
  let seed = 42;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const data = Float32Array.from({ length: 8192 }, () => -65 + noise() * 5);
  const samples = Float32Array.from({ length: 16384 }, () => (noise() - 0.5) * 0.1);
  assert.equal(settle(data, samples, 48000, 16384).state, 'NO SIGNAL');
});
test('stability is required and weak signals remain WEAK', () => {
  const { spectrum, samples } = synthetic(17000, 48000, 16384);
  assert.equal(A.analyze(spectrum, samples, 48000, 16384, 17000, 50).state, 'WEAK');
  const weak = new Float32Array(8192).fill(-80); weak[5803] = -71; weak[5802] = -75; weak[5804] = -75;
  assert.equal(settle(weak, samples, 48000, 16384).state, 'WEAK');
  let history = [], result;
  for (const frequency of [1000, 1100, 1000, 1100, 1000]) {
    const data = synthetic(frequency, 48000, 16384);
    result = A.analyze(data.spectrum, data.samples, 48000, 16384, null, 50, history); history = result.history;
  }
  assert.equal(result.state, 'WEAK');
});
test('wrong target is rejected while strongest peak stays independent', () => {
  const { spectrum, samples } = synthetic(1000, 48000, 16384);
  const result = settle(spectrum, samples, 48000, 16384, 17000);
  assert.equal(result.state, 'NO SIGNAL'); assert.equal(result.frequency, null);
  assert.ok(Math.abs(result.peak.frequency - 1000) < 1);
});
test('difference supports an unset target', () => {
  assert.deepEqual(A.difference(17010, 17000), { hz: 10, percent: 10 / 17000 * 100 });
  assert.deepEqual(A.difference(17000, null), { hz: null, percent: null });
});
test('preset order and range validation', () => {
  assert.deepEqual(A.PRESETS, [500, 1000, 2000, 4000, 8000, 12000, 15000, 16000, 17000, 18000, 19000]);
  assert.deepEqual(A.sweepRange(15000, 17000, 1000), [15000, 16000, 17000]);
  assert.throws(() => A.sweepRange(20000, 100, 1)); assert.throws(() => A.sweepRange(100, 20000, 0));
  assert.throws(() => A.sweepRange(100, 20000, 1)); assert.throws(() => A.sweepRange(100.5, 2000, 100));
});
test('CSV includes BOM, CRLF, Japanese unset marker and escaping', () => {
  const csv = A.csv([['2026-10-10T00:00:00Z', '未設定', null, null, null, -40, -80, 'NO SIGNAL', 48000, 16384], ['quoted "value"']]);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"未設定"')); assert.ok(csv.includes('"quoted ""value"""')); assert.ok(csv.endsWith('\r\n'));
});
