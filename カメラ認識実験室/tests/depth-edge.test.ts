import {test} from 'node:test';import assert from 'node:assert/strict';
import {photoEdges,refineContour,correctionRadius} from '../src/depth/edge.ts';
import {occlusionAlpha,type DepthMap} from '../src/depth/processing.ts';
import {visibleHit} from '../src/depth/hide.ts';
const w=100,h=60;
const depth=():DepthMap=>({width:w,height:h,values:Float32Array.from({length:w*h},(_,i)=>(i%w)/(w-1)),minimum:0,maximum:1,inputWidth:280,inputHeight:168,duration:1,loadMs:1});
const pixels=(value:(x:number,y:number)=>number)=>Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%4===3?255:value(Math.floor(i/4)%w,Math.floor(i/4/w)));
test('a single strong contour moves only the existing depth boundary, within its movement limit',()=>{
  const d=depth(),original=new Float32Array(d.values),a=new Uint8ClampedArray(w*h).fill(255),base=occlusionAlpha(a,d,.5,true,.004),p=photoEdges(pixels(x=>x<52?20:220),w,h),r=refineContour(a,base,d,.5,p);
  assert.ok(r.changed>0);assert.ok(r.maxShift<=correctionRadius(w,h));assert.ok(r.alpha[30*w+51]>base[30*w+51]);assert.deepEqual(d.values,original);
  assert.equal(visibleHit(a,base,w,h,51,30,0),false);assert.equal(visibleHit(a,r.alpha,w,h,51,30,0),true);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(Math.abs(x-49.5)>correctionRadius(w,h)+1)assert.equal(r.alpha[y*w+x],base[y*w+x]);
});
test('weak edges, unrelated distant pattern and competing nearby lines retain the old mask',()=>{
  const d=depth(),a=new Uint8ClampedArray(w*h).fill(255),base=occlusionAlpha(a,d,.5,true,.004);
  for(const image of [pixels(()=>80),pixels(x=>x<70?20:220),pixels(x=>x>=47&&x<52?220:20)]){
    const r=refineContour(a,base,d,.5,photoEdges(image,w,h));assert.deepEqual(r.alpha,base);
  }
});
test('photo edges never create an occluder where depth has no boundary; body margins remain transparent',()=>{
  const d=depth();d.values.fill(.2);const a=new Uint8ClampedArray(w*h);a.fill(255,25*w,35*w);const base=occlusionAlpha(a,d,.5,true,.004),r=refineContour(a,base,d,.5,photoEdges(pixels(x=>x<52?0:255),w,h));assert.deepEqual(r.alpha,base);assert.equal(r.changed,0);
});
test('depth slider endpoints preserve base coverage even when display interpolation exceeds recorded extrema',()=>{
  const d=depth();for(let i=0;i<d.values.length;i++)d.values[i]*=2;const a=new Uint8ClampedArray(w*h).fill(255),p=photoEdges(pixels(x=>x<52?0:255),w,h);
  for(const near of [0,1]){const base=occlusionAlpha(a,d,near,true,.004);assert.deepEqual(refineContour(a,base,d,near,p).alpha,base);}
});
