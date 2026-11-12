import { test, expect, type Page } from '@playwright/test';
import { writeFile, readdir } from 'node:fs/promises';

async function syntheticCamera(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('camera-vision-lab.v2')) localStorage.setItem('camera-vision-lab.v2', JSON.stringify({ mode: 'color' }));
    (window as any).__cameraStarts = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__cameraStarts++;
      const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      const paint = (offset = 0) => {
        ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, 180, 240);
        ctx.fillStyle = '#ff0000'; ctx.fillRect(20 + offset, 20, 30, 35); ctx.fillRect(125, 165, 30, 25);
        ctx.fillStyle = '#0000ff'; ctx.beginPath(); ctx.arc(125, 75, 22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(40, 110); ctx.lineTo(15, 175); ctx.lineTo(85, 175); ctx.closePath(); ctx.fill();
      };
      paint(); (window as any).__paint = paint;
      const stream = canvas.captureStream(20); (window as any).__stream = stream;
      return stream;
    };
  });
}
async function started(page: Page) {
  await page.goto('/'); await page.locator('#start').click();
  await expect(page.locator('#latency')).not.toHaveText('—', { timeout: 15000 });
}
async function sample(page: Page, sourceX: number, sourceY: number, paneIndex = 0, split = false, mirror = false) {
  return page.locator('#overlay').evaluate((canvas: HTMLCanvasElement, args) => {
    const { sourceX, sourceY: y, paneIndex: index, split, mirror } = args;
    const x = mirror ? 180 - sourceX : sourceX;
    const width = canvas.clientWidth / (split ? 2 : 1), height = canvas.clientHeight, scale = Math.min(width / 180, height / 240);
    const px = index * width + (width - 180 * scale) / 2 + x * scale, py = (height - 240 * scale) / 2 + y * scale;
    return [...canvas.getContext('2d')!.getImageData(Math.floor(px * canvas.width / canvas.clientWidth), Math.floor(py * canvas.height / canvas.clientHeight), 1, 1).data];
  }, { sourceX, sourceY, paneIndex, split, mirror });
}
test('3モード切替・HSVタップ・比較表示はカメラを再起動せず設定を復元する', async ({ page }) => {
  await syntheticCamera(page); const assets: string[] = [], workers: unknown[] = [], errors: string[] = [];
  page.on('request', r => { if (/\.wasm|\.tflite/.test(r.url())) assets.push(r.url()); });
  page.on('worker', w => workers.push(w)); page.on('pageerror', e => errors.push(e.message));
  await started(page); await expect(page.locator('#count')).toHaveText('2');
  const initialWorkers = workers.length;
  await page.locator('#view-select').selectOption('before'); await page.waitForTimeout(80);
  expect((await sample(page, 125, 75))[2]).toBeGreaterThan(240);
  const rect = await page.locator('#overlay').boundingBox(), scale = Math.min(rect!.width / 180, rect!.height / 240);
  await page.locator('#overlay').click({ position: { x: (rect!.width - 180 * scale) / 2 + 125 * scale, y: (rect!.height - 240 * scale) / 2 + 75 * scale } });
  await expect(page.locator('#color-target')).toContainText('H240'); await expect(page.locator('#count')).toHaveText('1');
  await page.locator('#view-select').selectOption('after'); await page.waitForTimeout(80);
  expect((await sample(page, 125, 75))[1]).toBeGreaterThan(100);
  await page.locator('#view-select').selectOption('split'); await page.waitForTimeout(80);
  expect((await sample(page, 125, 75, 0, true))[2]).toBeGreaterThan(240);
  expect((await sample(page, 125, 75, 1, true))[1]).toBeGreaterThan(100);
  expect(workers.length).toBe(initialWorkers);
  await page.locator('#mode-select').selectOption('motion'); await expect(page.locator('#latency')).not.toHaveText('—');
  await expect(page.locator('#count')).toHaveText('0'); await page.evaluate(() => (window as any).__paint(12));
  await expect(page.locator('#count')).not.toHaveText('0'); await expect(page.locator('#result-info')).toContainText('静止', { timeout: 5000 });
  await page.locator('#reset-background').click(); await expect(page.locator('#count')).toHaveText('0');
  await page.locator('#mode-select').selectOption('shape'); await expect(page.locator('#latency')).not.toHaveText('—');
  await expect(page.locator('#result-info')).toContainText('円形'); await expect(page.locator('#result-info')).toContainText('三角形');
  expect(await page.evaluate(() => (window as any).__cameraStarts)).toBe(1);
  await page.screenshot({ path: 'docs/v0.3.0-legacy-modes.png', fullPage: true });
  expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).srcObject === (window as any).__stream)).toBe(true);
  await page.locator('summary').filter({ hasText: '詳細設定' }).click();
  await page.locator('#shape-sensitivity').evaluate((input: HTMLInputElement) => { input.value = '73'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#start').click();
  expect(await page.evaluate(() => (window as any).__stream.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  await page.reload(); await expect(page.locator('#mode-select')).toHaveValue('shape'); await expect(page.locator('#view-select')).toHaveValue('split'); await expect(page.locator('#shape-sensitivity')).toHaveValue('73');
  expect(assets).toEqual([]); expect(errors).toEqual([]);
});
test('高速モード切替と画像処理Worker非対応時の互換方式', async ({ page }) => {
  await syntheticCamera(page); await page.addInitScript(() => { Object.defineProperty(window, 'Worker', { value: undefined }); });
  await started(page); await expect(page.locator('#diagnostics')).toContainText('メインスレッド');
  for (const mode of ['motion', 'shape', 'color', 'motion', 'color']) await page.locator('#mode-select').selectOption(mode);
  await expect(page.locator('#state')).toContainText('色認識中'); await expect(page.locator('#latency')).not.toHaveText('—');
  expect(await page.evaluate(() => (window as any).__cameraStarts)).toBe(1); await expect(page.locator('#error')).toBeHidden(); await page.locator('#start').click();
});
test('保存不可でも操作できる', async ({ page }) => {
  await syntheticCamera(page); await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('disabled'); }; });
  await page.goto('/'); await page.locator('#mode-select').selectOption('motion'); await expect(page.locator('#storage-status')).toBeVisible();
  await page.locator('#start').click(); await expect(page.locator('#latency')).not.toHaveText('—'); await page.locator('#start').click();
});
test('前面の鏡像で色を指定しても左右比較の枠と座標が一致する', async ({ page }) => {
  await syntheticCamera(page); await started(page); await page.locator('#switch').click();
  await expect(page.locator('video')).toHaveClass('mirrored'); await expect(page.locator('#latency')).not.toHaveText('—');
  await page.locator('#view-select').selectOption('split');
  const rect = await page.locator('#overlay').boundingBox(), paneWidth = rect!.width / 2, scale = Math.min(paneWidth / 180, rect!.height / 240);
  await page.locator('#overlay').click({ position: { x: (paneWidth - 180 * scale) / 2 + 55 * scale, y: (rect!.height - 240 * scale) / 2 + 75 * scale } });
  await expect(page.locator('#color-target')).toContainText('H240'); await expect(page.locator('#count')).toHaveText('1');
  expect((await sample(page, 125, 75, 0, true, true))[2]).toBeGreaterThan(240);
  expect((await sample(page, 125, 75, 1, true, true))[1]).toBeGreaterThan(100);
  await page.locator('#start').click();
});
test('画像処理Workerの処理時間を合成フレームで実測する', async ({ page }) => {
  const workerFile = (await readdir('dist/assets')).find(name => name.startsWith('processing-worker-') && name.endsWith('.js'))!;
  await page.goto('/');
  const results = await page.evaluate(async workerPath => {
    const output: Record<string, number[]> = {};
    for (const mode of ['color', 'motion', 'shape']) {
      const worker = new Worker(workerPath, { type: 'module' });
      const request = (message: object) => new Promise<any>((resolve, reject) => { worker.onmessage = e => e.data.error ? reject(new Error(e.data.error)) : resolve(e.data); worker.onerror = reject; worker.postMessage(message); });
      await request({ type: 'init', mode }); const samples: number[] = [];
      for (let i = 0; i < 14; i++) {
        const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 320; const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, 240, 320); ctx.fillStyle = '#f00'; ctx.fillRect(20 + i * 2, 30, 55, 55); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(150, 190, 40, 0, Math.PI * 2); ctx.fill();
        const result = await request({ type: 'frame', width: 240, height: 320, pixels: ctx.getImageData(0, 0, 240, 320).data, timestamp: 100 + i * 200, settings: { target: { h: 0, s: 0.75, v: 0.8 }, hueTolerance: 22, saturationTolerance: 35, valueTolerance: 35, motionSensitivity: 60, shapeSensitivity: 60, minArea: 40 } });
        if (i >= 2) samples.push(result.duration);
      }
      output[mode] = samples; worker.terminate();
    }
    return { userAgent: navigator.userAgent, analysis: '240x320', samplesMs: output };
  }, `/assets/${workerFile}`);
  await writeFile('docs/performance-v0.2.0.json', JSON.stringify(results, null, 2) + '\n');
  for (const samples of Object.values(results.samplesMs)) expect(samples.length).toBe(12);
});
