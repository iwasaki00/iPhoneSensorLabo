(function (root) {
  'use strict';
  const HELP = Object.freeze({
    MIC_PERMISSION: ['MIC', 'マイクの許可が拒否されました。サイト設定で許可してから再試行してください。'],
    MIC_INIT: ['MIC', 'マイクを準備できません。入力機器と他アプリのマイク使用、HTTPSを確認してください。'],
    WORKLET_INIT: ['MIC', '音声処理を読み込めません。HTTPSとブラウザの対応、ページの再読込を確認してください。'],
    WORKLET_PROCESSOR: ['MIC', '音声処理が停止しました。受信を停止して再試行してください。'],
    PCM_MISSING: ['MIC', 'マイク入力がありません。マイクの使用許可と入力機器を確認し、再試行してください。'],
    PCM_GAP: ['MIC', '音声サンプルが欠落しました。画面を開いたまま再送信してください。'],
    PCM_FORMAT: ['MIC', '音声サンプルの形式が不正です。受信を停止して再試行してください。'],
    AUDIO_SILENCE: ['AUDIO INPUT', '入力は無音または非常に弱い状態です。相手にテスト音を送ってもらい、距離と音量を調整してください。'],
    FSK_NOT_FOUND: ['FSK', '音は検出されていますが、通信周波数を認識できません。距離と音量を調整してください。'],
    SYNC_NOT_FOUND: ['SYNC', '通信周波数は検出されましたが、開始信号を認識できません。同じビット時間で再送信してください。'],
    FRAME_SIGNAL: ['FRAME', '受信途中で信号を判定できません。距離と音量を調整して再送信してください。'],
    FRAME_TIMEOUT: ['FRAME', 'フレームが未完成です。受信を続けたまま最初から再送信してください。'],
    FRAME_CRC: ['CRC', 'データを受信しましたがCRCが一致しません。信号の一部が破損した可能性があります。再送信してください。'],
    FRAME_VERSION: ['FRAME', '通信フレームのVERSIONが不一致です。両方の端末で同じ版を開いてください。'],
    FRAME_LENGTH: ['FRAME', '受信LENGTHが不正です。信号の破損が考えられます。再送信してください。'],
    FRAME_UTF8: ['UTF-8', 'CRCを確認したデータから文字を復元できません。再送信してください。'],
    UNKNOWN: ['UNKNOWN', '原因不明です。診断ログを保存し、各STEPの状態を確認してください。']
  });
  const numeric = n => Number.isFinite(n) ? n : null;
  function frameError(reason = '') {
    return reason.includes('CRC') ? 'FRAME_CRC' : reason.includes('VERSION') ? 'FRAME_VERSION' : reason.includes('LENGTH') ? 'FRAME_LENGTH' : reason.includes('タイムアウト') ? 'FRAME_TIMEOUT' : reason.includes('信号') ? 'FRAME_SIGNAL' : reason.includes('encoded') || reason.includes('UTF') ? 'FRAME_UTF8' : 'UNKNOWN';
  }
  // Explicit allowlist: never serialize input PCM, message text, bits or device IDs.
  function safeSnapshot(s = {}) {
    const e = s.energy || {}, f = s.frame || {}, settings = s.settings || {};
    return { mode: ['tx', 'rx', 'test-tone'].includes(s.mode) ? s.mode : 'rx', state: s.state || 'STOPPED', sampleRate: numeric(s.sampleRate), bitMs: numeric(s.bitMs),
      permission: s.permission || '未開始', stream: s.stream || '未開始', context: s.context || '未開始', worklet: s.worklet || '未開始',
      packets: numeric(s.packets) ?? 0, samples: numeric(s.samples) ?? 0, lastSampleAt: s.lastSampleAt || null, rmsDbfs: numeric(s.rmsDbfs), gaps: numeric(s.gaps) ?? 0,
      energy1200: numeric(e.e0), energy2200: numeric(e.e1), ratio: numeric(e.ratio), purity: numeric(e.purity), validBit: e.valid ? e.bit : null,
      preamble: !!f.preamble, sync: !!f.sync, timing: !!f.timing, demodulatedBits: numeric(f.bits) ?? 0, header: !!f.header,
      frameVersion: numeric(f.version), length: numeric(f.length), receivedBytes: numeric(f.bytes) ?? 0, crc: f.crc || 'NOT CHECKED', utf8: f.utf8 || '未復元', payloadBytes: numeric(s.payloadBytes),
      settings: Object.fromEntries(['sampleRate', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl', 'latency'].filter(k => settings[k] !== undefined).map(k => [k, settings[k]])),
      constraints: s.constraints || null };
  }
  class Recorder {
    constructor(browser = '', now = () => performance.now()) { this.browser = browser; this.now = now; this.started = now(); this.entries = []; this.lastError = null; }
    record(data, code = null) {
      const error = code ? { code: HELP[code] ? code : 'UNKNOWN', stage: (HELP[code] || HELP.UNKNOWN)[0], advice: (HELP[code] || HELP.UNKNOWN)[1] } : null;
      const entry = { timestamp: new Date().toISOString(), elapsedMs: Math.round(this.now() - this.started), ...safeSnapshot(data), error };
      if (error) this.lastError = { ...error, timestamp: entry.timestamp };
      this.entries.push(entry); if (this.entries.length > 250) this.entries.shift(); return entry;
    }
    export() { return { version: '0.2.1', source: 'DEVICE AUDIO PIPELINE DIAGNOSTICS', browser: this.browser, lastError: this.lastError, entries: this.entries }; }
  }
  function inputAdvice(s, stale = false) {
    if (!s.packets || stale) return 'PCM_MISSING';
    if (s.rmsDbfs == null || s.rmsDbfs < -65) return 'AUDIO_SILENCE';
    if (!s.energy?.valid) return 'FSK_NOT_FOUND';
    if (!s.frame?.sync) return 'SYNC_NOT_FOUND';
    return null;
  }
  const api = { HELP, frameError, safeSnapshot, Recorder, inputAdvice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SignalDiagnostics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
