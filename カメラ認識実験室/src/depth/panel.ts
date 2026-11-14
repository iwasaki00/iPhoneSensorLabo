import type { DepthMap } from './processing';
import { colorize, comparePoints, occlusionAlpha, resizeFloat } from './processing';
import { cardArt } from '../textmarker/card-art';
import { displayPanes, sourcePoint } from '../display';
import type { VisionRenderer } from '../render';
import type { ViewId } from '../settings';
import { visibility, visibleHit, type HideVisibility } from './hide';
import { renderDensity } from './detail';
import { photoEdges, refineContour, correctionRadius, type PhotoEdges } from './edge';
import { coarseSpots, distinctSpots, spotScore, SPOT_LIMITS, type HidePose, type HideSpot } from './spots';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export class DepthPanel {
  data?:DepthMap;busy=false;hasInput=false;
  private requestedSize=280;
  private spotGeneration=0;private finding=false;private originalPose?:HidePose;
  private invalidateSpots(){this.spotGeneration++;this.finding=false;this.originalPose=undefined;el('hide-spots').replaceChildren();el('hide-spot-status').textContent='';el('hide-spot-status').removeAttribute('data-metrics');el<HTMLButtonElement>('hide-restore').disabled=true;this.spotButton();}
  private spotButton(){el<HTMLButtonElement>('hide-find').disabled=this.finding||this.busy||!this.data||!this.hiding||this.stage!=='edit';}
  private applyPose(p:HidePose){this.character={x:p.x,y:p.y};el<HTMLInputElement>('hide-depth').value=String(p.depth);this.render();this.change();}
  private async findSpots(){
    if(this.finding||this.busy||!this.data||!this.hiding||this.stage!=='edit')return;
    this.invalidateSpots();const generation=this.spotGeneration,map=this.data;this.finding=true;this.spotButton();
    const current=()=>generation===this.spotGeneration&&this.data===map&&this.hiding&&this.stage==='edit';
    const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0)),at=performance.now();el('hide-spot-status').textContent='候補を探しています…';
    const factor=Math.min(1,128/Math.max(map.width,map.height)),w=Math.max(1,Math.round(map.width*factor)),h=Math.max(1,Math.round(map.height*factor));
    const thumbnail={...map,width:w,height:h,values:resizeFloat(map.values,map.width,map.height,w,h)};
    const art=document.createElement('canvas');art.width=art.height=48;const ac=art.getContext('2d')!;ac.drawImage(this.texture,0,0,48,48);const rgba=ac.getImageData(0,0,48,48).data;
    const body=Uint8ClampedArray.from({length:48*48},(_,i)=>Math.floor(i/48)>=48*51/256?rgba[i*4+3]:0);
    const rect=el('overlay').getBoundingClientRect(),scale=Math.min(rect.width/map.width,rect.height/map.height),accepted:HideSpot[]=[];
    try{
      await pause();if(!current())return;
      const coarse=await coarseSpots(thumbnail,body,48,scale/factor,current,pause);let checked=0;
      for(const pose of coarse.spots){await pause();if(!current())return;
        const frame=this.hideFrame(pose),visible=this.mask(frame.alpha,1-pose.depth/100,true),q=visibility(frame.alpha,visible,map.width,map.height,scale,frame.inside);checked++;
        const cohesion=q.largest/Math.max(1,q.visible);
        if(q.ready&&cohesion>=.6){let head=0,headVisible=0;for(let y=Math.max(0,Math.floor(frame.top));y<Math.min(map.height,frame.top+frame.size*.57);y++)for(let x=Math.max(0,Math.floor(frame.left));x<Math.min(map.width,frame.left+frame.size);x++){const i=y*map.width+x;if(frame.alpha[i]>=128){head++;if(visible[i]>=128)headVisible++;}}
          accepted.push({...pose,ratio:q.ratio,cohesion,score:spotScore(q,headVisible/Math.max(1,head))});}
      }
      if(!current())return;
      const spots=distinctSpots(accepted,map.width,map.height,SPOT_LIMITS.results);
      for(const [i,pose] of spots.entries()){const button=document.createElement('button');button.textContent=`候補 ${i+1}`;button.dataset.pose=JSON.stringify(pose);button.onclick=()=>{if(!current())return;if(!this.originalPose)this.originalPose={...this.character,depth:Number(el<HTMLInputElement>('hide-depth').value)};this.applyPose(pose);el<HTMLButtonElement>('hide-restore').disabled=false;};el('hide-spots').append(button);}
      const duration=performance.now()-at;el('hide-spot-status').textContent=spots.length?`${spots.length}件の候補です。選んで見え方を確認してください。`:'隠れ場所の候補が見つかりませんでした。手動で置くか、手前に物がある別の写真をお試しください。';
      el('hide-spot-status').dataset.metrics=JSON.stringify({count:spots.length,trials:coarse.trials,checked,duration,edge:el<HTMLInputElement>('hide-edge').checked});
    }catch{if(current())el('hide-spot-status').textContent='候補を探せませんでした。手動で置くか、もう一度お試しください。';}
    finally{art.width=art.height=1;if(current()){this.finding=false;this.spotButton();}}
  }
  requestQuality(size:number){this.requestedSize=size;this.sourceReady(this.hasInput);if(this.data)this.message('画質は未適用です。「奥行きを解析」で更新します。現在は前回の解析結果を表示しています。');}
  private source=document.createElement('canvas');private after=document.createElement('canvas');private layer=document.createElement('canvas');private texture=document.createElement('canvas');
  private points:{x:number;y:number}[]=[];private character={x:.55,y:.6};private mirror=false;
  private renderer:VisionRenderer;private change:()=>void;
  private edges?:PhotoEdges;private edgeKey='';private edgeBuilds=0;private fixedEdge=false;private fixedVisible?:Uint8ClampedArray;
  private edgeStats={refineMs:0,changed:0,ambiguous:0,examined:0,maxShift:0,compositeMs:0};
  private stage:'edit'|'pass'|'search'|'found'='edit';private body=new Uint8ClampedArray();private visible:Uint8ClampedArray=new Uint8ClampedArray();private quality?:HideVisibility;private reveal=0;private animation=0;
  constructor(renderer:VisionRenderer,change:()=>void){this.renderer=renderer;this.change=change;
    this.texture.width=this.texture.height=256;cardArt(this.texture.getContext('2d')!,'robot');const ctx=this.texture.getContext('2d')!,art=ctx.getImageData(0,0,256,256);for(let i=3;i<art.data.length;i+=4)if(art.data[i]<250)art.data[i]=0;ctx.putImageData(art,0,0);
    for(const id of ['depth-experiment','depth-display','depth-character-depth','depth-occlusion'])el(id).addEventListener(id==='depth-character-depth'?'input':'change',()=>{if(id==='depth-experiment')this.invalidateSpots();this.sync();this.render();change();});
    el('depth-reset-points').onclick=()=>{this.points=[];this.render();change();};this.sync();
    el('hide-depth').oninput=()=>{this.render();change();};
    for(const id of ['depth-edge','hide-edge'])el(id).onchange=()=>{this.invalidateSpots();this.render();change();};
    el('hide-find').onclick=()=>void this.findSpots();el('hide-restore').onclick=()=>{if(this.originalPose&&this.stage==='edit'){this.applyPose(this.originalPose);this.originalPose=undefined;el<HTMLButtonElement>('hide-restore').disabled=true;}};
    el('hide-lock').onclick=()=>{this.render();if(this.busy||!this.data||!this.quality?.ready)return;this.setStage('pass');};
    el('hide-seek').onclick=()=>this.setStage('search');
    el('hide-again').onclick=()=>this.setStage('edit');
    el('hide-exit').onclick=()=>{this.setStage('edit');el<HTMLSelectElement>('depth-experiment').value='character';this.sync();this.render();change();};
    el('hide-hint').onclick=()=>{if(this.stage!=='search')return;const x=this.mirror?1-this.character.x:this.character.x;el('hide-hint-text').textContent=`写真の${this.character.y<1/3?'上':this.character.y>2/3?'下':'中央'}・${x<1/3?'左':x>2/3?'右':'中央'}あたりです。`;};
    window.addEventListener('resize',()=>{if(this.hiding&&this.stage==='edit'){this.render();change();}});
  }
  message(text:string){el('depth-status').textContent=text;}
  sourceReady(ready:boolean){this.hasInput=ready;el<HTMLButtonElement>('depth-analyze').disabled=!ready||this.busy||this.hiding&&!!this.data&&Math.max(this.data.inputWidth,this.data.inputHeight)===this.requestedSize;}
  setBusy(busy:boolean){this.busy=busy;if(busy)this.invalidateSpots();this.spotButton();el<HTMLSelectElement>('depth-size').disabled=busy;if(busy)el<HTMLButtonElement>('hide-lock').disabled=true;this.sourceReady(this.hasInput);}
  get hiding(){return el<HTMLSelectElement>('depth-experiment').value==='hide';}
  get locked(){return this.hiding&&this.stage!=='edit';}
  view(view:ViewId):ViewId{return this.hiding?'normal':view;}
  private setStage(stage:typeof this.stage){if(stage!=='edit')this.invalidateSpots();cancelAnimationFrame(this.animation);if(stage==='pass'){this.fixedEdge=el<HTMLInputElement>('hide-edge').checked;this.fixedVisible=this.visible;}if(stage==='edit')this.fixedVisible=undefined;this.stage=stage;this.reveal=stage==='found'?performance.now():0;el('hide-hint-text').textContent='';this.sync();this.render();this.change();if(stage==='found'){const tick=()=>{if(this.stage!=='found'||!this.data)return;this.render();this.change();if(performance.now()-this.reveal<650)this.animation=requestAnimationFrame(tick);};this.animation=requestAnimationFrame(tick);}}
  sync(){const e=el<HTMLSelectElement>('depth-experiment').value;if(e!=='hide'&&this.stage!=='edit'){this.stage='edit';this.fixedVisible=undefined;cancelAnimationFrame(this.animation);}document.querySelectorAll<HTMLElement>('[data-depth-experiment]').forEach(n=>n.hidden=n.dataset.depthExperiment!==e);document.body.classList.toggle('hide-locked',this.locked);document.body.classList.toggle('hide-editing',this.hiding);for(const [id,stage] of [['hide-edit','edit'],['hide-pass','pass'],['hide-search','search'],['hide-found','found']])el(id).hidden=this.stage!==stage;el('hide-exit').hidden=!this.locked;this.sourceReady(this.hasInput);}
  update(data:DepthMap,source:HTMLCanvasElement,mirror:boolean,original={width:source.width,height:source.height},photoId=''){
    this.invalidateSpots();
    const key=photoId+':'+source.width+'x'+source.height;if(key!==this.edgeKey){this.edges=undefined;this.edgeBuilds=0;this.edgeKey=key;}
    this.data={...data,width:source.width,height:source.height,nativeValues:undefined,values:resizeFloat(data.nativeValues??data.values,data.nativeValues?data.outputWidth!:data.width,data.nativeValues?data.outputHeight!:data.height,source.width,source.height)};
    this.mirror=mirror;el('overlay').parentElement!.style.setProperty('--depth-photo-ratio',String(source.width/source.height));
    this.source.width=source.width;this.source.height=source.height;this.source.getContext('2d')!.drawImage(source,0,0);
    // Re-rasterize the original vector drawing at presentation resolution, never enlarge a fixed 256px bitmap.
    const size=Math.min(1024,Math.max(256,Math.ceil(Math.min(source.width,source.height)*.35)));
    this.texture.width=this.texture.height=size;const ctx=this.texture.getContext('2d')!;ctx.scale(size/256,size/256);cardArt(ctx,'robot');ctx.resetTransform();
    const art=ctx.getImageData(0,0,size,size);for(let i=3;i<art.data.length;i+=4)if(art.data[i]<250)art.data[i]=0;ctx.putImageData(art,0,0);
    this.points=[];this.setBusy(false);this.message('解析完了。同じ写真内の相対的な奥行きです。');
    el('depth-diagnostics').textContent=`Depth Anything V2 Small Q4 / Worker WASM 1 thread\n元写真 ${original.width}×${original.height}\n解析用写真 ${data.width}×${data.height}\n実モデル入力 ${data.inputWidth}×${data.inputHeight}\n生深度出力 ${data.outputWidth??'—'}×${data.outputHeight??'—'}\n写真・ロボット・遮蔽バッファ ${source.width}×${source.height}\nロボット素材 ${size}×${size} / DPR上限3\nモデル読込・初期化 ${data.loadMs.toFixed(1)} ms\n今回の解析（前処理・復元込み）${data.duration.toFixed(1)} ms\n大きい値ほど手前。描画用マップ拡大は推論解像度ではありません。`;
    this.render();const canvas=el<HTMLCanvasElement>('overlay'),density=renderDensity(canvas.clientWidth,canvas.clientHeight,devicePixelRatio);el('depth-diagnostics').textContent+=`\n最終描画Canvas ${Math.round(canvas.clientWidth*density)}×${Math.round(canvas.clientHeight*density)} / CSS ${canvas.clientWidth}×${canvas.clientHeight}`;
  }
  render(){const map=this.data;if(!map)return;Object.assign(this.edgeStats,{refineMs:0,changed:0,ambiguous:0,examined:0,maxShift:0});const at=performance.now(),w=map.width,h=map.height;this.after.width=w;this.after.height=h;const ctx=this.after.getContext('2d')!;ctx.drawImage(this.source,0,0,w,h);const experiment=el<HTMLSelectElement>('depth-experiment').value;el('overlay').classList.toggle('depth-drag',experiment==='character');
    if(experiment==='color'&&el<HTMLSelectElement>('depth-display').value==='depth')ctx.putImageData(new ImageData(colorize(map),w,h),0,0);
    if(experiment==='points'){this.points.forEach((p,i)=>{ctx.fillStyle=i?'#22d8ff':'#ffcf52';ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(4,w/120),0,Math.PI*2);ctx.fill();ctx.font=`bold ${Math.max(16,w/32)}px sans-serif`;ctx.fillText(i?'B':'A',p.x*w+8,p.y*h-8);});el('depth-comparison').textContent=this.points.length===2?comparePoints(map,this.points[0],this.points[1]):'画像を2か所タップしてA・Bを選んでください。';}
    if(experiment==='character'){this.layer.width=w;this.layer.height=h;const layer=this.layer.getContext('2d')!,size=Math.min(w,h)*.35;layer.drawImage(this.texture,this.character.x*w-size/2,this.character.y*h-size/2,size,size);const image=layer.getImageData(0,0,w,h),alpha=new Uint8ClampedArray(w*h);for(let i=0;i<alpha.length;i++)alpha[i]=image.data[i*4+3];const visible=this.mask(alpha,1-Number(el<HTMLInputElement>('depth-character-depth').value)/100,el<HTMLInputElement>('depth-occlusion').checked);for(let i=0;i<visible.length;i++)image.data[i*4+3]=visible[i];layer.putImageData(image,0,0);ctx.drawImage(this.layer,0,0);}
    if(experiment==='hide')this.renderHide(ctx,w,h);
    this.renderer.setSceneFrames(experiment==='hide'?this.after:this.source,this.after,this.mirror,false);
    this.edgeStats.compositeMs=performance.now()-at;this.edgeDiagnostics();
  }
  private mask(alpha:Uint8ClampedArray,near:number,enabled:boolean){
    const base=occlusionAlpha(alpha,this.data!,near,enabled,.004),on=this.hiding?(this.stage==='edit'?el<HTMLInputElement>('hide-edge').checked:this.fixedEdge):el<HTMLInputElement>('depth-edge').checked;
    Object.assign(this.edgeStats,{refineMs:0,changed:0,ambiguous:0,examined:0,maxShift:0});
    if(!enabled||!on)return base;
    if(!this.edges){const at=performance.now();this.edges=photoEdges(this.source.getContext('2d')!.getImageData(0,0,this.source.width,this.source.height).data,this.source.width,this.source.height);this.edges.buildMs=performance.now()-at;this.edgeBuilds++;}
    const result=refineContour(alpha,base,this.data!,near,this.edges);Object.assign(this.edgeStats,{refineMs:result.duration,changed:result.changed,ambiguous:result.ambiguous,examined:result.examined,maxShift:result.maxShift});return result.alpha;
  }
  private edgeDiagnostics(){const metrics={...this.edgeStats,photoCacheBuildMs:this.edges?.buildMs??0,photoCacheBuilds:this.edgeBuilds,radius:this.data?correctionRadius(this.data.width,this.data.height):0};el('depth-edge-diagnostics').dataset.metrics=JSON.stringify(metrics);el('depth-edge-diagnostics').textContent=`輪郭情報の初回処理 ${metrics.photoCacheBuildMs.toFixed(2)} ms / この写真で${metrics.photoCacheBuilds}回\n境界補正 ${metrics.refineMs.toFixed(2)} ms / 合成 ${metrics.compositeMs.toFixed(2)} ms（AI時間を含まない）\n補正上限 ${metrics.radius}描画px / 今回最大 ${metrics.maxShift.toFixed(2)}px\n変更 ${metrics.changed}px / 競合時の維持 ${metrics.ambiguous}px\n写真情報は再利用。元の深度と従来のギザギザ軽減は維持。`;}
  private hideFrame(pose:HidePose){
    const {width:w,height:h}=this.data!,size=Math.min(w,h)*.35,left=pose.x*w-size/2,top=pose.y*h-size/2;
    this.layer.width=w;this.layer.height=h;const layer=this.layer.getContext('2d')!;layer.drawImage(this.texture,left,top,size,size);
    const image=layer.getImageData(0,0,w,h),alpha=new Uint8ClampedArray(w*h);
    for(let i=0;i<alpha.length;i++)if(Math.floor(i/w)>=top+size*51/256)alpha[i]=image.data[i*4+3];
    return{image,alpha,size,left,top,inside:left>=0&&top>=0&&left+size<=w&&top+size<=h};
  }
  private renderHide(ctx:CanvasRenderingContext2D,w:number,h:number){
    this.spotButton();
    el('overlay').classList.toggle('depth-drag',this.stage==='edit');
    if(this.stage==='pass'){ctx.fillStyle='#10191e';ctx.fillRect(0,0,w,h);return;}
    const {image,alpha,size,left,top}=this.hideFrame({...this.character,depth:Number(el<HTMLInputElement>('hide-depth').value)}),layer=this.layer.getContext('2d')!;this.body=alpha;
    this.visible=this.locked&&this.fixedVisible?this.fixedVisible:this.mask(alpha,1-Number(el<HTMLInputElement>('hide-depth').value)/100,true);
    if(this.stage==='edit'){
      const r=el('overlay').getBoundingClientRect(),scale=Math.min(r.width/w,r.height/h),inside=left>=0&&top>=0&&left+size<=w&&top+size<=h;
      this.quality=visibility(this.body,this.visible,w,h,scale,inside);const q=this.quality;
      el('hide-quality').textContent=`${q.label}（本体の${Math.round(q.ratio*100)}%が見えています）。${q.reason||'見える部分を確認して隠してください。'}`;el<HTMLButtonElement>('hide-lock').disabled=!q.ready||this.busy;
    }
    const progress=this.stage==='found'?Math.min(1,(performance.now()-this.reveal)/650):0;
    for(let i=0;i<alpha.length;i++)image.data[i*4+3]=this.visible[i]+(alpha[i]-this.visible[i])*progress;
    layer.putImageData(image,0,0);ctx.drawImage(this.layer,0,0);
  }
  point(clientX:number,clientY:number,canvas:HTMLCanvasElement,view:ViewId){const map=this.data;if(!map)return null;const rect=canvas.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top,pane=displayPanes(rect.width,rect.height,view).find(p=>x>=p.x&&x<=p.x+p.width&&y>=p.y&&y<=p.y+p.height);if(!pane)return null;return sourcePoint(x,y,map.width,map.height,[pane],this.mirror);}
  interact(clientX:number,clientY:number,canvas:HTMLCanvasElement,view:ViewId,drag=false){const p=this.point(clientX,clientY,canvas,this.view(view));if(!p||!this.data)return;const normalized={x:p.x/this.data.width,y:p.y/this.data.height},experiment=el<HTMLSelectElement>('depth-experiment').value;
    if(experiment==='hide'){
      if(this.stage==='search'&&!drag){const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/this.data.width,r.height/this.data.height);if(visibleHit(this.body,this.visible,this.data.width,this.data.height,p.x,p.y,7/scale))this.setStage('found');return;}
      if(this.stage!=='edit')return;this.character=normalized;
    }else if(experiment==='character'){this.character=normalized;}else if(experiment==='points'&&!drag){if(this.points.length===2)this.points=[];this.points.push(normalized);}else return;this.render();this.change();}
  get draggable(){return !!this.data&&(el<HTMLSelectElement>('depth-experiment').value==='character'||this.hiding&&this.stage==='edit');}
  clear(){this.invalidateSpots();this.edges=undefined;this.edgeKey='';this.edgeBuilds=0;this.fixedEdge=false;this.fixedVisible=undefined;el('depth-edge-diagnostics').textContent='未処理';el('depth-edge-diagnostics').removeAttribute('data-metrics');cancelAnimationFrame(this.animation);this.stage='edit';this.sync();this.body=this.visible=new Uint8ClampedArray();this.quality=undefined;el('hide-quality').textContent='写真を選び、奥行きを解析してください。';el<HTMLButtonElement>('hide-lock').disabled=true;el('hide-hint-text').textContent='';el('overlay').classList.remove('depth-drag');this.data=undefined;this.points=[];this.setBusy(false);this.source.width=this.source.height=this.after.width=this.after.height=this.layer.width=this.layer.height=1;el('depth-comparison').textContent='画像を2か所タップしてください。';el('depth-diagnostics').textContent='未解析';}
}
