import type { RecognitionMode, ModeResult } from './types';
import type { TextSettings } from '../textmarker/settings';
import type { TextData, TextEntity } from '../textmarker/types';
import { CodeHistory, homography, originalPoint } from '../textmarker/geometry';
import type { Point } from './pixels';
export class TextMarkerMode implements RecognitionMode {
  readonly id = 'textmarker'; runtime = 'Text & Marker / 専用Worker / 端末内';
  private config: TextSettings; private reference?: { id: string; image: ImageData }; private progress: (s: string) => void;
  private worker?: Worker; private disposed = false; private busy = false; private sequence = 0; private history = new CodeHistory();
  private pending?: { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
  constructor(config: TextSettings, reference: {id:string;image:ImageData}|undefined, progress: (s:string)=>void) { this.config=structuredClone(config);this.reference=reference;this.progress=progress; }
  async initialize() {
    this.worker=new Worker(new URL('text-worker.js',new URL(import.meta.env.BASE_URL,location.href)));
    this.worker.onmessage=({data})=>{ if(data.disposed){this.worker?.terminate();this.worker=undefined;return;} if(data.progress){if(!this.disposed)this.progress(data.progress);return;} const p=this.pending;if(!p)return;clearTimeout(p.timer);this.pending=undefined;data.error?p.reject(new Error(data.error)):p.resolve(data); };
    this.worker.onerror=()=>{const p=this.pending;if(p){clearTimeout(p.timer);this.pending=undefined;p.reject(new Error('解析Workerを起動できません。同じサイトのアセット配置を確認してください。'));}};
  }
  async infer(source:HTMLCanvasElement,capturedAt:number):Promise<ModeResult> {
    if(this.disposed||this.busy)throw Error('解析停止または重複要求');this.busy=true;const s=this.config,start=performance.now();
    const canvas=document.createElement('canvas');
    try {
      const ocr=s.tab==='ocr', crop=ocr?{x:s.cropX/100,y:s.cropY/100,w:s.cropW/100,h:s.cropH/100}:{x:0,y:0,w:1,h:1};
      const cw=source.width*crop.w,ch=source.height*crop.h,scale=ocr?Math.min(s.zoom,2048/Math.max(cw,ch)):1,bw=Math.max(1,Math.round(cw*scale)),bh=Math.max(1,Math.round(ch*scale)),rotation=ocr?s.rotation:0;
      canvas.width=rotation%180?bh:bw;canvas.height=rotation%180?bw:bh;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
      ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(source,crop.x*source.width,crop.y*source.height,cw,ch,-bw/2,-bh/2,bw,bh);ctx.setTransform(1,0,0,1,0,0);
      const image=ctx.getImageData(0,0,canvas.width,canvas.height);
      if(ocr&&s.preprocessing!=='original'){for(let i=0;i<image.data.length;i+=4){let g=image.data[i]*.299+image.data[i+1]*.587+image.data[i+2]*.114;if(s.preprocessing==='binary')g=g>=140?255:0;image.data[i]=image.data[i+1]=image.data[i+2]=g;}ctx.putImageData(image,0,0);}
      const png=ocr?new Uint8Array(await (await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('画像変換失敗')),'image/png'))).arrayBuffer()):undefined;
      if(this.disposed)throw Error('解析を停止しました。');
      const payload=await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending=undefined;this.dispose();reject(Error('解析がタイムアウトしました。解像度を下げて再試行してください。'));},120000);this.pending={resolve,reject,timer};this.worker!.postMessage({kind:ocr?'ocr':s.tab==='overlay'?s.overlaySource:s.tab==='match'?'match':s.tab,base:new URL(import.meta.env.BASE_URL,location.href).href,image,settings:s,png,reference:this.reference},[image.data.buffer,...(png?[png.buffer]:[])]);});
      if(this.disposed)throw Error('古い結果を破棄しました。');
      const map=(p:Point):Point=>originalPoint(p,rotation,crop);
      const entities:TextEntity[]=(payload.items??[]).slice(0,2000).map((r:any,i:number)=>{
        let corners:Point[]|undefined=r.corners;const points:Point[]|undefined=r.points;
        if(r.box){const b=r.box;corners=[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}].map(map);}
        const pts=corners??points??[],xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
        const e:TextEntity={id:`text-${i}`,category:r.category,box:{x,y,width,height},center:{x:x+width/2,y:y+height/2},area:width*height,text:r.text,format:r.format,content:r.content,markerId:r.markerId,referenceId:r.referenceId,corners,points};
        if(Number.isFinite(r.confidence))e.confidence=r.confidence;
        if(corners?.length===4&&width>0&&height>0){e.homography=homography(corners);e.angle=Math.atan2((corners[1].y-corners[0].y)*source.height,(corners[1].x-corners[0].x)*source.width)*180/Math.PI;}
        if(r.content!==undefined)e.repeats=this.history.update(r.format,r.content,capturedAt).count;
        return e;
      });
      const duration=performance.now()-start, result={engine:s.tab==='ocr'?`Tesseract.js 7.0.0 / ${s.language}`:s.tab==='code'?'ZXing 0.23.0':s.tab==='match'||s.tab==='overlay'&&s.overlaySource==='match'?'OpenCV 4.12.0 ORB / Hamming / RANSAC':'js-aruco2 2.0.0 / ARUCO_MIP_36h12',frameId:`text-${capturedAt.toFixed(3)}-${++this.sequence}`,capturedAt,processedAt:performance.now(),expiresAt:capturedAt+s.ttl,duration,entities};
      const data:TextData={result,text:payload.text,confidence:payload.confidence,note:payload.note??'',features:payload.features??0,matches:payload.matches??0,inliers:payload.inliers??0,...(ocr?{preview:ctx.getImageData(0,0,canvas.width,canvas.height)}:{})};
      return {duration,textMarker:data};
    } finally {this.busy=false;canvas.width=canvas.height=1;}
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.reference=undefined;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Error('解析を停止しました。'));this.pending=undefined;}const w=this.worker;w?.postMessage({type:'dispose'});setTimeout(()=>{w?.terminate();if(this.worker===w)this.worker=undefined;},500);}
}
