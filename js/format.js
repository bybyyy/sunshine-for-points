// Small formatting helpers shared by every module: numbers, temperatures,
// weather codes and dates. Nothing here touches the DOM.

const numberFormat = new Intl.NumberFormat("en-US");

export function formatNumber(value) {
  return numberFormat.format(Math.round(value));
}

export function formatUSD(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
  } catch {
    return `${formatNumber(value)} ${currency}`;
  }
}

/** Bank-to-airline ratio as people usually say it: 1 -> "1:1", 0.8 -> "1:0.8", 0.3333 -> "3:1". */
export function formatRatio(ratio) {
  if (ratio < 0.5) {
    return `${Math.round(1 / ratio)}:1`;
  }
  return `1:${Number(ratio.toFixed(2))}`;
}

/* ---------- Temperature ---------- */

// Same colors as --t1 to --t6 in css/styles.css (the map legend).
const TEMP_STOPS = [
  [35, [91, 141, 239]],
  [50, [124, 198, 201]],
  [62, [246, 213, 92]],
  [72, [255, 182, 39]],
  [84, [255, 107, 74]],
  [95, [215, 38, 61]],
];

/** Colour for a temperature in °F, blended between the stops above. */
export function tempColor(fahrenheit) {
  if (fahrenheit == null) {
    return null;
  }
  const first = TEMP_STOPS[0];
  const last = TEMP_STOPS[TEMP_STOPS.length - 1];
  if (fahrenheit <= first[0]) {
    return toRgb(first[1]);
  }
  if (fahrenheit >= last[0]) {
    return toRgb(last[1]);
  }
  for (let i = 1; i < TEMP_STOPS.length; i += 1) {
    const [hiTemp, hiColor] = TEMP_STOPS[i];
    if (fahrenheit <= hiTemp) {
      const [loTemp, loColor] = TEMP_STOPS[i - 1];
      const t = (fahrenheit - loTemp) / (hiTemp - loTemp);
      return toRgb(loColor.map((channel, k) => channel + (hiColor[k] - channel) * t));
    }
  }
  return toRgb(last[1]);
}

function toRgb([r, g, b]) {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

/** Converts a °F value to the display unit and rounds it. */
export function toUnit(fahrenheit, unit) {
  return Math.round(unit === "C" ? ((fahrenheit - 32) * 5) / 9 : fahrenheit);
}

/** Converts a temperature *difference* in °F to the display unit. */
export function deltaToUnit(deltaF, unit) {
  return unit === "C" ? (deltaF * 5) / 9 : deltaF;
}

export function formatTemp(fahrenheit, unit, withUnit = true) {
  if (fahrenheit == null) {
    return "—";
  }
  return `${toUnit(fahrenheit, unit)}°${withUnit ? unit : ""}`;
}

/* ---------- Weather codes (WMO, as used by Open-Meteo) ---------- */

// label: shown on the board ("Showers").
// adjective: fits in a sentence like "It's 62°F and rainy".
export function describeWeather(code) {
  if (code == null) return { icon: "cloud", label: "No forecast", adjective: "unknown" };
  if (code === 0) return { icon: "sun", label: "Sunny", adjective: "sunny" };
  if (code === 1) return { icon: "sun", label: "Mostly sunny", adjective: "mostly sunny" };
  if (code === 2) return { icon: "partly", label: "Partly cloudy", adjective: "partly cloudy" };
  if (code === 3) return { icon: "cloud", label: "Cloudy", adjective: "cloudy" };
  if (code === 45 || code === 48) return { icon: "fog", label: "Foggy", adjective: "foggy" };
  if (code >= 51 && code <= 57) return { icon: "rain", label: "Drizzle", adjective: "drizzly" };
  if (code >= 61 && code <= 67) return { icon: "rain", label: "Rain", adjective: "rainy" };
  if (code >= 71 && code <= 77) return { icon: "snow", label: "Snow", adjective: "snowy" };
  if (code >= 80 && code <= 82) return { icon: "rain", label: "Showers", adjective: "showery" };
  if (code === 85 || code === 86) return { icon: "snow", label: "Snow showers", adjective: "snowy" };
  if (code >= 95) return { icon: "storm", label: "Storms", adjective: "stormy" };
  return { icon: "cloud", label: "Cloudy", adjective: "cloudy" };
}

/* ---------- Dates (all as local "YYYY-MM-DD" strings) ---------- */

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** The coming Saturday (today if it is Saturday), plus `weeksAhead` weeks. */
export function upcomingSaturday(todayISO, weeksAhead = 0) {
  const today = parseISODate(todayISO);
  const daysUntil = (6 - today.getDay() + 7) % 7;
  return addDays(todayISO, daysUntil + weeksAhead * 7);
}

export function formatDay(iso, style = "short") {
  const options =
    style === "long"
      ? { weekday: "long", month: "long", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric" };
  return parseISODate(iso).toLocaleDateString("en-US", options);
}

export function weekdayShort(iso) {
  return parseISODate(iso).toLocaleDateString("en-US", { weekday: "short" });
}
