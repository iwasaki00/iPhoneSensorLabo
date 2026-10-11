(function (root) {
  'use strict';
  const F = typeof module !== 'undefined' && module.exports ? require('./frame.js') : root.SignalFrame;
  const DEFAULTS = Object.freeze({ zero: 1200, one: 2200, bitMs: 80 });
  function settings(options = {}) {
    const o = { sampleRate: 48000, ...DEFAULTS, ...options };
    if (!Number.isInteger(o.sampleRate) || o.sampleRate < 8000 || o.sampleRate > 96000 || ![40, 80, 120].includes(o.bitMs) ||
        ![o.zero, o.one].every(f => Number.isFinite(f) && f >= 100 && f < o.sampleRate / 2) || Math.abs(o.zero - o.one) < 500) throw new Error('FSK設定が不正です。');
    return o;
  }
  function modulate(bits, options = {}) {
    const o = settings(options), amplitude = options.amplitude ?? 1, phase = options.phase ?? 0;
    if (!Array.isArray(bits) || bits.length > 328 || bits.some(bit => bit !== 0 && bit !== 1) || !Number.isFinite(amplitude) || amplitude < 0 || amplitude > 1 || !Number.isFinite(phase)) throw new Error('変調データが不正です。');
    const samplesPerBit = o.sampleRate * o.bitMs / 1000, signalLength = Math.round(bits.length * samplesPerBit);
    const pcm = new Float32Array(signalLength + Math.round(o.sampleRate * 0.2));
    let angle = phase; const fade = Math.round(o.sampleRate * 0.005);
    for (let i = 0; i < signalLength; i++) {
      const bit = bits[Math.min(bits.length - 1, Math.floor(i / samplesPerBit))];
      pcm[i] = amplitude * Math.min(1, i / fade, (signalLength - 1 - i) / fade) * Math.sin(angle);
      angle = (angle + 2 * Math.PI * (bit ? o.one : o.zero) / o.sampleRate) % (2 * Math.PI);
    }
    return { pcm, options: o, signalLength, duration: pcm.length / o.sampleRate };
  }
  function energy(samples, rate, zero = DEFAULTS.zero, one = DEFAULTS.one) {
    const c0 = 2 * Math.cos(2 * Math.PI * zero / rate), c1 = 2 * Math.cos(2 * Math.PI * one / rate);
    let a0 = 0, b0 = 0, a1 = 0, b1 = 0, squares = 0;
    for (const n of samples) { const s0 = n + c0 * a0 - b0, s1 = n + c1 * a1 - b1; b0 = a0; a0 = s0; b1 = a1; a1 = s1; squares += n * n; }
    const scale = 4 / (samples.length * samples.length);
    const e0 = Math.max(0, (a0 * a0 + b0 * b0 - c0 * a0 * b0) * scale), e1 = Math.max(0, (a1 * a1 + b1 * b1 - c1 * a1 * b1) * scale);
    const high = Math.max(e0, e1), low = Math.min(e0, e1), ratio = high / (low + 1e-15), purity = high / (2 * squares / samples.length + 1e-15);
    const valid = high > 1e-7 && ratio >= 2.5 && purity >= 0.25;
    return { e0, e1, ratio, purity, valid, bit: valid ? e1 > e0 ? 1 : 0 : null, score: Math.log(Math.min(ratio, 1e6)) };
  }
  class Decoder {
    constructor(options = {}, onEvent = () => {}) {
      this.options = settings(options); this.onEvent = onEvent; this.bitSamples = this.options.sampleRate * this.options.bitMs / 1000;
      this.windowSize = Math.round(this.bitSamples / 2); this.ring = new Float32Array(Math.ceil(this.bitSamples * 5)); this.window = new Float32Array(this.windowSize); this.reset();
    }
    reset() { this.total = 0; this.step = 0; this.history = []; this.pending = null; this.receiving = null; this.state = 'SEARCHING'; this.lastBits = []; this.events = []; this.failures = 0; this.completed = 0;
      this.diagnostic = { energy: null, preamble: false, sync: false, timing: false, bits: 0, header: false, version: null, length: null, bytes: 0, crc: 'NOT CHECKED', utf8: '未復元' }; }
    emit(event) {
      this.state = event.state; const value = { ...event, sample: this.total, timeMs: this.total / this.options.sampleRate * 1000 };
      this.events.push(value); if (this.events.length > 16) this.events.shift(); this.onEvent(value);
    }
    at(center) {
      const from = Math.round(center - this.windowSize / 2);
      if (from < 0 || from < this.total - this.ring.length || from + this.windowSize > this.total) return null;
      for (let i = 0; i < this.windowSize; i++) this.window[i] = this.ring[(from + i) % this.ring.length];
      return energy(this.window, this.options.sampleRate, this.options.zero, this.options.one);
    }
    fail(reason) {
      this.diagnostic.crc = reason.includes('CRC') ? 'FAIL' : this.diagnostic.crc;
      this.diagnostic.timing = false;
      const bits = this.receiving ? [...F.bits([...F.SPEC.preamble, ...F.SPEC.sync]), ...this.receiving.bits] : [];
      this.lastBits = bits; this.receiving = null; this.pending = null; this.history = []; this.failures++;
      this.emit({ state: reason.includes('タイムアウト') ? 'TIMEOUT' : 'FAILED', reason, bits, crc: reason.includes('CRC') ? 'FAIL' : this.diagnostic.crc });
    }
    receive() {
      const r = this.receiving;
      while (this.receiving && this.total >= Math.round(r.center - this.windowSize / 2) + this.windowSize) {
        const detected = this.at(r.center);
        this.diagnostic.energy = detected;
        if (!detected?.valid) { this.fail('信号欠落 / ビット判定不能'); return; }
        const bit = detected.bit; let correction = 0;
        if (r.previous != null && r.previous !== bit) {
          const boundary = r.center - this.bitSamples / 2;
          let lo = boundary - this.bitSamples * 0.18, hi = boundary + this.bitSamples * 0.18;
          const left = this.at(lo), right = this.at(hi);
          if (left && right && (left.e1 > left.e0 ? 1 : 0) === r.previous && (right.e1 > right.e0 ? 1 : 0) === bit) {
            for (let i = 0; i < 5; i++) { const mid = (lo + hi) / 2, e = this.at(mid); if ((e.e1 > e.e0 ? 1 : 0) === bit) hi = mid; else lo = mid; }
            correction = Math.max(-this.bitSamples * 0.03, Math.min(this.bitSamples * 0.03, (lo + hi) / 2 - boundary));
          }
        }
        r.previous = bit; r.bits.push(bit); r.center += this.bitSamples + correction;
        this.diagnostic.bits = 32 + r.bits.length; this.diagnostic.bytes = Math.floor(r.bits.length / 8);
        if (r.bits.length === 24) {
          const header = F.bytesFromBits(r.bits);
          this.diagnostic.header = true; this.diagnostic.version = header[0]; this.diagnostic.length = header[2];
          if (header[0] !== F.SPEC.version) { this.fail('VERSION不一致'); return; }
          if (header[2] > F.SPEC.maxPayload) { this.fail('LENGTHが32バイトを超えています'); return; }
          r.expected = (5 + header[2]) * 8;
        }
        if (r.expected && r.bits.length === r.expected) {
          const bits = [...F.bits([...F.SPEC.preamble, ...F.SPEC.sync]), ...r.bits]; this.lastBits = bits;
          try { const frame = F.decodeBody(F.bytesFromBits(r.bits), validation => { this.diagnostic.crc = validation.crc; }); this.diagnostic.utf8 = '正常'; this.receiving = null; this.history = []; this.completed++; this.emit({ state: 'COMPLETE', ...frame, bits }); }
          catch (error) { if (this.diagnostic.crc === 'PASS') this.diagnostic.utf8 = '復元失敗'; this.fail(error.message); }
          return;
        }
        if (this.total > r.deadline || r.bits.length > 296) { this.fail('受信タイムアウト'); return; }
      }
      if (this.receiving && this.total > r.deadline) this.fail('受信タイムアウト');
    }
    process() {
      if (this.receiving) { this.receive(); return; }
      const center = this.windowSize / 2 + this.step * this.bitSamples / 8, detected = this.at(center);
      this.diagnostic.energy = detected;
      this.history.push({ ...detected, center }); if (this.history.length > 264) this.history.shift();
      const pattern = F.bits([...F.SPEC.preamble, ...F.SPEC.sync]);
      if (this.history.length >= 121 && !this.pending) {
        const entries = Array.from({ length: 16 }, (_, i) => this.history[this.history.length - 1 - (15 - i) * 8]);
        if (entries.every((entry, i) => entry.valid && entry.bit === pattern[i])) {
          if (!this.diagnostic.preamble || this.diagnostic.crc !== 'NOT CHECKED') {
            this.diagnostic = { ...this.diagnostic, preamble: true, sync: false, timing: false, header: false, bits: 16, bytes: 0, version: null, length: null, crc: 'NOT CHECKED', utf8: '未復元' };
            this.emit({ state: 'PREAMBLE', reason: '交互ビット16bitを検出。SYNCを探索中' });
          }
        }
      }
      if (this.history.length >= 249) {
        const entries = Array.from({ length: 32 }, (_, i) => this.history[this.history.length - 1 - (31 - i) * 8]);
        if (entries.every((entry, i) => entry.valid && entry.bit === pattern[i])) {
          const candidate = { score: entries.reduce((sum, e) => sum + e.score, 0), center: entries.at(-1).center };
          if (!this.pending) { this.diagnostic = { ...this.diagnostic, preamble: true, sync: true, timing: false, header: false, version: null, length: null, bytes: 0, bits: 32, crc: 'NOT CHECKED', utf8: '未復元' }; this.pending = { best: candidate, deadline: center + this.bitSamples }; this.emit({ state: 'SYNCING', reason: 'PREAMBLE/SYNC候補を確認中' }); }
          else if (candidate.score > this.pending.best.score) this.pending.best = candidate;
        }
      }
      if (this.pending && center >= this.pending.deadline) {
        const firstCenter = this.pending.best.center + this.bitSamples;
        this.receiving = { center: firstCenter, previous: pattern.at(-1), bits: [], expected: null, deadline: firstCenter + this.bitSamples * 300 };
        this.diagnostic.timing = true; this.diagnostic.bits = 32;
        this.pending = null; this.emit({ state: 'RECEIVING', reason: 'サンプル時計でフレーム受信中' }); this.receive();
      }
    }
    push(pcm) {
      if (!(pcm instanceof Float32Array) || pcm.length > this.options.sampleRate * 45) throw new Error('PCMサイズが不正です。');
      for (const sample of pcm) {
        this.ring[this.total % this.ring.length] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0; this.total++;
        while (this.total >= Math.round(this.step * this.bitSamples / 8) + this.windowSize) { this.process(); this.step++; }
      }
      return this.events;
    }
    finish() { if (this.receiving || this.pending) this.fail('受信タイムアウト：未完成フレーム'); return this.events; }
  }
  const api = { DEFAULTS, settings, modulate, energy, Decoder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SignalFSK = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
