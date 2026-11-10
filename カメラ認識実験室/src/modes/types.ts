import type { RawDetection } from '../core';
import type { Settings } from '../settings';
import type { ProcessingResult } from './pixels';
export type ModeResult = { detections?: RawDetection[]; duration: number } & Partial<ProcessingResult>;
export interface RecognitionMode {
  readonly id: string;
  readonly runtime: string;
  initialize(): Promise<void>;
  infer(input: HTMLCanvasElement, timestamp: number): Promise<ModeResult>;
  configure?(settings: Settings): void;
  reset?(): void;
  dispose(): void;
}
