import type { RecognitionMode, ModeResult } from './types';
export class DepthMode implements RecognitionMode {
  readonly id='depth';runtime='Depth Anything V2 Small Q4 / Worker / WASM 1 thread';loadMs=0;
  private worker?:Worker;private disposed=false;private busy=false;
  private pending?:{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
  private progress:(text:string)=>void;private size:number;
  constructor(size:number,progress:(text:string)=>void){this.size=size;this.progress=progress;}
  async initialize(){} // Heavy assets are loaded only after the explicit Analyze button.
  private request(data:object,transfer:Transferable[]=[]){return new Promise<any>((resolve,reject)=>{if(this.disposed||this.pending){reject(Error('深度解析を停止しました。'));return;}const timer=setTimeout(()=>{this.pending=undefined;reject(Error('奥行き解析がタイムアウトしました。入力サイズを下げて再試行してください。'));this.dispose();},180000);this.pending={resolve,reject,timer};this.worker!.postMessage(data,transfer);});}
  async infer(canvas:HTMLCanvasElement):Promise<ModeResult>{
    if(this.busy||this.disposed)throw Error('深度解析の重複要求または停止');this.busy=true;
    try{
      if(!this.worker){this.worker=new Worker(new URL('../depth/worker.ts',import.meta.url),{type:'module'});this.worker.onmessage=({data})=>{if(data.progress){if(!this.disposed)this.progress(data.progress);return;}const p=this.pending;if(!p)return;clearTimeout(p.timer);this.pending=undefined;data.error?p.reject(Error(data.error)):p.resolve(data);};this.worker.onerror=()=>{const p=this.pending;if(p){clearTimeout(p.timer);this.pending=undefined;p.reject(Error('深度Workerを起動できません。Safariの更新とWASM配置を確認してください。'));}};const r=await this.request({type:'init',base:new URL(import.meta.env.BASE_URL,location.href).href});this.loadMs=r.loadMs;}
      const image=canvas.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,canvas.width,canvas.height);const depth=await this.request({type:'infer',pixels:image.data,width:image.width,height:image.height,size:this.size},[image.data.buffer]);return{depth,duration:depth.duration};
    }finally{this.busy=false;}
  }
  dispose(){this.disposed=true;this.worker?.terminate();this.worker=undefined;const p=this.pending;if(p){clearTimeout(p.timer);p.reject(Error('深度解析を停止しました。'));this.pending=undefined;}}
}
