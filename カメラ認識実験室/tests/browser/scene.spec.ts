import { test, expect, type Page } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
async function image(page: Page) {
  const bytes = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 120; const x = c.getContext('2d')!; x.fillStyle = '#83b9f0'; x.fillRect(0, 0, 160, 60); x.fillStyle = '#6a707a'; x.fillRect(0, 60, 160, 60); x.fillStyle = '#c0ad95'; x.fillRect(80, 25, 55, 60); return c.toDataURL().split(',')[1]; });
  await page.locator('#scene-file').setInputFiles({ name: 'scene.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64') });
}
async function ready(page: Page) { await expect.poll(async () => { if (await page.locator('#error').isVisible()) throw new Error((await page.locator('#error-message').textContent())!); return page.locator('#latency').textContent(); }, { timeout: 120000 }).not.toBe('—'); await expect(page.locator('#error')).toBeHidden(); }
test('real scene models: still without camera, sequential comparison, tensor lifecycle and metadata export', async ({ page }) => {
  test.setTimeout(240000); const errors: string[] = [], external: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') console.log('browser:', message.text()); });
  page.on('request', request => { if (request.url().startsWith('http') && new URL(request.url()).origin !== 'http://localhost:4173') external.push(request.url()); });
  await page.addInitScript(() => { localStorage.setItem('camera-vision-lab.v2', JSON.stringify({ mode: 'scene', view: 'split', hueTolerance: 39 })); });
  await page.goto('/'); await image(page); await ready(page);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.srcObject)).toBe(null);
  const samples: Record<string, unknown> = {};
  await page.locator('summary').filter({ hasText: '実験記録' }).click();
  for (const model of ['ade20k', 'cityscapes']) {
    await page.locator('#scene-model').selectOption(model); await ready(page);
    const tensorCounts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const previous = await page.locator('#scene-performance').textContent();
      await page.locator('#scene-analyze').click();
      await expect.poll(async () => page.locator('#scene-performance').textContent(), { timeout: 120000 }).not.toBe(previous);
      await ready(page);
      tensorCounts.push(Number((await page.locator('#scene-performance').textContent())?.match(/Tensor数: (\d+)/)?.[1]));
    }
    expect(new Set(tensorCounts).size).toBe(1);
    const performance = await page.locator('#scene-performance').textContent(); console.log(model, performance);
    samples[model] = { performance, tensorCounts };
    await page.locator('#record-save').click();
  }
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('camera-vision-lab.experiments.v1')!));
  expect(records).toHaveLength(2); expect(records[0].scene.inputId).toBe(records[1].scene.inputId); expect(records[0].scene.categories.length).toBeGreaterThan(0);
  expect(records[0].scene.modelBytes).toBe(2438371); expect(records[1].scene.modelBytes).toBe(2237643);
  const ua = await page.evaluate(() => navigator.userAgent), browser = ua.includes('Edg/') ? 'edge' : 'chrome';
  await writeFile(`docs/performance-v0.4.0-${browser}.json`, JSON.stringify({ at: new Date().toISOString(), userAgent: ua, input: '160x120 synthetic sky/road/building color blocks, static file, capture limit257; not an accuracy benchmark or iPhone measurement', samples }, null, 2) + '\n');
  for (const type of ['json', 'csv']) { const download = page.waitForEvent('download'); await page.locator('#record-' + type).click(); const content = await readFile((await (await download).path())!, 'utf8'); expect(content).toContain(type === 'json' ? 'categories' : 'categoryOccupancy'); expect(content).not.toContain('base64'); }
  await page.locator('summary').filter({ hasText: '風景の調整' }).click(); await page.locator('#scene-release-model').click();
  await expect.poll(() => page.workers().length).toBe(0); await page.locator('#scene-analyze').click(); await ready(page);
  await page.locator('#mode-select').selectOption('color'); await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
async function mockScene(page: Page) {
  await page.route('**/assets/worker-*.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    let model,busy=0;self.maxBusy=0;self.calls=0;self.onmessage=({data})=>{
      if(data.type==='init'){model=data.model;self.postMessage({backend:'wasm',loadMs:20});return;}
      self.calls++;self.maxBusy=Math.max(self.maxBusy,++busy);
      setTimeout(()=>{const categories=new Uint8Array(data.width*data.height);for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++)categories[y*data.width+x]=x<data.width/2?(model==='ade20k'?3:10):(model==='ade20k'?7:0);busy--;self.postMessage({model,width:data.width,height:data.height,categories,duration:80,backend:'wasm',tensors:10,tensorBytes:1000,memoryReliable:true});},80);
    };` }));
}
async function mockCamera(page: Page) {
  await page.addInitScript(() => {
    (window as any).__starts = 0; navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__starts++; const c = document.createElement('canvas'); c.width = 160; c.height = 120; const x = c.getContext('2d')!;
      let frame = 0; const update = () => { x.fillStyle = frame++ % 2 ? '#a85030' : '#3070b0'; x.fillRect(0, 0, 160, 120); }; update(); const timer = setInterval(update, 100), stream = c.captureStream(15);
      (window as any).__stream = stream; stream.getTracks().forEach(t => { const stop = t.stop.bind(t); t.stop = () => { clearInterval(timer); stop(); }; }); return stream;
    };
  });
}
test('scene display/effects, tap coordinates, comparison, original pixels and sequential model categories', async ({ page }) => {
  await mockScene(page); await page.goto('/'); await page.locator('#mode-select').selectOption('scene'); await image(page); await ready(page);
  await expect(page.locator('#scene-legend')).toContainText('空 50.0%'); await expect(page.locator('#scene-legend')).toContainText('道路 50.0%');
  await page.locator('#view-select').selectOption('split');
  const clickLeft = async () => {
    await page.locator('#overlay').scrollIntoViewIfNeeded();
    const box = await page.locator('#overlay').boundingBox(); const scale = Math.min(box!.width / 2 / 160, box!.height / 120);
    await page.mouse.click(box!.x + (box!.width / 2 - 160 * scale) / 2 + 30 * scale, box!.y + box!.height / 2);
  };
  await clickLeft(); await expect(page.locator('#scene-tap')).toContainText('推定: 空'); await expect(page.locator('#scene-target')).toHaveValue('3');
  const worker = page.workers()[0], calls = await worker.evaluate('self.calls');
  for (const display of ['original', 'mask', 'overlay', 'highlight', 'tint', 'mono', 'outside-mono', 'brightness', 'solid']) await page.locator('#scene-display').selectOption(display);
  for (const view of ['normal', 'before', 'after', 'split']) await page.locator('#view-select').selectOption(view);
  expect(await worker.evaluate('self.calls')).toBe(calls);
  await page.locator('#scene-display').selectOption('mask');
  await page.locator('.viewport').screenshot({ path: 'docs/v0.4.0-scene-synthetic.png' });
  await page.locator('#recognition').click(); await expect(page.locator('#count')).toHaveText('0'); expect(page.workers()).toHaveLength(0);
  await page.locator('#recognition').click(); await ready(page);
  await page.locator('#scene-model').selectOption('cityscapes'); await ready(page); await clickLeft(); await expect(page.locator('#scene-tap')).toContainText('推定: 空'); await expect(page.locator('#scene-target')).toHaveValue('10');
  await expect(page.locator('#scene-support')).toContainText('床: 未対応'); expect(page.workers()).toHaveLength(1);
  await page.locator('summary').filter({ hasText: '風景の調整' }).click(); await page.locator('#scene-clear-image').click(); await expect(page.locator('#count')).toHaveText('0');
  await page.locator('#mode-select').selectOption('color'); await expect(page.locator('#placeholder')).toBeVisible();
});
test('continuous scheduling, shared camera, front snapshot mirror, stale mode cancellation and stop', async ({ page }) => {
  await mockScene(page); await mockCamera(page); await page.goto('/'); await page.locator('#mode-select').selectOption('scene');
  await page.locator('#scene-input').selectOption('continuous'); await page.locator('#start').click(); await ready(page);
  const worker = page.workers()[0]; await expect.poll(() => worker.evaluate('self.calls'), { timeout: 15000 }).toBeGreaterThanOrEqual(3); expect(await worker.evaluate('self.maxBusy')).toBe(1);
  await page.locator('#switch').click(); await ready(page); await page.locator('#scene-capture').click(); await ready(page);
  await expect(page.locator('#scene-input')).toHaveValue('still');
  await page.locator('#view-select').selectOption('normal');
  await page.locator('#overlay').scrollIntoViewIfNeeded();
  const box = await page.locator('#overlay').boundingBox(); const scale = Math.min(box!.width / 160, box!.height / 120);
  await page.mouse.click(box!.x + (box!.width - 160 * scale) / 2 + 25 * scale, box!.y + box!.height / 2);
  await expect(page.locator('#scene-tap')).toContainText('推定: 道路'); // raw right half appears on left in front mirror
  const starts = await page.evaluate(() => (window as any).__starts);
  await page.locator('#scene-model').selectOption('cityscapes'); await page.locator('#mode-select').selectOption('color'); await ready(page);
  expect(await page.evaluate(() => (window as any).__starts)).toBe(starts);
  await expect(page.locator('#state')).toContainText('色認識中'); await expect(page.locator('#scene-categories')).toHaveText('解析結果を待っています。');
  await page.locator('#start').click(); expect(page.workers()).toHaveLength(0); expect(await page.evaluate(() => (window as any).__stream.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
});
test('scene model fetch failure retries with camera stopped; Worker-free fallback works', async ({ page }) => {
  test.setTimeout(180000); await page.addInitScript(() => { localStorage.setItem('camera-vision-lab.v2', JSON.stringify({ mode: 'scene' })); Object.defineProperty(window, 'Worker', { value: undefined }); });
  await page.route('**/models/scene/ade20k/model.json', route => route.abort()); await page.goto('/'); await image(page);
  await expect(page.locator('#error')).toBeVisible({ timeout: 120000 }); await expect(page.locator('#error-message')).toContainText('モデル読込失敗');
  await page.unroute('**/models/scene/ade20k/model.json'); await page.locator('#retry').click(); await ready(page); await expect(page.locator('#diagnostics')).toContainText('メインスレッド');
  await page.locator('summary').filter({ hasText: '風景の調整' }).click(); await page.locator('#scene-release-model').click(); await page.locator('#scene-analyze').click(); await ready(page);
});
test('real continuous WASM inference keeps live drawing and stops without queued frames', async ({ page }) => {
  test.setTimeout(90000); await mockCamera(page);
  await page.addInitScript(() => { localStorage.setItem('camera-vision-lab.v2', JSON.stringify({ mode: 'scene' })); localStorage.setItem('camera-vision-lab.scene.v1', JSON.stringify({ input: 'continuous', resolution: 160, interval: 1000 })); });
  await page.goto('/'); await page.locator('#start').click(); await ready(page);
  await expect.poll(async () => Number((await page.locator('#scene-performance').textContent())?.match(/直近(\d+)回/)?.[1] ?? 0), { timeout: 60000 }).toBeGreaterThanOrEqual(4);
  expect(Number(await page.locator('#render-fps').textContent())).toBeGreaterThan(5);
  const userAgent = await page.evaluate(() => navigator.userAgent), browser = userAgent.includes('Edg/') ? 'edge' : 'chrome';
  await writeFile(`docs/performance-v0.4.0-continuous-${browser}.json`, JSON.stringify({ at: new Date().toISOString(), userAgent, input: '160x120 changing color canvas at15fps; ADE20K internal161 square; auto wait base1000; PC synthetic camera only', diagnostics: await page.locator('#scene-performance').textContent(), renderFPS: await page.locator('#render-fps').textContent(), inferenceFPS: await page.locator('#detect-fps').textContent() }, null, 2) + '\n');
  await page.locator('#start').click(); expect(page.workers()).toHaveLength(0); await expect(page.locator('#latency')).toHaveText('—');
});
