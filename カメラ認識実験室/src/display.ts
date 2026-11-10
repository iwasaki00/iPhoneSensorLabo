import { containBox, type Box } from './core.ts';
import type { ViewId } from './settings.ts';
export type Pane = Box & { source: boolean; result: boolean; title: string };
export function displayPanes(width: number, height: number, view: ViewId): Pane[] {
  if (view === 'split') return [
    { x: 0, y: 0, width: width / 2, height, source: true, result: false, title: 'BEFORE' },
    { x: width / 2, y: 0, width: width / 2, height, source: false, result: true, title: 'AFTER' }
  ];
  return [{ x: 0, y: 0, width, height, source: view !== 'after', result: view !== 'before', title: view === 'normal' ? '' : view.toUpperCase() }];
}
export function paneBox(box: Box, sw: number, sh: number, pane: Pane, mirror: boolean): Box {
  const b = containBox(box, sw, sh, pane.width, pane.height, mirror);
  return { ...b, x: b.x + pane.x, y: b.y + pane.y };
}
export function sourcePoint(x: number, y: number, sw: number, sh: number, panes: Pane[], mirror: boolean) {
  const pane = panes.find(p => x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height);
  if (!pane || sw <= 0 || sh <= 0) return null;
  const frame = paneBox({ x: 0, y: 0, width: sw, height: sh }, sw, sh, pane, false);
  if (x < frame.x || y < frame.y || x >= frame.x + frame.width || y >= frame.y + frame.height) return null;
  const nx = (x - frame.x) / frame.width;
  return { x: Math.min(sw - 1, Math.floor((mirror ? 1 - nx : nx) * sw)), y: Math.min(sh - 1, Math.floor((y - frame.y) / frame.height * sh)) };
}
