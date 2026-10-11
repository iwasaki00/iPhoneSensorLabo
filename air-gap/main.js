'use strict';
const $ = id => document.getElementById(id);
const A = SignalAnalysis;
const tracker = new A.FrequencyTracker();
const Audio = window.AudioContext || window.webkitAudioContext;
let tx = null, rx = null, txEpoch = 0, rxEpoch = 0, sweepTimer = null, sweepResolve = null;
let result = null, spectrum = null, samples = null, lastFrame = 0, animation = 0;
const rows = [];
const say = message => { $('message').textContent = message; };
const number = (id, min, max, integer = true) => {
  const field = $(id), value = field.value.trim() === '' ? NaN : Number(field.value);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${field.closest('label')?.childNodes[0]?.textContent.trim() || '入力値'}：${min}〜${max}${integer ? 'の整数' : ''}を指定してください。`);
  }
  return value;
};
function frequencyLimit(context) { return Math.min(20000, Math.ceil(context.sampleRate / 2) - 1); }
function validateFrequency(frequency, context) {
  const max = frequencyLimit(context);
  if (frequency > max) throw new Error(`サンプルレート ${context.sampleRate}Hz では ${max}Hz 以下を指定してください（ナイキスト上限）。`);
}
const volume = () => Number($('volume').value) / 100 * 0.15;
function showFrequency(value) {
  $('frequency-display').innerHTML = `${value.toLocaleString('en-US')} <small>Hz</small>`;
  $('frequency-slider').value = value;
  $('high-warning').hidden = value < 15000;
}
function setFrequency(value) {
  if (tx?.mode === 'sweep') return say('スイープ中の周波数は自動制御されます。変更する場合はSTOPしてください。');
  try {
    if (!Number.isInteger(value) || value < 100 || value > 20000) throw new Error('周波数は100〜20000Hzの整数にしてください。');
    if (tx) validateFrequency(value, tx.context);
    $('frequency').value = value;
    showFrequency(value);
    if (tx?.oscillator) {
      tx.oscillator.frequency.setTargetAtTime(value, tx.context.currentTime, 0.01);
      $('tx-state').textContent = `TX · PLAYING ${value} Hz`;
    }
  } catch (error) { say(error.message); }
}
function updateTxButtons() {
  $('tx-start').disabled = !!tx;
  $('tx-stop').disabled = !tx;
  $('sweep-start').disabled = !!tx;
  $('sweep-stop').disabled = tx?.mode !== 'sweep';
  window.SignalData?.updateButtons();
}
function stopTone(session) {
  if (!session?.oscillator && !session?.bufferSource) return;
  const oscillator = session.oscillator || session.bufferSource, gain = session.gain, now = session.context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.025);
  oscillator.stop(now + 0.03);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  session.oscillator = null;
  session.bufferSource = null;
  session.gain = null;
}
function stopTx() {
  txEpoch++;
  if (sweepTimer != null) clearTimeout(sweepTimer);
  sweepTimer = null;
  if (sweepResolve) sweepResolve(false);
  sweepResolve = null;
  const old = tx;
  tx = null;
  if (old) {
    stopTone(old);
    old.context.onstatechange = null;
    // Allow the final gain ramp to finish before releasing the context.
    setTimeout(() => { old.context.close().catch(() => {}); }, 60);
  }
  $('tx-state').textContent = 'TX · STOPPED';
  $('sweep-progress').textContent = 'STOPPED';
  if (['data', 'test-tone'].includes(old?.mode)) window.SignalData?.onTxStopped(old.finishState || 'STOPPED');
  updateTxButtons();
}
function tone(session, frequency) {
  validateFrequency(frequency, session.context);
  const oscillator = session.context.createOscillator(), gain = session.context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.value = 0;
  gain.gain.setValueAtTime(0, session.context.currentTime);
  gain.gain.linearRampToValueAtTime(volume(), session.context.currentTime + 0.025);
  oscillator.connect(gain).connect(session.context.destination);
  session.oscillator = oscillator; session.gain = gain;
  oscillator.start();
  $('frequency').value = frequency;
  showFrequency(frequency);
  $('tx-state').textContent = `TX · ${session.mode === 'sweep' ? 'SWEEP' : 'PLAYING'} ${frequency} Hz`;
}
async function startTx(mode, frequencies, duration, gap) {
  if (tx) return;
  const epoch = ++txEpoch;
  let session;
  try {
    if (!Audio) throw new Error('Web Audio APIに対応していません。');
    // Create and resume immediately within the user's click, including Safari.
    const context = new Audio();
    session = { context, mode, oscillator: null, gain: null };
    tx = session; updateTxButtons();
    frequencies.forEach(f => validateFrequency(f, context));
    await context.resume();
    if (epoch !== txEpoch || document.hidden) return;
    if (context.state !== 'running') throw new Error('音声開始が制限されています。再度STARTしてください。');
    context.onstatechange = () => {
      if (tx === session && context.state !== 'running') { stopTx(); say('音声出力が中断されました。STARTで再開してください。'); }
    };
    $('tx-diagnostics').textContent = `sampleRate ${context.sampleRate} Hz / 出力上限 ${frequencyLimit(context)} Hz / Sine`;
    say('低音量で実験してください。端末本体の音量も結果に影響します。');
    if (mode === 'tone') return tone(session, frequencies[0]);
    $('progress').max = frequencies.length; $('progress').value = 0;
    for (let i = 0; i < frequencies.length; i++) {
      if (epoch !== txEpoch) return;
      tone(session, frequencies[i]);
      $('sweep-current').innerHTML = `${frequencies[i].toLocaleString('en-US')} <small>Hz</small>`;
      $('sweep-progress').textContent = `${i + 1} / ${frequencies.length} · OUTPUT`;
      if (!await waitSweep(duration * 1000, epoch)) return;
      stopTone(session);
      $('tx-state').textContent = 'TX · SWEEP SILENCE';
      $('sweep-progress').textContent = `${i + 1} / ${frequencies.length} · SILENCE`;
      $('progress').value = i + 1;
      // Reserve fade time in addition to the requested fully silent interval.
      if (!await waitSweep(gap * 1000 + 35, epoch)) return;
    }
    stopTx(); $('sweep-progress').textContent = 'COMPLETE';
  } catch (error) {
    if (tx === session) stopTx();
    say(error.message);
  }
}
function waitSweep(ms, epoch) {
  return new Promise(resolve => {
    sweepResolve = resolve;
    sweepTimer = setTimeout(() => { sweepTimer = null; sweepResolve = null; resolve(epoch === txEpoch); }, ms);
  });
}
function receiverSettings(context) {
  const target = $('target').value.trim() === '' ? null : number('target', 100, 20000);
  if (target != null) validateFrequency(target, context);
  return { target, tolerance: number('tolerance', 1, 2000) };
}
function clearMeasurements() {
  result = null;
  tracker.reset();
  for (const id of ['peak', 'difference', 'level', 'input-level', 'noise', 'snr']) $(id).textContent = '—';
  $('detected').innerHTML = '— <small>Hz</small>';
  $('detection-state').textContent = 'NO SIGNAL'; $('detection-state').dataset.state = 'NO SIGNAL';
  $('signal-quality').textContent = 'NONE · NO SIGNAL';
  $('raw-candidate').textContent = '—'; $('tracking-detail').textContent = '未取得';
  if (rx) $('rx-state').textContent = 'RX · SEARCHING';
  $('record').disabled = true;
}
function stopRx() {
  window.SignalData?.detachReceiver();
  rxEpoch++;
  cancelAnimationFrame(animation);
  const old = rx; rx = null;
  if (old) {
    old.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    old.source?.disconnect(); old.analyser?.disconnect(); old.silent?.disconnect();
    old.context.onstatechange = null;
    old.context.close().then(() => window.SignalData?.onRxStopped(old.context, old.stream)).catch(() => {});
  }
  clearMeasurements();
  $('rx-state').textContent = 'RX · STOPPED';
  $('rx-start').disabled = false; $('rx-stop').disabled = true;
  window.SignalData?.onRxStopped(old?.context, old?.stream);
  for (const id of ['wave', 'spectrum']) { const canvas = $(id); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }
}
function configureFFT() {
  if (!rx?.analyser) return;
  rx.analyser.fftSize = Number($('fft-size').value);
  spectrum = new Float32Array(rx.analyser.frequencyBinCount);
  samples = new Float32Array(rx.analyser.fftSize);
  clearMeasurements();
  $('rx-diagnostics').textContent = `sampleRate ${rx.context.sampleRate} Hz / FFT ${rx.analyser.fftSize} / 分解能 ${(rx.context.sampleRate / rx.analyser.fftSize).toFixed(3)} Hz（精度保証ではありません）`;
}
async function startRx() {
  if (rx) return;
  const epoch = ++rxEpoch;
  let session;
  try {
    if (!isSecureContext) throw new Error('マイクにはHTTPS（PCのlocalhostも可）が必要です。');
    if (!Audio || !navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではマイク/Web Audio APIを利用できません。');
    const context = new Audio();
    session = { context }; rx = session;
    $('rx-start').disabled = true; $('rx-stop').disabled = false;
    receiverSettings(context);
    await context.resume();
    if (epoch !== rxEpoch || document.hidden) return;
    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    const audio = {};
    for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) if (supported[key]) audio[key] = { ideal: false };
    say('マイクの許可を待っています…');
    let stream;
    let fallback = false;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: Object.keys(audio).length ? audio : true }); }
    catch (error) {
      if (error.name !== 'OverconstrainedError' && error.name !== 'TypeError') throw error;
      if (epoch !== rxEpoch) return;
      fallback = true;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (epoch !== rxEpoch || document.hidden) { stream.getTracks().forEach(t => t.stop()); return; }
    session.stream = stream;
    if (context.state !== 'running') throw new Error('マイク解析の音声コンテキストが中断されています。MIC STARTを押し直してください。');
    session.source = context.createMediaStreamSource(stream);
    session.analyser = context.createAnalyser();
    session.analyser.smoothingTimeConstant = 0;
    session.analyser.minDecibels = -160; session.analyser.maxDecibels = 0;
    // A zero-gain destination keeps the graph active without microphone monitoring.
    session.silent = context.createGain(); session.silent.gain.value = 0;
    session.source.connect(session.analyser).connect(session.silent).connect(context.destination);
    const track = stream.getAudioTracks()[0], settings = track.getSettings?.() || {};
    $('constraints').textContent = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].map(key => `${key}: 対応=${supported[key] ? 'あり' : 'なし'} / 要求=${supported[key] && !fallback ? 'false（ideal）' : '指定なし'} / 適用=${settings[key] === undefined ? '不明' : settings[key]}`).join('\n') + `\n制約なし再試行: ${fallback ? 'あり' : 'なし'}\ntrack sampleRate: ${settings.sampleRate ?? '不明'}\n解析 sampleRate: ${context.sampleRate}（ブラウザで再サンプルされる場合あり）`;
    track.onended = () => { if (rx === session) { stopRx(); say('マイク入力が終了しました。MIC STARTで再開してください。'); } };
    context.onstatechange = () => { if (rx === session && context.state !== 'running') { stopRx(); say('マイク解析が中断されました。MIC STARTで再開してください。'); } };
    configureFFT(); lastFrame = 0;
    $('rx-state').textContent = 'RX · LISTENING'; say('マイク受信中。別端末の音を測定し、結果を手動記録できます。');
    animation = requestAnimationFrame(frame);
  } catch (error) {
    if (epoch !== rxEpoch) return { cancelled: true };
    if (rx === session) stopRx();
    const reasons = { NotAllowedError: 'マイクの許可が拒否されました。ブラウザのサイト設定で許可してから再試行してください。', NotFoundError: 'マイクが見つかりません。', NotReadableError: 'マイクを利用できません。他のアプリによる使用や端末設定を確認してください。' };
    say(reasons[error.name] || error.message);
    return { error: reasons[error.name] || error.message, code: error.name || 'MIC_INIT' };
  }
}
const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
function frame(time) {
  if (!rx?.analyser) return;
  if (time - lastFrame >= 50 && (!window.SignalData?.isCapturing() || !$('receiver').hidden)) {
    lastFrame = time;
    try {
      const settings = receiverSettings(rx.context);
      rx.analyser.getFloatTimeDomainData(samples);
      spectrum.set(A.spectrumPCM(samples));
      const measurement = A.analyze(spectrum, samples, rx.context.sampleRate, rx.analyser.fftSize, settings.target, settings.tolerance);
      const stabilized = tracker.update(measurement, time);
      result = { ...measurement, ...stabilized, target: settings.target, sampleRate: rx.context.sampleRate, fftSize: rx.analyser.fftSize, measuredAt: Date.now() };
      $('detected').innerHTML = `${fmt(result.frequency)} <small>Hz</small>`;
      $('detection-state').textContent = result.lockState; $('detection-state').dataset.state = result.lockState;
      $('rx-state').textContent = `RX · ${result.lockState}`;
      $('signal-quality').textContent = `${result.quality} · ${result.state}`;
      $('raw-candidate').textContent = result.rawFrequency == null ? '未検出' : `${fmt(result.rawFrequency, 3)} Hz`;
      $('tracking-detail').textContent = `実効許容 ±${fmt(result.effectiveTolerance, 2)} Hz / 継続 ${Math.round(result.durationMs)} ms / 解析最大20fps・実時間判定`;
      $('peak').textContent = result.rawPeakFrequency == null ? '未検出' : `${fmt(result.rawPeakFrequency)} Hz`;
      $('difference').textContent = result.target == null ? 'ターゲット未設定' : `${fmt(result.hz)} / ${fmt(result.percent, 3)}%`;
      $('level-label').textContent = result.target == null ? 'ピーク強度 dBFS' : 'ターゲット付近 dBFS';
      $('level').textContent = fmt(result.level); $('noise').textContent = fmt(result.floor);
      $('input-level').textContent = fmt(result.inputLevel); $('snr').textContent = fmt(result.snr);
      $('record').disabled = rows.length >= 1000;
      drawWave(); drawSpectrum();
    } catch (error) { clearMeasurements(); say(error.message); }
  }
  animation = requestAnimationFrame(frame);
}
function canvasBase(id) {
  const canvas = $(id), w = Math.round(canvas.clientWidth), h = 140;
  if (!w) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== w * ratio || canvas.height !== h * ratio) { canvas.width = w * ratio; canvas.height = h * ratio; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#203248'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * 30); ctx.lineTo(w, i * 30); ctx.stroke(); }
  ctx.font = '10px system-ui'; ctx.fillStyle = '#8da6bc';
  return { ctx, w, h };
}
function drawWave() {
  const base = canvasBase('wave'); if (!base) return;
  const { ctx, w } = base;
  const count = Math.min(samples.length, Math.round(rx.context.sampleRate * 0.01));
  // Min/max per pixel avoids misleading high-frequency aliasing.
  ctx.strokeStyle = '#62e3d1'; ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const from = Math.floor(x / w * count), to = Math.min(count - 1, Math.ceil((x + 1) / w * count));
    let min = 1, max = -1;
    for (let i = from; i <= to; i++) { min = Math.min(min, samples[i]); max = Math.max(max, samples[i]); }
    ctx.moveTo(x, 60 - max * 50); ctx.lineTo(x, 60 - min * 50 + 0.5);
  }
  ctx.stroke(); ctx.fillText('0 ms', 4, 134); ctx.fillText('10 ms · ±1 FS', Math.max(4, w - 95), 134);
}
function drawSpectrum() {
  const base = canvasBase('spectrum'); if (!base) return;
  const { ctx, w } = base, resolution = rx.context.sampleRate / rx.analyser.fftSize;
  const lo = $('band').value === 'high' ? 15000 : 0, hi = Math.min(20000, rx.context.sampleRate / 2);
  if (hi <= lo) { ctx.fillText('このサンプルレートでは高周波帯域を表示できません', 5, 65); return; }
  const xAt = f => (f - lo) / (hi - lo) * w;
  ctx.strokeStyle = '#62e3d1'; ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const from = Math.max(0, Math.floor((lo + x / w * (hi - lo)) / resolution));
    const to = Math.min(spectrum.length - 1, Math.max(from, Math.ceil((lo + (x + 1) / w * (hi - lo)) / resolution)));
    let db = -120; for (let i = from; i <= to; i++) db = Math.max(db, spectrum[i]);
    const y = 120 - Math.max(0, Math.min(120, db + 120));
    if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (const [frequency, color] of [[result.rawPeakFrequency, '#ffd084'], [result.target, '#cf9cff']]) {
    if (frequency == null || frequency < lo || frequency > hi) continue;
    ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(xAt(frequency), 0); ctx.lineTo(xAt(frequency), 120); ctx.stroke();
  }
  ctx.fillText(`${lo / 1000} kHz`, 4, 134); ctx.fillText(`${hi / 1000} kHz`, w - 48, 134); ctx.fillText('0 / −120 dBFS', 5, 12);
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  document.querySelectorAll('.panel').forEach(panel => { panel.hidden = panel.id !== button.dataset.tab; });
  const frequency = ['generator', 'receiver', 'sweep'].includes(button.dataset.tab);
  $('frequency-nav').hidden = !frequency;
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', tab === button || (tab.dataset.tab === 'generator' && tab.closest('nav') && frequency) ? 'true' : 'false'));
});
for (const frequency of A.PRESETS) {
  const button = document.createElement('button'); button.textContent = `${frequency / 1000}k Hz`;
  button.addEventListener('click', () => setFrequency(frequency)); $('presets').append(button);
}
$('frequency').addEventListener('change', () => { try { setFrequency(number('frequency', 100, 20000)); } catch (error) { say(error.message); } });
$('frequency-slider').addEventListener('input', () => setFrequency(Number($('frequency-slider').value)));
document.querySelectorAll('[data-delta]').forEach(button => button.addEventListener('click', () => {
  try { setFrequency(Math.max(100, Math.min(20000, number('frequency', 100, 20000) + Number(button.dataset.delta)))); } catch (error) { say(error.message); }
}));
$('volume').addEventListener('input', () => {
  $('volume-display').textContent = `${$('volume').value} / 100`;
  if (tx?.gain) {
    const now = tx.context.currentTime;
    tx.gain.gain.cancelScheduledValues(now);
    tx.gain.gain.setValueAtTime(tx.gain.gain.value, now);
    tx.gain.gain.setTargetAtTime(volume(), now, 0.02);
  }
});
$('tx-start').addEventListener('click', () => { try { startTx('tone', [number('frequency', 100, 20000)]); } catch (error) { say(error.message); } });
$('tx-stop').addEventListener('click', stopTx);
$('sweep-start').addEventListener('click', () => {
  try {
    const frequencies = $('sweep-mode').value === 'preset' ? A.PRESETS : A.sweepRange(number('sweep-from', 100, 20000), number('sweep-to', 100, 20000), number('sweep-step', 1, 20000));
    startTx('sweep', frequencies, number('duration', 0.1, 30, false), number('gap', 0, 30, false));
  } catch (error) { say(error.message); }
});
$('sweep-stop').addEventListener('click', stopTx);
$('sweep-mode').addEventListener('change', () => { $('range-fields').hidden = $('sweep-mode').value !== 'range'; });
$('rx-start').addEventListener('click', startRx); $('rx-stop').addEventListener('click', stopRx);
$('fft-size').addEventListener('change', configureFFT);
for (const id of ['target', 'tolerance']) $(id).addEventListener('input', clearMeasurements);
for (const id of ['stabilization', 'median-window', 'lock-time', 'loss-time']) $(id).addEventListener('change', () => {
  clearMeasurements();
  try {
    tracker.configure({ enabled: $('stabilization').checked, windowSize: Number($('median-window').value),
      lockMs: number('lock-time', 100, 1000), lossMs: number('loss-time', 100, 2000) });
    $('frequency-label').textContent = tracker.options.enabled ? 'STABLE FREQUENCY' : 'RAW FREQUENCY · 安定化OFF';
    say('LABの安定化設定を変更しました。受信ロックをリセットします。');
  } catch (error) {
    $('stabilization').checked = tracker.options.enabled;
    $('median-window').value = tracker.options.windowSize;
    $('lock-time').value = tracker.options.lockMs;
    $('loss-time').value = tracker.options.lossMs;
    say(error.message);
  }
});
$('record').addEventListener('click', () => {
  if (!result || !rx || rows.length >= 1000 || Date.now() - result.measuredAt > 500) return say('新しい測定結果がありません。');
  const row = A.logRow(result, result.measuredAt);
  rows.push(row);
  const tr = document.createElement('tr');
  for (const value of [row[0], row[1], row[10] || '未検出', row[11] || '未検出', row[12], row[13], row[14]]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
  $('log-rows').prepend(tr); $('log-count').textContent = rows.length; $('csv').disabled = false;
  if (rows.length >= 1000) $('record').disabled = true;
  say(`測定結果を記録しました（${rows.length}件）。`);
});
$('csv').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([A.csv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `signal-lab-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function suspendAll() { const active = !!tx || !!rx; stopTx(); stopRx(); if (active) say('背景移行または割り込みで停止しました。復帰後にSTARTを押してください。'); }
document.addEventListener('visibilitychange', () => { if (document.hidden) suspendAll(); });
window.addEventListener('pagehide', suspendAll);
showFrequency(1000);
