import type { MultiData } from './fusion.ts';
import { combinations, type MultiSettings } from './settings.ts';
export type TargetRecord = { id: string; category: string; center: { x: number; y: number }; box: { x: number; y: number; width: number; height: number }; area: number; confidence?: number };
export type MultiRecord = { experiment: string; input: string; inputId?: string; frameId: string; targets: TargetRecord[]; engines: { name: string; duration: number }[]; fusionMs: number; thresholds: { confidence: number; ratio: number; distance: number; speed: number; dwell: number; hysteresis: number; ttl: number }; events: { type: string; at: string; frameId: string; target: string; evidence: string }[]; relations: { a: string; b: string; distance?: number; iou?: number; coverage?: number; category?: string }[] };
export function multiRecord(data: MultiData, s: MultiSettings, inputId?: string): MultiRecord {
  const { confidence, ratio, distance, speed, dwell, hysteresis, ttl } = s;
  return { experiment: s.experiment, input: s.input, ...(inputId ? { inputId } : {}), frameId: data.frameId, targets: data.entities.map(({ id, category, center, box, area, confidence }) => ({ id, category, center, box, area, ...(confidence === undefined ? {} : { confidence }) })), engines: data.engines.map(e => ({ name: e.engine, duration: e.duration })), fusionMs: data.fusionMs, thresholds: { confidence, ratio, distance, speed, dwell, hysteresis, ttl }, events: data.events, relations: data.relations.map(({ a, b, distance, iou, coverage, category }) => ({ a, b, distance, iou, coverage, category })) };
}
/** Metadata allowlist: never serialize entities, masks or pixel arrays from an engine. */
export function parseMultiRecord(value: any): MultiRecord | undefined {
  const string = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length <= max;
  const number = (v: unknown, max = 1e8): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const t = value?.thresholds;
  if (!value || !Object.hasOwn(combinations, value.experiment) || !['still', 'continuous'].includes(value.input) || !string(value.frameId, 64) || !number(value.fusionMs) || !t || !['confidence', 'ratio', 'distance', 'speed', 'dwell', 'hysteresis', 'ttl'].every(key => number(t[key], key === 'dwell' || key === 'ttl' ? 15000 : 1))) return;
  if (!Array.isArray(value.engines) || value.engines.length > 3 || !value.engines.every((e: any) => e && string(e.name) && number(e.duration))) return;
  const targets = value.targets ?? [];
  if (value.inputId !== undefined && !string(value.inputId, 64)) return;
  if (!Array.isArray(targets) || targets.length > 24 || !targets.every((t: any) => t && string(t.id, 64) && string(t.category, 120) && t.center && ['x', 'y'].every(k => number(t.center[k], 1)) && t.box && ['x', 'y', 'width', 'height'].every(k => number(t.box[k], 1)) && number(t.area, 1) && (t.confidence === undefined || number(t.confidence, 1)))) return;
  if (!Array.isArray(value.events) || value.events.length > 100 || !value.events.every((e: any) => e && string(e.type, 32) && string(e.at, 40) && Number.isFinite(Date.parse(e.at)) && string(e.frameId, 64) && string(e.target, 120) && string(e.evidence))) return;
  if (!Array.isArray(value.relations) || value.relations.length > 3020 || !value.relations.every((r: any) => r && string(r.a, 64) && string(r.b, 64) && (r.distance === undefined || number(r.distance, 2)) && (r.iou === undefined || number(r.iou, 1)) && (r.coverage === undefined || number(r.coverage, 1)) && (r.category === undefined || string(r.category, 120)))) return;
  return { experiment: value.experiment, input: value.input, frameId: value.frameId, fusionMs: value.fusionMs,
    ...(value.inputId === undefined ? {} : { inputId: value.inputId }),
    targets: targets.map((t: TargetRecord) => ({ id: t.id, category: t.category, center: { x: t.center.x, y: t.center.y }, box: { x: t.box.x, y: t.box.y, width: t.box.width, height: t.box.height }, area: t.area, ...(t.confidence === undefined ? {} : { confidence: t.confidence }) })),
    engines: value.engines.map((e: any) => ({ name: e.name, duration: e.duration })),
    thresholds: { confidence: t.confidence, ratio: t.ratio, distance: t.distance, speed: t.speed, dwell: t.dwell, hysteresis: t.hysteresis, ttl: t.ttl },
    events: value.events.map((e: any) => ({ type: e.type, at: e.at, frameId: e.frameId, target: e.target, evidence: e.evidence })),
    relations: value.relations.map((r: any) => ({ a: r.a, b: r.b, distance: r.distance, iou: r.iou, ...(r.coverage === undefined ? {} : { coverage: r.coverage }), ...(r.category === undefined ? {} : { category: r.category }) })) };
}
