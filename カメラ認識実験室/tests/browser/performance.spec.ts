import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('same-PC segmentation benchmark', async ({ page }) => {
  test.setTimeout(180000);
  const loadMode = process.env.BENCH_LOAD_MODE || 'manual';
  await page.addInitScript(loadMode => {
    localStorage.setItem('camera-vision-lab.v2', JSON.stringify({ mode: 'segmentation', view: 'normal' }));
    localStorage.setItem('camera-vision-lab.segmentation.v1', JSON.stringify({ interval: 200, resolution: 256, loadMode }));
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 240;
      const x = c.getContext('2d')!; let n = 0;
      const timer = setInterval(() => { x.fillStyle = `rgb(${n++ % 200},50,90)`; x.fillRect(0, 0, 160, 240); }, 66);
      const stream = c.captureStream(15);
      stream.getTracks().forEach(t => { const stop = t.stop.bind(t); t.stop = () => { clearInterval(timer); stop(); }; });
      return stream;
    };
  }, loadMode);
  await page.goto('/'); await page.locator('#start').click();
  const samples: Record<string, unknown> = {};
  for (const tab of ['person', 'parts']) {
    await page.locator('#segment-tab').selectOption(tab);
    await expect(page.locator('#segment-performance')).toContainText(tab === 'person' ? 'SelfieSegmenter (square)' : 'SelfieMulticlass 256×256');
    await expect(page.locator('#latency')).not.toHaveText('—', { timeout: 60000 });
    await expect.poll(async () => Number((await page.locator('#segment-performance').textContent())?.match(/直近(\d+)回/)?.[1] ?? 0), { timeout: 60000 }).toBeGreaterThanOrEqual(8);
    samples[tab] = await page.evaluate(() => ({ performance: document.querySelector('#segment-performance')!.textContent, renderFPS: document.querySelector('#render-fps')!.textContent, inferenceFPS: document.querySelector('#detect-fps')!.textContent }));
  }
  await writeFile(`docs/performance-v0.3.1-${process.env.BENCH_PHASE || 'after'}.json`, JSON.stringify({ at: new Date().toISOString(), userAgent: await page.evaluate(() => navigator.userAgent), input: `160x240 changing uniform canvas, 15 fps; ${loadMode} wait base 200ms, capture long edge 256; 8+ completions per model; headless Chrome on this PC (not iPhone)`, samples }, null, 2) + '\n');
  await page.locator('#start').click();
});
