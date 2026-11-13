import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cards, cardFor, CardReactions, cardDistance } from '../src/textmarker/cards.ts';
import { markerSVG } from '../src/textmarker/geometry.ts';
import { parseText } from '../src/textmarker/settings.ts';
import type { TextData, TextEntity } from '../src/textmarker/types.ts';
function entity(id:number,x:number,y=200):TextEntity {const s=80,w=640,h=480;return{id:String(id),category:'マーカー',markerId:id,center:{x:x/w,y:y/h},box:{x:(x-s/2)/w,y:(y-s/2)/h,width:s/w,height:s/h},area:s*s/w/h,corners:[{x:(x-s/2)/w,y:(y-s/2)/h},{x:(x+s/2)/w,y:(y-s/2)/h},{x:(x+s/2)/w,y:(y+s/2)/h},{x:(x-s/2)/w,y:(y+s/2)/h}]};}
function frame(t:number,entities:TextEntity[]):TextData{return{result:{engine:'marker',frameId:'frame-'+t,capturedAt:t,processedAt:t+5,expiresAt:t+500,duration:5,entities},note:'',features:0,matches:0,inliers:0};}
test('card mapping uses three distinct valid dictionary IDs and preserves legacy settings',()=>{
  assert.deepEqual(cards.map(c=>c.id),[7,11,19]);for(const c of cards){assert.ok(markerSVG(c.id));assert.equal(cardFor(c.id)?.key,c.key);}assert.equal(cardFor(249),undefined);assert.equal(parseText('{"tab":"cards","input":"still"}').input,'continuous');assert.equal(parseText('{"tab":"marker","input":"still"}').input,'still');
});
test('distance uses source pixels and apparent mean edges, invariant under scaling and mirror',()=>{
  const a=entity(7,100),b=entity(19,180);assert.equal(cardDistance(a,b,640,480),1);assert.equal(cardDistance(a,b,1280,960),1);
  const mirror=(e:TextEntity)=>({...e,center:{x:1-e.center.x,y:e.center.y},corners:e.corners!.map(p=>({x:1-p.x,y:p.y}))});assert.equal(cardDistance(mirror(a),mirror(b),640,480),1);
});
test('all unordered pairs fire once, require confirmed separation, and survive transient misses/expiry',()=>{
  for(const ids of [[7,19],[11,19],[7,11]]){
    const state=new CardReactions();let time=0;const feed=(near:boolean,reverse=false)=>{time+=200;const entities=[entity(ids[0],100),entity(ids[1],near?220:400)];state.update(frame(time,reverse?entities.reverse():entities),640,480,time+10);};
    feed(true);feed(true,true);assert.equal(state.total,0);feed(true);assert.equal(state.total,1);
    for(let i=0;i<6;i++)feed(true,i%2===0);assert.equal(state.total,1);
    time+=200;state.update(frame(time,[]),640,480,time+10);feed(true);feed(true);feed(true);assert.equal(state.total,1);
    state.expire();for(let i=0;i<3;i++)feed(true);assert.equal(state.total,1);
    feed(false);feed(false);feed(true);assert.equal(state.total,1);for(let i=0;i<3;i++)feed(false);for(let i=0;i<3;i++)feed(true);assert.equal(state.total,2);
  }
});
test('same, older and expired frames cannot increment confirmations or combine unseen cards',()=>{
  const state=new CardReactions(),one=frame(100,[entity(7,100),entity(19,220)]);
  for(let i=0;i<30;i++)state.update(one,640,480,110);assert.equal(state.total,0);
  state.update(frame(200,[entity(7,100)]),640,480,210);state.update(frame(300,[entity(19,220)]),640,480,310);assert.equal(state.total,0);
  assert.equal(state.update(frame(400,[entity(7,100),entity(19,220)]),640,480,900),false);
  assert.equal(state.update(one,640,480,110),false);assert.equal(state.total,0);
});
test('confirmation gaps, missing frames and ambiguous duplicates reset partial observations',()=>{
  const s=new CardReactions(),pair=[entity(7,100),entity(19,220)];for(const t of [100,300,1800,2000])s.update(frame(t,pair),640,480,t+10);assert.equal(s.total,0);
  s.update(frame(2200,[]),640,480,2210);s.update(frame(2400,pair),640,480,2410);s.update(frame(2600,[...pair,entity(7,400)]),640,480,2610);for(const t of [2800,3000])s.update(frame(t,pair),640,480,t+10);assert.equal(s.total,0);
  s.update(frame(3200,pair),640,480,3210);assert.equal(s.total,1);assert.ok(s.effect('robot',3300));assert.equal(s.effect('robot',5100),undefined);s.clear();assert.equal(s.total,0);assert.equal(s.effect('robot',3300),undefined);
});
test('unknown IDs have diagnostics but no reaction or character assignment',()=>{
  const s=new CardReactions();for(const t of [100,200,300])s.update(frame(t,[entity(7,100),entity(249,210)]),640,480,t+5);assert.equal(s.total,0);assert.match(s.diagnostics,/ID 249: 割り当てなし/);
});
