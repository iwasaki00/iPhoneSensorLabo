'use strict';
// Reproducible synthetic evaluation only; no speakers or microphones.
const fs = require('node:fs'), path = require('node:path');
const S = require('./simulator.js');
const reports = [], timings = {};
for (const bitMs of [40, 80, 120]) {
  const normal = [];
  for (const sampleRate of [44100, 48000]) for (const text of ['HELLO', 'TEST123', 'こんにちは', '', 'X'.repeat(32)]) for (const seed of [7, 91]) normal.push(S.communication({ text, sampleRate, bitMs, seed }));
  timings[bitMs] = { ...S.summarize(normal), helloSeconds: normal.find(r => r.text === 'HELLO').signalSeconds };
  reports.push(...normal);
}
const channels = {};
for (const channel of Object.keys(S.CHANNELS)) {
  const selected = [];
  for (const sampleRate of [44100, 48000]) for (const text of ['HELLO', 'TEST123', 'こんにちは']) for (const seed of [17, 49]) selected.push(S.communication({ text, sampleRate, bitMs: 80, channel, seed }));
  channels[channel] = S.summarize(selected); reports.push(...selected);
}
const frequency = [44100, 48000].flatMap(sampleRate => ['tone', 'switch', 'silence', 'noise', 'interference', 'weak', 'impulse', 'dropout'].map(mode => S.evaluateFrequency({ sampleRate, mode, seed: 42, duration: 2.4, interval: 0.8 })));
const result = { version: '0.2.0', source: 'SYNTHETIC ONLY', generatedAt: new Date().toISOString(), frequency, bitTimes: timings, channels, reports };
fs.writeFileSync(path.join(__dirname, 'synthetic-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ bitTimes: timings, channels }, null, 2));
if (Object.values(timings).some(group => group.successRate !== 1)) process.exitCode = 1;
