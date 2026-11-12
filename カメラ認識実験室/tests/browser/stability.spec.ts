import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function setup(page: Page, held = false) {
  await page.addInitScript(() => {
    localStorage.setItem('camera-vision-lab.v2', JSON.stringify({ mode: 'segmentation', view: 'split', hueTolerance: 39 }));
    localStorage.setItem('camera-vision-lab.segmentation.v1', JSON.stringify({ interval: 100, boundary: 0 }));
    (window as any).__starts = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__starts++;
      const c = document.createElement('canvas'); c.width = 160; c.height = 240; const x = c.getContext('2d')!;
      let n = 0; const update = () => { x.fillStyle = `rgb(${30 + (n++ % 8) * 20},60,80)`; x.fillRect(0, 0, 160, 240); }; update();
      const timer = setInterval(update, 100), stream = c.captureStream(15); (window as any).__stream = stream;
      stream.getTracks().forEach(t => { const stop = t.stop.bind(t); t.stop = () => { clearInterval(timer); stop(); }; }); return stream;
    };
  });
  await page.route('**/segmentation-worker.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    let model, active=0; self.maxActive=0; self.calls=0;self.completed=0;
    self.onmessage=({data})=>{
      if(data.type==='init'){model=data.model;self.postMessage({labels:model==='person'?['background','person']:['background','hair','body-skin','face-skin','clothes','others']});return;}
      self.calls++; self.maxActive=Math.max(self.maxActive,++active); data.bitmap.close();
      if(${held} && self.calls>1)return;
      setTimeout(()=>{if(self.pause)return;const width=16,height=24,categories=new Uint8Array(width*height).fill(1),foreground=new Float32Array(width*height).fill(1);active--;self.completed++;self.postMessage({width,height,categories,foreground,duration:${held ? 30 : 400}});},${held ? 30 : 400});
    };` }));
}
async function begin(page: Page) { await page.goto('/'); await page.locator('#start').click(); await expect(page.locator('#latency')).not.toHaveText('—'); }
test('auto load, live processing between inferences, no overlap, metadata record export/reset', async ({ page }) => {
  await setup(page); await begin(page);
  await expect(page.locator('#segment-load-status')).toContainText('高負荷');
  const w = page.workers().find(w => w.url().includes('segmentation-worker'))!;
  await expect.poll(() => w.evaluate('self.completed')).toBeGreaterThanOrEqual(3);
  expect(await w.evaluate('self.maxActive')).toBe(1);
  const completed = await w.evaluate('self.pause=true;self.completed');
  const sample = () => page.locator('#overlay').evaluate((c: HTMLCanvasElement) => {
    const x = c.getContext('2d')!, d = c.width / c.clientWidth;
    return [x.getImageData(Math.round(c.width * 0.25), Math.round(200 * d), 1, 1).data[0], x.getImageData(Math.round(c.width * 0.75), Math.round(200 * d), 1, 1).data[0]];
  });
  const first = await sample(); await page.waitForTimeout(250); const second = await sample();
  expect(first[0]).not.toBe(second[0]); expect(first[1]).not.toBe(second[1]); // live BEFORE and AFTER, not the captured frame
  expect(await w.evaluate('self.completed')).toBe(completed);
  await page.locator('summary').filter({ hasText: '実験記録' }).click(); await page.locator('#record-save').click();
  await expect(page.locator('#record-list')).toContainText('1/50');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('camera-vision-lab.experiments.v1')!));
  expect(saved[0].averageMs).toBe(400); expect(saved[0].userAgent).toContain('Chrome'); expect(saved[0].source).toBeUndefined();
  for (const format of ['json', 'csv']) {
    const download = page.waitForEvent('download'); await page.locator('#record-' + format).click();
    const text = await readFile((await (await download).path())!, 'utf8'); expect(text).toContain((await page.locator('.version').textContent())!.replace(/^v/, '')); expect(text).not.toContain('base64');
  }
  await page.reload(); await page.locator('summary').filter({ hasText: '実験記録' }).click(); await expect(page.locator('#record-list')).toContainText('1/50');
  await page.locator('#record-clear').click(); await expect(page.locator('#record-list')).toContainText('0/50');
  await page.locator('summary').filter({ hasText: '詳細設定' }).click(); await page.locator('#segment-load').selectOption('manual'); await page.locator('#segment-resolution').selectOption('384'); await page.locator('#segment-reset').click();
  await expect(page.locator('#segment-load')).toHaveValue('auto'); await expect(page.locator('#segment-resolution')).toHaveValue('256');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('camera-vision-lab.v2')!).hueTolerance)).toBe(39);
});
test('mask expires while inference hangs; stale mode output never returns; stop/restart/camera switch', async ({ page }) => {
  await setup(page, true); await begin(page);
  await page.locator('summary').filter({ hasText: '詳細設定' }).click(); await page.locator('#segment-ttl').selectOption('500');
  await expect(page.locator('#segment-reason')).toContainText('有効期限'); await expect(page.locator('#count')).toHaveText('0');
  const old = page.workers().find(w => w.url().includes('segmentation-worker'))!, closed = new Promise(resolve => old.once('close', resolve));
  await page.locator('#segment-tab').selectOption('parts'); await closed;
  await page.locator('#mode-select').selectOption('color'); await expect(page.locator('#latency')).not.toHaveText('—');
  await expect(page.locator('#state')).toContainText('色認識中'); await expect(page.locator('#segment-categories')).not.toContainText('検出 /');
  await page.locator('#mode-select').selectOption('motion'); await expect(page.locator('#latency')).not.toHaveText('—');
  expect(await page.evaluate(() => (window as any).__starts)).toBe(1);
  await page.locator('#start').click(); expect(await page.evaluate(() => (window as any).__stream.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  await page.locator('#start').click(); await expect(page.locator('#latency')).not.toHaveText('—'); await page.locator('#switch').click(); await expect(page.locator('#latency')).not.toHaveText('—');
  await expect(page.locator('#error')).toBeHidden(); await page.locator('#start').click(); expect(page.workers()).toHaveLength(0);
});
