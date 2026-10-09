(function (root) {
  'use strict';
  const PRESETS = [500, 1000, 2000, 4000, 8000, 12000, 15000, 16000, 17000, 18000, 19000];
  const binHz = (bin, sampleRate, fftSize) => bin * sampleRate / fftSize;
  const difference = (frequency, target) => target == null || frequency == null ? { hz: null, percent: null } : { hz: frequency - target, percent: (frequency - target) / target * 100 };
  function peakAt(data, index, sampleRate, fftSize) {
    const a = data[index - 1], b = data[index], c = data[index + 1];
    const denominator = a - 2 * b + c;
    const offset = Number.isFinite(denominator) && denominator < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denominator)) : 0;
    return { frequency: binHz(index + offset, sampleRate, fftSize), level: b, index };
  }
  function analyze(data, samples, sampleRate, fftSize, target, tolerance, history = []) {
    const resolution = sampleRate / fftSize;
    // Include the nearest bin on both sides of the supported endpoints.
    const low = Math.max(1, Math.floor(100 / resolution));
    const high = Math.min(data.length - 2, Math.ceil(20000 / resolution));
    let strongest = low;
    for (let i = low; i <= high; i++) if (data[i] > data[strongest]) strongest = i;
    const peak = peakAt(data, strongest, sampleRate, fftSize);
    let selected = strongest;
    if (target != null) {
      const lo = Math.max(low, Math.floor((target - tolerance) / resolution));
      const hi = Math.min(high, Math.ceil((target + tolerance) / resolution));
      selected = lo;
      for (let i = lo; i <= hi; i++) if (data[i] > data[selected]) selected = i;
    }
    const candidate = peakAt(data, selected, sampleRate, fftSize);
    const noise = [];
    const radius = Math.max(24, Math.ceil(500 / resolution));
    for (let i = Math.max(low, selected - radius); i <= Math.min(high, selected + radius); i++) {
      if (Math.abs(i - selected) > 5) noise.push(Number.isFinite(data[i]) ? data[i] : -160);
    }
    noise.sort((a, b) => a - b);
    const floor = noise.length ? noise[Math.floor(noise.length / 2)] : -160;
    const snr = candidate.level - floor;
    const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
    const inputLevel = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const inRange = target == null || Math.abs(candidate.frequency - target) <= tolerance;
    const valid = Number.isFinite(candidate.level) && candidate.level > -85 && inputLevel > -75 && snr >= 6 && inRange;
    const recent = valid ? [...history, candidate.frequency].slice(-5) : [];
    const stable = recent.length >= 4 && Math.max(...recent) - Math.min(...recent) <= Math.max(resolution * 1.5, 3);
    const state = !valid ? 'NO SIGNAL' : stable && snr >= 12 ? 'DETECTED' : 'WEAK';
    const frequency = valid ? candidate.frequency : null;
    return { peak, frequency, level: candidate.level, floor, snr, inputLevel, state, history: recent, ...difference(frequency, target) };
  }
  function sweepRange(start, end, step) {
    if (![start, end, step].every(Number.isInteger) || start < 100 || end > 20000 || end < start || step < 1) throw new Error('範囲は100〜20000Hz、開始≦終了、ステップは1Hz以上の整数にしてください。');
    const count = Math.floor((end - start) / step) + 1;
    if (count > 1000) throw new Error('スイープは1000ステップ以内にしてください。');
    return Array.from({ length: count }, (_, i) => start + i * step);
  }
  function csv(rows) {
    const columns = ['日時', 'ターゲットHz', '検出Hz', '差分Hz', '差分%', '受信強度dBFS', 'ノイズフロアdBFS', '検出状態', 'サンプルレートHz', 'FFTサイズ'];
    const escape = value => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
    return '\uFEFF' + [columns, ...rows].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
  }
  const api = { PRESETS, binHz, peakAt, difference, analyze, sweepRange, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SignalAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
