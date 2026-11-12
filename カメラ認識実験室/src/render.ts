import type { Observation } from './core';
import { displayPanes, paneBox, type Pane } from './display';
import type { ModeId, ViewId } from './settings';
import type { Point, Region } from './modes/pixels';

export class VisionRenderer {
  private mask = document.createElement('canvas');
  private width = 1;
  private height = 1;
  regions: Region[] = [];
  observations: Observation[] = [];
  private hasMask = false;
  private segmentAfter?: HTMLCanvasElement;
  private scene?: { before: HTMLCanvasElement; after?: HTMLCanvasElement; mirror: boolean; live: boolean };
  setSceneFrames(before: HTMLCanvasElement, after: HTMLCanvasElement | undefined, mirror: boolean, live: boolean) { this.scene = { before, after, mirror, live }; }
  segmentLive?: (video: HTMLVideoElement, now: number) => void;
  setSegmentFrames(_before: HTMLCanvasElement, after: HTMLCanvasElement) { this.segmentAfter = after; }
  setResult(width: number, height: number, regions: Region[], mask: Uint8Array | undefined, mode: ModeId) {
    this.width = width; this.height = height; this.regions = regions; this.hasMask = !!mask;
    if (!mask) return;
    this.mask.width = width; this.mask.height = height;
    const ctx = this.mask.getContext('2d')!, image = ctx.createImageData(width, height);
    const color = mode === 'motion' ? [255, 196, 83] : mode === 'shape' ? [104, 212, 255] : [127, 247, 173];
    for (let i = 0; i < mask.length; i++) if (mask[i]) { image.data[i * 4] = color[0]; image.data[i * 4 + 1] = color[1]; image.data[i * 4 + 2] = color[2]; image.data[i * 4 + 3] = 170; }
    ctx.putImageData(image, 0, 0);
  }
  clear() { this.regions = []; this.observations = []; this.hasMask = false; this.mask.width = 1; this.mask.height = 1; this.segmentAfter = undefined; this.scene = undefined; }
  draw(canvas: HTMLCanvasElement, video: HTMLVideoElement, view: ViewId, mirror: boolean, showResult: boolean, mode: ModeId) {
    const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#080f12'; ctx.fillRect(0, 0, width, height);
    const scene = mode === 'scene' ? this.scene : undefined, source = scene && !scene.live ? scene.before : video;
    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width, sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (scene && !scene.live) mirror = scene.mirror;
    if (!sw || !sh) return;
    if (mode === 'segmentation' && showResult && view !== 'before') this.segmentLive?.(video, performance.now());
    for (const pane of displayPanes(width, height, view)) {
      ctx.save(); ctx.beginPath(); ctx.rect(pane.x, pane.y, pane.width, pane.height); ctx.clip();
      const frame = paneBox({ x: 0, y: 0, width: sw, height: sh }, sw, sh, pane, false);
      if (pane.source || ((mode === 'segmentation' || mode === 'scene') && !showResult)) {
        ctx.save();
        if (mirror) { ctx.translate(frame.x + frame.width, frame.y); ctx.scale(-1, 1); ctx.drawImage(source, 0, 0, frame.width, frame.height); }
        else ctx.drawImage(source, frame.x, frame.y, frame.width, frame.height);
        ctx.restore();
      }
      if (pane.result && showResult) {
        if (scene?.after) {
          ctx.save();
          if (mirror) { ctx.translate(frame.x + frame.width, frame.y); ctx.scale(-1, 1); ctx.drawImage(scene.after, 0, 0, frame.width, frame.height); }
          else ctx.drawImage(scene.after, frame.x, frame.y, frame.width, frame.height);
          ctx.restore();
        }
        if (mode === 'segmentation' && this.segmentAfter) {
          ctx.save();
          if (mirror) { ctx.translate(frame.x + frame.width, frame.y); ctx.scale(-1, 1); ctx.drawImage(this.segmentAfter, 0, 0, frame.width, frame.height); }
          else ctx.drawImage(this.segmentAfter, frame.x, frame.y, frame.width, frame.height);
          ctx.restore();
        }
        if (this.hasMask) {
          ctx.save();
          if (mirror) { ctx.translate(frame.x + frame.width, frame.y); ctx.scale(-1, 1); ctx.drawImage(this.mask, 0, 0, frame.width, frame.height); }
          else ctx.drawImage(this.mask, frame.x, frame.y, frame.width, frame.height);
          ctx.restore();
        }
        const map = (p: Point) => this.map(p, pane, sw, sh, mirror);
        for (const observation of this.observations) {
          const a = map(observation.box), b = map({ x: observation.box.x + observation.box.width, y: observation.box.y + observation.box.height });
          ctx.strokeStyle = '#a2ecd2'; ctx.lineWidth = 2; ctx.strokeRect(Math.min(a.x, b.x), a.y, Math.abs(b.x - a.x), b.y - a.y);
          this.label(ctx, `${observation.label} ${Math.round(observation.score * 100)}%`, Math.min(a.x, b.x), a.y - 24, pane);
        }
        for (const region of this.regions) this.region(ctx, region, map, pane, mode);
      }
      if (pane.title) { ctx.fillStyle = '#10191ed9'; ctx.fillRect(pane.x + 8, 46, 64, 21); ctx.fillStyle = '#d9edeb'; ctx.font = '10px ui-monospace,monospace'; ctx.fillText(pane.title, pane.x + 14, 60); }
      ctx.restore();
    }
    if (view === 'split') { ctx.strokeStyle = '#56716f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke(); }
  }
  private map(point: Point, pane: Pane, sw: number, sh: number, mirror: boolean): Point {
    return paneBox({ x: point.x * sw / this.width, y: point.y * sh / this.height, width: 0, height: 0 }, sw, sh, pane, mirror);
  }
  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, pane: Pane) {
    ctx.font = '600 11px system-ui'; const width = Math.min(pane.width - 8, ctx.measureText(text).width + 10);
    x = Math.max(pane.x + 4, Math.min(pane.x + pane.width - width - 4, x)); y = Math.max(70, Math.min(pane.height - 24, y));
    ctx.fillStyle = '#10191ee8'; ctx.fillRect(x, y, width, 22); ctx.fillStyle = '#c0f6df'; ctx.fillText(text, x + 5, y + 15, width - 10);
  }
  private region(ctx: CanvasRenderingContext2D, r: Region, map: (p: Point) => Point, pane: Pane, mode: ModeId) {
    ctx.strokeStyle = mode === 'motion' ? '#ffd06d' : mode === 'shape' ? '#78d6ff' : '#a2ecd2'; ctx.lineWidth = 1.5;
    const a = map(r.box), b = map({ x: r.box.x + r.box.width, y: r.box.y + r.box.height }), center = map(r.center);
    ctx.strokeRect(Math.min(a.x, b.x), a.y, Math.abs(b.x - a.x), b.y - a.y);
    if (r.polygon.length) { ctx.beginPath(); r.polygon.forEach((p, i) => { const q = map(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke(); }
    if (r.trail?.length) { ctx.beginPath(); r.trail.forEach((p, i) => { const q = map(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(center.x - 4, center.y); ctx.lineTo(center.x + 4, center.y); ctx.moveTo(center.x, center.y - 4); ctx.lineTo(center.x, center.y + 4); ctx.stroke();
    if (mode === 'motion' && r.velocity && Math.hypot(r.velocity.x, r.velocity.y) > 1) {
      const end = map({ x: r.center.x + r.velocity.x * 0.3, y: r.center.y + r.velocity.y * 0.3 });
      const dx = end.x - center.x, dy = end.y - center.y, scale = Math.min(1, 60 / Math.max(1, Math.hypot(dx, dy))), x = center.x + dx * scale, y = center.y + dy * scale, angle = Math.atan2(dy, dx);
      ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(x, y); ctx.moveTo(x - 7 * Math.cos(angle - 0.5), y - 7 * Math.sin(angle - 0.5)); ctx.lineTo(x, y); ctx.lineTo(x - 7 * Math.cos(angle + 0.5), y - 7 * Math.sin(angle + 0.5)); ctx.stroke();
    }
    const end = r.velocity ? map({ x: r.center.x + r.velocity.x, y: r.center.y + r.velocity.y }) : null;
    const speed = end ? `${Math.hypot(end.x - center.x, end.y - center.y).toFixed(1)} px/s` : '— px/s';
    const label = mode === 'motion' ? `#${r.id} ${r.stationary ? '静止' : '動き'} ${speed}` : mode === 'color' ? `色 #${r.id} / ${r.area} px²` : r.label;
    this.label(ctx, label, Math.min(a.x, b.x), a.y - 24, pane);
  }
}
