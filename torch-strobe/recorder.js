import { $, state, log, message, setBadge, formatError } from "./core.js";

let chunks = [];
let timerId = 0;
let startedAt = 0;
let videoUrl = "";

const MIME_CANDIDATES = ["video/mp4;codecs=h264", "video/mp4", "video/webm;codecs=vp8", "video/webm"];

export function detectRecorderSupport() {
  const supported = typeof MediaRecorder !== "undefined";
  $("recorderCapability").textContent = supported ? "YES" : "NO";
  if (!supported) { $("mimeStatus").textContent = "MediaRecorder : Not Supported"; return; }
  state.selectedMimeType = MIME_CANDIDATES.find((type) => {
    try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
  }) || "";
  // Safariが報告する対応形式から選び、WebMへ固定しない。
  $("mimeStatus").textContent = `MediaRecorder : Supported / MIME: ${state.selectedMimeType || "browser default"}`;
  log(`MediaRecorder supported MIME=${state.selectedMimeType || "browser default"}`);
}

function updateClock() {
  if (!state.recording) return;
  const seconds = (performance.now() - startedAt) / 1000;
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(1).padStart(4, "0");
  const text = `${String(minutes).padStart(2, "0")}:${rest}`;
  $("recordingTime").textContent = text;
  $("recordingOverlayTime").textContent = text;
  timerId = requestAnimationFrame(updateClock);
}

export function startRecording() {
  if (state.recording) return;
  if (!state.stream || !state.cameraStarted) {
    message("録画を開始できません。先にカメラを開始してください。", true);
    log("Recorder start rejected: no camera stream");
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    message("このブラウザはMediaRecorderに対応していません。", true);
    log("Recorder start rejected: MediaRecorder unavailable");
    return;
  }
  try {
    chunks = [];
    const options = state.selectedMimeType ? { mimeType: state.selectedMimeType } : undefined;
    state.recorder = new MediaRecorder(state.stream, options);
    state.recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) chunks.push(event.data); });
    state.recorder.addEventListener("stop", finalizeRecording, { once: true });
    state.recorder.addEventListener("error", (event) => log("Recorder error", event.error));
    state.recorder.start(500);
    state.recording = true;
    if (state.torchRequested) state.recordingWhileTorch = "started while torch requested ON";
    startedAt = performance.now();
    $("recordingOverlay").hidden = false;
    $("startRecordingButton").disabled = true;
    $("stopRecordingButton").disabled = false;
    setBadge("recordingBadge", "● REC", "error");
    updateClock();
    log(`Recorder start torchRequested=${state.torchRequested} strobe=${state.strobeRunning}`);
  } catch (error) {
    message(`録画開始に失敗しました。 Technical: ${formatError(error)}`, true);
    log("Recorder start failed", error);
  }
}

export function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  cancelAnimationFrame(timerId);
  if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  $("recordingOverlay").hidden = true;
  $("startRecordingButton").disabled = false;
  $("stopRecordingButton").disabled = true;
  setBadge("recordingBadge", "停止中");
  log(`Recorder stop torchRequested=${state.torchRequested} strobe=${state.strobeRunning}`);
}

function finalizeRecording() {
  const type = state.recorder?.mimeType || state.selectedMimeType || "video/mp4";
  const blob = new Blob(chunks, { type });
  deleteRecording();
  videoUrl = URL.createObjectURL(blob);
  $("recordedVideo").src = videoUrl;
  $("saveVideoLink").href = videoUrl;
  $("saveVideoLink").download = `torch-strobe-${new Date().toISOString().replace(/[:.]/g,"-")}.${type.includes("webm") ? "webm" : "mp4"}`;
  $("recordedArea").hidden = false;
  log(`Recording ready size=${blob.size} type=${type}`);
}

export function deleteRecording() {
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = "";
  $("recordedVideo").removeAttribute("src");
  $("recordedVideo").load();
  $("recordedArea").hidden = true;
}
