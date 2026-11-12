import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const settingKey = 'camera-vision-lab.segmentation.v1';
async function camera(page: Page, image = false) {
  const input = image ? 'data:image/jpeg;base64,' + (await readFile('test-results/segment-portrait.jpg').catch(async () => {
    const response = await fetch('https://storage.googleapis.com/mediapipe-assets/portrait.jpg'); if (!response.ok) throw new Error('公式検証画像を取得できません');
    const bytes = Buffer.from(await response.arrayBuffer()); await mkdir('test-results', { recursive: true }); await writeFile('test-results/segment-portrait.jpg', bytes); return bytes;
  })).toString('base64') : '';
  await page.addInitScript(({ input, key }) => {
    localStorage.setItem('camera-vision-lab.v2', JSON.stringify({ mode: 'segmentation', view: 'split', hueTolerance: 39, motionSensitivity: 72 }));
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ tab: 'person', interval: 100 }));
    (window as any).__starts = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__starts++;
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 240;
      const context = canvas.getContext('2d')!;
      if (input) { const portrait = new Image(); portrait.src = input; await portrait.decode(); context.drawImage(portrait, 0, 0, 160, 240); }
      else { context.fillStyle = '#295385'; context.fillRect(0, 0, 160, 240); context.fillStyle = '#ab4930'; context.fillRect(40, 40, 90, 160); }
      const timer = setInterval(() => { context.fillRect(0, 0, 1, 1); }, 60);
      const stream = canvas.captureStream(15); (window as any).__stream = stream;
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); }; });
      return stream;
    };
  }, { input, key: settingKey });
}
async function mockMasks(page: Page) {
  await page.route('**/segmentation-worker.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    let model;
    self.onmessage = ({data}) => {
      if(data.type==='init'){model=data.model;self.postMessage({labels:model==='person'?['background','person']:['background','hair','body-skin','face-skin','clothes','others']});return;}
      const width=16,height=24,categories=new Uint8Array(width*height),foreground=new Float32Array(width*height);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(x>=4&&x<13&&y>=4&&y<20){categories[i]=model==='person'?1:y<8?1:y<12?3:y<14?2:4;foreground[i]=1;}}
      data.bitmap.close();self.postMessage({width,height,categories,foreground,duration:2});
    };` }));
}
async function start(page: Page) { await page.goto('/'); await page.locator('#start').click(); await expect(page.locator('#latency')).not.toHaveText('—', { timeout: 60000 }); }
test('実モデルの人物・部位マスク、遅延ロード、測定値と既存モード復帰', async ({ page }) => {
  await camera(page, true); const requests: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.url().endsWith('.tflite')) requests.push(request.url()); });
  page.on('pageerror', e => errors.push(e.message));
  await start(page); await expect(page.locator('#diagnostics')).toContainText('Worker / CPU');
  await expect(page.locator('#segment-categories')).toContainText('人物: 検出');
  expect(requests.some(url => url.includes('selfie_segmenter.tflite'))).toBe(true);
  expect(requests.some(url => url.includes('selfie_multiclass'))).toBe(false);
  await expect(page.locator('#segment-categories')).toContainText('個別認識: 未対応');
  await page.locator('#segment-tab').selectOption('parts'); await expect(page.locator('#latency')).not.toHaveText('—', { timeout: 60000 });
  await expect(page.locator('#segment-categories')).toContainText('髪: 検出'); await expect(page.locator('#segment-categories')).toContainText('顔の肌: 検出');
  await expect(page.locator('#segment-performance')).toContainText('平均推論時間');
  const samples: Record<string, string> = {};
  for (const tab of ['person', 'parts']) {
    await page.locator('#segment-tab').selectOption(tab); await expect(page.locator('#latency')).not.toHaveText('—', { timeout: 60000 });
    await expect.poll(async () => Number((await page.locator('#segment-performance').textContent())?.match(/直近(\d+)回/)?.[1] ?? 0)).toBeGreaterThanOrEqual(5);
    samples[tab] = (await page.locator('#segment-performance').textContent())!;
  }
  const userAgent = await page.evaluate(() => navigator.userAgent), browser = userAgent.includes('Edg/') ? 'edge' : 'chrome';
  await writeFile(`docs/performance-v0.3.1-portrait-${browser}.json`, JSON.stringify({ userAgent, input: 'Google MediaPipe portrait.jpg test image at 160x240; synthetic video stream', samples }, null, 2) + '\n');
  await page.locator('#mode-select').selectOption('color'); await expect(page.locator('#latency')).not.toHaveText('—');
  await expect(page.locator('#diagnostics')).toContainText('モデル・WASM不使用');
  await page.locator('#mode-select').selectOption('object'); await expect(page.locator('#latency')).not.toHaveText('—', { timeout: 60000 });
  expect(await page.evaluate(() => (window as any).__starts)).toBe(1);
  expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).srcObject === (window as any).__stream)).toBe(true);
  await page.locator('#start').click(); expect(errors).toEqual([]);
});
test('人物5表示・背景4加工・部分4加工・ローカル画像・比較の維持', async ({ page }) => {
  await camera(page); await mockMasks(page); let workers = 0;
  page.on('worker', () => workers++); await start(page); const initial = workers;
  for (const view of ['original', 'highlight', 'person', 'background', 'mask']) await page.locator('#segment-person-view').selectOption(view);
  for (const view of ['normal', 'before', 'after', 'split']) await page.locator('#view-select').selectOption(view);
  expect(workers).toBe(initial);
  await page.locator('#segment-tab').selectOption('background');
  for (const type of ['blur', 'solid', 'dark', 'image']) await page.locator('#segment-background').selectOption(type);
  await expect(page.locator('#segment-reason')).toContainText('画像を選択');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 2; const x = c.getContext('2d')!; x.fillStyle = '#00ff00'; x.fillRect(0, 0, 2, 2); return c.toDataURL().split(',')[1]; });
  await page.locator('#segment-image').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#segment-image-status')).toContainText('読み込みました'); await expect(page.locator('#segment-reason')).toHaveText('');
  const afterPixel = () => page.locator('#overlay').evaluate((canvas: HTMLCanvasElement) => {
    const paneWidth = canvas.clientWidth / 2, scale = Math.min(paneWidth / 160, canvas.clientHeight / 240);
    const x = paneWidth + (paneWidth - 160 * scale) / 2 + 20 * scale, y = (canvas.clientHeight - 240 * scale) / 2 + 50 * scale;
    return Array.from(canvas.getContext('2d')!.getImageData(Math.round(x * canvas.width / canvas.clientWidth), Math.round(y * canvas.height / canvas.clientHeight), 1, 1).data);
  });
  await expect.poll(async () => (await afterPixel())[1]).toBe(255);
  expect(workers).toBe(initial);
  await page.locator('#segment-tab').selectOption('partial'); await expect(page.locator('#latency')).not.toHaveText('—');
  for (const type of ['hair', 'clothes', 'mono', 'outside-mono']) await page.locator('#segment-partial').selectOption(type);
  await page.locator('#segment-target').selectOption('5'); await expect(page.locator('#segment-reason')).toContainText('検出されていない');
  await page.locator('#segment-target').selectOption('4'); await expect(page.locator('#segment-reason')).toHaveText('');
  await page.locator('#segment-tab').selectOption('parts');
  await expect(page.locator('#segment-categories')).toContainText('服: 検出');
  await page.locator('.viewport').screenshot({ path: 'docs/v0.3.1-ui-synthetic.png' });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('camera-vision-lab.v2')!)); expect(saved.hueTolerance).toBe(39); expect(saved.motionSensitivity).toBe(72);
  await page.locator('#start').click(); expect(await page.evaluate(() => (window as any).__stream.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
});
test('読み込み失敗でも映像を保ち再試行できる・停止でWorkerを解放', async ({ page }) => {
  await camera(page); await page.route('**/models/selfie_segmenter.tflite', route => route.abort());
  await page.goto('/'); await page.locator('#start').click(); await expect(page.locator('#error')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#error-message')).toContainText('モデル読込失敗');
  expect(await page.evaluate(() => (window as any).__stream.active)).toBe(true);
  await page.unroute('**/models/selfie_segmenter.tflite'); await page.locator('#retry').click(); await expect(page.locator('#latency')).not.toHaveText('—', { timeout: 60000 });
  const current = page.workers().find(worker => worker.url().includes('segmentation-worker'))!; const closed = new Promise(resolve => current.once('close', resolve));
  await page.locator('#start').click(); await closed; await expect(page.locator('#latency')).toHaveText('—');
  expect(page.workers().filter(worker => worker.url().includes('segmentation-worker'))).toHaveLength(0);
});
test('Worker非対応時にCPU互換方式で実人物モデルを実行', async ({ page }) => {
  await camera(page, true); await page.addInitScript(() => { Object.defineProperty(window, 'Worker', { value: undefined }); });
  await start(page); await expect(page.locator('#diagnostics')).toContainText('メインスレッド / CPU'); await expect(page.locator('#segment-categories')).toContainText('人物: 検出'); await page.locator('#start').click();
});
test('推論待機中の停止でWorkerとカメラを解放し他モードで再開する', async ({ page }) => {
  await camera(page);
  await page.route('**/segmentation-worker.js', route => route.fulfill({ contentType: 'application/javascript', body: `self.onmessage=({data})=>{if(data.type==='init')self.postMessage({labels:['background','person']});else{self.held=true;data.bitmap.close();}};` }));
  await page.goto('/'); await page.locator('#start').click();
  await expect.poll(() => page.workers().length).toBe(1);
  const worker = page.workers()[0]; await expect.poll(() => worker.evaluate('Boolean(self.held)')).toBe(true);
  const closed = new Promise(resolve => worker.once('close', resolve)); await page.locator('#start').click(); await closed;
  await expect(page.locator('#latency')).toHaveText('—'); expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.srcObject)).toBe(null);
  await page.locator('#mode-select').selectOption('color'); await page.locator('#start').click();
  await expect(page.locator('#latency')).not.toHaveText('—'); await expect(page.locator('#error')).toBeHidden(); await page.locator('#start').click();
});
test('CPU互換方式のモデル取得待ち中もカメラを維持して色認識へ切替', async ({ page }) => {
  await camera(page); await page.addInitScript(() => { Object.defineProperty(window, 'Worker', { value: undefined }); });
  await page.route('**/models/selfie_segmenter.tflite', () => {});
  await page.goto('/'); const fetching = page.waitForRequest('**/models/selfie_segmenter.tflite'); await page.locator('#start').click(); await fetching;
  await page.locator('#mode-select').selectOption('color'); await expect(page.locator('#latency')).not.toHaveText('—');
  await expect(page.locator('#state')).toContainText('色認識中'); expect(await page.evaluate(() => (window as any).__starts)).toBe(1);
  await expect(page.locator('#error')).toBeHidden(); await page.locator('#start').click();
});
