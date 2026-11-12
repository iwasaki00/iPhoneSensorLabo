import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
test('Worker transfers owned mask copies before closing MediaPipe results and ImageBitmap', async () => {
  for (const model of ['person', 'multiclass']) {
    let closed = 0, bitmapClosed = 0;
    const values = new Float32Array([0.2, 0.8]), categories = new Uint8Array([0, 4]);
    const native = { width: 2, height: 1, getAsFloat32Array: () => values, getAsUint8Array: () => categories };
    const messages: any[] = [];
    const self: any = { postMessage: (value: any, transfer: Transferable[] = []) => messages.push(structuredClone(value, { transfer })) };
    const sandbox = { self, URL, performance, Float32Array, Uint8Array, Error, importScripts: () => {
      self.exports.FilesetResolver = { forVisionTasks: async () => ({}) };
      self.exports.ImageSegmenter = { createFromOptions: async () => ({ getLabels: () => [], segmentForVideo: () => ({ confidenceMasks: Array(model === 'person' ? 1 : 6).fill(native), categoryMask: native, close: () => { closed++; values.fill(0); categories.fill(0); } }) }) };
    } };
    vm.runInNewContext(await readFile('public/segmentation-worker.js', 'utf8'), sandbox);
    await self.onmessage({ data: { type: 'init', base: 'https://local.invalid/', file: 'model.tflite', model } });
    await self.onmessage({ data: { type: 'infer', timestamp: 1, bitmap: { close: () => bitmapClosed++ } } });
    const result = messages[1]; assert.equal(closed, 1); assert.equal(bitmapClosed, 1);
    if (model === 'person') { assert.ok(result.foreground[1] > 0.79); assert.equal(result.categories[1], 1); }
    else { assert.equal(result.categories[1], 4); assert.ok(result.foreground[0] > 0.79); }
    assert.deepEqual([...values], [0, 0]);
  }
});
