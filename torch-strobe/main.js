import { $, state, log, message, copyText, browserDetails } from "./core.js";
import { startCamera, stopCamera, setTorch } from "./camera.js";
import { detectRecorderSupport, startRecording, stopRecording, deleteRecording } from "./recorder.js";
import { getFrequency, setFrequency, updateTimingUI, requestSafeStart, acceptSafety, stopStrobe } from "./strobe.js";

async function switchToSteady(on, source) {
  if (state.strobeRunning) await stopStrobe(`${source} selected`);
  const result = await setTorch(on, source);
  if (result.ok) message(`${on ? "Torch ON" : "Torch OFF"} 成功（${result.latency.toFixed(1)}ms）`);
  if (state.recording) state.recordingWhileTorch = result.ok ? `torch ${on ? "ON" : "OFF"} changed while recording` : "torch change failed while recording";
}

async function stopEverything() {
  if (state.recording) stopRecording();
  await stopStrobe("camera stop");
  await stopCamera();
}

function buildResult() {
  return [
    "iPhone Sensor Laboratory",
    "Torch / Strobe Test Result",
    "",
    `Date: ${new Date().toISOString()}`,
    `UserAgent: ${navigator.userAgent}`,
    `Secure context: ${window.isSecureContext}`,
    "",
    `Camera: ${$("trackFacingMode").textContent}`,
    `Resolution: ${$("trackResolution").textContent}`,
    `Torch capability: ${state.torchSupported}`,
    `Torch ON: ${state.torchOnResult}`,
    `Torch OFF: ${state.torchOffResult}`,
    `Torch ON API: ${state.torchOnLatency?.toFixed(1) ?? "--"}ms`,
    `Torch OFF API: ${state.torchOffLatency?.toFixed(1) ?? "--"}ms`,
    `MediaRecorder: ${typeof MediaRecorder !== "undefined" ? "supported" : "not supported"}`,
    `MIME: ${state.selectedMimeType || "browser default / unavailable"}`,
    `Recording while torch ON: ${state.recordingWhileTorch}`,
    `Strobe: ${state.strobeResult}`,
    `Target: ${getFrequency().toFixed(2)}Hz`,
    `Measured: ${$("measuredHz").textContent}`,
    `Average Interval: ${$("averagePeriod").textContent}`,
    `Min / Max / StdDev: ${$("minimumPeriod").textContent} / ${$("maximumPeriod").textContent} / ${$("standardDeviation").textContent}`,
    `Samples: ${$("sampleCount").textContent}`,
  ].join("\n");
}

function bindEvents() {
  $("startCameraButton").addEventListener("click", () => startCamera($("audioEnabled").checked));
  $("stopCameraButton").addEventListener("click", stopEverything);
  $("torchOnButton").addEventListener("click", () => switchToSteady(true, "manual"));
  $("torchOffButton").addEventListener("click", () => switchToSteady(false, "manual"));
  $("continuousOnButton").addEventListener("click", () => switchToSteady(true, "continuous"));
  $("continuousOffButton").addEventListener("click", () => switchToSteady(false, "continuous"));
  $("startStrobeButton").addEventListener("click", requestSafeStart);
  $("stopStrobeButton").addEventListener("click", () => stopStrobe("manual"));
  $("acceptSafetyButton").addEventListener("click", acceptSafety);
  $("cancelSafetyButton").addEventListener("click", () => $("safetyDialog").close());
  $("startRecordingButton").addEventListener("click", startRecording);
  $("stopRecordingButton").addEventListener("click", stopRecording);
  $("deleteVideoButton").addEventListener("click", deleteRecording);

  $("frequencyRange").addEventListener("input", updateTimingUI);
  document.querySelectorAll("[data-delta]").forEach((button) => button.addEventListener("click", () => setFrequency(getFrequency() + Number(button.dataset.delta))));
  $("timingMode").addEventListener("change", () => {
    const duty = $("timingMode").value === "duty";
    $("dutyField").hidden = !duty;
    $("onTimeField").hidden = duty;
    updateTimingUI();
  });
  $("dutySelect").addEventListener("change", updateTimingUI);
  $("onTimeInput").addEventListener("input", updateTimingUI);
  [1,2,5,10,15,20,25,30,40,50,60].forEach((hz) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${hz}Hz`;
    button.addEventListener("click", () => setFrequency(hz));
    $("presetButtons").appendChild(button);
  });

  $("copyLogButton").addEventListener("click", async () => message(await copyText(state.logs.join("\n")) ? "Debugログをコピーしました。" : "Debugログをコピーできませんでした。", false));
  $("clearLogButton").addEventListener("click", () => { state.logs.length = 0; $("debugLog").textContent = ""; log("Log cleared"); });
  $("copyResultButton").addEventListener("click", async () => message(await copyText(buildResult()) ? "検証結果をコピーしました。" : "検証結果をコピーできませんでした。"));
  $("dropModeButton").addEventListener("click", () => {
    document.body.classList.toggle("drop-mode");
    const active = document.body.classList.contains("drop-mode");
    $("dropModeButton").setAttribute("aria-pressed", String(active));
    $("dropModeButton").textContent = active ? "通常モードへ戻る" : "水滴実験モード";
  });
}

function initialize() {
  $("browserInfo").textContent = browserDetails();
  $("wakeLockCapability").textContent = "wakeLock" in navigator ? "SUPPORTED" : "NOT SUPPORTED";
  if (!window.isSecureContext) message("このページは安全なコンテキストではありません。カメラ/TorchはHTTPSでテストしてください。", true);
  detectRecorderSupport();
  updateTimingUI();
  bindEvents();
  log(`Page ready secureContext=${window.isSecureContext}`);
  log(`Device ${browserDetails()}`);
}

// iPhone Safariでは非表示中にタイマー精度が大幅に低下するため、安全側で停止する。
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.strobeRunning) {
    log("Page hidden -> Strobe stopped");
    stopStrobe("page hidden");
  }
});

document.addEventListener("track-ended", () => {
  if (state.recording) stopRecording();
  stopStrobe("track ended");
});

// pagehideでは非同期完了を期待せず、残存タイマーとMediaStreamを可能な範囲で解放する。
window.addEventListener("pagehide", () => {
  if (state.recording) stopRecording();
  stopStrobe("pagehide");
  state.stream?.getTracks().forEach((track) => track.stop());
});

initialize();
