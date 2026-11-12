import { SceneEngine } from './engine';
import type { SceneModel } from './models';
const scope = self as unknown as { onmessage: ((event: MessageEvent) => Promise<void>) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
let engine: SceneEngine | undefined, model: SceneModel, busy = false;
scope.onmessage = async ({ data }) => {
  if (busy) { scope.postMessage({ error: '風景Workerの重複要求' }); return; } busy = true;
  try {
    if (data.type === 'init') { model = data.model; engine = new SceneEngine(); await engine.initialize(data.base, model, data.size); scope.postMessage({ loadMs: engine.loadMs, backend: engine.backend }); }
    else if (data.type === 'infer') { const result = await engine!.infer(data.pixels, data.width, data.height, model); scope.postMessage(result, [result.categories.buffer]); }
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { busy = false; }
};
