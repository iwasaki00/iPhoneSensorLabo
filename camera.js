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
  globalStatus: document.getElementById("cameraGlobalStatus"),
  basicCameraButton: document.getElementById("basicCameraButton"),
  basicCameraState: document.getElementById("basicCameraState"),
  basicCameraVideo: document.getElementById("basicCameraVideo"),
  basicCameraFallback: document.getElementById("basicCameraFallback"),
  handStatusBadge: document.getElementById("handStatusBadge"),
  handStatusMessage: document.getElementById("handStatusMessage"),
  handCountChip: document.getElementById("handCountChip"),
  fpsChip: document.getElementById("fpsChip"),
  startHandButton: document.getElementById("startHandButton"),
  stopHandButton: document.getElementById("stopHandButton"),
  handVideo: document.getElementById("handVideo"),
  handCanvas: document.getElementById("handCanvas"),
  handResults: document.getElementById("handResults")
};

const handCtx = ui.handCanvas.getContext("2d");

let basicCameraStream = null;
let handLandmarker = null;
let handStream = null;
let handRafId = 0;
let lastVideoTime = -1;
let lastFrameAt = 0;
let smoothedFps = 0;

function setGlobalStatus(message) {
  ui.globalStatus.textContent = message;
}

function setBadge(element, text, kind = "default") {
  element.className = `status-badge${kind === "default" ? "" : ` ${kind}`}`;
  element.textContent = text;
}

function setHandStatus(kind, badgeText, message) {
  setBadge(ui.handStatusBadge, badgeText, kind);
  ui.handStatusMessage.textContent = message;
}

function setHandEmpty(message) {
  ui.handResults.innerHTML = `<p class="empty-state">${message}</p>`;
}

function isSecureEnough() {
  return (
    window.isSecureContext ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.protocol === "file:"
  );
}

function formatError(prefix, error) {
  const detail = error?.message || String(error);
  return `${prefix}: ${detail}`;
}

async function startBasicCamera() {
  if (basicCameraStream) {
    setGlobalStatus("カメラはすでに起動しています。");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setBadge(ui.basicCameraState, "非対応", "error");
    setGlobalStatus("このブラウザはカメラ API に対応していません。");
    return;
  }

  setBadge(ui.basicCameraState, "準備中", "loading");
  setGlobalStatus("カメラを起動しています...");

  try {
    basicCameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });

    ui.basicCameraVideo.srcObject = basicCameraStream;
    ui.basicCameraFallback.hidden = true;
    setBadge(ui.basicCameraState, "動作中", "live");
    setGlobalStatus("カメラ映像表示を開始しました。");
  } catch (error) {
    setBadge(ui.basicCameraState, "失敗", "error");
    const message = error?.name === "NotAllowedError"
      ? "カメラ権限が拒否されました。Safari の設定からカメラを許可してください。"
      : formatError("カメラ開始に失敗しました", error);
    setGlobalStatus(message);
  }
}

async function ensureHandLandmarker() {
  if (handLandmarker) {
    return handLandmarker;
  }

  setHandStatus("loading", "準備中", "MediaPipe モデルを読み込んでいます...");
  setGlobalStatus("MediaPipe モデルを読み込んでいます...");

  try {
    const visionNamespace = window.vision;
    if (!visionNamespace?.FilesetResolver || !visionNamespace?.HandLandmarker) {
      throw new Error("vision_bundle.js が読み込まれていません");
    }

    const vision = await visionNamespace.FilesetResolver.forVisionTasks(WASM_ROOT);
    handLandmarker = await visionNamespace.HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_ASSET_PATH },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5
    });

    return handLandmarker;
  } catch (error) {
    const message = formatError("MediaPipe の読み込みに失敗しました", error);
    setHandStatus("error", "読込失敗", message);
    setHandEmpty(message);
    setGlobalStatus(message);
    throw error;
  }
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
      const message = formatError("推論中にエラーが発生しました", error);
      setHandStatus("error", "推論エラー", message);
      setGlobalStatus(message);
    }
  }

  handRafId = requestAnimationFrame(handLoop);
}

async function startHandRecognition() {
  if (!isSecureEnough()) {
    const message = "iPhoneでは HTTPS 公開が必要です。ローカル確認は localhost または file 直開きで試してください。";
    setHandStatus("error", "HTTPS必須", message);
    setHandEmpty("HTTPS 環境で開いてください");
    setGlobalStatus(message);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    const message = "このブラウザは getUserMedia に対応していません。";
    setHandStatus("error", "非対応", message);
    setGlobalStatus(message);
    return;
  }

  ui.startHandButton.disabled = true;
  setHandStatus("loading", "準備中", "手指認識を起動しています...");
  setGlobalStatus("手指認識を起動しています...");

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
      : formatError("手指認識開始に失敗しました", error);

    setHandStatus("error", "エラー", message);
    setHandEmpty(message);
    setGlobalStatus(message);
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
  setGlobalStatus("各機能の開始ボタンを押して実験してください。");
}

ui.basicCameraButton.addEventListener("click", startBasicCamera);
ui.startHandButton.addEventListener("click", startHandRecognition);
ui.stopHandButton.addEventListener("click", stopHandRecognition);

setHandEmpty("手をカメラに映してください");
setGlobalStatus("各機能の開始ボタンを押して実験してください。");
