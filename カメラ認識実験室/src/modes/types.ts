import type { RawDetection } from '../core';
import type { Settings } from '../settings';
import type { ProcessingResult } from './pixels';
import type { SegmentData } from '../segmentation/models';
import type { SceneData } from '../scene/models';
export type ModeResult = { detections?: RawDetection[]; duration: number; segmentation?: SegmentData; scene?: SceneData } & Partial<ProcessingResult>;
export interface RecognitionMode {
  readonly id: string;
  readonly runtime: string;
  readonly loadMs?: number;
  initialize(): Promise<void>;
  infer(input: HTMLCanvasElement, timestamp: number): Promise<ModeResult>;
  configure?(settings: Settings): void;
  reset?(): void;
  dispose(): void;
}
