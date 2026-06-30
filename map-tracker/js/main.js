import { GpsWatcher } from "./gps.js";
import { createTrackerMap } from "./map.js";
import {
  compassLabel,
  formatCoord,
  formatDistance,
  formatSpeed,
  haversineDistance,
  loadSettings,
  saveSettings
} from "./util.js";
import {
  applySettings,
  initUi,
  renderClock,
  renderPosition,
  setMessage,
  setStatus,
  showOffline
} from "./ui.js";

const DEFAULT_SETTINGS = {
  follow: true,
  showTrack: true,
  highAccuracy: true,
  markerSize: 18,
  trackWeight: 5,
  darkTheme: true,
  showCoords: true,
  showSpeed: true,
  showAccuracyCircle: true,
  mapStyle: "standard"
};

let settings = loadSettings(DEFAULT_SETTINGS);
let trackerMap = null;
let gps = null;
let lastPosition = null;
let totalDistance = 0;
const trackPoints = [];

document.addEventListener("DOMContentLoaded", () => {
  initUi({
    settings,
    onSettingsChange: updateSettings,
    onLocate: locateCurrentPosition,
    onZoomIn: () => trackerMap?.zoomIn(),
    onZoomOut: () => trackerMap?.zoomOut(),
    onFullscreen: toggleFullscreen
  });

  renderClock();
  setInterval(renderClock, 1000);
  setupConnectivity();
  setupServiceWorker();
  preventDoubleTapZoom();

  try {
    trackerMap = createTrackerMap({
      settings,
      onUserDrag: () => updateSettings({ follow: false }),
      onTileError: setMessage
    });
  } catch (error) {
    setStatus("error");
    setMessage(error.message);
    return;
  }

  window.addEventListener("orientationchange", () => {
    window.setTimeout(() => trackerMap?.invalidateSize(), 250);
  });

  gps = new GpsWatcher({
    onPosition: handlePosition,
    onError: setMessage,
    onState: setStatus
  });
  gps.start({ enableHighAccuracy: settings.highAccuracy });
});

function handlePosition(position) {
  setMessage(navigator.onLine ? "" : "オフラインです。地図タイルを取得できない場合があります。");

  const speed = resolveSpeed(position, lastPosition);
  if (lastPosition) {
    const delta = haversineDistance(lastPosition, position);
    if (Number.isFinite(delta) && delta > 0.4) {
      totalDistance += delta;
    }
  }

  lastPosition = position;
  trackPoints.push({ lat: position.lat, lng: position.lng });

  trackerMap.updateLocation(position, {
    follow: settings.follow,
    showAccuracyCircle: settings.showAccuracyCircle,
    markerSize: settings.markerSize
  });
  trackerMap.setTrack(trackPoints, settings.showTrack, settings.trackWeight);

  renderPosition({
    speed: formatSpeed(speed),
    lat: formatCoord(position.lat),
    lng: formatCoord(position.lng),
    accuracy: Number.isFinite(position.accuracy) ? Math.round(position.accuracy) : "--",
    distance: formatDistance(totalDistance),
    heading: compassLabel(position.heading)
  });
}

function resolveSpeed(position, previous) {
  if (Number.isFinite(position.speed) && position.speed >= 0) {
    return position.speed;
  }
  if (!previous) {
    return NaN;
  }
  const seconds = (position.timestamp - previous.timestamp) / 1000;
  if (seconds <= 0) {
    return NaN;
  }
  return haversineDistance(previous, position) / seconds;
}

function updateSettings(partial) {
  const beforeHighAccuracy = settings.highAccuracy;
  const beforeStyle = settings.mapStyle;
  settings = { ...settings, ...partial };
  saveSettings(settings);
  applySettings(settings);

  if (beforeHighAccuracy !== settings.highAccuracy) {
    gps?.restart({ enableHighAccuracy: settings.highAccuracy });
  }
  if (beforeStyle !== settings.mapStyle) {
    trackerMap?.setTileLayer(settings.mapStyle);
  }
  trackerMap?.setTrack(trackPoints, settings.showTrack, settings.trackWeight);
  if (lastPosition) {
    trackerMap?.updateLocation(lastPosition, {
      follow: false,
      showAccuracyCircle: settings.showAccuracyCircle,
      markerSize: settings.markerSize
    });
  }
}

function locateCurrentPosition() {
  if (!lastPosition) {
    setMessage("現在地を受信してから利用できます。");
    return;
  }
  updateSettings({ follow: true });
  trackerMap.locate(lastPosition);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function setupConnectivity() {
  const update = () => showOffline(!navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      setMessage("Service Workerを登録できませんでした。");
    });
  }
}

function preventDoubleTapZoom() {
  let lastTouch = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouch < 320) {
      event.preventDefault();
    }
    lastTouch = now;
  }, { passive: false });
}
