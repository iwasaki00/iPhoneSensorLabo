import type { TextData, TextEntity } from './types.ts';

export const cards = [
  { id: 7, key: 'robot', name: 'ロボット', hint: 'バッテリーで充電。スライムに手を振る。' },
  { id: 11, key: 'slime', name: 'スライム', hint: 'バッテリーでふくらんで跳ねる。ロボットに手を振る。' },
  { id: 19, key: 'battery', name: 'バッテリー', hint: 'ロボットやスライムに近づけてみよう。' }
] as const;
export type CardKey = typeof cards[number]['key'];
export type Reaction = 'charge' | 'bounce' | 'wave';
export const cardRules = { near: 1.8, far: 2.5, confirmations: 3, maximumGap: 1200, duration: 1800 };
export const cardFor = (id: number | undefined) => cards.find(card => card.id === id);
const pairTypes: Record<string, Reaction> = { 'battery+robot': 'charge', 'battery+slime': 'bounce', 'robot+slime': 'wave' };
export const reactionNames: Record<Reaction, string> = { charge: '充電！', bounce: 'ぷくっとジャンプ！', wave: 'こんにちは！' };
type PairState = { near: number; far: number; locked: boolean; last: number; started?: number; reaction: Reaction; keys: CardKey[]; count: number };

/** Mean observed edge length in source pixels. Axis-normalized coordinates alone distort portrait distances. */
export function cardDistance(a: TextEntity, b: TextEntity, width: number, height: number) {
  const size = (e: TextEntity) => e.corners?.length === 4 ? e.corners.reduce((s, p, i, q) => s + Math.hypot((p.x-q[(i+1)%4].x)*width, (p.y-q[(i+1)%4].y)*height), 0)/4 : 0;
  const scale = (size(a)+size(b))/2;
  return scale > 0 ? Math.hypot((a.center.x-b.center.x)*width, (a.center.y-b.center.y)*height)/scale : Infinity;
}

export class CardReactions {
  private states = new Map<string, PairState>();
  private lastCapture = -Infinity;
  private lastFrame = '';
  diagnostics = 'カードを映してください。';
  total = 0;
  update(data: TextData, width: number, height: number, now: number) {
    const r = data.result;
    if (now >= r.expiresAt || r.frameId === this.lastFrame || r.capturedAt <= this.lastCapture) return false;
    this.lastFrame = r.frameId; this.lastCapture = r.capturedAt;
    const groups = cards.map(card => ({card, entities:r.entities.filter(e=>e.markerId===card.id)}));
    const visible = groups.filter(g=>g.entities.length===1 && g.entities[0].corners?.length===4);
    const active = new Set<string>(), lines: string[] = [];
    for (let i=0;i<visible.length;i++) for(let j=i+1;j<visible.length;j++) {
      const a=visible[i], b=visible[j], keys=[a.card.key,b.card.key].sort() as CardKey[], key=keys.join('+');
      const state=this.states.get(key)??{near:0,far:0,locked:false,last:-Infinity,reaction:pairTypes[key],keys,count:0};
      active.add(key);
      if(r.capturedAt-state.last>cardRules.maximumGap){state.near=state.far=0;}
      state.last=r.capturedAt;
      const distance=cardDistance(a.entities[0],b.entities[0],width,height);
      if(state.locked){state.far=distance>=cardRules.far?state.far+1:0;if(state.far>=cardRules.confirmations){state.locked=false;state.near=state.far=0;}}
      else {state.near=distance<=cardRules.near?state.near+1:0;if(state.near>=cardRules.confirmations){state.locked=true;state.started=now;state.count++;this.total++;state.near=state.far=0;}}
      this.states.set(key,state);
      lines.push(`${a.card.name}＋${b.card.name}: 距離/見かけ辺長 ${distance.toFixed(2)} / ${state.locked?'反応済み・離れるのを待機':'接近確認 '+state.near+'/3'} / 離隔確認 ${state.far}/3 / 発火 ${state.count}回`);
    }
    for(const [key,state] of this.states)if(!active.has(key)){state.near=state.far=0;delete state.started;}
    this.diagnostics=[`フレーム ${r.frameId} / 有効期限 ${r.expiresAt.toFixed(0)}ms`,...r.entities.map(e=>`ID ${e.markerId}: ${cardFor(e.markerId)?.name??'割り当てなし'}`),...groups.filter(g=>g.entities.length>1).map(g=>`${g.card.name}: 同じIDが複数のためペア判定を保留`),...lines,`近い≤${cardRules.near} / 離れた≥${cardRules.far} / 各3検出 / 合計 ${this.total}反応`].join('\n');
    return true;
  }
  effect(key: CardKey, now: number) {
    for(const s of [...this.states.values()].reverse())if(s.keys.includes(key)&&s.started!==undefined&&now-s.started<cardRules.duration)return{reaction:s.reaction,progress:Math.max(0,(now-s.started)/cardRules.duration)};
  }
  expire(){for(const s of this.states.values()){s.near=s.far=0;delete s.started;}this.diagnostics='結果の有効期限切れ。再検出を待っています。';}
  clear(){this.states.clear();this.lastCapture=-Infinity;this.lastFrame='';this.total=0;this.diagnostics='カードを映してください。';}
}
