import type { RecognitionMode, ModeResult } from './types';
import type { SceneData, SceneModel } from '../scene/models';
import type { SceneEngine } from '../scene/engine';
export class SceneMode implements RecognitionMode {
  readonly id = 'scene';
  runtime = '風景モデル / 初期化中'; loadMs = 0;
  private worker?: Worker;
  private engine?: SceneEngine;
  private disposed = false;
  private pending?: { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private model: SceneModel;
  private size: number;
  constructor(model: SceneModel, size: number) { this.model = model; this.size = size; }
  private request(message: object, transfer: Transferable[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.pending || this.disposed) { reject(new Error('風景認識の重複要求または中止')); return; }
      const timer = setTimeout(() => { this.pending = undefined; reject(new Error('風景モデルの処理がタイムアウトしました。静止画・低解像度で再試行してください。')); }, 120000);
      this.pending = { resolve, reject, timer };
      try { this.worker!.postMessage(message, transfer); } catch (error) { clearTimeout(timer); this.pending = undefined; reject(error); }
    });
  }
  private async main() {
    const { SceneEngine } = await import('../scene/engine');
    if (this.disposed) throw new Error('風景認識中止');
    this.engine = new SceneEngine(); await this.engine.initialize(new URL(import.meta.env.BASE_URL, location.href).href, this.model, this.size);
    this.runtime = `TensorFlow.js / メインスレッド / ${this.engine.backend}（互換方式）`; this.loadMs = this.engine.loadMs;
  }
  async initialize() {
    const at = performance.now();
    try {
      if (typeof Worker !== 'function') throw new Error('Worker非対応');
      this.worker = new Worker(new URL('../scene/worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => { const pending = this.pending; if (!pending) return; clearTimeout(pending.timer); this.pending = undefined; data.error ? pending.reject(new Error(data.error)) : pending.resolve(data); };
      this.worker.onerror = () => { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('風景Workerを起動できません')); this.pending = undefined; } };
      const result = await this.request({ type: 'init', base: new URL(import.meta.env.BASE_URL, location.href).href, model: this.model, size: this.size });
      this.loadMs = performance.now() - at; this.runtime = `TensorFlow.js / Worker / ${result.backend}`;
    } catch (error) { this.worker?.terminate(); this.worker = undefined; if (this.disposed) throw error; await this.main(); }
  }
  async infer(canvas: HTMLCanvasElement): Promise<ModeResult> {
    if (this.disposed) throw new Error('風景認識中止');
    const image = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
    let data: SceneData;
    if (this.worker) {
      try { data = await this.request({ type: 'infer', pixels: image.data, width: image.width, height: image.height }, [image.data.buffer]); }
      catch (error) { this.worker?.terminate(); this.worker = undefined; if (this.disposed) throw error; await this.main(); const copy = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height); data = await this.engine!.infer(copy.data, copy.width, copy.height, this.model); }
      this.runtime = `TensorFlow.js / ${this.worker ? 'Worker' : 'メインスレッド'} / ${data.backend}`;
    } else data = await this.engine!.infer(image.data, image.width, image.height, this.model);
    return { duration: data.duration, scene: data };
  }
  dispose() { this.disposed = true; this.worker?.terminate(); this.worker = undefined; this.engine?.dispose(); this.engine = undefined; if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('風景認識中止')); this.pending = undefined; } }
}
