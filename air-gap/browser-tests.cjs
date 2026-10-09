'use strict';
// Headless Chromium UI/Web Audio tests, using synthetic microphone input only.
// No real microphone permission or acoustic speaker test is performed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const candidates = [process.env.CHROME_PATH,
  path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean);
const binary = candidates.find(p => fs.existsSync(p));
if (!binary) throw new Error('Chromiumがありません。CHROME_PATHで実行ファイルを指定してください。');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-lab-browser-'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!['index.html', 'main.js', 'analysis.js', 'style.css'].includes(name)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', `${types[path.extname(name)]}; charset=utf-8`);
  res.end(fs.readFileSync(path.join(__dirname, name)));
});
let child, socket, nextId = 0, passed = 0;
const pending = new Map(), errors = [];
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  child = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('DevTools起動タイムアウト')), 20000);
    let stderr = '';
    child.stderr.on('data', data => {
      stderr += data.toString(); const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(new URL(match[1])); }
    });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
  });
  const tabs = await fetch(`http://${endpoint.host}/json/list`).then(r => r.json());
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id); if (!task) return;
      pending.delete(message.id); clearTimeout(task.timeout);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    if (expression.includes('await ')) expression = `(async () => { ${expression} })()`;
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const check = async (name, expression) => {
    const value = await evaluate(expression);
    if (value !== true) console.error(await evaluate('({txState: tx?.context.state, time: tx?.context.currentTime, frequency: tx?.oscillator?.frequency.value, gain: tx?.gain?.gain.value, message: document.getElementById("message").textContent})'));
    assert.equal(value, true, name); passed++; console.log(`PASS ${name}`);
  };
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(50); } throw new Error(`Condition timeout: ${expression}`); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: origin });
  await until("document.readyState === 'complete' && typeof SignalAnalysis !== 'undefined'");
  await check('initial state is silent; no microphone acquired', 'tx === null && rx === null && document.getElementById("tx-stop").disabled');
  await check('390px portrait has no horizontal overflow', 'document.documentElement.scrollWidth <= 390');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await check('320px portrait has no horizontal overflow', 'document.documentElement.scrollWidth <= 320');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await check('Nyquist rejects 16kHz at 32kHz sample rate', '(() => { try { validateFrequency(16000, {sampleRate:32000}); return false; } catch { validateFrequency(15999, {sampleRate:32000}); return true; } })()');
  await evaluate("document.getElementById('tx-start').click()"); await until('tx?.oscillator != null');
  await sleep(100);
  await check('START creates Sine at 1000Hz with low gain', "tx.oscillator.type === 'sine' && tx.oscillator.frequency.value === 1000 && tx.gain.gain.value <= 0.15");
  await evaluate("document.getElementById('frequency').value = '17000'; document.getElementById('frequency').dispatchEvent(new Event('change'))");
  await until('Math.abs(tx.oscillator.frequency.value - 17000) < 1');
  await check('live frequency change and high-frequency warning', "Math.abs(tx.oscillator.frequency.value - 17000) < 1 && !document.getElementById('high-warning').hidden && document.getElementById('tx-state').textContent.includes('17000')");
  await evaluate("document.getElementById('volume').value = '100'; document.getElementById('volume').dispatchEvent(new Event('input'))"); await sleep(200);
  await check('volume changes but cannot exceed gain 0.15', 'Math.abs(tx.gain.gain.value - 0.15) < 0.001');
  await evaluate("document.getElementById('frequency').value = '20001'; document.getElementById('frequency').dispatchEvent(new Event('change'))");
  await check('invalid frequency is rejected', 'Math.abs(tx.oscillator.frequency.value - 17000) < 1');
  await evaluate("globalThis.oldContext = tx.context; document.getElementById('tx-stop').click()"); await sleep(150);
  await check('STOP releases the output context', "tx === null && oldContext.state === 'closed'");
  await evaluate("globalThis.playedFrequencies = []; globalThis.originalTone = tone; tone = (session, frequency) => { playedFrequencies.push(frequency); return originalTone(session, frequency); }; document.querySelector('[data-tab=sweep]').click(); document.getElementById('duration').value = '0.1'; document.getElementById('gap').value = '0'; document.getElementById('sweep-start').click()");
  await until('tx?.oscillator != null');
  await check('preset sweep starts at 500Hz', 'tx.oscillator.frequency.value === 500');
  await until("document.getElementById('sweep-progress').textContent === 'COMPLETE'");
  await check('preset sweep finishes at 19000Hz and stops', "tx === null && document.getElementById('frequency').value === '19000' && document.getElementById('progress').value === 11");
  await check('all preset tones play in the specified order', 'JSON.stringify(playedFrequencies) === JSON.stringify(SignalAnalysis.PRESETS)');
  await evaluate("playedFrequencies = []; document.getElementById('sweep-mode').value = 'range'; document.getElementById('sweep-mode').dispatchEvent(new Event('change')); document.getElementById('sweep-from').value = '15000'; document.getElementById('sweep-to').value = '17000'; document.getElementById('sweep-step').value = '1000'; document.getElementById('sweep-start').click()");
  await until('tx?.oscillator != null'); await until("document.getElementById('sweep-progress').textContent === 'COMPLETE'");
  await check('range sweep plays every configured step', 'JSON.stringify(playedFrequencies) === JSON.stringify([15000, 16000, 17000])');
  await evaluate("document.getElementById('sweep-start').click()"); await until('tx?.oscillator != null');
  await evaluate("document.getElementById('sweep-stop').click()"); await sleep(200);
  await check('sweep STOP cancels subsequent tones', 'tx === null');
  await evaluate("document.querySelector('[data-tab=receiver]').click(); Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('test denial', 'NotAllowedError'); } }); document.getElementById('rx-start').click()");
  await until("document.getElementById('message').textContent.includes('拒否')");
  await check('permission denial gives reason and releases context', 'rx === null && !document.getElementById("rx-start").disabled');
  await evaluate(`globalThis.syntheticContext = new AudioContext(); await syntheticContext.resume();
    globalThis.syntheticOscillator = syntheticContext.createOscillator(); syntheticOscillator.frequency.value = 17000;
    globalThis.syntheticGain = syntheticContext.createGain(); syntheticGain.gain.value = 0.08;
    globalThis.syntheticDestination = syntheticContext.createMediaStreamDestination();
    syntheticOscillator.connect(syntheticGain).connect(syntheticDestination); syntheticOscillator.start();
    globalThis.captureCalls = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { if (++captureCalls === 1) throw new DOMException('test unsupported constraint', 'OverconstrainedError'); return syntheticDestination.stream; } });
    document.getElementById('target').value = '17000'; document.getElementById('rx-start').click();`);
  await until("result?.state === 'DETECTED'");
  await check('real AnalyserNode detects synthetic 17kHz stream', 'Math.abs(result.frequency - 17000) < 3 && result.target === 17000');
  await check('unsupported constraints fall back and are diagnosed', 'captureCalls === 2 && document.getElementById("constraints").textContent.includes("制約なし再試行: あり")');
  await check('graphs draw at mobile size', "document.getElementById('wave').width > 0 && document.getElementById('spectrum').width > 0 && document.documentElement.scrollWidth <= 390");
  await evaluate("document.getElementById('band').value = 'high'"); await sleep(100);
  const receiverScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: {x:0, y:0, width:390, height:await evaluate('document.documentElement.scrollHeight'), scale:1} });
  fs.writeFileSync(path.join(os.tmpdir(), 'signal-lab-receiver.png'), Buffer.from(receiverScreenshot.data, 'base64'));
  await evaluate("document.getElementById('record').click()");
  await check('manual record contains measured values', 'rows.length === 1 && rows[0][1] === 17000 && rows[0][7] === "DETECTED"');
  await evaluate("document.getElementById('fft-size').value = '8192'; document.getElementById('fft-size').dispatchEvent(new Event('change'))");
  await until("result?.state === 'DETECTED' && result.fftSize === 8192");
  await check('FFT change reallocates buffers and resets stability', 'samples.length === 8192 && spectrum.length === 4096');
  await evaluate("document.getElementById('target').value = ''; document.getElementById('target').dispatchEvent(new Event('input'))");
  await until('result?.target === null && result?.state === "DETECTED"');
  await evaluate("document.getElementById('record').click()");
  await check('unset target is explicit in log', 'rows[1][1] === "未設定" && rows[1][3] === ""');
  await evaluate("syntheticGain.gain.value = 0"); await until('result?.state === "NO SIGNAL"');
  await check('silence clears detected frequency', 'result.frequency === null && document.getElementById("detected").textContent.includes("—")');
  await evaluate("document.getElementById('record').click(); globalThis.csvText = ''; globalThis.savedBlob = Blob; globalThis.Blob = class extends savedBlob { constructor(parts, options) { super(parts, options); csvText = parts.join(''); } }; document.getElementById('csv').click()");
  await check('CSV download uses BOM and measured records', 'csvText.startsWith("\\uFEFF") && csvText.includes("未設定") && csvText.includes("NO SIGNAL")');
  await evaluate("globalThis.microphoneTracks = rx.stream.getTracks(); document.getElementById('rx-stop').click()"); await sleep(100);
  await check('MIC STOP ends MediaStreamTracks and clears stale values', 'rx === null && microphoneTracks.every(track => track.readyState === "ended") && result === null');
  await evaluate("document.querySelector('[data-tab=generator]').click(); document.getElementById('tx-start').click()"); await until('tx?.oscillator != null');
  await evaluate('await tx.context.suspend()'); await until('tx === null'); await sleep(150);
  await check('AudioContext interruption stops generator', 'tx === null && document.getElementById("message").textContent.includes("中断")');
  await evaluate("document.getElementById('tx-start').click()"); await until('tx?.oscillator != null');
  await evaluate('window.dispatchEvent(new Event("pagehide"))'); await sleep(150);
  await check('background cleanup stops resources and asks for explicit restart', 'tx === null && rx === null && document.getElementById("message").textContent.includes("復帰")');
  await evaluate("syntheticOscillator.stop(); await syntheticContext.close(); document.querySelector('[data-tab=generator]').click()");
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = path.join(os.tmpdir(), 'signal-lab-mobile.png');
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  console.log(`Browser checks: ${passed} passed. Synthetic input only. Screenshot: ${screenshotPath}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close(); child?.kill(); server.close();
  for (const task of pending.values()) clearTimeout(task.timeout);
  // Only remove the uniquely created profile inside the system temporary folder.
  const resolved = path.resolve(profile), temp = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(temp) && path.basename(resolved).startsWith('signal-lab-browser-')) {
    setTimeout(() => { try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }, 500);
  }
});
