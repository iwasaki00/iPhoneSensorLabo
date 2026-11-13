import { cardArt } from './card-art';
import { CardReactions, cardFor, cards, reactionNames } from './cards';
import { warp } from './projection';
import { homography } from './geometry';
import type { TextData } from './types';

export class CardView {
  readonly reactions = new CardReactions();
  private texture = document.createElement('canvas');
  private lastDraw = 0;
  private animating = false;
  constructor(){this.texture.width=this.texture.height=256;}
  count(data?:TextData){return Math.min(8,data?.result.entities.filter(e=>cardFor(e.markerId)&&e.corners?.length===4).length??0);}
  update(data:TextData,width:number,height:number,now:number){this.reactions.update(data,width,height,now);document.getElementById('card-diagnostics')!.textContent=this.reactions.diagnostics;}
  animate(now:number){if(now-this.lastDraw<1000/30)return false;this.lastDraw=now;const active=cards.some(card=>!!this.reactions.effect(card.key,now)),redraw=active||this.animating;this.animating=active;return redraw;}
  render(ctx:CanvasRenderingContext2D,data:TextData,w:number,h:number,now:number){
    if(now>=data.result.expiresAt)return;
    this.texture.width=this.texture.height=256;const labels=new Set<string>();let count=0;
    for(const e of data.result.entities){const card=cardFor(e.markerId);if(!card||e.corners?.length!==4||count++>=8)continue;const effect=this.reactions.effect(card.key,now);cardArt(this.texture.getContext('2d')!,card.key,effect);warp(ctx,this.texture,e.homography??homography(e.corners),w,h);if(effect)labels.add(reactionNames[effect.reaction]);}
    document.getElementById('card-hint')!.textContent=labels.size?[...labels].join(' '):'カードを映す → 2枚を近づける';
  }
  expire(){this.reactions.expire();document.getElementById('card-hint')!.textContent='カードを映してください。';document.getElementById('card-diagnostics')!.textContent=this.reactions.diagnostics;}
  clear(){this.reactions.clear();this.lastDraw=0;this.animating=false;this.texture.width=this.texture.height=1;document.getElementById('card-hint')!.textContent='カードを映す → 2枚を近づける';document.getElementById('card-diagnostics')!.textContent=this.reactions.diagnostics;}
}
