'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const F = require('./frame.js'), K = require('./fsk.js'), S = require('./simulator.js'), D = require('./diagnostics.js');
for (const sampleRate of [44100, 48000]) for (const text of ['HELLO', 'TEST123', 'こんにちは']) for (const seed of [11, 135]) test(`random small PCM chunks ${sampleRate}/${text}/${seed}`, () => {
  const random = S.random(seed), frame = F.encode(text, seed), wave = K.modulate(frame.bits, { sampleRate, amplitude: 0.003, phase: random() * Math.PI * 2 });
  const offset = Math.round(random() * sampleRate * 0.6), pcm = new Float32Array(offset + wave.pcm.length); pcm.set(wave.pcm, offset);
  const decoder = new K.Decoder({ sampleRate });
  for (let position = 0; position < pcm.length;) { const length = 1 + Math.floor(random() * 733); decoder.push(pcm.subarray(position, position + length)); position += length; }
  decoder.finish(); assert.equal(decoder.completed, 1); assert.equal(decoder.events.find(e => e.state === 'COMPLETE').text, text);
  assert.equal(decoder.diagnostic.crc, 'PASS'); assert.equal(decoder.diagnostic.header, true); assert.equal(decoder.diagnostic.length, frame.payloadBytes);
});
test('only test tones never become a frame', () => {
  const decoder = new K.Decoder(); decoder.push(K.modulate([...Array(10).fill(0), ...Array(10).fill(1)], { amplitude: 0.08 }).pcm); decoder.finish();
  assert.equal(decoder.completed, 0); assert.equal(decoder.diagnostic.preamble, false);
});
test('preamble and incorrect sync are independently diagnosed', () => {
  const bytes = F.encode('HELLO').bytes.slice(); bytes[3] ^= 1;
  const decoder = new K.Decoder(); decoder.push(K.modulate(F.bits(bytes), { amplitude: 0.08 }).pcm); decoder.finish();
  assert.equal(decoder.diagnostic.preamble, true); assert.equal(decoder.diagnostic.sync, false); assert.equal(decoder.completed, 0);
});
test('CRC corruption keeps the frame stage and does not emit text', () => {
  const bytes = F.encode('HELLO').bytes.slice(); bytes[8] ^= 1;
  const decoder = new K.Decoder(); decoder.push(K.modulate(F.bits(bytes), { amplitude: 0.08 }).pcm);
  assert.equal(decoder.diagnostic.header, true); assert.equal(decoder.diagnostic.crc, 'FAIL'); assert.equal(decoder.completed, 0);
  assert.equal(D.frameError(decoder.events.at(-1).reason), 'FRAME_CRC');
});
test('valid CRC with invalid UTF-8 is distinguished from CRC failure', () => {
  const bytes = F.encode('A').bytes.slice(); bytes[7] = 255; const crc = F.crc16(bytes.subarray(4, 8)); bytes[8] = crc >> 8; bytes[9] = crc & 255;
  const decoder = new K.Decoder(); decoder.push(K.modulate(F.bits(bytes), { amplitude: 0.08 }).pcm);
  assert.equal(decoder.completed, 0); assert.equal(decoder.diagnostic.crc, 'PASS'); assert.equal(decoder.diagnostic.utf8, '復元失敗'); assert.equal(D.frameError(decoder.events.at(-1).reason), 'FRAME_UTF8');
});
test('unfinished frame has bounded diagnostic counters and timeout', () => {
  const decoder = new K.Decoder(); decoder.push(K.modulate(F.encode('HELLO').bits, { amplitude: 0.08 }).pcm.subarray(0, 48000 * 4)); decoder.finish();
  assert.equal(decoder.state, 'TIMEOUT'); assert.equal(decoder.diagnostic.timing, false); assert.ok(decoder.diagnostic.bits < 112); assert.equal(D.frameError(decoder.events.at(-1).reason), 'FRAME_TIMEOUT');
});
test('missing PCM, silence, unrelated sound and unsynchronized carriers have different advice', () => {
  assert.equal(D.inputAdvice({ packets: 0 }), 'PCM_MISSING'); assert.equal(D.inputAdvice({ packets: 1, rmsDbfs: -90 }), 'AUDIO_SILENCE');
  assert.equal(D.inputAdvice({ packets: 1, rmsDbfs: -30, energy: { valid: false } }), 'FSK_NOT_FOUND');
  assert.equal(D.inputAdvice({ packets: 1, rmsDbfs: -30, energy: { valid: true }, frame: { sync: false } }), 'SYNC_NOT_FOUND');
  assert.equal(D.inputAdvice({ packets: 2, rmsDbfs: -30, energy: { valid: true }, frame: { sync: true } }), null);
});
test('diagnostic logs exclude message text, bit arrays, PCM and device IDs', () => {
  const recorder = new D.Recorder('synthetic browser', () => 42); recorder.record({ text: 'SECRET', receivedText: 'SECRET', bits: [1], pcm: [1], settings: { deviceId: 'SECRET', noiseSuppression: false }, frame: { text: 'SECRET', bits: 77, crc: 'PASS' } }, 'FRAME_CRC');
  const serialized = JSON.stringify(recorder.export()); assert.ok(!serialized.includes('SECRET')); assert.ok(!serialized.includes('"pcm"')); assert.equal(recorder.entries[0].demodulatedBits, 77); assert.equal(recorder.lastError.stage, 'CRC');
});
test('diagnostic recorder caps memory and retains the latest error', () => {
  const recorder = new D.Recorder(); recorder.record({ mode: 'rx' }, 'PCM_GAP'); for (let i = 0; i < 500; i++) recorder.record({ packets: i });
  assert.equal(recorder.entries.length, 250); assert.equal(recorder.lastError.code, 'PCM_GAP'); assert.equal(recorder.entries.at(-1).packets, 499);
});
test('AudioWorklet batches sample-clock PCM and resets partial buffers across missing quanta', () => {
  let Processor; const context = { currentFrame: 0, Float32Array, registerProcessor: (_, value) => { Processor = value; }, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } } }, messages = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('./pcm-worklet.js'), 'utf8'), context);
  const processor = new Processor(), output = new Float32Array(128).fill(1);
  function input(value, present = true) { processor.process(present ? [[new Float32Array(128).fill(value)]] : [[]], [[output]]); context.currentFrame += 128; }
  input(1); input(1); input(0, false); for (let i = 0; i < 4; i++) input(2);
  assert.equal(messages.length, 1); assert.equal(messages[0].startSample, 384); assert.equal(messages[0].pcm.length, 512); assert.ok(messages[0].pcm.every(n => n === 2)); assert.ok(output.every(n => n === 0));
  processor.port.onmessage({ data: 'stop' }); assert.equal(processor.process([], [[output]]), false);
});
