import { $, state, log, message, setBadge, safeJson, formatError } from "./core.js";

function readTrackData() {
  if (!state.track) return;
  const settings = typeof state.track.getSettings === "function" ? state.track.getSettings() : {};
  const constraints = typeof state.track.getConstraints === "function" ? state.track.getConstraints() : {};
  let capabilities = {};
  if (typeof state.track.getCapabilities === "function") {
    try { capabilities = state.track.getCapabilities(); }
    catch (error) { log("getCapabilities failed", error); }
  }

  // Safari/端末ごとの差を切り分けるため、各APIとtorchプロパティを別々に判定する。
  const hasTorchProperty = Object.prototype.hasOwnProperty.call(capabilities, "torch");
  state.torchSupported = Boolean(
    typeof state.track.getCapabilities === "function" &&
    hasTorchProperty && capabilities.torch &&
    typeof state.track.applyConstraints === "function"
  );

  $("trackLabel").textContent = state.track.label || "(empty)";
  $("trackReadyState").textContent = state.track.readyState;
  $("trackFlags").textContent = `${state.track.enabled} / ${state.track.muted}`;
  $("trackFacingMode").textContent = settings.facingMode ?? "取得不可";
  $("trackResolution").textContent = settings.width && settings.height ? `${settings.width}x${settings.height}` : "取得不可";
  $("trackFrameRate").textContent = settings.frameRate ?? "取得不可";
  $("capabilitiesJson").textContent = safeJson(capabilities);
  $("settingsJson").textContent = safeJson(settings);
  $("constraintsJson").textContent = safeJson(constraints);
  $("torchCapability").textContent = state.torchSupported ? "YES" : "NO";
  $("torchSupportedValue").textContent = state.torchSupported ? "YES" : "NO";
  setBadge("torchBadge", state.torchSupported ? "対応" : "非対応", state.torchSupported ? "live" : "error");
  log(`getCapabilities=${typeof state.track.getCapabilities === "function"} torchProperty=${hasTorchProperty} torch=${String(capabilities.torch)} applyConstraints=${typeof state.track.applyConstraints === "function"}`);
}

export function refreshTrackState() {
  if (!state.track) return;
  const settings = typeof state.track.getSettings === "function" ? state.track.getSettings() : {};
  state.torchActual = typeof settings.torch === "boolean" ? settings.torch : null;
  $("torchActualValue").textContent = state.torchActual === null ? "取得不可" : String(state.torchActual);
  $("settingsJson").textContent = safeJson(settings);
  $("trackReadyState").textContent = state.track.readyState;
}

export async function startCamera(includeAudio) {
  if (state.cameraStarted) return;
  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    message("カメラにはHTTPS環境が必要です。Technical: insecure context", true);
    log("Camera unavailable: insecure context");
    return;
  }
  if (!navigator.mediaDevices) {
    message("このブラウザはmediaDevicesに対応していません。", true);
    log("Camera unavailable: navigator.mediaDevices missing");
    return;
  }
  if (typeof navigator.mediaDevices.getUserMedia !== "function") {
    message("このブラウザはgetUserMediaに対応していません。", true);
    log("Camera unavailable: getUserMedia missing");
    return;
  }

  setBadge("cameraBadge", "要求中", "loading");
  log(`Camera request audio=${includeAudio}`);
  try {
    // 背面カメラを優先するが、ideal指定にして端末差でページ全体が失敗しないようにする。
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: includeAudio });
    state.track = state.stream.getVideoTracks()[0] || null;
    if (!state.track) throw new Error("Video track was not returned");
    state.cameraStarted = true;
    $("cameraPreview").srcObject = state.stream;
    $("previewFallback").hidden = true;
    $("cameraStatus").textContent = "READY";
    $("startCameraButton").disabled = true;
    $("stopCameraButton").disabled = false;
    setBadge("cameraBadge", "起動中", "live");
    state.track.addEventListener("ended", () => {
      log("Camera track ended");
      if (state.strobeRunning) document.dispatchEvent(new CustomEvent("track-ended"));
      resetCameraUI();
    }, { once: true });
    readTrackData();
    message(state.torchSupported ? "カメラを開始しました。Torch APIに対応しています。" : "カメラを開始しました。Torch APIはこの端末では利用できません。", !state.torchSupported);
    log(`Camera started label=${state.track.label || "(empty)"}`);
  } catch (error) {
    setBadge("cameraBadge", "失敗", "error");
    const denied = error.name === "NotAllowedError";
    message(`${denied ? "カメラ権限が拒否されました。設定を確認してください。" : "背面カメラの開始に失敗しました。"} Technical: ${formatError(error)}`, true);
    log("Camera start failed", error);
  }
}

function resetCameraUI() {
  state.cameraStarted = false;
  state.track = null;
  state.stream = null;
  state.torchSupported = false;
  state.torchActual = null;
  $("cameraPreview").srcObject = null;
  $("previewFallback").hidden = false;
  $("cameraStatus").textContent = "IDLE";
  $("torchCapability").textContent = "--";
  $("torchSupportedValue").textContent = "--";
  $("torchActualValue").textContent = "取得不可";
  $("startCameraButton").disabled = false;
  $("stopCameraButton").disabled = true;
  setBadge("cameraBadge", "未起動");
  setBadge("torchBadge", "待機中");
}

export async function setTorch(on, source = "manual") {
  if (!state.track || state.track.readyState !== "live") {
    const error = new Error("Camera track is not live");
    message("ライトを制御できません。先にカメラを開始してください。 Technical: track not live", true);
    log(`Torch ${on ? "ON" : "OFF"} failed source=${source}`, error);
    return { ok: false, latency: null, error };
  }
  if (!state.torchSupported) {
    const error = new Error("Torch capability is unavailable");
    message("Torch APIはこの端末では利用できません。", true);
    log(`Torch ${on ? "ON" : "OFF"} unavailable source=${source}`);
    return { ok: false, latency: null, error };
  }

  state.torchRequested = on;
  $("torchRequestedValue").textContent = on ? "ON" : "OFF";
  log(`Torch ${on ? "ON" : "OFF"} request source=${source}`);
  const started = performance.now();
  try {
    // iPhone Safariのtorch制御はVideoTrackへのadvanced constraintとして要求する。
    await state.track.applyConstraints({ advanced: [{ torch: on }] });
    const latency = performance.now() - started;
    state.torchResult = "成功";
    if (on) { state.torchOnLatency = latency; state.torchOnResult = "success"; $("torchOnLatency").textContent = `${latency.toFixed(1)} ms`; }
    else { state.torchOffLatency = latency; state.torchOffResult = "success"; $("torchOffLatency").textContent = `${latency.toFixed(1)} ms`; }
    $("torchResultValue").textContent = "成功";
    refreshTrackState();
    log(`Torch ${on ? "ON" : "OFF"} success ${latency.toFixed(1)}ms source=${source}`);
    return { ok: true, latency };
  } catch (error) {
    const latency = performance.now() - started;
    state.torchResult = "失敗";
    if (on) state.torchOnResult = "failed"; else state.torchOffResult = "failed";
    $("torchResultValue").textContent = "失敗";
    message(`ライトの制御に失敗しました。このiPhone / SafariではTorch APIを利用できない可能性があります。 Technical: ${formatError(error)}`, true);
    log(`Torch ${on ? "ON" : "OFF"} failed ${latency.toFixed(1)}ms source=${source}`, error);
    return { ok: false, latency, error };
  }
}

export async function stopCamera() {
  if (!state.stream) { resetCameraUI(); return; }
  log("Camera stop request");
  state.stream.getTracks().forEach((track) => track.stop());
  resetCameraUI();
  message("カメラを停止し、MediaStream trackを解放しました。");
}
