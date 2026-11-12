export const RECORD_KEY = 'camera-vision-lab.experiments.v1';
export const RECORD_LIMIT = 50;
export type Experiment = {
  version: string; at: string; mode: string; model: string; resolution: string;
  renderFPS: number | null; inferenceFPS: number | null; averageMs: number | null; maximumMs: number | null;
  waitMs: number; loadMode: string; runtime: string; userAgent: string; language: string; platform: string; cores: number | null;
};
const fields: (keyof Experiment)[] = ['version', 'at', 'mode', 'model', 'resolution', 'renderFPS', 'inferenceFPS', 'averageMs', 'maximumMs', 'waitMs', 'loadMode', 'runtime', 'userAgent', 'language', 'platform', 'cores'];
export function readRecords(text: string | null): Experiment[] {
  try {
    const values: unknown = JSON.parse(text || '[]');
    if (!Array.isArray(values)) return [];
    return values.filter(v => v && typeof v === 'object' && typeof v.at === 'string' && Number.isFinite(Date.parse(v.at)) && fields.every(key => ['renderFPS', 'inferenceFPS', 'averageMs', 'maximumMs', 'cores'].includes(key) ? v[key] === null || (typeof v[key] === 'number' && Number.isFinite(v[key]) && v[key] >= 0) : key === 'waitMs' ? typeof v[key] === 'number' && v[key] >= 0 && v[key] <= 60000 : typeof v[key] === 'string' && v[key].length <= 2048))
      .slice(-RECORD_LIMIT).map(v => Object.fromEntries(fields.map(key => [key, v[key]])) as Experiment);
  } catch { return []; }
}
export function exportRecords(records: Experiment[], type: 'json' | 'csv') {
  // Serialize only an explicit metadata allowlist, even if storage was modified externally.
  const safe = readRecords(JSON.stringify(records));
  if (type === 'json') return JSON.stringify(safe, null, 2) + '\n';
  const quote = (value: unknown) => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
  return [fields.join(','), ...safe.map(record => fields.map(key => quote(record[key])).join(','))].join('\n') + '\n';
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
