const ui = {
  statusMessage: document.getElementById("statusMessage"),
  cameraPreview: document.getElementById("cameraPreview"),
  cameraFallback: document.getElementById("cameraFallback"),
  cameraState: document.getElementById("cameraState"),
  orientationPermissionState: document.getElementById("orientationPermissionState"),
  motionPermissionState: document.getElementById("motionPermissionState"),
  locationState: document.getElementById("locationState"),
  screenState: document.getElementById("screenState"),
  alphaValue: document.getElementById("alphaValue"),
  betaValue: document.getElementById("betaValue"),
  gammaValue: document.getElementById("gammaValue"),
  compassValue: document.getElementById("compassValue"),
  accelXValue: document.getElementById("accelXValue"),
  accelYValue: document.getElementById("accelYValue"),
  accelZValue: document.getElementById("accelZValue"),
  motionIntervalValue: document.getElementById("motionIntervalValue"),
  accelGXValue: document.getElementById("accelGXValue"),
  accelGYValue: document.getElementById("accelGYValue"),
  accelGZValue: document.getElementById("accelGZValue"),
  latitudeValue: document.getElementById("latitudeValue"),
  longitudeValue: document.getElementById("longitudeValue"),
  accuracyValue: document.getElementById("accuracyValue"),
  altitudeValue: document.getElementById("altitudeValue"),
  speedValue: document.getElementById("speedValue"),
  screenOrientationValue: document.getElementById("screenOrientationValue"),
  screenAngleValue: document.getElementById("screenAngleValue"),
  windowSizeValue: document.getElementById("windowSizeValue"),
  uaValue: document.getElementById("uaValue"),
  languageValue: document.getElementById("languageValue"),
  pixelRatioValue: document.getElementById("pixelRatioValue"),
  secureContextValue: document.getElementById("secureContextValue"),
  startAllButton: document.getElementById("startAllButton"),
  cameraButton: document.getElementById("cameraButton"),
  motionButton: document.getElementById("motionButton"),
  locationButton: document.getElementById("locationButton"),
};

let cameraStream;
let locationWatchId;
let motionStarted = false;

function setBadge(element, text, kind = "default") {
  element.textContent = text;
  element.className = "badge";
  if (kind === "success") {
    element.classList.add("success");
  }
  if (kind === "info") {
    element.classList.add("info");
  }
}

function setText(element, value) {
  element.textContent = value ?? "-";
}

function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function formatMetersPerSecond(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} m/s` : "-";
}

function formatMeters(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} m` : "-";
}

function updateStatus(message) {
  ui.statusMessage.textContent = message;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setBadge(ui.cameraState, "非対応", "info");
    updateStatus("このブラウザではカメラAPIが利用できません。");
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
      },
      audio: false,
    });
    ui.cameraPreview.srcObject = cameraStream;
    ui.cameraFallback.hidden = true;
    setBadge(ui.cameraState, "取得中", "success");
    updateStatus("カメラ映像を表示しています。");
  } catch (error) {
    setBadge(ui.cameraState, "拒否/失敗");
    updateStatus(`カメラの開始に失敗しました: ${error.message}`);
  }
}

function bindMotionListeners() {
  if (motionStarted) {
    return;
  }

  window.addEventListener("deviceorientation", (event) => {
    setText(ui.alphaValue, formatNumber(event.alpha, 2));
    setText(ui.betaValue, formatNumber(event.beta, 2));
    setText(ui.gammaValue, formatNumber(event.gamma, 2));

    const compass = typeof event.webkitCompassHeading === "number"
      ? `${event.webkitCompassHeading.toFixed(2)}°`
      : "-";
    setText(ui.compassValue, compass);
  });

  window.addEventListener("devicemotion", (event) => {
    const acc = event.acceleration || {};
    const accG = event.accelerationIncludingGravity || {};

    setText(ui.accelXValue, formatNumber(acc.x, 3));
    setText(ui.accelYValue, formatNumber(acc.y, 3));
    setText(ui.accelZValue, formatNumber(acc.z, 3));
    setText(ui.motionIntervalValue, Number.isFinite(event.interval) ? `${event.interval} ms` : "-");

    setText(ui.accelGXValue, formatNumber(accG.x, 3));
    setText(ui.accelGYValue, formatNumber(accG.y, 3));
    setText(ui.accelGZValue, formatNumber(accG.z, 3));
  });

  motionStarted = true;
}

async function startMotion() {
  const orientationPermission = window.DeviceOrientationEvent?.requestPermission;
  const motionPermission = window.DeviceMotionEvent?.requestPermission;

  try {
    if (typeof orientationPermission === "function") {
      const orientationResult = await orientationPermission();
      setBadge(
        ui.orientationPermissionState,
        orientationResult === "granted" ? "許可" : "拒否",
        orientationResult === "granted" ? "success" : "default"
      );
      if (orientationResult !== "granted") {
        updateStatus("傾き情報の許可が必要です。");
        return;
      }
    } else {
      setBadge(ui.orientationPermissionState, "監視中", "success");
    }

    if (typeof motionPermission === "function") {
      const motionResult = await motionPermission();
      setBadge(
        ui.motionPermissionState,
        motionResult === "granted" ? "許可" : "拒否",
        motionResult === "granted" ? "success" : "default"
      );
      if (motionResult !== "granted") {
        updateStatus("加速度情報の許可が必要です。");
        return;
      }
    } else {
      setBadge(ui.motionPermissionState, "監視中", "success");
    }

    bindMotionListeners();
    updateStatus("傾きと加速度の取得を開始しました。");
  } catch (error) {
    setBadge(ui.orientationPermissionState, "失敗");
    setBadge(ui.motionPermissionState, "失敗");
    updateStatus(`モーション開始に失敗しました: ${error.message}`);
  }
}

function startLocation() {
  if (!navigator.geolocation) {
    setBadge(ui.locationState, "非対応", "info");
    updateStatus("このブラウザではGPS APIが利用できません。");
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
      setText(ui.speedValue, formatMetersPerSecond(speed));
      setBadge(ui.locationState, "取得中", "success");
      updateStatus("GPS情報を取得しています。");
    },
    (error) => {
      setBadge(ui.locationState, "拒否/失敗");
      updateStatus(`GPSの開始に失敗しました: ${error.message}`);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    }
  );
}

function updateScreenInfo() {
  const orientation = screen.orientation?.type || `${window.orientation ?? 0}`;
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  setText(ui.screenOrientationValue, orientation);
  setText(ui.screenAngleValue, `${angle}°`);
  setText(ui.windowSizeValue, `${window.innerWidth} x ${window.innerHeight}`);
}

function populateStaticInfo() {
  setText(ui.uaValue, navigator.userAgent);
  setText(ui.languageValue, navigator.language);
  setText(ui.pixelRatioValue, String(window.devicePixelRatio));
  setText(ui.secureContextValue, window.isSecureContext ? "yes" : "no");
  updateScreenInfo();
}

async function startAll() {
  await startCamera();
  await startMotion();
  startLocation();
}

ui.startAllButton.addEventListener("click", startAll);
ui.cameraButton.addEventListener("click", startCamera);
ui.motionButton.addEventListener("click", startMotion);
ui.locationButton.addEventListener("click", startLocation);

window.addEventListener("orientationchange", updateScreenInfo);
window.addEventListener("resize", updateScreenInfo);

populateStaticInfo();
