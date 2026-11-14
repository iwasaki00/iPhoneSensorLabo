import {test} from 'node:test';import assert from 'node:assert/strict';
import {displaySize} from '../src/depth/detail.ts';
import {occlusionAlpha} from '../src/depth/processing.ts';
import {sourcePoint,displayPanes} from '../src/display.ts';
test('presentation samples original photo at bounded DPR without upscaling or full-size phone canvases',()=>{
  assert.deepEqual(displaySize(4000,3000,360,590,3),{width:1080,height:810});
  assert.deepEqual(displaySize(3000,4000,360,590,3),{width:1080,height:1440});
  assert.deepEqual(displaySize(600,400,360,590,3),{width:600,height:400});
  const s=displaySize(8000,8000,4000,4000,8);assert.ok(s.width*s.height<=3001000);assert.ok(s.width<=2048);
});
test('small boundary coverage uses raw depth, OFF preserves original alpha, fully hidden pixels stay hidden',()=>{
  const d={width:5,height:1,values:new Float32Array([0,.497,.5,.503,1]),minimum:0,maximum:1,duration:1,loadMs:1,inputWidth:5,inputHeight:1};
  const a=new Uint8ClampedArray(5).fill(255),v=occlusionAlpha(a,d,.5,true,.004);assert.equal(v[0],255);assert.ok(v[1]>v[2]&&v[2]>v[3]);assert.equal(v[4],0);assert.deepEqual(occlusionAlpha(a,d,.5,false,.004),a);
});
test('portrait and landscape high-detail coordinates preserve mirror and split-view normalized positions',()=>{
  for(const [w,h] of [[900,1600],[1600,900]])for(const mirror of [true,false]){
    const a=sourcePoint(270,200,w,h,displayPanes(360,400,'split'),mirror),b=sourcePoint(270,200,w/2,h/2,displayPanes(360,400,'split'),mirror);assert.ok(a&&b);assert.ok(Math.abs(a.x/w-b.x/(w/2))<.003);assert.ok(Math.abs(a.y/h-b.y/(h/2))<.003);
  }
});
