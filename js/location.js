// Geolocation (browser API) plus the manual airport lookup used as its fallback.

import { haversineMiles } from "./awards.js";

export function isGeolocationSupported() {
  return "geolocation" in navigator;
}

/** Promise wrapper around getCurrentPosition. Rejects with a friendly message. */
export function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => {
        const messages = {
          1: "Location is turned off for this site. No problem, pick your home airport below.",
          2: "Your device couldn't work out where you are. Pick your home airport below.",
          3: "Finding your location took too long. Pick your home airport below.",
        };
        reject(new Error(messages[error.code] ?? messages[2]));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

export function nearestAirport(lat, lon, airports) {
  let best = null;
  let bestMiles = Infinity;
  for (const airport of airports) {
    const miles = haversineMiles(lat, lon, airport.lat, airport.lon);
    if (miles < bestMiles) {
      best = airport;
      bestMiles = miles;
    }
  }
  return { airport: best, miles: bestMiles };
}

/** Text shown in the input and used as the <datalist> option value. */
export function airportLabel(airport) {
  return `${airport.code} · ${airport.city}`;
}

/** Resolves whatever the user typed: "stl", "STL · St Louis", or a city name. */
export function findAirport(query, airports) {
  const text = query.trim();
  if (!text) {
    return null;
  }
  const codeMatch = text.match(/^([a-z]{3})(\b|$)/i);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const byCode = airports.find((airport) => airport.code === code);
    if (byCode) {
      return byCode;
    }
  }
  const lower = text.toLowerCase();
  return (
    airports.find((airport) => airport.city.toLowerCase() === lower) ??
    airports.find((airport) => airport.city.toLowerCase().startsWith(lower)) ??
    airports.find((airport) => airport.name.toLowerCase().includes(lower)) ??
    null
  );
}
