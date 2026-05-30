import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";

const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17], [0, 9], [5, 17]
];

const FINGER_LABELS = {
  thumb: "親指",
  index: "人差し指",
  middle: "中指",
  ring: "薬指",
  pinky: "小指"
};

const ui = {
  globalStatus: document.getElementById("globalStatus"),
  startAllButton: document.getElementById("startAllButton"),
  startHandButton: document.getElementById("startHandButton"),
  stopHandButton: document.getElementById("stopHandButton"),

  handVideo: document.getElementById("handVideo"),
  handCanvas: document.getElementById("handCanvas"),
  handStatusBadge: document.getElementById("handStatusBadge"),
  handStatusMessage: document.getElementById("handStatusMessage"),
  handResults: document.getElementById("handResults"),
  fpsChip: document.getElementById("fpsChip"),
  handCountChip: document.getElementById("handCountChip"),

  cameraButton: document.getElementById("cameraButton"),
  cameraPreview: document.getElementById("cameraPreview"),
  cameraFallback: document.getElementById("cameraFallback"),
  cameraState: document.getElementById("cameraState"),

  motionButton: document.getElementById("motionButton"),
  motionState: document.getElementById("motionState"),
  alphaValue: document.getElementById("alphaValue"),
  betaValue: document.getElementById("betaValue"),
  gammaValue: document.getElementById("gammaValue"),
  accelXValue: document.getElementById("accelXValue"),
  accelYValue: document.getElementById("accelYValue"),
  accelZValue: document.getElementById("accelZValue"),
  accelGValue: document.getElementById("accelGValue"),
  motionIntervalValue: document.getElementById("motionIntervalValue"),

  locationButton: document.getElementById("locationButton"),
  locationState: document.getElementById("locationState"),
  latitudeValue: document.getElementById("latitudeValue"),
  longitudeValue: document.getElementById("longitudeValue"),
  accuracyValue: document.getElementById("accuracyValue"),
  altitudeValue: document.getElementById("altitudeValue"),
  speedValue: document.getElementById("speedValue"),
  locationModeValue: document.getElementById("locationModeValue"),

  screenState: document.getElementById("screenState"),
  screenOrientationValue: document.getElementById("screenOrientationValue"),
  screenAngleValue: document.getElementById("screenAngleValue"),
  windowSizeValue: document.getElementById("windowSizeValue"),
  pixelRatioValue: document.getElementById("pixelRatioValue"),

  languageValue: document.getElementById("languageValue"),
  secureContextValue: document.getElementById("secureContextValue"),
  uaValue: document.getElementById("uaValue")
};

const handCtx = ui.handCanvas.getContext("2d");

let rearCameraStream = null;
let locationWatchId = null;
let motionStarted = false;

let handLandmarker = null;
let handStream = null;
let handRafId = 0;
let lastVideoTime = -1;
let lastFrameAt = 0;
let smoothedFps = 0;

function setText(element, value) {
  element.textContent = value ?? "-";
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function formatMeters(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} m` : "-";
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} m/s` : "-";
}

function setBadge(element, text, kind = "default") {
  element.className = `status-badge${kind === "default" ? "" : ` ${kind}`}`;
  element.textContent = text;
}

function setGlobalStatus(message) {
  ui.globalStatus.textContent = message;
}

function setHandStatus(kind, badgeText, message) {
  setBadge(ui.handStatusBadge, badgeText, kind);
  ui.handStatusMessage.textContent = message;
}

function isSecureEnough() {
  return window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function populateStaticInfo() {
  setText(ui.languageValue, navigator.language);
  setText(ui.secureContextValue, window.isSecureContext ? "yes" : "no");
  setText(ui.uaValue, navigator.userAgent);
}

function updateScreenInfo() {
  const orientation = screen.orientation?.type ?? `${window.orientation ?? 0}`;
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;

  setText(ui.screenOrientationValue, String(orientation));
  setText(ui.screenAngleValue, `${angle}°`);
  setText(ui.windowSizeValue, `${window.innerWidth} x ${window.innerHeight}`);
  setText(ui.pixelRatioValue, formatNumber(window.devicePixelRatio, 2));
}

async function startRearCamera() {
  if (rearCameraStream) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setBadge(ui.cameraState, "非対応", "error");
    setGlobalStatus("このブラウザはカメラ API に対応していません。");
    return;
  }

  try {
    rearCameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });
    ui.cameraPreview.srcObject = rearCameraStream;
    ui.cameraFallback.hidden = true;
    setBadge(ui.cameraState, "動作中", "live");
    setGlobalStatus("カメラ映像表示を開始しました。");
  } catch (error) {
    setBadge(ui.cameraState, "失敗", "error");
    setGlobalStatus(`カメラ開始に失敗しました: ${error.message}`);
  }
}

function bindMotionListeners() {
  if (motionStarted) {
    return;
  }

  window.addEventListener("deviceorientation", (event) => {
    setText(ui.alphaValue, formatNumber(event.alpha));
    setText(ui.betaValue, formatNumber(event.beta));
    setText(ui.gammaValue, formatNumber(event.gamma));
  });

  window.addEventListener("devicemotion", (event) => {
    const accel = event.acceleration ?? {};
    const accelG = event.accelerationIncludingGravity ?? {};

    setText(ui.accelXValue, formatNumber(accel.x, 3));
    setText(ui.accelYValue, formatNumber(accel.y, 3));
    setText(ui.accelZValue, formatNumber(accel.z, 3));
    setText(
      ui.accelGValue,
      `x:${formatNumber(accelG.x, 2)} y:${formatNumber(accelG.y, 2)} z:${formatNumber(accelG.z, 2)}`
    );
    setText(ui.motionIntervalValue, Number.isFinite(event.interval) ? `${event.interval} ms` : "-");
  });

  motionStarted = true;
}

async function startMotion() {
  try {
    const orientationPermission = window.DeviceOrientationEvent?.requestPermission;
    if (typeof orientationPermission === "function") {
      const orientationResult = await orientationPermission();
      if (orientationResult !== "granted") {
        setBadge(ui.motionState, "拒否", "error");
        setGlobalStatus("傾きセンサーの権限が拒否されました。");
        return;
      }
    }

    const motionPermission = window.DeviceMotionEvent?.requestPermission;
    if (typeof motionPermission === "function") {
      const motionResult = await motionPermission();
      if (motionResult !== "granted") {
        setBadge(ui.motionState, "拒否", "error");
        setGlobalStatus("加速度センサーの権限が拒否されました。");
        return;
      }
    }

    bindMotionListeners();
    setBadge(ui.motionState, "動作中", "live");
    setGlobalStatus("傾き・加速度の監視を開始しました。");
  } catch (error) {
    setBadge(ui.motionState, "失敗", "error");
    setGlobalStatus(`モーション開始に失敗しました: ${error.message}`);
  }
}

function startLocation() {
  if (!navigator.geolocation) {
    setBadge(ui.locationState, "非対応", "error");
    setGlobalStatus("このブラウザは位置情報 API に対応していません。");
    return;
  }

  if (locationWatchId) {
    return;
  }

  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy, altitude, speed } = position.coords;
      setText(ui.latitudeValue, formatNumber(latitude, 6));
      setText(ui.longitudeValue, formatNumber(longitude, 6));
      setText(ui.accuracyValue, formatMeters(accuracy));
      setText(ui.altitudeValue, formatMeters(altitude));
      setText(ui.speedValue, formatSpeed(speed));
      setBadge(ui.locationState, "動作中", "live");
      setGlobalStatus("GPS の監視を開始しました。");
    },
    (error) => {
      setBadge(ui.locationState, "失敗", "error");
      setGlobalStatus(`GPS 開始に失敗しました: ${error.message}`);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );
}

function setHandEmpty(message) {
  ui.handResults.innerHTML = `<p class="empty-state">${message}</p>`;
}

async function ensureHandLandmarker() {
  if (handLandmarker) {
    return handLandmarker;
  }

  setHandStatus("loading", "準備中", "モデル読み込み中...");
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_ASSET_PATH },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5
  });
  return handLandmarker;
}

function getHandConstraints() {
  const maxHeight = Math.min(1280, Math.max(window.innerHeight * window.devicePixelRatio, 960));
  const aspectRatio = window.innerWidth / Math.max(window.innerHeight, 1);

  return {
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: Math.round(maxHeight * aspectRatio), max: 1280 },
      height: { ideal: Math.round(maxHeight), max: 1280 }
    }
  };
}

function resizeHandCanvas() {
  const width = ui.handVideo.videoWidth || 720;
  const height = ui.handVideo.videoHeight || 960;
  if (ui.handCanvas.width !== width || ui.handCanvas.height !== height) {
    ui.handCanvas.width = width;
    ui.handCanvas.height = height;
  }
}

function toCanvasPoint(landmark) {
  return {
    x: (1 - landmark.x) * ui.handCanvas.width,
    y: landmark.y * ui.handCanvas.height
  };
}

function drawHandVideoFrame() {
  handCtx.save();
  handCtx.translate(ui.handCanvas.width, 0);
  handCtx.scale(-1, 1);
  handCtx.drawImage(ui.handVideo, 0, 0, ui.handCanvas.width, ui.handCanvas.height);
  handCtx.restore();
}

function drawHandSkeleton(landmarks, handednessLabel) {
  handCtx.strokeStyle = handednessLabel === "Left" ? "#f59e0b" : "#0ea5a1";
  handCtx.lineWidth = 4;

  for (const [fromIndex, toIndex] of HAND_CONNECTIONS) {
    const from = toCanvasPoint(landmarks[fromIndex]);
    const to = toCanvasPoint(landmarks[toIndex]);
    handCtx.beginPath();
    handCtx.moveTo(from.x, from.y);
    handCtx.lineTo(to.x, to.y);
    handCtx.stroke();
  }

  for (let index = 0; index < landmarks.length; index += 1) {
    const point = toCanvasPoint(landmarks[index]);
    const radius = index === 8 ? 7 : 4.2;
    handCtx.beginPath();
    handCtx.fillStyle = index === 8 ? "#fb7185" : "#ffffff";
    handCtx.strokeStyle = "#0f172a";
    handCtx.lineWidth = 2;
    handCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    handCtx.fill();
    handCtx.stroke();
  }
}

function getFingerStates(landmarks, handednessLabel) {
  const isLeft = handednessLabel === "Left";
  const thumbExtended = isLeft ? landmarks[4].x < landmarks[3].x : landmarks[4].x > landmarks[3].x;

  return {
    thumb: thumbExtended,
    index: landmarks[8].y < landmarks[6].y,
    middle: landmarks[12].y < landmarks[10].y,
    ring: landmarks[16].y < landmarks[14].y,
    pinky: landmarks[20].y < landmarks[18].y
  };
}

function inferGesture(fingers) {
  const extendedCount = Object.values(fingers).filter(Boolean).length;

  if (Object.values(fingers).every(Boolean)) {
    return "パー";
  }
  if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky && !fingers.thumb) {
    return "ピース";
  }
  if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
    return "指差し";
  }
  if (extendedCount <= 1) {
    return "グー";
  }
  return "その他";
}

function getHandednessList(result) {
  return result?.handedness ?? result?.handednesses ?? [];
}

function renderHandResults(result) {
  const handLandmarks = result?.landmarks ?? [];
  const handednesses = getHandednessList(result);

  ui.handCountChip.textContent = `手の数: ${handLandmarks.length}`;

  if (!handLandmarks.length) {
    setHandEmpty("手をカメラに映してください");
    return;
  }

  ui.handResults.innerHTML = handLandmarks.map((landmarks, index) => {
    const handednessLabel = handednesses[index]?.[0]?.categoryName ?? "Unknown";
    const fingers = getFingerStates(landmarks, handednessLabel);
    const gesture = inferGesture(fingers);
    const fingersHtml = Object.entries(fingers)
      .map(([key, value]) => `${FINGER_LABELS[key]}: ${value ? "伸びている" : "曲がっている"}`)
      .join("<br>");

    return `
      <section class="result-item">
        <h3>手 ${index + 1} / ${handednessLabel}</h3>
        <p>${fingersHtml}</p>
        <p>推定ジェスチャー: ${gesture}</p>
      </section>
    `;
  }).join("");
}

function drawHandResult(result) {
  handCtx.clearRect(0, 0, ui.handCanvas.width, ui.handCanvas.height);
  drawHandVideoFrame();

  const handLandmarks = result?.landmarks ?? [];
  const handednesses = getHandednessList(result);

  for (let index = 0; index < handLandmarks.length; index += 1) {
    const handednessLabel = handednesses[index]?.[0]?.categoryName ?? "Unknown";
    drawHandSkeleton(handLandmarks[index], handednessLabel);
  }
}

function updateFps(now) {
  if (lastFrameAt) {
    const currentFps = 1000 / Math.max(now - lastFrameAt, 1);
    smoothedFps = smoothedFps === 0 ? currentFps : smoothedFps * 0.82 + currentFps * 0.18;
    ui.fpsChip.textContent = `FPS: ${smoothedFps.toFixed(1)}`;
  }
  lastFrameAt = now;
}

function handLoop() {
  if (!handLandmarker || ui.handVideo.readyState < 2) {
    handRafId = requestAnimationFrame(handLoop);
    return;
  }

  resizeHandCanvas();
  const now = performance.now();

  if (ui.handVideo.currentTime !== lastVideoTime) {
    try {
      lastVideoTime = ui.handVideo.currentTime;
      const result = handLandmarker.detectForVideo(ui.handVideo, now);
      drawHandResult(result);
      renderHandResults(result);
      updateFps(now);
    } catch (error) {
      setHandStatus("error", "推論エラー", `推論中にエラーが発生しました: ${error.message}`);
    }
  }

  handRafId = requestAnimationFrame(handLoop);
}

async function startHandRecognition() {
  if (!isSecureEnough()) {
    setHandStatus("error", "HTTPS必須", "iPhoneでは HTTPS 公開が必要です。localhost は例外です。");
    setHandEmpty("HTTPS 環境で開いてください");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setHandStatus("error", "非対応", "このブラウザは getUserMedia に対応していません。");
    return;
  }

  ui.startHandButton.disabled = true;

  try {
    await ensureHandLandmarker();
    handStream = await navigator.mediaDevices.getUserMedia(getHandConstraints());
    ui.handVideo.srcObject = handStream;
    ui.handVideo.autoplay = true;
    ui.handVideo.muted = true;
    ui.handVideo.playsInline = true;
    await ui.handVideo.play();

    ui.stopHandButton.disabled = false;
    setHandStatus("live", "検出中", "前面カメラで手指認識を実行中です。");
    setGlobalStatus("手指認識を開始しました。");
    cancelAnimationFrame(handRafId);
    handRafId = requestAnimationFrame(handLoop);
  } catch (error) {
    ui.startHandButton.disabled = false;
    ui.stopHandButton.disabled = true;
    const message = error?.name === "NotAllowedError"
      ? "カメラ権限が拒否されました。Safari の設定から許可してください。"
      : `手指認識開始に失敗しました: ${error.message}`;

    setHandStatus("error", "エラー", message);
    setHandEmpty(message);
  }
}

function stopHandRecognition() {
  cancelAnimationFrame(handRafId);
  handRafId = 0;
  lastVideoTime = -1;
  lastFrameAt = 0;
  smoothedFps = 0;
  ui.fpsChip.textContent = "FPS: --";
  ui.handCountChip.textContent = "手の数: 0";

  if (handStream) {
    handStream.getTracks().forEach((track) => track.stop());
    handStream = null;
  }

  ui.handVideo.pause();
  ui.handVideo.srcObject = null;
  handCtx.clearRect(0, 0, ui.handCanvas.width, ui.handCanvas.height);
  setHandEmpty("手をカメラに映してください");
  ui.startHandButton.disabled = false;
  ui.stopHandButton.disabled = true;
  setHandStatus("default", "停止中", "手指認識を停止しました。");
}

async function startAll() {
  await startRearCamera();
  await startMotion();
  startLocation();
  await startHandRecognition();
}

ui.cameraButton.addEventListener("click", startRearCamera);
ui.motionButton.addEventListener("click", startMotion);
ui.locationButton.addEventListener("click", startLocation);
ui.startHandButton.addEventListener("click", startHandRecognition);
ui.stopHandButton.addEventListener("click", stopHandRecognition);
ui.startAllButton.addEventListener("click", startAll);

window.addEventListener("orientationchange", updateScreenInfo);
window.addEventListener("resize", updateScreenInfo);

populateStaticInfo();
updateScreenInfo();
setHandEmpty("手をカメラに映してください");
setGlobalStatus("メニューから機能を選ぶか、下のボタンでまとめて起動してください。");
