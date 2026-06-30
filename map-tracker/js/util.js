export function haversineDistance(a, b) {
  const radius = 6371000;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) {
    return "0 m";
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatCoord(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "--";
}

export function formatSpeed(metersPerSecond) {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond < 0) {
    return "--";
  }
  return (metersPerSecond * 3.6).toFixed(1);
}

export function compassLabel(degrees) {
  if (!Number.isFinite(degrees)) {
    return "-";
  }
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

export function getGeoErrorMessage(error) {
  if (!error) {
    return "位置情報を取得できませんでした。";
  }
  if (error.code === 1) {
    return "位置情報の利用が拒否されました。ブラウザ設定から許可してください。";
  }
  if (error.code === 2) {
    return "GPS信号を取得できません。屋外や窓際で再試行してください。";
  }
  if (error.code === 3) {
    return "位置情報の取得がタイムアウトしました。";
  }
  return error.message || "位置情報を取得できませんでした。";
}

export function loadSettings(defaults) {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("map-tracker-settings") || "{}") };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings) {
  localStorage.setItem("map-tracker-settings", JSON.stringify(settings));
}
