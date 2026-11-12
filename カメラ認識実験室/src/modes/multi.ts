import type { RecognitionMode, ModeResult } from './types';
import { ImageProcessingMode } from './image-processing';
import type { Settings } from '../settings';
import { combinations, type MultiSettings } from '../multi/settings';
import { center, colorDistribution, compatible, FusionHistory, iou, maskCoverage, normalizeBox, objects, type EngineResult, type Entity, type MultiData, type Relation } from '../multi/fusion';
import { sceneLabel, sceneModels, type SceneModel } from '../scene/models';
import { internalSceneSize } from '../scene/resize';

/** Sequential engines consume one immutable capture; there is no frame queue. */
export class MultiMode implements RecognitionMode {
  readonly id = 'multi'; runtime = '複合認識 / 逐次実行 / CPU・Worker優先';
  private settings: Settings; private config: MultiSettings; private scene: SceneModel; private sceneSize: number;
  private children = new Map<string, RecognitionMode>(); private history = new FusionHistory();
  private disposed = false; private busy = false; private sequence = 0; private revision = 0;
  private frame = document.createElement('canvas');
  constructor(settings: Settings, config: MultiSettings, scene: SceneModel, sceneSize: number) { this.settings = structuredClone(settings); this.config = structuredClone(config); this.scene = scene; this.sceneSize = sceneSize; }
  async initialize() { /* Load only engines needed by the selected experiment. */ }
  configure(settings: Settings) { this.revision++; this.settings = structuredClone(settings); for (const child of this.children.values()) child.configure?.(settings); this.history.reset(); }
  reset() { this.revision++; this.history.reset(); for (const child of this.children.values()) child.reset?.(); }
  private async engine(id: string): Promise<RecognitionMode> {
    if (this.disposed) throw new Error('複合認識は停止しました。');
    const existing = this.children.get(id); if (existing) return existing;
    let child: RecognitionMode;
    if (id === 'object') { const { ObjectMode } = await import('./object-detector'); child = new ObjectMode(); }
    else if (id === 'person') { const { SegmentMode } = await import('./segmenter'); child = new SegmentMode('person'); }
    else if (id === 'scene') { const { SceneMode } = await import('./scene'); child = new SceneMode(this.scene, this.sceneSize); }
    else child = new ImageProcessingMode(id === 'color' ? 'color' : 'motion', this.settings);
    if (this.disposed) { child.dispose(); throw new Error('複合認識は停止しました。'); }
    this.children.set(id, child);
    try { await child.initialize(); if (this.disposed) throw new Error('複合認識は停止しました。'); return child; }
    catch (error) { child.dispose(); this.children.delete(id); throw error; }
  }
  private release(id: string) { this.children.get(id)?.dispose(); this.children.delete(id); }
  async infer(input: HTMLCanvasElement, capturedAt: number): Promise<ModeResult> {
    if (this.busy || this.disposed) throw new Error('複合認識は実行中、または停止済みです。');
    this.busy = true;
    try {
      this.frame.width = input.width; this.frame.height = input.height;
      this.frame.getContext('2d', { willReadFrequently: true })!.drawImage(input, 0, 0);
      const width = this.frame.width, height = this.frame.height, started = performance.now(), revision = this.revision;
      const frameId = `${capturedAt.toFixed(3)}-${++this.sequence}`, engines: EngineResult[] = [], relations: Relation[] = [];
      const pixels = this.frame.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height);
      const run = async (id: string) => {
        const child = await this.engine(id), result = await child.infer(this.frame, capturedAt);
        if (this.disposed) throw new Error('古い複合認識結果を破棄しました。'); return result;
      };
      const envelope = (engine: string, duration: number, entities: Entity[]): EngineResult => ({ engine, frameId, capturedAt, processedAt: performance.now(), expiresAt: capturedAt + this.config.ttl, duration, entities });
      const experiment = this.config.experiment; let entities: Entity[] = [];
      if (experiment !== 'color-motion') {
        const result = await run('object'); entities = objects(result.detections ?? [], width, height, this.config.confidence);
        engines.push(envelope('EfficientDet-Lite0 int8 revision 1 / MediaPipe 0.10.21', result.duration, [...entities]));
      }
      if (experiment === 'object-color') {
        const start = performance.now(); for (const e of entities) Object.assign(e, colorDistribution(pixels, e.box, this.settings));
        engines.push(envelope('HSV / 物体枠内色分布', performance.now() - start, []));
      }
      if (experiment === 'color-motion' || experiment === 'object-motion') {
        const motion = await run('motion'); engines.push(envelope('背景差分 / PixelProcessor', motion.duration, []));
        if (motion.mask) engines.at(-1)!.mask = { data: motion.mask, width, height };
        if (experiment === 'color-motion') {
          const color = await run('color');
          entities = (color.regions ?? []).map(r => { const box = normalizeBox(r.box, width, height); return { id: `color-${r.id}`, category: '指定色', box, center: { x: r.center.x / width, y: r.center.y / height }, area: r.area / (width * height), colorRatio: 1 }; });
          engines.push(envelope('HSV / PixelProcessor', color.duration, entities));
          if (color.mask) engines.at(-1)!.mask = { data: color.mask, width, height };
          if (motion.mask && color.mask) {
            const joint = Uint8Array.from(motion.mask, (value, i) => value && color.mask![i] ? 1 : 0);
            motion.mask = joint; engines[0].mask = { data: joint, width, height };
          }
        }
        for (const e of entities) if (motion.mask) {
          const coverage = maskCoverage(e.box, motion.mask, width, height);
          relations.push({ a: e.id, b: 'motion-mask', coverage, category: coverage >= this.config.ratio ? '動体領域：移動の可能性あり' : '動体領域：移動判定の根拠が弱い' });
        }
      }
      if (experiment === 'person-object') {
        this.release('object'); const result = await run('person'), mask = result.segmentation!;
        const binary = Uint8Array.from(mask.foreground, p => p >= .5 ? 1 : 0);
        let left = mask.width, top = mask.height, right = -1, bottom = -1, area = 0;
        for (let i = 0; i < binary.length; i++) if (binary[i]) { const x = i % mask.width, y = Math.floor(i / mask.width); left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); area++; }
        const people: Entity[] = [];
        if (area) { const box = normalizeBox({ x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, mask.width, mask.height); people.push({ id: 'person-mask', category: '人物領域（複数人を含む場合あり）', box, center: center(box), area: area / binary.length, mask: { data: binary, width: mask.width, height: mask.height } }); }
        for (const e of entities.filter(e => e.category !== 'person')) if (people.length) relations.push({ a: e.id, b: 'person-mask', distance: Math.hypot(e.center.x - people[0].center.x, e.center.y - people[0].center.y), iou: iou(e.box, people[0].box), coverage: maskCoverage(e.box, binary, mask.width, mask.height), category: '人物マスク' });
        engines.push(envelope('SelfieSegmenter square / MediaPipe 0.10.21 / CPU', result.duration, people)); entities.push(...people); this.release('person');
      }
      if (experiment === 'object-scene') {
        if (this.config.input !== 'still') throw new Error('物体＋風景は静止画専用です。');
        this.release('object'); const result = await run('scene'), data = result.scene!;
        engines.push(envelope(`${sceneModels[this.scene].name} / 原本uint8 version1 / v0.4実験用内部サイズ${internalSceneSize(this.sceneSize)}`, result.duration, []));
        engines.at(-1)!.mask = { data: data.categories, width: data.width, height: data.height, includeZero: true };
        for (const e of entities) for (const id of new Set(data.categories)) {
          const coverage = maskCoverage(e.box, data.categories, data.width, data.height, id);
          if (coverage > .01) relations.push({ a: e.id, b: `scene-${id}`, coverage, category: sceneLabel(this.scene, id) });
        }
        this.release('scene');
      }
      const startFusion = performance.now();
      if (revision !== this.revision) return { duration: performance.now() - started };
      if (!compatible(engines, startFusion, this.config.input === 'still')) return { duration: performance.now() - started, note: '結果の有効期限切れ。低解像度・静止画で再試行してください。' };
      if (experiment === 'objects' || experiment === 'temporal') for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) relations.push({ a: entities[i].id, b: entities[j].id, distance: Math.hypot(entities[i].center.x - entities[j].center.x, entities[i].center.y - entities[j].center.y), iou: iou(entities[i].box, entities[j].box) });
      const data: MultiData = { frameId, capturedAt, processedAt: performance.now(), expiresAt: capturedAt + this.config.ttl, engines, entities, relations, events: [], fusionMs: 0, note: combinations[experiment] };
      this.history.update(data, this.config, this.config.input === 'continuous'); data.fusionMs = performance.now() - startFusion;
      return { duration: performance.now() - started, multi: data };
    } finally { this.busy = false; if (this.disposed) this.frame.width = this.frame.height = 1; }
  }
  dispose() { this.disposed = true; for (const child of this.children.values()) child.dispose(); this.children.clear(); this.history.reset(); if (!this.busy) this.frame.width = this.frame.height = 1; }
}
