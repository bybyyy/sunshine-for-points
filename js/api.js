// Every network request lives here. Each function either resolves with clean
// data or throws an ApiError whose message is safe to show to the user.

export class ApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiError";
  }
}

/** "the weather service" -> "The weather service", for the start of a sentence. */
const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Turns an HTTP error status into something a person can act on. */
function statusMessage(status, name) {
  if (status === 429) {
    return `${sentence(name)} is getting too many requests right now. Wait a minute, then try again.`;
  }
  if (status >= 500) {
    return `${sentence(name)} is having trouble right now. Try again in a few minutes.`;
  }
  return `${sentence(name)} couldn't answer that request.`;
}

/** fetch + JSON with a timeout. Turns every failure into an ApiError. */
export async function fetchJSON(url, { timeout = 12000, friendlyName = "the server" } = {}) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new ApiError(`${sentence(friendlyName)} took too long to answer.`);
    }
    if (!navigator.onLine) {
      throw new ApiError("You appear to be offline.");
    }
    throw new ApiError(`Couldn't reach ${friendlyName}.`);
  }

  if (!response.ok) {
    throw new ApiError(statusMessage(response.status, friendlyName));
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError(`${sentence(friendlyName)} sent back something we couldn't read.`);
  }
}

/* ---------- Local data files ---------- */

export async function loadAppData() {
  const files = [
    "data/airports.json",
    "data/destinations.json",
    "data/banks.json",
    "data/airlines.json",
    "data/transfers.json",
    "data/currency-pegs.json",
  ];
  const [airports, destinations, banks, airlines, transfers, pegs] = await Promise.all(
    files.map((file) => fetchJSON(file, { friendlyName: "the app's data files" })),
  );

  const chartEntries = await Promise.all(
    airlines.airlines.map(async (airline) => [
      airline.id,
      await fetchJSON(`data/${airline.chart}`, { friendlyName: "the award charts" }),
    ]),
  );

  // airports.json stores compact rows; "fields" names each column.
  const toAirport = (row) =>
    Object.fromEntries(airports.fields.map((field, index) => [field, row[index]]));

  return {
    airports: airports.airports.map(toAirport),
    destinations: destinations.destinations,
    banks: banks.banks,
    airlines: airlines.airlines,
    transfers: transfers.transfers,
    pegs: pegs.pegs,
    charts: Object.fromEntries(chartEntries),
    lastVerified: transfers.lastVerified,
  };
}

/* ---------- Open-Meteo: daily forecast for many places in one request ---------- */

// Open-Meteo counts anything past 14 days as extra calls, so stop at 14.
export const FORECAST_DAYS = 14;

export async function fetchForecasts(places) {
  const params = new URLSearchParams({
    latitude: places.map((p) => p.lat.toFixed(3)).join(","),
    longitude: places.map((p) => p.lon.toFixed(3)).join(","),
    daily: "temperature_2m_max,weather_code,precipitation_probability_max",
    temperature_unit: "fahrenheit",
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
  });
  const json = await fetchJSON(`https://api.open-meteo.com/v1/forecast?${params}`, {
    friendlyName: "the weather service",
    timeout: 15000,
  });
  // One place returns an object, several return an array.
  const list = Array.isArray(json) ? json : [json];
  return list.map((entry) => ({
    dates: entry.daily.time,
    highs: entry.daily.temperature_2m_max,
    codes: entry.daily.weather_code,
    rain: entry.daily.precipitation_probability_max,
  }));
}

/* ---------- Frankfurter: ECB reference rates ---------- */

export async function fetchRates() {
  const json = await fetchJSON("https://api.frankfurter.dev/v1/latest?base=USD", {
    friendlyName: "the exchange-rate service",
  });
  return { date: json.date, rates: { ...json.rates, USD: 1 } };
}

/* ---------- Wikipedia: page summary + lead image ---------- */

export async function fetchWikiSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const json = await fetchJSON(url, { friendlyName: "Wikipedia" });
  // Country pages often lead with a flag or a locator map. Those are SVG
  // drawings, not photos, so skip them and let the placeholder show.
  const source = json.thumbnail?.source ?? null;
  const thumb = source && !source.includes(".svg") ? source : null;
  return {
    extract: json.extract ?? "",
    pageUrl: json.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    // Ask Wikimedia for a wider version of the thumbnail; fall back to the original thumbnail.
    image: thumb ? thumb.replace(/\/\d+px-/, "/960px-") : null,
    imageFallback: thumb,
  };
}
