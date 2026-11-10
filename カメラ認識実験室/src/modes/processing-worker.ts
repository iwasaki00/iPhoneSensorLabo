/// <reference lib="webworker" />
import { PixelProcessor } from './pixels';
import type { ModeId, Settings } from '../settings';
const worker = self as unknown as DedicatedWorkerGlobalScope;
let processor: PixelProcessor | undefined;
worker.onmessage = ({ data }: MessageEvent<{ type: string; mode: ModeId; width: number; height: number; pixels: Uint8ClampedArray; settings: Settings; timestamp: number; reset: boolean }>) => {
  try {
    if (data.type === 'init') { processor = new PixelProcessor(data.mode); worker.postMessage({ ready: true }); return; }
    if (!processor) throw new Error('画像処理が未初期化です');
    if (data.reset) processor.reset();
    const start = performance.now();
    const result = processor.process({ data: data.pixels, width: data.width, height: data.height }, data.settings, data.timestamp);
    worker.postMessage({ ...result, duration: performance.now() - start }, [result.mask.buffer]);
  } catch (e) { worker.postMessage({ error: e instanceof Error ? e.message : String(e) }); }
};
