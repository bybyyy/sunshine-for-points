// Leaflet map: temperature-coloured destination markers, a home marker and a
// great-circle "flight path". If Leaflet failed to load from the CDN, the map
// shows a short note and the rest of the app keeps working.

// Esri's dark gray "Canvas" basemap needs no API key. It's a base layer plus a
// transparent labels layer drawn on top. The map sits beside the departures
// board, which is dark in both themes, so the map is always dark too.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const BASE_TILES = `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABEL_TILES = `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let map = null;
let markerLayer = null;
let homeMarker = null;
let routeLine = null;
const markers = new Map();
let homePoint = null;
let onSelect = () => {};

export function initMap(element, { onMarkerSelect }) {
  if (!window.L) {
    element.innerHTML = '<p class="map__fallback">The map couldn\'t load, but every destination is still listed.</p>';
    return;
  }
  onSelect = onMarkerSelect;

  map = window.L.map(element, {
    center: [25, -40],
    zoom: 2,
    minZoom: 2,
    worldCopyJump: true,
    zoomControl: true,
  });

  window.L.tileLayer(BASE_TILES, { attribution: ATTRIBUTION, maxZoom: 12 }).addTo(map);
  window.L.tileLayer(LABEL_TILES, { maxZoom: 12 }).addTo(map);

  markerLayer = window.L.layerGroup().addTo(map);
}

/** Shift a longitude by ±360° so it sits on the same "copy" of the world as home. */
function nearLongitude(lon, referenceLon) {
  let result = lon;
  while (result - referenceLon > 180) result -= 360;
  while (result - referenceLon < -180) result += 360;
  return result;
}

export function setHome(home) {
  if (!map) return;
  homePoint = home ? [home.lat, home.lon] : null;
  homeMarker?.remove();
  homeMarker = null;
  if (!home) return;

  const icon = window.L.divIcon({
    className: "home-marker",
    html: '<span class="home-marker__pulse"></span><span class="home-marker__dot"></span>',
    iconSize: [26, 26],
  });
  homeMarker = window.L.marker(homePoint, { icon, keyboard: false, zIndexOffset: 1000 })
    .bindTooltip(`Home · ${home.code}`, { className: "map-tip", direction: "top", offset: [0, -12] })
    .addTo(map);
}

/**
 * items: [{ code, city, lat, lon, color, affordable, tempLabel }]
 */
export function renderMarkers(items) {
  if (!map) return;
  markerLayer.clearLayers();
  markers.clear();

  for (const item of items) {
    const lon = homePoint ? nearLongitude(item.lon, homePoint[1]) : item.lon;
    const marker = window.L.circleMarker([item.lat, lon], {
      radius: item.affordable ? 8 : 5,
      color: "#0d0e0b",
      weight: 1.5,
      fillColor: item.color ?? "#9b9aa3",
      fillOpacity: item.affordable ? 0.95 : 0.55,
    });
    marker.bindTooltip(`${item.code} · ${item.city}${item.tempLabel ? ` · ${item.tempLabel}` : ""}`, {
      className: "map-tip",
      direction: "top",
      offset: [0, -6],
    });
    marker.on("click", () => onSelect(item.code));
    marker.addTo(markerLayer);
    markers.set(item.code, { marker, item, lon });
  }
}

/** Zoom so home and the given destination codes are all visible. */
export function fitTo(codes) {
  if (!map) return;
  const points = codes.map((code) => markers.get(code)).filter(Boolean).map(({ item, lon }) => [item.lat, lon]);
  if (homePoint) points.push(homePoint);
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView(points[0], 4);
    return;
  }
  map.fitBounds(points, { padding: [36, 36], maxZoom: 5 });
}

/** Points along the great circle between two coordinates, longitudes unwrapped. */
function greatCirclePoints([lat1, lon1], [lat2, lon2], steps = 64) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1Rad = toRad(lat1);
  const lon1Rad = toRad(lon1);
  const lat2Rad = toRad(lat2);
  const lon2Rad = toRad(lon2);
  const d =
    2 *
    Math.asin(
      Math.sqrt(Math.sin((lat2Rad - lat1Rad) / 2) ** 2 + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin((lon2Rad - lon1Rad) / 2) ** 2),
    );
  if (d === 0) return [[lat1, lon1]];

  const points = [];
  let previousLon = lon1;
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(lat1Rad) * Math.cos(lon1Rad) + b * Math.cos(lat2Rad) * Math.cos(lon2Rad);
    const y = a * Math.cos(lat1Rad) * Math.sin(lon1Rad) + b * Math.cos(lat2Rad) * Math.sin(lon2Rad);
    const z = a * Math.sin(lat1Rad) + b * Math.sin(lat2Rad);
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    const lon = nearLongitude(toDeg(Math.atan2(y, x)), previousLon);
    previousLon = lon;
    points.push([lat, lon]);
  }
  return points;
}

/** Draws the flight path to `code` and enlarges its marker. Pass null to clear. */
export function highlight(code) {
  if (!map) return;
  routeLine?.remove();
  routeLine = null;

  for (const [markerCode, { marker, item }] of markers) {
    const active = markerCode === code;
    marker.setRadius(active ? 12 : item.affordable ? 8 : 5);
    if (active) marker.bringToFront();
  }

  const target = markers.get(code);
  if (!target || !homePoint) return;
  routeLine = window.L.polyline(greatCirclePoints(homePoint, [target.item.lat, target.lon]), {
    color: target.item.color ?? "#ffb000",
    weight: 3,
    dashArray: "8 6",
    lineCap: "butt",
    interactive: false,
  }).addTo(map);
}
