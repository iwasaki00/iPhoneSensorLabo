export type DepthMap = { width:number; height:number; values:Float32Array; minimum:number; maximum:number; duration:number; loadMs:number; inputWidth:number; inputHeight:number; outputWidth?:number;outputHeight?:number;nativeValues?:Float32Array };
/** No crop or padding. Each axis is resized to the closest multiple of ViT's patch size. */
export function inputSize(width:number,height:number,longEdge:number) {const s=longEdge/Math.max(width,height);return{width:Math.max(14,Math.round(width*s/14)*14),height:Math.max(14,Math.round(height*s/14)*14)};}
export function resizeFloat(source:Float32Array,sw:number,sh:number,dw:number,dh:number) {
  const out=new Float32Array(dw*dh);
  for(let y=0;y<dh;y++){const sy=Math.max(0,Math.min(sh-1,(y+.5)*sh/dh-.5)),y0=Math.floor(sy),fy=sy-y0,y1=Math.min(sh-1,y0+1);for(let x=0;x<dw;x++){const sx=Math.max(0,Math.min(sw-1,(x+.5)*sw/dw-.5)),x0=Math.floor(sx),fx=sx-x0,x1=Math.min(sw-1,x0+1);out[y*dw+x]=(source[y0*sw+x0]*(1-fx)+source[y0*sw+x1]*fx)*(1-fy)+(source[y1*sw+x0]*(1-fx)+source[y1*sw+x1]*fx)*fy;}}
  return out;
}
export function preprocess(pixels:Uint8ClampedArray,width:number,height:number,size:number) {
  const shape=inputSize(width,height,size),mean=[.485,.456,.406],std=[.229,.224,.225],out=new Float32Array(3*shape.width*shape.height);
  for(let c=0;c<3;c++){const channel=new Float32Array(width*height);for(let i=0;i<channel.length;i++)channel[i]=pixels[i*4+c]/255;const plane=resizeFloat(channel,width,height,shape.width,shape.height);for(let i=0;i<plane.length;i++)out[c*plane.length+i]=(plane[i]-mean[c])/std[c];}
  return{...shape,data:out};
}
export function range(values:Float32Array){let minimum=Infinity,maximum=-Infinity;for(const v of values){if(!Number.isFinite(v))throw Error('深度出力に非有限値が含まれています。');minimum=Math.min(minimum,v);maximum=Math.max(maximum,v);}return{minimum,maximum};}
/** Larger raw inverse-depth = nearer. Normalization is only within this image. */
export function relativeNear(value:number,map:Pick<DepthMap,'minimum'|'maximum'>){return Math.max(0,Math.min(1,(value-map.minimum)/Math.max(1e-8,map.maximum-map.minimum)));}
export function neighborhoodMedian(map:DepthMap,x:number,y:number,radius=3){const values:number[]=[],cx=Math.round(x*(map.width-1)),cy=Math.round(y*(map.height-1));for(let yy=Math.max(0,cy-radius);yy<=Math.min(map.height-1,cy+radius);yy++)for(let xx=Math.max(0,cx-radius);xx<=Math.min(map.width-1,cx+radius);xx++)values.push(map.values[yy*map.width+xx]);values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)];}
export function comparePoints(map:DepthMap,a:{x:number;y:number},b:{x:number;y:number}){const av=neighborhoodMedian(map,a.x,a.y),bv=neighborhoodMedian(map,b.x,b.y),span=map.maximum-map.minimum;if(span<1e-8||Math.abs(av-bv)<=span*.04)return'前後を判定しにくい';return av>bv?'Aの方が手前と推定':'Bの方が手前と推定';}
export function occlusionAlpha(alpha:Uint8ClampedArray,map:DepthMap,characterNear:number,enabled:boolean,feather=0){const out=new Uint8ClampedArray(alpha);if(enabled)for(let i=0;i<out.length;i++){
  if(!alpha[i])continue;const difference=relativeNear(map.values[i],map)-characterNear;
  const x=i%map.width,y=Math.floor(i/map.width),span=map.maximum-map.minimum;
  // A single raster pixel of edge coverage, capped in raw relative depth; avoid wide blur halos on flat slopes.
  const gradient=span>0?(Math.abs(map.values[y*map.width+Math.min(map.width-1,x+1)]-map.values[y*map.width+Math.max(0,x-1)])+Math.abs(map.values[Math.min(map.height-1,y+1)*map.width+x]-map.values[Math.max(0,y-1)*map.width+x]))/span/4:0;
  const band=Math.min(feather,gradient);if(band>0)out[i]=Math.round(alpha[i]*Math.max(0,Math.min(1,.5-difference/(2*band))));else if(difference>0)out[i]=0;
}return out;}
export function colorize(map:DepthMap){const data=new Uint8ClampedArray(map.width*map.height*4);for(let i=0;i<map.values.length;i++){const n=relativeNear(map.values[i],map);data[i*4]=Math.round(255*n);data[i*4+1]=Math.round(220*(1-Math.abs(n*2-1)));data[i*4+2]=Math.round(255*(1-n));data[i*4+3]=255;}return data;}
