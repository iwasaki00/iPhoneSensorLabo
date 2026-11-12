import { sceneColors, type SceneData } from './models.ts';
import type { SceneSettings } from './settings';
export function sceneComposite(source: Uint8ClampedArray, width: number, height: number, data: SceneData, settings: SceneSettings) {
  if (data.categories.length !== data.width * data.height) throw new Error('風景マスクのサイズが一致しません');
  const result = new Uint8ClampedArray(source), tint = [1, 3, 5].map(i => parseInt(settings.color.slice(i, i + 2), 16)), tintGray = Math.max(1, tint[0] * .299 + tint[1] * .587 + tint[2] * .114);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const id = data.categories[Math.min(data.height - 1, Math.floor(y * data.height / height)) * data.width + Math.min(data.width - 1, Math.floor(x * data.width / width))];
    const color = sceneColors[data.model][id]; if (!color) throw new Error('風景モデルのカテゴリ定義が不正です');
    const p = (y * width + x) * 4, selected = id === settings.target, gray = source[p] * .299 + source[p + 1] * .587 + source[p + 2] * .114;
    for (let c = 0; c < 3; c++) {
      if (settings.display === 'mask') result[p + c] = color[c];
      if (settings.display === 'overlay') result[p + c] = source[p + c] * .45 + color[c] * .55;
      if (settings.display === 'highlight') result[p + c] = selected ? source[p + c] * .4 + color[c] * .6 : gray * .3;
      if (settings.display === 'mono' && selected || settings.display === 'outside-mono' && !selected) result[p + c] = gray;
      if (settings.display === 'tint' && selected) result[p + c] = source[p + c] * .25 + Math.min(255, tint[c] / tintGray * gray) * .75;
      if (settings.display === 'brightness' && selected) result[p + c] = source[p + c] * settings.brightness / 100;
      if (settings.display === 'solid' && selected) result[p + c] = tint[c];
    }
    result[p + 3] = 255;
  }
  return result;
}
