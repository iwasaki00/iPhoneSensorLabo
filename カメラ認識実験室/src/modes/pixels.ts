import type { Box } from '../core.ts';
import type { HSV, ModeId, Settings } from '../settings.ts';
export type Point = { x: number; y: number };
export type Region = {
  box: Box; center: Point; area: number; label: string; angle: number | null;
  polygon: Point[]; id?: number; velocity?: Point; trail?: Point[]; stationary?: boolean;
};
export type ProcessingResult = { regions: Region[]; mask: Uint8Array; width: number; height: number; note: string };
export type PixelFrame = { data: Uint8ClampedArray; width: number; height: number };

export function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) h = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max };
}
export function colorMatches(color: HSV, settings: Settings): boolean {
  const delta = Math.abs(color.h - settings.target.h);
  // Achromatic targets use saturation/value; hue is undefined near gray.
  const hueMatches = settings.target.s < 0.12 || Math.min(delta, 360 - delta) <= settings.hueTolerance;
  return hueMatches && Math.abs(color.s - settings.target.s) <= settings.saturationTolerance / 100 && Math.abs(color.v - settings.target.v) <= settings.valueTolerance / 100;
}

type Component = { pixels: number[]; box: Box; center: Point };
function components(mask: Uint8Array, width: number, height: number, minimum: number): Component[] {
  const visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length), result: Component[] = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || visited[seed]) continue;
    let head = 0, tail = 1, sumX = 0, sumY = 0, minX = width, maxX = 0, minY = height, maxY = 0;
    queue[0] = seed; visited[seed] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      sumX += x; sumY += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
    }
    if (tail >= minimum) result.push({ pixels: Array.from(queue.subarray(0, tail)), center: { x: sumX / tail, y: sumY / tail }, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } });
    else for (let i = 0; i < tail; i++) mask[queue[i]] = 0;
  }
  return result.sort((a, b) => b.pixels.length - a.pixels.length).slice(0, 24);
}

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (let i = sorted.length - 1; i >= 0; i--) { const p = sorted[i]; while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}
export function polygonArea(points: Point[]): number {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
}
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function simplify(hull: Point[], tolerance: number): Point[] {
  const points = [...hull];
  while (points.length > 3) {
    let index = -1, minimum = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = distanceToSegment(points[i], points[(i - 1 + points.length) % points.length], points[(i + 1) % points.length]);
      if (d < minimum) { minimum = d; index = i; }
    }
    if (minimum > tolerance) break;
    points.splice(index, 1);
  }
  return points;
}
function polygonCenter(hull: Point[], fallback: Point): Point {
  let total = 0, x = 0, y = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length], weight = p.x * q.y - q.x * p.y;
    total += weight; x += (p.x + q.x) * weight; y += (p.y + q.y) * weight;
  }
  return Math.abs(total) < 1e-6 ? fallback : { x: x / (3 * total), y: y / (3 * total) };
}
function principal(points: Point[], center: Point) {
  let xx = 0, yy = 0, xy = 0;
  for (const p of points) { const x = p.x - center.x, y = p.y - center.y; xx += x * x; yy += y * y; xy += x * y; }
  const trace = xx + yy, delta = Math.hypot(xx - yy, 2 * xy);
  return { ratio: (trace - delta) / Math.max(1, trace + delta), angle: Math.atan2(2 * xy, xx - yy) * 90 / Math.PI };
}
export function classifyContour(points: Point[], box: Box): Pick<Region, 'label' | 'polygon' | 'area' | 'angle' | 'center'> {
  const hull = convexHull(points), area = polygonArea(hull);
  const center = polygonCenter(hull, { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length });
  const axis = principal(points, center), diagonal = Math.hypot(box.width, box.height);
  if (axis.ratio < 0.012 && diagonal >= 18) return { label: '直線', polygon: hull, area: 0, angle: axis.angle, center };
  const perimeter = hull.reduce((sum, p, i) => sum + Math.hypot(p.x - hull[(i + 1) % hull.length].x, p.y - hull[(i + 1) % hull.length].y), 0);
  const polygon = simplify(hull, Math.max(1.8, diagonal * 0.035));
  let near = 0;
  for (const p of points) if (polygon.some((a, i) => distanceToSegment(p, a, polygon[(i + 1) % polygon.length]) <= Math.max(2.5, diagonal * 0.035))) near++;
  const radii = points.map(p => Math.hypot(p.x - center.x, p.y - center.y));
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const variation = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length) / Math.max(1, mean);
  const bins = new Set(points.map(p => Math.floor((Math.atan2(p.y - center.y, p.x - center.x) + Math.PI) / (2 * Math.PI) * 12)));
  let label = '未分類の輪郭';
  if (hull.length >= 6 && 4 * Math.PI * area / Math.max(1, perimeter * perimeter) > 0.86 && variation < 0.13 && box.width / box.height > 0.78 && box.width / box.height < 1.28 && bins.size >= 11) label = '円形';
  else if (near / points.length > 0.88 && polygon.length === 3) label = '三角形';
  else if (near / points.length > 0.88 && polygon.length === 4) label = '四角形';
  let angle: number | null = axis.angle;
  if (label === '円形') angle = null;
  else if (label === '三角形' || label === '四角形') {
    let longest = 0;
    for (let i = 0; i < polygon.length; i++) { const a = polygon[i], b = polygon[(i + 1) % polygon.length], length = Math.hypot(b.x - a.x, b.y - a.y); if (length > longest) { longest = length; angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; } }
    angle = ((angle + 90) % 180 + 180) % 180 - 90;
  }
  return { label, polygon: label === '円形' || label === '未分類の輪郭' ? hull : polygon, area, angle, center };
}

type Track = { id: number; center: Point; anchor: Point; trail: Point[]; timestamp: number; lastMoved: number };
export class RegionTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  update(regions: Region[], timestamp: number, width: number, height: number): Region[] {
    const available = new Set(this.tracks.filter(t => timestamp - t.timestamp <= 1000));
    const matches = new Map<Region, Track>();
    const candidates = regions.flatMap(r => [...available].map(t => ({ r, t, d: Math.hypot(r.center.x - t.center.x, r.center.y - t.center.y) }))).sort((a, b) => a.d - b.d);
    for (const { r, t, d } of candidates) if (!matches.has(r) && available.has(t) && d < Math.hypot(width, height) * 0.22) { matches.set(r, t); available.delete(t); }
    const tracks: Track[] = [];
    for (const region of regions) {
      const previous = matches.get(region), dt = previous ? (timestamp - previous.timestamp) / 1000 : 0;
      const moved = !previous || Math.hypot(region.center.x - previous.anchor.x, region.center.y - previous.anchor.y) >= 2;
      const lastMoved = moved ? timestamp : previous.lastMoved;
      const trail = [...(previous?.trail ?? []), { ...region.center }].slice(-24);
      const track = { id: previous?.id ?? this.nextId++, center: { ...region.center }, anchor: moved ? { ...region.center } : previous.anchor, trail, timestamp, lastMoved };
      region.id = track.id; region.trail = trail; region.stationary = timestamp - lastMoved >= 1200;
      region.velocity = dt > 0 && dt <= 1 ? { x: (region.center.x - previous!.center.x) / dt, y: (region.center.y - previous!.center.y) / dt } : undefined;
      tracks.push(track);
    }
    this.tracks = tracks;
    return regions;
  }
  reset() { this.tracks = []; this.nextId = 1; }
}

function gray(frame: PixelFrame): Uint8Array {
  const output = new Uint8Array(frame.width * frame.height);
  for (let i = 0; i < output.length; i++) output[i] = Math.round(frame.data[i * 4] * 0.299 + frame.data[i * 4 + 1] * 0.587 + frame.data[i * 4 + 2] * 0.114);
  return output;
}
function edges(input: Uint8Array, width: number, height: number, threshold: number): Uint8Array {
  const blur = new Uint8Array(input.length), output = new Uint8Array(input.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) { let sum = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += input[(y + dy) * width + x + dx]; blur[y * width + x] = sum / 9; }
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const i = y * width + x;
    const gx = -blur[i - width - 1] + blur[i - width + 1] - 2 * blur[i - 1] + 2 * blur[i + 1] - blur[i + width - 1] + blur[i + width + 1];
    const gy = -blur[i - width - 1] - 2 * blur[i - width] - blur[i - width + 1] + blur[i + width - 1] + 2 * blur[i + width] + blur[i + width + 1];
    if (Math.hypot(gx, gy) >= threshold) output[i] = 1;
  }
  return output;
}
function colorEdges(frame: PixelFrame, threshold: number): Uint8Array {
  const combined = new Uint8Array(frame.width * frame.height);
  for (let channel = 0; channel < 3; channel++) {
    const input = new Uint8Array(combined.length);
    for (let i = 0; i < input.length; i++) input[i] = frame.data[i * 4 + channel];
    const mask = edges(input, frame.width, frame.height, threshold);
    for (let i = 0; i < mask.length; i++) if (mask[i]) combined[i] = 1;
  }
  return combined;
}

export class PixelProcessor {
  private background?: Uint8Array;
  private width = 0;
  private height = 0;
  private tracker = new RegionTracker();
  private mode: ModeId;
  constructor(mode: ModeId) { this.mode = mode; }
  reset() { this.background = undefined; this.tracker.reset(); }
  dispose() { this.reset(); }
  process(frame: PixelFrame, settings: Settings, timestamp: number): ProcessingResult {
    const { width, height, data } = frame;
    if (width !== this.width || height !== this.height) { this.reset(); this.width = width; this.height = height; }
    let mask: Uint8Array = new Uint8Array(width * height), note = '';
    if (this.mode === 'color') {
      for (let i = 0; i < mask.length; i++) if (colorMatches(rgbToHsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]), settings)) mask[i] = 1;
    } else if (this.mode === 'motion') {
      const image = gray(frame);
      if (!this.background) { this.background = image; note = '背景基準を取得しました。固定カメラで物体を動かしてください。'; }
      else { const threshold = 6 + (100 - settings.motionSensitivity) * 0.6; for (let i = 0; i < mask.length; i++) if (Math.abs(image[i] - this.background[i]) >= threshold) mask[i] = 1; }
    } else if (this.mode === 'shape') mask = colorEdges(frame, 25 + (100 - settings.shapeSensitivity) * 2);
    const groups = components(mask, width, height, this.mode === 'shape' ? 10 : settings.minArea);
    let regions: Region[] = [];
    for (const group of groups) {
      if (this.mode === 'shape') {
        const points = group.pixels.map(i => ({ x: i % width, y: Math.floor(i / width) }));
        const classified = classifyContour(points, group.box);
        if (classified.label !== '直線' && classified.area < settings.minArea) { for (const i of group.pixels) mask[i] = 0; continue; }
        // Clipped shapes cannot be classified reliably.
        if (group.box.x <= 2 || group.box.y <= 2 || group.box.x + group.box.width >= width - 2 || group.box.y + group.box.height >= height - 2) classified.label = '未分類の輪郭';
        regions.push({ ...classified, box: group.box });
      } else regions.push({ box: group.box, center: group.center, area: group.pixels.length, label: this.mode === 'color' ? '指定色' : '動体', angle: null, polygon: [] });
    }
    if (this.mode !== 'shape') regions = this.tracker.update(regions, timestamp, width, height);
    return { regions, mask, width, height, note };
  }
}
