import { composite, prepareCompositeMask, type CompositeMask, type LocalImage, palette } from './composite';
import { occupancy, segmentModels, type SegmentData } from './models';
import { modelForTab, saveSegmentSettings, segmentDefaults, type SegmentSettings } from './settings';
import { MaskHistory } from './stability';
import type { VisionRenderer } from '../render';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export class SegmentPanel {
  private settings: SegmentSettings;
  private renderer: VisionRenderer;
  private before = document.createElement('canvas');
  private after = document.createElement('canvas');
  private data?: SegmentData;
  private prepared?: CompositeMask;
  private image?: LocalImage;
  private imageRevision = 0;
  private history = new MaskHistory();
  private liveTime = -1;
  private liveAt = 0;
  reason = '';
  compositionMs: number | null = null;
  count = 0;
  constructor(settings: SegmentSettings, renderer: VisionRenderer, change: (reload: boolean, invalidate?: boolean) => void) {
    this.settings = settings; this.renderer = renderer;
    const fields: [keyof SegmentSettings, string, boolean?][] = [
      ['tab', 'segment-tab'], ['personView', 'segment-person-view'], ['background', 'segment-background'], ['partial', 'segment-partial'],
      ['target', 'segment-target', true], ['color', 'segment-color'], ['blur', 'segment-blur', true], ['boundary', 'segment-boundary', true], ['resolution', 'segment-resolution', true], ['interval', 'segment-interval', true],
      ['loadMode', 'segment-load'], ['temporal', 'segment-temporal', true], ['maskTtl', 'segment-ttl', true]
    ];
    for (const [key, id, numeric] of fields) {
      const input = el<HTMLInputElement>(id); input.value = String(settings[key]);
      input.addEventListener(input.type === 'range' || input.type === 'color' ? 'input' : 'change', () => {
        const oldModel = modelForTab(settings.tab);
        Object.assign(settings, { [key]: numeric ? Number(input.value) : input.value });
        if (key === 'resolution' || key === 'temporal') this.history.clear();
        el('storage-status').hidden = saveSegmentSettings(settings);
        this.sync();
        const reload = oldModel !== modelForTab(settings.tab);
        if (!reload) this.render();
        change(reload, key === 'resolution');
      });
    }
    const smoothing = el<HTMLInputElement>('segment-smoothing'); smoothing.checked = settings.smoothing;
    smoothing.onchange = () => { settings.smoothing = smoothing.checked; this.history.clear(); el('storage-status').hidden = saveSegmentSettings(settings); change(false); };
    el('segment-reset').onclick = () => {
      for (const key of ['resolution', 'interval', 'loadMode', 'smoothing', 'temporal', 'maskTtl', 'boundary', 'blur'] as const) Object.assign(settings, { [key]: segmentDefaults[key] });
      for (const [key, id] of fields) el<HTMLInputElement>(id).value = String(settings[key]);
      smoothing.checked = settings.smoothing; this.history.clear(); this.sync(); this.render(); el('storage-status').hidden = saveSegmentSettings(settings); change(false, true);
    };
    renderer.segmentLive = (video, now) => this.live(video, now);
    el<HTMLInputElement>('segment-image').onchange = async event => {
      const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
      const token = ++this.imageRevision;
      if (file.size > 15 * 1024 * 1024) { el('segment-image-status').textContent = '15MB以下の画像を選択してください。'; return; }
      const url = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = url; await image.decode();
        if (token !== this.imageRevision) return;
        const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        this.image = { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
        el('segment-image-status').textContent = '端末内の画像を読み込みました（このタブのメモリ内のみ）。'; this.render();
      } catch { if (token === this.imageRevision) el('segment-image-status').textContent = '画像を読み込めません。PNG・JPEG・WebPなど、このブラウザで表示できる画像を選択してください。'; }
      finally { URL.revokeObjectURL(url); }
    };
    el('segment-clear-image').onclick = () => { this.imageRevision++; this.image = undefined; el<HTMLInputElement>('segment-image').value = ''; el('segment-image-status').textContent = '画像未選択。サーバーへの送信・保存は行いません。'; this.render(); };
    this.sync();
  }
  sync() {
    const s = this.settings;
    document.querySelectorAll<HTMLElement>('[data-segment-tabs]').forEach(node => { node.hidden = !node.dataset.segmentTabs!.split(' ').includes(s.tab); });
    el('segment-image-row').hidden = s.tab !== 'background' || s.background !== 'image';
    el('segment-color-row').hidden = !(s.tab === 'background' && s.background === 'solid') && !(s.tab === 'partial' && (s.partial === 'hair' || s.partial === 'clothes'));
    el('segment-target-row').hidden = s.tab !== 'partial' || s.partial === 'hair' || s.partial === 'clothes';
    el('segment-blur-row').hidden = s.tab !== 'background' || s.background !== 'blur';
    el('segment-boundary-row').hidden = s.tab === 'parts';
    el('segment-boundary-value').textContent = String(s.boundary); el('segment-blur-value').textContent = `${s.blur} px`;
    el('segment-temporal-value').textContent = String(s.temporal);
    const model = segmentModels[modelForTab(s.tab)];
    el('segment-model-name').textContent = `${model.name} / 入力 ${model.input} / ${(model.bytes / 1048576).toFixed(2)} MiB`;
    const legend = el('segment-legend'); legend.replaceChildren();
    model.labels.forEach((name, i) => { const item = document.createElement('span'); item.textContent = name; item.style.borderLeftColor = `rgb(${palette[i].join(',')})`; legend.append(item); });
  }
  update(input: SegmentData, capturedAt = performance.now()) {
    const data = this.history.apply(input, capturedAt, this.settings.smoothing, this.settings.temporal, this.settings.maskTtl);
    this.data = data;
    this.before.width = this.after.width = data.sourceWidth; this.before.height = this.after.height = data.sourceHeight;
    this.before.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.source), data.sourceWidth, data.sourceHeight), 0, 0);
    const rates = occupancy(data), labels = segmentModels[data.model].labels;
    this.count = rates.slice(1).filter(rate => rate >= 0.001).length;
    el('segment-categories').textContent = labels.map((label, i) => `${label}: ${rates[i] >= 0.001 ? '検出' : '未検出（0.1%未満）'} / ${(rates[i] * 100).toFixed(2)}% / ${segmentModels[data.model].name}`).join('\n') + (data.model === 'person' ? '\n髪・体の肌・顔の肌・服・装飾品の個別認識: 未対応（部位／部分加工に切替で対応モデルを使用）' : '\n目・口・指・左右の手などの個別カテゴリ: 未対応');
    this.render();
  }
  private live(video: HTMLVideoElement, now: number) {
    if (!this.data || video.readyState < 2 || video.currentTime === this.liveTime || now - this.liveAt < 1000 / 15) return;
    this.liveAt = now; this.liveTime = video.currentTime;
    // Bounded live compositing, independent of the inference scheduler. No frame queue.
    const ctx = this.before.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, this.before.width, this.before.height);
    this.data = { ...this.data, source: ctx.getImageData(0, 0, this.before.width, this.before.height).data };
    this.render(true);
  }
  private render(reuseMask = false) {
    if (!this.data) return;
    if (this.data.model !== modelForTab(this.settings.tab)) return;
    const start = performance.now();
    if (!reuseMask || !this.prepared) this.prepared = prepareCompositeMask(this.data, this.settings);
    const result = composite(this.data, this.settings, this.image, this.prepared);
    this.after.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), this.data.sourceWidth, this.data.sourceHeight), 0, 0);
    this.compositionMs = performance.now() - start; this.reason = result.reason;
    el('segment-reason').textContent = result.reason;
    this.renderer.setSegmentFrames(this.before, this.after);
  }
  clear() { this.data = undefined; this.prepared = undefined; this.history.clear(); this.liveTime = -1; this.liveAt = 0; this.reason = ''; this.compositionMs = null; this.count = 0; this.before.width = this.after.width = this.before.height = this.after.height = 1; el('segment-categories').textContent = 'マスク取得を待っています。'; el('segment-reason').textContent = ''; }
}
