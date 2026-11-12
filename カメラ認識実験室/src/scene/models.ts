import catalog from './catalog.json' with { type: 'json' };
export type SceneModel = 'ade20k' | 'cityscapes';
export const sceneModels = catalog;
// The official ADE20K palette shares gray for road (7) and skyscraper (49).
export const sceneColors = { ade20k: catalog.ade20k.colors.map((color, id) => id === 49 ? [255, 255, 255] : color), cityscapes: catalog.cityscapes.colors };
const japanese: Record<string, string> = { background: '背景・未分類', wall: '壁', building: '建物', sky: '空', floor: '床', tree: '木', ceiling: '天井', road: '道路', grass: '草', plant: '植物', sidewalk: '歩道', person: '人物', earth: '地面', mountain: '山', water: '水', sea: '海', sand: '砂', car: '車', chair: '椅子', table: 'テーブル', sofa: 'ソファ', bed: 'ベッド', cabinet: '収納棚', windowpane: '窓', door: 'ドア', fence: '柵', vegetation: '植物', terrain: '地面', pole: '柱', 'traffic light': '信号', 'traffic sign': '道路標識', rider: '乗員', truck: 'トラック', bus: 'バス', train: '列車', motorcycle: 'バイク', bicycle: '自転車' };
export function sceneLabel(model: SceneModel, id: number) { const name = sceneModels[model].labels[id]; return name === undefined ? '未対応のカテゴリID' : japanese[name] ?? name; }
export type SceneData = { model: SceneModel; width: number; height: number; categories: Uint8Array; duration: number; backend: string; tensors: number; tensorBytes: number; memoryReliable: boolean };
export function sceneOccupancy(data: Pick<SceneData, 'model' | 'categories'>) {
  const counts = new Array<number>(sceneModels[data.model].labels.length).fill(0);
  for (const id of data.categories) { if (id >= counts.length) throw new Error('風景モデルのカテゴリIDが定義と一致しません'); counts[id]++; }
  return counts.map((count, id) => ({ id, name: sceneLabel(data.model, id), ratio: data.categories.length ? count / data.categories.length : 0 })).filter(item => item.ratio > 0).sort((a, b) => b.ratio - a.ratio);
}
