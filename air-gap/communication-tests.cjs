'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./frame.js'), K = require('./fsk.js'), S = require('./simulator.js');
test('CRC-16/CCITT-FALSE standard vector', () => assert.equal(F.crc16(new TextEncoder().encode('123456789')), 0x29b1));
for (const text of ['HELLO', 'TEST123', 'こんにちは', '', 'X'.repeat(32)]) test(`frame round trip: ${JSON.stringify(text)}`, () => assert.equal(F.decode(F.encode(text, 17).bytes).text, text));
test('frame errors: size, version, CRC, incomplete and invalid UTF-8', () => {
  assert.throws(() => F.encode('あ'.repeat(11))); assert.throws(() => F.encode('X'.repeat(33)));
  const base = F.encode('HELLO').bytes;
  for (const [index, value] of [[4, 2], [6, 33], [8, 0]]) { const changed = base.slice(); changed[index] = value; assert.throws(() => F.decode(changed)); }
  assert.throws(() => F.decode(base.subarray(0, base.length - 1)));
  const body = Uint8Array.from([1, 0, 1, 0xff, 0, 0]), crc = F.crc16(body.subarray(0, 4)); body[4] = crc >> 8; body[5] = crc & 255; assert.throws(() => F.decodeBody(body));
});
for (const sampleRate of [44100, 48000]) for (const bitMs of [40, 80, 120]) for (const text of ['HELLO', 'TEST123', 'こんにちは', '', 'X'.repeat(32)]) for (const seed of [7, 91]) {
  test(`FSK normal ${sampleRate}/${bitMs}ms/${seed}/${JSON.stringify(text)}`, () => {
    const rng = S.random(seed), frame = F.encode(text, seed), waveform = K.modulate(frame.bits, { sampleRate, bitMs, phase: rng() * 2 * Math.PI, amplitude: 0.08 });
    const offset = Math.floor(rng() * sampleRate * 0.3), pcm = new Float32Array(offset + waveform.pcm.length); pcm.set(waveform.pcm, offset);
    const decoder = new K.Decoder({ sampleRate, bitMs });
    for (let i = 0; i < pcm.length; i += 512) decoder.push(pcm.subarray(i, i + 512)); decoder.finish();
    const complete = decoder.events.filter(e => e.state === 'COMPLETE');
    assert.equal(complete.length, 1, JSON.stringify(decoder.events.map(e => ({state:e.state, reason:e.reason}))));
    assert.equal(complete[0].text, text); assert.deepEqual(complete[0].bits, frame.bits);
  });
}
test('Goertzel discriminates both bits and rejects silence', () => {
  for (const bit of [0, 1]) {
    const wave = K.modulate(Array(5).fill(bit), { amplitude: 0.08 });
    const e = K.energy(wave.pcm.subarray(5000, 7000), 48000); assert.equal(e.bit, bit);
  }
  assert.equal(K.energy(new Float32Array(2000), 48000).bit, null);
});
function feed(decoder, pcm) { for (let i = 0; i < pcm.length; i += 333) decoder.push(pcm.subarray(i, i + 333)); }
test('malformed audio headers and CRC are rejected, then a good frame can be received', () => {
  for (const type of ['version', 'length', 'crc']) {
    const bytes = F.encode('HELLO').bytes.slice();
    if (type === 'version') bytes[4] = 2; else if (type === 'length') bytes[6] = 255; else bytes[8] ^= 1;
    const decoder = new K.Decoder(); feed(decoder, K.modulate(F.bits(bytes), { amplitude: 0.08 }).pcm);
    assert.equal(decoder.completed, 0); assert.ok(decoder.failures > 0);
    feed(decoder, K.modulate(F.encode('TEST123', 3).bits, { amplitude: 0.08 }).pcm);
    assert.equal(decoder.events.filter(e => e.state === 'COMPLETE').at(-1).text, 'TEST123');
  }
});
test('unfinished signal times out and silence/continuous noise cannot emit text', () => {
  const decoder = new K.Decoder(), wave = K.modulate(F.encode('HELLO').bits, { amplitude: 0.08 });
  feed(decoder, wave.pcm.subarray(0, 48000 * 4)); decoder.finish();
  assert.equal(decoder.completed, 0); assert.equal(decoder.state, 'TIMEOUT');
  const clean = new K.Decoder(); clean.push(new Float32Array(48000)); assert.equal(clean.completed, 0);
  const noise = new K.Decoder(), rng = S.random(44); noise.push(Float32Array.from({ length: 48000 * 4 }, () => (rng() * 2 - 1) * 0.3)); assert.equal(noise.completed, 0);
});
test('successive messages, failures and sample-clock discontinuities are bounded', () => {
  const decoder = new K.Decoder();
  for (const text of ['HELLO', 'こんにちは', 'TEST123']) feed(decoder, K.modulate(F.encode(text).bits, { amplitude: 0.08 }).pcm);
  assert.deepEqual(decoder.events.filter(e => e.state === 'COMPLETE').map(e => e.text), ['HELLO', 'こんにちは', 'TEST123']);
  assert.ok(decoder.ring.length <= 28800); assert.ok(decoder.history.length <= 264); assert.ok(decoder.events.length <= 16);
  assert.throws(() => decoder.push(new Float32Array(48000 * 46)));
  assert.throws(() => K.settings({ bitMs: 1 })); assert.throws(() => K.modulate(Array(400).fill(0)));
});
test('small sample-clock drift follows; large drift must never emit wrong text', () => {
  for (const drift of [-0.001, 0.001]) assert.equal(S.communication({ text: 'TEST123', impairments: { drift } }).success, true);
  const extreme = S.communication({ text: 'こんにちは', impairments: { drift: 0.02 } });
  assert.ok(extreme.receivedText == null || extreme.receivedText === 'こんにちは');
});
for (const sampleRate of [44100, 48000]) for (const channel of Object.keys(S.CHANNELS)) for (const text of ['HELLO', 'TEST123', 'こんにちは']) for (const seed of [17, 49]) {
  test(`channel ${channel}/${sampleRate}/${seed}/${text}`, () => {
    const r = S.communication({ text, sampleRate, channel, seed });
    if (['clean', 'weakNoise', 'lowVolume', 'interference', 'shifted'].includes(channel)) { assert.equal(r.success, true, r.reason); assert.equal(r.ber, 0); }
    else { assert.equal(r.success, false); assert.equal(r.receivedText, null); assert.equal(r.ber, null); }
  });
}
test('conditions, full bit arrays, failure rates and BER unavailability are explicit', () => {
  const success = S.communication({ seed: 12 }), failure = S.communication({ channel: 'strongNoise', seed: 12 });
  assert.equal(success.txBits, success.rxBits); assert.equal(failure.ber, null);
  const summary = S.summarize([success, failure]); assert.equal(summary.successRate, 0.5); assert.equal(summary.unmeasurableBerTrials, 1);
  const copy = S.communication({ seed: 12 }); delete copy.processingMs; delete success.processingMs; assert.deepEqual(copy, success);
});
