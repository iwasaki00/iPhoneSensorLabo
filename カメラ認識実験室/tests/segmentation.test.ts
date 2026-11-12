import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composite, blurChannel, prepareCompositeMask } from '../src/segmentation/composite.ts';
import { occupancy, InferenceStats, segmentModels, type SegmentData } from '../src/segmentation/models.ts';
import { parseSegmentSettings, modelForTab, segmentDefaults } from '../src/segmentation/settings.ts';
import { parseSettings } from '../src/settings.ts';
function fixture(model: 'person' | 'multiclass' = 'person'): SegmentData {
  return { model, width: 4, height: 1, sourceWidth: 4, sourceHeight: 1, categories: new Uint8Array(model === 'person' ? [0, 1, 1, 0] : [0, 1, 4, 3]), foreground: new Float32Array([0, 1, 1, 0]), source: new Uint8ClampedArray([20, 40, 100, 255, 40, 80, 120, 255, 120, 160, 200, 255, 230, 40, 20, 255]) };
}
const settings = { ...segmentDefaults, boundary: 0 };
test('モデルの対応ラベルと占有率を正しく区別する', () => {
  assert.deepEqual(segmentModels.person.labels, ['背景', '人物']); assert.equal(segmentModels.multiclass.labels.length, 6);
  assert.deepEqual(occupancy(fixture()), [0.5, 0.5]); assert.deepEqual(occupancy(fixture('multiclass')), [0.25, 0.25, 0, 0.25, 0.25, 0]);
  assert.equal(modelForTab('background'), 'person'); assert.equal(modelForTab('partial'), 'multiclass');
});
test('人物の5表示・元映像・逆マスクを生成する', () => {
  const data = fixture();
  assert.deepEqual(composite(data, { ...settings, personView: 'original' }).pixels, data.source);
  const person = composite(data, { ...settings, personView: 'person' }).pixels;
  assert.equal(person[0], 0); assert.equal(person[4], data.source[4]);
  const bg = composite(data, { ...settings, personView: 'background' }).pixels; assert.equal(bg[4], 0); assert.equal(bg[0], data.source[0]);
  const mask = composite(data, { ...settings, personView: 'mask' }).pixels; assert.equal(mask[4], 255); assert.equal(mask[0], 0);
  assert.notDeepEqual(composite(data, { ...settings, personView: 'highlight' }).pixels, data.source);
});
test('背景の単色・画像・減光・ぼかしは人物画素を保護する', () => {
  const data = fixture();
  for (const background of ['solid', 'dark', 'blur', 'image'] as const) {
    const r = composite(data, { ...settings, tab: 'background', background, color: '#ff0000', blur: 1 }, { width: 1, height: 1, data: new Uint8ClampedArray([5, 10, 15, 255]) });
    assert.deepEqual([...r.pixels.slice(4, 12)], [...data.source.slice(4, 12)]); assert.notEqual(r.pixels[0], data.source[0]);
    if (background === 'image') assert.equal(r.pixels[0], 5);
    if (background === 'solid') assert.equal(r.pixels[0], 255);
  }
  assert.match(composite(data, { ...settings, tab: 'background', background: 'image' }).reason, /未選択/);
});
test('部分加工は髪・服だけを変更し明暗の順序を維持する', () => {
  const data = fixture('multiclass');
  const hair = composite(data, { ...settings, tab: 'partial', partial: 'hair', color: '#ff0000' }).pixels;
  assert.notEqual(hair[4], data.source[4]); assert.deepEqual(hair.slice(8, 12), data.source.slice(8, 12));
  const clothes = composite(data, { ...settings, tab: 'partial', partial: 'clothes', color: '#ff0000' }).pixels;
  assert.notEqual(clothes[8], data.source[8]); assert.deepEqual(clothes.slice(4, 8), data.source.slice(4, 8));
  const two = { ...data, categories: new Uint8Array([0, 1, 1, 0]) };
  const tint = composite(two, { ...settings, tab: 'partial', partial: 'hair' }).pixels; assert.ok(tint[8] > tint[4]);
});
test('対象のみ／対象以外のモノクロと未対応・未検出の加工抑止', () => {
  const data = fixture('multiclass');
  const only = composite(data, { ...settings, tab: 'partial', partial: 'mono', target: 4 }).pixels;
  assert.equal(only[8], only[9]); assert.deepEqual(only.slice(0, 8), data.source.slice(0, 8));
  const outside = composite(data, { ...settings, tab: 'partial', partial: 'outside-mono', target: 4 }).pixels;
  assert.equal(outside[0], outside[1]); assert.deepEqual(outside.slice(8, 12), data.source.slice(8, 12));
  assert.match(composite(fixture(), { ...settings, tab: 'partial' }).reason, /未対応/);
  const missing = composite(data, { ...settings, tab: 'partial', partial: 'mono', target: 5 }); assert.match(missing.reason, /検出されていない/); assert.deepEqual(missing.pixels, data.source);
});
test('境界の平滑化は画素値を範囲内に保ち元データを書き換えない', () => {
  const data = fixture(), source = new Uint8ClampedArray(data.source);
  const softened = composite(data, { ...settings, personView: 'mask', boundary: 100 }).pixels;
  assert.ok(softened[0] > 0 && softened[0] < 255); assert.deepEqual(data.source, source);
  assert.deepEqual([...blurChannel(new Float32Array([0, 1, 0]), 3, 1, 1)].map(v => Math.round(v * 3)), [1, 1, 1]);
});
test('旧設定の復元と領域用の独立設定、異常値に耐える', () => {
  const old = parseSettings(JSON.stringify({ mode: 'color', view: 'split', hueTolerance: 39, motionSensitivity: 72 }));
  assert.equal(old.mode, 'color'); assert.equal(old.hueTolerance, 39); assert.equal(old.motionSensitivity, 72); assert.equal(old.view, 'split');
  assert.deepEqual(parseSegmentSettings('broken'), segmentDefaults);
  const s = parseSegmentSettings(JSON.stringify({ tab: 'partial', blur: 300, color: '<bad>', resolution: 9 })); assert.equal(s.blur, 24); assert.equal(s.color, segmentDefaults.color); assert.equal(s.resolution, 256);
});
test('平均・最大時間は計測値だけで算出し解放時に消える', () => { const s = new InferenceStats(); assert.equal(s.value.average, null); s.add(10); s.add(30); s.add(NaN); assert.equal(s.value.average, 20); assert.equal(s.value.maximum, 30); s.reset(); assert.equal(s.value.maximum, null); });
test('live composite reuses a prepared mask without freezing source pixels or changing results', () => {
  const data = fixture(), prepared = prepareCompositeMask(data, settings);
  assert.deepEqual(composite(data, settings, undefined, prepared), composite(data, settings));
  const live = { ...data, source: new Uint8ClampedArray(data.source).fill(100) };
  assert.deepEqual(composite(live, settings, undefined, prepared), composite(live, settings));
  assert.notDeepEqual(composite(live, settings, undefined, prepared).pixels, composite(data, settings, undefined, prepared).pixels);
});
