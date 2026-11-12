import type { SceneModel } from './models';
import { sceneModels } from './models.ts';
export const SCENE_KEY = 'camera-vision-lab.scene.v1';
export type SceneSettings = { model: SceneModel; input: 'still' | 'continuous'; context: 'indoor' | 'outdoor' | 'mixed'; display: 'original' | 'mask' | 'overlay' | 'highlight' | 'tint' | 'mono' | 'outside-mono' | 'brightness' | 'solid'; target: number; color: string; brightness: number; resolution: number; interval: number; loadMode: 'auto' | 'manual' };
export const sceneDefaults: SceneSettings = { model: 'ade20k', input: 'still', context: 'mixed', display: 'overlay', target: 3, color: '#825cf5', brightness: 130, resolution: 257, interval: 2000, loadMode: 'auto' };
export function parseSceneSettings(text: string | null): SceneSettings {
  let v: Partial<SceneSettings> = {}; try { const parsed = JSON.parse(text || '{}'); if (parsed && typeof parsed === 'object') v = parsed; } catch { /* defaults */ }
  const pick = <T>(value: unknown, allowed: T[], fallback: T) => allowed.includes(value as T) ? value as T : fallback;
  const model: SceneModel = pick(v.model, ['ade20k', 'cityscapes'], 'ade20k');
  return { model, input: pick(v.input, ['still', 'continuous'], 'still'), context: pick(v.context, ['indoor', 'outdoor', 'mixed'], 'mixed'), display: pick(v.display, ['original', 'mask', 'overlay', 'highlight', 'tint', 'mono', 'outside-mono', 'brightness', 'solid'], 'overlay'), target: typeof v.target === 'number' && Number.isInteger(v.target) && v.target >= 0 && v.target < sceneModels[model].labels.length ? v.target : sceneModels[model].labels.indexOf('sky'), color: typeof v.color === 'string' && /^#[a-f0-9]{6}$/i.test(v.color) ? v.color : sceneDefaults.color, brightness: typeof v.brightness === 'number' && Number.isFinite(v.brightness) ? Math.max(0, Math.min(200, v.brightness)) : 130, resolution: pick(v.resolution, [160, 257, 384], 257), interval: pick(v.interval, [1000, 2000, 5000, 10000], 2000), loadMode: pick(v.loadMode, ['auto', 'manual'], 'auto') };
}
export function loadSceneSettings() { try { return parseSceneSettings(localStorage.getItem(SCENE_KEY)); } catch { return parseSceneSettings(null); } }
export function saveSceneSettings(settings: SceneSettings) { try { localStorage.setItem(SCENE_KEY, JSON.stringify(settings)); return true; } catch { return false; } }
