const nodes = {};
const previousText = new Map();

export function initUi({ settings, onSettingsChange, onLocate, onZoomIn, onZoomOut, onFullscreen }) {
  cacheNodes();

  nodes.locateBtn.addEventListener("click", onLocate);
  nodes.zoomInBtn.addEventListener("click", onZoomIn);
  nodes.zoomOutBtn.addEventListener("click", onZoomOut);
  nodes.fullscreenBtn.addEventListener("click", onFullscreen);
  nodes.settingsBtn.addEventListener("click", () => nodes.settingsDialog.showModal());
  nodes.followBtn.addEventListener("click", () => onSettingsChange({ follow: !nodes.settingFollow.checked }));

  bindCheckbox("settingFollow", "follow", onSettingsChange);
  bindCheckbox("settingTrack", "showTrack", onSettingsChange);
  bindCheckbox("settingHighAccuracy", "highAccuracy", onSettingsChange);
  bindCheckbox("settingDarkTheme", "darkTheme", onSettingsChange);
  bindCheckbox("settingCoords", "showCoords", onSettingsChange);
  bindCheckbox("settingSpeed", "showSpeed", onSettingsChange);
  bindCheckbox("settingAccuracyCircle", "showAccuracyCircle", onSettingsChange);
  bindRange("settingMarkerSize", "markerSize", "markerSizeValue", onSettingsChange);
  bindRange("settingTrackWeight", "trackWeight", "trackWeightValue", onSettingsChange);
  nodes.settingMapStyle.addEventListener("change", () => onSettingsChange({ mapStyle: nodes.settingMapStyle.value }));

  applySettings(settings);
}

export function renderPosition(view) {
  setText(nodes.speed, view.speed);
  setText(nodes.lat, view.lat);
  setText(nodes.lng, view.lng);
  setText(nodes.accuracy, view.accuracy);
  setText(nodes.distance, view.distance);
  setText(nodes.heading, view.heading);
}

export function renderClock(date = new Date()) {
  setText(nodes.clock, new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date));
}

export function setStatus(status) {
  const labels = {
    tracking: "取得中",
    waiting: "受信待ち",
    error: "取得失敗"
  };
  nodes.gpsStatus.className = `status ${status}`;
  setText(nodes.gpsStatus, labels[status] || labels.waiting);
}

export function setMessage(message = "") {
  setText(nodes.message, message);
}

export function applySettings(settings) {
  nodes.settingFollow.checked = settings.follow;
  nodes.settingTrack.checked = settings.showTrack;
  nodes.settingHighAccuracy.checked = settings.highAccuracy;
  nodes.settingDarkTheme.checked = settings.darkTheme;
  nodes.settingCoords.checked = settings.showCoords;
  nodes.settingSpeed.checked = settings.showSpeed;
  nodes.settingAccuracyCircle.checked = settings.showAccuracyCircle;
  nodes.settingMarkerSize.value = settings.markerSize;
  nodes.settingTrackWeight.value = settings.trackWeight;
  nodes.settingMapStyle.value = settings.mapStyle;
  setText(nodes.markerSizeValue, settings.markerSize);
  setText(nodes.trackWeightValue, settings.trackWeight);

  document.body.classList.toggle("light-theme", !settings.darkTheme);
  document.body.classList.toggle("hide-coords", !settings.showCoords);
  document.body.classList.toggle("hide-speed", !settings.showSpeed);
  nodes.followBtn.classList.toggle("active", settings.follow);
}

export function showOffline(isOffline) {
  nodes.offlineScreen.hidden = !isOffline;
}

function cacheNodes() {
  [
    "gpsStatus", "clock", "speed", "lat", "lng", "accuracy", "distance", "heading", "message",
    "locateBtn", "followBtn", "fullscreenBtn", "zoomInBtn", "zoomOutBtn", "settingsBtn",
    "settingsDialog", "settingFollow", "settingTrack", "settingHighAccuracy", "settingDarkTheme",
    "settingCoords", "settingSpeed", "settingAccuracyCircle", "settingMarkerSize",
    "settingTrackWeight", "settingMapStyle", "markerSizeValue", "trackWeightValue", "offlineScreen"
  ].forEach((id) => {
    nodes[id] = document.getElementById(id);
  });
}

function bindCheckbox(id, key, onSettingsChange) {
  nodes[id].addEventListener("change", () => onSettingsChange({ [key]: nodes[id].checked }));
}

function bindRange(id, key, valueId, onSettingsChange) {
  nodes[id].addEventListener("input", () => {
    const value = Number(nodes[id].value);
    setText(nodes[valueId], value);
    onSettingsChange({ [key]: value });
  });
}

function setText(node, value) {
  const text = String(value);
  if (previousText.get(node) !== text) {
    node.textContent = text;
    previousText.set(node, text);
  }
}
