export type SegmentModel = 'person' | 'multiclass';
export type SegmentTab = 'person' | 'parts' | 'background' | 'partial';
export type SegmentSettings = {
  tab: SegmentTab;
  personView: 'original' | 'highlight' | 'person' | 'background' | 'mask';
  background: 'blur' | 'solid' | 'image' | 'dark';
  partial: 'hair' | 'clothes' | 'mono' | 'outside-mono';
  target: number; color: string; blur: number; boundary: number;
  resolution: number; interval: number;
  loadMode: 'auto' | 'manual'; smoothing: boolean; temporal: number; maskTtl: number;
};
export const SEGMENT_KEY = 'camera-vision-lab.segmentation.v1';
export const segmentDefaults: SegmentSettings = { tab: 'person', personView: 'highlight', background: 'blur', partial: 'hair', target: 1, color: '#744cce', blur: 10, boundary: 35, resolution: 256, interval: 200, loadMode: 'auto', smoothing: true, temporal: 50, maskTtl: 2000 };
export function modelForTab(tab: SegmentTab): SegmentModel { return tab === 'parts' || tab === 'partial' ? 'multiclass' : 'person'; }
export function parseSegmentSettings(text: string | null): SegmentSettings {
  let v: Partial<SegmentSettings> = {};
  try { const parsed = JSON.parse(text ?? '{}'); if (parsed && typeof parsed === 'object') v = parsed; } catch { /* defaults */ }
  const choice = <T extends string>(value: unknown, options: T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;
  const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    tab: choice(v.tab, ['person', 'parts', 'background', 'partial'], 'person'),
    personView: choice(v.personView, ['original', 'highlight', 'person', 'background', 'mask'], 'highlight'),
    background: choice(v.background, ['blur', 'solid', 'image', 'dark'], 'blur'),
    partial: choice(v.partial, ['hair', 'clothes', 'mono', 'outside-mono'], 'hair'),
    target: [0, 1, 2, 3, 4, 5].includes(v.target!) ? v.target! : 1,
    color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : segmentDefaults.color,
    blur: number(v.blur, 10, 0, 24), boundary: number(v.boundary, 35, 0, 100),
    resolution: [160, 256, 384].includes(v.resolution!) ? v.resolution! : 256,
    interval: [100, 200, 500, 1000].includes(v.interval!) ? v.interval! : 200,
    loadMode: choice(v.loadMode, ['auto', 'manual'], 'auto'), smoothing: typeof v.smoothing === 'boolean' ? v.smoothing : true,
    temporal: number(v.temporal, 50, 0, 100), maskTtl: number(v.maskTtl, 2000, 500, 5000)
  };
}
export function loadSegmentSettings(): SegmentSettings { try { return parseSegmentSettings(localStorage.getItem(SEGMENT_KEY)); } catch { return parseSegmentSettings(null); } }
export function saveSegmentSettings(value: SegmentSettings): boolean { try { localStorage.setItem(SEGMENT_KEY, JSON.stringify(value)); return true; } catch { return false; } }
