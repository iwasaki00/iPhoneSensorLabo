import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
test.use({deviceScaleFactor:3});
async function setup(page:Page,mock=true){
  await page.addInitScript(()=>{(window as any).__runs=0;const Native=Worker;(window as any).Worker=class extends Native{constructor(u:any,o:any){super(u,o);this.addEventListener('message',({data})=>{if(data.values){(window as any).__depth=data;(window as any).__runs++;}});}};});
  if(mock)await page.route('**/assets/worker-*.js',r=>r.fulfill({contentType:'application/javascript',body:`self.onmessage=({data:d})=>{if(d.type==='init'){postMessage({ready:true,loadMs:1});return;}const values=Float32Array.from({length:d.width*d.height},(_,i)=>i%d.width<d.width/2?0:1);postMessage({width:d.width,height:d.height,values,minimum:0,maximum:1,duration:1,loadMs:1,inputWidth:280,inputHeight:140});};`}));
  await page.goto('/');await page.locator('#mode-select').selectOption('depth');await page.locator('#depth-experiment').selectOption('hide');await page.locator('#hide-sample').click();await page.locator('#depth-analyze').click();await expect(page.locator('#depth-status')).toContainText('解析完了',{timeout:120000});
}
async function search(page:Page){await page.locator('#hide-find').click();await expect(page.locator('#hide-find')).toBeEnabled({timeout:30000});return page.locator('#hide-spot-status').evaluate(e=>JSON.parse(e.dataset.metrics!));}
async function findRobot(page:Page,pose:{x:number;y:number},w:number,h:number){
  const c=page.locator('#overlay');await c.scrollIntoViewIfNeeded();const r=(await c.boundingBox())!,s=Math.min(r.width/w,r.height/h),size=Math.min(w,h)*.35;
  for(let yy=.25;yy<.95;yy+=.12)for(let xx=.18;xx<.9;xx+=.12){if(await page.locator('#hide-found').isVisible())return;await page.mouse.click(r.x+(r.width-w*s)/2+(pose.x*w+(xx-.5)*size)*s,r.y+(r.height-h*s)/2+(pose.y*h+(yy-.5)*size)*s);}
  await expect(page.locator('#hide-found')).toBeVisible();
}
test('synthetic candidates: no inference/movement, apply/restore, same corrected mask and full game',async({page})=>{
  await setup(page);const raster=()=>page.locator('#overlay').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  for(const edge of [false,true]){
    await page.locator('#hide-edge').setChecked(edge);const before=await raster(),depth=await page.locator('#hide-depth').inputValue();const metrics=await search(page);
    expect(metrics.count).toBeGreaterThan(0);expect(metrics.count).toBeLessThanOrEqual(3);expect(metrics.checked).toBeLessThanOrEqual(16);expect(await raster()).toBe(before);
    await page.locator('#hide-spots button').first().click();await expect(page.locator('#hide-lock')).toBeEnabled();await page.locator('#hide-restore').click();expect(await raster()).toBe(before);expect(await page.locator('#hide-depth').inputValue()).toBe(depth);
    const pose=JSON.parse((await page.locator('#hide-spots button').first().getAttribute('data-pose'))!);await page.locator('#hide-spots button').first().click();
    await page.locator('#hide-depth').evaluate((n:HTMLInputElement)=>{n.value=String(Number(n.value)+1);n.dispatchEvent(new Event('input'));});await expect(page.locator('#hide-lock')).toBeEnabled();
    await page.locator('#hide-lock').click();await expect(page.locator('#hide-find')).not.toBeVisible();await expect(page.locator('#hide-spots button')).toHaveCount(0);await page.locator('#hide-seek').click();await expect(page.locator('#hide-restore')).not.toBeVisible();await findRobot(page,pose,600,400);await page.locator('#hide-again').click();
  }
  expect(await page.evaluate(()=>(window as any).__runs)).toBe(1);
});
test('premise changes cancel pending results; flat depth produces no filler',async({page})=>{
  await setup(page);
  await page.locator('#hide-find').evaluate((b:HTMLButtonElement)=>{b.click();b.click();const e=document.getElementById('hide-edge') as HTMLInputElement;e.checked=true;e.dispatchEvent(new Event('change'));});
  await expect(page.locator('#hide-find')).toBeEnabled();await expect(page.locator('#hide-spots button')).toHaveCount(0);await expect(page.locator('#hide-spot-status')).toHaveText('');
  await search(page);await page.locator('#depth-experiment').selectOption('character');await page.locator('#depth-experiment').selectOption('hide');await expect(page.locator('#hide-spots button')).toHaveCount(0);
  await page.locator('#hide-find').click();await page.locator('#hide-sample').click();await expect(page.locator('#hide-spots button')).toHaveCount(0);await expect(page.locator('#hide-find')).toBeDisabled();
  await page.route('**/assets/worker-*.js',r=>r.fulfill({contentType:'application/javascript',body:`self.onmessage=({data:d})=>{if(d.type==='init'){postMessage({ready:true});return;}postMessage({width:d.width,height:d.height,values:new Float32Array(d.width*d.height).fill(1),minimum:1,maximum:1,duration:1,loadMs:1,inputWidth:280,inputHeight:140});};`}));
  await page.locator('#mode-select').selectOption('color');await page.locator('#mode-select').selectOption('depth');await page.locator('#depth-experiment').selectOption('hide');await page.locator('#hide-sample').click();await page.locator('#depth-analyze').click();await expect(page.locator('#depth-status')).toContainText('解析完了');
  expect((await search(page)).count).toBe(0);await expect(page.locator('#hide-spot-status')).toContainText('候補が見つかりませんでした');await page.locator('#mode-select').selectOption('color');
});
test('real photos: candidate counts, search time separate from AI and selected game',async({page})=>{
  test.setTimeout(180000);await setup(page,false);const records:any[]=[];
  for(const photo of ['coffee','astronaut']){
    if(photo==='astronaut'){await page.locator('#scene-file').setInputFiles('depth-validation.local/astronaut.png');await page.locator('#depth-analyze').click();await expect(page.locator('#depth-status')).toContainText('解析完了',{timeout:120000});}
    for(const edge of [false,true]){
      await page.locator('#hide-edge').setChecked(edge);const runs=await page.evaluate(()=>(window as any).__runs),metrics=await search(page),poses=await page.locator('#hide-spots button').evaluateAll(nodes=>nodes.map(n=>JSON.parse((n as HTMLElement).dataset.pose!)));
      const model=await page.evaluate(()=>{const d=(window as any).__depth;return{input:[d.inputWidth,d.inputHeight],duration:d.duration,loadMs:d.loadMs};});
      records.push({photo,edge,...metrics,poses,model});expect(await page.evaluate(()=>(window as any).__runs)).toBe(runs);
      for(let i=0;i<poses.length;i++){await page.locator('#hide-spots button').nth(i).click();await expect(page.locator('#hide-lock')).toBeEnabled();await page.locator('#overlay').screenshot({path:`docs/depth-validation/v0.8.4-${photo}-${edge?'on':'off'}-${i+1}.png`});}
      if(poses.length){await page.locator('#hide-spots button').first().click();await page.locator('#hide-lock').click();await page.locator('#hide-seek').click();await findRobot(page,poses[0],photo==='coffee'?600:512,photo==='coffee'?400:512);await page.locator('#hide-again').click();expect(await page.evaluate(()=>(window as any).__runs)).toBe(runs);}
    }
  }
  await writeFile('docs/depth-validation/v0.8.4-spots.json',JSON.stringify({at:new Date().toISOString(),ua:await page.evaluate(()=>navigator.userAgent),condition:'PC Chrome DPR3; public sample/NASA photo; screenshots are experimental composites',records},null,2)+'\n');
});
