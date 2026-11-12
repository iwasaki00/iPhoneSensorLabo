import { test } from 'node:test';
import assert from 'node:assert/strict';
import { center, normalizeBox, iou, compatible, colorDistribution, maskCoverage, objects, FusionHistory, type Entity, type MultiData, type EngineResult } from '../src/multi/fusion.ts';
import { multiDefaults, parseMulti } from '../src/multi/settings.ts';
import { defaults, parseSettings } from '../src/settings.ts';
import { multiRecord, parseMultiRecord } from '../src/multi/record.ts';
import { exportRecords, readRecords, type Experiment } from '../src/experiments.ts';
import { displayPanes, sourcePoint } from '../src/display.ts';
const entity = (x: number, category = 'cup'): Entity => { const box = { x, y: .2, width: .1, height: .2 }; return { id: 'object-0', category, box, center: center(box), area: .02 }; };
function data(at: number, entities: Entity[] = [entity(.1)], distance?: number): MultiData { return { frameId: String(at), capturedAt: at, processedAt: at + 10, expiresAt: at + 5000, engines: [], entities, relations: distance === undefined ? [] : [{ a: entities[0].id, b: entities[1].id, distance, iou: .25 }], events: [], fusionMs: .2, note: 'test' }; }

test('source normalization, clipping, confidence and mask overlap use image coordinates', () => {
  assert.deepEqual(normalizeBox({ x: -20, y: 10, width: 60, height: 100 }, 100, 100), { x: 0, y: .1, width: .4, height: .9 });
  assert.equal(iou(entity(.1).box, entity(.1).box), 1);
  assert.equal(objects([{ boundingBox: { originX: 20, originY: 10, width: 30, height: 40 }, categories: [{ categoryName: 'cup', score: .7 }] }], 100, 100, .8).length, 0);
  assert.equal(objects([{ boundingBox: { originX: 20, originY: 10, width: 30, height: 40 }, categories: [{ categoryName: 'cup', score: .7 }, { categoryName: 'bottle', score: .9 }] }], 100, 100, .8)[0].label, 'ボトル');
  assert.equal(maskCoverage({ x: .5, y: 0, width: .5, height: 1 }, new Uint8Array([0, 1, 0, 1]), 2, 2), 1);
  assert.equal(maskCoverage({ x: 0, y: 0, width: 1, height: 1 }, new Uint8Array([3, 3, 7, 7]), 2, 2, 3), .5);
});
test('split display and front mirror resolve to the same unmirrored source', () => {
  const panes = displayPanes(400, 300, 'split');
  const p = sourcePoint(50, 150, 200, 100, panes, false), front = sourcePoint(150, 150, 200, 100, panes, true);
  assert.ok(p && front); assert.equal(p.x, front.x); assert.equal(p.y, front.y);
});
test('fusion rejects different frame IDs, capture times and expired live results', () => {
  const a: EngineResult = { engine: 'test', frameId: 'a', capturedAt: 100, processedAt: 110, expiresAt: 200, duration: 10, entities: [] };
  assert.equal(compatible([a, { ...a, engine: 'other' }], 150), true);
  assert.equal(compatible([a, { ...a, frameId: 'b' }], 150), false);
  assert.equal(compatible([a, { ...a, capturedAt: 101 }], 150), false);
  assert.equal(compatible([a], 200), false); assert.equal(compatible([a], 500, true), true);
});
test('ROI distribution reuses HSV target matching and excludes pixels outside box', () => {
  const frame = { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), width: 2, height: 1 };
  const result = colorDistribution(frame, { x: 0, y: 0, width: .5, height: 1 }, defaults);
  assert.equal(result.colorRatio, 1); assert.deepEqual(result.colors, [{ name: '赤', ratio: 1 }]);
  assert.equal(colorDistribution(frame, { x: 0, y: 0, width: 1, height: 1 }, defaults).colorRatio, .5);
});
test('appearance and disappearance debounce, tracks retain identity and reset clears events', () => {
  const history = new FusionHistory(), s = { ...multiDefaults, dwell: 200 };
  const a = data(100); history.update(a, s, true); assert.equal(a.events.length, 0);
  const b = data(350, [entity(.12)]); history.update(b, s, true); assert.equal(b.entities[0].id, a.entities[0].id); assert.equal(b.events.filter(e => e.type === '対象出現').length, 1);
  const c = data(600, [entity(.13)]); history.update(c, s, true); assert.equal(c.events.filter(e => e.type === '対象出現').length, 1);
  const missing = data(2200, []); history.update(missing, s, true); assert.equal(missing.events.filter(e => e.type === '対象消失').length, 1);
  const empty = data(4000, []); history.update(empty, s, true); assert.equal(empty.events.filter(e => e.type === '対象消失').length, 1);
  history.reset(); const reset = data(5000, []); history.update(reset, s, true); assert.deepEqual(reset.events, []);
});
test('pair threshold crossings use dwell and hysteresis without repeated events', () => {
  const history = new FusionHistory(), s = { ...multiDefaults, dwell: 100 };
  const sample = (at: number, distance: number) => { const a = entity(.1), b = entity(.5, 'bottle'); b.id = 'object-1'; const d = data(at, [a, b], distance); history.update(d, s, true); return d; };
  sample(100, .4); sample(200, .15); const close = sample(350, .15);
  assert.equal(close.events.filter(e => e.type === '接近').length, 1);
  assert.equal(sample(500, .24).events.filter(e => e.type === '接近').length, 1);
  sample(650, .4); const far = sample(800, .4); assert.equal(far.events.filter(e => e.type === '離反').length, 1);
  assert.equal(far.events.filter(e => e.type === '重なり').length, 1);
  const stationary = new FusionHistory(); const d = data(100, [entity(.1), { ...entity(.2, 'other'), id: 'object-1' }], .1); stationary.update(d, s, true); const e = data(500, [entity(.1), { ...entity(.2, 'other'), id: 'object-1' }], .1); stationary.update(e, s, true); assert.equal(e.events.some(e => e.type === '接近'), false);
});
test('interrupted observations restart appearance dwell instead of counting missing time', () => {
  const h = new FusionHistory(), s = { ...multiDefaults, dwell: 500 };
  h.update(data(100), s, true); h.update(data(300, []), s, true);
  const again = data(800); h.update(again, s, true); assert.equal(again.events.some(e => e.type === '対象出現'), false);
  const stable = data(1400); h.update(stable, s, true); assert.equal(stable.events.filter(e => e.type === '対象出現').length, 1);
});
test('movement start/stop and target color persist; still images never infer temporal movement', () => {
  const history = new FusionHistory(), s = { ...multiDefaults, dwell: 0 };
  const a = data(100); history.update(a, s, true);
  const b = data(1100, [{ ...entity(.2), colorRatio: .9 }]); history.update(b, s, true);
  assert.ok(b.events.some(e => e.type === '移動開始')); assert.ok(b.events.some(e => e.type === '指定色検出'));
  const c = data(2100, [entity(.2)]); history.update(c, s, true); assert.ok(c.events.some(e => e.type === '移動停止'));
  const still = data(3000, [entity(.8)]); history.update(still, s, false); assert.equal(still.entities[0].speed, undefined); assert.equal(still.events.some(e => e.type === '対象出現' || e.type === '移動開始'), false);
});
test('settings are bounded, scene is still-only and legacy values survive', () => {
  assert.equal(parseMulti('{"experiment":"object-scene","input":"continuous"}').input, 'still');
  assert.equal(parseMulti('{"ttl":999999,"dwell":-1,"resolution":999}').ttl, 15000);
  assert.equal(parseMulti('{"dwell":-1}').dwell, 0); assert.deepEqual(parseMulti('null'), multiDefaults);
  assert.equal(parseSettings('{"mode":"multi","hueTolerance":39}').hueTolerance, 39);
  assert.equal(parseSettings('{"mode":"scene"}').mode, 'scene');
});
test('records preserve old data and export only bounded multi metadata, without masks/pixels', () => {
  const d = data(100); const m = multiRecord(d, multiDefaults);
  const base: Experiment = { version: '0.5.0', at: new Date().toISOString(), mode: 'multi', model: 'test', resolution: '100x100', renderFPS: null, inferenceFPS: null, averageMs: 1, maximumMs: 1, waitMs: 500, loadMode: 'auto', runtime: 'test', userAgent: 'test', language: 'ja', platform: 'test', cores: 1 };
  const records = readRecords(JSON.stringify([base, { ...base, multi: { ...m, image: 'secret', engines: [{ name: 'test', duration: 10, mask: [1, 2] }] } }]));
  assert.equal(records.length, 2); assert.ok(records[1].multi); assert.equal(records[0].multi, undefined);
  const json = exportRecords(records, 'json'), csv = exportRecords(records, 'csv'); assert.ok(!json.includes('secret') && !json.includes('mask')); assert.match(csv, /multiThresholds/); assert.deepEqual(readRecords(json), records);
  assert.equal(parseMultiRecord({ ...m, events: new Array(101).fill({}) }), undefined);
});
