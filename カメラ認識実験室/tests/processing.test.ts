import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelProcessor, rgbToHsv, colorMatches, type PixelFrame, type Point } from '../src/modes/pixels.ts';
import { defaults, parseSettings } from '../src/settings.ts';
import { displayPanes, paneBox, sourcePoint } from '../src/display.ts';
import { ModeSession } from '../src/modes/session.ts';
import type { RecognitionMode } from '../src/modes/types.ts';

function image(width = 120, height = 100): PixelFrame { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
function rect(frame: PixelFrame, x: number, y: number, width: number, height: number, rgb = [255, 0, 0]) {
  for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) frame.data.set([...rgb, 255], (yy * frame.width + xx) * 4);
}
function polygon(frame: PixelFrame, points: Point[]) {
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[i], b = points[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside; }
    if (inside) frame.data.set([255, 255, 255, 255], (y * frame.width + x) * 4);
  }
}
test('HSV変換・色相の循環・無彩色・S/Vの許容幅', () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  assert.equal(rgbToHsv(0, 255, 0).h, 120);
  const s = { ...defaults, target: { h: 359, s: 0.8, v: 0.8 }, hueTolerance: 5 };
  assert.equal(colorMatches({ h: 2, s: 0.8, v: 0.8 }, s), true);
  assert.equal(colorMatches({ h: 15, s: 0.8, v: 0.8 }, s), false);
  assert.equal(colorMatches({ h: 359, s: 0.1, v: 0.8 }, s), false);
  assert.equal(colorMatches({ h: 200, s: 0, v: 0.8 }, { ...s, target: { h: 0, s: 0, v: 0.8 } }), true);
});
test('色抽出は複数領域の面積・中心を計算し微小ノイズを除外する', () => {
  const processor = new PixelProcessor('color'), frame = image();
  rect(frame, 10, 10, 20, 10); rect(frame, 70, 60, 15, 12); rect(frame, 100, 20, 10, 10, [0, 0, 255]); rect(frame, 2, 2, 2, 2);
  const r = processor.process(frame, defaults, 100);
  assert.equal(r.regions.length, 2); assert.equal(r.regions[0].area, 200);
  assert.deepEqual(r.regions[0].center, { x: 19.5, y: 14.5 }); assert.equal(r.mask[2 * 120 + 2], 0);
  const next = image(); rect(next, 12, 10, 20, 10); rect(next, 72, 60, 15, 12);
  const tracked = processor.process(next, defaults, 300);
  assert.equal(tracked.regions[0].id, r.regions[0].id); assert.equal(tracked.regions[0].trail?.length, 2);
});
test('背景差分は速度・方向・軌跡と1.2秒の静止を判定し再取得できる', () => {
  const processor = new PixelProcessor('motion'); assert.equal(processor.process(image(), defaults, 0).regions.length, 0);
  const first = image(); rect(first, 20, 30, 15, 15, [255, 255, 255]);
  const initial = processor.process(first, defaults, 100).regions[0]; assert.equal(initial.velocity, undefined);
  const moved = image(); rect(moved, 26, 30, 15, 15, [255, 255, 255]);
  let region = processor.process(moved, defaults, 300).regions[0];
  assert.equal(region.id, initial.id); assert.equal(region.velocity?.x, 30); assert.equal(region.velocity?.y, 0);
  for (let t = 500; t <= 1500; t += 200) region = processor.process(moved, defaults, t).regions[0];
  assert.equal(region.stationary, true); assert.ok(region.trail!.length > 2);
  processor.reset(); assert.equal(processor.process(moved, defaults, 1700).regions.length, 0);
});
test('動体感度と解析サイズ変更・資源解放', () => {
  const p = new PixelProcessor('motion'); p.process(image(), defaults, 0);
  const f = image(); rect(f, 30, 30, 20, 20, [20, 20, 20]);
  assert.equal(p.process(f, { ...defaults, motionSensitivity: 1 }, 100).regions.length, 0);
  assert.equal(p.process(f, { ...defaults, motionSensitivity: 100 }, 200).regions.length, 1);
  assert.equal(p.process(image(50, 50), defaults, 300).regions.length, 0); p.dispose();
  assert.equal(p.process(f, defaults, 400).regions.length, 0);
});
test('輪郭から三角形・四角形・円・直線を抽出する', () => {
  const cases: [string, (f: PixelFrame) => void][] = [
    ['三角形', f => polygon(f, [{ x: 60, y: 15 }, { x: 95, y: 80 }, { x: 25, y: 80 }])],
    ['三角形', f => polygon(f, [{ x: 40, y: 10 }, { x: 15, y: 75 }, { x: 85, y: 75 }])],
    ['四角形', f => rect(f, 30, 25, 55, 45, [255, 255, 255])],
    ['円形', f => { for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) if ((x - 60) ** 2 + (y - 50) ** 2 < 27 ** 2) f.data.set([255, 255, 255, 255], (y * f.width + x) * 4); }],
    ['直線', f => rect(f, 20, 45, 80, 2, [255, 255, 255])]
  ];
  for (const [label, paint] of cases) { const f = image(); paint(f); const r = new PixelProcessor('shape').process(f, defaults, 0); assert.ok(r.regions.some(v => v.label === label), `${label}: ${r.regions.map(v => `${v.label}(${v.area})`)}`); const shape = r.regions.find(v => v.label === label)!; assert.ok(shape.center.x > 0 && shape.center.y > 0); if (label === '円形') assert.equal(shape.angle, null); }
});
test('凹形・微小輪郭を無理に既知図形へ分類しない', () => {
  const frame = image(); polygon(frame, [{ x: 20, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 35 }, { x: 40, y: 35 }, { x: 40, y: 80 }, { x: 20, y: 80 }]);
  const r = new PixelProcessor('shape').process(frame, defaults, 0);
  assert.ok(r.regions.some(v => v.label === '未分類の輪郭'));
  const noise = image(); rect(noise, 30, 30, 2, 2, [255, 255, 255]); assert.equal(new PixelProcessor('shape').process(noise, { ...defaults, minArea: 100 }, 0).regions.length, 0);
});
test('左右比較のcontain変換と前面タップを同じ座標へ逆変換する', () => {
  const panes = displayPanes(400, 600, 'split');
  const point = { x: 25, y: 40, width: 0, height: 0 };
  for (const mirror of [false, true]) for (const pane of panes) {
    const display = paneBox(point, 100, 200, pane, mirror);
    const source = sourcePoint(display.x + (mirror ? -0.01 : 0.01), display.y + 0.01, 100, 200, panes, mirror);
    assert.deepEqual(source, { x: 25, y: 40 });
  }
  assert.equal(sourcePoint(10, 0, 100, 200, panes, false), null);
  assert.deepEqual(displayPanes(400, 600, 'before').map(p => [p.source, p.result]), [[true, false]]);
  assert.deepEqual(displayPanes(400, 600, 'after').map(p => [p.source, p.result]), [[false, true]]);
});
test('設定の復元は不正データ・範囲外・保存形式に耐える', () => {
  assert.deepEqual(parseSettings('broken'), defaults); assert.deepEqual(parseSettings('null'), defaults);
  const restored = parseSettings(JSON.stringify({ ...defaults, mode: 'motion', view: 'split', hueTolerance: 200, target: null }));
  assert.equal(restored.mode, 'motion'); assert.equal(restored.view, 'split'); assert.equal(restored.hueTolerance, 90); assert.equal(restored.target.h, 0);
});
test('モードを直列初期化し、古い初期化結果を破棄する', async () => {
  const session = new ModeSession(), events: string[] = []; let resolve: () => void = () => {};
  function fake(id: string, wait = false): RecognitionMode { return { id, runtime: id, initialize: async () => { events.push(`start:${id}`); if (wait) await new Promise<void>(r => { resolve = r; }); events.push(`ready:${id}`); }, infer: async () => ({ duration: 0 }), dispose: () => { events.push(`dispose:${id}`); } }; }
  const old = session.select(() => fake('old', true));
  await new Promise(r => setImmediate(r)); const next = session.select(() => fake('new'));
  resolve(); assert.equal(await old, null); assert.equal((await next)?.id, 'new');
  assert.ok(events.indexOf('ready:old') < events.indexOf('start:new')); session.dispose(); assert.equal(session.current, undefined);
});
