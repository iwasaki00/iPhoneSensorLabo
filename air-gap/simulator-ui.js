'use strict';
let simulationReports = [];
const simField = id => document.getElementById(id);
function simSettings() {
  return { sampleRate: Number(simField('sim-rate').value), frequency: Number(simField('sim-frequency').value), second: Number(simField('sim-second').value),
    amplitude: Number(simField('sim-amplitude').value), noise: Number(simField('sim-noise').value), duration: Number(simField('sim-duration').value),
    interval: Number(simField('sim-interval').value), seed: Number(simField('sim-seed').value), mode: simField('sim-mode').value, fftSize: Number(simField('sim-fft').value) };
}
function saveSimulationReports() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: '0.2.1', source: 'SYNTHETIC ONLY', reports: simulationReports }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'signal-lab-simulation.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
simField('frequency-test').addEventListener('click', async () => {
  simField('frequency-test').disabled = true;
  simField('sim-result').textContent = '合成PCMを解析中…（マイク・スピーカーは使用しません）';
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const report = SignalSimulator.evaluateFrequency(simSettings()); simulationReports.push(report);
    if (simulationReports.length > 500) simulationReports.shift();
    simField('sim-result').textContent = JSON.stringify(report, (key, value) => key === 'records' ? undefined : value, 2);
    simField('save-sim').disabled = false;
  } catch (error) { simField('sim-result').textContent = error.message; }
  finally { simField('frequency-test').disabled = false; }
});
simField('save-sim').addEventListener('click', saveSimulationReports);
let communicationBusy = false;
async function runCommunications(all) {
  if (communicationBusy) return;
  communicationBusy = true;
  for (const id of ['communication-test', 'all-tests', 'frequency-test']) simField(id).disabled = true;
  const reports = [];
  try {
    const shared = simSettings(), bitMs = Number(simField('sim-bit-ms').value), trials = Number(simField('sim-trials').value);
    if (!Number.isInteger(trials) || trials < 1 || trials > 10) throw new Error('試験回数は1〜10の整数です。');
    const cases = [];
    if (all) {
      for (const sampleRate of [44100, 48000]) for (const text of ['HELLO', 'TEST123', 'こんにちは']) for (const channel of Object.keys(SignalSimulator.CHANNELS)) for (let i = 0; i < 2; i++) cases.push({ text, sampleRate, bitMs, channel, seed: shared.seed + i });
    } else for (let i = 0; i < trials; i++) cases.push({ text: simField('sim-text').value, sampleRate: shared.sampleRate, bitMs, channel: simField('sim-channel').value, seed: shared.seed + i });
    for (const [index, options] of cases.entries()) {
      simField('communication-progress').textContent = `合成試験 ${index + 1}/${cases.length} · ${options.sampleRate}Hz · ${options.channel}`;
      await new Promise(resolve => setTimeout(resolve, 0));
      const report = SignalSimulator.communication(options); reports.push(report); simulationReports.push(report);
      if (simulationReports.length > 500) simulationReports.shift();
    }
    const groups = {};
    for (const channel of Object.keys(SignalSimulator.CHANNELS)) {
      const selected = reports.filter(r => r.conditions.channel === channel); if (selected.length) groups[channel] = SignalSimulator.summarize(selected);
    }
    simField('communication-summary').textContent = JSON.stringify({ source: 'SYNTHETIC ONLY', ...SignalSimulator.summarize(reports), channels: groups }, null, 2);
    simField('communication-detail').textContent = JSON.stringify(reports.at(-1), null, 2);
    simField('communication-progress').textContent = `合成試験完了 · ${reports.filter(r => r.success).length}/${reports.length}成功（失敗も保存）`;
    simField('save-sim').disabled = false;
  } catch (error) { simField('communication-progress').textContent = `FAILED · ${error.message}`; }
  finally { communicationBusy = false; for (const id of ['communication-test', 'all-tests', 'frequency-test']) simField(id).disabled = false; }
}
simField('communication-test').addEventListener('click', () => runCommunications(false));
simField('all-tests').addEventListener('click', () => runCommunications(true));
