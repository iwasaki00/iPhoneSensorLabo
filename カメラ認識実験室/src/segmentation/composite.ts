import { type SegmentData, occupancy } from './models.ts';
import type { SegmentSettings } from './settings.ts';
export type LocalImage = { data: Uint8ClampedArray; width: number; height: number };
export const palette = [[18, 25, 35], [189, 109, 255], [255, 181, 90], [250, 120, 152], [80, 208, 235], [147, 225, 115]];
export function blurChannel(input: Float32Array, width: number, height: number, radius: number): Float32Array {
  radius = Math.round(radius);
  if (!radius) return new Float32Array(input);
  const horizontal = new Float32Array(input.length), output = new Float32Array(input.length), length = 2 * radius + 1;
  const clamp = (i: number, limit: number) => Math.max(0, Math.min(limit - 1, i));
  for (let y = 0; y < height; y++) {
    let sum = 0; for (let dx = -radius; dx <= radius; dx++) sum += input[y * width + clamp(dx, width)];
    for (let x = 0; x < width; x++) { horizontal[y * width + x] = sum / length; sum += input[y * width + clamp(x + radius + 1, width)] - input[y * width + clamp(x - radius, width)]; }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0; for (let dy = -radius; dy <= radius; dy++) sum += horizontal[clamp(dy, height) * width + x];
    for (let y = 0; y < height; y++) { output[y * width + x] = sum / length; sum += horizontal[clamp(y + radius + 1, height) * width + x] - horizontal[clamp(y - radius, height) * width + x]; }
  }
  return output;
}
function rgb(hex: string) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function gray(r: number, g: number, b: number) { return r * 0.299 + g * 0.587 + b * 0.114; }
export type CompositeMask = { alpha: Float32Array; rates: number[] };
/** Rebuilt only when the mask or effect settings change, not on every live frame. */
export function prepareCompositeMask(data: SegmentData, settings: SegmentSettings): CompositeMask {
  const width = data.sourceWidth, height = data.sourceHeight, alpha = new Float32Array(width * height);
  const target = settings.partial === 'hair' ? 1 : settings.partial === 'clothes' ? 4 : settings.target;
  const margin = settings.boundary / 100 * 0.35;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, index = Math.min(data.height - 1, Math.floor(y * data.height / height)) * data.width + Math.min(data.width - 1, Math.floor(x * data.width / width));
    const value = settings.tab === 'partial' ? (data.categories[index] === target ? 1 : 0) : data.foreground[index];
    const t = margin ? Math.max(0, Math.min(1, (value - 0.5 + margin) / (2 * margin))) : (value >= 0.5 ? 1 : 0);
    alpha[i] = t * t * (3 - 2 * t);
  }
  return { alpha: blurChannel(alpha, width, height, Math.round(settings.boundary / 25)), rates: occupancy(data) };
}
export function composite(data: SegmentData, settings: SegmentSettings, image?: LocalImage, prepared?: CompositeMask): { pixels: Uint8ClampedArray; reason: string } {
  const { source, sourceWidth: width, sourceHeight: height } = data, count = width * height;
  const result = new Uint8ClampedArray(source), target = settings.partial === 'hair' ? 1 : settings.partial === 'clothes' ? 4 : settings.target;
  const { alpha: smooth, rates } = prepared ?? prepareCompositeMask(data, settings);
  if (settings.tab === 'partial' && data.model !== 'multiclass') return { pixels: result, reason: 'このモデルは部位別認識に未対応です。加工しません。' };
  if (settings.tab === 'partial' && (rates[target] ?? 0) < 0.001) return { pixels: result, reason: '対象部位が検出されていないため、加工しません（占有率0.1%未満）。' };
  if (settings.tab === 'background' && settings.background === 'image' && !image) return { pixels: result, reason: '端末内の背景画像を選択してください。画像未選択のため加工しません。' };
  const color = rgb(settings.color), tintGray = Math.max(1, gray(color[0], color[1], color[2]));
  let blurred: Float32Array[] | undefined;
  if (settings.tab === 'background' && settings.background === 'blur') blurred = [0, 1, 2].map(channel => blurChannel(Float32Array.from({ length: count }, (_, i) => source[i * 4 + channel]), width, height, settings.blur));
  const imageScale = image ? Math.max(width / image.width, height / image.height) : 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = i * 4, a = smooth[i], sourceGray = gray(source[p], source[p + 1], source[p + 2]);
    const maskIndex = Math.min(data.height - 1, Math.floor(y * data.height / height)) * data.width + Math.min(data.width - 1, Math.floor(x * data.width / width));
    if (settings.tab === 'parts') {
      const maskColor = palette[data.categories[maskIndex]] ?? palette[0];
      for (let c = 0; c < 3; c++) result[p + c] = source[p + c] * 0.4 + maskColor[c] * 0.6;
    } else if (settings.tab === 'person') {
      for (let c = 0; c < 3; c++) {
        if (settings.personView === 'highlight') result[p + c] = source[p + c] * (1 - a * 0.55) + [88, 239, 177][c] * a * 0.55;
        if (settings.personView === 'mask') result[p + c] = a * 255;
        if (settings.personView === 'person') result[p + c] = source[p + c] * a;
        if (settings.personView === 'background') result[p + c] = source[p + c] * (1 - a);
      }
    } else if (settings.tab === 'background') {
      let imageIndex = 0;
      if (image) {
        const ix = Math.min(image.width - 1, Math.max(0, Math.floor((x + (image.width * imageScale - width) / 2) / imageScale)));
        const iy = Math.min(image.height - 1, Math.max(0, Math.floor((y + (image.height * imageScale - height) / 2) / imageScale)));
        imageIndex = (iy * image.width + ix) * 4;
      }
      for (let c = 0; c < 3; c++) {
        const background = settings.background === 'blur' ? blurred![c][i] : settings.background === 'solid' ? color[c] : settings.background === 'dark' ? source[p + c] * 0.22 : image!.data[imageIndex + c];
        result[p + c] = source[p + c] * a + background * (1 - a);
      }
    } else {
      const amount = settings.partial === 'outside-mono' ? 1 - a : a;
      for (let c = 0; c < 3; c++) {
        const effect = settings.partial === 'mono' || settings.partial === 'outside-mono' ? sourceGray : source[p + c] * 0.25 + Math.min(255, color[c] / tintGray * sourceGray) * 0.75;
        result[p + c] = source[p + c] * (1 - amount) + effect * amount;
      }
    }
    result[p + 3] = 255;
  }
  return { pixels: result, reason: settings.tab === 'person' || settings.tab === 'background' ? (rates.slice(1).reduce((a, b) => a + b, 0) < 0.001 ? '人物領域がほとんど検出されていません。照明・距離・向きを調整してください。' : '') : '' };
}
