import type { SegmentData } from './models.ts';

/** Wait after completion, never an inference queue. Quality/resolution is not changed. */
export class AdaptiveLoad {
  private average = 0;
  private intervals: number[];
  private maximum: number;
  constructor(intervals = [100, 200, 500, 1000], maximum = 2000) { this.intervals = intervals; this.maximum = maximum; }
  reset() { this.average = 0; }
  add(ms: number) { if (Number.isFinite(ms) && ms >= 0) this.average = this.average ? this.average * 0.75 + ms * 0.25 : ms; }
  wait(mode: 'auto' | 'manual', manual: number) {
    const base = this.intervals.includes(manual) ? manual : this.intervals[1];
    return mode === 'manual' ? base : Math.min(this.maximum, Math.max(base, Math.ceil(this.average * 1.5 / 50) * 50));
  }
  get heavy() { return this.average > 200; }
}
export function maskValid(capturedAt: number, now: number, ttl: number) { return capturedAt > 0 && now >= capturedAt && now - capturedAt < ttl; }

/** Own arrays only: no MediaPipe mask or callback-scoped memory is retained. */
export class MaskHistory {
  private previous?: { data: SegmentData; at: number };
  clear() { this.previous = undefined; }
  apply(input: SegmentData, at: number, enabled: boolean, strength: number, ttl: number): SegmentData {
    if (!enabled || strength <= 0) { this.clear(); return input; }
    const foreground = new Float32Array(input.foreground), categories = new Uint8Array(input.categories);
    const old = this.previous;
    const compatible = old && old.data.model === input.model && old.data.width === input.width && old.data.height === input.height && old.data.sourceWidth === input.sourceWidth && old.data.sourceHeight === input.sourceHeight && maskValid(old.at, at, Math.min(ttl, 1200));
    const weight = Math.min(0.65, Math.max(0, strength / 100 * 0.65));
    for (let y = 1; y < input.height - 1; y++) for (let x = 1; x < input.width - 1; x++) {
      const i = y * input.width + x, label = input.categories[i];
      // Only remove isolated pixels surrounded by one unanimous label. Preserve thin edges.
      const neighbors = [i - 1, i + 1, i - input.width, i + input.width];
      const same = input.categories[neighbors[0]];
      if (strength >= 30 && neighbors.every(j => input.categories[j] === same) && same !== label) {
        categories[i] = same; foreground[i] = neighbors.reduce((sum, j) => sum + input.foreground[j], 0) / 4;
      }
      if (compatible && categories[i] === old.data.categories[i] && Math.abs(foreground[i] - old.data.foreground[i]) < 0.25) {
        const p = (Math.min(input.sourceHeight - 1, Math.floor(y * input.sourceHeight / input.height)) * input.sourceWidth + Math.min(input.sourceWidth - 1, Math.floor(x * input.sourceWidth / input.width))) * 4;
        const change = Math.max(Math.abs(input.source[p] - old.data.source[p]), Math.abs(input.source[p + 1] - old.data.source[p + 1]), Math.abs(input.source[p + 2] - old.data.source[p + 2]));
        // Immediate adoption on motion/label changes; no stale silhouette blended into new frames.
        if (change < 24) foreground[i] = foreground[i] * (1 - weight) + old.data.foreground[i] * weight;
      }
    }
    const data = { ...input, foreground, categories };
    this.previous = { data, at }; return data;
  }
}
