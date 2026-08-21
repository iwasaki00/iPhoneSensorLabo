import { $, state, log, message, setBadge } from "./core.js";
import { setTorch } from "./camera.js";

let timerId = 0;
let autoStopId = 0;
let nextTarget = 0;
let phaseOn = false;
let lastOnTime = null;
let onIntervals = [];
let safetyAccepted = false;

export function getFrequency() { return Number($("frequencyRange").value); }

function formatFrequency(hz) {
  return Math.abs(hz * 10 - Math.round(hz * 10)) < 0.0001 ? hz.toFixed(1) : hz.toFixed(2);
}

function timing() {
  const period = 1000 / getFrequency();
  const mode = $("timingMode").value;
  let onTime = mode === "duty" ? period * Number($("dutySelect").value) / 100 : Number($("onTimeInput").value);
  onTime = Math.max(1, Math.min(onTime, Math.max(1, period - 1)));
  return { period, onTime, offTime: Math.max(1, period - onTime) };
}

export function updateTimingUI() {
  const hz = getFrequency();
  const { period, onTime, offTime } = timing();
  $("frequencyDisplay").innerHTML = `${formatFrequency(hz)} <small>Hz</small>`;
  $("periodValue").textContent = `${period.toFixed(1)} ms`;
  $("onTimeValue").textContent = `${onTime.toFixed(1)} ms`;
  $("offTimeValue").textContent = `${offTime.toFixed(1)} ms`;
  $("targetHz").textContent = `${formatFrequency(hz)} Hz`;
  $("targetPeriod").textContent = `${period.toFixed(2)} ms`;
}

export function setFrequency(value) {
  const clamped = Math.max(0.5, Math.min(60, Math.round(value * 100) / 100));
  $("frequencyRange").value = String(clamped);
  updateTimingUI();
}

function updateMeasurement() {
  const samples = onIntervals.slice(-200);
  if (!samples.length) return;
  const average = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const variance = samples.reduce((sum, value) => sum + (value - average) ** 2, 0) / samples.length;
  const deviation = Math.sqrt(variance);
  const measured = 1000 / average;
  const error = ((measured - getFrequency()) / getFrequency()) * 100;
  $("averagePeriod").textContent = `${average.toFixed(2)} ms`;
  $("minimumPeriod").textContent = `${min.toFixed(2)} ms`;
  $("maximumPeriod").textContent = `${max.toFixed(2)} ms`;
  $("standardDeviation").textContent = `${deviation.toFixed(2)} ms`;
  $("measuredHz").textContent = `${measured.toFixed(2)} Hz`;
  $("frequencyError").textContent = `${error.toFixed(1)} %`;
  $("sampleCount").textContent = String(samples.length);
  $("intervalHistory").textContent = samples.slice(-30).map((value) => value.toFixed(2)).join(", ");
}

async function runPhase() {
  if (!state.strobeRunning) return;
  if (!state.track || state.track.readyState !== "live") {
    log("Strobe stopped: camera track ended");
    await stopStrobe("track ended");
    return;
  }
  phaseOn = !phaseOn;
  const actualStart = performance.now();
  const result = await setTorch(phaseOn, "strobe");
  if (!state.strobeRunning) return;
  if (phaseOn) {
    if (lastOnTime !== null) {
      onIntervals.push(actualStart - lastOnTime);
      if (onIntervals.length > 200) onIntervals.shift();
      updateMeasurement();
    }
    lastOnTime = actualStart;
  }
  if (!result.ok) {
    state.strobeResult = "failed";
    await stopStrobe("Torch API error");
    return;
  }
  const { onTime, offTime } = timing();
  nextTarget += phaseOn ? onTime : offTime;
  // performance.now()基準の目標時刻へ毎回補正し、setIntervalの誤差蓄積を避ける。
  timerId = window.setTimeout(runPhase, Math.max(0, nextTarget - performance.now()));
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) { log("Wake Lock not supported"); return; }
  try {
    // 画面消灯によるタイマー停止を軽減する。Safariでは利用不可・解除される場合がある。
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLockActive = true;
    $("wakeLockCapability").textContent = "ACTIVE";
    state.wakeLock.addEventListener("release", () => { state.wakeLockActive = false; $("wakeLockCapability").textContent = "RELEASED"; log("Wake Lock released"); });
    log("Wake Lock acquired");
  } catch (error) { log("Wake Lock request failed", error); }
}

async function releaseWakeLock() {
  if (state.wakeLock) {
    try { await state.wakeLock.release(); } catch (error) { log("Wake Lock release failed", error); }
  }
  state.wakeLock = null;
  state.wakeLockActive = false;
}

export async function startStrobe() {
  if (state.strobeRunning) return;
  if (!state.cameraStarted || !state.torchSupported) {
    message("ストロボを開始できません。カメラ起動とTorch対応を確認してください。", true);
    log("Strobe start rejected: camera/torch unavailable");
    return;
  }
  state.strobeRunning = true;
  state.strobeResult = "running";
  phaseOn = false;
  lastOnTime = null;
  onIntervals = [];
  nextTarget = performance.now();
  $("sampleCount").textContent = "0";
  $("intervalHistory").textContent = "--";
  setBadge("strobeBadge", "動作中", "live");
  log(`Strobe start ${getFrequency().toFixed(2)}Hz mode=${$("timingMode").value}`);
  message("ストロボ点滅命令を実行しています。実測値はJavaScript/APIの実行周期です。");
  await requestWakeLock();
  const seconds = Number($("autoStopSelect").value);
  if (seconds > 0) autoStopId = window.setTimeout(() => stopStrobe(`auto stop ${seconds}s`), seconds * 1000);
  runPhase();
}

export async function stopStrobe(reason = "manual") {
  const wasRunning = state.strobeRunning;
  state.strobeRunning = false;
  clearTimeout(timerId);
  clearTimeout(autoStopId);
  timerId = 0;
  autoStopId = 0;
  if (wasRunning) {
    state.strobeResult = reason.includes("error") ? "failed" : "success";
    log(`Strobe stop reason=${reason}`);
  }
  phaseOn = false;
  setBadge("strobeBadge", "停止中");
  if (state.track?.readyState === "live" && state.torchSupported) await setTorch(false, "strobe-stop");
  await releaseWakeLock();
}

export function requestSafeStart() {
  if (safetyAccepted) return startStrobe();
  $("safetyDialog").showModal();
}

export function acceptSafety() {
  safetyAccepted = true;
  $("safetyDialog").close();
  startStrobe();
}
