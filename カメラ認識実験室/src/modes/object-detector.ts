import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import type { RecognitionMode } from './types';
import type { RawDetection } from '../core';
const base = new URL(import.meta.env.BASE_URL, location.href).href;
export class ObjectMode implements RecognitionMode {
  readonly id = 'object-detection';
  runtime = '未初期化';
  private worker?: Worker;
  private detector?: ObjectDetector;
  private pending?: {resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
  private disposed = false;
  private request(message: object, transfer: Transferable[] = [], timeout = 30000): Promise<any> {
    return new Promise((resolve,reject)=>{
      if (this.pending) { reject(new Error('推論の重複要求')); return; }
      const timer=setTimeout(()=>{this.pending=undefined;reject(new Error('モデル読込または推論がタイムアウトしました。停止して再試行してください。'));},timeout);
      this.pending={resolve,reject,timer};
      try { this.worker!.postMessage(message, transfer); } catch(e) { clearTimeout(timer);this.pending=undefined;reject(e); }
    });
  }
  async initialize() {
    try {
      if (!('Worker' in window) || !('createImageBitmap' in window) || !('OffscreenCanvas' in window)) throw new Error('Worker機能なし');
      this.worker=new Worker(new URL('vision-worker.js',base));
      this.worker.onmessage=({data})=>{const p=this.pending;if(!p)return;clearTimeout(p.timer);this.pending=undefined;data.error?p.reject(new Error(data.error)):p.resolve(data);};
      this.worker.onerror=()=>{const p=this.pending;if(p){clearTimeout(p.timer);this.pending=undefined;p.reject(new Error('Worker実行非対応'));}};
      await this.request({type:'init',base});
      this.runtime='Worker / CPU';
    } catch (error) {
      this.worker?.terminate();this.worker=undefined;
      if(this.disposed)throw new Error('初期化中止');
      await this.initializeMain();
      this.runtime+=` / Worker初期化: ${String(error).slice(0,160)}`;
    }
    if(this.disposed){this.dispose();throw new Error('初期化中止');}
  }
  private async initializeMain(){
      const vision=await FilesetResolver.forVisionTasks(new URL('vendor/wasm',base).href);
      const detector=await ObjectDetector.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('models/efficientdet_lite0.tflite',base).href,delegate:'CPU'},runningMode:'VIDEO',scoreThreshold:0.1,maxResults:20});
      if(this.disposed){detector.close();throw new Error('初期化中止');}
      this.detector=detector;this.runtime='メインスレッド / CPU（互換方式）';
  }
  async infer(input: HTMLCanvasElement,timestamp: number): Promise<{detections:RawDetection[];duration:number}> {
    if(this.worker){
      let bitmap:ImageBitmap|undefined;
      try{bitmap=await createImageBitmap(input);if(this.disposed)throw new Error('推論中止');return await this.request({type:'infer',bitmap,timestamp},[bitmap],15000);}
      catch(e){bitmap?.close();if(this.disposed)throw e;this.worker?.terminate();this.worker=undefined;await this.initializeMain();this.runtime+=` / Worker推論: ${String(e).slice(0,160)}`;}
    }
    if(!this.detector)throw new Error('モデル未読込');
    const start=performance.now();const result=this.detector.detectForVideo(input,timestamp);
    return {detections:result.detections,duration:performance.now()-start};
  }
  dispose(){this.disposed=true;this.worker?.terminate();this.worker=undefined;this.detector?.close();this.detector=undefined;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('処理中止'));this.pending=undefined;}}
}
