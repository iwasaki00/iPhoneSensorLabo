import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { markerSVG } from '../../src/textmarker/geometry';
async function init(page:Page){
  await page.addInitScript((svgs)=>{
    localStorage.setItem('camera-vision-lab.v2',JSON.stringify({mode:'textmarker'}));localStorage.setItem('camera-vision-lab.text.v1',JSON.stringify({tab:'cards',interval:100,resolution:960,ttl:1500}));
    const state=window as any;state.__ids=[7,19];state.__near=false;state.__starts=0;
    navigator.mediaDevices.getUserMedia=async()=>{state.__starts++;const images:Record<string,HTMLImageElement>={};for(const [id,svg] of Object.entries(svgs)){const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();images[id]=image;}
      const c=document.createElement('canvas');c.width=1000;c.height=600;const ctx=c.getContext('2d')!;const draw=()=>{ctx.fillStyle='white';ctx.fillRect(0,0,1000,600);state.__ids.forEach((id:number,i:number)=>{const x=state.__near?260+i*230:30+i*650;ctx.save();ctx.translate(x+100,300);ctx.rotate((state.__angle??0)*(i?-1:1));ctx.drawImage(images[id],-100,-100,200,200);ctx.restore();});};draw();const timer=setInterval(draw,50),stream=c.captureStream(20);state.__stream=stream;stream.getTracks().forEach(track=>{const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};});return stream;};
  },Object.fromEntries([7,11,19,249].map(id=>[id,markerSVG(id)])));
  await page.goto('/');await expect(page.locator('#tm-tab')).toHaveValue('cards');
}
async function count(page:Page,n:number){await expect(page.locator('#card-diagnostics')).toContainText(`合計 ${n}反応`,{timeout:15000});}
test('three printable cards generate PNGs with the correct real detector IDs',async({page})=>{
  await page.goto('/ar-cards.html');await expect(page.locator('#cards canvas')).toHaveCount(3);
  const sources=await page.locator('#cards canvas').evaluateAll((nodes:HTMLCanvasElement[])=>nodes.map(c=>({id:c.dataset.markerId!,png:c.toDataURL().split(',')[1]})));
  expect(sources.map(s=>s.id)).toEqual(['7','11','19']);
  await page.setViewportSize({width:794,height:1123});await page.emulateMedia({media:'print'});await expect(page.locator('#cards article')).toHaveCount(3);expect(await page.locator('#cards').evaluate(e=>e.scrollWidth)).toBeLessThanOrEqual(794);await page.screenshot({path:'docs/v0.7.0-card-print-layout.png',fullPage:true});await page.emulateMedia({media:'screen'});
  const download=page.waitForEvent('download');await page.locator('#cards button').first().click();expect((await readFile((await(await download).path())!)).slice(1,4).toString()).toBe('PNG');
  await page.addInitScript(()=>{localStorage.setItem('camera-vision-lab.v2',JSON.stringify({mode:'textmarker'}));localStorage.setItem('camera-vision-lab.text.v1',JSON.stringify({tab:'marker',input:'still'}));});await page.goto('/');
  for(const source of sources){await page.locator('#scene-file').setInputFiles({name:'card.png',mimeType:'image/png',buffer:Buffer.from(source.png,'base64')});await expect(page.locator('#tm-data')).toContainText('ID '+source.id,{timeout:15000});}
  await page.goto('/ar-cards.html?card=slime');await expect(page.locator('#cards canvas')).toHaveCount(1);await expect(page.locator('#cards canvas')).toHaveAttribute('data-marker-id','11');
});
test('real two-card reactions, left/right order, missing IDs, mirror and camera lifecycle',async({page})=>{
  await init(page);await expect(page.locator('#card-prepare')).toHaveCount(0);await expect(page.locator('.card-prepare')).toBeVisible();await expect(page.locator('#tm-reference')).toBeHidden();
  await page.locator('#card-start').click();await expect(page.locator('#card-diagnostics')).toContainText('ID 7',{timeout:15000});await expect(page.locator('#card-diagnostics')).toContainText('ID 19');await count(page,0);
  await page.evaluate(()=>(window as any).__near=true);await count(page,1);await expect(page.locator('#card-hint')).toContainText('充電');
  await page.locator('.viewport').screenshot({path:'docs/v0.7.0-card-charge.png'});
  await page.evaluate(()=>(window as any).__ids=[19,7]);await page.waitForTimeout(700);await count(page,1);
  await page.evaluate(()=>(window as any).__ids=[19]);await expect(page.locator('#card-diagnostics')).not.toContainText('ID 7:');await page.evaluate(()=>(window as any).__ids=[19,7]);await page.waitForTimeout(700);await count(page,1);
  await page.evaluate(()=>(window as any).__near=false);await expect(page.locator('#card-diagnostics')).toContainText('接近確認 0/3');await page.waitForTimeout(400);await page.evaluate(()=>{(window as any).__near=true;(window as any).__angle=.15;});await count(page,2);
  await page.evaluate(()=>(window as any).__ids=[11,19]);await count(page,3);await expect(page.locator('#card-hint')).toContainText('ジャンプ');
  await page.evaluate(()=>(window as any).__ids=[7,11]);await count(page,4);await expect(page.locator('#card-hint')).toContainText('こんにちは');
  await page.evaluate(()=>(window as any).__ids=[249]);await expect(page.locator('#card-diagnostics')).toContainText('ID 249: 割り当てなし');await expect(page.locator('#count')).toHaveText('0');await count(page,4);
  await page.locator('#switch').click();await page.evaluate(()=>(window as any).__ids=[7,19]);await count(page,1);await expect(page.locator('#video')).toHaveClass(/mirrored/);
  await expect.poll(()=>page.locator('#overlay').evaluate((c:HTMLCanvasElement)=>{const scale=Math.min(c.width/1000,c.height/600),x=(c.width-1000*scale)/2+640*scale,y=c.height/2;const p=c.getContext('2d')!.getImageData(x,y,1,1).data;return p[0]<150&&p[1]>170&&p[2]>210;})).toBe(true);
  const starts=await page.evaluate(()=>(window as any).__starts);await page.locator('#tm-tab').selectOption('marker');await expect(page.locator('#tm-data')).toContainText('ID 7');await page.locator('#tm-tab').selectOption('cards');await count(page,1);expect(await page.evaluate(()=>(window as any).__starts)).toBe(starts);
  await page.locator('#card-start').click();await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>(window as any).__stream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);await expect(page.locator('#card-diagnostics')).toHaveText('カードを映してください。');await page.locator('#card-start').click();await count(page,1);await page.locator('#card-start').click();
});

test('expired results remove composition and keep pair lock until real separation',async({page})=>{
  await page.route('**/text-worker.js',route=>route.fulfill({contentType:'application/javascript',body:`
    self.delay=0;self.onmessage=({data})=>{if(data.type==='dispose'){self.postMessage({disposed:true});return;}const items=[7,19].map((id,i)=>({category:'marker',markerId:id,corners:[{x:.2+i*.23,y:.3},{x:.4+i*.23,y:.3},{x:.4+i*.23,y:.6333},{x:.2+i*.23,y:.6333}]}));setTimeout(()=>self.postMessage({items}),self.delay);};self.postMessage({ready:true});
  `}));
  await init(page);await page.locator('#card-start').click();await count(page,1);
  const worker=page.workers().find(w=>w.url().endsWith('/text-worker.js'))!;await worker.evaluate('self.delay=2200');
  await expect(page.locator('#card-diagnostics')).toContainText('有効期限切れ',{timeout:10000});await expect(page.locator('#count')).toHaveText('0');await expect(page.locator('#card-hint')).not.toContainText('充電');
  await worker.evaluate('self.delay=0');await count(page,1);await page.waitForTimeout(700);await count(page,1);await page.locator('#card-start').click();
});
