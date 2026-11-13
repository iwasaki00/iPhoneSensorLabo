import type { DepthMap } from './processing';
import { colorize, comparePoints, occlusionAlpha } from './processing';
import { cardArt } from '../textmarker/card-art';
import { displayPanes, sourcePoint } from '../display';
import type { VisionRenderer } from '../render';
import type { ViewId } from '../settings';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export class DepthPanel {
  data?:DepthMap;busy=false;hasInput=false;
  private source=document.createElement('canvas');private after=document.createElement('canvas');private layer=document.createElement('canvas');private texture=document.createElement('canvas');
  private points:{x:number;y:number}[]=[];private character={x:.55,y:.6};private mirror=false;
  private renderer:VisionRenderer;private change:()=>void;
  constructor(renderer:VisionRenderer,change:()=>void){this.renderer=renderer;this.change=change;
    this.texture.width=this.texture.height=256;cardArt(this.texture.getContext('2d')!,'robot');const ctx=this.texture.getContext('2d')!,art=ctx.getImageData(0,0,256,256);for(let i=3;i<art.data.length;i+=4)if(art.data[i]<250)art.data[i]=0;ctx.putImageData(art,0,0);
    for(const id of ['depth-experiment','depth-display','depth-character-depth','depth-occlusion'])el(id).addEventListener(id==='depth-character-depth'?'input':'change',()=>{this.sync();this.render();change();});
    el('depth-reset-points').onclick=()=>{this.points=[];this.render();change();};this.sync();
  }
  message(text:string){el('depth-status').textContent=text;}
  sourceReady(ready:boolean){this.hasInput=ready;el<HTMLButtonElement>('depth-analyze').disabled=!ready||this.busy;}
  setBusy(busy:boolean){this.busy=busy;this.sourceReady(this.hasInput);}
  sync(){const e=el<HTMLSelectElement>('depth-experiment').value;document.querySelectorAll<HTMLElement>('[data-depth-experiment]').forEach(n=>n.hidden=n.dataset.depthExperiment!==e);}
  update(data:DepthMap,source:HTMLCanvasElement,mirror:boolean){this.data=data;this.mirror=mirror;this.source.width=source.width;this.source.height=source.height;this.source.getContext('2d')!.drawImage(source,0,0);this.points=[];this.setBusy(false);this.message('解析完了。同じ写真内の相対的な奥行きです。');el('depth-diagnostics').textContent=`Depth Anything V2 Small / Q4 / ONNX Runtime Web 1.23.2\nWorker / WASM・単一スレッド / WebGPU不使用\nモデル読込・初期化 ${data.loadMs.toFixed(1)} ms\n今回の解析（前処理・座標復元込み）${data.duration.toFixed(1)} ms\n入力 ${data.inputWidth}×${data.inputHeight} / 復元 ${data.width}×${data.height}\n余白なし・拡縮後14の倍数 / 元の推定値で比較・遮蔽\n生出力範囲 ${data.minimum.toFixed(4)}〜${data.maximum.toFixed(4)} / 大きいほど手前`;this.render();}
  render(){const map=this.data;if(!map)return;const w=map.width,h=map.height;this.after.width=w;this.after.height=h;const ctx=this.after.getContext('2d')!;ctx.drawImage(this.source,0,0,w,h);const experiment=el<HTMLSelectElement>('depth-experiment').value;el('overlay').classList.toggle('depth-drag',experiment==='character');
    if(experiment==='color'&&el<HTMLSelectElement>('depth-display').value==='depth')ctx.putImageData(new ImageData(colorize(map),w,h),0,0);
    if(experiment==='points'){this.points.forEach((p,i)=>{ctx.fillStyle=i?'#22d8ff':'#ffcf52';ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(4,w/120),0,Math.PI*2);ctx.fill();ctx.font=`bold ${Math.max(16,w/32)}px sans-serif`;ctx.fillText(i?'B':'A',p.x*w+8,p.y*h-8);});el('depth-comparison').textContent=this.points.length===2?comparePoints(map,this.points[0],this.points[1]):'画像を2か所タップしてA・Bを選んでください。';}
    if(experiment==='character'){this.layer.width=w;this.layer.height=h;const layer=this.layer.getContext('2d')!,size=Math.min(w,h)*.35;layer.drawImage(this.texture,this.character.x*w-size/2,this.character.y*h-size/2,size,size);const image=layer.getImageData(0,0,w,h),alpha=new Uint8ClampedArray(w*h);for(let i=0;i<alpha.length;i++)alpha[i]=image.data[i*4+3];const visible=occlusionAlpha(alpha,map,1-Number(el<HTMLInputElement>('depth-character-depth').value)/100,el<HTMLInputElement>('depth-occlusion').checked);for(let i=0;i<visible.length;i++)image.data[i*4+3]=visible[i];layer.putImageData(image,0,0);ctx.drawImage(this.layer,0,0);}
    this.renderer.setSceneFrames(this.source,this.after,this.mirror,false);
  }
  point(clientX:number,clientY:number,canvas:HTMLCanvasElement,view:ViewId){const map=this.data;if(!map)return null;const rect=canvas.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top,pane=displayPanes(rect.width,rect.height,view).find(p=>x>=p.x&&x<=p.x+p.width&&y>=p.y&&y<=p.y+p.height);if(!pane)return null;return sourcePoint(x,y,map.width,map.height,[pane],this.mirror);}
  interact(clientX:number,clientY:number,canvas:HTMLCanvasElement,view:ViewId,drag=false){const p=this.point(clientX,clientY,canvas,view);if(!p||!this.data)return;const normalized={x:p.x/this.data.width,y:p.y/this.data.height},experiment=el<HTMLSelectElement>('depth-experiment').value;if(experiment==='character'){this.character=normalized;}else if(experiment==='points'&&!drag){if(this.points.length===2)this.points=[];this.points.push(normalized);}else return;this.render();this.change();}
  get draggable(){return !!this.data&&el<HTMLSelectElement>('depth-experiment').value==='character';}
  clear(){el('overlay').classList.remove('depth-drag');this.data=undefined;this.points=[];this.setBusy(false);this.source.width=this.source.height=this.after.width=this.after.height=this.layer.width=this.layer.height=1;el('depth-comparison').textContent='画像を2か所タップしてください。';el('depth-diagnostics').textContent='未解析';}
}
