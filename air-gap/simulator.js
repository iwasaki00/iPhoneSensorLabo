(function (root) {
  'use strict';
  const A = typeof module !== 'undefined' && module.exports ? require('./analysis.js') : root.SignalAnalysis;
  function random(seed) {
    let state = seed >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  }
  function frequencySignal(options = {}) {
    const o = { sampleRate: 48000, frequency: 1000, second: 2000, amplitude: 0.08, noise: 0, duration: 2, interval: 0.6, seed: 42, mode: 'tone', ...options };
    if (![44100, 48000].includes(o.sampleRate) || !Number.isInteger(o.seed) ||
        ![o.frequency, o.second].every(f => Number.isFinite(f) && f >= 100 && f <= 20000 && f < o.sampleRate / 2) ||
        !Number.isFinite(o.duration) || o.duration < 0.5 || o.duration > 8 ||
        !Number.isFinite(o.interval) || o.interval < 0.1 || o.interval > 4 ||
        ![o.amplitude, o.noise].every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
        !['tone', 'switch', 'silence', 'noise', 'interference', 'weak', 'impulse', 'dropout'].includes(o.mode)) throw new Error('シミュレーター設定が範囲外です。');
    const rng = random(o.seed), offset = rng() * 0.25, phase = rng() * 2 * Math.PI;
    const boundaries = [offset, offset + o.duration];
    if (o.mode === 'switch') for (let t = o.interval; t < o.duration; t += o.interval) boundaries.push(offset + t);
    if (['dropout', 'weak', 'impulse'].includes(o.mode)) boundaries.push(offset + o.duration / 2, offset + o.duration / 2 + 0.12);
    const truthAt = time => {
      const t = time - offset;
      if (t < 0 || t >= o.duration || ['silence', 'noise'].includes(o.mode) || (o.mode === 'dropout' && t >= o.duration / 2 && t < o.duration / 2 + 0.12)) return null;
      return o.mode === 'switch' && Math.floor(t / o.interval) % 2 ? o.second : o.frequency;
    };
    const pcm = new Float32Array(Math.ceil((offset + o.duration + 0.8) * o.sampleRate));
    let carrierPhase = phase;
    for (let i = 0; i < pcm.length; i++) {
      const time = i / o.sampleRate, t = time - offset, frequency = truthAt(time);
      let amplitude = o.amplitude;
      if (o.mode === 'weak' && t >= o.duration / 2 && t < o.duration / 2 + 0.12) amplitude *= 0.01;
      carrierPhase += 2 * Math.PI * (frequency ?? o.frequency) / o.sampleRate;
      let value = frequency == null ? 0 : amplitude * Math.sin(carrierPhase);
      const active = t >= 0 && t < o.duration;
      if (active && o.mode === 'interference') value += o.amplitude * 0.7 * Math.sin(2 * Math.PI * o.second * time);
      if (active && o.mode === 'impulse' && t >= o.duration / 2 && t < o.duration / 2 + 0.12) value += (rng() * 2 - 1) * 0.6;
      value += (rng() * 2 - 1) * (o.mode === 'noise' ? Math.max(o.noise, 0.08) : o.noise);
      pcm[i] = Math.max(-1, Math.min(1, value));
    }
    return { pcm, options: o, offset, boundaries: boundaries.sort((a, b) => a - b), truthAt };
  }
  function evaluateFrequency(options = {}) {
    const source = frequencySignal(options), rate = source.options.sampleRate, size = options.fftSize ?? 8192;
    if (![8192, 16384].includes(size)) throw new Error('FFTサイズが不正です。');
    const tracker = new A.FrequencyTracker(), records = [], errors = [];
    let eligible = 0, success = 0, negative = 0, falsePositive = 0, firstLock = null, lostAt = null;
    const started = performance.now();
    for (let end = size; end <= source.pcm.length; end += Math.round(rate * 0.05)) {
      const time = end / rate, pcm = source.pcm.subarray(end - size, end);
      const measurement = A.analyze(A.spectrumPCM(pcm), pcm, rate, size, options.target ?? null, 50);
      const result = tracker.update(measurement, time * 1000), expected = source.truthAt(time - 1 / rate);
      if (result.lockState === 'LOCKED' && firstLock == null) firstLock = time;
      if (time >= source.offset + source.options.duration && result.frequency == null && lostAt == null) lostAt = time;
      // Score only windows fully inside one truth segment, excluding capture transitions.
      const settled = !source.boundaries.some(t => t > time - size / rate - 0.1 && t <= time);
      if (settled) {
        if (expected != null) {
          eligible++;
          if (result.frequency != null && Math.abs(result.frequency - expected) <= rate / size * 1.5) { success++; errors.push(Math.abs(result.frequency - expected)); }
        } else { negative++; if (result.frequency != null) falsePositive++; }
      }
      records.push({ timeMs: Math.round(time * 1000), expected, raw: measurement.frequency, stable: result.frequency, state: result.lockState });
    }
    const changes = source.boundaries.filter(t => t > source.offset && t < source.offset + source.options.duration).map(t => {
      const expected = source.truthAt(t + 0.001);
      const match = records.find(r => r.timeMs >= t * 1000 && r.state === 'LOCKED' && expected != null && Math.abs(r.stable - expected) < rate / size * 1.5);
      return { changeMs: Math.round(t * 1000), followMs: match ? match.timeMs - Math.round(t * 1000) : null };
    });
    return { kind: 'SYNTHETIC FREQUENCY', conditions: { ...source.options, fftSize: size, offset: source.offset }, eligible, success,
      detectionRate: eligible ? success / eligible : null, falsePositiveRate: negative ? falsePositive / negative : null,
      meanErrorHz: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
      lockMs: firstLock == null ? null : Math.round((firstLock - source.offset) * 1000),
      lossMs: lostAt == null ? null : Math.round((lostAt - source.offset - source.options.duration) * 1000),
      changes, processingMs: performance.now() - started, records };
  }
  const api = { random, frequencySignal, evaluateFrequency };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SignalSimulator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
