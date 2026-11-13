import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPlacements, simulatedFrame, boundPlacement, hitPlacement } from '../src/textmarker/playground-model.ts';
import { CardReactions, cardDistance } from '../src/textmarker/cards.ts';
test('initial mock cards have original IDs, quiet-zone corners, separated centers and no spontaneous event',()=>{
  const p=initialPlacements(),s=new CardReactions();for(const t of [100,300,500])s.update(simulatedFrame(p,t,'s'+t),360,480,t+1);assert.equal(s.total,0);
  const frame=simulatedFrame(p,100,'f');assert.deepEqual(frame.result.entities.map(e=>e.markerId),[7,11,19]);assert.match(frame.result.engine,/模擬検出/);assert.equal(frame.result.entities[0].confidence,undefined);
  const [a,b,c]=frame.result.entities;for(const [x,y] of [[a,b],[a,c],[b,c]])assert.ok(cardDistance(x,y,360,480)>2.5);
  assert.ok(Math.abs((a.corners![1].x-a.corners![0].x)*360-68*.8)<1e-10);
  p[0].x=200;assert.notEqual(frame.result.entities[0].center.x,p[0].x/360);
});
test('mock geometry rotates, scales, clamps to board, and only hits visible rotated cards',()=>{
  const p=initialPlacements()[0];p.angle=90;p.size=100;p.x=100;p.y=200;
  const e=simulatedFrame([p],100,'r').result.entities[0];assert.ok(Math.abs(e.corners![0].x-140/360)<1e-10);assert.ok(Math.abs(e.corners![0].y-160/480)<1e-10);
  assert.equal(hitPlacement(p,100,200),true);assert.equal(hitPlacement(p,200,200),false);p.visible=false;assert.equal(hitPlacement(p,100,200),false);assert.equal(simulatedFrame([p],200,'hidden').result.entities.length,0);
  p.x=-100;p.y=999;p.size=999;p.angle=999;boundPlacement(p);assert.equal(p.size,120);assert.equal(p.angle,180);assert.ok(p.x>=60&&p.y<480);
});
test('simulator uses shared pair engine for all pairs, repeated draws do not count, reset drops effects',()=>{
  for(const indices of [[0,1],[0,2],[1,2]]){const p=initialPlacements();p.forEach((e,i)=>e.visible=indices.includes(i));p[indices[0]].x=100;p[indices[0]].y=200;p[indices[1]].x=180;p[indices[1]].y=200;
    const s=new CardReactions(),first=simulatedFrame(p,100,'first');for(let i=0;i<100;i++)s.update(first,360,480,110);assert.equal(s.total,0);s.update(simulatedFrame(p,300,'2'),360,480,310);s.update(simulatedFrame(p,500,'3'),360,480,510);assert.equal(s.total,1);assert.ok(s.effect(p[indices[0]].key,600));s.clear();assert.equal(s.total,0);assert.equal(s.effect(p[indices[0]].key,600),undefined);
  }
});
