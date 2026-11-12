// Sunshine for Points: app state and wiring.
//
// main.js owns the single `state` object. Any user action or API response
// updates state and calls render(), which recomputes prices and redraws.

import { FORECAST_DAYS, fetchForecasts, fetchRates, loadAppData } from "./api.js";
import { buyingPower, priceDestination } from "./awards.js";
import { initDetail, isDetailOpen, openDetail, refreshDetail } from "./detail.js";
import { addDays, formatDay, formatNumber, formatTemp, tempColor, toISODate, upcomingSaturday } from "./format.js";
import { airportLabel, findAirport, getPosition, isGeolocationSupported, nearestAirport } from "./location.js";
import * as mapView from "./map.js";
import { loadSaved, readCache, save, writeCache } from "./storage.js";
import * as ui from "./ui.js";

const MIN_TRIP_MILES = 75; // Skip "destinations" that are basically home.
const BOARD_ROWS = 20; // Rows on the board before "Show all".

const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  wallet: { banks: {}, airlines: {} },
  enabledPrograms: new Set(),
  home: null,
  today: toISODate(new Date()),
  date: null,
  trip: { roundTrip: true, cabin: "economy", travelers: 1 },
  filters: { tags: new Set(), minTemp: 65, affordableOnly: false },
  sort: "value",
  unit: "F",
  theme: "light", // Light is the default; dark is opt-in from the header.
  forecasts: null, // Map of destination code -> forecast
  weatherStatus: "loading",
  homeForecast: null,
  homeWeatherStatus: "idle",
  rates: null,
  ratesStatus: "loading",
  activeCode: null,
  showAll: false,
  results: [],
  visible: [],
};

/* ======================================================================
   Startup
   ====================================================================== */

async function init() {
  ui.initBanner();
  try {
    state.data = indexData(await loadAppData());
  } catch (error) {
    ui.renderEmpty($("empty-state"), "data-error");
    ui.showBanner(error.message);
    return;
  }

  restoreSaved();
  buildControls();
  setPanelDefaults();
  mapView.initMap($("map"), { onMarkerSelect: showDetail });
  initDetail({ contextFor: detailContext, onClose: () => setActive(null) });
  bindEvents();
  watchConnection();

  const deepLink = readDeepLink();
  if (state.home) {
    selectHome(state.home);
  } else {
    render();
  }
  loadWeather();
  loadRates();
  if (deepLink) showDetail(deepLink);
}

/** Panels start open only until they're filled in, so returning visitors land near the board. */
function setPanelDefaults() {
  $("origin-panel").open = !state.home;
  $("wallet-panel").open = isWalletEmpty();
  $("filter-panel").open = window.matchMedia("(min-width: 900px)").matches;
}

function indexData(data) {
  const byId = (list, key = "id") => Object.fromEntries(list.map((item) => [item[key], item]));
  return {
    ...data,
    banksById: byId(data.banks),
    airlinesById: byId(data.airlines),
    airportsByCode: byId(data.airports, "code"),
  };
}

function restoreSaved() {
  const saved = loadSaved();
  const { banks, airlines } = state.data;
  const clean = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

  for (const bank of banks) state.wallet.banks[bank.id] = clean(saved.wallet?.banks?.[bank.id]);
  for (const airline of airlines) state.wallet.airlines[airline.id] = clean(saved.wallet?.airlines?.[airline.id]);

  const validPrograms = Array.isArray(saved.programs)
    ? saved.programs.filter((id) => state.data.airlinesById[id])
    : airlines.map((airline) => airline.id);
  state.enabledPrograms = new Set(validPrograms);

  state.unit = saved.unit === "C" ? "C" : "F";
  state.theme = saved.theme === "dark" ? "dark" : "light";
  applyTheme();
  if (saved.trip) {
    state.trip.roundTrip = saved.trip.roundTrip !== false;
    state.trip.cabin = saved.trip.cabin === "business" ? "business" : "economy";
    state.trip.travelers = [1, 2, 3, 4].includes(saved.trip.travelers) ? saved.trip.travelers : 1;
  }
  state.home = state.data.airportsByCode[saved.home] ?? null;
  state.date = upcomingSaturday(state.today);
}

function persist() {
  save({
    wallet: state.wallet,
    programs: [...state.enabledPrograms],
    unit: state.unit,
    theme: state.theme,
    trip: state.trip,
    home: state.home?.code ?? null,
  });
}

/** Supports shared links like  #from=STL&to=SJU&date=2026-11-14  */
function readDeepLink() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const home = state.data.airportsByCode[params.get("from")?.toUpperCase()];
  const to = params.get("to")?.toUpperCase();
  const date = params.get("date");
  if (!home) return null;

  state.home = home;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) state.date = clampDate(date);
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return state.data.destinations.some((dest) => dest.code === to) ? to : null;
}

function buildControls() {
  const { banks, airlines, transfers, airports } = state.data;

  ui.buildWalletInputs($("bank-inputs"), banks, state.wallet.banks, "bank");
  ui.buildWalletInputs($("airline-inputs"), airlines, state.wallet.airlines, "airline");
  ui.buildProgramToggles($("program-toggles"), airlines, state.enabledPrograms);
  ui.buildTransferTable($("transfer-table"), banks, airlines, transfers);
  ui.buildAirportOptions($("airport-list"), airports, airportLabel);
  ui.buildTagFilters($("tag-filters"), state.filters.tags);

  const dateInput = $("travel-date");
  dateInput.min = state.today;
  dateInput.max = addDays(state.today, FORECAST_DAYS - 1);
  dateInput.value = state.date;

  document.querySelector(`input[name="trip"][value="${state.trip.roundTrip ? "round" : "oneway"}"]`).checked = true;
  document.querySelector(`input[name="cabin"][value="${state.trip.cabin}"]`).checked = true;
  $("travelers").value = String(state.trip.travelers);
  $("sort-select").value = state.sort;
  $("min-temp").value = String(state.filters.minTemp);
  updateUnitControls();

  if (!isGeolocationSupported()) {
    $("locate-btn").hidden = true;
    $("locate-status").textContent = "Your browser can't share its location, so pick your home airport below.";
  }

  const verified = new Date(`${state.data.lastVerified}T12:00:00`);
  $("verified-date").textContent = verified.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/* ======================================================================
   Data loading (Open-Meteo + Frankfurter)
   ====================================================================== */

const FORECAST_CACHE_MS = 60 * 60 * 1000; // Forecasts barely change within an hour.

/**
 * Forecasts for `places`, from the cache when there's a fresh copy that
 * starts today. Saves Open-Meteo calls when people reload or come back.
 */
async function getForecasts(cacheName, places) {
  const cached = readCache(cacheName, FORECAST_CACHE_MS);
  if (cached && cached[0]?.dates[0] === state.today) return cached;
  const forecasts = await fetchForecasts(places);
  writeCache(cacheName, forecasts);
  return forecasts;
}

async function loadWeather() {
  state.weatherStatus = "loading";
  render();
  try {
    const forecasts = await getForecasts("destinations", state.data.destinations);
    state.forecasts = new Map(state.data.destinations.map((dest, i) => [dest.code, forecasts[i]]));
    state.weatherStatus = "ok";
  } catch (error) {
    state.weatherStatus = "error";
    showWeatherError(error);
  }
  render({ flip: true });
}

async function loadHomeWeather() {
  const home = state.home;
  state.homeForecast = null;
  state.homeWeatherStatus = "loading";
  try {
    const [forecast] = await getForecasts(`home-${home.code}`, [home]);
    if (state.home !== home) return; // The user picked another airport meanwhile.
    state.homeForecast = forecast;
    state.homeWeatherStatus = "ok";
  } catch (error) {
    if (state.home !== home) return;
    state.homeWeatherStatus = "error";
    showWeatherError(error);
  }
  render({ flip: true });
}

function showWeatherError(error) {
  ui.showBanner(`${error.message} Point prices still work; temperatures will appear once the forecast loads.`, () => {
    if (state.weatherStatus === "error") loadWeather();
    if (state.home && state.homeWeatherStatus === "error") loadHomeWeather();
  });
}

async function loadRates() {
  state.ratesStatus = "loading";
  refreshDetail();
  try {
    state.rates = await fetchRates();
    state.ratesStatus = "ok";
  } catch {
    state.ratesStatus = "error"; // Shown inside the drawer, where rates are used.
  }
  refreshDetail();
}

function watchConnection() {
  window.addEventListener("offline", () => {
    ui.showBanner("You're offline. Point prices still work, but weather, exchange rates and photos need a connection.");
  });
  window.addEventListener("online", () => {
    ui.hideBanner();
    if (state.weatherStatus === "error") loadWeather();
    if (state.home && state.homeWeatherStatus === "error") loadHomeWeather();
    if (state.ratesStatus === "error") loadRates();
  });
}

/* ======================================================================
   Computing results
   ====================================================================== */

function dayFor(forecast, date) {
  if (!forecast) return null;
  const index = forecast.dates.indexOf(date);
  if (index === -1 || forecast.highs[index] == null) return null;
  return { high: forecast.highs[index], code: forecast.codes[index], rain: forecast.rain?.[index] ?? null };
}

function isWalletEmpty() {
  const total = [...Object.values(state.wallet.banks), ...Object.values(state.wallet.airlines)].reduce((a, b) => a + b, 0);
  return total === 0;
}

function computeResults() {
  const { home, data } = state;
  if (!home) return [];
  const homeDay = dayFor(state.homeForecast, state.date);

  return data.destinations
    .map((dest) => {
      const pricing = priceDestination(dest, home, state.trip, state.wallet, data, state.enabledPrograms);
      const day = state.weatherStatus === "ok" ? dayFor(state.forecasts.get(dest.code), state.date) : null;
      const gap = day && homeDay ? day.high - homeDay.high : null;
      const degPer1k = gap !== null && pricing.best ? gap / (pricing.best.points / 1000) : null;
      return { dest, ...pricing, day, gap, degPer1k, affordable: Boolean(pricing.best?.plan.covered) };
    })
    .filter((row) => row.miles >= MIN_TRIP_MILES && row.best);
}

/** Descending order with missing values last. */
function descending(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

const SORTS = {
  value: (a, b) => Number(b.affordable) - Number(a.affordable) || descending(a.degPer1k, b.degPer1k) || a.best.points - b.best.points,
  warmest: (a, b) => descending(a.day?.high, b.day?.high) || a.best.points - b.best.points,
  cheapest: (a, b) => a.best.points - b.best.points || a.miles - b.miles,
  closest: (a, b) => a.miles - b.miles,
};

function filterAndSort(rows) {
  const { tags, minTemp, affordableOnly } = state.filters;
  return rows
    .filter((row) => tags.size === 0 || row.dest.tags.some((tag) => tags.has(tag)))
    .filter((row) => !row.day || row.day.high >= minTemp)
    .filter((row) => !affordableOnly || row.affordable)
    .sort(SORTS[state.sort]);
}

/* ======================================================================
   Rendering
   ====================================================================== */

let renderQueued = false;

/** Batches rapid changes (like typing a balance) into one redraw per frame. */
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

/** Redraws everything. Pass { flip: true } when the board's contents changed
 *  because of something the user did, so the flaps spin to the new values. */
function render({ flip = false } = {}) {
  if (!state.data) return;
  const { data, unit } = state;
  const walletEmpty = isWalletEmpty();

  state.results = computeResults();
  state.visible = filterAndSort(state.results);

  // Wallet panel
  const powers = Object.fromEntries(data.airlines.map((a) => [a.id, buyingPower(a.id, state.wallet, data)]));
  ui.renderPower($("power-list"), data.airlines, powers, state.enabledPrograms);
  ui.updateTransferTable($("transfer-table"), state.wallet.banks);

  // Departures board
  const list = $("results-list");
  let emptyState = null;
  if (!state.home) emptyState = "no-home";
  else if (state.enabledPrograms.size === 0) emptyState = "no-programs";
  else if (state.visible.length === 0) emptyState = "no-match";

  const rows = state.showAll ? state.visible : state.visible.slice(0, BOARD_ROWS);
  ui.renderResults(list, rows, {
    home: state.home,
    unit,
    walletEmpty,
    weatherStatus: state.weatherStatus,
    data,
  });
  ui.renderEmpty($("empty-state"), emptyState);
  ui.renderSummary($("results-summary"), {
    shown: state.visible.length,
    total: state.results.length,
    reachable: state.results.filter((row) => row.affordable).length,
    walletEmpty,
    dateLabel: formatDay(state.date),
  });
  const more = $("show-all");
  more.hidden = state.showAll || state.visible.length <= BOARD_ROWS;
  more.textContent = `Show all ${state.visible.length} departures`;
  renderPanelSummaries(walletEmpty);

  // Map
  mapView.renderMarkers(
    state.visible.map((row) => ({
      code: row.dest.code,
      city: row.dest.city,
      lat: row.dest.lat,
      lon: row.dest.lon,
      color: row.day ? tempColor(row.day.high) : null,
      affordable: walletEmpty || row.affordable,
      tempLabel: row.day ? formatTemp(row.day.high, unit) : "",
    })),
  );
  if (!state.visible.some((row) => row.dest.code === state.activeCode)) state.activeCode = null;
  setActive(state.activeCode);

  // Hero: best value among warmer places you can afford, regardless of filters.
  const warmReachable = state.results.filter((row) => row.affordable && row.gap > 0);
  const top = [...warmReachable].sort(SORTS.value)[0] ?? null;
  ui.renderHero({
    home: state.home,
    homeDay: dayFor(state.homeForecast, state.date),
    unit,
    top: top && { ...top, programName: data.airlinesById[top.best.programId].short },
    reachableWarm: warmReachable.length,
    walletEmpty,
    homeWeatherStatus: state.weatherStatus === "loading" ? "loading" : state.homeWeatherStatus,
    weatherStatus: state.weatherStatus,
    destinationCount: data.destinations.length,
  });

  refreshDetail();
  if (flip) ui.flipBoard(document);
}

/** One-line recaps shown in each check-in panel's heading, even when collapsed. */
function renderPanelSummaries(walletEmpty) {
  const { home, trip } = state;
  $("origin-summary").textContent = home
    ? `${home.code} · ${formatDay(state.date)} · ${trip.roundTrip ? "Round trip" : "One way"}, ${trip.cabin}, ${trip.travelers}`
    : "Choose your airport";
  const total = [...Object.values(state.wallet.banks), ...Object.values(state.wallet.airlines)].reduce((a, b) => a + b, 0);
  $("wallet-summary").textContent = walletEmpty ? "Add your points" : `${formatNumber(total)} points and miles`;
}

function setActive(code) {
  state.activeCode = code;
  ui.setActiveTicket($("results-list"), code);
  mapView.highlight(code);
}

function showDetail(code) {
  setActive(code);
  const ticket = document.querySelector(`.ticket-item[data-code="${code}"]`);
  ticket?.scrollIntoView({ block: "nearest" });
  openDetail(code);
}

function detailContext(code) {
  return {
    result: state.results.find((row) => row.dest.code === code) ?? null,
    home: state.home,
    unit: state.unit,
    date: state.date,
    today: state.today,
    trip: state.trip,
    forecast: state.forecasts?.get(code) ?? null,
    weatherStatus: state.weatherStatus,
    data: state.data,
    rates: state.rates,
    ratesStatus: state.ratesStatus,
    retryRates: loadRates,
  };
}

/* ======================================================================
   User actions
   ====================================================================== */

function selectHome(airport, { fitMap = true } = {}) {
  state.home = airport;
  $("home-input").value = airportLabel(airport);
  $("home-error").textContent = "";
  persist();
  mapView.setHome(airport);
  loadHomeWeather();
  render({ flip: true });
  if (fitMap) mapView.fitTo(state.visible.slice(0, 8).map((row) => row.dest.code));
}

async function handleLocate() {
  const button = $("locate-btn");
  const status = $("locate-status");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  status.textContent = "Finding you…";

  try {
    const position = await getPosition();
    const { airport, miles } = nearestAirport(position.lat, position.lon, state.data.airports);
    selectHome(airport);
    status.textContent = `Found you! Flying from ${airport.name} (${airport.code}), ${formatNumber(miles)} mi away.`;
  } catch (error) {
    status.textContent = error.message;
    $("home-input").focus();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function handleHomeInput() {
  const input = $("home-input");
  if (!input.value.trim()) return;
  if (state.home && input.value === airportLabel(state.home)) return;
  const airport = findAirport(input.value, state.data.airports);
  if (airport) {
    selectHome(airport);
    $("locate-status").textContent = "";
  } else {
    $("home-error").textContent = "We couldn't find that airport. Try a city or a 3-letter code like STL.";
  }
}

function clampDate(iso) {
  const max = addDays(state.today, FORECAST_DAYS - 1);
  if (iso < state.today) return state.today;
  if (iso > max) return max;
  return iso;
}

function setDate(iso) {
  state.date = clampDate(iso);
  $("travel-date").value = state.date;
  render({ flip: true });
}

function applyTheme() {
  const dark = state.theme === "dark";
  document.documentElement.dataset.theme = state.theme;
  $("theme-color").content = dark ? "#0d0e0b" : "#ffffff";
  const toggle = $("theme-toggle");
  toggle.dataset.active = state.theme;
  toggle.setAttribute("aria-label", `Light or dark theme. ${dark ? "Dark" : "Light"} is on.`);
}

function updateUnitControls() {
  const toggle = $("unit-toggle");
  toggle.dataset.active = state.unit;
  toggle.setAttribute("aria-label", `°F or °C. Showing °${state.unit}.`);
  $("min-temp-out").textContent = formatTemp(state.filters.minTemp, state.unit);
}

function bindEvents() {
  const form = $("planner");

  // Enter in any field shouldn't reload the page.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (document.activeElement === $("home-input")) handleHomeInput();
  });

  // Wallet balances (event delegation over every card input).
  form.addEventListener("input", (event) => {
    const { kind, id } = event.target.dataset;
    if (!kind) return;
    const value = Math.floor(Number(event.target.value));
    const group = kind === "bank" ? state.wallet.banks : state.wallet.airlines;
    group[id] = Number.isFinite(value) && value > 0 ? value : 0;
    persist();
    scheduleRender();
  });

  $("program-toggles").addEventListener("change", (event) => {
    const { value, checked } = event.target;
    if (checked) state.enabledPrograms.add(value);
    else state.enabledPrograms.delete(value);
    persist();
    render({ flip: true });
  });

  $("clear-wallet").addEventListener("click", () => {
    for (const id of Object.keys(state.wallet.banks)) state.wallet.banks[id] = 0;
    for (const id of Object.keys(state.wallet.airlines)) state.wallet.airlines[id] = 0;
    form.querySelectorAll(".wallet-card__input").forEach((input) => {
      input.value = "";
    });
    persist();
    render();
    ui.toast("Wallet cleared.");
  });

  // Where & when
  $("locate-btn").addEventListener("click", handleLocate);
  $("home-input").addEventListener("change", handleHomeInput);
  $("travel-date").addEventListener("change", (event) => {
    if (event.target.value) setDate(event.target.value);
    else event.target.value = state.date;
  });
  form.querySelectorAll("[data-date-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      const weeksAhead = button.dataset.dateShortcut === "next-weekend" ? 1 : 0;
      setDate(upcomingSaturday(state.today, weeksAhead));
    });
  });
  form.querySelectorAll('input[name="trip"], input[name="cabin"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      state.trip.roundTrip = form.querySelector('input[name="trip"]:checked').value === "round";
      state.trip.cabin = form.querySelector('input[name="cabin"]:checked').value;
      persist();
      render({ flip: true });
    });
  });
  $("travelers").addEventListener("change", (event) => {
    state.trip.travelers = Number(event.target.value);
    persist();
    render({ flip: true });
  });

  // Results filters
  $("sort-select").addEventListener("change", (event) => {
    state.sort = event.target.value;
    render({ flip: true });
  });
  $("tag-filters").addEventListener("change", (event) => {
    const { value, checked } = event.target;
    if (checked) state.filters.tags.add(value);
    else state.filters.tags.delete(value);
    render({ flip: true });
  });
  $("min-temp").addEventListener("input", (event) => {
    state.filters.minTemp = Number(event.target.value);
    $("min-temp-out").textContent = formatTemp(state.filters.minTemp, state.unit);
    scheduleRender();
  });
  $("affordable-only").addEventListener("change", (event) => {
    state.filters.affordableOnly = event.target.checked;
    render({ flip: true });
  });

  $("theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    persist();
  });

  $("unit-toggle").addEventListener("click", () => {
    state.unit = state.unit === "F" ? "C" : "F";
    updateUnitControls();
    persist();
    render({ flip: true });
  });

  $("show-all").addEventListener("click", () => {
    state.showAll = true;
    render();
    // Keep keyboard users in place: focus the first row that just appeared.
    $("results-list").querySelectorAll(".ticket__open")[BOARD_ROWS]?.focus();
  });

  // Results list <-> map
  const list = $("results-list");
  list.addEventListener("click", (event) => {
    const button = event.target.closest(".ticket__open");
    if (button) showDetail(button.dataset.code);
  });
  const hoverTicket = (event) => {
    const item = event.target.closest(".ticket-item");
    if (item && item.dataset.code !== state.activeCode) setActive(item.dataset.code);
  };
  list.addEventListener("mouseover", hoverTicket);
  list.addEventListener("focusin", hoverTicket);
  list.addEventListener("mouseleave", () => {
    if (!isDetailOpen()) setActive(null);
  });
}

init();
