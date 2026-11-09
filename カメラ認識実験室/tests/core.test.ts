import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, Rate, containBox, convert, errorMessage } from '../src/core.ts';
const raw=[{boundingBox:{originX:10,originY:20,width:30,height:40},categories:[{categoryName:'person',score:0.5}]}];
test('日本語変換・閾値境界・英語フォールバック',()=>{
  assert.equal(convert(raw,0.5)[0].label,'人');assert.equal(convert(raw,0.51).length,0);
  assert.equal(convert([{...raw[0],categories:[{categoryName:'unknown item',score:0.9}]}],0.5)[0].label,'unknown item');
  assert.equal(convert([{categories:[]}],0.1).length,0);
  assert.equal(convert([{...raw[0],categories:[{categoryName:'person',score:NaN}]}],0.1).length,0);
});
test('containの余白・前面鏡像・縦横座標',()=>{
  const b={x:10,y:20,width:30,height:40};
  assert.deepEqual(containBox(b,100,100,200,400),{x:20,y:140,width:60,height:80});
  assert.deepEqual(containBox(b,100,100,200,400,true),{x:120,y:140,width:60,height:80});
  assert.deepEqual(containBox(b,100,200,400,200),{x:160,y:20,width:30,height:40});
});
test('権限・デバイス・取得・推論エラーの案内',()=>{
  for(const name of ['NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError'])assert.ok(errorMessage({name}).length>20);
  assert.equal(errorMessage(new Error('モデル取得失敗')),'モデル取得失敗');
});
function fixture(getMedia?:any){let stopped=0;const track={stop(){stopped++;},addEventListener(){},getSettings(){return {}}};const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};const video={srcObject:null,pause(){},async play(){}};return {camera:new Camera(video as any,getMedia??(async()=>stream as any)),video,stream,stopped:()=>stopped};}
test('カメラ開始・停止・繰返し停止でTrack解放',async()=>{
  const f=fixture();assert.equal(await f.camera.start('environment',()=>{}),true);assert.equal(f.video.srcObject,f.stream);f.camera.stop();f.camera.stop();assert.equal(f.stopped(),1);assert.equal(f.video.srcObject,null);
});
test('許可待ち中に停止した場合の遅着Streamも解放',async()=>{
  let resolve:any;const f=fixture(()=>new Promise(r=>resolve=r));const pending=f.camera.start('user',()=>{});f.camera.stop();resolve(f.stream);assert.equal(await pending,false);assert.equal(f.stopped(),1);assert.equal(f.video.srcObject,null);
});
test('カメラ許可拒否と再生失敗を伝播し解放',async()=>{
  const denied=fixture(async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});});await assert.rejects(()=>denied.camera.start('user',()=>{}),{name:'NotAllowedError'});
  const f=fixture();f.video.play=async()=>{throw new Error('play failed');};await assert.rejects(()=>f.camera.start('user',()=>{}),/play failed/);assert.equal(f.stopped(),1);assert.equal(f.video.srcObject,null);
});
test('FPSは実測イベントから算出し停止時に失効',()=>{const r=new Rate();assert.equal(r.value(0),null);r.tick(100);r.tick(200);r.tick(300);assert.equal(r.value(300),10);assert.equal(r.value(3000),null);r.reset();assert.equal(r.value(3000),null);});
test('旧セッションの再生失敗が新しいカメラを停止しない',async()=>{
  let rejectPlay:(e:Error)=>void=()=>{};const f=fixture();
  f.video.play=()=>new Promise<void>((_,reject)=>{rejectPlay=reject;});
  const old=f.camera.start('environment',()=>{});await Promise.resolve();
  f.camera.stop();f.video.play=async()=>{};
  assert.equal(await f.camera.start('user',()=>{}),true);
  rejectPlay(new Error('old playback aborted'));assert.equal(await old,false);
  assert.equal(f.video.srcObject,f.stream);f.camera.stop();
});
