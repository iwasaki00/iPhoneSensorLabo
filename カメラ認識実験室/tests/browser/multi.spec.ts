import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function fixture(page: Page, continuous = false) {
  await page.addInitScript(({ continuous }) => {
    localStorage.setItem('camera-vision-lab.v2', JSON.stringify({ mode: 'multi', hueTolerance: 39 }));
    localStorage.setItem('camera-vision-lab.multi.v1', JSON.stringify({ input: continuous ? 'continuous' : 'still', resolution: 160, dwell: 0, interval: 200 }));
    localStorage.setItem('camera-vision-lab.scene.v1', JSON.stringify({ resolution: 160 }));
    (window as any).__starts = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__starts++; const c = document.createElement('canvas'); c.width = 160; c.height = 120; const ctx = c.getContext('2d')!;
      let i = 0; const draw = () => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 160, 120); ctx.fillStyle = '#f00'; ctx.fillRect(10 + (i++ % 10), 20, 50, 60); ctx.fillStyle = '#00f'; ctx.fillRect(100, 20, 40, 60); }; draw();
      const timer = setInterval(draw, 100), stream = c.captureStream(15); (window as any).__stream = stream; stream.getTracks().forEach(t => { const stop = t.stop.bind(t); t.stop = () => { clearInterval(timer); stop(); }; }); return stream;
    };
  }, { continuous });
}
async function upload(page: Page) {
  const base64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 120; const x = c.getContext('2d')!; x.fillStyle = '#f00'; x.fillRect(0, 0, 80, 120); x.fillStyle = '#00f'; x.fillRect(80, 0, 80, 120); return c.toDataURL().split(',')[1]; });
  await page.locator('#scene-file').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
}
async function ready(page: Page) {
  await expect.poll(async () => { if (await page.locator('#error').isVisible()) throw new Error((await page.locator('#error-message').textContent())!); return page.locator('#multi-results').textContent(); }, { timeout: 120000 }).toContain('統合処理:');
}
async function mocks(page: Page, delay = 80) {
  await page.route('**/vision-worker.js', r => r.fulfill({ contentType: 'application/javascript', body: `
    self.calls=0;self.maxBusy=0;let busy=0;self.onmessage=({data})=>{if(data.type==='init'){self.postMessage({ready:true});return;} self.calls++;self.maxBusy=Math.max(self.maxBusy,++busy);const w=data.bitmap.width,h=data.bitmap.height; data.bitmap.close();setTimeout(()=>{busy--;self.postMessage({duration:${delay},detections:[{boundingBox:{originX:0,originY:0,width:w/2,height:h},categories:[{categoryName:'cup',score:.9}]},{boundingBox:{originX:w/2,originY:0,width:w/2,height:h},categories:[{categoryName:'bottle',score:.8}]}]});},${delay});};` }));
  await page.route('**/segmentation-worker.js', r => r.fulfill({ contentType: 'application/javascript', body: `self.onmessage=({data})=>{if(data.type==='init'){self.postMessage({labels:['person']});return;}data.bitmap.close();self.postMessage({width:2,height:2,foreground:new Float32Array([1,0,1,0]),categories:new Uint8Array([1,0,1,0]),duration:20});};` }));
  await page.route('**/assets/worker-*.js', r => r.fulfill({ contentType: 'application/javascript', body: `let model;self.onmessage=({data})=>{if(data.type==='init'){model=data.model;self.postMessage({backend:'wasm',loadMs:10});return;}const categories=new Uint8Array(data.width*data.height);for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++)categories[y*data.width+x]=x<data.width/2?(model==='cityscapes'?0:3):(model==='cityscapes'?10:7);self.postMessage({model,width:data.width,height:data.height,categories,duration:30,backend:'wasm',tensors:1,tensorBytes:1,memoryReliable:true});};` }));
}
test('all seven combinations reuse one still image, display layers, engine order and metadata exports', async ({ page }) => {
  await fixture(page); await mocks(page); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { const s = JSON.parse(localStorage.getItem('camera-vision-lab.scene.v1')!); localStorage.setItem('camera-vision-lab.scene.v1', JSON.stringify({ ...s, input: 'continuous' })); });
  await page.goto('/'); await upload(page); await ready(page);
  await expect(page.locator('#multi-results')).toContainText('指定色100.0%');
  await expect(page.locator('#multi-results')).toContainText('赤100%');
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.srcObject)).toBe(null);
  const worker = page.workers().find(w => w.url().endsWith('/vision-worker.js'))!, calls = await worker.evaluate('self.calls');
  for (const view of ['before', 'after', 'split', 'normal']) await page.locator('#view-select').selectOption(view);
  await page.locator('summary').filter({ hasText: '複合認識の調整' }).click();
  for (const key of ['boxes', 'relations', 'trails', 'masks']) { await page.locator('#multi-' + key).uncheck(); await page.locator('#multi-' + key).check(); }
  expect(await worker.evaluate('self.calls')).toBe(calls);
  await page.locator('#recognition-settings > summary').click();
  await page.locator('#hue-tolerance').evaluate((input: HTMLInputElement) => { input.value = '42'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await ready(page); await expect(page.locator('#multi-results')).toContainText('指定色100.0%');
  await page.locator('summary').filter({ hasText: '実験記録' }).click();
  const cases = [['objects', '中心距離0.500'], ['object-motion', '移動判定の根拠が弱い'], ['person-object', '人物マスク'], ['temporal', '複数'], ['color-motion', 'HSV / PixelProcessor'], ['object-scene', '空']];
  await page.locator('#record-save').click();
  for (const [experiment, expected] of cases) {
    await page.locator('#multi-experiment').selectOption(experiment); await ready(page);
    if (experiment !== 'temporal') await expect(page.locator('#multi-results')).toContainText(expected);
    if (experiment === 'object-scene') { await expect(page.locator('#multi-input')).toHaveValue('still'); expect(await page.locator('#multi-input option[value="continuous"]').isDisabled()).toBe(true); }
    await page.locator('#record-save').click();
  }
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('camera-vision-lab.experiments.v1')!));
  expect(records).toHaveLength(7); expect(records.every((r: any) => r.multi && r.multi.engines.length > 0)).toBe(true);
  expect(new Set(records.map((r: any) => r.multi.inputId)).size).toBe(1); expect(records[0].multi.inputId).toBeTruthy();
  expect(records[0].multi.targets[0].category).toBe('cup');
  expect(records[0].multi.engines[0].name).toContain('EfficientDet'); expect(records.at(-1).multi.engines[1].name).toContain('ADE20K');
  for (const type of ['json', 'csv']) { const d = page.waitForEvent('download'); await page.locator('#record-' + type).click(); const content = await readFile((await (await d).path())!, 'utf8'); expect(content).toContain(type === 'csv' ? 'multiEvents' : 'fusionMs'); expect(content).not.toContain('base64'); expect(content).not.toContain('foreground'); }
  await page.locator('#view-select').selectOption('split'); await page.locator('.viewport').screenshot({ path: 'docs/v0.5.0-multi-synthetic.png' });
  await page.locator('#scene-clear-image').click(); await expect(page.locator('#count')).toHaveText('0'); await expect(page.locator('#placeholder')).toBeVisible();
  await page.locator('#mode-select').selectOption('color'); await expect.poll(() => page.workers().length).toBe(0); expect(errors).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('camera-vision-lab.scene.v1')!).input)).toBe('continuous');
});
test('continuous single-flight, mirror capture, cancellation, legacy return, stop/restart and settings', async ({ page }) => {
  await fixture(page, true); await mocks(page, 600); await page.goto('/'); await page.locator('#start').click(); await ready(page);
  let worker = page.workers().find(w => w.url().endsWith('/vision-worker.js'))!;
  await expect.poll(() => worker.evaluate('self.calls'), { timeout: 15000 }).toBeGreaterThanOrEqual(3); expect(await worker.evaluate('self.maxBusy')).toBe(1);
  expect(Number(await page.locator('#render-fps').textContent())).toBeGreaterThan(5);
  await page.locator('#multi-experiment').selectOption('color-motion'); await ready(page); await expect(page.locator('#multi-results')).toContainText('指定色');
  const starts = await page.evaluate(() => (window as any).__starts);
  for (const mode of ['color', 'motion', 'shape', 'object', 'segmentation', 'multi']) { await page.locator('#mode-select').selectOption(mode); await expect(page.locator('#latency')).not.toHaveText('—', { timeout: 20000 }); }
  expect(await page.evaluate(() => (window as any).__starts)).toBe(starts);
  await page.locator('#switch').click(); await ready(page); await page.locator('#scene-capture').click(); await ready(page);
  await page.locator('#view-select').selectOption('split'); await page.locator('#overlay').scrollIntoViewIfNeeded();
  const box = await page.locator('#overlay').boundingBox(), scale = Math.min(box!.width / 2 / 160, box!.height / 120);
  // Front mirror: left pane left side samples raw right blue region.
  await page.mouse.click(box!.x + (box!.width / 2 - 160 * scale) / 2 + 40 * scale, box!.y + box!.height / 2);
  await ready(page); await expect(page.locator('#color-target')).toContainText('H240');
  await page.locator('#multi-experiment').selectOption('objects'); await page.waitForTimeout(100); await page.locator('#mode-select').selectOption('color');
  await expect(page.locator('#state')).toContainText('色認識中'); await expect(page.locator('#multi-results')).toHaveText('解析結果を待っています。');
  await page.locator('#start').click(); await expect.poll(() => page.workers().length).toBe(0);
  expect(await page.evaluate(() => (window as any).__stream.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  await page.locator('#start').click(); await expect(page.locator('#latency')).not.toHaveText('—'); await page.locator('#start').click();
  await page.reload(); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('camera-vision-lab.v2')!).hueTolerance)).toBe(39);
});
test('real engines on local still and continuous lightweight pair: PC-only performance', async ({ page }) => {
  test.setTimeout(180000); await fixture(page); const external: string[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.url().startsWith('http') && new URL(r.url()).origin !== 'http://localhost:4173') external.push(r.url()); });
  await page.goto('/'); await upload(page); await ready(page);
  const samples: any[] = [];
  for (const experiment of ['object-color', 'person-object', 'object-scene']) {
    await page.locator('#multi-experiment').selectOption(experiment); await ready(page);
    samples.push({ experiment, wallMs: Number(await page.locator('#latency').textContent()), detail: await page.locator('#multi-results').textContent() });
  }
  await page.locator('#multi-experiment').selectOption('color-motion'); await ready(page); await page.locator('#multi-input').selectOption('continuous'); await page.locator('#start').click(); await ready(page);
  await expect.poll(async () => Number((await page.locator('#multi-results').textContent())?.match(/フレーム \S+-(\d+)/)?.[1]), { timeout: 20000 }).toBeGreaterThanOrEqual(12);
  samples.push({ experiment: 'color-motion-continuous', wallMs: Number(await page.locator('#latency').textContent()), renderFPS: await page.locator('#render-fps').textContent(), inferenceFPS: await page.locator('#detect-fps').textContent(), detail: await page.locator('#multi-results').textContent() });
  await page.locator('#start').click(); await expect.poll(() => page.workers().length).toBe(0);
  const ua = await page.evaluate(() => navigator.userAgent), browser = ua.includes('Edg/') ? 'edge' : 'chrome';
  await writeFile(`docs/performance-v0.5.0-${browser}.json`, JSON.stringify({ at: new Date().toISOString(), userAgent: ua, input: '160x120 synthetic red/blue image and canvas camera; not accuracy or iPhone measurements; first inference includes model initialization; original pinned models / unchanged v0.4 scene runtime161', samples }, null, 2) + '\n');
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
test('expired live results are discarded; wider TTL restores inference without another camera', async ({ page }) => {
  await fixture(page, true); await mocks(page, 1300);
  await page.addInitScript(() => { const s = JSON.parse(localStorage.getItem('camera-vision-lab.multi.v1')!); localStorage.setItem('camera-vision-lab.multi.v1', JSON.stringify({ ...s, ttl: 1000 })); });
  await page.goto('/'); await page.locator('#start').click();
  await expect(page.locator('#status')).toContainText('有効期限切れ', { timeout: 15000 });
  await expect(page.locator('#multi-results')).not.toContainText('統合処理:'); await expect(page.locator('#count')).toHaveText('0');
  await page.locator('summary').filter({ hasText: '複合認識の調整' }).click(); await page.locator('#multi-ttl').fill('5000'); await page.locator('#multi-ttl').dispatchEvent('change'); await ready(page);
  expect(await page.evaluate(() => (window as any).__starts)).toBe(1); await page.locator('#start').click(); await expect.poll(() => page.workers().length).toBe(0);
});
test('composite model errors keep camera active and explicit retry recovers', async ({ page }) => {
  await fixture(page, true); await mocks(page);
  await page.route('**/vision-worker.js', r => r.fulfill({ contentType: 'application/javascript', body: `self.onmessage=()=>self.postMessage({error:'test failure'});` }));
  await page.route('**/models/efficientdet_lite0.tflite', r => r.abort());
  await page.goto('/'); await page.locator('#start').click(); await expect(page.locator('#error')).toBeVisible({ timeout: 45000 });
  expect(await page.evaluate(() => (window as any).__stream.getTracks()[0].readyState)).toBe('live');
  await page.unroute('**/vision-worker.js'); await page.unroute('**/models/efficientdet_lite0.tflite'); await mocks(page);
  await page.locator('#retry').click(); await ready(page); expect(await page.evaluate(() => (window as any).__starts)).toBe(1);
  await page.locator('#start').click();
});
test('Cityscapes class zero is road, not an empty mask', async ({ page }) => {
  await fixture(page); await mocks(page);
  await page.addInitScript(() => { localStorage.setItem('camera-vision-lab.scene.v1', JSON.stringify({ model: 'cityscapes', resolution: 160 })); });
  await page.goto('/'); await page.locator('#multi-experiment').selectOption('object-scene'); await upload(page); await ready(page);
  await expect(page.locator('#multi-results')).toContainText('道路'); await expect(page.locator('#multi-results')).toContainText('Cityscapes');
  await page.locator('#view-select').selectOption('after');
  const pixel = await page.locator('#overlay').evaluate((c: HTMLCanvasElement) => { const scale = Math.min(c.clientWidth / 160, c.clientHeight / 120), x = (c.clientWidth - scale * 160) / 2 + scale * 20, y = c.clientHeight / 2 + scale * 20; return [...c.getContext('2d')!.getImageData(Math.floor(x * c.width / c.clientWidth), Math.floor(y * c.height / c.clientHeight), 1, 1).data]; });
  expect(pixel[1]).toBeGreaterThan(30);
});
