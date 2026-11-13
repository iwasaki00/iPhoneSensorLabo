import {test,expect,type Page} from '@playwright/test';
async function guard(page:Page){await page.context().addInitScript(()=>{(window as any).__cameraCalls=0;navigator.mediaDevices.getUserMedia=async()=>{(window as any).__cameraCalls++;throw Error('camera must not start');};Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>(window as any).__copied=text}});});}
async function drag(page:Page,from:{x:number;y:number},to:{x:number;y:number}){await page.locator('#playground-board').scrollIntoViewIfNeeded();const b=(await page.locator('#playground-board').boundingBox())!;await page.mouse.move(b.x+from.x*b.width/360,b.y+from.y*b.height/480);await page.mouse.down();await page.mouse.move(b.x+to.x*b.width/360,b.y+to.y*b.height/480,{steps:12});await page.mouse.up();}
async function total(page:Page,n:number){await expect(page.locator('#card-diagnostics')).toContainText(`合計 ${n}反応`,{timeout:5000});}
test('entry keeps default mode and camera off; display link, three draggable cards, PNG and real dictionary detection',async({page})=>{
  await guard(page);await page.goto('/');await expect(page.locator('#mode-select')).toHaveValue('object');await page.locator('#try-ar-cards').click();await expect(page.locator('#tm-tab')).toHaveValue('cards');expect(await page.evaluate(()=>(window as any).__cameraCalls)).toBe(0);
  const [display]=await Promise.all([page.waitForEvent('popup'),page.locator('#card-display').click()]);await expect(display.locator('#png-links a')).toHaveCount(3);await expect(display.locator('#source-label')).toContainText('PCでこの画面');
  await display.locator('#copy-display-link').click();expect(await display.evaluate(()=>(window as any).__copied)).toBe('http://localhost:4173/ar-playground.html');
  const [png]=await Promise.all([display.waitForEvent('popup'),display.locator('[data-png-card="robot"]').click()]);await expect(png.locator('img')).toBeVisible();expect(await png.locator('img').evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBe(600);await png.close();
  const original=await display.locator('#playground-board').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  for(const [a,b] of [[{x:65,y:100},{x:85,y:145}],[{x:295,y:100},{x:275,y:170}],[{x:180,y:370},{x:200,y:350}]])await drag(display,a,b);
  await display.waitForTimeout(100);expect(await display.locator('#playground-board').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).not.toBe(original);
  await display.locator('#show-slime').uncheck();await display.locator('#reset-placement').click();await display.waitForTimeout(100);expect(await display.locator('#playground-board').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(original);
  await display.locator('#card-angle').evaluate((e:HTMLInputElement)=>{e.value='90';e.dispatchEvent(new Event('input',{bubbles:true}));});await display.waitForTimeout(100);
  const image=await display.locator('#playground-board').evaluate((c:HTMLCanvasElement)=>c.toDataURL().split(',')[1]);await display.close();await page.locator('#tm-tab').selectOption('marker');await page.locator('#tm-input').selectOption('still');await page.locator('#scene-file').setInputFiles({name:'board.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});for(const id of [7,11,19])await expect(page.locator('#tm-data')).toContainText('ID '+id,{timeout:15000});expect(await page.evaluate(()=>(window as any).__cameraCalls)).toBe(0);
});
test('simulator all pairs, single fire, separation, transient hide, size/rotation and reset without camera',async({page})=>{
  await guard(page);await page.goto('/ar-playground.html?mode=simulator');await expect(page.locator('#png-links a')).toHaveCount(3);await total(page,0);await page.waitForTimeout(700);await total(page,0);
  for(const [a,b,other,name] of [['robot','battery','slime','充電'],['slime','battery','robot','ジャンプ'],['robot','slime','battery','こんにちは']]){
    await page.locator('#reset-placement').click();await page.locator('#show-'+other).uncheck();
    const poses:Record<string,{x:number;y:number}>={robot:{x:65,y:100},slime:{x:295,y:100},battery:{x:180,y:370}};
    await drag(page,poses[a],{x:110,y:230});await drag(page,poses[b],{x:190,y:230});await total(page,1);await expect(page.locator('#card-hint')).toContainText(name);await page.waitForTimeout(800);await total(page,1);
    await page.locator('#show-'+b).uncheck();await page.waitForTimeout(300);await page.locator('#show-'+b).check();await page.waitForTimeout(700);await total(page,1);
    await drag(page,{x:190,y:230},{x:290,y:380});await page.waitForTimeout(700);await drag(page,{x:290,y:380},{x:190,y:230});await total(page,2);
  }
  await page.locator('#selected-card').selectOption('robot');for(const [id,value] of [['card-size','90'],['card-angle','35']])await page.locator('#'+id).evaluate((e:HTMLInputElement,value)=>{e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));},value);await expect(page.locator('#size-value')).toHaveText('90');await expect(page.locator('#angle-value')).toHaveText('35°');
  await page.locator('#reset-placement').click();await total(page,0);await expect(page.locator('#card-size')).toHaveValue('68');await expect(page.locator('#card-angle')).toHaveValue('0');await expect(page.locator('#source-label')).toContainText('カメラなし・模擬検出');expect(page.workers()).toHaveLength(0);expect(await page.evaluate(()=>(window as any).__cameraCalls)).toBe(0);
  await page.screenshot({path:'docs/v0.7.1-simulator.png',fullPage:true});await page.getByRole('link',{name:'実カメラのARカード実験へ'}).click();await expect(page.locator('#tm-tab')).toHaveValue('cards');await expect(page.locator('#card-diagnostics')).toHaveText('カードを映してください。');expect(await page.evaluate(()=>(window as any).__cameraCalls)).toBe(0);
});

test('portrait touch dragging stays in the board; outside content keeps normal scroll and selection',async({page})=>{
  await guard(page);await page.goto('/ar-playground.html');await expect(page.locator('#png-links a')).toHaveCount(3);const board=page.locator('#playground-board');await board.scrollIntoViewIfNeeded();
  const before=await board.evaluate((c:HTMLCanvasElement)=>c.toDataURL()),scroll=await page.evaluate(()=>scrollY),b=(await board.boundingBox())!,cdp=await page.context().newCDPSession(page);
  const p=(x:number,y:number)=>({x:b.x+x*b.width/360,y:b.y+y*b.height/480,id:1});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p(65,100)]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p(65+i*5,100+i*6)]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
  expect(await board.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).not.toBe(before);expect(await page.evaluate(()=>scrollY)).toBe(scroll);
  expect(await board.evaluate(e=>getComputedStyle(e).touchAction)).toBe('none');expect(await page.locator('body').evaluate(e=>getComputedStyle(e).touchAction)).toBe('auto');expect(await page.locator('body').evaluate(e=>getComputedStyle(e).userSelect)).not.toBe('none');await cdp.detach();
});
