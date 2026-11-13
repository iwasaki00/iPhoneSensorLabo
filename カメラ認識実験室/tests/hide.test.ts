import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibility,visibleHit} from '../src/depth/hide.ts';
test('body pixels exclude transparent margins; half-visible body is playable',()=>{
  const b=new Uint8ClampedArray(400),v=new Uint8ClampedArray(400);for(let y=5;y<15;y++)for(let x=5;x<15;x++){b[y*20+x]=255;if(x>=10)v[y*20+x]=255;}
  const q=visibility(b,v,20,20,2,true);assert.equal(q.ratio,.5);assert.equal(q.visible,50);assert.equal(q.largest,50);assert.ok(q.ready);
});
test('fully hidden, almost fully visible, clipped, tiny or fragmented visibility cannot start',()=>{
  const b=new Uint8ClampedArray(400).fill(255),v=new Uint8ClampedArray(400);assert.equal(visibility(b,v,20,20,2,true).ready,false);
  assert.equal(visibility(b,b,20,20,2,true).ready,false);v.fill(255,0,200);assert.equal(visibility(b,v,20,20,2,false).ready,false);assert.equal(visibility(b,v,20,20,.1,true).ready,false);
  const dots=Uint8ClampedArray.from(b,(_,i)=>i%2===0&&Math.floor(i/20)%2===0?255:0);assert.equal(visibility(b,dots,20,20,2,true).ready,false);
});
test('hit tolerance grows from visible body pixels, not hidden body, margins or rectangles',()=>{
  const b=new Uint8ClampedArray(400).fill(255),v=new Uint8ClampedArray(400);v[10*20+15]=255;
  assert.ok(visibleHit(b,v,20,20,14,10,2));assert.equal(visibleHit(b,v,20,20,5,10,2),false);b[215]=0;assert.equal(visibleHit(b,v,20,20,15,10,2),false);
});
