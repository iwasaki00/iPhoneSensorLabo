const TILE_LAYERS = {
  standard: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19
    }
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      maxZoom: 19
    }
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      attribution: "Tiles &copy; Esri",
      maxZoom: 19
    }
  }
};

export function createTrackerMap({ settings, onUserDrag, onTileError }) {
  if (window.mapTrackerLeafletFailed || !window.L) {
    throw new Error("Leafletを読み込めませんでした。通信状態を確認して再読み込みしてください。");
  }

  const L = window.L;
  const map = L.map("map", {
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
    inertia: true,
    tap: true,
    doubleClickZoom: true
  }).setView([35.681236, 139.767125], 15);

  let tileLayer = null;
  let currentMarker = null;
  let accuracyCircle = null;
  let trackLine = L.polyline([], {
    color: "#1677ff",
    weight: settings.trackWeight,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round",
    smoothFactor: 1.4
  }).addTo(map);

  map.on("dragstart", () => onUserDrag());

  function setTileLayer(style) {
    const next = TILE_LAYERS[style] || TILE_LAYERS.standard;
    if (tileLayer) {
      map.removeLayer(tileLayer);
    }
    tileLayer = L.tileLayer(next.url, next.options);
    tileLayer.on("tileerror", () => onTileError("地図タイルを取得できません。通信状態を確認してください。"));
    tileLayer.addTo(map);
  }

  function updateLocation(position, { follow, showAccuracyCircle, markerSize }) {
    const latLng = [position.lat, position.lng];
    if (!currentMarker) {
      currentMarker = L.marker(latLng, {
        interactive: false,
        icon: buildCurrentIcon(markerSize)
      }).addTo(map);
    } else {
      currentMarker.setLatLng(latLng);
      currentMarker.setIcon(buildCurrentIcon(markerSize));
    }

    if (!accuracyCircle) {
      accuracyCircle = L.circle(latLng, {
        radius: position.accuracy || 0,
        color: "#54c7f8",
        weight: 1,
        fillColor: "#1677ff",
        fillOpacity: 0.16,
        opacity: 0.42,
        interactive: false
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(latLng);
      accuracyCircle.setRadius(position.accuracy || 0);
    }

    if (showAccuracyCircle) {
      if (!map.hasLayer(accuracyCircle)) {
        accuracyCircle.addTo(map);
      }
    } else if (map.hasLayer(accuracyCircle)) {
      map.removeLayer(accuracyCircle);
    }

    if (follow) {
      map.flyTo(latLng, Math.max(map.getZoom(), 16), {
        animate: true,
        duration: 0.45,
        easeLinearity: 0.35
      });
    }
  }

  function setTrack(points, visible, weight) {
    trackLine.setLatLngs(points.map((point) => [point.lat, point.lng]));
    trackLine.setStyle({ weight });
    if (visible && !map.hasLayer(trackLine)) {
      trackLine.addTo(map);
    }
    if (!visible && map.hasLayer(trackLine)) {
      map.removeLayer(trackLine);
    }
  }

  function locate(position) {
    map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 17), {
      animate: true,
      duration: 0.65
    });
  }

  setTileLayer(settings.mapStyle);

  return {
    map,
    zoomIn: () => map.zoomIn(),
    zoomOut: () => map.zoomOut(),
    locate,
    updateLocation,
    setTrack,
    setTileLayer,
    invalidateSize: () => map.invalidateSize()
  };
}

function buildCurrentIcon(size) {
  const L = window.L;
  return L.divIcon({
    className: "",
    html: `<div class="current-location" style="width:${size}px;height:${size}px"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}
