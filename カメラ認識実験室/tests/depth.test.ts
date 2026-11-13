import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inputSize,resizeFloat,preprocess,range,relativeNear,neighborhoodMedian,comparePoints,occlusionAlpha,colorize} from '../src/depth/processing.ts';
import {sourcePoint,displayPanes} from '../src/display.ts';
const map=(values:number[],width:number,height:number)=>({width,height,values:new Float32Array(values),...range(new Float32Array(values)),duration:1,loadMs:2,inputWidth:width,inputHeight:height});
test('depth preprocessing resizes axes to multiples of 14 without crop/padding and normalizes RGB planes',()=>{
  assert.deepEqual(inputSize(1024,681,280),{width:280,height:182});assert.deepEqual(inputSize(100,200,280),{width:140,height:280});
  const p=preprocess(new Uint8ClampedArray([255,0,128,255]),1,1,14);assert.equal(p.data.length,3*14*14);assert.ok(Math.abs(p.data[0]-(1-.485)/.229)<1e-5);assert.ok(Math.abs(p.data[196]-(0-.456)/.224)<1e-5);
});
test('raw map bilinear restoration aligns centers, landscape/portrait axes and endpoints',()=>{
  assert.deepEqual(Array.from(resizeFloat(new Float32Array([1,0]),2,1,4,1)),[1,.75,.25,0]);assert.deepEqual(Array.from(resizeFloat(new Float32Array([1,0]),1,2,1,4)),[1,.75,.25,0]);assert.throws(()=>range(new Float32Array([NaN])));
});
test('neighborhood median ignores isolated outlier, small relative differences are ambiguous',()=>{
  const d=map([0,.5,.5,.5,.5,.5,.5,.5,1],3,3);assert.equal(neighborhoodMedian(d,.5,.5),.5);assert.equal(comparePoints(d,{x:0,y:0},{x:1,y:1}),'前後を判定しにくい');
  const v=map(Array.from({length:100},(_,i)=>i%10<5?1:0),10,10);assert.equal(comparePoints(v,{x:0,y:.5},{x:1,y:.5}),'Aの方が手前と推定');assert.equal(relativeNear(1,v),1);
});
test('partial occlusion uses raw values and preserves alpha with OFF, equality and constant maps',()=>{
  const d=map([10,20,30,40],4,1),a=new Uint8ClampedArray([255,128,255,64]);assert.deepEqual(Array.from(occlusionAlpha(a,d,.5,true)),[255,128,0,0]);assert.deepEqual(Array.from(occlusionAlpha(a,d,.5,false)),Array.from(a));assert.deepEqual(Array.from(a),[255,128,255,64]);assert.deepEqual(Array.from(occlusionAlpha(a,map([2,2,2,2],4,1),0,true)),Array.from(a));
});
test('color convention maps larger raw values to red near, midpoint green and smaller values blue far',()=>{const pixels=colorize(map([10,20,30],3,1));assert.deepEqual(Array.from(pixels.slice(0,4)),[0,0,255,255]);assert.deepEqual(Array.from(pixels.slice(4,8)),[128,220,128,255]);assert.deepEqual(Array.from(pixels.slice(8)),[255,0,0,255]);});
test('front mirror and side-by-side panes map taps to the same original raw depth pixels',()=>{
  const panes=displayPanes(400,300,'split');assert.deepEqual(sourcePoint(40,150,200,100,panes,false),{x:40,y:50});assert.deepEqual(sourcePoint(360,150,200,100,panes,true),{x:39,y:50});assert.equal(sourcePoint(40,2,200,100,panes,false),null);
});
