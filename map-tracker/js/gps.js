import { getGeoErrorMessage } from "./util.js";

export class GpsWatcher {
  constructor({ onPosition, onError, onState }) {
    this.onPosition = onPosition;
    this.onError = onError;
    this.onState = onState;
    this.watchId = null;
    this.options = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    };
  }

  start(options = {}) {
    this.stop();
    this.options = { ...this.options, ...options };

    if (!("geolocation" in navigator)) {
      this.onError("このブラウザは位置情報に対応していません。");
      return;
    }

    this.onState("waiting");
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.onState("tracking");
        this.onPosition(normalizePosition(position));
      },
      (error) => {
        this.onState("error");
        this.onError(getGeoErrorMessage(error));
      },
      this.options
    );
  }

  restart(options = {}) {
    this.start({ ...this.options, ...options });
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

function normalizePosition(position) {
  const coords = position.coords;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy,
    speed: coords.speed,
    heading: coords.heading,
    timestamp: position.timestamp
  };
}
