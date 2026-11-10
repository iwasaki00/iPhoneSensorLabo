export type ModeId = 'object' | 'color' | 'motion' | 'shape';
export type ViewId = 'normal' | 'before' | 'after' | 'split';
export type HSV = { h: number; s: number; v: number };
export type Settings = {
  mode: ModeId; view: ViewId; target: HSV;
  hueTolerance: number; saturationTolerance: number; valueTolerance: number;
  motionSensitivity: number; shapeSensitivity: number; minArea: number;
};
export const STORAGE_KEY = 'camera-vision-lab.v2';
export const defaults: Settings = {
  mode: 'object', view: 'normal', target: { h: 0, s: 0.75, v: 0.8 },
  hueTolerance: 22, saturationTolerance: 35, valueTolerance: 35,
  motionSensitivity: 60, shapeSensitivity: 60, minArea: 40
};
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export function parseSettings(text: string | null): Settings {
  let v: Partial<Settings> = {};
  try { const parsed = JSON.parse(text ?? '{}'); if (parsed && typeof parsed === 'object') v = parsed; } catch { /* use defaults */ }
  return {
    mode: ['object', 'color', 'motion', 'shape'].includes(v.mode ?? '') ? v.mode! : defaults.mode,
    view: ['normal', 'before', 'after', 'split'].includes(v.view ?? '') ? v.view! : defaults.view,
    target: { h: clamp(v.target?.h, 0, 0, 359), s: clamp(v.target?.s, 0.75, 0, 1), v: clamp(v.target?.v, 0.8, 0, 1) },
    hueTolerance: clamp(v.hueTolerance, 22, 1, 90),
    saturationTolerance: clamp(v.saturationTolerance, 35, 5, 100),
    valueTolerance: clamp(v.valueTolerance, 35, 5, 100),
    motionSensitivity: clamp(v.motionSensitivity, 60, 1, 100),
    shapeSensitivity: clamp(v.shapeSensitivity, 60, 1, 100),
    minArea: Math.round(clamp(v.minArea, 40, 8, 1000))
  };
}
export function loadSettings(): Settings { try { return parseSettings(localStorage.getItem(STORAGE_KEY)); } catch { return parseSettings(null); } }
export function saveSettings(settings: Settings): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); return true; } catch { return false; }
}
