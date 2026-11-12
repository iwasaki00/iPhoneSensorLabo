import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { segmentModels, type SegmentData } from '../segmentation/models';
import type { SegmentModel } from '../segmentation/settings';
import type { ModeResult, RecognitionMode } from './types';

const base = new URL(import.meta.env.BASE_URL, location.href).href;
type Payload = Pick<SegmentData, 'categories' | 'foreground' | 'width' | 'height'> & { duration: number; labels?: string[] };
export class SegmentMode implements RecognitionMode {
  readonly id = 'segmentation';
  runtime = '領域認識 / 初期化中';
  loadMs = 0;
  private model: SegmentModel;
  private worker?: Worker;
  private engine?: ImageSegmenter;
  private disposed = false;
  private download?: AbortController;
  private pending?: { resolve: (value: Payload) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  constructor(model: SegmentModel) { this.model = model; }
  private request(message: object, transfer: Transferable[] = []): Promise<Payload> {
    return new Promise((resolve, reject) => {
      if (this.pending) { reject(new Error('領域推論の重複要求')); return; }
      const timer = setTimeout(() => { this.pending = undefined; reject(new Error('領域モデルの読み込みまたは推論がタイムアウトしました')); }, 60000);
      this.pending = { resolve, reject, timer };
      try { this.worker!.postMessage(message, transfer); } catch (e) { clearTimeout(timer); this.pending = undefined; reject(e); }
    });
  }
  private validateLabels(labels: string[] = []) {
    const expected = segmentModels[this.model].english;
    const normalized = (label: string) => label.toLowerCase().replace(/[^a-z]/g, '');
    // Some binary models expose only the positive label, or no label metadata.
    if (!labels.length || (this.model === 'person' && labels.length === 1)) return;
    if (labels.length !== expected.length || labels.some((label, i) => normalized(label) !== normalized(expected[i]))) throw new Error(`モデルのラベルが固定定義と一致しません: ${labels.join(', ')}`);
  }
  async initialize() {
    const start = performance.now();
    try {
      if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('Worker推論機能非対応');
      this.worker = new Worker(new URL('segmentation-worker.js', base));
      this.worker.onmessage = ({ data }) => { const p = this.pending; if (!p) return; clearTimeout(p.timer); this.pending = undefined; data.error ? p.reject(new Error(data.error)) : p.resolve(data); };
      this.worker.onerror = () => { const p = this.pending; if (p) { clearTimeout(p.timer); this.pending = undefined; p.reject(new Error('領域認識Workerを実行できません')); } };
      const result = await this.request({ type: 'init', base, model: this.model, file: segmentModels[this.model].file });
      this.validateLabels(result.labels); this.runtime = 'Image Segmenter / Worker / CPU';
    } catch (e) {
      this.worker?.terminate(); this.worker = undefined;
      if (this.disposed) throw e;
      await this.initializeMain();
    }
    this.loadMs = performance.now() - start;
    if (this.disposed) { this.dispose(); throw new Error('領域認識の初期化中止'); }
  }
  private async initializeMain() {
    const vision = await FilesetResolver.forVisionTasks(new URL('vendor/wasm', base).href);
    if (this.disposed) throw new Error('領域認識の初期化中止');
    const download = new AbortController(); this.download = download;
    const timeout = setTimeout(() => download.abort(), 60000);
    let modelAssetBuffer: Uint8Array;
    try {
      const response = await fetch(new URL('models/' + segmentModels[this.model].file, base), { signal: download.signal });
      if (!response.ok) throw new Error(`領域モデル取得失敗: HTTP ${response.status}`);
      modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    } finally { clearTimeout(timeout); if (this.download === download) this.download = undefined; }
    if (this.disposed) throw new Error('領域認識の初期化中止');
    const engine = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer, delegate: 'CPU' },
      runningMode: 'VIDEO', outputCategoryMask: this.model === 'multiclass', outputConfidenceMasks: true
    });
    if (this.disposed) { engine.close(); throw new Error('領域認識の初期化中止'); }
    this.engine = engine; this.validateLabels(engine.getLabels()); this.runtime = 'Image Segmenter / メインスレッド / CPU（互換方式）';
  }
  async infer(canvas: HTMLCanvasElement, timestamp: number): Promise<ModeResult> {
    if (this.disposed) throw new Error('領域認識中止');
    const source = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
    let payload: Payload;
    if (this.worker) {
      let bitmap: ImageBitmap | undefined;
      try { bitmap = await createImageBitmap(canvas); if (this.disposed) throw new Error('領域認識中止'); payload = await this.request({ type: 'infer', bitmap, timestamp }, [bitmap]); }
      catch (e) { bitmap?.close(); if (this.disposed) throw e; this.worker?.terminate(); this.worker = undefined; await this.initializeMain(); payload = this.inferMain(canvas, timestamp); }
    } else payload = this.inferMain(canvas, timestamp);
    return { duration: payload.duration, segmentation: { ...payload, model: this.model, source, sourceWidth: canvas.width, sourceHeight: canvas.height } };
  }
  private inferMain(canvas: HTMLCanvasElement, timestamp: number): Payload {
    if (!this.engine) throw new Error('領域モデル未読込');
    const start = performance.now(), result = this.engine.segmentForVideo(canvas, timestamp), duration = performance.now() - start;
    try {
      const masks = result.confidenceMasks;
      if (!masks?.length) throw new Error('信頼度マスクを取得できません');
      const width = masks[0].width, height = masks[0].height;
      const foreground = new Float32Array(width * height), categories = new Uint8Array(width * height);
      if (this.model === 'person') {
        const values = masks[masks.length === 1 ? 0 : 1].getAsFloat32Array();
        for (let i = 0; i < foreground.length; i++) { foreground[i] = values[i]; categories[i] = values[i] >= 0.5 ? 1 : 0; }
      } else {
        if (masks.length !== 6 || !result.categoryMask) throw new Error('モデルの6カテゴリ出力と一致しません');
        categories.set(result.categoryMask.getAsUint8Array()); const background = masks[0].getAsFloat32Array();
        for (let i = 0; i < foreground.length; i++) foreground[i] = 1 - background[i];
      }
      return { width, height, categories, foreground, duration };
    } finally { result.close(); }
  }
  dispose() {
    this.disposed = true; this.worker?.terminate(); this.worker = undefined;
    this.download?.abort(); this.download = undefined;
    const engine = this.engine; this.engine = undefined; engine?.close();
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('領域認識中止')); this.pending = undefined; }
  }
}
