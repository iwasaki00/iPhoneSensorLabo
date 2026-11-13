import dictionary from './dictionary.json' with { type: 'json' };
import type { Point } from '../modes/pixels.ts';
export const markerDictionary = dictionary.name;
export function originalPoint(p:Point,rotation:number,crop:{x:number;y:number;w:number;h:number}):Point {
  let x=p.x,y=p.y;if(rotation===90){x=p.y;y=1-p.x;}else if(rotation===180){x=1-p.x;y=1-p.y;}else if(rotation===270){x=1-p.y;y=p.x;}return{x:crop.x+x*crop.w,y:crop.y+y*crop.h};
}
export function markerSVG(id: number) {
  if (!Number.isInteger(id) || id < 0 || id >= dictionary.codes.length) throw Error('マーカーIDは0〜249です。');
  const code = dictionary.codes[id]; let cells = '';
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (code[y * 6 + x] === '1') cells += `<rect x="${x + 2}" y="${y + 2}" width="1" height="1" fill="white"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="white"/><rect x="1" y="1" width="8" height="8" fill="black"/>${cells}</svg>`;
}
export function project(h: number[], p: Point): Point { const w = h[6] * p.x + h[7] * p.y + 1; return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w }; }
/** Unit square -> source-normalized four corners (marker orientation is preserved). */
export function homography(q: Point[]): number[] {
  if (q.length !== 4) throw Error('四隅が必要です。');
  const a: number[][] = [], unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  q.forEach((v, i) => { const { x, y } = unit[i]; a.push([x, y, 1, 0, 0, 0, -v.x * x, -v.x * y, v.x], [0, 0, 0, x, y, 1, -v.y * x, -v.y * y, v.y]); });
  for (let i = 0; i < 8; i++) { let p = i; for (let j = i + 1; j < 8; j++) if (Math.abs(a[j][i]) > Math.abs(a[p][i])) p = j; [a[i], a[p]] = [a[p], a[i]]; const d = a[i][i]; if (Math.abs(d) < 1e-10) throw Error('四隅が退化しています。'); for (let k = i; k < 9; k++) a[i][k] /= d; for (let j = 0; j < 8; j++) if (j !== i) { const f = a[j][i]; for (let k = i; k < 9; k++) a[j][k] -= f * a[i][k]; } }
  return a.map(row => row[8]);
}
export class CodeHistory {
  private codes = new Map<string, { at: number; count: number }>();
  update(format: string, content: string, now: number) {
    for (const [key, v] of this.codes) if (now - v.at > 10000) this.codes.delete(key);
    const key = format + '\0' + content, old = this.codes.get(key), count = (old?.count ?? 0) + 1;
    this.codes.set(key, { at: now, count }); if (this.codes.size > 100) this.codes.delete(this.codes.keys().next().value!);
    return { count, fresh: !old };
  }
}
export function safeURL(text: string) { try { const u = new URL(text.trim()); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } }
