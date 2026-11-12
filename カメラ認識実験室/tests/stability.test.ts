import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveLoad, MaskHistory, maskValid } from '../src/segmentation/stability.ts';
import { segmentDefaults, parseSegmentSettings } from '../src/segmentation/settings.ts';
import { readRecords, exportRecords, RECORD_LIMIT, type Experiment } from '../src/experiments.ts';
import type { SegmentData } from '../src/segmentation/models.ts';
import { Rate } from '../src/core.ts';
test('sparse inference FPS uses completion intervals without estimated samples', () => {
  const rate = new Rate(10000); rate.tick(100); assert.equal(rate.value(100), null); rate.tick(3100); assert.equal(rate.value(3100), 1 / 3); assert.equal(rate.value(14000), null); rate.reset(); assert.equal(rate.value(14000), null);
});
function mask(value = 0.6, model: 'person' | 'multiclass' = 'person', brightness = 80): SegmentData {
  return { model, width: 5, height: 5, sourceWidth: 5, sourceHeight: 5, categories: new Uint8Array(25).fill(1), foreground: new Float32Array(25).fill(value), source: new Uint8ClampedArray(100).fill(brightness) };
}
test('auto interval reacts to measured load, recovers, respects manual and bounds', () => {
  const load = new AdaptiveLoad(); assert.equal(load.wait('auto', 200), 200);
  load.add(600); assert.equal(load.wait('auto', 200), 900); assert.equal(load.heavy, true); assert.equal(load.wait('manual', 100), 100);
  for (let i = 0; i < 20; i++) load.add(20);
  assert.equal(load.wait('auto', 200), 200); load.add(20000); assert.equal(load.wait('auto', 100), 2000);
  load.reset(); load.add(NaN); assert.equal(load.wait('auto', -5), 200);
});
test('mask expires from capture, not completion; invalid timestamps rejected', () => {
  assert.equal(maskValid(100, 2099, 2000), true); assert.equal(maskValid(100, 2100, 2000), false); assert.equal(maskValid(0, 100, 2000), false); assert.equal(maskValid(100, 99, 2000), false);
});
test('temporal smoothing owns output; motion, class change, age and clear avoid ghost history', () => {
  const history = new MaskHistory(); history.apply(mask(0.6), 100, true, 100, 2000);
  const next = mask(0.7), result = history.apply(next, 200, true, 100, 2000);
  assert.ok(result.foreground[12] < 0.7 && result.foreground[12] > 0.6); assert.ok(next.foreground[12] > 0.69);
  assert.equal(history.apply(mask(0.8, 'person', 200), 300, true, 100, 2000).foreground[12], Math.fround(0.8));
  assert.equal(history.apply(mask(0.9, 'multiclass', 200), 400, true, 100, 2000).foreground[12], Math.fround(0.9));
  assert.equal(history.apply(mask(0.8, 'multiclass', 200), 3000, true, 100, 2000).foreground[12], Math.fround(0.8));
  history.clear(); assert.equal(history.apply(next, 3100, true, 100, 2000).foreground[12], next.foreground[12]);
  assert.equal(history.apply(next, 3200, false, 100, 2000), next);
});
test('only isolated categorical noise is removed; new labels immediately replace old', () => {
  const history = new MaskHistory(), input = mask(); input.categories[12] = 0; input.foreground[12] = 0;
  const output = history.apply(input, 100, true, 50, 2000); assert.equal(output.categories[12], 1); assert.ok(output.foreground[12] > 0.5); assert.equal(input.categories[12], 0);
  const background = mask(0); background.categories.fill(0); const changed = history.apply(background, 200, true, 100, 2000); assert.equal(changed.foreground[12], 0);
});
test('v3.0 settings survive with v3.1 defaults and unsafe values are bounded', () => {
  const settings = parseSegmentSettings(JSON.stringify({ tab: 'partial', color: '#123456', interval: 1000, boundary: 78 }));
  assert.equal(settings.tab, 'partial'); assert.equal(settings.color, '#123456'); assert.equal(settings.interval, 1000); assert.equal(settings.boundary, 78); assert.equal(settings.loadMode, 'auto');
  assert.equal(parseSegmentSettings('{"maskTtl":99999,"temporal":-10,"resolution":9999}').maskTtl, 5000); assert.deepEqual(parseSegmentSettings(null), segmentDefaults);
});
const record: Experiment = { version: '0.3.1', at: '2026-11-12T06:00:00.000Z', mode: '領域認識/person', model: 'test', resolution: '160×240', renderFPS: 60, inferenceFPS: 2, averageMs: 400, maximumMs: 500, waitMs: 600, loadMode: 'auto', runtime: 'Worker / CPU', userAgent: 'test,"browser"', language: 'ja', platform: 'test', cores: 4 };
test('records are bounded, metadata only, tolerant of corruption and round-trip JSON/CSV', () => {
  const values = Array.from({ length: 70 }, (_, i) => ({ ...record, model: String(i), source: [1, 2], image: 'private' }));
  const records = readRecords(JSON.stringify(values)); assert.equal(records.length, RECORD_LIMIT); assert.equal(records[0].model, '20'); assert.equal('source' in records[0], false);
  assert.deepEqual(readRecords(exportRecords(records, 'json')), records); assert.deepEqual(readRecords('bad'), []);
  const csv = exportRecords([{ ...record, model: '=formula' }], 'csv'); assert.match(csv, /"'=formula"/); assert.match(csv, /"test,""browser"""/); assert.equal(csv.includes('private'), false);
  assert.equal(readRecords(JSON.stringify([{ ...record, averageMs: 'NaN' }])).length, 0);
});
