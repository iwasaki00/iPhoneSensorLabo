import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coarseSpots,distinctSpots,spotScore,SPOT_LIMITS} from '../src/depth/spots.ts';
import type {DepthMap} from '../src/depth/processing.ts';
const map=(flat=false):DepthMap=>({width:120,height:80,values:Float32Array.from({length:9600},(_,i)=>flat?1:i%120<60?0:1),minimum:flat?1:0,maximum:1,duration:0,loadMs:0,inputWidth:120,inputHeight:80});
test('bounded depth transition trials provide in-bounds distinct candidates, not filler on flat maps',async()=>{
  const art=new Uint8ClampedArray(48*48).fill(255),result=await coarseSpots(map(),art,48,3,()=>true,async()=>{});
  assert.ok(result.spots.length);assert.ok(result.trials<=SPOT_LIMITS.trials);assert.ok(result.spots.length<=SPOT_LIMITS.finalists);
  for(const s of result.spots){assert.ok(s.ratio>=.12&&s.ratio<=.65);assert.ok(s.cohesion>=.6);assert.ok(s.x>=14/120&&s.x<=1-14/120);}
  assert.equal((await coarseSpots(map(true),art,48,3,()=>true,async()=>{})).spots.length,0);
});
test('search yields and cancels without publishing its accumulated trials',async()=>{
  let active=true,yields=0;const result=await coarseSpots(map(),new Uint8ClampedArray(2304).fill(255),48,3,()=>active,async()=>{yields++;active=false;});
  assert.ok(yields>0);assert.equal(result.spots.length,0);assert.ok(result.trials<=18);
});
test('coherence outranks fragments; nearby depth alternatives collapse, never fabricate three',()=>{
  const q={ratio:.35,visible:100,largest:95,spanX:12,spanY:12,ready:true,reason:'',label:''};
  assert.ok(spotScore(q)>spotScore({...q,largest:20}));
  const s={x:.5,y:.5,depth:40,score:3,ratio:.3,cohesion:1};
  assert.equal(distinctSpots([s,{...s,x:.501,depth:41}],600,400,3).length,1);
  assert.equal(distinctSpots([],600,400,3).length,0);
});
