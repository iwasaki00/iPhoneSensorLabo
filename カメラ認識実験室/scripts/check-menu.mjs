import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const project = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const repo = path.dirname(path.resolve(project)), folder = path.basename(path.resolve(project));
const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'index.html', 'style.css', `${folder}/dist/`], { cwd: repo, encoding: 'utf8', windowsHide: true });
assert.equal(result.status, 0, result.stderr);
const files = [];
for (const name of new Set(result.stdout.split('\0').filter(Boolean))) { try { if ((await stat(path.join(repo, name))).isFile()) files.push(name); } catch { /* pending deletion */ } }
assert.ok(files.includes(`${folder}/dist/index.html`), 'dist is not eligible for Git distribution');
const fixture = await mkdtemp(path.join(tmpdir(), 'camera-v2-pages-'));
let server, browser;
try {
  for (const file of files) { const dest = path.join(fixture, file); await mkdir(path.dirname(dest), { recursive: true }); await copyFile(path.join(repo, file), dest); }
  server = http.createServer(async (req, res) => {
    try {
      let relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/repository\//, '');
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const full = path.resolve(fixture, relative);
      if (!full.startsWith(fixture + path.sep)) { res.writeHead(403); res.end(); return; }
      const bytes = await readFile(full);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' })[path.extname(full)] || 'application/octet-stream');
      res.end(bytes);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], failed = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  page.on('request', request => { if (request.url().startsWith('http') && new URL(request.url()).origin !== origin) external.push(request.url()); });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 240;
      const context = canvas.getContext('2d'); context.fillStyle = '#000'; context.fillRect(0, 0, 180, 240); context.fillStyle = '#f00'; context.fillRect(20, 30, 60, 60);
      return canvas.captureStream(15);
    };
  });
  await page.goto(origin + '/repository/');
  const card = page.locator(`a[href="${folder}/dist/"]`);
  assert.equal(await card.count(), 1); assert.ok((await card.innerText()).includes(version));
  await card.click();
  await page.waitForFunction(version => document.querySelector('#diagnostics')?.textContent.includes('Version: ' + version), version);
  assert.equal(decodeURI(new URL(page.url()).pathname), `/repository/${folder}/dist/`);
  await page.locator('#mode-select').selectOption('object');
  await page.locator('#start').click();
  await page.waitForFunction(() => { const value = document.querySelector('#latency')?.textContent; return !!value && value !== '—'; }, null, { timeout: 60000 });
  const objectDiagnostics = await page.locator('#diagnostics').textContent();
  assert.ok(objectDiagnostics.includes('MediaPipe 0.10.21'), objectDiagnostics);
  await page.locator('#mode-select').selectOption('color');
  await page.waitForFunction(() => document.querySelector('#count')?.textContent === '1', null, { timeout: 15000 });
  const colorDiagnostics = await page.locator('#diagnostics').textContent();
  assert.ok(colorDiagnostics.includes('画像処理 Worker'), colorDiagnostics);
  await page.locator('#mode-select').selectOption('segmentation');
  await page.waitForFunction(() => { const text = document.querySelector('#segment-performance')?.textContent; return !!text && /直近[1-9]\d*回/.test(text); }, null, { timeout: 60000 });
  assert.ok((await page.locator('#diagnostics').textContent()).includes('Image Segmenter'));
  await page.locator('#mode-select').selectOption('scene');
  await page.locator('#scene-capture').click();
  await page.waitForFunction(() => { const text = document.querySelector('#scene-performance')?.textContent; return !!text && /直近[1-9]\d*回/.test(text); }, null, { timeout: 120000 });
  assert.ok((await page.locator('#diagnostics').textContent()).includes('TensorFlow.js'));
  await page.locator('#start').click();
  assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.deepEqual(external, []);
  console.log(`PASS: ${files.length} Git-eligible static files; parent menu and repository subpath; object + pixel + segmentation + scene; no HTTP/page errors or external requests.`);
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(fixture);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir())); assert.ok(path.basename(resolved).startsWith('camera-v2-pages-'));
  await rm(resolved, { recursive: true, force: true });
}
