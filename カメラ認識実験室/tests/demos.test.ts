import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparePhotos,slotChanged,hitBox,maskIntersection,WorkshopTrigger} from '../src/demos/logic.ts';
const frame=()=>({width:100,height:100,data:new Uint8ClampedArray(40000).fill(180)});
function rect(f:ReturnType<typeof frame>,x:number,y:number){for(let yy=y;yy<y+15;yy++)for(let xx=x;xx<x+15;xx++){const p=(yy*100+xx)*4;f.data[p]=240;f.data[p+1]=10;f.data[p+2]=20;}}
test('shared comparison finds both ends of a moved object, no change and global mismatch give guidance',()=>{
  const a=frame(),b=frame();rect(a,10,10);rect(b,65,65);const r=comparePhotos(a,b);assert.equal(r.reason,'');assert.ok(r.boxes.some(b=>hitBox(b,15,15,0)));assert.ok(r.boxes.some(b=>hitBox(b,70,70,0)));
  assert.equal(slotChanged(r.mask,100,100,{x:5,y:5,width:25,height:25}).changed,true);assert.equal(slotChanged(r.mask,100,100,{x:70,y:10,width:20,height:20}).changed,false);
  assert.ok(comparePhotos(a,a).reason);const different=frame();different.data.fill(0);assert.ok(comparePhotos(frame(),different).reason);assert.throws(()=>comparePhotos(a,{...b,width:50}));
  const nativeLike=Object.defineProperties({data:b.data},{width:{get:()=>100},height:{get:()=>100}}) as typeof b;
  assert.equal(comparePhotos(a,nativeLike).boxes.length,2,'ImageData dimensions are inherited accessors, not enumerable spread properties');
});
test('blue and motion must overlap at identical pixels; disjoint movement cannot complete the task',()=>{
  assert.deepEqual([...maskIntersection(Uint8Array.of(1,1,0,0),Uint8Array.of(0,0,1,1))],[0,0,0,0]);assert.deepEqual([...maskIntersection(Uint8Array.of(1,1,0,0),Uint8Array.of(0,1,1,0))],[0,1,0,0]);assert.throws(()=>maskIntersection(new Uint8Array(2),new Uint8Array(3)));
});
test('workshop requires distant detection then two distinct close frames, fires once, missing detection cannot confirm proximity',()=>{
  const t=new WorkshopTrigger();assert.equal(t.update(1,.1),false);assert.equal(t.update(2,.6),false);assert.equal(t.update(3,.1),false);assert.equal(t.update(3,.1),false);assert.equal(t.update(4,null),false);assert.equal(t.update(5,.1),false);assert.equal(t.update(6,.1),true);assert.equal(t.update(7,.1),false);assert.equal(t.update(8,.8),false);assert.equal(t.update(9,.1),false);
});
