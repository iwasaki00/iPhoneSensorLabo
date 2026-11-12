import { sceneModels, sceneColors, sceneLabel, sceneOccupancy, type SceneData } from './models';
import { saveSceneSettings, type SceneSettings } from './settings';
import { sceneComposite } from './composite';
import { displayPanes, sourcePoint } from '../display';
import type { VisionRenderer } from '../render';
import type { ViewId } from '../settings';
import { internalSceneSize } from './resize';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export class ScenePanel {
  readonly input = document.createElement('canvas');
  private before = document.createElement('canvas');
  private after = document.createElement('canvas');
  data?: SceneData;
  hasStill = false;
  mirror = false;
  inputId = '';
  count = 0;
  /** Reuse still-image acquisition without overwriting the scene mode's saved input. */
  inputOverride?: 'still' | 'continuous';
  private fileGeneration = 0;
  private settings: SceneSettings;
  private renderer: VisionRenderer;
  constructor(settings: SceneSettings, renderer: VisionRenderer, change: (reload: boolean, analyze: boolean, invalidate: boolean) => void) {
    this.settings = settings; this.renderer = renderer;
    const fields: [keyof SceneSettings, string, boolean?][] = [['model', 'scene-model'], ['input', 'scene-input'], ['context', 'scene-context'], ['display', 'scene-display'], ['target', 'scene-target', true], ['color', 'scene-color'], ['brightness', 'scene-brightness', true], ['resolution', 'scene-resolution', true], ['interval', 'scene-interval', true], ['loadMode', 'scene-load']];
    for (const [key, id, numeric] of fields) {
      const input = el<HTMLInputElement>(id); input.value = String(settings[key]);
      input.addEventListener(input.type === 'range' || input.type === 'color' ? 'input' : 'change', () => {
        const oldLabel = sceneModels[settings.model].labels[settings.target];
        Object.assign(settings, { [key]: numeric ? Number(input.value) : input.value });
        if (key === 'model') { const next = sceneModels[settings.model].labels.indexOf(oldLabel); settings.target = Math.max(0, next); }
        el('storage-status').hidden = saveSceneSettings(settings); this.sync();
        const invalidate = key === 'model' || key === 'input' || key === 'resolution';
        if (invalidate) this.clear(); else this.render();
        change(key === 'model' || key === 'resolution', invalidate && settings.input === 'still' && this.hasStill, invalidate);
      });
    }
    el<HTMLInputElement>('scene-file').onchange = async event => {
      const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
      const token = ++this.fileGeneration;
      if (file.size > 20 * 1024 * 1024) { el('scene-message').textContent = '20MB以下の画像を選択してください。'; return; }
      const url = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = url; await image.decode();
        if (token !== this.fileGeneration) return;
        this.setInput(image, image.naturalWidth, image.naturalHeight, false);
        if (this.inputOverride !== undefined) this.inputOverride = 'still'; else { settings.input = 'still'; el('storage-status').hidden = saveSceneSettings(settings); }
        this.sync(); change(false, true, true);
      } catch { if (token === this.fileGeneration) el('scene-message').textContent = '画像を読み込めません。PNG・JPEG・WebPなど表示できる画像で再試行してください。'; }
      finally { URL.revokeObjectURL(url); }
    };
    el('scene-clear-image').onclick = () => { this.releaseInput(); change(false, false, true); };
    this.sync();
  }
  private setInput(source: CanvasImageSource, width: number, height: number, mirror: boolean) {
    const scale = Math.min(1, 1024 / Math.max(width, height));
    this.input.width = Math.max(1, Math.round(width * scale)); this.input.height = Math.max(1, Math.round(height * scale));
    this.input.getContext('2d')!.drawImage(source, 0, 0, this.input.width, this.input.height);
    this.hasStill = true; this.mirror = mirror; this.inputId = crypto.randomUUID(); this.clear(); this.showInput();
    el('scene-message').textContent = '画像はこのタブのメモリ内だけで保持します。同じ画像のままモデルを切り替えて比較できます。';
  }
  capture(video: HTMLVideoElement, mirror: boolean) {
    if (video.readyState < 2 || !video.videoWidth) throw new Error('カメラを起動してから1フレームを取得してください。');
    this.fileGeneration++; this.setInput(video, video.videoWidth, video.videoHeight, mirror);
    if (this.inputOverride !== undefined) this.inputOverride = 'still'; else { this.settings.input = 'still'; saveSceneSettings(this.settings); }
    this.sync();
  }
  showInput() { if (this.hasStill && !this.data && (this.inputOverride ?? this.settings.input) === 'still') this.renderer.setSceneFrames(this.input, undefined, this.mirror, false); }
  sync() {
    const s = this.settings, model = sceneModels[s.model];
    el<HTMLSelectElement>('scene-input').value = s.input;
    const selected = el<HTMLSelectElement>('scene-target'); selected.replaceChildren();
    model.labels.forEach((label, id) => { const option = document.createElement('option'); option.value = String(id); option.textContent = `${sceneLabel(s.model, id)} (${label})`; selected.append(option); }); selected.value = String(s.target);
    el('scene-model-info').textContent = `${model.name} / ${model.labels.length}カテゴリ / ${(model.bytes / 1048576).toFixed(2)} MiB / 重みuint8・実行時float32 / 実験用内部サイズ${internalSceneSize(s.resolution)}×${internalSceneSize(s.resolution)}`;
    const supported = (names: string[]) => names.some(name => model.labels.includes(name));
    el('scene-support').textContent = [['空', ['sky']], ['道路', ['road']], ['歩道', ['sidewalk']], ['建物', ['building']], ['木・植物', ['tree', 'plant', 'vegetation']], ['壁', ['wall']], ['床', ['floor']], ['天井', ['ceiling']], ['家具（椅子・テーブル等）', ['chair', 'table', 'cabinet', 'sofa', 'bed']]].map(([name, labels]) => `${name}: ${supported(labels as string[]) ? '対応' : '未対応'}`).join(' / ');
    el('scene-continuous-warning').hidden = s.input !== 'continuous';
    el<HTMLButtonElement>('scene-analyze').disabled = (this.inputOverride ?? s.input) === 'continuous';
    el('scene-brightness-row').hidden = s.display !== 'brightness'; el('scene-color-row').hidden = s.display !== 'tint' && s.display !== 'solid';
  }
  update(data: SceneData, frame: HTMLCanvasElement) {
    sceneOccupancy(data); this.data = data;
    this.before.width = this.after.width = frame.width; this.before.height = this.after.height = frame.height;
    this.before.getContext('2d', { willReadFrequently: true })!.drawImage(frame, 0, 0);
    this.render();
  }
  render() {
    if (!this.data) { this.showInput(); return; }
    const data = this.data, rates = sceneOccupancy(data), pixels = this.before.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, this.before.width, this.before.height);
    const processed = sceneComposite(pixels.data, pixels.width, pixels.height, data, this.settings);
    this.after.getContext('2d')!.putImageData(new ImageData(processed, pixels.width, pixels.height), 0, 0);
    this.renderer.setSceneFrames(this.settings.input === 'still' ? this.input : this.before, this.after, this.mirror, this.settings.input === 'continuous');
    this.count = rates.length;
    const legend = el('scene-legend'); legend.replaceChildren();
    rates.forEach(item => { const span = document.createElement('span'); span.textContent = `${item.name} ${(item.ratio * 100).toFixed(1)}%`; span.style.borderLeftColor = `rgb(${sceneColors[data.model][item.id].join(',')})`; legend.append(span); });
    el('scene-categories').textContent = rates.map(item => `${item.id}: ${item.name} (${sceneModels[data.model].labels[item.id]}) / ${(item.ratio * 100).toFixed(2)}%`).join('\n');
    if (!rates.some(item => item.id === this.settings.target) && !['original', 'mask', 'overlay'].includes(this.settings.display)) el('scene-message').textContent = '選択カテゴリは検出されていません。対象領域への加工は行いません。';
    else el('scene-message').textContent = '推定カテゴリに基づく加工です。誤分類の可能性があるため、元映像・マスクと比較してください。';
  }
  tap(x: number, y: number, canvas: HTMLCanvasElement, video: HTMLVideoElement, view: ViewId, mirror: boolean) {
    const data = this.data; if (!data) { el('scene-tap').textContent = '解析結果を取得してから映像をタップしてください。'; return; }
    const still = this.settings.input === 'still', width = still ? this.input.width : video.videoWidth, height = still ? this.input.height : video.videoHeight;
    const point = sourcePoint(x, y, width, height, displayPanes(canvas.clientWidth, canvas.clientHeight, view), still ? this.mirror : mirror);
    if (!point) return;
    const mx = Math.min(data.width - 1, Math.floor(point.x * data.width / width)), my = Math.min(data.height - 1, Math.floor(point.y * data.height / height)), id = data.categories[my * data.width + mx];
    this.settings.target = id; el('storage-status').hidden = saveSceneSettings(this.settings); this.sync(); this.render();
    el('scene-tap').textContent = `推定: ${sceneLabel(data.model, id)} / ID ${id} / マスク (${mx}, ${my})`;
  }
  clear() { this.data = undefined; this.count = 0; this.before.width = this.before.height = this.after.width = this.after.height = 1; el('scene-categories').textContent = '解析結果を待っています。'; el('scene-legend').replaceChildren(); el('scene-tap').textContent = ''; }
  releaseInput() { this.fileGeneration++; this.hasStill = false; this.inputId = ''; this.input.width = this.input.height = 1; this.clear(); el<HTMLInputElement>('scene-file').value = ''; el('scene-message').textContent = '画像を解放しました。'; }
}
