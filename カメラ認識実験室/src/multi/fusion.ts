import { convert, type Box, type RawDetection } from '../core.ts';
import { colorMatches, rgbToHsv, type PixelFrame, type Point } from '../modes/pixels.ts';
import type { Settings } from '../settings.ts';
import type { MultiSettings } from './settings.ts';

/** Coordinates, areas and speeds are relative to the unmirrored source image. */
export type RegionMask = { data: Uint8Array; width: number; height: number; includeZero?: boolean };
export type Entity = { id: string; category: string; label?: string; text?: string; format?: string; content?: string; referenceId?: string; markerId?: number; corners?: Point[]; homography?: number[]; confidence?: number; box: Box; center: Point; area: number; mask?: RegionMask; colorRatio?: number; colors?: { name: string; ratio: number }[]; speed?: number; velocity?: Point; trail?: Point[] };
export type EngineResult = { engine: string; frameId: string; capturedAt: number; processedAt: number; expiresAt: number; duration: number; entities: Entity[]; mask?: RegionMask };
export type Relation = { a: string; b: string; distance?: number; iou?: number; coverage?: number; category?: string; trend?: '接近' | '離反' | '安定' };
export type MultiEvent = { type: string; at: string; frameId: string; target: string; evidence: string };
export type MultiData = { frameId: string; capturedAt: number; processedAt: number; expiresAt: number; engines: EngineResult[]; entities: Entity[]; relations: Relation[]; events: MultiEvent[]; fusionMs: number; note: string };
export const center = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
export function normalizeBox(b: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.min(1, b.x / width)), y = Math.max(0, Math.min(1, b.y / height));
  return { x, y, width: Math.max(0, Math.min(1, (b.x + b.width) / width) - x), height: Math.max(0, Math.min(1, (b.y + b.height) / height) - y) };
}
export function intersection(a: Box, b: Box) { return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)); }
export function iou(a: Box, b: Box) { const n = intersection(a, b); return n / Math.max(1e-9, a.width * a.height + b.width * b.height - n); }
export function compatible(results: EngineResult[], now: number, allowExpiredStill = false) {
  return results.length > 0 && results.every(r => r.frameId === results[0].frameId && r.capturedAt === results[0].capturedAt && (allowExpiredStill || now < r.expiresAt));
}
export function objects(raw: RawDetection[], width: number, height: number, threshold: number): Entity[] {
  return raw.flatMap((r, i) => {
    const observation = convert([r], threshold)[0]; if (!observation) return [];
    const c = r.categories.find(c => c.score === observation.score)!;
    const box = normalizeBox(observation.box, width, height);
    return box.width && box.height ? [{ id: `object-${i}`, category: c.categoryName, label: observation.label, confidence: observation.score, box, center: center(box), area: box.width * box.height }] : [];
  });
}
export function colorDistribution(frame: PixelFrame, box: Box, settings: Settings) {
  const counts = new Map<string, number>(); let target = 0, total = 0;
  for (let y = Math.floor(box.y * frame.height); y < Math.min(frame.height, Math.ceil((box.y + box.height) * frame.height)); y++)
    for (let x = Math.floor(box.x * frame.width); x < Math.min(frame.width, Math.ceil((box.x + box.width) * frame.width)); x++) {
      const p = (y * frame.width + x) * 4, hsv = rgbToHsv(frame.data[p], frame.data[p + 1], frame.data[p + 2]);
      const name = hsv.v < .18 ? '黒' : hsv.s < .18 ? hsv.v > .8 ? '白' : '灰' : ['赤', '橙', '黄', '緑', '水色', '青', '紫', '赤紫'][Math.floor((hsv.h + 22.5) / 45) % 8];
      counts.set(name, (counts.get(name) ?? 0) + 1); total++; if (colorMatches(hsv, settings)) target++;
    }
  return { colorRatio: total ? target / total : 0, colors: [...counts].map(([name, n]) => ({ name, ratio: n / total })).sort((a, b) => b.ratio - a.ratio).slice(0, 3) };
}
export function maskCoverage(box: Box, mask: Uint8Array, width: number, height: number, category?: number) {
  let total = 0, hit = 0;
  for (let y = Math.floor(box.y * height); y < Math.min(height, Math.ceil((box.y + box.height) * height)); y++)
    for (let x = Math.floor(box.x * width); x < Math.min(width, Math.ceil((box.x + box.width) * width)); x++) { total++; const c = mask[y * width + x]; if (category === undefined ? c > 0 : c === category) hit++; }
  return total ? hit / total : 0;
}

/** Only this class compares different frames, using explicit time deltas and bounded tracks. */
export class FusionHistory {
  private tracks = new Map<string, { entity: Entity; at: number; seen: number; announced: boolean; missed: boolean }>();
  private sequence = 0;
  private latches = new Map<string, { state: boolean; desired: boolean; since: number }>();
  private distances = new Map<string, number>();
  private log: MultiEvent[] = [];
  reset() { this.tracks.clear(); this.latches.clear(); this.distances.clear(); this.log = []; }
  private latch(key: string, desired: boolean, now: number, dwell: number, emit: (state: boolean) => void) {
    let l = this.latches.get(key);
    if (!l) { l = { state: false, desired, since: now }; this.latches.set(key, l); }
    if (l.desired !== desired) { l.desired = desired; l.since = now; }
    if (desired !== l.state && now - l.since >= dwell) { l.state = desired; emit(desired); }
  }
  update(data: MultiData, s: MultiSettings, temporal: boolean) {
    const now = data.capturedAt, used = new Set<string>();
    const emit = (type: string, target: string, evidence: string) => { this.log.push({ type, target, evidence, at: new Date(performance.timeOrigin + now).toISOString(), frameId: data.frameId }); this.log = this.log.slice(-100); };
    if (!temporal) this.reset();
    const previousPairs = new Map(this.distances);
    for (const e of data.entities) {
      let match: [string, { entity: Entity; at: number; seen: number; announced: boolean; missed: boolean }] | undefined;
      if (temporal) match = [...this.tracks].filter(([id, t]) => !used.has(id) && t.entity.category === e.category && now - t.seen <= s.ttl && Math.hypot(e.center.x - t.entity.center.x, e.center.y - t.entity.center.y) < .25).sort((a, b) => Math.hypot(e.center.x - a[1].entity.center.x, e.center.y - a[1].entity.center.y) - Math.hypot(e.center.x - b[1].entity.center.x, e.center.y - b[1].entity.center.y))[0];
      const oldId = e.id; e.id = match?.[0] ?? `track-${++this.sequence}`; used.add(e.id);
      for (const r of data.relations) { if (r.a === oldId) r.a = e.id; if (r.b === oldId) r.b = e.id; }
      const dt = match ? (now - match[1].seen) / 1000 : 0;
      e.velocity = dt > 0 ? { x: (e.center.x - match![1].entity.center.x) / dt, y: (e.center.y - match![1].entity.center.y) / dt } : undefined;
      e.speed = e.velocity ? Math.hypot(e.velocity.x, e.velocity.y) : undefined;
      e.trail = [...(match?.[1].entity.trail ?? []), e.center].slice(-30);
      const t = { entity: e, at: match?.[1].missed && !match[1].announced ? now : match?.[1].at ?? now, seen: now, announced: match?.[1].announced ?? false, missed: false }; this.tracks.set(e.id, t);
      if (temporal && now - t.at >= s.dwell && !t.announced) { emit('対象出現', e.id, `${e.category} / 継続${(now - t.at).toFixed(0)}ms`); t.announced = true; }
      const colorKey = e.id + '/color', colorState = this.latches.get(colorKey)?.state ?? false;
      this.latch(colorKey, (e.colorRatio ?? 0) >= s.ratio + (colorState ? -s.hysteresis : s.hysteresis), now, temporal ? s.dwell : 0, state => { if (state) emit('指定色検出', e.id, `指定色割合=${e.colorRatio?.toFixed(3)} / 閾値=${s.ratio}`); });
      if (temporal && e.speed !== undefined) {
        const key = e.id + '/motion', state = this.latches.get(key)?.state ?? false;
        this.latch(key, e.speed >= s.speed * (state ? .7 : 1), now, s.dwell, moving => emit(moving ? '移動開始' : '移動停止', e.id, `元画像正規化速度=${e.speed?.toFixed(4)}/s / 閾値=${s.speed}`));
      }
    }
    for (const [id, t] of this.tracks) if (!used.has(id)) {
      t.missed = true;
      for (const [key, latch] of this.latches) if (key.startsWith(id + '/')) { latch.desired = latch.state; latch.since = now; }
      if (now - t.seen >= Math.max(s.dwell, Math.min(s.ttl, 1500))) {
        if (t.announced) emit('対象消失', id, `最後の検出から${(now - t.seen).toFixed(0)}ms / 遮蔽・誤検出の可能性あり`);
        this.tracks.delete(id); for (const key of this.latches.keys()) if (key.startsWith(id + '/')) this.latches.delete(key);
      }
    }
    for (const r of data.relations) {
      const key = [r.a, r.b].sort().join('/'), before = previousPairs.get(key);
      if (r.distance !== undefined) this.distances.set(key, r.distance);
      const closeState = this.latches.get(key + '/near')?.state ?? false;
      if (r.distance !== undefined) {
        if (!this.latches.has(key + '/near')) { const close = r.distance < s.distance; this.latches.set(key + '/near', { state: close, desired: close, since: now }); }
        else this.latch(key + '/near', r.distance < s.distance + (closeState ? s.hysteresis : -s.hysteresis), now, s.dwell, close => { if (temporal && before !== undefined) emit(close ? '接近' : '離反', key, `画像内中心距離=${r.distance?.toFixed(4)} / 閾値=${s.distance}`); });
      }
      const overlapping = this.latches.get(key + '/overlap')?.state ?? false;
      this.latch(key + '/overlap', (r.coverage ?? r.iou ?? 0) >= s.ratio + (overlapping ? -s.hysteresis : s.hysteresis), now, temporal ? s.dwell : 0, state => { if (state) emit('重なり', key, `画像内重なり=${(r.coverage ?? r.iou ?? 0).toFixed(4)} / 閾値=${s.ratio}`); });
      if (temporal && before !== undefined && r.distance !== undefined) r.trend = r.distance < before - .005 ? '接近' : r.distance > before + .005 ? '離反' : '安定';
    }
    const activePairs = new Set(data.relations.filter(r => r.distance !== undefined).map(r => [r.a, r.b].sort().join('/')));
    for (const key of this.distances.keys()) if (!activePairs.has(key)) { this.distances.delete(key); for (const suffix of ['/near', '/overlap']) this.latches.delete(key + suffix); }
    const relationKeys = new Set(data.relations.map(r => [r.a, r.b].sort().join('/')));
    for (const key of this.latches.keys()) if ((key.endsWith('/near') || key.endsWith('/overlap')) && !relationKeys.has(key.slice(0, key.lastIndexOf('/')))) this.latches.delete(key);
    data.events = [...this.log];
  }
}
