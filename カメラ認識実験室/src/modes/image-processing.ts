import { PixelProcessor } from './pixels';
import type { ModeId, Settings } from '../settings';
import type { ModeResult, RecognitionMode } from './types';

export class ImageProcessingMode implements RecognitionMode {
  readonly id: ModeId;
  runtime = '画像処理 / 初期化中';
  private settings: Settings;
  private worker?: Worker;
  private processor?: PixelProcessor;
  private resetPending = false;
  private disposed = false;
  private pending?: { resolve: (value: ModeResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  constructor(id: ModeId, settings: Settings) { this.id = id; this.settings = structuredClone(settings); }
  private request(message: object, transfer: Transferable[] = []): Promise<ModeResult> {
    return new Promise((resolve, reject) => {
      if (this.pending) { reject(new Error('画像処理の重複要求')); return; }
      const timer = setTimeout(() => { this.pending = undefined; reject(new Error('画像処理Workerが応答しません')); }, 10000);
      this.pending = { resolve, reject, timer };
      try { this.worker!.postMessage(message, transfer); }
      catch (e) { clearTimeout(timer); this.pending = undefined; reject(e); }
    });
  }
  async initialize() {
    try {
      if (typeof Worker !== 'function') throw new Error('Worker非対応');
      this.worker = new Worker(new URL('./processing-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => { const p = this.pending; if (!p) return; clearTimeout(p.timer); this.pending = undefined; data.error ? p.reject(new Error(data.error)) : p.resolve(data); };
      this.worker.onerror = () => { const p = this.pending; if (p) { clearTimeout(p.timer); this.pending = undefined; p.reject(new Error('画像処理Worker実行失敗')); } };
      await this.request({ type: 'init', mode: this.id });
      this.runtime = '画像処理 Worker / モデル不使用';
    } catch (e) {
      this.worker?.terminate(); this.worker = undefined;
      if (this.disposed) throw e;
      this.processor = new PixelProcessor(this.id); this.runtime = '画像処理 メインスレッド（互換方式）/ モデル不使用';
    }
  }
  configure(settings: Settings) { this.settings = structuredClone(settings); }
  reset() { this.resetPending = true; }
  async infer(canvas: HTMLCanvasElement, timestamp: number): Promise<ModeResult> {
    if (this.disposed) throw new Error('画像処理中止');
    const reset = this.resetPending; this.resetPending = false;
    const settings = structuredClone(this.settings);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    if (this.worker) {
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      try { return await this.request({ type: 'frame', pixels: frame.data, width: frame.width, height: frame.height, timestamp, settings, reset }, [frame.data.buffer]); }
      catch (e) {
        if (this.disposed) throw e;
        this.worker?.terminate(); this.worker = undefined;
        this.processor = new PixelProcessor(this.id); this.runtime = '画像処理 メインスレッド（Worker失敗後の互換方式）/ モデル不使用';
      }
    }
    if (!this.processor) throw new Error('画像処理未初期化');
    if (reset) this.processor.reset();
    const frame = context.getImageData(0, 0, canvas.width, canvas.height), start = performance.now();
    return { ...this.processor.process(frame, settings, timestamp), duration: performance.now() - start };
  }
  dispose() {
    this.disposed = true; this.worker?.terminate(); this.worker = undefined;
    this.processor?.dispose(); this.processor = undefined;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('画像処理中止')); this.pending = undefined; }
  }
}
