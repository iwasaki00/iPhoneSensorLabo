import type { MultiData } from './fusion';
import type { MultiSettings } from './settings';
export function describe(data: MultiData) {
  return [data.note, `フレーム ${data.frameId} / 撮影 ${new Date(performance.timeOrigin + data.capturedAt).toLocaleTimeString()} / 更新 ${new Date(performance.timeOrigin + data.processedAt).toLocaleTimeString()}`, '座標・距離: 元画像基準0〜1 / 速度: 元画像幅・高さに対する変化量/秒',
    ...data.engines.map(e => `${e.engine}: ${e.duration.toFixed(1)} ms`), `統合処理: ${data.fusionMs.toFixed(2)} ms`,
    ...data.entities.map(e => `#${e.id} ${e.label ?? e.category}${e.confidence === undefined ? '' : ` / 信頼度${(e.confidence * 100).toFixed(0)}%`} / 中心(${e.center.x.toFixed(3)}, ${e.center.y.toFixed(3)}) / 面積${(e.area * 100).toFixed(1)}%${e.speed === undefined ? '' : ` / 速度${e.speed.toFixed(3)}/s / 元画像方向${(Math.atan2(e.velocity!.y, e.velocity!.x) * 180 / Math.PI).toFixed(0)}°`}${e.colorRatio === undefined ? '' : ` / 指定色${(e.colorRatio * 100).toFixed(1)}% / ${e.colors?.map(c => `${c.name}${(c.ratio * 100).toFixed(0)}%`).join('・') ?? ''}`}`),
    ...data.relations.map(r => `${r.a} ↔ ${r.b}${r.category ? ` (${r.category})` : ''}${r.b === 'motion-mask' || r.b.startsWith('scene-') ? '' : ` / 中心距離${r.distance?.toFixed(3)} / IoU ${((r.iou ?? 0) * 100).toFixed(1)}%`}${r.coverage === undefined ? '' : ` / 枠内占有${(r.coverage * 100).toFixed(1)}%`}${r.b === 'motion-mask' ? ' / 背景との差がある領域との重なり（移動の可能性・照明変化でも検出）' : ''}${r.trend ? ' / ' + r.trend : ''}`),
    'イベント（最新10件）', ...data.events.slice(-10).map(e => `${e.at} ${e.type} / ${e.target} / ${e.evidence}`)].join('\n');
}
export function paintMulti(after: HTMLCanvasElement, before: HTMLCanvasElement, data: MultiData, s: MultiSettings, mirror = false) {
  after.width = before.width; after.height = before.height;
  const ctx = after.getContext('2d')!, w = after.width, h = after.height; ctx.drawImage(before, 0, 0);
  if (s.masks) for (const engine of data.engines) {
    const masks = [...engine.entities.flatMap(e => e.mask ? [e.mask] : []), ...(engine.mask ? [engine.mask] : [])];
    for (const mask of masks) { const c = document.createElement('canvas'); c.width = mask.width; c.height = mask.height; const x = c.getContext('2d')!, image = x.createImageData(c.width, c.height);
      for (let i = 0; i < mask.data.length; i++) if (mask.data[i] || mask.includeZero) { image.data[i * 4] = (mask.data[i] * 73) % 255; image.data[i * 4 + 1] = 230; image.data[i * 4 + 2] = 160; image.data[i * 4 + 3] = 95; } x.putImageData(image, 0, 0); ctx.drawImage(c, 0, 0, w, h); c.width = c.height = 1;
    }
  }
  ctx.strokeStyle = '#85ffd1'; ctx.fillStyle = '#85ffd1'; ctx.lineWidth = Math.max(1, w / 200); ctx.font = `${Math.max(8, w / 35)}px system-ui`;
  const label = (text: string, x: number, y: number) => { ctx.save(); ctx.translate(x, y); if (mirror) ctx.scale(-1, 1); ctx.fillText(text, 0, 0, Math.max(1, mirror ? x : w - x)); ctx.restore(); };
  for (const e of data.entities) {
    if (s.boxes) { const b = e.box; ctx.strokeRect(b.x * w, b.y * h, b.width * w, b.height * h); label(`${e.id} ${e.label ?? e.category}`, (b.x + (mirror ? b.width : 0)) * w, Math.max(12, b.y * h)); ctx.fillRect(e.center.x * w - 2, e.center.y * h - 2, 4, 4); }
    if (s.trails && e.trail) { ctx.beginPath(); e.trail.forEach((p, i) => i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)); ctx.stroke();
      if (e.velocity) { const a = e.center, dx = e.velocity.x * w * .3, dy = e.velocity.y * h * .3, angle = Math.atan2(dy, dx), x = a.x * w + dx, y = a.y * h + dy; ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(x, y); ctx.lineTo(x - 6 * Math.cos(angle - .5), y - 6 * Math.sin(angle - .5)); ctx.moveTo(x, y); ctx.lineTo(x - 6 * Math.cos(angle + .5), y - 6 * Math.sin(angle + .5)); ctx.stroke(); }
    }
  }
  if (s.relations) for (const r of data.relations) { const a = data.entities.find(e => e.id === r.a), b = data.entities.find(e => e.id === r.b); if (!a || !b) continue; ctx.beginPath(); ctx.moveTo(a.center.x * w, a.center.y * h); ctx.lineTo(b.center.x * w, b.center.y * h); ctx.stroke(); label(`${r.distance?.toFixed(2)} / ${((r.iou ?? 0) * 100).toFixed(0)}%`, (a.center.x + b.center.x) * w / 2, (a.center.y + b.center.y) * h / 2); }
}
