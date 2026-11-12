import './style.css';
import { Camera, Rate, convert, errorMessage, type RawDetection } from './core';
import { loadSettings, saveSettings, type Settings, type ModeId, type ViewId } from './settings';
import { displayPanes, sourcePoint } from './display';
import { VisionRenderer } from './render';
import { ImageProcessingMode } from './modes/image-processing';
import { ModeSession } from './modes/session';
import { rgbToHsv } from './modes/pixels';
import type { RecognitionMode } from './modes/types';
import { loadSegmentSettings, modelForTab } from './segmentation/settings';
import { segmentModels, InferenceStats } from './segmentation/models';
import { SegmentPanel } from './segmentation/panel';
import { AdaptiveLoad, maskValid } from './segmentation/stability';
import { bindExperiments } from './experiments';
import { loadSceneSettings } from './scene/settings';
import { ScenePanel } from './scene/panel';
import { sceneModels, sceneOccupancy } from './scene/models';
import { internalSceneSize } from './scene/resize';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = el<HTMLVideoElement>('video'), overlay = el<HTMLCanvasElement>('overlay');
const start = el<HTMLButtonElement>('start'), switchButton = el<HTMLButtonElement>('switch'), recognition = el<HTMLButtonElement>('recognition');
const threshold = el<HTMLInputElement>('threshold'), resolution = el<HTMLSelectElement>('resolution'), interval = el<HTMLSelectElement>('interval');
const modeSelect = el<HTMLSelectElement>('mode-select'), viewSelect = el<HTMLSelectElement>('view-select');
const camera = new Camera(video), cameraRate = new Rate(), renderRate = new Rate(), detectRate = new Rate(10000);
const analysis = document.createElement('canvas'), renderer = new VisionRenderer(), session = new ModeSession();
const settings = loadSettings();
const segmentSettings = loadSegmentSettings(), segmentStats = new InferenceStats();
const load = new AdaptiveLoad();
const sceneSettings = loadSceneSettings(), sceneLoad = new AdaptiveLoad([1000, 2000, 5000, 10000], 15000);
const titles: Record<ModeId, string> = { object: '物体認識', color: '色認識', motion: '動体検出', shape: '輪郭・図形認識', segmentation: '領域認識', scene: '風景認識' };
let mode: RecognitionMode | undefined, active = false, starting = false, enabled = true, facing: 'user' | 'environment' = 'environment';
let cameraGeneration = 0, modeGeneration = 0, resultGeneration = 0, raf = 0, videoCallback = 0;
let timer: ReturnType<typeof setTimeout> | undefined, latency: number | null = null;
let raw: RawDetection[] = [], resultW = 1, resultH = 1, resultAt = 0, lastVideoTime = -1, lastInferenceTime = -1;
let inFlight: Promise<void> | undefined;
let sceneRequested = false;
let preparingScene = false;
const status = (message: string) => { el('status').textContent = message; };
const segmentPanel = new SegmentPanel(segmentSettings, renderer, (reload, invalidate) => {
  if (settings.mode !== 'segmentation') return;
  if (reload) void activateMode();
  else { if (invalidate) clearResults(); diagnostics(); resultInfo(); }
});
const scenePanel = new ScenePanel(sceneSettings, renderer, (reload, analyze, invalidate) => {
  if (settings.mode !== 'scene') return;
  if (invalidate) { clearResults(); scenePanel.showInput(); }
  if (reload || analyze && !mode && !preparingScene) { sceneRequested = analyze; void activateMode(); }
  else { if (analyze) { sceneRequested = true; run(); } else schedule(); }
  if (!active) drawStatic(); diagnostics();
});
function isSceneStill() { return settings.mode === 'scene' && sceneSettings.input === 'still'; }
function drawStatic() {
  if (active || settings.mode !== 'scene') return;
  scenePanel.showInput(); el('placeholder').hidden = scenePanel.hasStill;
  renderer.draw(overlay, video, settings.view, false, enabled && !!scenePanel.data, 'scene');
  renderRate.tick(performance.now()); el('count').textContent = String(scenePanel.count);
  el('latency').textContent = latency?.toFixed(1) ?? '—'; el('detect-fps').textContent = detectRate.value(performance.now())?.toFixed(1) ?? '—';
}

function persist() { el('storage-status').hidden = saveSettings(settings); }
function diagnostics() {
  el('diagnostics').textContent = [
    'Version: 0.4.0 / SCENE RECOGNITION LAB', `認識モード: ${titles[settings.mode]}`, `比較表示: ${settings.view}`,
    `安全な接続: ${isSecureContext}`, `カメラAPI: ${!!navigator.mediaDevices?.getUserMedia}`,
    `映像FPS: ${'requestVideoFrameCallback' in video ? '映像フレーム通知' : 'API非対応（数値なし）'}`,
    '描画FPS: 実描画のrAF通知（2秒窓） / 認識FPS: 処理完了通知（10秒窓）', `実行方式: ${mode?.runtime ?? '未初期化'}`,
    settings.mode === 'object' ? 'モデル: EfficientDet-Lite0 int8 revision 1 / MediaPipe 0.10.21' : settings.mode === 'segmentation' ? `モデル: ${segmentModels[modelForTab(segmentSettings.tab)].name} / MediaPipe 0.10.21 / CPU` : settings.mode === 'scene' ? `モデル: ${sceneModels[sceneSettings.model].name} / TensorFlow.js 4.22.0` : 'モデル・WASM不使用 / Canvas画素処理',
    `映像: ${video.videoWidth} × ${video.videoHeight}`, `解析: ${resultW} × ${resultH}（${settings.mode === 'scene' ? '風景モデル内部 ' + internalSceneSize(sceneSettings.resolution) + '×' + internalSceneSize(sceneSettings.resolution) : settings.mode === 'segmentation' ? '領域モデル入力256×256' : '画像処理は長辺320pxまで'}）`,
    `完了後の認識間隔: ${waitMs()}ms`, `カメラ設定: ${JSON.stringify(camera.settings() ?? {})}`,
    `信頼度: ${threshold.value}% / 物体最大20件・画像処理最大24領域`, `UA: ${navigator.userAgent}`
  ].join('\n');
  const stats = segmentStats.value;
  el('segment-performance').textContent = [
    `使用モデル: ${segmentModels[modelForTab(segmentSettings.tab)].name}`,
    `実行方式: ${mode?.runtime ?? '未初期化'}`, `モデル読込・初期化: ${mode?.loadMs ? mode.loadMs.toFixed(1) + ' ms' : '未計測'}`,
    `直近${stats.count}回の平均推論時間: ${stats.average?.toFixed(1) ?? '—'} ms`, `最大推論時間: ${stats.maximum?.toFixed(1) ?? '—'} ms`,
    `取得映像: ${resultW}×${resultH} / モデル入力: 256×256`, `推論FPS: ${detectRate.value(performance.now())?.toFixed(1) ?? '—'}`,
    `フレーム間引き: 完了後${waitMs()}ms待機 / キュー蓄積なし / ${segmentSettings.loadMode === 'auto' ? '自動' : '手動'}`, `映像長辺設定: ${segmentSettings.resolution}px`,
    `映像加工: ${segmentPanel.compositionMs?.toFixed(1) ?? '—'} ms（推論時間とは別）`
  ].join('\n');
  el('segment-load-status').textContent = load.heavy ? `高負荷（処理時間の実測に基づく） / ${segmentSettings.loadMode === 'auto' ? '待機時間を自動調整' : '手動設定中：間隔を広げると負荷を軽減できます'} / ${waitMs()} ms待機` : `${segmentSettings.loadMode === 'auto' ? '自動調整' : '手動設定'} / ${waitMs()} ms待機`;
  const scene = scenePanel.data;
  el('scene-performance').textContent = [`使用モデル: ${sceneModels[sceneSettings.model].name}`, `容量: ${sceneModels[sceneSettings.model].bytes} bytes`, `実行方式: ${mode?.runtime ?? '未初期化'}`, `モデル読み込み: ${mode?.loadMs?.toFixed(1) ?? '—'} ms`, `解析解像度: ${resultW}×${resultH} / マスク: ${scene ? scene.width + '×' + scene.height : '—'}`, `直近${stats.count}回 平均推論: ${stats.average?.toFixed(1) ?? '—'} ms / 最大: ${stats.maximum?.toFixed(1) ?? '—'} ms`, `推論FPS: ${detectRate.value(performance.now())?.toFixed(2) ?? '—（単発または未計測）'}`, `完了後待機: ${waitMs()} ms / ${sceneSettings.loadMode}`, `Tensor数: ${scene?.tensors ?? '—'} / Tensor管理バイト: ${scene?.tensorBytes ?? '—'}${scene && !scene.memoryReliable ? '（バックエンド報告は不完全）' : ''}`, 'Tensor管理量は端末全体のメモリ使用量ではありません。'].join('\n');
  el('scene-load-status').textContent = sceneLoad.heavy ? `高負荷 / 完了後${waitMs()}ms待機。遅い場合は静止画・低解像度で実験してください。` : `完了後${waitMs()}ms待機 / キュー蓄積なし`;
}
function showError(error: unknown) { el('error-message').textContent = errorMessage(error); el('error').hidden = false; el<HTMLButtonElement>('retry').textContent = active || settings.mode === 'scene' ? '認識を再試行' : 'カメラを再試行'; }
function clearResults() {
  resultGeneration++; raw = []; renderer.clear(); resultAt = 0; latency = null; detectRate.reset();
  segmentStats.reset(); load.reset(); sceneLoad.reset(); segmentPanel.clear(); scenePanel.clear();
  el('count').textContent = '0'; el('result-info').textContent = '認識結果を待っています。';
  el('detect-fps').textContent = '—'; el('latency').textContent = '—';
}
function releaseMode() { modeGeneration++; sceneRequested = false; preparingScene = false; clearTimeout(timer); mode = undefined; session.dispose(); analysis.width = analysis.height = 1; clearResults(); if (!active && settings.mode === 'scene') drawStatic(); }
function stop() {
  cameraGeneration++; active = false; starting = false; releaseMode(); cancelAnimationFrame(raf);
  if (videoCallback && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(videoCallback);
  videoCallback = 0; camera.stop(); cameraRate.reset(); renderRate.reset(); lastVideoTime = -1; lastInferenceTime = -1;
  scenePanel.releaseInput();
  overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
  el('placeholder').hidden = false; start.textContent = 'カメラを起動'; switchButton.disabled = false;
  el('state').textContent = '停止中'; for (const id of ['camera-fps', 'render-fps', 'detect-fps', 'latency']) el(id).textContent = '—';
  status('停止しました。カメラと認識リソースを解放しました。'); diagnostics();
}
function cameraFailure(error: unknown) { stop(); showError(error); }
function recognitionFailure(error: unknown) {
  releaseMode(); el('state').textContent = '認識エラー / 映像継続';
  status(active ? 'カメラは動作中です。別のモードに切り替えるか、認識を再試行してください。' : '画像を再解析するか、認識を再試行してください。'); showError(error); diagnostics();
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
    if (enabled) { if (settings.mode === 'scene' && (mode || preparingScene)) schedule(); else await activateMode(); } else { status('認識OFF。映像のみ表示しています。'); el('state').textContent = '認識OFF'; }
  } catch (e) { if (token === cameraGeneration) cameraFailure(e); }
}
async function activateMode() {
  const token = ++modeGeneration, cameraToken = cameraGeneration, selected = settings.mode, selectedModel = modelForTab(segmentSettings.tab), selectedSceneModel = sceneSettings.model, sceneSize = sceneSettings.resolution;
  clearTimeout(timer); mode = undefined; clearResults(); el('error').hidden = true;
  if ((!active && selected !== 'scene') || !enabled) { session.dispose(); return; }
  status(selected === 'scene' ? `${sceneModels[selectedSceneModel].name}を同じサイトから取得・初期化中…` : selected === 'object' ? 'モデルを読み込み中… 初回は少し時間がかかります。' : selected === 'segmentation' ? `${segmentModels[selectedModel].name}を取得・初期化中… 初回は時間がかかります。` : `${titles[selected]}を準備中…`);
  el('state').textContent = selected === 'object' || selected === 'segmentation' || selected === 'scene' ? 'モデル読込中' : '画像処理準備中';
  preparingScene = selected === 'scene';
  try {
    const ready = await session.select(async () => {
      if (selected === 'object') { const { ObjectMode } = await import('./modes/object-detector'); return new ObjectMode(); }
      if (selected === 'segmentation') { const { SegmentMode } = await import('./modes/segmenter'); return new SegmentMode(selectedModel); }
      if (selected === 'scene') { const { SceneMode } = await import('./modes/scene'); return new SceneMode(selectedSceneModel, sceneSize); }
      return new ImageProcessingMode(selected, settings);
    });
    if (!ready || token !== modeGeneration || selected !== 'scene' && cameraToken !== cameraGeneration || !enabled) return;
    mode = ready; mode.configure?.(settings); lastVideoTime = -1;
    status(`${titles[selected]}を端末内で実行中。映像は送信されません。`); el('state').textContent = `${titles[selected]}中`;
    if (selected === 'scene' && isSceneStill() && scenePanel.hasStill) sceneRequested = true;
    diagnostics(); schedule();
  } catch (e) {
    if (token === modeGeneration && (selected === 'scene' || cameraToken === cameraGeneration)) recognitionFailure(new Error(`${selected === 'object' || selected === 'segmentation' || selected === 'scene' ? 'モデル読込失敗' : '画像処理の初期化失敗'}: ${errorMessage(e)} 接続、同じサイトのモデル・WASM配置、空きメモリを確認し、認識を再試行してください。`));
  } finally { if (token === modeGeneration) preparingScene = false; }
}
function frameCounter(token: number) {
  if (!('requestVideoFrameCallback' in video)) return;
  videoCallback = video.requestVideoFrameCallback(now => { if (token !== cameraGeneration || !active) return; cameraRate.tick(now); frameCounter(token); });
}
function draw(token: number) {
  if (token !== cameraGeneration || !active) return;
  const now = performance.now(), visible = enabled && (isSceneStill() && !!scenePanel.data || maskValid(resultAt, now, settings.mode === 'segmentation' ? segmentSettings.maskTtl : settings.mode === 'scene' ? 15000 : 2000));
  if (settings.mode === 'scene' && !isSceneStill() && resultAt > 0 && !visible) { resultAt = 0; renderer.clear(); scenePanel.clear(); }
  if (settings.mode === 'segmentation' && resultAt > 0 && !visible) {
    resultAt = 0; renderer.clear(); segmentPanel.clear();
    el('segment-reason').textContent = 'マスクの有効期限が切れました。次の結果まで元映像を表示します。';
  }
  try { renderer.draw(overlay, video, settings.view, facing === 'user', visible, settings.mode); }
  catch (error) { recognitionFailure(error); renderer.draw(overlay, video, settings.view, facing === 'user', false, settings.mode); }
  renderRate.tick(performance.now());
  el('count').textContent = String(visible ? settings.mode === 'scene' ? scenePanel.count : settings.mode === 'segmentation' ? segmentPanel.count : renderer.observations.length + renderer.regions.length : 0);
  el('camera-fps').textContent = cameraRate.value(now)?.toFixed(1) ?? '—';
  el('render-fps').textContent = renderRate.value(performance.now())?.toFixed(1) ?? '—';
  el('detect-fps').textContent = enabled ? detectRate.value(now)?.toFixed(1) ?? '—' : '—';
  el('latency').textContent = enabled && latency !== null ? latency.toFixed(1) : '—';
  raf = requestAnimationFrame(() => draw(token));
}
function schedule() {
  clearTimeout(timer);
  if (isSceneStill()) { if (enabled && mode && sceneRequested && scenePanel.hasStill) timer = setTimeout(run, 0); return; }
  if (active && enabled && mode) timer = setTimeout(run, waitMs());
}
function waitMs() { return settings.mode === 'scene' ? sceneLoad.wait(sceneSettings.loadMode, sceneSettings.interval) : settings.mode === 'segmentation' ? load.wait(segmentSettings.loadMode, segmentSettings.interval) : Number(interval.value); }
function run() {
  if ((!active && !isSceneStill()) || !enabled || !mode || isSceneStill() && (!sceneRequested || !scenePanel.hasStill)) return;
  // A disposed asynchronous mode may still be unwinding. Never overlap captures.
  if (inFlight) { if (!isSceneStill()) schedule(); return; }
  if (isSceneStill()) sceneRequested = false;
  inFlight = infer().finally(() => { inFlight = undefined; schedule(); });
}
async function infer() {
  const still = isSceneStill(), source = still ? scenePanel.input : video;
  if (!still && (video.readyState < 2 || !video.videoWidth || video.currentTime === lastVideoTime)) return;
  const current = mode!, token = modeGeneration, revision = resultGeneration;
  lastVideoTime = video.currentTime;
  const limit = settings.mode === 'scene' ? sceneSettings.resolution : settings.mode === 'object' ? Number(resolution.value) : settings.mode === 'segmentation' ? segmentSettings.resolution : Math.min(320, Number(resolution.value));
  const width = still ? scenePanel.input.width : video.videoWidth, height = still ? scenePanel.input.height : video.videoHeight;
  const scale = Math.min(1, limit / Math.max(width, height));
  analysis.width = Math.max(1, Math.round(width * scale)); analysis.height = Math.max(1, Math.round(height * scale));
  try {
    analysis.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, analysis.width, analysis.height);
    const timestamp = Math.max(performance.now(), lastInferenceTime + 0.01); lastInferenceTime = timestamp;
    const result = await current.infer(analysis, timestamp);
    if (token !== modeGeneration || revision !== resultGeneration || mode !== current || !enabled) return;
    raw = result.detections ?? []; resultW = analysis.width; resultH = analysis.height;
    renderer.setResult(resultW, resultH, result.regions ?? [], result.mask, settings.mode);
    segmentStats.add(result.duration);
    if (result.scene) {
      sceneLoad.add(performance.now() - timestamp);
      if (!still && !maskValid(timestamp, performance.now(), 15000)) { latency = result.duration; detectRate.tick(performance.now()); diagnostics(); return; }
      scenePanel.update(result.scene, analysis);
    }
    if (result.segmentation) {
      // Age is measured from capture, not completion: slow results are not made fresh.
      if (!maskValid(timestamp, performance.now(), segmentSettings.maskTtl)) { load.add(performance.now() - timestamp); latency = result.duration; detectRate.tick(performance.now()); diagnostics(); return; }
      segmentPanel.update(result.segmentation, timestamp);
      load.add(performance.now() - timestamp);
    }
    renderer.observations = convert(raw, Number(threshold.value) / 100);
    resultAt = result.segmentation || result.scene ? timestamp : performance.now(); latency = result.duration; detectRate.tick(performance.now());
    if (result.note) status(result.note);
    resultInfo(); diagnostics(); if (!active) drawStatic();
  } catch (e) { if (token === modeGeneration && mode === current) recognitionFailure(new Error(`認識処理失敗: ${errorMessage(e)}`)); }
}
bindExperiments(() => {
  if ((!active && !isSceneStill()) || !mode || !segmentStats.value.count) return null;
  const now = performance.now(), stats = segmentStats.value;
  return { version: '0.4.0', at: new Date().toISOString(), mode: titles[settings.mode] + (settings.mode === 'segmentation' ? '/' + segmentSettings.tab : ''),
    model: settings.mode === 'scene' ? sceneModels[sceneSettings.model].name : settings.mode === 'segmentation' ? segmentModels[modelForTab(segmentSettings.tab)].name : settings.mode === 'object' ? 'EfficientDet-Lite0 int8 revision 1' : 'モデル不使用',
    resolution: `${resultW}×${resultH}`, renderFPS: renderRate.value(now), inferenceFPS: detectRate.value(now), averageMs: stats.average, maximumMs: stats.maximum,
    waitMs: waitMs(), loadMode: settings.mode === 'scene' ? sceneSettings.loadMode : settings.mode === 'segmentation' ? segmentSettings.loadMode : 'manual', runtime: mode.runtime,
    ...(settings.mode === 'scene' && scenePanel.data ? { scene: { context: sceneSettings.context, inputKind: sceneSettings.input, inputId: scenePanel.inputId, modelBytes: sceneModels[sceneSettings.model].bytes, loadMs: mode.loadMs ?? null, inferenceMs: latency, internalResolution: `${internalSceneSize(sceneSettings.resolution)}×${internalSceneSize(sceneSettings.resolution)}`, categories: sceneOccupancy(scenePanel.data) } } : {}),
    userAgent: navigator.userAgent, language: navigator.language, platform: navigator.platform, cores: Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null };
});
function resultInfo() {
  if (settings.mode === 'scene') { el('result-info').textContent = el('scene-categories').textContent; return; }
  if (settings.mode === 'segmentation') { el('result-info').textContent = el('segment-categories').textContent + (segmentPanel.reason ? '\n' + segmentPanel.reason : ''); return; }
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
  el('mode-kind').textContent = settings.mode === 'object' || settings.mode === 'segmentation' || settings.mode === 'scene' ? '端末内AI' : 'モデル不要';
  el('count-unit').textContent = settings.mode === 'segmentation' || settings.mode === 'scene' ? '種類を検出' : '個を認識';
  el('legacy-resolution-row').hidden = settings.mode === 'segmentation' || settings.mode === 'scene';
  el('legacy-interval-row').hidden = settings.mode === 'segmentation' || settings.mode === 'scene';
  el('recognition-settings').hidden = settings.mode === 'scene';
  for (const [key, id, unit] of controls) { el<HTMLInputElement>(id).value = String(settings[key]); el(id + '-value').textContent = `${id.includes('tolerance') ? '±' : ''}${settings[key]}${unit}`; }
  const target = settings.target;
  el('color-target').textContent = `追跡色 H${target.h.toFixed(0)}° S${(target.s * 100).toFixed(0)}% V${(target.v * 100).toFixed(0)}%`;
  el('color-swatch').style.backgroundColor = `hsl(${target.h} ${target.s * 100}% ${target.v * (1 - target.s / 2) * 100}%)`;
}
start.onclick = () => { if (active || starting) stop(); else void begin(); };
switchButton.onclick = async () => { const resume = active; stop(); facing = facing === 'user' ? 'environment' : 'user'; switchButton.textContent = facing === 'user' ? '背面に切替' : '前面に切替'; if (resume) await begin(); };
modeSelect.onchange = () => { if (settings.mode === 'scene') { scenePanel.releaseInput(); analysis.width = analysis.height = 1; } sceneRequested = false; settings.mode = modeSelect.value as ModeId; persist(); syncUI(); void activateMode(); diagnostics(); if (!active) { if (settings.mode === 'scene') drawStatic(); else { overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height); el('placeholder').hidden = false; } } };
viewSelect.onchange = () => { settings.view = viewSelect.value as ViewId; persist(); diagnostics(); resultInfo(); if (!active) drawStatic(); };
recognition.onclick = () => {
  enabled = !enabled; recognition.textContent = `認識 ${enabled ? 'ON' : 'OFF'}`; recognition.setAttribute('aria-pressed', String(enabled));
  if (!enabled) { releaseMode(); status('認識OFF。映像のみ表示しています。'); el('state').textContent = active ? '認識OFF' : '停止中'; }
  else if (active || settings.mode === 'scene') void activateMode();
};
threshold.oninput = () => { el('threshold-value').textContent = `${threshold.value}%`; renderer.observations = convert(raw, Number(threshold.value) / 100); resultInfo(); diagnostics(); };
resolution.onchange = () => { clearResults(); mode?.reset?.(); diagnostics(); }; interval.onchange = diagnostics;
for (const [key, id] of controls) el<HTMLInputElement>(id).oninput = () => {
  (settings[key] as number) = Number(el<HTMLInputElement>(id).value); persist(); syncUI(); clearResults(); mode?.configure?.(settings); diagnostics();
};
el('reset-background').onclick = () => { clearResults(); mode?.reset?.(); status('次のフレームで背景基準を再取得します。'); };
overlay.onclick = event => {
  if (settings.mode === 'scene') { const rect = overlay.getBoundingClientRect(); scenePanel.tap(event.clientX - rect.left, event.clientY - rect.top, overlay, video, settings.view, facing === 'user'); if (!active) drawStatic(); return; }
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
el('retry').onclick = () => { if (active || settings.mode === 'scene') { enabled = true; recognition.textContent = '認識 ON'; recognition.setAttribute('aria-pressed', 'true'); void activateMode(); } else void begin(); };
el('scene-analyze').onclick = () => { if (!scenePanel.hasStill) { status('画像を選択するか、カメラから1フレームを取得してください。'); return; } sceneRequested = true; if (!mode && !preparingScene) void activateMode(); else run(); };
el('scene-capture').onclick = () => { try { scenePanel.capture(video, facing === 'user'); clearResults(); scenePanel.showInput(); sceneRequested = true; if (!mode && !preparingScene) void activateMode(); else run(); } catch (error) { showError(error); } };
el('scene-release-model').onclick = () => { releaseMode(); scenePanel.showInput(); if (!active) drawStatic(); status('風景モデルを解放しました。「静止画を解析」で再読込できます。'); diagnostics(); };
document.addEventListener('visibilitychange', () => { if (document.hidden && (active || starting || settings.mode === 'scene' && (mode || preparingScene))) stop(); });
window.addEventListener('pagehide', stop); window.addEventListener('resize', () => { if (active) resultInfo(); else drawStatic(); });
syncUI(); diagnostics();
