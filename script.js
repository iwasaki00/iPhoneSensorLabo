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
  [0, 17], [0, 9],
  [5, 17]
];

const FINGER_LABELS = {
  thumb: "親指",
  index: "人差し指",
  middle: "中指",
  ring: "薬指",
  pinky: "小指"
};

const video = document.getElementById("cameraVideo");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const statusBadge = document.getElementById("statusBadge");
const fpsChip = document.getElementById("fpsChip");
const handCountChip = document.getElementById("handCountChip");
const sensorStateChip = document.getElementById("sensorStateChip");
const statusMessage = document.getElementById("statusMessage");
const resultsContainer = document.getElementById("resultsContainer");

const alphaValue = document.getElementById("alphaValue");
const betaValue = document.getElementById("betaValue");
const gammaValue = document.getElementById("gammaValue");
const accelValue = document.getElementById("accelValue");
const screenOrientationValue = document.getElementById("screenOrientationValue");
const screenAngleValue = document.getElementById("screenAngleValue");
const windowSizeValue = document.getElementById("windowSizeValue");
const pixelRatioValue = document.getElementById("pixelRatioValue");

let handLandmarker = null;
let mediaStream = null;
let animationFrameId = 0;
let lastVideoTime = -1;
let lastFrameAt = 0;
let fps = 0;

function getHandednessList(result) {
  return result?.handedness ?? result?.handednesses ?? [];
}

function updateStatus(kind, badgeText, message) {
  statusBadge.className = `status-badge ${kind}`;
  statusBadge.textContent = badgeText;
  statusMessage.textContent = message;
}

function setEmptyResult(message) {
  resultsContainer.innerHTML = `<p class="empty-result">${message}</p>`;
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function updateSensorPanel() {
  const orientation = screen.orientation?.type ?? window.orientation ?? "-";
  const angle = screen.orientation?.angle ?? window.orientation ?? "-";
  screenOrientationValue.textContent = String(orientation);
  screenAngleValue.textContent = String(angle);
  windowSizeValue.textContent = `${window.innerWidth} x ${window.innerHeight}`;
  pixelRatioValue.textContent = formatNumber(window.devicePixelRatio, 2);
}

function attachSensorListeners() {
  updateSensorPanel();
  window.addEventListener("resize", updateSensorPanel);
  screen.orientation?.addEventListener?.("change", updateSensorPanel);

  window.addEventListener("deviceorientation", (event) => {
    alphaValue.textContent = formatNumber(event.alpha);
    betaValue.textContent = formatNumber(event.beta);
    gammaValue.textContent = formatNumber(event.gamma);
  });

  window.addEventListener("devicemotion", (event) => {
    const accel = event.accelerationIncludingGravity;
    if (!accel) {
      accelValue.textContent = "-";
      return;
    }
    accelValue.textContent =
      `x:${formatNumber(accel.x)} y:${formatNumber(accel.y)} z:${formatNumber(accel.z)}`;
  });
}

function isSecureEnough() {
  return window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

async function ensureHandLandmarker() {
  if (handLandmarker) {
    return handLandmarker;
  }

  updateStatus("loading", "準備中", "モデル読み込み中...");

  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_ASSET_PATH
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5
  });

  return handLandmarker;
}

function getIdealVideoConstraints() {
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

function resizeCanvasToVideo() {
  const width = video.videoWidth || 720;
  const height = video.videoHeight || 960;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function toPixel(landmark) {
  return {
    x: (1 - landmark.x) * canvas.width,
    y: landmark.y * canvas.height
  };
}

function drawVideoFrame() {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawHand(landmarks, handednessLabel) {
  ctx.lineWidth = 4;
  ctx.strokeStyle = handednessLabel === "Left" ? "#f59e0b" : "#0ea5a1";
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";

  for (const [fromIndex, toIndex] of HAND_CONNECTIONS) {
    const from = toPixel(landmarks[fromIndex]);
    const to = toPixel(landmarks[toIndex]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  for (let index = 0; index < landmarks.length; index += 1) {
    const point = toPixel(landmarks[index]);
    const radius = index === 8 ? 7 : 4.2;
    ctx.beginPath();
    ctx.fillStyle = index === 8 ? "#fb7185" : "#f8fafc";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function getFingerStates(landmarks, handednessLabel) {
  const isLeft = handednessLabel === "Left";
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const thumbExtended = isLeft ? thumbTip.x < thumbIp.x : thumbTip.x > thumbIp.x;

  return {
    thumb: thumbExtended,
    index: landmarks[8].y < landmarks[6].y,
    middle: landmarks[12].y < landmarks[10].y,
    ring: landmarks[16].y < landmarks[14].y,
    pinky: landmarks[20].y < landmarks[18].y
  };
}

function inferGesture(fingers) {
  const values = Object.values(fingers);
  const extendedCount = values.filter(Boolean).length;

  if (values.every(Boolean)) {
    return "パー";
  }

  if (extendedCount <= 1) {
    return fingers.index ? "指差し" : "グー";
  }

  if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky && !fingers.thumb) {
    return "ピース";
  }

  if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
    return "指差し";
  }

  return "その他";
}

function renderResults(result) {
  const handLandmarks = result?.landmarks ?? [];
  const handednesses = getHandednessList(result);

  handCountChip.textContent = `手の数: ${handLandmarks.length}`;

  if (!handLandmarks.length) {
    setEmptyResult("手をカメラに映してください");
    return;
  }

  const html = handLandmarks.map((landmarks, index) => {
    const handednessLabel = handednesses[index]?.[0]?.categoryName ?? "Unknown";
    const fingers = getFingerStates(landmarks, handednessLabel);
    const gesture = inferGesture(fingers);
    const fingerText = Object.entries(fingers)
      .map(([key, value]) => `${FINGER_LABELS[key]}: ${value ? "伸びている" : "曲がっている"}`)
      .join("<br>");

    return `
      <section class="result-item">
        <h3>手 ${index + 1} / ${handednessLabel}</h3>
        <p>${fingerText}</p>
        <p>推定ジェスチャー: ${gesture}</p>
      </section>
    `;
  }).join("");

  resultsContainer.innerHTML = html;
}

function drawFrame(result) {
  clearCanvas();
  drawVideoFrame();

  const handLandmarks = result?.landmarks ?? [];
  const handednesses = getHandednessList(result);
  for (let index = 0; index < handLandmarks.length; index += 1) {
    const handednessLabel = handednesses[index]?.[0]?.categoryName ?? "Unknown";
    drawHand(handLandmarks[index], handednessLabel);
  }
}

function updateFps(now) {
  if (lastFrameAt) {
    const instantaneousFps = 1000 / Math.max(now - lastFrameAt, 1);
    fps = fps === 0 ? instantaneousFps : fps * 0.82 + instantaneousFps * 0.18;
    fpsChip.textContent = `FPS: ${fps.toFixed(1)}`;
  }
  lastFrameAt = now;
}

function detectLoop() {
  if (!handLandmarker || video.readyState < 2) {
    animationFrameId = requestAnimationFrame(detectLoop);
    return;
  }

  resizeCanvasToVideo();
  const now = performance.now();

  if (video.currentTime !== lastVideoTime) {
    try {
      lastVideoTime = video.currentTime;
      const result = handLandmarker.detectForVideo(video, now);
      drawFrame(result);
      renderResults(result);
      updateFps(now);
    } catch (error) {
      updateStatus("error", "推論エラー", `推論中にエラーが発生しました: ${error?.message ?? error}`);
    }
  }

  animationFrameId = requestAnimationFrame(detectLoop);
}

async function startCamera() {
  if (!isSecureEnough()) {
    updateStatus("error", "HTTPS必須", "iPhoneではHTTPS公開が必要です。localhost は例外として利用できます。");
    setEmptyResult("HTTPS 環境で開いてください");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    updateStatus("error", "非対応", "このブラウザは getUserMedia に対応していません。");
    return;
  }

  startButton.disabled = true;

  try {
    await ensureHandLandmarker();
    mediaStream = await navigator.mediaDevices.getUserMedia(getIdealVideoConstraints());
    video.srcObject = mediaStream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    stopButton.disabled = false;
    updateStatus("live", "検出中", "前面カメラで手指認識を実行中です。");
    cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(detectLoop);
  } catch (error) {
    startButton.disabled = false;
    stopButton.disabled = true;

    const message = error?.name === "NotAllowedError"
      ? "カメラ権限が拒否されました。Safari の設定からカメラを許可してください。"
      : `起動に失敗しました: ${error?.message ?? error}`;

    updateStatus("error", "エラー", message);
    setEmptyResult(message);
  }
}

function stopCamera() {
  cancelAnimationFrame(animationFrameId);
  animationFrameId = 0;
  lastVideoTime = -1;
  lastFrameAt = 0;
  fps = 0;
  fpsChip.textContent = "FPS: --";

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  video.pause();
  video.srcObject = null;
  clearCanvas();
  setEmptyResult("開始ボタンを押すと再び認識を始めます");
  handCountChip.textContent = "手の数: 0";
  startButton.disabled = false;
  stopButton.disabled = true;
  updateStatus("default", "停止中", "カメラを停止しました。");
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);

attachSensorListeners();
sensorStateChip.textContent = "監視中";
setEmptyResult("手をカメラに映してください");
updateSensorPanel();
