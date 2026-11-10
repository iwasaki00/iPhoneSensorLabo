import './style.css';
import { Camera, Rate, convert, errorMessage, type RawDetection } from './core';
import { loadSettings, saveSettings, type Settings, type ModeId, type ViewId } from './settings';
import { displayPanes, sourcePoint } from './display';
import { VisionRenderer } from './render';
import { ImageProcessingMode } from './modes/image-processing';
import { ModeSession } from './modes/session';
import { rgbToHsv } from './modes/pixels';
import type { RecognitionMode } from './modes/types';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = el<HTMLVideoElement>('video'), overlay = el<HTMLCanvasElement>('overlay');
const start = el<HTMLButtonElement>('start'), switchButton = el<HTMLButtonElement>('switch'), recognition = el<HTMLButtonElement>('recognition');
const threshold = el<HTMLInputElement>('threshold'), resolution = el<HTMLSelectElement>('resolution'), interval = el<HTMLSelectElement>('interval');
const modeSelect = el<HTMLSelectElement>('mode-select'), viewSelect = el<HTMLSelectElement>('view-select');
const camera = new Camera(video), cameraRate = new Rate(), renderRate = new Rate(), detectRate = new Rate();
const analysis = document.createElement('canvas'), renderer = new VisionRenderer(), session = new ModeSession();
const settings = loadSettings();
const titles: Record<ModeId, string> = { object: '物体認識', color: '色認識', motion: '動体検出', shape: '輪郭・図形認識' };
let mode: RecognitionMode | undefined, active = false, starting = false, enabled = true, facing: 'user' | 'environment' = 'environment';
let cameraGeneration = 0, modeGeneration = 0, resultGeneration = 0, raf = 0, videoCallback = 0;
let timer: ReturnType<typeof setTimeout> | undefined, latency: number | null = null;
let raw: RawDetection[] = [], resultW = 1, resultH = 1, resultAt = 0, lastVideoTime = -1, lastInferenceTime = -1;
let inFlight: Promise<void> | undefined;
const status = (message: string) => { el('status').textContent = message; };

function persist() { el('storage-status').hidden = saveSettings(settings); }
function diagnostics() {
  el('diagnostics').textContent = [
    'Version: 0.2.0 / COLOR & MOTION LAB', `認識モード: ${titles[settings.mode]}`, `比較表示: ${settings.view}`,
    `安全な接続: ${isSecureContext}`, `カメラAPI: ${!!navigator.mediaDevices?.getUserMedia}`,
    `映像FPS: ${'requestVideoFrameCallback' in video ? '映像フレーム通知' : 'API非対応（数値なし）'}`,
    '描画FPS: 実描画のrAF通知 / 認識FPS: 処理完了通知', `実行方式: ${mode?.runtime ?? '未初期化'}`,
    settings.mode === 'object' ? 'モデル: EfficientDet-Lite0 int8 revision 1 / MediaPipe 0.10.21' : 'モデル・WASM不使用 / Canvas画素処理',
    `映像: ${video.videoWidth} × ${video.videoHeight}`, `解析: ${resultW} × ${resultH}（画像処理は長辺320pxまで）`,
    `完了後の認識間隔: ${interval.value}ms`, `カメラ設定: ${JSON.stringify(camera.settings() ?? {})}`,
    `信頼度: ${threshold.value}% / 物体最大20件・画像処理最大24領域`, `UA: ${navigator.userAgent}`
  ].join('\n');
}
function showError(error: unknown) { el('error-message').textContent = errorMessage(error); el('error').hidden = false; el<HTMLButtonElement>('retry').textContent = active ? '認識を再試行' : 'カメラを再試行'; }
function clearResults() {
  resultGeneration++; raw = []; renderer.clear(); resultAt = 0; latency = null; detectRate.reset();
  el('count').textContent = '0'; el('result-info').textContent = '認識結果を待っています。';
  el('detect-fps').textContent = '—'; el('latency').textContent = '—';
}
function releaseMode() { modeGeneration++; clearTimeout(timer); mode = undefined; session.dispose(); clearResults(); }
function stop() {
  cameraGeneration++; active = false; starting = false; releaseMode(); cancelAnimationFrame(raf);
  if (videoCallback && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(videoCallback);
  videoCallback = 0; camera.stop(); cameraRate.reset(); renderRate.reset(); lastVideoTime = -1; lastInferenceTime = -1;
  overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
  el('placeholder').hidden = false; start.textContent = 'カメラを起動'; switchButton.disabled = false;
  el('state').textContent = '停止中'; for (const id of ['camera-fps', 'render-fps', 'detect-fps', 'latency']) el(id).textContent = '—';
  status('停止しました。カメラと認識リソースを解放しました。'); diagnostics();
}
function cameraFailure(error: unknown) { stop(); showError(error); }
function recognitionFailure(error: unknown) {
  releaseMode(); el('state').textContent = '認識エラー / 映像継続';
  status('カメラは動作中です。別のモードに切り替えるか、認識を再試行してください。'); showError(error); diagnostics();
}
async function begin() {
  if (starting || active) return;
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) { showError(new Error('カメラにはHTTPS接続が必要です。PCではlocalhost、iPhoneでは信頼されたHTTPSのURLで開いてください。')); return; }
  starting = true; const token = ++cameraGeneration; start.textContent = 'キャンセル'; switchButton.disabled = true; el('error').hidden = true;
  status('カメラの許可を待っています…'); el('state').textContent = '起動中';
  try {
    if (!await camera.start(facing, () => { if (token === cameraGeneration) cameraFailure(new Error('カメラ接続が終了しました。再試行してください。')); }) || token !== cameraGeneration) return;
    starting = false; active = true; switchButton.disabled = false; start.textContent = 'カメラを停止';
    video.classList.toggle('mirrored', facing === 'user'); el('placeholder').hidden = true;
    frameCounter(token); draw(token); diagnostics();
    if (enabled) await activateMode(); else { status('認識OFF。映像のみ表示しています。'); el('state').textContent = '認識OFF'; }
  } catch (e) { if (token === cameraGeneration) cameraFailure(e); }
}
async function activateMode() {
  const token = ++modeGeneration, cameraToken = cameraGeneration, selected = settings.mode;
  clearTimeout(timer); mode = undefined; clearResults(); el('error').hidden = true;
  if (!active || !enabled) { session.dispose(); return; }
  status(selected === 'object' ? 'モデルを読み込み中… 初回は少し時間がかかります。' : `${titles[selected]}を準備中…`);
  el('state').textContent = selected === 'object' ? 'モデル読込中' : '画像処理準備中';
  try {
    const ready = await session.select(async () => {
      if (selected === 'object') { const { ObjectMode } = await import('./modes/object-detector'); return new ObjectMode(); }
      return new ImageProcessingMode(selected, settings);
    });
    if (!ready || token !== modeGeneration || cameraToken !== cameraGeneration || !enabled) return;
    mode = ready; mode.configure?.(settings); lastVideoTime = -1;
    status(`${titles[selected]}を端末内で実行中。映像は送信されません。`); el('state').textContent = `${titles[selected]}中`;
    diagnostics(); schedule();
  } catch (e) {
    if (token === modeGeneration && cameraToken === cameraGeneration) recognitionFailure(new Error(`${selected === 'object' ? 'モデル読込失敗' : '画像処理の初期化失敗'}: ${errorMessage(e)} ${selected === 'object' ? '同じサイトのモデル・WASM配置を確認してください。' : ''}`));
  }
}
function frameCounter(token: number) {
  if (!('requestVideoFrameCallback' in video)) return;
  videoCallback = video.requestVideoFrameCallback(now => { if (token !== cameraGeneration || !active) return; cameraRate.tick(now); frameCounter(token); });
}
function draw(token: number) {
  if (token !== cameraGeneration || !active) return;
  const now = performance.now(), visible = enabled && now - resultAt < 2000;
  renderer.draw(overlay, video, settings.view, facing === 'user', visible, settings.mode); renderRate.tick(performance.now());
  el('count').textContent = String(visible ? renderer.observations.length + renderer.regions.length : 0);
  el('camera-fps').textContent = cameraRate.value(now)?.toFixed(1) ?? '—';
  el('render-fps').textContent = renderRate.value(performance.now())?.toFixed(1) ?? '—';
  el('detect-fps').textContent = enabled ? detectRate.value(now)?.toFixed(1) ?? '—' : '—';
  el('latency').textContent = enabled && latency !== null ? latency.toFixed(1) : '—';
  raf = requestAnimationFrame(() => draw(token));
}
function schedule() {
  clearTimeout(timer);
  if (active && enabled && mode) timer = setTimeout(run, Number(interval.value));
}
function run() {
  if (!active || !enabled || !mode) return;
  // A disposed asynchronous mode may still be unwinding. Never overlap captures.
  if (inFlight) { schedule(); return; }
  inFlight = infer().finally(() => { inFlight = undefined; schedule(); });
}
async function infer() {
  if (video.readyState < 2 || !video.videoWidth || video.currentTime === lastVideoTime) return;
  const current = mode!, token = modeGeneration, revision = resultGeneration;
  lastVideoTime = video.currentTime;
  const limit = settings.mode === 'object' ? Number(resolution.value) : Math.min(320, Number(resolution.value));
  const scale = Math.min(1, limit / Math.max(video.videoWidth, video.videoHeight));
  analysis.width = Math.max(1, Math.round(video.videoWidth * scale)); analysis.height = Math.max(1, Math.round(video.videoHeight * scale));
  try {
    analysis.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0, analysis.width, analysis.height);
    const timestamp = Math.max(performance.now(), lastInferenceTime + 0.01); lastInferenceTime = timestamp;
    const result = await current.infer(analysis, timestamp);
    if (token !== modeGeneration || revision !== resultGeneration || mode !== current || !enabled) return;
    raw = result.detections ?? []; resultW = analysis.width; resultH = analysis.height;
    renderer.setResult(resultW, resultH, result.regions ?? [], result.mask, settings.mode);
    renderer.observations = convert(raw, Number(threshold.value) / 100);
    resultAt = performance.now(); latency = result.duration; detectRate.tick(resultAt);
    if (result.note) status(result.note);
    resultInfo(); diagnostics();
  } catch (e) { if (token === modeGeneration && mode === current) recognitionFailure(new Error(`認識処理失敗: ${errorMessage(e)}`)); }
}
function resultInfo() {
  if (settings.mode === 'object') { el('result-info').textContent = renderer.observations.map(o => `${o.label} / ${(o.score * 100).toFixed(1)}% / x:${o.box.x.toFixed(0)} y:${o.box.y.toFixed(0)} w:${o.box.width.toFixed(0)} h:${o.box.height.toFixed(0)}`).join('\n') || '検出なし'; return; }
  const pane = displayPanes(overlay.clientWidth, overlay.clientHeight, settings.view).at(-1)!;
  const displayScale = Math.min(pane.width / Math.max(1, video.videoWidth), pane.height / Math.max(1, video.videoHeight));
  el('result-info').textContent = [`解析座標 ${resultW}×${resultH} / 原点: 元映像の左上`, ...renderer.regions.map(r => {
    const speed = r.velocity ? Math.hypot(r.velocity.x * video.videoWidth / resultW, r.velocity.y * video.videoHeight / resultH) * displayScale : null;
    const direction = r.velocity && Math.hypot(r.velocity.x, r.velocity.y) > 1 ? `${(Math.atan2(r.velocity.y, (facing === 'user' ? -1 : 1) * r.velocity.x) * 180 / Math.PI).toFixed(0)}°` : '—';
    return `${r.id ? `#${r.id} ` : ''}${r.label}${settings.mode === 'motion' ? ` / ${r.stationary ? '静止' : '動き'} / ${speed === null ? '—' : speed.toFixed(1)} 表示px/s / 方向 ${direction}` : ''}\n中心 (${r.center.x.toFixed(1)}, ${r.center.y.toFixed(1)}) / ${(r.center.x / resultW * 100).toFixed(1)}%, ${(r.center.y / resultH * 100).toFixed(1)}%\n面積 ${r.label === '直線' ? '—' : `${r.area.toFixed(0)} 解析px²`} / 傾き ${r.angle === null ? '—' : `${(facing === 'user' ? -r.angle : r.angle).toFixed(1)}°`}`;
  })].join('\n\n') + (renderer.regions.length ? '' : '\n検出なし');
}

const controls: [keyof Settings, string, string][] = [
  ['hueTolerance', 'hue-tolerance', '°'], ['saturationTolerance', 'saturation-tolerance', '%'], ['valueTolerance', 'value-tolerance', '%'],
  ['motionSensitivity', 'motion-sensitivity', ''], ['shapeSensitivity', 'shape-sensitivity', ''], ['minArea', 'min-area', ' px²']
];
function syncUI() {
  modeSelect.value = settings.mode; viewSelect.value = settings.view;
  document.querySelectorAll<HTMLElement>('[data-modes]').forEach(element => { element.hidden = !element.dataset.modes!.split(' ').includes(settings.mode); });
  el('mode-kind').textContent = settings.mode === 'object' ? '端末内AI' : 'モデル不要';
  for (const [key, id, unit] of controls) { el<HTMLInputElement>(id).value = String(settings[key]); el(id + '-value').textContent = `${id.includes('tolerance') ? '±' : ''}${settings[key]}${unit}`; }
  const target = settings.target;
  el('color-target').textContent = `追跡色 H${target.h.toFixed(0)}° S${(target.s * 100).toFixed(0)}% V${(target.v * 100).toFixed(0)}%`;
  el('color-swatch').style.backgroundColor = `hsl(${target.h} ${target.s * 100}% ${target.v * (1 - target.s / 2) * 100}%)`;
}
start.onclick = () => { if (active || starting) stop(); else void begin(); };
switchButton.onclick = async () => { const resume = active; stop(); facing = facing === 'user' ? 'environment' : 'user'; switchButton.textContent = facing === 'user' ? '背面に切替' : '前面に切替'; if (resume) await begin(); };
modeSelect.onchange = () => { settings.mode = modeSelect.value as ModeId; persist(); syncUI(); void activateMode(); diagnostics(); };
viewSelect.onchange = () => { settings.view = viewSelect.value as ViewId; persist(); diagnostics(); resultInfo(); };
recognition.onclick = () => {
  enabled = !enabled; recognition.textContent = `認識 ${enabled ? 'ON' : 'OFF'}`; recognition.setAttribute('aria-pressed', String(enabled));
  if (!enabled) { releaseMode(); status('認識OFF。映像のみ表示しています。'); el('state').textContent = active ? '認識OFF' : '停止中'; }
  else if (active) void activateMode();
};
threshold.oninput = () => { el('threshold-value').textContent = `${threshold.value}%`; renderer.observations = convert(raw, Number(threshold.value) / 100); resultInfo(); diagnostics(); };
resolution.onchange = () => { clearResults(); mode?.reset?.(); diagnostics(); }; interval.onchange = diagnostics;
for (const [key, id] of controls) el<HTMLInputElement>(id).oninput = () => {
  (settings[key] as number) = Number(el<HTMLInputElement>(id).value); persist(); syncUI(); clearResults(); mode?.configure?.(settings); diagnostics();
};
el('reset-background').onclick = () => { clearResults(); mode?.reset?.(); status('次のフレームで背景基準を再取得します。'); };
overlay.onclick = event => {
  if (!active || settings.mode !== 'color' || !video.videoWidth) return;
  const rect = overlay.getBoundingClientRect();
  const point = sourcePoint(event.clientX - rect.left, event.clientY - rect.top, video.videoWidth, video.videoHeight, displayPanes(rect.width, rect.height, settings.view), facing === 'user');
  if (!point) { status('映像の表示範囲内をタップしてください。'); return; }
  const sample = document.createElement('canvas'); sample.width = 3; sample.height = 3;
  const ctx = sample.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, Math.max(0, Math.min(video.videoWidth - 3, point.x - 1)), Math.max(0, Math.min(video.videoHeight - 3, point.y - 1)), 3, 3, 0, 0, 3, 3);
  const bytes = ctx.getImageData(0, 0, 3, 3).data; let r = 0, g = 0, b = 0;
  for (let i = 0; i < bytes.length; i += 4) { r += bytes[i]; g += bytes[i + 1]; b += bytes[i + 2]; }
  settings.target = rgbToHsv(r / 9, g / 9, b / 9); persist(); syncUI(); clearResults(); mode?.configure?.(settings); mode?.reset?.(); status('追跡色を更新しました。詳細設定で許容幅を調整できます。');
};
el('retry').onclick = () => { if (active) { enabled = true; recognition.textContent = '認識 ON'; recognition.setAttribute('aria-pressed', 'true'); void activateMode(); } else void begin(); };
document.addEventListener('visibilitychange', () => { if (document.hidden && (active || starting)) stop(); });
window.addEventListener('pagehide', stop); window.addEventListener('resize', () => { if (active) resultInfo(); });
syncUI(); diagnostics();
