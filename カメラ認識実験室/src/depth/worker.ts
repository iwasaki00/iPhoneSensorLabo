/// <reference lib="webworker" />
import { preprocess, resizeFloat, range } from './processing';
declare const self:DedicatedWorkerGlobalScope;
let ort:any,session:any,busy=false,loadMs=0;
self.onmessage=async({data})=>{
  if(busy){self.postMessage({error:'深度解析の重複要求'});return;}busy=true;
  try{
    if(data.type==='init'){
      const at=performance.now();self.postMessage({progress:'モデル読み込み中…同一サイトのQ4モデルとWASMを準備しています。'});
      ort=await import(/* @vite-ignore */ data.base+'vendor/depth/ort.wasm.min.mjs');
      ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=data.base+'vendor/depth/';
      session=await ort.InferenceSession.create(data.base+'vendor/depth/model_q4.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'all'});
      loadMs=performance.now()-at;self.postMessage({ready:true,loadMs,isolated:self.crossOriginIsolated,threads:1});
    }else{
      self.postMessage({progress:'解析中…単一スレッドWASMで相対奥行きを推定しています。'});
      const at=performance.now(),p=preprocess(data.pixels,data.width,data.height,data.size),input=new ort.Tensor('float32',p.data,[1,3,p.height,p.width]);let outputs:any;
      try{outputs=await session.run({pixel_values:input});const tensor=outputs.predicted_depth,shape=tensor.dims,values=resizeFloat(tensor.data,shape[shape.length-1],shape[shape.length-2],data.width,data.height);const result={width:data.width,height:data.height,values,...range(values),inputWidth:p.width,inputHeight:p.height,loadMs,duration:performance.now()-at};self.postMessage(result,[values.buffer]);}
      finally{input.dispose();if(outputs)Object.values(outputs).forEach((v:any)=>v.dispose());}
    }
  }catch(e){self.postMessage({error:e instanceof Error?e.message:String(e)});}finally{busy=false;}
};
