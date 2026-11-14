import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
test.use({deviceScaleFactor:3});
async function setup(page:Page){await page.addInitScript(()=>{(window as any).__runs=[];const Native=Worker;(window as any).Worker=class extends Native{constructor(u:any,o:any){super(u,o);this.addEventListener('message',({data})=>{if(data.values){(window as any).__depth=data;(window as any).__runs.push({input:[data.inputWidth,data.inputHeight],output:[data.outputWidth,data.outputHeight],analysis:[data.width,data.height],duration:data.duration,loadMs:data.loadMs});}});}};});await page.goto('/');await page.locator('#mode-select').selectOption('depth');}
async function tap(page:Page,x:number,y:number,w=600,h=400){await page.locator('#overlay').scrollIntoViewIfNeeded();const r=(await page.locator('#overlay').boundingBox())!,s=Math.min(r.width/w,r.height/h);await page.mouse.click(r.x+(r.width-w*s)/2+x*w*s,r.y+(r.height-h*s)/2+y*h*s);}
test('real Q4 standard and high detail: same photograph and cup boundary, explicit inference, reuse and standard return',async({page,context})=>{
  test.setTimeout(180000);let modelRequests=0;page.on('request',r=>{if(r.url().endsWith('/model_q4.onnx'))modelRequests++;});await setup(page);await page.locator('#depth-experiment').selectOption('hide');await page.locator('#hide-sample').click();await page.locator('#depth-experiment').selectOption('character');
  const pictures:string[]=[],settings:any[]=[];
  for(const [i,size] of ['280','518'].entries()){
    await page.locator('#depth-size').selectOption(size);expect(await page.evaluate(()=>(window as any).__runs.length)).toBe(i);
    await page.locator('#depth-analyze').evaluate((b:HTMLButtonElement)=>{b.click();b.click();});await expect.poll(()=>page.evaluate(()=>(window as any).__runs.length),{timeout:120000}).toBe(i+1);
    await tap(page,.3,.6);
    // Align the occlusion with the SAME cup handle boundary, not the same normalized depth slider.
    const slider=await page.evaluate(()=>{const d=(window as any).__depth;const raw=d.values[Math.floor(.60*d.height)*d.width+Math.floor(.34*d.width)];return Math.round(100*(1-(raw-d.minimum)/(d.maximum-d.minimum)));});
    await page.locator('#depth-character-depth').evaluate((n:HTMLInputElement,v)=>{n.value=String(v);n.dispatchEvent(new Event('input'));},slider);
    await page.locator('#overlay').scrollIntoViewIfNeeded();pictures.push(await page.locator('#overlay').evaluate((c:HTMLCanvasElement)=>c.toDataURL()));settings.push({size,slider,diagnostics:await page.locator('#depth-diagnostics').textContent(),buffer:await page.locator('#overlay').evaluate((c:HTMLCanvasElement)=>[c.width,c.height]),css:await page.locator('#overlay').evaluate(c=>[c.clientWidth,c.clientHeight])});
  }
  const artifact=await page.evaluate(async pictures=>{const board=document.createElement('canvas');board.width=1080;board.height=400;const ctx=board.getContext('2d')!;ctx.fillStyle='#10191e';ctx.fillRect(0,0,1080,400);ctx.fillStyle='white';ctx.font='18px sans-serif';
    const original=new Image();original.src='samples/coffee.png';await original.decode();ctx.imageSmoothingEnabled=false;ctx.drawImage(original,100,160,180,180,0,40,360,360);ctx.fillText('Original photo / 2x',8,25);
    for(let i=0;i<2;i++){const image=new Image();image.src=pictures[i];await image.decode();const s=Math.min(image.width/600,image.height/400),ox=(image.width-600*s)/2,oy=(image.height-400*s)/2;ctx.drawImage(image,ox+100*s,oy+160*s,180*s,180*s,(i+1)*360,40,360,360);ctx.fillText(i?'High: 518px / same boundary':'Standard: 280px',368+i*360,25);}return board.toDataURL().split(',')[1];},pictures);
  await writeFile('docs/depth-validation/v0.8.2-boundary.png',Buffer.from(artifact,'base64'));
  const runs=await page.evaluate(()=>(window as any).__runs);expect(runs[0].input).toEqual([280,182]);expect(runs[1].input).toEqual([518,350]);expect(runs[1].output).toEqual([518,350]);
  expect(modelRequests).toBe(1);for(const experiment of ['color','points','hide','character'])await page.locator('#depth-experiment').selectOption(experiment);expect(await page.evaluate(()=>(window as any).__runs.length)).toBe(2);
  await page.locator('#depth-size').selectOption('280');expect(await page.evaluate(()=>(window as any).__runs.length)).toBe(2);await page.locator('#depth-analyze').click();await expect.poll(()=>page.evaluate(()=>(window as any).__runs.length)).toBe(3);
  await writeFile('docs/depth-validation/v0.8.2-detail.json',JSON.stringify({at:new Date().toISOString(),photo:'CC0 coffee.png / 600x400',position:[.3,.6],sizeFraction:.35,anchor:[.34,.6],deviceScaleFactor:3,runs,settings,ua:await page.evaluate(()=>navigator.userAgent)},null,2)+'\n');
});

test('synthetic high-detail failure retains original photo and recovers at standard; bounded portrait rendering',async({page})=>{
  await setup(page);await page.route('**/assets/worker-*.js',r=>r.fulfill({contentType:'application/javascript',body:`self.onmessage=({data:d})=>{if(d.type==='init'){postMessage({ready:true,loadMs:1});return;}if(d.size===518){postMessage({error:'test high detail failure'});return;}const values=new Float32Array(d.width*d.height);postMessage({values,width:d.width,height:d.height,minimum:0,maximum:0,inputWidth:210,inputHeight:280,duration:1,loadMs:1});};`}));
  const b64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=3000;c.height=4000;const x=c.getContext('2d')!;x.fillStyle='orange';x.fillRect(0,0,3000,4000);return c.toDataURL().split(',')[1];});await page.locator('#scene-file').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')});
  await page.locator('#depth-size').selectOption('518');await page.locator('#depth-analyze').click();await expect(page.locator('#error')).toBeVisible();await expect(page.locator('#depth-analyze')).toBeEnabled();await page.locator('#depth-size').selectOption('280');await page.locator('#depth-analyze').click();await expect(page.locator('#depth-status')).toContainText('解析完了');await expect(page.locator('#depth-diagnostics')).toContainText('元写真 3000×4000');await expect(page.locator('#depth-diagnostics')).toContainText('解析用写真 768×1024');
  const diagnostics=await page.locator('#depth-diagnostics').textContent();expect(diagnostics).not.toContain('バッファ 768×1024');
});
