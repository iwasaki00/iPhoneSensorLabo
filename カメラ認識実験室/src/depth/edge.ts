import type { DepthMap } from './processing';

/** Photo-only cache. Depth and original photo bytes are never modified. */
export type PhotoEdges={width:number;height:number;rgba:Uint8ClampedArray;gx:Int16Array;gy:Int16Array;buildMs:number};
export function photoEdges(rgba:Uint8ClampedArray,width:number,height:number):PhotoEdges{
  const at=performance.now(),gray=new Uint8Array(width*height),gx=new Int16Array(gray.length),gy=new Int16Array(gray.length);
  for(let i=0;i<gray.length;i++)gray[i]=(rgba[i*4]*77+rgba[i*4+1]*150+rgba[i*4+2]*29)/256;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;gx[i]=gray[i+1]-gray[i-1];gy[i]=gray[i+width]-gray[i-width];}
  return{width,height,rgba,gx,gy,buildMs:performance.now()-at};
}
export function correctionRadius(width:number,height:number){return Math.min(6,Math.max(2,Math.round(Math.min(width,height)/150)));}
export type EdgeResult={alpha:Uint8ClampedArray;changed:number;ambiguous:number;examined:number;maxShift:number;duration:number};

/** Snap an existing depth contour along its normal only. No contour is created from the photograph. */
export function refineContour(body:Uint8ClampedArray,base:Uint8ClampedArray,map:DepthMap,near:number,photo:PhotoEdges):EdgeResult{
  const at=performance.now(),out=new Uint8ClampedArray(base),w=map.width,h=map.height,span=map.maximum-map.minimum,radius=correctionRadius(w,h);
  let changed=0,ambiguous=0,examined=0,maxShift=0;
  const finish=()=>({alpha:out,changed,ambiguous,examined,maxShift,duration:performance.now()-at});
  if(span<=1e-8||near<=0||near>=1||photo.width!==w||photo.height!==h)return finish();
  const sample=(x:number,y:number)=>Math.max(0,Math.min(h-1,Math.round(y)))*w+Math.max(0,Math.min(w-1,Math.round(x)));
  const distance=(a:number,b:number)=>Math.hypot(photo.rgba[a*4]-photo.rgba[b*4],photo.rgba[a*4+1]-photo.rgba[b*4+1],photo.rgba[a*4+2]-photo.rgba[b*4+2]);
  for(let i=0;i<body.length;i++){
    if(!body[i])continue;const x=i%w,y=Math.floor(i/w);if(x<radius+4||y<radius+4||x>=w-radius-4||y>=h-radius-4)continue;
    const dx=(map.values[i+1]-map.values[i-1])/(2*span),dy=(map.values[i+w]-map.values[i-w])/(2*span),gradient=Math.hypot(dx,dy);
    if(gradient<1e-5)continue;
    const signed=((map.values[i]-map.minimum)/span-near)/gradient;
    if(Math.abs(signed)>radius+.75)continue;
    // Require a genuine threshold crossing locally, not a flat depth value near the threshold.
    const nx=dx/gradient,ny=dy/gradient;
    const lo=(map.values[sample(x-nx*(radius+1),y-ny*(radius+1))]-map.minimum)/span-near;
    const hi=(map.values[sample(x+nx*(radius+1),y+ny*(radius+1))]-map.minimum)/span-near;
    if(lo>=0||hi<=0)continue;examined++;
    const bx=x-nx*signed,by=y-ny*signed,candidates:{shift:number;score:number}[]=[];
    // Inspect two extra pixels for ambiguity only; accepted movement remains bounded by radius.
    for(let offset=-radius-2;offset<=radius+2;offset++){
      const px=bx+nx*offset,py=by+ny*offset,j=sample(px,py),magnitude=Math.hypot(photo.gx[j],photo.gy[j]);
      if(magnitude<24)continue;
      const alignment=Math.abs(photo.gx[j]*nx+photo.gy[j]*ny)/magnitude;if(alignment<.85)continue;
      // Both sides must be locally stable. Texture and competing lines cause conservative fallback.
      const a=sample(px-nx*2,py-ny*2),b=sample(px+nx*2,py+ny*2);
      if(distance(a,b)<48||distance(a,sample(px-nx*3,py-ny*3))>24||distance(b,sample(px+nx*3,py+ny*3))>24)continue;
      let coherent=true;for(const tangent of [-2,2]){const k=sample(px-ny*tangent,py+nx*tangent),m=Math.hypot(photo.gx[k],photo.gy[k]);if(m<magnitude*.5||Math.abs(photo.gx[k]*nx+photo.gy[k]*ny)<m*.8){coherent=false;break;}}
      if(!coherent)continue;
      const shift=(j%w-bx)*nx+(Math.floor(j/w)-by)*ny;if(Math.abs(shift)>radius+2)continue;
      candidates.push({shift,score:magnitude*alignment*(1-.05*Math.abs(shift)/radius)});
    }
    candidates.sort((a,b)=>b.score-a.score);const best=candidates.find(c=>Math.abs(c.shift)<=radius);if(!best)continue;
    if(candidates.some(c=>Math.abs(c.shift-best.shift)>2&&c.score>=best.score*.8)){ambiguous++;continue;}
    const cluster=candidates.filter(c=>Math.abs(c.shift)<=radius&&Math.abs(c.shift-best.shift)<=1.25),weight=cluster.reduce((s,c)=>s+c.score,0),shift=cluster.reduce((s,c)=>s+c.shift*c.score,0)/weight;
    if(Math.abs(shift)<.5)continue;
    const halfPixel=Math.min(.004/gradient,.5*(Math.abs(nx)+Math.abs(ny)));
    const coverage=Math.max(0,Math.min(1,.5-(signed-shift)/(2*Math.max(1e-5,halfPixel))));
    out[i]=Math.round(body[i]*coverage);if(out[i]!==base[i]){changed++;maxShift=Math.max(maxShift,Math.abs(shift));}
  }
  return finish();
}
