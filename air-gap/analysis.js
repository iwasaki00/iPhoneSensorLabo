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
    const effectiveTolerance = Math.max(tolerance, resolution * 1.5);
    // Include the nearest bin on both sides of the supported endpoints.
    const low = Math.max(1, Math.floor(100 / resolution));
    const high = Math.min(data.length - 2, Math.ceil(20000 / resolution));
    let strongest = low;
    for (let i = low; i <= high; i++) if (data[i] > data[strongest]) strongest = i;
    const peak = peakAt(data, strongest, sampleRate, fftSize);
    const rawPeakFrequency = Number.isFinite(peak.level) && data[strongest] > data[strongest - 1] && data[strongest] >= data[strongest + 1] ? peak.frequency : null;
    let selected = strongest;
    if (target != null) {
      const lo = Math.max(low, Math.floor((target - effectiveTolerance) / resolution));
      const hi = Math.min(high, Math.ceil((target + effectiveTolerance) / resolution));
      selected = -1;
      // A shoulder at a band boundary is not a peak inside the target band.
      for (let i = lo; i <= hi; i++) {
        if (data[i] > data[i - 1] && data[i] >= data[i + 1] &&
            Math.abs(peakAt(data, i, sampleRate, fftSize).frequency - target) <= effectiveTolerance &&
            (selected < 0 || data[i] > data[selected])) selected = i;
      }
    }
    const hasPeak = selected >= low && selected <= high && data[selected] > data[selected - 1] && data[selected] >= data[selected + 1];
    const candidate = hasPeak ? peakAt(data, selected, sampleRate, fftSize) : { frequency: null, level: -Infinity, index: null };
    const noise = [];
    const radius = Math.max(24, Math.ceil(500 / resolution));
    const noiseCenter = hasPeak ? selected : Math.max(low, Math.min(high, Math.round((target ?? peak.frequency) / resolution)));
    for (let i = Math.max(low, noiseCenter - radius); i <= Math.min(high, noiseCenter + radius); i++) {
      if (!hasPeak || Math.abs(i - selected) > 5) noise.push(Number.isFinite(data[i]) ? data[i] : -160);
    }
    noise.sort((a, b) => a - b);
    const floor = noise.length ? noise[Math.floor(noise.length / 2)] : -160;
    const snr = candidate.level - floor;
    const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
    const inputLevel = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const inRange = target == null || (candidate.frequency != null && Math.abs(candidate.frequency - target) <= effectiveTolerance);
    const valid = hasPeak && Number.isFinite(candidate.level) && candidate.level > -85 && inputLevel > -75 && snr >= 6 && inRange;
    const recent = valid ? [...history, candidate.frequency].slice(-5) : [];
    const stable = recent.length >= 4 && Math.max(...recent) - Math.min(...recent) <= Math.max(resolution * 1.5, 3);
    const state = !valid ? 'NO SIGNAL' : stable && snr >= 12 ? 'DETECTED' : 'WEAK';
    const frequency = valid ? candidate.frequency : null;
    return { peak, rawPeakFrequency, candidate, frequency, level: candidate.level, floor, snr, inputLevel, state, history: recent,
      valid, strong: valid && snr >= 12, resolution, sampleRate, fftSize, target, effectiveTolerance, ...difference(frequency, target) };
  }
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const STABILIZATION_DEFAULTS = Object.freeze({ enabled: true, windowSize: 5, lockFrames: 3, lockMs: 100, lossMs: 300 });
  class FrequencyTracker {
    constructor(options = {}) { this.configure(options); }
    configure(options = {}) {
      const o = { ...STABILIZATION_DEFAULTS, ...options };
      if (typeof o.enabled !== 'boolean' || ![3, 5, 7, 9].includes(o.windowSize) ||
          !Number.isInteger(o.lockFrames) || o.lockFrames < 3 || o.lockFrames > o.windowSize ||
          !Number.isFinite(o.lockMs) || o.lockMs < 100 || o.lockMs > 1000 ||
          !Number.isFinite(o.lossMs) || o.lossMs < 100 || o.lossMs > 2000) throw new Error('安定化設定が範囲外です。');
      this.options = o; this.reset();
    }
    reset() {
      this.window = []; this.pending = []; this.lock = null;
      this.pendingSince = null; this.pendingCount = 0; this.lockedSince = null;
      this.lastGood = null; this.lastTime = null; this.key = null; this.output = null;
    }
    update(measurement, now) {
      if (!Number.isFinite(now)) throw new Error('解析時刻は有限のミリ秒値が必要です。');
      const key = [measurement.sampleRate, measurement.fftSize, measurement.target, measurement.effectiveTolerance].join(':');
      const o = this.options;
      if (this.key !== key || (this.lastTime != null && (now < this.lastTime || now - this.lastTime > o.lossMs))) this.reset();
      // Duplicate timestamps (e.g. extra paints) cannot count toward acquisition.
      if (now === this.lastTime) return this.output;
      this.key = key; this.lastTime = now;
      const band = Math.max(3, measurement.resolution * 1.5);
      const valid = measurement.valid && Number.isFinite(measurement.frequency);
      const strong = valid && measurement.strong;
      let lockState, stableFrequency = null, duration = 0;
      if (this.lock != null && now - this.lastGood >= o.lossMs) {
        this.lock = null; this.window = [];
      }
      if (!strong) {
        this.pending = []; this.pendingSince = null; this.pendingCount = 0;
        lockState = valid ? 'WEAK' : this.lock != null ? 'LOST' : 'NO SIGNAL';
      } else if (this.lock != null && Math.abs(measurement.frequency - this.lock) <= band) {
        if (this.output?.lockState !== 'LOCKED') this.lockedSince = now;
        this.pending = []; this.pendingSince = null; this.pendingCount = 0;
        this.window = [...this.window.filter(entry => now - entry.time <= o.lossMs), { frequency: measurement.frequency, time: now }].slice(-o.windowSize);
        this.lock = median(this.window.map(entry => entry.frequency));
        this.lastGood = now; stableFrequency = this.lock; lockState = 'LOCKED';
        duration = now - this.lockedSince;
      } else {
        // Keep a separate acquisition cluster: a real jump must not mix with the old tone.
        if (this.pending.length && Math.abs(measurement.frequency - median(this.pending.map(entry => entry.frequency))) > band) {
          this.pending = []; this.pendingSince = null; this.pendingCount = 0;
        }
        if (this.pendingSince == null) this.pendingSince = now;
        this.pendingCount++;
        this.pending = [...this.pending.filter(entry => now - entry.time <= o.lossMs), { frequency: measurement.frequency, time: now }].slice(-o.windowSize);
        duration = now - this.pendingSince;
        const spread = Math.max(...this.pending.map(entry => entry.frequency)) - Math.min(...this.pending.map(entry => entry.frequency));
        if (this.pendingCount >= o.lockFrames && duration >= o.lockMs && spread <= band * 2) {
          this.window = this.pending; this.pending = [];
          this.pendingSince = null; this.pendingCount = 0;
          this.lock = median(this.window.map(entry => entry.frequency));
          this.lockedSince = now - duration; this.lastGood = now;
          stableFrequency = this.lock; lockState = 'LOCKED';
        } else lockState = 'SEARCHING';
      }
      // Never expose a retained lock as current reception during missing/discordant frames.
      if (lockState !== 'LOCKED') stableFrequency = null;
      const frequency = o.enabled ? stableFrequency : valid ? measurement.frequency : null;
      const state = lockState === 'LOCKED' ? 'DETECTED' : valid ? 'WEAK' : 'NO SIGNAL';
      const quality = lockState === 'LOCKED' ? 'GOOD' : strong ? 'FAIR' : valid ? 'LOW' : 'NONE';
      this.output = { frequency, stableFrequency: o.enabled ? stableFrequency : null, rawFrequency: valid ? measurement.frequency : null,
        lockState, state, quality, enabled: o.enabled, durationMs: duration, ...difference(frequency, measurement.target) };
      return this.output;
    }
  }
  function sweepRange(start, end, step) {
    if (![start, end, step].every(Number.isInteger) || start < 100 || end > 20000 || end < start || step < 1) throw new Error('範囲は100〜20000Hz、開始≦終了、ステップは1Hz以上の整数にしてください。');
    const count = Math.floor((end - start) / step) + 1;
    if (count > 1000) throw new Error('スイープは1000ステップ以内にしてください。');
    return Array.from({ length: count }, (_, i) => start + i * step);
  }
  function csv(rows) {
    const columns = ['日時', 'ターゲットHz', '検出Hz', '差分Hz', '差分%', '受信強度dBFS', 'ノイズフロアdBFS', '検出状態', 'サンプルレートHz', 'FFTサイズ',
      'RAW PEAK Hz', 'STABLE FREQUENCY Hz', '受信状態', '信号品質', '安定化有効', 'RAW候補Hz', '有効許容誤差Hz', '検出継続ms'];
    const escape = value => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
    return '\uFEFF' + [columns, ...rows.map(row => columns.map((_, i) => row[i] ?? ''))].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
  }
  function logRow(result, timestamp) {
    const fmt = (value, digits) => Number.isFinite(value) ? value.toFixed(digits) : '';
    return [new Date(timestamp).toISOString(), result.target ?? '未設定', fmt(result.frequency, 3), fmt(result.hz, 3), fmt(result.percent, 5),
      fmt(result.level, 2), fmt(result.floor, 2), result.state, result.sampleRate, result.fftSize,
      fmt(result.rawPeakFrequency, 3), fmt(result.stableFrequency, 3), result.lockState, result.quality,
      result.enabled ? 'ON' : 'OFF', fmt(result.rawFrequency, 3), fmt(result.effectiveTolerance, 3), fmt(result.durationMs, 0)];
  }
  function spectrumPCM(samples) {
    const size = samples.length;
    if (![8192, 16384].includes(size)) throw new Error('PCM解析窓は8192/16384サンプルです。');
    const re = Float64Array.from(samples, (n, i) => n * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / size) + 0.08 * Math.cos(4 * Math.PI * i / size)));
    const im = new Float64Array(size);
    for (let i = 1, j = 0; i < size; i++) {
      let bit = size >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) [re[i], re[j]] = [re[j], re[i]];
    }
    for (let length = 2; length <= size; length *= 2) for (let base = 0; base < size; base += length) {
      for (let j = 0; j < length / 2; j++) {
        const angle = -2 * Math.PI * j / length, index = base + j, other = index + length / 2;
        const tr = re[other] * Math.cos(angle) - im[other] * Math.sin(angle), ti = re[other] * Math.sin(angle) + im[other] * Math.cos(angle);
        re[other] = re[index] - tr; im[other] = im[index] - ti; re[index] += tr; im[index] += ti;
      }
    }
    return Float32Array.from({ length: size / 2 }, (_, i) => 20 * Math.log10(Math.max(1e-12, Math.hypot(re[i], im[i]) / size)));
  }
  const api = { PRESETS, binHz, peakAt, difference, analyze, spectrumPCM, median, STABILIZATION_DEFAULTS, FrequencyTracker, sweepRange, csv, logRow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SignalAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
