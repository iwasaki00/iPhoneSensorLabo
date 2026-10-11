'use strict';
const dataField = id => document.getElementById(id), D = SignalDiagnostics;
let dataCapture = null, dataStarting = false, dataEpoch = 0, nextMessageId = 0, dataTimer = null, dataLastSnapshot = null;
const communicationLog = new D.Recorder(navigator.userAgent);
const RX_NAMES = { STOPPED: '停止中', STARTING: 'マイク準備中', SEARCHING: '受信待機中', SIGNAL: '信号検出中', PREAMBLE: '同期検出中', SYNCING: '同期検出中', RECEIVING: 'データ受信中', COMPLETE: '受信成功', FAILED: '受信失敗', TIMEOUT: '受信失敗', ERROR: 'エラー' };
function dataSettings() { return { bitMs: Number(dataField('data-bit-ms').value), zero: 1200, one: 2200 }; }
function setDataState(id, state, labels) { const field = dataField(id); field.dataset.state = state; field.textContent = labels[state] || state; }
function rxState(state) { setDataState('data-rx-state', state, RX_NAMES); $('rx-state').textContent = `RX · ${RX_NAMES[state] || state}`; }
function dataPreview() {
  try {
    const frame = SignalFrame.encode(dataField('data-text').value, nextMessageId);
    dataField('data-tx-info').textContent = `UTF-8 ${frame.payloadBytes}/32バイト · ${frame.bits.length}bit · 約${(frame.bits.length * dataSettings().bitMs / 1000 + 0.2).toFixed(1)}秒 · 1200/2200Hz`;
    return frame;
  } catch (error) { dataField('data-tx-info').textContent = error.message; return null; }
}
function updateDataButtons() {
  dataField('data-start').disabled = !!tx || !dataPreview(); dataField('test-tone').disabled = !!tx;
  dataField('data-stop').disabled = !['data', 'test-tone'].includes(tx?.mode);
  dataField('data-text').disabled = tx?.mode === 'data';
  dataField('data-bit-ms').disabled = !!dataCapture || dataStarting || !!tx;
  dataField('data-rx-start').disabled = !!dataCapture || dataStarting;
  dataField('data-rx-stop').disabled = !dataCapture && !dataStarting;
  dataField('data-retry').disabled = dataStarting;
}
function onDataTxStopped(state) {
  clearInterval(dataTimer); dataTimer = null;
  setDataState('data-tx-state', state, { STOPPED: '送信中断', INTERRUPTED: '送信中断', COMPLETE: '送信完了（音の出力が終了）' });
  dataField('data-tx-remaining').textContent = state === 'COMPLETE' ? '残り0秒 · 相手の受信結果を確認してください。' : '送信を停止しました。相手の受信成功を示すものではありません。';
  if (state === 'COMPLETE') dataField('data-tx-progress').value = 1;
  say(state === 'COMPLETE' ? '音の出力が終了しました。相手の画面で受信結果を確認してください。' : '送信を中断しました。再送する場合は相手の受信待機を確認してください。');
  communicationLog.record({ mode: 'tx', state, bitMs: dataSettings().bitMs }); renderLogCount();
}
async function startDataTx(testTone = false) {
  if (tx) return;
  const frame = testTone ? null : dataPreview(); if (!testTone && !frame) return;
  let session;
  try {
    // Create/resume directly from the user gesture. No network is involved.
    const context = new Audio(); session = { context, mode: testTone ? 'test-tone' : 'data', gain: null, bufferSource: null }; tx = session;
    updateTxButtons(); setDataState('data-tx-state', 'STARTING', { STARTING: '音声準備中' });
    await context.resume();
    if (tx !== session) return;
    if (document.hidden) { stopTx(); return; }
    if (context.state !== 'running') throw new Error('音声開始が制限されています。送信ボタンで再試行してください。');
    // Two sustained carriers, never a preamble or communication frame.
    const bits = testTone ? [...Array(10).fill(0), ...Array(10).fill(1)] : frame.bits;
    const wave = SignalFSK.modulate(bits, { ...dataSettings(), bitMs: testTone ? 80 : dataSettings().bitMs, sampleRate: context.sampleRate });
    const buffer = context.createBuffer(1, wave.pcm.length, context.sampleRate); buffer.copyToChannel(wave.pcm, 0);
    const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer; gain.gain.value = volume();
    session.bufferSource = source; session.gain = gain; source.connect(gain).connect(context.destination);
    source.onended = () => { if (tx !== session) return; source.disconnect(); gain.disconnect(); session.bufferSource = null; session.finishState = 'COMPLETE'; stopTx(); };
    context.onstatechange = () => { if (tx === session && context.state !== 'running') { session.finishState = 'INTERRUPTED'; stopTx(); say('送信が中断されました。画面を開いて再送信してください。'); } };
    source.start(); if (!testTone) nextMessageId = (nextMessageId + 1) & 255;
    const started = context.currentTime, duration = buffer.duration;
    const progress = () => { const elapsed = context.currentTime - started; dataField('data-tx-progress').value = Math.min(1, elapsed / duration); dataField('data-tx-remaining').textContent = `残り約${Math.max(0, duration - elapsed).toFixed(1)}秒${testTone ? ' · テスト音（文字送信ではありません）' : ''}`; };
    progress(); dataTimer = setInterval(progress, 200); // Display only, never bit timing.
    setDataState('data-tx-state', 'TRANSMITTING', { TRANSMITTING: testTone ? 'テスト音を送信中' : '送信中' }); $('tx-state').textContent = testTone ? 'TX · TEST TONE' : 'TX · DATA';
    communicationLog.record({ mode: session.mode, state: 'TRANSMITTING', sampleRate: context.sampleRate, context: context.state, bitMs: testTone ? 80 : dataSettings().bitMs, payloadBytes: frame?.payloadBytes }); renderLogCount();
    say('低音量で送信中。相手の準備・受信結果は相手の画面で確認してください。');
  } catch (error) { if (tx === session) stopTx(); setDataState('data-tx-state', 'ERROR', { ERROR: `エラー · ${error.message}` }); communicationLog.record({ mode: 'tx', state: 'ERROR' }, 'UNKNOWN'); renderLogCount(); }
}
function renderLogCount() { dataField('communication-log-count').textContent = `${communicationLog.entries.length}件（最大250件・本文と音声を含みません）`; dataField('communication-log-preview').textContent = communicationLog.entries.slice(-5).map(e => `${e.timestamp} · ${e.mode} · ${e.state} · ${e.sampleRate ?? '—'}Hz · PCM ${e.packets} · CRC ${e.crc}${e.error ? ' · ' + e.error.stage + ' / ' + e.error.code : ''}`).join('\n') || '未記録'; }
function captureSnapshot(capture = dataCapture) {
  if (!capture) return { ...(dataLastSnapshot || {}), mode: 'rx', state: dataField('data-rx-state').dataset.state, worklet: dataStarting ? 'LOADING' : dataLastSnapshot?.worklet || 'STOPPED' };
  const session = capture.session, track = session.stream?.getAudioTracks()[0];
  return { mode: 'rx', state: dataField('data-rx-state').dataset.state, sampleRate: session.context.sampleRate, bitMs: dataSettings().bitMs,
    permission: '許可', stream: track?.readyState || 'なし', context: session.context.state, worklet: capture.worklet,
    packets: capture.packets, samples: capture.samples, lastSampleAt: capture.lastSampleAt, rmsDbfs: capture.rmsDbfs, gaps: capture.gaps,
    energy: capture.decoder.diagnostic.energy, frame: capture.decoder.diagnostic, settings: track?.getSettings?.() || {}, constraints: $('constraints').textContent };
}
function reportDataError(code, snapshot = captureSnapshot()) {
  const entry = communicationLog.record(snapshot, code); dataField('data-error').textContent = entry.error.advice; dataField('data-last-error').textContent = `直近エラー：${entry.error.code} / ${entry.error.stage} / ${entry.timestamp}`; renderLogCount();
}
function renderDiagnosis(capture = dataCapture) {
  const s = captureSnapshot(capture), now = performance.now(), stale = capture && now - (capture.lastArrival ?? capture.started) > 2000;
  const f = s.frame || {}, e = capture ? s.energy || {} : {}, level = capture && Number.isFinite(s.rmsDbfs) ? `${s.rmsDbfs.toFixed(1)} dBFS` : '未取得';
  dataField('data-input-level').textContent = level;
  if (capture && e.valid && !stale) capture.toneSeen[e.bit] = new Date().toISOString();
  for (const [bit, frequency] of [[0, 1200], [1, 2200]]) {
    const current = !stale && e.valid && e.bit === bit, seen = capture?.toneSeen[bit];
    dataField(`data-test-${frequency}`).textContent = current ? `${frequency}Hz検出` : seen ? `直近検出 ${seen.slice(11, 19)} UTC（現在未検出）` : `${frequency}Hz未検出`;
  }
  dataField('data-signal').textContent = !capture ? '停止中' : stale ? 'サンプル到着停止' : !s.packets ? 'サンプル待機' : s.rmsDbfs < -65 ? '無音 / 微弱' : e.valid ? `通信周波数 · 推定BIT ${e.bit}` : '音あり · 通信周波数未検出';
  const steps = [
    [capture ? stale || s.context !== 'running' || capture.worklet !== 'READY' ? 'エラー' : s.packets ? '正常' : '処理中' : dataStarting ? '処理中' : dataField('data-rx-state').dataset.state === 'ERROR' ? 'エラー' : '未開始', `許可=${s.permission || '未取得'} / MediaStream=${s.stream || 'なし'} / Context=${s.context || '未開始'} / Worklet=${s.worklet} / PCM=${s.packets || 0}チャンク`],
    [!s.packets ? '未開始' : stale ? 'エラー' : s.rmsDbfs < -65 ? '警告' : '正常', `入力=${level} / 直近PCM=${s.lastSampleAt || '未取得'} / 累計${s.samples || 0}sample / 欠落${s.gaps || 0}回`],
    [!s.packets ? '未開始' : e.valid ? '正常' : '警告', `1200Hz=${e.e0?.toExponential(2) ?? '未取得'} / 2200Hz=${e.e1?.toExponential(2) ?? '未取得'} / 強度比=${e.ratio?.toFixed(1) ?? '—'} / 信号成分比=${e.purity?.toFixed(2) ?? '—'} / 推定BIT=${e.valid ? e.bit : '未判定'}`],
    [!s.packets ? '未開始' : f.timing ? '正常' : f.preamble ? '処理中' : '警告', `PREAMBLE=${f.preamble ? '検出' : '未検出'} / SYNC=${f.sync ? '検出' : '未検出'} / タイミング=${f.timing ? '同期' : '未同期'} / 復調${f.bits || 0}bit`],
    [f.crc === 'PASS' ? '正常' : ['FAILED', 'TIMEOUT'].includes(s.state) ? 'エラー' : f.header ? '処理中' : '未開始', `ヘッダー=${f.header ? '検出' : '未検出'} / VERSION=${f.version ?? '未判定'} / LENGTH=${f.length ?? '未判定'} / 受信${f.bytes || 0}byte / CRC=${f.crc || 'NOT CHECKED'} / UTF-8=${f.utf8 || '未復元'}`]
  ];
  steps.forEach(([state, detail], i) => { dataField(`diag-state-${i + 1}`).textContent = !capture && i > 0 ? '未開始' : state; dataField(`diag-step-${i + 1}`).textContent = !capture && i > 0 && s.packets ? `前回：${detail}` : detail; });
  dataField('diagnostic-live').textContent = JSON.stringify(D.safeSnapshot(s), null, 2);
  const code = D.inputAdvice(s, stale);
  if (stale) rxState('ERROR');
  if (capture && !['COMPLETE', 'FAILED', 'TIMEOUT', 'ERROR'].includes(s.state)) {
    if (stale) rxState('ERROR');
    else if (s.packets && !capture.decoder.receiving && !capture.decoder.pending) rxState(f.preamble && !f.sync ? 'PREAMBLE' : e.valid ? 'SIGNAL' : 'SEARCHING');
    dataField('data-error').textContent = code ? D.HELP[code][1] : '信号を解析中です。受信を停止せずに待ってください。';
  }
  if (capture && code === 'PCM_MISSING' && stale && !capture.staleLogged) { capture.staleLogged = true; reportDataError(code, s); }
  if (capture && now - capture.loggedAt > 1000) { capture.loggedAt = now; communicationLog.record(s); renderLogCount(); }
  if (capture?.decoder.receiving) { const r = capture.decoder.receiving; dataField('data-rx-progress').value = r.expected ? r.bits.length / r.expected : 0; dataField('data-rx-progress-text').textContent = `${32 + r.bits.length}bit · ${r.expected ? r.expected + 32 : '長さ判定中'} / ヘッダーを含む`; }
}
function detachDataReceiver() {
  dataEpoch++; dataStarting = false;
  const capture = dataCapture; dataCapture = null;
  if (capture) {
    clearInterval(capture.timer); capture.node.port.onmessage = null; capture.node.removeEventListener('processorerror', capture.onError);
    try { capture.source.disconnect(capture.node); capture.node.port.postMessage('stop'); capture.node.port.close(); capture.node.disconnect(); } catch {}
    capture.decoder.finish(); dataLastSnapshot = { ...captureSnapshot(capture), state: 'STOPPED', worklet: 'STOPPED', energy: null }; communicationLog.record(dataLastSnapshot);
  }
  rxState('STOPPED'); dataField('data-rx-progress').value = 0; dataField('data-rx-progress-text').textContent = '停止中'; updateDataButtons(); renderLogCount();
}
function onDataRxStopped(context, stream) {
  if (dataCapture || dataStarting || rx) return;
  dataLastSnapshot = { ...(dataLastSnapshot || {}), context: context?.state || '未開始', stream: stream?.getAudioTracks()[0]?.readyState || 'なし', worklet: 'STOPPED' };
  if (dataField('data-rx-state').dataset.state === 'STOPPED') dataField('data-error').textContent = '受信を停止しました。再開するには「受信を開始」を押してください。';
  renderDiagnosis();
}
async function startDataReceiver() {
  if (dataCapture || dataStarting) return;
  const epoch = ++dataEpoch, wasListening = !!rx; let stage = 'MIC_INIT';
  dataStarting = true; dataLastSnapshot = null; updateDataButtons(); rxState('STARTING');
  dataField('data-error').textContent = 'マイクと音声処理を準備しています。'; dataField('data-rx-progress').value = 0; dataField('data-rx-progress-text').textContent = 'フレーム未検出';
  dataField('data-rx-text').textContent = '未受信'; dataField('data-crc').textContent = 'NOT CHECKED'; dataField('data-rx-bits').textContent = '—'; renderDiagnosis();
  try {
    if (!window.AudioWorkletNode) { stage = 'WORKLET_INIT'; throw new Error('AudioWorklet非対応'); }
    if (!rx) {
      const response = await startRx();
      if (response?.cancelled) return;
      // Failure cleanup advances dataEpoch: report failure before cancellation check.
      if (response?.error) { stage = response.code === 'NotAllowedError' ? 'MIC_PERMISSION' : 'MIC_INIT'; throw new Error(response.error); }
    }
    if (epoch !== dataEpoch) return;
    if (!rx?.source) throw new Error('マイク初期化未完了');
    const session = rx; stage = 'WORKLET_INIT';
    if (!session.context.audioWorklet) throw new Error('AudioWorklet非対応');
    await session.context.audioWorklet.addModule('pcm-worklet.js');
    if (epoch !== dataEpoch || rx !== session) return;
    if (document.hidden) { stopRx(); return; }
    const decoder = new SignalFSK.Decoder({ ...dataSettings(), sampleRate: session.context.sampleRate }, event => {
      rxState(event.state); dataField('data-crc').textContent = event.crc ?? 'NOT CHECKED';
      dataField('data-rx-text').textContent = event.state === 'COMPLETE' ? event.text === '' ? '（空文字列）' : event.text : '未受信';
      dataField('data-rx-bits').textContent = event.bits?.join('') || '—';
      if (event.state === 'COMPLETE') { dataField('data-rx-progress').value = 1; dataField('data-rx-progress-text').textContent = `受信完了 · ${event.payloadBytes}バイト`; dataField('data-error').textContent = 'CRC一致、UTF-8復元完了。次の送信も受信できます。'; }
      if (['FAILED', 'TIMEOUT'].includes(event.state)) reportDataError(D.frameError(event.reason));
      communicationLog.record(captureSnapshot()); renderLogCount();
    });
    const node = new AudioWorkletNode(session.context, 'signal-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const capture = { node, source: session.source, session, decoder, expectedSample: null, packets: 0, samples: 0, gaps: 0, toneSeen: { 0: null, 1: null }, lastArrival: null, lastSampleAt: null, started: performance.now(), loggedAt: 0, rmsDbfs: null, worklet: 'READY' }; dataCapture = capture;
    capture.onError = () => { if (dataCapture !== capture) return; capture.worklet = 'ERROR'; const snapshot = captureSnapshot(); stopRx(); rxState('ERROR'); reportDataError('WORKLET_PROCESSOR', snapshot); renderDiagnosis(); };
    node.addEventListener('processorerror', capture.onError);
    node.port.onmessage = event => {
      if (dataCapture !== capture) return;
      const { pcm, startSample } = event.data || {};
      if (!(pcm instanceof Float32Array) || !pcm.length || pcm.length > 8192 || !Number.isSafeInteger(startSample) || startSample < 0 || pcm.some(n => !Number.isFinite(n))) { const snapshot = captureSnapshot(); stopRx(); rxState('ERROR'); reportDataError('PCM_FORMAT', snapshot); renderDiagnosis(); return; }
      if (capture.expectedSample != null && startSample !== capture.expectedSample) { capture.gaps++; decoder.fail('PCMサンプル欠落。同期を再探索します'); decoder.reset(); reportDataError('PCM_GAP'); }
      capture.expectedSample = startSample + pcm.length; capture.packets++; capture.samples += pcm.length; capture.lastArrival = performance.now(); capture.lastSampleAt = new Date().toISOString(); capture.staleLogged = false;
      const rms = Math.sqrt(pcm.reduce((sum, n) => sum + n * n, 0) / pcm.length); capture.rmsDbfs = rms > 0 ? 20 * Math.log10(rms) : -160;
      if (dataField('data-rx-state').dataset.state === 'STARTING' || dataField('data-rx-state').dataset.state === 'ERROR') rxState('SEARCHING');
      decoder.push(pcm);
    };
    session.source.connect(node).connect(session.context.destination); clearMeasurements();
    capture.timer = setInterval(() => renderDiagnosis(capture), 200); // DOM/log updates capped at 5Hz.
    dataField('data-error').textContent = '音声処理の準備完了。最初の音声サンプルを確認中です。';
    communicationLog.record(captureSnapshot()); renderDiagnosis(capture);
  } catch (error) {
    if (epoch !== dataEpoch && !['MIC_INIT', 'MIC_PERMISSION'].includes(stage)) return;
    if (dataCapture) detachDataReceiver();
    if (!wasListening && rx) stopRx(); dataStarting = false; rxState('ERROR');
    dataLastSnapshot = { mode: 'rx', state: 'ERROR', permission: stage === 'MIC_PERMISSION' ? '拒否' : '不明', worklet: stage === 'WORKLET_INIT' ? 'ERROR' : '未開始' };
    reportDataError(stage, dataLastSnapshot); renderDiagnosis();
  } finally { if (epoch === dataEpoch) dataStarting = false; updateDataButtons(); }
}
async function copyDiagnosticLog() {
  const text = JSON.stringify(communicationLog.export(), null, 2);
  try { await navigator.clipboard.writeText(text); dataField('log-copy-state').textContent = '診断情報をコピーしました。'; }
  catch { dataField('log-copy-fallback').hidden = false; dataField('log-copy-fallback').value = text; dataField('log-copy-fallback').select(); dataField('log-copy-state').textContent = 'この欄を選択してコピーしてください。'; }
}
window.SignalData = { updateButtons: updateDataButtons, onTxStopped: onDataTxStopped, detachReceiver: detachDataReceiver, onRxStopped: onDataRxStopped, isCapturing: () => !!dataCapture };
dataField('data-text').addEventListener('input', updateDataButtons); dataField('data-bit-ms').addEventListener('change', updateDataButtons);
dataField('data-start').addEventListener('click', () => startDataTx()); dataField('test-tone').addEventListener('click', () => startDataTx(true)); dataField('data-stop').addEventListener('click', stopTx);
dataField('data-rx-start').addEventListener('click', startDataReceiver); dataField('data-rx-stop').addEventListener('click', stopRx);
dataField('data-retry').addEventListener('click', () => { stopRx(); startDataReceiver(); });
document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => { dataField('data-send').hidden = button.dataset.role !== 'send'; dataField('data-receive').hidden = button.dataset.role !== 'receive'; document.querySelectorAll('[data-role]').forEach(tab => tab.setAttribute('aria-selected', tab === button ? 'true' : 'false')); }));
dataField('copy-url').addEventListener('click', async () => { const url = new URL(location.href); url.hash = ''; dataField('public-url').value = url.href; dataField('public-url').hidden = false; try { await navigator.clipboard.writeText(url.href); dataField('url-copy-state').textContent = 'ページURLをコピーしました。'; } catch { dataField('public-url').select(); dataField('url-copy-state').textContent = 'URL欄を選択してコピーしてください。'; } });
dataField('copy-diagnostics').addEventListener('click', copyDiagnosticLog);
dataField('data-volume').addEventListener('input', () => { $('volume').value = dataField('data-volume').value; $('volume').dispatchEvent(new Event('input')); });
$('volume').addEventListener('input', () => { dataField('data-volume').value = $('volume').value; dataField('data-volume-display').textContent = `${$('volume').value} / 100`; });
dataField('save-diagnostics').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(communicationLog.export(), null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'signal-lab-diagnostics.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
updateDataButtons(); renderDiagnosis(); renderLogCount();
