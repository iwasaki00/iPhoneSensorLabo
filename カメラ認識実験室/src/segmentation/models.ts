import type { SegmentModel } from './settings.ts';
export const segmentModels = {
  person: { name: 'SelfieSegmenter (square)', file: 'selfie_segmenter.tflite', input: '256×256', labels: ['背景', '人物'], english: ['background', 'person'], bytes: 249537 },
  multiclass: { name: 'SelfieMulticlass 256×256', file: 'selfie_multiclass_256x256.tflite', input: '256×256', labels: ['背景', '髪', '体の肌', '顔の肌', '服', 'その他（装飾品等）'], english: ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'], bytes: 16371837 }
} as const;
export type SegmentData = {
  model: SegmentModel; width: number; height: number; categories: Uint8Array; foreground: Float32Array;
  source: Uint8ClampedArray; sourceWidth: number; sourceHeight: number;
};
export function occupancy(data: Pick<SegmentData, 'model' | 'categories'>) {
  const counts = new Array<number>(segmentModels[data.model].labels.length).fill(0);
  for (const category of data.categories) if (category < counts.length) counts[category]++;
  return counts.map(count => data.categories.length ? count / data.categories.length : 0);
}
export class InferenceStats {
  private samples: number[] = [];
  add(duration: number) { if (Number.isFinite(duration) && duration >= 0) this.samples.push(duration); if (this.samples.length > 120) this.samples.shift(); }
  get value() { return { count: this.samples.length, average: this.samples.length ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length : null, maximum: this.samples.length ? Math.max(...this.samples) : null }; }
  reset() { this.samples = []; }
}
