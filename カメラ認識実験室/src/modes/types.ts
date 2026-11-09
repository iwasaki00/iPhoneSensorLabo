import type { RawDetection } from '../core';
export interface RecognitionMode {
  readonly id: string;
  readonly runtime: string;
  initialize(): Promise<void>;
  infer(input: HTMLCanvasElement, timestamp: number): Promise<{ detections: RawDetection[]; duration: number }>;
  dispose(): void;
}
