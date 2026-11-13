import { parseMultiRecord, type MultiRecord } from './multi/record.ts';
import { parseTextRecord, type TextRecord } from './textmarker/record.ts';
export const RECORD_KEY = 'camera-vision-lab.experiments.v1';
export const RECORD_LIMIT = 50;
export type Experiment = {
  textLab?:TextRecord;
  multi?: MultiRecord;
  version: string; at: string; mode: string; model: string; resolution: string;
  renderFPS: number | null; inferenceFPS: number | null; averageMs: number | null; maximumMs: number | null;
  waitMs: number; loadMode: string; runtime: string; userAgent: string; language: string; platform: string; cores: number | null;
  scene?: { context: string; inputKind: string; inputId: string; modelBytes: number; loadMs: number | null; inferenceMs: number | null; internalResolution?: string; categories: { id: number; name: string; ratio: number }[] };
};
const fields: (keyof Experiment)[] = ['version', 'at', 'mode', 'model', 'resolution', 'renderFPS', 'inferenceFPS', 'averageMs', 'maximumMs', 'waitMs', 'loadMode', 'runtime', 'userAgent', 'language', 'platform', 'cores'];
export function readRecords(text: string | null): Experiment[] {
  try {
    const values: unknown = JSON.parse(text || '[]');
    if (!Array.isArray(values)) return [];
    return values.filter(v => v && typeof v === 'object' && typeof v.at === 'string' && Number.isFinite(Date.parse(v.at)) && fields.every(key => ['renderFPS', 'inferenceFPS', 'averageMs', 'maximumMs', 'cores'].includes(key) ? v[key] === null || (typeof v[key] === 'number' && Number.isFinite(v[key]) && v[key] >= 0) : key === 'waitMs' ? typeof v[key] === 'number' && v[key] >= 0 && v[key] <= 60000 : typeof v[key] === 'string' && v[key].length <= 2048))
      .slice(-RECORD_LIMIT).map(v => {
        const record = Object.fromEntries(fields.map(key => [key, v[key]])) as Experiment;
        const textLab=parseTextRecord(v.textLab);if(textLab)record.textLab=textLab;
        const multi = parseMultiRecord(v.multi); if (multi) record.multi = multi;
        const scene = v.scene;
        if (scene && ['indoor', 'outdoor', 'mixed'].includes(scene.context) && ['still', 'continuous'].includes(scene.inputKind) && typeof scene.inputId === 'string' && scene.inputId.length <= 64 && Number.isFinite(scene.modelBytes) && scene.modelBytes > 0 && ['loadMs', 'inferenceMs'].every(key => scene[key] === null || typeof scene[key] === 'number' && Number.isFinite(scene[key]) && scene[key] >= 0) && Array.isArray(scene.categories) && scene.categories.length <= 151 && scene.categories.every((c: any) => c && Number.isInteger(c.id) && c.id >= 0 && c.id <= 150 && typeof c.name === 'string' && c.name.length <= 120 && typeof c.ratio === 'number' && Number.isFinite(c.ratio) && c.ratio >= 0 && c.ratio <= 1)) record.scene = { context: scene.context, inputKind: scene.inputKind, inputId: scene.inputId, modelBytes: scene.modelBytes, loadMs: scene.loadMs, inferenceMs: scene.inferenceMs, categories: scene.categories.map(({ id, name, ratio }: { id: number; name: string; ratio: number }) => ({ id, name, ratio })) };
        if (record.scene && typeof scene.internalResolution === 'string' && /^(161|257|385)×\1$/.test(scene.internalResolution)) record.scene.internalResolution = scene.internalResolution;
        return record;
      });
  } catch { return []; }
}
export function exportRecords(records: Experiment[], type: 'json' | 'csv') {
  // Serialize only an explicit metadata allowlist, even if storage was modified externally.
  const safe = readRecords(JSON.stringify(records));
  if (type === 'json') return JSON.stringify(safe, null, 2) + '\n';
  const quote = (value: unknown) => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
  const extra = ['sceneContext', 'inputKind', 'inputId', 'modelBytes', 'loadMs', 'inferenceMs', 'internalResolution', 'categoryOccupancy', 'multiExperiment', 'multiInput', 'multiFrameId', 'multiEngines', 'fusionMs', 'multiThresholds', 'multiEvents', 'multiRelations', 'multiTargets', 'multiInputId', 'textLabMetadata'];
  return [[...fields, ...extra].join(','), ...safe.map(record => [...fields.map(key => quote(record[key])), ...[record.scene?.context, record.scene?.inputKind, record.scene?.inputId, record.scene?.modelBytes, record.scene?.loadMs, record.scene?.inferenceMs, record.scene?.internalResolution, record.scene ? JSON.stringify(record.scene.categories) : '', record.multi?.experiment, record.multi?.input, record.multi?.frameId, record.multi ? JSON.stringify(record.multi.engines) : '', record.multi?.fusionMs, record.multi ? JSON.stringify(record.multi.thresholds) : '', record.multi ? JSON.stringify(record.multi.events) : '', record.multi ? JSON.stringify(record.multi.relations) : '', record.multi ? JSON.stringify(record.multi.targets) : '', record.multi?.inputId, record.textLab ? JSON.stringify(record.textLab) : ''].map(quote)].join(','))].join('\n') + '\n';
}
export function bindExperiments(snapshot: () => Experiment | null) {
  const el = (id: string) => document.getElementById(id)!;
  let records: Experiment[] = [];
  try { records = readRecords(localStorage.getItem(RECORD_KEY)); } catch { /* memory only */ }
  const display = () => { el('record-list').textContent = `${records.length}/${RECORD_LIMIT}件（上限を超えると最古から削除）\n` + records.slice(-5).reverse().map(r => `${new Date(r.at).toLocaleString()} / ${r.mode} / ${r.model}\n描画 ${r.renderFPS?.toFixed(1) ?? '—'} FPS / 推論 ${r.inferenceFPS?.toFixed(1) ?? '—'} FPS / 平均 ${r.averageMs?.toFixed(1) ?? '—'} ms`).join('\n'); };
  const persist = () => { try { localStorage.setItem(RECORD_KEY, JSON.stringify(records)); el('record-status').textContent = 'ブラウザ内に保存しました。映像・画像は含みません。'; } catch { el('record-status').textContent = '保存できません。現在のタブ内で保持し、エクスポートできます。'; } display(); };
  el('record-save').onclick = () => { const record = snapshot(); if (!record) { el('record-status').textContent = '認識結果を取得してから記録してください。'; return; } records.push(record); records = records.slice(-RECORD_LIMIT); persist(); };
  el('record-trim').onclick = () => { records = records.slice(-10); persist(); };
  el('record-clear').onclick = () => { records = []; persist(); };
  for (const type of ['json', 'csv'] as const) el('record-' + type).onclick = () => {
    const url = URL.createObjectURL(new Blob([type === 'csv' ? '\ufeff' : '', exportRecords(records, type)], { type: type === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `camera-lab-${new Date().toISOString().slice(0, 10)}.${type}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  display();
}
