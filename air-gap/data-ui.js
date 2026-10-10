'use strict';
const dataField = id => document.getElementById(id);
let dataCapture = null, dataStarting = false, dataEpoch = 0, nextMessageId = 0;
function dataSettings() { return { bitMs: Number(dataField('data-bit-ms').value), zero: 1200, one: 2200 }; }
function dataPreview() {
  try {
    const frame = SignalFrame.encode(dataField('data-text').value, nextMessageId);
    dataField('data-tx-info').textContent = `UTF-8 ${frame.payloadBytes}/32 bytes · ${frame.bits.length} bits · ${(frame.bits.length * dataSettings().bitMs / 1000).toFixed(2)}秒 + 末尾無音0.2秒 · 0=1200Hz / 1=2200Hz`;
    return frame;
  } catch (error) { dataField('data-tx-info').textContent = error.message; return null; }
}
function updateDataButtons() {
  dataField('data-start').disabled = !!tx || !dataPreview();
  dataField('data-stop').disabled = tx?.mode !== 'data';
  dataField('data-text').disabled = tx?.mode === 'data';
  dataField('data-bit-ms').disabled = !!dataCapture || dataStarting || tx?.mode === 'data';
  dataField('data-rx-start').disabled = !!dataCapture || dataStarting;
  dataField('data-rx-stop').disabled = !dataCapture && !dataStarting;
}
function onDataTxStopped(state) { dataField('data-tx-state').textContent = state; }
async function startDataTx() {
  if (tx) return;
  const frame = dataPreview(); if (!frame) return;
  let session;
  try {
    const context = new Audio(); session = { context, mode: 'data', gain: null, bufferSource: null }; tx = session;
    updateTxButtons(); dataField('data-tx-state').textContent = 'STARTING';
    await context.resume();
    if (tx !== session || document.hidden) return;
    if (context.state !== 'running') throw new Error('音声開始が制限されています。STARTで再試行してください。');
    const wave = SignalFSK.modulate(frame.bits, { ...dataSettings(), sampleRate: context.sampleRate });
    const buffer = context.createBuffer(1, wave.pcm.length, context.sampleRate); buffer.copyToChannel(wave.pcm, 0);
    const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer; gain.gain.value = volume();
    session.bufferSource = source; session.gain = gain; source.connect(gain).connect(context.destination);
    source.onended = () => {
      if (tx !== session) return;
      source.disconnect(); gain.disconnect(); session.bufferSource = null; session.finishState = 'COMPLETE'; stopTx();
    };
    context.onstatechange = () => { if (tx === session && context.state !== 'running') { session.finishState = 'INTERRUPTED'; stopTx(); say('データ送信が中断されました。STARTで再開してください。'); } };
    source.start(); nextMessageId = (nextMessageId + 1) & 255;
    dataField('data-tx-state').textContent = 'TRANSMITTING'; $('tx-state').textContent = 'TX · DATA';
    say('2-FSK音声を送信中。低音量で試してください。');
  } catch (error) { if (tx === session) stopTx(); dataField('data-tx-state').textContent = `FAILED · ${error.message}`; say(error.message); }
}
function detachDataReceiver() {
  dataEpoch++; dataStarting = false;
  const capture = dataCapture; dataCapture = null;
  if (capture) {
    try { capture.source.disconnect(capture.node); } catch {}
    capture.node.port.onmessage = null; capture.node.port.postMessage('stop'); capture.node.port.close(); capture.node.disconnect(); capture.decoder.finish();
  }
  dataField('data-rx-state').textContent = 'STOPPED'; updateDataButtons();
}
async function startDataReceiver() {
  if (dataCapture || dataStarting) return;
  const epoch = ++dataEpoch, wasListening = !!rx;
  dataStarting = true; updateDataButtons(); dataField('data-rx-state').textContent = 'STARTING / PERMISSION';
  try {
    if (!window.AudioWorkletNode) throw new Error('AudioWorkletに対応していません。対応ブラウザのHTTPSで開いてください。');
    if (!rx) await startRx();
    if (epoch !== dataEpoch) return;
    if (!rx?.source) throw new Error($('message').textContent);
    const session = rx;
    if (!session.context.audioWorklet) throw new Error('AudioWorkletを利用できません。');
    await session.context.audioWorklet.addModule('pcm-worklet.js');
    if (epoch !== dataEpoch || rx !== session || document.hidden) return;
    dataField('data-rx-text').textContent = '未受信'; dataField('data-crc').textContent = 'NOT CHECKED'; dataField('data-rx-bits').textContent = '—';
    const decoder = new SignalFSK.Decoder({ ...dataSettings(), sampleRate: session.context.sampleRate }, event => {
      dataField('data-rx-state').textContent = `${event.state}${event.reason ? ' · ' + event.reason : ''}`;
      dataField('data-crc').textContent = event.crc ?? 'NOT CHECKED';
      dataField('data-rx-text').textContent = event.state === 'COMPLETE' ? event.text === '' ? '（空文字列）' : event.text : '未受信';
      dataField('data-rx-bits').textContent = event.bits?.join('') || '—';
    });
    const node = new AudioWorkletNode(session.context, 'signal-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    const capture = { node, source: session.source, decoder, expectedSample: null, displayTime: 0 }; dataCapture = capture;
    node.port.onmessage = event => {
      if (dataCapture !== capture) return;
      const { pcm, startSample } = event.data;
      if (capture.expectedSample != null && startSample !== capture.expectedSample) { decoder.fail('PCMサンプル欠落。同期を再探索します'); decoder.reset(); }
      capture.expectedSample = startSample + pcm.length; decoder.push(pcm);
      if (performance.now() - capture.displayTime > 200 && decoder.receiving) {
        capture.displayTime = performance.now(); dataField('data-rx-bits').textContent = SignalFrame.bits([...SignalFrame.SPEC.preamble, ...SignalFrame.SPEC.sync]).concat(decoder.receiving.bits).join('');
      }
    };
    session.source.connect(node).connect(session.context.destination);
    dataField('data-rx-state').textContent = `SEARCHING · ${session.context.sampleRate}Hz · 1200/2200Hz · ${dataSettings().bitMs}ms`;
  } catch (error) {
    if (dataCapture) detachDataReceiver();
    if (!wasListening && rx) stopRx(); dataField('data-rx-state').textContent = `FAILED · ${error.message}`;
  } finally { if (epoch === dataEpoch) dataStarting = false; updateDataButtons(); }
}
window.SignalData = { updateButtons: updateDataButtons, onTxStopped: onDataTxStopped, detachReceiver: detachDataReceiver };
dataField('data-text').addEventListener('input', updateDataButtons); dataField('data-bit-ms').addEventListener('change', updateDataButtons);
dataField('data-start').addEventListener('click', startDataTx); dataField('data-stop').addEventListener('click', stopTx);
dataField('data-rx-start').addEventListener('click', startDataReceiver); dataField('data-rx-stop').addEventListener('click', stopRx);
updateDataButtons();
