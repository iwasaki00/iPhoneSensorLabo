import type { EngineResult, Entity } from '../multi/fusion';
import type { Point } from '../modes/pixels';
export type TextEntity = Entity & { text?: string; format?: string; content?: string; markerId?: number; referenceId?: string; corners?: Point[]; points?: Point[]; homography?: number[]; angle?: number; repeats?: number };
export type TextData = { result: Omit<EngineResult, 'entities'> & { entities: TextEntity[] }; text?: string; confidence?: number; note: string; features: number; matches: number; inliers: number; preview?:ImageData };
