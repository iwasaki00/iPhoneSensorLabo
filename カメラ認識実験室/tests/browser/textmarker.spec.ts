import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import zxing from '@zxing/library';
async function open(page:Page,tab='marker'){
  await page.addInitScript(({tab})=>{localStorage.setItem('camera-vision-lab.v2',JSON.stringify({mode:'textmarker'}));localStorage.setItem('camera-vision-lab.text.v1',JSON.stringify({tab,language:'eng',resolution:960}));Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as any).__copied=text;}}});},{tab});
  page.on('console',m=>{if(m.type()==='error')console.log('browser error',m.text());});
  await page.goto('/');
}
async function upload(page:Page,base64:string,selector='#scene-file'){await page.locator(selector).setInputFiles({name:'local.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')});}
async function ready(page:Page){await expect.poll(async()=>{if(await page.locator('#error').isVisible())throw Error((await page.locator('#error-message').textContent())!);return page.locator('#tm-data').textContent();},{timeout:120000}).toContain('フレーム');}
async function solidText(page:Page,text:string){return page.evaluate(text=>{const c=document.createElement('canvas');c.width=900;c.height=200;const x=c.getContext('2d')!;x.fillStyle='#fff';x.fillRect(0,0,900,200);x.fillStyle='#000';x.font='bold 58px Meiryo, sans-serif';x.fillText(text,35,120);return c.toDataURL().split(',')[1];},text);}
function codePixels(kind:string,content:string){
  if(kind==='QR_CODE'){const m=new zxing.QRCodeWriter().encode(content,zxing.BarcodeFormat.QR_CODE,320,320,new Map());return {width:m.getWidth(),height:m.getHeight(),bits:Array.from({length:m.getWidth()*m.getHeight()},(_,i)=>m.get(i%m.getWidth(),Math.floor(i/m.getWidth()))?1:0)};}
  let pattern='';
  if(kind==='CODE_128'){const chars=Array.from(content,c=>c.charCodeAt(0)-32),sum=(104+chars.reduce((s,c,i)=>s+c*(i+1),0))%103;for(const index of [104,...chars,sum,106]){let bar=true;for(const width of (zxing.Code128Reader as any).CODE_PATTERNS[index]){pattern+=(bar?'1':'0').repeat(width);bar=!bar;}}}
  else{const l=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'],invert=(s:string)=>s.replace(/[01]/g,c=>c==='0'?'1':'0');pattern='101';if(kind==='EAN_13'){const parity=[0,11,13,14,19,25,28,21,22,26][Number(content[0])];for(let i=1;i<7;i++){const s=l[Number(content[i])];pattern+=(parity&(1<<(6-i)))?invert(s).split('').reverse().join(''):s;}pattern+='01010';for(let i=7;i<13;i++)pattern+=invert(l[Number(content[i])]);}else{for(let i=0;i<4;i++)pattern+=l[Number(content[i])];pattern+='01010';for(let i=4;i<8;i++)pattern+=invert(l[Number(content[i])]);}pattern+='101';}
  pattern='0'.repeat(12)+pattern+'0'.repeat(12);const width=pattern.length*3,height=180;return{width,height,bits:Array.from({length:width*height},(_,i)=>{const y=Math.floor(i/width);return y<15||y>165?0:Number(pattern[Math.floor((i%width)/3)]);})};
}
async function codeImage(page:Page,kind:string,content:string){const data=codePixels(kind,content);return page.evaluate(({width,height,bits})=>{const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d')!,image=x.createImageData(width,height);bits.forEach((v,i)=>{image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=v?0:255;image.data[i*4+3]=255;});x.putImageData(image,0,0);return c.toDataURL().split(',')[1];},data);}

test('generated dictionary markers detect IDs, corners, composite, PNG and metadata only',async({page})=>{
  await open(page);await expect(page.locator('#tm-download')).toBeEnabled();
  const marker=await page.locator('#tm-marker-preview').evaluate((c:HTMLCanvasElement)=>c.toDataURL().split(',')[1]);await upload(page,marker);await ready(page);
  await expect(page.locator('#tm-data')).toContainText('ID 7');await expect(page.locator('#count')).toHaveText('1');
  await expect(page.locator('#tm-data')).toContainText('中心(0.');await page.locator('#tm-tab').selectOption('overlay');await ready(page);
  for(const kind of ['square','circle','text'])await page.locator('#tm-overlayKind').selectOption(kind);
  await page.locator('#view-select').selectOption('split');await page.locator('.viewport').screenshot({path:'docs/v0.6.0-marker-overlay.png'});
  await page.locator('summary').filter({hasText:'実験用マーカー'}).click();
  const d=page.waitForEvent('download');await page.locator('#tm-download').click();expect((await readFile((await(await d).path())!)).slice(1,4).toString()).toBe('PNG');
  await page.locator('#tm-marker-id').fill('11');await page.locator('#tm-generate').click();await page.waitForTimeout(100);const next=await page.locator('#tm-marker-preview').evaluate((c:HTMLCanvasElement)=>c.toDataURL().split(',')[1]);await upload(page,next);await ready(page);await expect(page.locator('#tm-data')).toContainText('ID 11');
  await page.locator('#recognition').click();await expect.poll(()=>page.workers().length).toBe(0);await page.locator('#recognition').click();await ready(page);
});
test('QR, EAN-13/JAN, EAN-8 and Code128 actual decoding, no automatic URL open or content persistence',async({page})=>{
  await open(page,'code');const secret='https://example.test/private-QR-6789';
  for(const [kind,content] of [['QR_CODE',secret],['EAN_13','4901234567894'],['EAN_8','96385074'],['CODE_128','LAB-12345']]){
    await upload(page,await codeImage(page,kind,content));await ready(page);await expect(page.locator('#tm-output')).toHaveValue(content);await expect(page.locator('#tm-data')).toContainText(kind);
  }
  await upload(page,await codeImage(page,'QR_CODE',secret));await ready(page);expect(page.url()).toBe('http://localhost:4173/');await page.locator('#tm-copy').click();expect(await page.evaluate(()=>(window as any).__copied)).toBe(secret);
  await page.locator('summary').filter({hasText:'実験記録'}).click();await page.locator('#record-save').click();
  const storage=await page.evaluate(()=>JSON.stringify(localStorage));expect(storage).not.toContain('private-QR');expect(storage).not.toContain('LAB-12345');
  for(const type of ['json','csv']){const d=page.waitForEvent('download');await page.locator('#record-'+type).click();const text=await readFile((await(await d).path())!,'utf8');expect(text).toContain(type==='json'?'textLab':'textLabMetadata');expect(text).not.toContain('private-QR');}
  await page.locator('#tm-output').fill('javascript:alert(1)');await expect(page.locator('#tm-open-url')).toBeDisabled();
});
test('real English and Japanese OCR, preprocessing, edited copy and private metadata',async({page})=>{
  test.setTimeout(240000);await open(page,'ocr');const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  await upload(page,await solidText(page,'HELLO 12345'));await ready(page);await expect(page.locator('#tm-output')).toHaveValue(/HELLO/);
  expect(requests.some(r=>r.endsWith('eng.traineddata.gz'))).toBe(true);expect(requests.some(r=>r.endsWith('jpn.traineddata.gz'))).toBe(false);
  await expect(page.locator('#tm-data')).toContainText('信頼度');
  await page.locator('summary').filter({hasText:'OCRの範囲'}).click();await page.locator('#tm-preprocessing').selectOption('gray');await ready(page);await expect(page.locator('#tm-output')).toHaveValue(/12345/);
  await page.locator('#tm-language').selectOption('jpn+eng');await ready(page);await upload(page,await solidText(page,'日本語 テスト ABC 123'));await ready(page);await expect(page.locator('#tm-output')).toHaveValue(/日\s*本\s*語/);
  await page.locator('#tm-output').fill('編集済みの秘密 98765');await page.locator('#tm-copy').click();expect(await page.evaluate(()=>(window as any).__copied)).toBe('編集済みの秘密 98765');
  await page.locator('summary').filter({hasText:'実験記録'}).click();await page.locator('#record-save').click();expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('秘密');
  const ua=await page.evaluate(()=>navigator.userAgent),browser=ua.includes('Edg/')?'edge':'chrome';await writeFile(`docs/performance-v${JSON.parse(await readFile('package.json','utf8')).version}-ocr-${browser}.json`,JSON.stringify({at:new Date().toISOString(),ua,input:'900x200 synthetic text, OCR Worker, jpn+eng; PC only',metrics:await page.locator('#tm-performance').textContent(),details:await page.locator('#tm-data').textContent()},null,2)+'\n');
});
test('ORB registration, rotation/scale RANSAC match, image overlay and explicit persistence',async({page})=>{
  test.setTimeout(120000);await open(page,'match');
  const ref=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=300;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,300,300);let seed=123;for(let i=0;i<500;i++){seed=(seed*1664525+1013904223)>>>0;const px=seed%280;seed=(seed*1664525+1013904223)>>>0;const py=seed%280;x.fillStyle=i%2?'#111':'#789abc';x.fillRect(px,py,4+i%10,4+i%10);}x.fillStyle='black';x.font='bold 25px sans-serif';x.fillText('VISION LAB',30,150);return c.toDataURL().split(',')[1];});
  await upload(page,ref,'#tm-reference');expect(await page.evaluate(()=>localStorage.getItem('camera-vision-lab.reference.v1'))).toBe(null);
  const target=await page.evaluate(async ref=>{const image=new Image();image.src='data:image/png;base64,'+ref;await image.decode();const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,640,480);x.translate(320,240);x.rotate(.3);x.scale(.9,.9);x.drawImage(image,-150,-150);return c.toDataURL().split(',')[1];},ref);
  await upload(page,target);await ready(page);await expect(page.locator('#count')).toHaveText('1');await expect(page.locator('#tm-data')).toContainText('RANSAC内点');
  await page.locator('#tm-tab').selectOption('overlay');await page.locator('#tm-overlaySource').selectOption('match');await ready(page);await page.locator('#tm-overlayKind').selectOption('image');await upload(page,ref,'#tm-overlay-image');
  await page.locator('summary').filter({hasText:'登録画像の明示'}).click();await page.locator('#tm-save-reference').click();expect(await page.evaluate(()=>localStorage.getItem('camera-vision-lab.reference.v1'))).toContain('data:image/png');
  await page.locator('#tm-delete-reference').click();expect(await page.evaluate(()=>localStorage.getItem('camera-vision-lab.reference.v1'))).toBe(null);
});
test('continuous multiple markers, disappearance, camera mirror, stop/restart and legacy return',async({page})=>{
  await page.addInitScript(()=>{
    (window as any).__starts=0;(window as any).__visible=true;
    navigator.mediaDevices.getUserMedia=async()=>{
      (window as any).__starts++;const marker=document.querySelector('#tm-marker-preview') as HTMLCanvasElement,snapshot=document.createElement('canvas');snapshot.width=snapshot.height=600;snapshot.getContext('2d')!.drawImage(marker,0,0);
      const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d')!;let phase=0;
      const draw=()=>{x.fillStyle='#fff';x.fillRect(0,0,640,480);if((window as any).__visible){const offset=Math.sin(phase++/8)*10;x.drawImage(snapshot,30+offset,110,250,250);x.drawImage(snapshot,360-offset,110,250,250);}};draw();const timer=setInterval(draw,80),stream=c.captureStream(20);(window as any).__stream=stream;stream.getTracks().forEach(track=>{const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};});return stream;
    };
  });
  await open(page,'marker');await expect(page.locator('#tm-download')).toBeEnabled();await page.locator('#tm-input').selectOption('continuous');await page.locator('#start').click();await ready(page);await expect(page.locator('#count')).toHaveText('2');
  await expect.poll(async()=>Number((await page.locator('#tm-data').textContent())?.match(/フレーム text-\S+-(\d+)/)?.[1]),{timeout:15000}).toBeGreaterThanOrEqual(5);
  expect(Number(await page.locator('#render-fps').textContent())).toBeGreaterThan(5);
  const liveMetrics={at:new Date().toISOString(),ua:await page.evaluate(()=>navigator.userAgent),input:'640x480 Canvas camera with two generated markers; PC only',metrics:await page.locator('#tm-performance').textContent(),details:await page.locator('#tm-data').textContent()};
  await page.evaluate(()=>(window as any).__visible=false);await expect(page.locator('#count')).toHaveText('0');await expect(page.locator('#tm-message')).toContainText('見失い');
  await page.evaluate(()=>(window as any).__visible=true);await expect(page.locator('#count')).toHaveText('2');
  await page.locator('#mode-select').selectOption('color');await expect(page.locator('#latency')).not.toHaveText('—');await page.locator('#mode-select').selectOption('textmarker');await ready(page);expect(await page.evaluate(()=>(window as any).__starts)).toBe(1);
  await page.locator('#switch').click();await ready(page);await expect(page.locator('#count')).toHaveText('2');
  await page.locator('#scene-capture').click();await ready(page);await expect(page.locator('#tm-input')).toHaveValue('still');await page.locator('#view-select').selectOption('split');
  const metrics=liveMetrics;
  const browser=metrics.ua.includes('Edg/')?'edge':'chrome';await writeFile(`docs/performance-${JSON.parse(await readFile('package.json','utf8')).version}-marker-${browser}.json`,JSON.stringify(metrics,null,2)+'\n');
  await page.locator('#start').click();await expect.poll(()=>page.workers().length).toBe(0);expect(await page.evaluate(()=>(window as any).__stream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
  await page.locator('#tm-input').selectOption('continuous');await page.locator('#start').click();await ready(page);await page.locator('#start').click();
});

test('broker boot error is visible and explicit retry recovers',async({page})=>{
  await page.route('**/text-worker.js',route=>route.fulfill({contentType:'application/javascript',body:'throw new Error("test boot failure");'}));
  await open(page,'marker');
  const marker=await page.locator('#tm-marker-preview').evaluate((c:HTMLCanvasElement)=>c.toDataURL().split(',')[1]);
  await upload(page,marker);await expect(page.locator('#error-message')).toContainText('Workerを起動できません');
  await page.unroute('**/text-worker.js');await page.locator('#retry').click();await ready(page);await expect(page.locator('#tm-data')).toContainText('ID 7');
});

test('leaving OCR during language download terminates parent and child workers',async({page})=>{
  let held:any;let signal!:()=>void;const requested=new Promise<void>(resolve=>signal=resolve);
  await page.route('**/eng.traineddata.gz',route=>{held=route;signal();});
  await open(page,'ocr');await upload(page,await solidText(page,'CANCEL 123'));await requested;
  expect(page.workers().length).toBeGreaterThanOrEqual(2);
  await page.locator('#mode-select').selectOption('color');await expect.poll(()=>page.workers().filter(w=>/text-worker|ocr\/worker/.test(w.url())).length).toBe(0);
  await held.abort();await expect(page.locator('#tm-output')).toHaveValue('');
});
