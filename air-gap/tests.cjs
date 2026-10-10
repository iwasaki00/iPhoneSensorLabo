'use strict';
// Synthetic tests only. These do not measure a real speaker or microphone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('./analysis.js');

function synthetic(frequency, rate, size, amplitude = 0.08) {
  const samples = Float32Array.from({ length: size }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
  return spectrumOf(samples, size);
}
function spectrumOf(samples, size) {
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

// Version 0.1.1: snapshots with controlled tones, noise amplitude and elapsed time.
function mixed(tones, rate = 48000, size = 16384, noiseAmplitude = 0, seed = 42) {
  const samples = Float32Array.from({ length: size }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return tones.reduce((sum, tone) => sum + tone.amplitude * Math.sin(2 * Math.PI * tone.frequency * i / rate), 0) + (seed / 4294967296 * 2 - 1) * noiseAmplitude;
  });
  return spectrumOf(samples, size);
}
function measure(data, rate = 48000, size = 16384, target = null, tolerance = 50) {
  return A.analyze(data.spectrum, data.samples, rate, size, target, tolerance);
}
function track(data, times, target = null, options = {}, rate = 48000, size = 16384) {
  const tracker = new A.FrequencyTracker(options), measurement = measure(data, rate, size, target);
  return { tracker, results: times.map(time => tracker.update(measurement, time)) };
}
const ticks = Array.from({ length: 12 }, (_, i) => i * 50);
for (const rate of [44100, 48000]) for (const size of [8192, 16384]) for (const frequency of [1000, 15000]) {
  test(`stable lock ${frequency}Hz / ${rate}Hz / FFT ${size}`, () => {
    const { results } = track(synthetic(frequency, rate, size), ticks, frequency, {}, rate, size);
    assert.equal(results[0].lockState, 'SEARCHING'); assert.equal(results[0].stableFrequency, null);
    assert.equal(results[2].lockState, 'LOCKED');
    assert.ok(Math.abs(results.at(-1).stableFrequency - frequency) < rate / size * 0.25);
    assert.equal(results.at(-1).quality, 'GOOD');
  });
}
test('median reduces jitter on a fixed 1000Hz sine with additive noise', () => {
  const tracker = new A.FrequencyTracker(), raw = [], stable = [];
  for (let i = 0; i < 80; i++) {
    const measurement = measure(mixed([{ frequency: 1000, amplitude: 0.04 }], 48000, 16384, 0.08, i + 100));
    const result = tracker.update(measurement, i * 50);
    if (i >= 10) { raw.push(measurement.frequency); stable.push(result.stableFrequency); }
    assert.equal(result.lockState, i < 2 ? 'SEARCHING' : 'LOCKED');
  }
  const span = values => Math.max(...values) - Math.min(...values);
  assert.ok(span(stable) < span(raw) * 0.75, `RAW ${span(raw)} / STABLE ${span(stable)}`);
  console.log(`COMPARISON additive noise: RAW span=${span(raw).toFixed(4)}Hz, STABLE span=${span(stable).toFixed(4)}Hz; ${(100 * (1 - span(stable) / span(raw))).toFixed(1)}% reduction`);
});
test('one-frame dominant noise never jumps the stable display and old tone recovers', () => {
  const tone = synthetic(1000, 48000, 16384), { tracker } = track(tone, ticks);
  const burst = measure(mixed([{ frequency: 7000, amplitude: 0.5 }], 48000, 16384, 0.1));
  const spike = tracker.update(burst, 600);
  assert.ok(Math.abs(burst.peak.frequency - 7000) < 1);
  assert.equal(spike.stableFrequency, null); assert.notEqual(spike.lockState, 'LOCKED');
  const recovered = tracker.update(measure(tone), 650);
  assert.equal(recovered.lockState, 'LOCKED'); assert.ok(Math.abs(recovered.frequency - 1000) < 1);
});
test('target peak wins over a stronger unrelated tone', () => {
  const measurement = measure(mixed([{ frequency: 1000, amplitude: 0.08 }, { frequency: 2000, amplitude: 0.3 }], 48000, 16384, 0.005), 48000, 16384, 1000);
  const tracker = new A.FrequencyTracker(); let result;
  for (const time of ticks) result = tracker.update(measurement, time);
  assert.ok(Math.abs(measurement.peak.frequency - 2000) < 1);
  assert.ok(Math.abs(result.stableFrequency - 1000) < 1);
  assert.equal(result.state, 'DETECTED');
});
test('weak target does not lock just because the background input is loud', () => {
  const data = mixed([{ frequency: 1000, amplitude: 0.0015 }], 48000, 16384, 0.04, 20);
  const measurement = measure(data, 48000, 16384, 1000);
  assert.ok(measurement.valid && !measurement.strong, `SNR=${measurement.snr}, level=${measurement.level}`);
  const { results } = track(data, ticks, 1000);
  assert.equal(results.at(-1).lockState, 'WEAK'); assert.equal(results.at(-1).stableFrequency, null);
});
test('absent target and an out-of-band peak shoulder cannot be guessed', () => {
  for (const frequency of [2000, 1060]) {
    const measurement = measure(synthetic(frequency, 48000, 16384), 48000, 16384, 1000, 50);
    assert.equal(measurement.valid, false); assert.equal(measurement.candidate.frequency, null);
    const tracker = new A.FrequencyTracker(); let result;
    for (const time of ticks) result = tracker.update(measurement, time);
    assert.equal(result.lockState, 'NO SIGNAL'); assert.equal(result.frequency, null);
  }
});
test('FFT-aware tolerance supports nominal 1Hz UI input', () => {
  const measurement = measure(synthetic(1003, 48000, 8192), 48000, 8192, 1000, 1);
  assert.equal(measurement.effectiveTolerance, 48000 / 8192 * 1.5);
  assert.equal(measurement.valid, true);
});
test('1000 to 2000Hz jump reacquires in 100ms without reporting the old lock', () => {
  const { tracker } = track(synthetic(1000, 48000, 16384), ticks);
  const changed = measure(synthetic(2000, 48000, 16384));
  const first = tracker.update(changed, 600);
  assert.equal(first.lockState, 'SEARCHING'); assert.equal(first.frequency, null);
  assert.equal(tracker.update(changed, 650).stableFrequency, null);
  const locked = tracker.update(changed, 700);
  assert.equal(locked.lockState, 'LOCKED'); assert.ok(Math.abs(locked.frequency - 2000) < 1);
  console.log('COMPARISON frequency change: RAW response=0ms; new LOCKED response=100ms after first new FFT snapshot (FFT capture latency excluded)');
});
test('loss blanks current frequency immediately, then expires after 300ms', () => {
  const { tracker } = track(synthetic(1000, 48000, 16384), ticks);
  const silence = measure(synthetic(1000, 48000, 16384, 0));
  const lost = tracker.update(silence, 600);
  assert.equal(lost.lockState, 'LOST'); assert.equal(lost.frequency, null); assert.equal(lost.state, 'NO SIGNAL');
  assert.equal(tracker.update(silence, 800).lockState, 'LOST');
  assert.equal(tracker.update(silence, 850).lockState, 'NO SIGNAL'); assert.equal(tracker.lock, null);
});
test('continuous independent white-noise snapshots do not lock', () => {
  const tracker = new A.FrequencyTracker();
  for (let i = 0; i < 60; i++) {
    const result = tracker.update(measure(mixed([], 48000, 8192, 0.08, i + 300), 48000, 8192), i * 50);
    assert.notEqual(result.lockState, 'LOCKED'); assert.equal(result.stableFrequency, null);
  }
});
test('sweep tones reacquire independently within each 500ms output interval', () => {
  const tracker = new A.FrequencyTracker(); let time = 0;
  for (const frequency of A.PRESETS) {
    const measurement = measure(synthetic(frequency, 48000, 8192), 48000, 8192);
    let result;
    for (let i = 0; i < 10; i++, time += 50) result = tracker.update(measurement, time);
    assert.equal(result.lockState, 'LOCKED'); assert.ok(Math.abs(result.frequency - frequency) < 2);
    result = tracker.update(measure(synthetic(1000, 48000, 8192, 0), 48000, 8192), time);
    assert.equal(result.stableFrequency, null); time += 100;
  }
});
test('enabled/off comparison keeps RAW separate and logs actual mode', () => {
  const tone = measure(synthetic(1000, 48000, 16384));
  const enabled = new A.FrequencyTracker(), disabled = new A.FrequencyTracker({ enabled: false });
  assert.equal(enabled.update(tone, 0).frequency, null);
  assert.equal(disabled.update(tone, 0).frequency, tone.frequency);
  for (const time of [50, 100, 150]) { enabled.update(tone, time); disabled.update(tone, time); }
  const spike = measure(synthetic(7000, 48000, 16384));
  assert.equal(enabled.update(spike, 200).frequency, null);
  const raw = disabled.update(spike, 200);
  assert.ok(Math.abs(raw.frequency - 7000) < 1); assert.equal(raw.stableFrequency, null); assert.equal(raw.enabled, false);
});
test('clock time, duplicate paints and gaps cannot fake lock duration', () => {
  const measurement = measure(synthetic(1000, 48000, 16384)), tracker = new A.FrequencyTracker();
  tracker.update(measurement, 0);
  for (let i = 0; i < 5; i++) assert.equal(tracker.update(measurement, 0).lockState, 'SEARCHING');
  assert.equal(tracker.update(measurement, 20).lockState, 'SEARCHING');
  assert.equal(tracker.update(measurement, 40).lockState, 'SEARCHING');
  assert.equal(tracker.update(measurement, 100).lockState, 'LOCKED');
  assert.equal(tracker.update(measurement, 600).lockState, 'SEARCHING');
  assert.equal(tracker.update(measurement, 720).lockState, 'SEARCHING');
  assert.equal(tracker.update(measurement, 840).lockState, 'LOCKED');
});
test('FFT/sample-rate/target changes and explicit reset discard prior lock', () => {
  const { tracker } = track(synthetic(1000, 48000, 16384), ticks);
  const changed = measure(synthetic(1000, 44100, 8192), 44100, 8192, 1000);
  assert.equal(tracker.update(changed, 600).lockState, 'SEARCHING');
  tracker.update(changed, 650); tracker.update(changed, 700); tracker.reset();
  assert.equal(tracker.update(changed, 750).stableFrequency, null);
});
test('LAB configuration is validated and does not corrupt previous options', () => {
  const tracker = new A.FrequencyTracker();
  assert.throws(() => tracker.configure({ windowSize: 2 })); assert.equal(tracker.options.windowSize, 5);
  const data = synthetic(1000, 48000, 16384);
  const { results } = track(data, ticks, null, { lockMs: 200, lossMs: 500, windowSize: 7 });
  assert.equal(results[3].lockState, 'SEARCHING'); assert.equal(results[4].lockState, 'LOCKED');
});
test('CSV appends stabilization fields while keeping all ten original columns', () => {
  const measurement = measure(synthetic(1000, 48000, 16384));
  const tracker = new A.FrequencyTracker(); tracker.update(measurement, 0); tracker.update(measurement, 50);
  const result = { ...measurement, ...tracker.update(measurement, 100) };
  const row = A.logRow(result, Date.UTC(2026, 9, 10));
  assert.equal(row.length, 18); assert.equal(row[1], '未設定'); assert.equal(row[7], 'DETECTED');
  assert.equal(row[8], 48000); assert.equal(row[9], 16384); assert.equal(row[12], 'LOCKED'); assert.equal(row[14], 'ON');
  const silence = measure(synthetic(1000, 48000, 16384, 0));
  const lost = { ...silence, ...tracker.update(silence, 150) };
  const lostRow = A.logRow(lost, Date.UTC(2026, 9, 10));
  assert.equal(lostRow[2], ''); assert.equal(lostRow[10], ''); assert.equal(lostRow[11], ''); assert.equal(lostRow[12], 'LOST');
  const csv = A.csv([row, lostRow]);
  assert.ok(csv.includes('"RAW PEAK Hz","STABLE FREQUENCY Hz"')); assert.ok(csv.includes('"LOST"'));
  assert.ok(csv.startsWith('\uFEFF"日時","ターゲットHz","検出Hz","差分Hz","差分%","受信強度dBFS","ノイズフロアdBFS","検出状態","サンプルレートHz","FFTサイズ"'));
  const rawTracker = new A.FrequencyTracker({ enabled: false });
  const rawRow = A.logRow({ ...measurement, ...rawTracker.update(measurement, 0) }, 0);
  assert.equal(rawRow[14], 'OFF'); assert.equal(rawRow[11], '');
});
test('long LAB lock duration is independent of the five-frame median window', () => {
  const measurement = measure(synthetic(1000, 48000, 16384));
  const tracker = new A.FrequencyTracker({ lockMs: 1000, lossMs: 300, windowSize: 5 });
  for (let time = 0; time < 1000; time += 50) assert.equal(tracker.update(measurement, time).lockState, 'SEARCHING');
  const result = tracker.update(measurement, 1000);
  assert.equal(result.lockState, 'LOCKED'); assert.equal(result.durationMs, 1000);
});
test('short sub-100ms sweep pulses do not get a fabricated lock', () => {
  const tracker = new A.FrequencyTracker();
  for (let i = 0; i < A.PRESETS.length; i++) {
    const measurement = measure(synthetic(A.PRESETS[i], 48000, 8192), 48000, 8192);
    const result = tracker.update(measurement, i * 50);
    assert.notEqual(result.lockState, 'LOCKED'); assert.equal(result.stableFrequency, null);
    assert.ok(Number.isFinite(result.rawFrequency));
  }
});
test('weak or mismatching frames end reported continuous reception immediately', () => {
  const { tracker } = track(synthetic(1000, 48000, 16384), ticks);
  const silence = measure(synthetic(1000, 48000, 16384, 0));
  assert.equal(tracker.update(silence, 600).durationMs, 0);
  const resumed = tracker.update(measure(synthetic(1000, 48000, 16384)), 650);
  assert.equal(resumed.lockState, 'LOCKED'); assert.equal(resumed.durationMs, 0);
});
