import { cards, type CardKey } from './cards.ts';
import type { TextData, TextEntity } from './types.ts';
export const boardSize = { width: 360, height: 480 };
export type Placement = { key: CardKey; x: number; y: number; size: number; angle: number; visible: boolean };
export function initialPlacements(): Placement[] {
  return cards.map((c,i)=>({key:c.key,x:[65,295,180][i],y:[100,100,370][i],size:68,angle:0,visible:true}));
}
export function boundPlacement(p: Placement) {
  p.size=Math.max(44,Math.min(120,p.size));p.angle=Math.max(-180,Math.min(180,p.angle));
  const a=p.angle*Math.PI/180,margin=p.size/2*(Math.abs(Math.cos(a))+Math.abs(Math.sin(a)))+4;
  p.x=Math.max(margin,Math.min(boardSize.width-margin,p.x));p.y=Math.max(margin,Math.min(boardSize.height-margin,p.y));
}
export function placementPoint(p:Placement,x:number,y:number) {
  const a=p.angle*Math.PI/180;
  return{x:p.x+x*Math.cos(a)-y*Math.sin(a),y:p.y+x*Math.sin(a)+y*Math.cos(a)};
}
export function hitPlacement(p:Placement,x:number,y:number) {
  const a=-p.angle*Math.PI/180,dx=x-p.x,dy=y-p.y;
  return p.visible&&Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=p.size/2&&Math.abs(dx*Math.sin(a)+dy*Math.cos(a))<=p.size/2;
}
/** Synthetic IDs/corners only. No marker recognition or camera access occurs here. */
export function simulatedFrame(placements:Placement[],capturedAt:number,frameId:string):TextData {
  const entities:TextEntity[]=placements.filter(p=>p.visible).map(p=>{
    const card=cards.find(c=>c.key===p.key)!;
    // Detection corners cover the black 8/10 marker square; keep the generator's white quiet zone outside.
    const radius=p.size*.4,corners=[[-radius,-radius],[radius,-radius],[radius,radius],[-radius,radius]].map(([x,y])=>{const q=placementPoint(p,x,y);return{x:q.x/boardSize.width,y:q.y/boardSize.height};});
    const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
    return{id:'sim-'+card.id,category:'模擬マーカー',markerId:card.id,center:{x:p.x/boardSize.width,y:p.y/boardSize.height},box:{x,y,width,height},area:(p.size*.8)**2/boardSize.width/boardSize.height,corners,angle:p.angle};
  });
  return{result:{engine:'カメラなし・模擬検出（マーカー認識は未実行）',frameId,capturedAt,processedAt:capturedAt,expiresAt:capturedAt+600,duration:0,entities},note:'認識精度を検証する入力ではありません。',features:0,matches:0,inliers:0};
}
