const ui = {
  globalStatus: document.getElementById("sensorGlobalStatus"),
  startMotionButton: document.getElementById("startMotionButton"),
  startLocationButton: document.getElementById("startLocationButton"),

  motionState: document.getElementById("motionState"),
  alphaValue: document.getElementById("alphaValue"),
  betaValue: document.getElementById("betaValue"),
  gammaValue: document.getElementById("gammaValue"),
  accelXValue: document.getElementById("accelXValue"),
  accelYValue: document.getElementById("accelYValue"),
  accelZValue: document.getElementById("accelZValue"),
  accelGValue: document.getElementById("accelGValue"),
  motionIntervalValue: document.getElementById("motionIntervalValue"),

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

let motionStarted = false;
let locationWatchId = null;

function setGlobalStatus(message) {
  ui.globalStatus.textContent = message;
}

function setBadge(element, text, kind = "default") {
  element.className = `status-badge${kind === "default" ? "" : ` ${kind}`}`;
  element.textContent = text;
}

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
    setGlobalStatus("傾き加速度の監視を開始しました。");
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

ui.startMotionButton.addEventListener("click", startMotion);
ui.startLocationButton.addEventListener("click", startLocation);
window.addEventListener("orientationchange", updateScreenInfo);
window.addEventListener("resize", updateScreenInfo);

populateStaticInfo();
updateScreenInfo();
setText(ui.locationModeValue, "watchPosition");
