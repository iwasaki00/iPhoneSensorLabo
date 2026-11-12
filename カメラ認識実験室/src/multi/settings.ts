export const combinations = {
  'object-color': '物体＋色', 'color-motion': '色＋動体', objects: '複数物体',
  'object-motion': '物体＋動体', 'person-object': '人物＋物体', temporal: '時系列認識', 'object-scene': '物体＋風景（静止画）'
} as const;
export type Combination = keyof typeof combinations;
export type MultiSettings = {
  experiment: Combination; input: 'still' | 'continuous'; resolution: number; interval: number;
  loadMode: 'auto' | 'manual'; ttl: number; confidence: number; ratio: number;
  distance: number; speed: number; dwell: number; hysteresis: number;
  boxes: boolean; relations: boolean; trails: boolean; masks: boolean;
};
export const MULTI_KEY = 'camera-vision-lab.multi.v1';
export const multiDefaults: MultiSettings = { experiment: 'object-color', input: 'still', resolution: 320, interval: 500, loadMode: 'auto', ttl: 5000, confidence: .5, ratio: .15, distance: .25, speed: .04, dwell: 500, hysteresis: .03, boxes: true, relations: true, trails: true, masks: true };
export function parseMulti(text: string | null): MultiSettings {
  let value: any; try { value = JSON.parse(text || '{}'); } catch { /* defaults */ }
  value = value && typeof value === 'object' ? value : {};
  const s = { ...multiDefaults };
  if (Object.hasOwn(combinations, value.experiment)) s.experiment = value.experiment;
  if (value.input === 'continuous' && s.experiment !== 'object-scene') s.input = 'continuous';
  if ([160, 320, 480].includes(value.resolution)) s.resolution = value.resolution;
  if ([200, 500, 1000, 2000].includes(value.interval)) s.interval = value.interval;
  if (value.loadMode === 'manual') s.loadMode = 'manual';
  for (const [key, min, max] of [['ttl', 1000, 15000], ['confidence', .1, .95], ['ratio', .01, .9], ['distance', .05, .8], ['speed', .005, .5], ['dwell', 0, 3000], ['hysteresis', .005, .1]] as const)
    if (Number.isFinite(value[key])) s[key] = Math.min(max, Math.max(min, value[key]));
  for (const key of ['boxes', 'relations', 'trails', 'masks'] as const) if (typeof value[key] === 'boolean') s[key] = value[key];
  return s;
}
export function loadMulti() { try { return parseMulti(localStorage.getItem(MULTI_KEY)); } catch { return parseMulti(null); } }
export function saveMulti(s: MultiSettings) { try { localStorage.setItem(MULTI_KEY, JSON.stringify(s)); return true; } catch { return false; } }
