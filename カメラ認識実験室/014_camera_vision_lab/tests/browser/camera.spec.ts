import { test, expect } from '@playwright/test';
test('実モデル推論・認識切替・停止・再起動・同一サイト通信',async({page})=>{
  const external:string[]=[];const errors:string[]=[];
  page.on('request',r=>{if(r.url().startsWith('http')&&new URL(r.url()).origin!=='http://localhost:4173')external.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);(window as any).__tracks=[];navigator.mediaDevices.getUserMedia=async c=>{const stream=await get(c);(window as any).__tracks.push(...stream.getTracks());return stream;};});
  await page.goto('/');await page.getByRole('button',{name:'カメラを起動'}).click();
  await expect.poll(async()=>{if(await page.locator('#error').isVisible())throw new Error(await page.locator('#error-message').innerText());return page.locator('#latency').innerText();},{timeout:30000}).not.toBe('—');
  await page.getByText('診断情報',{exact:false}).click();await expect(page.locator('#diagnostics')).toContainText('Worker / CPU');
  await page.screenshot({path:'docs/pc-preview.png',fullPage:true});
  await page.getByRole('button',{name:'認識 ON'}).click();await expect(page.locator('#count')).toHaveText('0');await expect(page.locator('#latency')).toHaveText('—');
  await page.getByRole('button',{name:'認識 OFF'}).click();await expect(page.locator('#latency')).not.toHaveText('—');
  await page.getByRole('button',{name:'カメラを停止'}).click();
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.srcObject)).toBe(null);
  expect(await page.evaluate(()=>(window as any).__tracks.every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
  await page.getByRole('button',{name:'カメラを起動'}).click();await expect(page.locator('#latency')).not.toHaveText('—',{timeout:60000});
  await page.getByRole('button',{name:'前面に切替'}).click();await expect(page.locator('video')).toHaveClass('mirrored');await expect(page.locator('#latency')).not.toHaveText('—',{timeout:60000});
  await page.getByRole('button',{name:'カメラを停止'}).click();expect(external).toEqual([]);expect(errors).toEqual([]);
});
test('Worker非対応時にメインスレッド推論へフォールバック',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(window,'Worker',{value:undefined});});
  await page.goto('/');await page.getByRole('button',{name:'カメラを起動'}).click();
  await expect(page.locator('#latency')).not.toHaveText('—',{timeout:60000});
  await expect(page.locator('#diagnostics')).toContainText('メインスレッド / CPU');await page.getByRole('button',{name:'カメラを停止'}).click();
});
test('モデル取得失敗の表示と再試行',async({page})=>{
  await page.route('**/models/*.tflite',route=>route.abort());
  await page.goto('/');await page.getByRole('button',{name:'カメラを起動'}).click();await expect(page.locator('#error')).toBeVisible({timeout:60000});
  await expect(page.locator('#error-message')).toContainText('モデル読込失敗');
  await page.unroute('**/models/*.tflite');await page.getByRole('button',{name:'停止して再試行'}).click();await expect(page.locator('#latency')).not.toHaveText('—',{timeout:60000});
  await page.getByRole('button',{name:'カメラを停止'}).click();
});
test('Workerの推論失敗から互換方式へ切替',async({page})=>{
  await page.route('**/vision-worker.js',async route=>{
    const response=await route.fetch();const source=await response.text();
    const marker='const result=detector.detectForVideo(data.bitmap,data.timestamp);';
    expect(source).toContain(marker);
    await route.fulfill({response,body:source.replace(marker,'throw new Error("TEST: bitmap inference unavailable");')});
  });
  await page.goto('/');await page.getByRole('button',{name:'カメラを起動'}).click();
  await expect(page.locator('#latency')).not.toHaveText('—',{timeout:60000});
  await expect(page.locator('#diagnostics')).toContainText('メインスレッド / CPU');
  await expect(page.locator('#diagnostics')).toContainText('Worker推論');
  await page.getByRole('button',{name:'カメラを停止'}).click();
});
