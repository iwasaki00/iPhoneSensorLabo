import { cards, type CardKey } from './cards';
import { markerSVG } from './geometry';
import { CardView } from './card-view';
import { boardSize, boundPlacement, hitPlacement, initialPlacements, placementPoint, simulatedFrame } from './playground-model';
import type { TextData } from './types';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const query=new URLSearchParams(location.search),simulator=query.get('mode')==='simulator';
document.body.dataset.input=simulator?'simulator':'display';
el('playground-title').textContent=simulator?'ARカード シミュレーター':'カード表示';
el('source-label').textContent=simulator?'カメラなし・模擬検出。カードを動かして反応を試します。':'PCでこの画面を表示し、iPhoneのARカード実験で撮る。';
const displayURL=new URL('ar-playground.html',location.href).href;el<HTMLInputElement>('display-link').value=displayURL;
const localOnly=['localhost','127.0.0.1','[::1]'].includes(location.hostname),linkNote=localOnly?'localhostは同じ端末専用です。別端末には到達可能な配信先URLを使ってください。':'';
el('playground-status').textContent=linkNote;
el('copy-display-link').onclick=async()=>{try{await navigator.clipboard.writeText(displayURL);el('playground-status').textContent='カード表示リンクをコピーしました。'+linkNote;}catch{el<HTMLInputElement>('display-link').select();el('playground-status').textContent='URLを選択しました。手動でコピーしてください。'+linkNote;}};
let placements=initialPlacements(),selected:CardKey='robot',sequence=0,generation=0,latest:TextData|undefined,disposed=false,raf=0,lastDraw=0;
const cardView=simulator?new CardView():undefined,canvas=el<HTMLCanvasElement>('playground-board'),ctx=canvas.getContext('2d')!;
const images=new Map<CardKey,HTMLImageElement>(),urls:string[]=[];
const controls=el('placement-controls'),selection=el<HTMLSelectElement>('selected-card');
for(const card of cards){
  const label=document.createElement('label'),visible=document.createElement('input');visible.type='checkbox';visible.checked=true;visible.id='show-'+card.key;visible.onchange=()=>{placements.find(p=>p.key===card.key)!.visible=visible.checked;};label.append(visible,card.name);controls.append(label);
  const option=document.createElement('option');option.value=card.key;option.textContent=card.name;selection.append(option);
}
function sync(){const p=placements.find(p=>p.key===selected)!;selection.value=selected;el<HTMLInputElement>('card-size').value=String(p.size);el('size-value').textContent=String(p.size);el<HTMLInputElement>('card-angle').value=String(p.angle);el('angle-value').textContent=p.angle+'°';for(const p of placements)el<HTMLInputElement>('show-'+p.key).checked=p.visible;}
selection.onchange=()=>{selected=selection.value as CardKey;sync();};
for(const [id,field] of [['card-size','size'],['card-angle','angle']] as const)el<HTMLInputElement>(id).oninput=()=>{const p=placements.find(p=>p.key===selected)!;p[field]=Number(el<HTMLInputElement>(id).value);boundPlacement(p);sync();};
function reset(){placements=initialPlacements();selected='robot';generation++;sequence=0;latest=undefined;cardView?.clear();sync();}
el('reset-placement').onclick=reset;
const only=query.get('card');if(cards.some(c=>c.key===only)){placements.forEach(p=>p.visible=p.key===only);selected=only as CardKey;}sync();
let drag:{pointer:number;dx:number;dy:number}|undefined;
function point(e:PointerEvent){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*boardSize.width/r.width,y:(e.clientY-r.top)*boardSize.height/r.height};}
canvas.onpointerdown=e=>{if(drag)return;const q=point(e),p=[...placements].reverse().find(p=>hitPlacement(p,q.x,q.y));if(!p)return;selected=p.key;drag={pointer:e.pointerId,dx:q.x-p.x,dy:q.y-p.y};canvas.setPointerCapture(e.pointerId);sync();e.preventDefault();};
canvas.onpointermove=e=>{if(!drag||drag.pointer!==e.pointerId)return;const q=point(e),p=placements.find(p=>p.key===selected)!;p.x=q.x-drag.dx;p.y=q.y-drag.dy;boundPlacement(p);e.preventDefault();};
const end=(e:PointerEvent)=>{if(drag?.pointer===e.pointerId){drag=undefined;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}};
canvas.onpointerup=end;canvas.onpointercancel=end;canvas.onlostpointercapture=()=>{drag=undefined;};
function sample(){if(disposed||!simulator||document.hidden)return;const now=performance.now();latest=simulatedFrame(placements,now,`sim-${generation}-${++sequence}`);cardView!.update(latest,boardSize.width,boardSize.height,now);}
function draw(now:number){if(disposed)return;raf=requestAnimationFrame(draw);if(now-lastDraw<1000/30)return;lastDraw=now;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(const p of placements.filter(p=>p.visible)){const image=images.get(p.key);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle*Math.PI/180);if(image){ctx.imageSmoothingEnabled=false;ctx.drawImage(image,-p.size/2,-p.size/2,p.size,p.size);}ctx.restore();}
  if(simulator&&latest){if(now>=latest.result.expiresAt){latest=undefined;cardView!.expire();}else cardView!.render(ctx,latest,canvas.width,canvas.height,now);}
  for(const p of placements.filter(p=>p.visible)){const name=cards.find(c=>c.key===p.key)!.name,a=p.angle*Math.PI/180,half=p.size/2*(Math.abs(Math.cos(a))+Math.abs(Math.sin(a)));ctx.fillStyle='#153e50';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText(name,p.x,p.y-half-7);if(simulator&&selected===p.key){const r=p.size/2+3,q=[[-r,-r],[r,-r],[r,r],[-r,r]].map(([x,y])=>placementPoint(p,x,y));ctx.strokeStyle='#35a1c1';ctx.lineWidth=1;ctx.beginPath();q.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.closePath();ctx.stroke();}}
}
async function prepare(){for(const card of cards){const url=URL.createObjectURL(new Blob([markerSVG(card.id)],{type:'image/svg+xml'}));try{const image=new Image();image.src=url;await image.decode();if(disposed)return;images.set(card.key,image);
    const c=document.createElement('canvas');c.width=c.height=600;c.getContext('2d')!.drawImage(image,0,0,600,600);const blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve));c.width=c.height=1;if(blob&&!disposed){const png=URL.createObjectURL(blob);urls.push(png);const a=document.createElement('a');a.href=png;a.target='_blank';a.rel='noopener';a.textContent=card.name+' PNGを開く';a.dataset.pngCard=card.key;el('png-links').append(a);}
  }finally{URL.revokeObjectURL(url);}}}
void prepare().catch(()=>{el('playground-status').textContent='カード生成に失敗しました。再読込してください。';});
const interval=simulator?setInterval(sample,200):undefined;raf=requestAnimationFrame(draw);
function dispose(){if(disposed)return;disposed=true;clearInterval(interval);cancelAnimationFrame(raf);drag=undefined;latest=undefined;cardView?.clear();images.clear();urls.forEach(url=>URL.revokeObjectURL(url));canvas.width=canvas.height=1;}
window.addEventListener('pagehide',dispose);document.addEventListener('visibilitychange',()=>{if(document.hidden){latest=undefined;cardView?.clear();generation++;sequence=0;}});
// A restored page must start with a fresh input/session instead of a stopped animation loop.
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
