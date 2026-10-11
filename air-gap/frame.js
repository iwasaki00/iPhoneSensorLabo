(function (root) {
  'use strict';
  const SPEC = Object.freeze({ version: 1, maxPayload: 32, preamble: Object.freeze([0xaa, 0xaa]), sync: Object.freeze([0xd3, 0x91]), polynomial: 0x1021, initial: 0xffff });
  function crc16(bytes) {
    let crc = SPEC.initial;
    for (const byte of bytes) { crc ^= byte << 8; for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ SPEC.polynomial) & 0xffff : (crc << 1) & 0xffff; }
    return crc;
  }
  const bits = bytes => Array.from(bytes).flatMap(byte => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  function bytesFromBits(values) {
    if (values.length % 8 || values.some(bit => bit !== 0 && bit !== 1)) throw new Error('ビット列が不正です。');
    return Uint8Array.from({ length: values.length / 8 }, (_, i) => values.slice(i * 8, i * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  function encode(text, messageId = 0) {
    if (typeof text !== 'string' || !Number.isInteger(messageId) || messageId < 0 || messageId > 255) throw new Error('文字列 / MESSAGE IDが不正です。');
    const payload = new TextEncoder().encode(text);
    if (new TextDecoder('utf-8', { fatal: true }).decode(payload) !== text) throw new Error('無効なUnicode文字列です。');
    if (payload.length > SPEC.maxPayload) throw new Error('UTF-8で最大32バイトです。');
    const body = Uint8Array.from([SPEC.version, messageId, payload.length, ...payload]), crc = crc16(body);
    const bytes = Uint8Array.from([...SPEC.preamble, ...SPEC.sync, ...body, crc >> 8, crc & 255]);
    return { bytes, bits: bits(bytes), payloadBytes: payload.length, messageId };
  }
  function decodeBody(body, onValidation = () => {}) {
    if (!(body instanceof Uint8Array) || body.length < 3) throw new Error('不完全フレームです。');
    if (body[0] !== SPEC.version) throw new Error('VERSION不一致です。');
    if (body[2] > SPEC.maxPayload) throw new Error('LENGTHが32バイトを超えています。');
    if (body.length !== 5 + body[2]) throw new Error('不完全または余分なフレームです。');
    const actual = crc16(body.subarray(0, body.length - 2)), expected = (body[body.length - 2] << 8) | body[body.length - 1];
    if (actual !== expected) throw new Error('CRC不一致です。');
    onValidation({ crc: 'PASS' });
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(3, body.length - 2)), messageId: body[1], payloadBytes: body[2], crc: 'PASS' };
  }
  function decode(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 9 || bytes.length > 41) throw new Error('フレーム長が不正です。');
    if (![...SPEC.preamble, ...SPEC.sync].every((value, i) => bytes[i] === value)) throw new Error('PREAMBLE/SYNC不一致です。');
    return decodeBody(bytes.subarray(4));
  }
  const api = { SPEC, crc16, bits, bytesFromBits, encode, decode, decodeBody };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SignalFrame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
