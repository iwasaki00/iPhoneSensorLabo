import type { RecognitionMode } from './types.ts';

// Serializes initialization and invalidates stale selections without touching the camera.
export class ModeSession {
  current?: RecognitionMode;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  select(factory: () => Promise<RecognitionMode> | RecognitionMode): Promise<RecognitionMode | null> {
    const token = ++this.generation;
    this.current?.dispose(); this.current = undefined;
    const task = this.queue.catch(() => {}).then(async () => {
      if (token !== this.generation) return null;
      const mode = await factory();
      if (token !== this.generation) { mode.dispose(); return null; }
      this.current = mode;
      try { await mode.initialize(); }
      catch (e) { mode.dispose(); if (this.current === mode) this.current = undefined; if (token !== this.generation) return null; throw e; }
      if (token !== this.generation) { mode.dispose(); return null; }
      return mode;
    });
    this.queue = task;
    return task;
  }
  dispose() { this.generation++; this.current?.dispose(); this.current = undefined; }
}
