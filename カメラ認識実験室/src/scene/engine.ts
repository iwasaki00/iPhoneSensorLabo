import * as tf from '@tensorflow/tfjs-core';
import { loadGraphModel, type GraphModel } from '@tensorflow/tfjs-converter';
import { setWasmPaths, setThreadsCount } from '@tensorflow/tfjs-backend-wasm';
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-webgl';
import type { SceneData, SceneModel } from './models';
import { adaptSceneSize } from './resize';
let owner: SceneEngine | undefined;
export class SceneEngine {
  private graph?: GraphModel;
  private disposed = false;
  private abort = new AbortController();
  private busy?: Promise<SceneData>;
  private backendIndex = 0;
  private backends = ['wasm', 'webgl', 'cpu'];
  loadMs = 0;
  backend = '';
  async initialize(base: string, model: SceneModel, size: number) {
    if (owner && owner !== this) await owner.close(); owner = this;
    const at = performance.now();
    setThreadsCount(1); setWasmPaths(new URL('vendor/tfjs-wasm/', base).href);
    await this.selectBackend();
    if (this.disposed) throw new Error('風景モデルの読み込み中止');
    const timer = setTimeout(() => this.abort.abort(), 120000);
    try {
      const handler = tf.io.browserHTTPRequest(new URL(`models/scene/${model}/model.json`, base).href, { requestInit: { signal: this.abort.signal } });
      const artifacts = await handler.load!();
      if (this.disposed) throw new Error('風景モデルの読み込み中止');
      this.graph = await loadGraphModel(tf.io.fromMemory(adaptSceneSize(artifacts, model, size)));
    }
    finally { clearTimeout(timer); }
    if (this.disposed) { this.graph?.dispose(); this.graph = undefined; throw new Error('風景モデルの読み込み中止'); }
    this.loadMs = performance.now() - at;
  }
  private async selectBackend() {
    for (; this.backendIndex < this.backends.length; this.backendIndex++) {
      try { if (await tf.setBackend(this.backends[this.backendIndex])) { await tf.ready(); this.backend = tf.getBackend(); return; } } catch { /* next compatible backend */ }
    }
    throw new Error('WASM・WebGL・CPUを初期化できません');
  }
  infer(pixels: Uint8ClampedArray, width: number, height: number, model: SceneModel): Promise<SceneData> {
    if (this.busy) return Promise.reject(new Error('風景推論の重複要求'));
    this.busy = this.perform(pixels, width, height, model).finally(() => { this.busy = undefined; if (this.disposed) this.cleanup(); });
    return this.busy;
  }
  private async perform(pixels: Uint8ClampedArray, width: number, height: number, model: SceneModel): Promise<SceneData> {
    if (!this.graph || this.disposed) throw new Error('風景モデル未読込または解放済み');
    const start = performance.now();
    for (;;) {
      let output: tf.Tensor | undefined;
      try {
        const prediction = tf.tidy(() => {
          const input = tf.cast(tf.expandDims(tf.browser.fromPixels({ data: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height }), 0), 'int32');
          return tf.squeeze(this.graph!.execute(input) as tf.Tensor);
        });
        output = prediction;
        const values = await prediction.data(), shape = prediction.shape;
        if (shape.length !== 2) throw new Error('モデルのセマンティック出力が2次元ではありません');
        const categories = Uint8Array.from(values);
        const result = { model, width: shape[1], height: shape[0], categories, duration: performance.now() - start, backend: this.backend, tensors: 0, tensorBytes: 0, memoryReliable: true };
        prediction.dispose(); output = undefined;
        const memory = tf.memory(); result.tensors = memory.numTensors; result.tensorBytes = memory.numBytes; result.memoryReliable = !memory.unreliable;
        return result;
      } catch (error) {
        output?.dispose(); output = undefined;
        if (this.disposed || ++this.backendIndex >= this.backends.length) throw error;
        await this.selectBackend(); // Unsupported WASM operation or WebGL precision/context: retry one frame sequentially.
      } finally { output?.dispose(); }
    }
  }
  private cleanup() { this.graph?.dispose(); this.graph = undefined; if (owner === this) { tf.engine().reset(); owner = undefined; } }
  dispose() { this.disposed = true; this.abort.abort(); if (!this.busy) this.cleanup(); }
  async close() { this.dispose(); try { await this.busy; } catch { /* cancellation */ } this.cleanup(); }
}
