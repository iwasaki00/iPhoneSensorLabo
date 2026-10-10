'use strict';
let simulationReports = [];
const simField = id => document.getElementById(id);
function simSettings() {
  return { sampleRate: Number(simField('sim-rate').value), frequency: Number(simField('sim-frequency').value), second: Number(simField('sim-second').value),
    amplitude: Number(simField('sim-amplitude').value), noise: Number(simField('sim-noise').value), duration: Number(simField('sim-duration').value),
    interval: Number(simField('sim-interval').value), seed: Number(simField('sim-seed').value), mode: simField('sim-mode').value, fftSize: Number(simField('sim-fft').value) };
}
function saveSimulationReports() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: '0.1.2', source: 'SYNTHETIC ONLY', reports: simulationReports }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'signal-lab-simulation.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
simField('frequency-test').addEventListener('click', async () => {
  simField('frequency-test').disabled = true;
  simField('sim-result').textContent = '合成PCMを解析中…（マイク・スピーカーは使用しません）';
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const report = SignalSimulator.evaluateFrequency(simSettings()); simulationReports.push(report);
    simField('sim-result').textContent = JSON.stringify(report, (key, value) => key === 'records' ? undefined : value, 2);
    simField('save-sim').disabled = false;
  } catch (error) { simField('sim-result').textContent = error.message; }
  finally { simField('frequency-test').disabled = false; }
});
simField('save-sim').addEventListener('click', saveSimulationReports);
