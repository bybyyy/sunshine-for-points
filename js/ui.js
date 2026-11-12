// DOM rendering for the planner and the results list. These functions only
// draw what they are given; main.js owns the state and decides when to call them.

import {
  deltaToUnit,
  describeWeather,
  formatNumber,
  formatRatio,
  formatTemp,
  tempColor,
} from "./format.js";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setIcon(svg, name) {
  svg.querySelector("use").setAttribute("href", `#i-${name}`);
}

/* ---------- Split-flap characters ---------- */

/**
 * Renders `text` as one flap tile per character. The tiles are hidden from
 * assistive tech; a visually hidden copy of `label` carries the meaning, so
 * the spinning letters in flipBoard() are never read out.
 */
export function setFlaps(node, text, label = text) {
  node.classList.add("flaps");
  const row = el("span", "flaps__row");
  row.setAttribute("aria-hidden", "true");
  for (const char of text) {
    const flap = el("span", "flap", char === " " ? " " : char);
    flap.dataset.final = flap.textContent;
    row.append(flap);
  }
  node.replaceChildren(row, el("span", "visually-hidden", label));
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
let flipToken = 0;

/**
 * Spins the flaps inside `root` through random characters, then lets them
 * land left to right, top to bottom, like a departures board updating.
 * Only the first rows animate; the rest are already off screen.
 */
export function flipBoard(root, { rows = 12 } = {}) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const token = ++flipToken;
  const groups = [
    ...root.querySelectorAll(".hero__title .flaps__row, .hero__compare:not([hidden]) .flaps__row"),
    ...[...root.querySelectorAll(".ticket-item")].slice(0, rows).flatMap((item) => [...item.querySelectorAll(".flaps__row")]),
  ];

  const flaps = [];
  let rowIndex = 0;
  for (const group of groups) {
    const isNewRow = group.closest(".ticket__route, .temp-chip__code");
    if (isNewRow) rowIndex += 1;
    [...group.children].forEach((flap, i) => {
      const final = flap.dataset.final;
      const set = /\d/.test(final) ? DIGITS : /[A-Z]/i.test(final) ? LETTERS : null;
      if (!set) return;
      flap.classList.add("is-spinning");
      flaps.push({ flap, final, set, stop: 160 + rowIndex * 55 + i * 45 });
    });
  }
  if (flaps.length === 0) return;

  const start = performance.now();
  let frame = 0;
  const tick = (now) => {
    if (token !== flipToken) return; // A newer flip took over.
    const elapsed = now - start;
    let pending = 0;
    frame += 1;
    for (const item of flaps) {
      if (item.done) continue;
      if (elapsed >= item.stop) {
        item.done = true;
        item.flap.textContent = item.final;
        item.flap.classList.remove("is-spinning");
        item.flap.classList.add("is-settled");
      } else {
        pending += 1;
        if (frame % 3 === 0) item.flap.textContent = item.set[Math.floor(Math.random() * item.set.length)];
      }
    }
    if (pending > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- Wallet ---------- */

export function buildWalletInputs(container, programs, values, kind) {
  const template = $("wallet-input-template");
  container.replaceChildren(
    ...programs.map((program) => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.style.setProperty("--brand", program.color);
      card.querySelector(".wallet-card__name").textContent = program.short;
      const input = card.querySelector("input");
      input.dataset.kind = kind;
      input.dataset.id = program.id;
      input.setAttribute("aria-label", `${program.name} balance`);
      input.value = values[program.id] ? String(values[program.id]) : "";
      return card;
    }),
  );
}

export function buildProgramToggles(container, airlines, enabled) {
  container.replaceChildren(
    ...airlines.map((airline) => {
      const label = el("label", "chip-check");
      label.style.setProperty("--chip-color", airline.color);
      const input = el("input");
      input.type = "checkbox";
      input.name = "program";
      input.value = airline.id;
      input.checked = enabled.has(airline.id);
      const face = el("span");
      face.append(el("span", "chip-check__dot"), airline.short);
      label.append(input, face);
      return label;
    }),
  );
}

export function buildTransferTable(table, banks, airlines, transfers) {
  const head = el("thead");
  const headRow = el("tr");
  headRow.append(el("th", "", "Bank"));
  for (const airline of airlines) {
    const th = el("th", "", airline.short);
    th.scope = "col";
    th.style.setProperty("--prog-color", airline.color);
    headRow.append(th);
  }
  head.append(headRow);

  const body = el("tbody");
  for (const bank of banks) {
    const row = el("tr");
    const th = el("th", "", bank.short);
    th.scope = "row";
    row.append(th);
    for (const airline of airlines) {
      const link = transfers.find((t) => t.from === bank.id && t.to === airline.id);
      const td = el("td", link ? "" : "is-none", link ? formatRatio(link.ratio) : "—");
      td.dataset.bank = bank.id;
      td.style.setProperty("--prog-color", airline.color);
      if (!link) td.setAttribute("aria-label", "No transfer");
      row.append(td);
    }
    body.append(row);
  }

  table.querySelectorAll("thead, tbody").forEach((node) => node.remove());
  table.append(head, body);
}

/** Highlights transfer routes the user can actually use (bank has a balance). */
export function updateTransferTable(table, bankBalances) {
  table.querySelectorAll("td[data-bank]").forEach((td) => {
    td.classList.toggle("is-live", !td.classList.contains("is-none") && bankBalances[td.dataset.bank] > 0);
  });
}

export function renderPower(list, airlines, powers, enabled) {
  const max = Math.max(1, ...Object.values(powers));
  list.replaceChildren(
    ...airlines.map((airline) => {
      const item = el("li", "power__item");
      item.classList.toggle("is-off", !enabled.has(airline.id));
      item.style.setProperty("--prog-color", airline.color);
      item.style.setProperty("--fill", `${(powers[airline.id] / max) * 100}%`);
      const value = enabled.has(airline.id) ? `${formatNumber(powers[airline.id])} ${airline.unit}` : "Off";
      item.append(el("span", "power__name", airline.short), el("span", "power__value", value), el("span", "power__bar"));
      return item;
    }),
  );
}

/* ---------- Airport search & filters ---------- */

export function buildAirportOptions(datalist, airports, labelFor) {
  const fragment = document.createDocumentFragment();
  for (const airport of airports) {
    const option = document.createElement("option");
    option.value = labelFor(airport);
    option.label = airport.name;
    fragment.append(option);
  }
  datalist.replaceChildren(fragment);
}

const TAG_LABELS = {
  beach: "Beaches",
  islands: "Islands",
  city: "Cities",
  food: "Food",
  culture: "Culture",
  nature: "Nature",
  desert: "Desert",
};

export function buildTagFilters(fieldset, activeTags) {
  const legend = fieldset.querySelector("legend");
  const chips = Object.entries(TAG_LABELS).map(([tag, label]) => {
    const wrapper = el("label", "chip-check");
    const input = el("input");
    input.type = "checkbox";
    input.name = "tag";
    input.value = tag;
    input.checked = activeTags.has(tag);
    wrapper.append(input, el("span", "", label));
    return wrapper;
  });
  fieldset.replaceChildren(legend, ...chips);
}

/* ---------- Departures board ---------- */

/**
 * results: computed rows from main.js
 * ctx: { home, unit, walletEmpty, weatherStatus, data }
 */
export function renderResults(list, results, ctx) {
  const template = $("ticket-template");
  list.replaceChildren(...results.map((result) => buildTicket(template, result, ctx)));
}

function buildTicket(template, result, ctx) {
  const { dest, best, options, miles, day, gap, degPer1k } = result;
  const item = template.content.firstElementChild.cloneNode(true);
  const ticket = item.querySelector(".ticket");
  item.dataset.code = dest.code;
  item.classList.toggle("is-out", !ctx.walletEmpty && !result.affordable);

  item.querySelector(".ticket__from").textContent = ctx.home.code;
  setFlaps(item.querySelector(".ticket__to"), dest.code, `Flight to ${dest.code}`);
  item.querySelector(".ticket__distance").textContent = `${formatNumber(miles)} mi`;
  item.querySelector(".ticket__via").title = `${ctx.home.code} to ${dest.code}, ${formatNumber(miles)} miles`;

  const open = item.querySelector(".ticket__open");
  open.dataset.code = dest.code;
  open.append(dest.city, " ", el("span", "ticket__country", dest.country));

  item.querySelector(".ticket__pitch").textContent = dest.pitch;
  item.querySelector(".ticket__best").append(buildStamp(best, result.affordable, ctx));

  const others = item.querySelector(".ticket__others");
  for (const option of options) {
    if (option === best) continue;
    const airline = ctx.data.airlinesById[option.programId];
    const li = el("li");
    li.append(`${airline.short} `, el("b", "", formatNumber(option.points)));
    others.append(li);
  }

  // Weather stub
  const icon = item.querySelector(".ticket__icon");
  const temp = item.querySelector(".ticket__temp");
  const skyRow = item.querySelector(".ticket__sky");
  const sky = item.querySelector(".ticket__sky-text");
  const value = item.querySelector(".ticket__value");

  if (ctx.weatherStatus === "loading") {
    setFlaps(temp, "00°", "Loading the forecast");
    temp.classList.add("is-loading");
    sky.textContent = "Checking sky…";
    setIcon(icon, "partly");
  } else if (day) {
    const weather = describeWeather(day.code);
    const high = formatTemp(day.high, ctx.unit, false);
    ticket.style.setProperty("--temp", tempColor(day.high));
    setFlaps(temp, high, `High of ${high}`);
    temp.classList.add("flaps--temp");
    const wet = day.rain >= 40;
    sky.textContent = wet ? `${weather.label} · ${day.rain}%` : weather.label;
    skyRow.classList.toggle("is-wet", wet);
    setIcon(icon, weather.icon);
    if (gap !== null && degPer1k !== null) {
      const sign = gap >= 0 ? "+" : "−";
      const gapText = `${sign}${Math.abs(Math.round(deltaToUnit(gap, ctx.unit)))}°`;
      const perK = deltaToUnit(degPer1k, ctx.unit).toFixed(1);
      value.replaceChildren(
        el("b", "ticket__perk", perK),
        el("span", "ticket__gap", gapText),
        el("span", "visually-hidden", ` degrees per 1,000 points`),
      );
      value.title = `${gapText} warmer than home, or ${perK}° per 1,000 points`;
    }
  } else {
    setFlaps(temp, "—", "No forecast");
    temp.classList.add("flaps--blank");
    sky.textContent = ctx.weatherStatus === "error" ? "Forecast unavailable" : "No forecast";
    setIcon(icon, "cloud");
  }

  return item;
}

function buildStamp(best, affordable, ctx) {
  const stamp = el("p", "stamp");
  if (!best) {
    stamp.textContent = "No program selected";
    return stamp;
  }
  const airline = ctx.data.airlinesById[best.programId];
  stamp.style.setProperty("--prog-color", airline.color);
  const points = el("span", "stamp__points", formatNumber(best.points));

  if (ctx.walletEmpty) {
    stamp.append(`Cheapest: ${airline.short}`, points);
  } else if (affordable) {
    stamp.append(`Book with ${airline.short}`, points);
  } else {
    stamp.classList.add("stamp--short");
    stamp.append(el("span", "stamp__points", formatNumber(best.plan.shortBy)), `short via ${airline.short}`);
  }
  return stamp;
}

export function setActiveTicket(list, code) {
  list.querySelectorAll(".ticket-item").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.code === code);
  });
}

export function renderSummary(target, { shown, total, reachable, walletEmpty, dateLabel }) {
  target.replaceChildren();
  if (total === 0) return;
  target.append(el("strong", "", String(shown)), ` of ${total} destinations match`);
  if (!walletEmpty) {
    target.append(" · ", el("strong", "", String(reachable)), " within reach");
  }
  target.append(` · weather for ${dateLabel}`);
}

export function renderEmpty(container, state) {
  const messages = {
    "no-home": [
      "Where are you flying from?",
      "Use your location or choose a home airport under Origin, and we'll price every destination from there.",
    ],
    "no-match": [
      "Nothing matches those filters.",
      "Try a lower temperature, clear a trip-style filter, or turn off “Only what I can afford.”",
    ],
    "no-programs": ["Pick at least one program.", "Turn on Avios, Asia Miles or Atmos under “Book with” in your wallet."],
    "data-error": [
      "The app's data didn't load.",
      "Please refresh the page. If you opened index.html straight from your files, run it from a local web server instead.",
    ],
  };
  container.hidden = !state;
  if (!state) return;
  const [title, text] = messages[state];
  $("empty-title").textContent = title;
  $("empty-text").textContent = text;
}

/* ---------- Hero ---------- */

/**
 * ctx: { home, homeDay, unit, top, reachableWarm, walletEmpty, homeWeatherStatus, weatherStatus, destinationCount }
 */
export function renderHero(ctx) {
  const title = $("hero-title");
  const sub = $("hero-sub");
  const compare = $("hero-compare");
  const { home, homeDay, unit, top } = ctx;
  // Once there's a home airport the board matters more, so the headline shrinks.
  $("hero").classList.toggle("hero--compact", Boolean(home));

  if (!home) {
    title.textContent = "Trade your points for sunshine.";
    sub.textContent =
      "Tell us what's in your wallet and where you're starting. We'll find every warm place your points can reach, priced three ways.";
    compare.hidden = true;
    return;
  }

  const city = home.city;
  if (homeDay) {
    const word = el("span", "temp-word flaps--temp");
    setFlaps(word, formatTemp(homeDay.high, unit));
    word.style.setProperty("--temp", tempColor(homeDay.high));
    const sky = describeWeather(homeDay.code).adjective;
    title.replaceChildren("It's ", word, ` and ${sky} in ${city}.`);
  } else {
    title.replaceChildren(`Departing from ${city}.`);
  }

  if (ctx.homeWeatherStatus === "loading") {
    sub.textContent = `Checking the forecast at home and at ${ctx.destinationCount} destinations…`;
  } else if (ctx.weatherStatus === "error") {
    sub.textContent = "We couldn't get the forecast, so temperatures are missing for now. The fares on the board are still right.";
  } else if (ctx.walletEmpty) {
    sub.textContent = "Add your point balances to the wallet to see which trips you can actually afford.";
  } else if (top && ctx.reachableWarm > 0) {
    const lead = homeDay && homeDay.high >= 80 ? "It's already warm, but still: your" : "Your";
    sub.textContent = `${lead} points reach ${ctx.reachableWarm} warmer ${
      ctx.reachableWarm === 1 ? "place" : "places"
    }. Best value: ${top.dest.city} at ${formatTemp(top.day.high, unit)} for ${formatNumber(top.best.points)} ${top.programName}.`;
  } else {
    sub.textContent = "Nothing warmer is in reach yet. Try one way, economy, or a closer date.";
  }

  const homeTemp = homeDay ? homeDay.high : null;
  const awayTemp = top?.day ? top.day.high : null;
  compare.hidden = homeTemp === null || awayTemp === null || ctx.walletEmpty;
  if (!compare.hidden) {
    const homeText = formatTemp(homeTemp, unit, false);
    const awayText = formatTemp(awayTemp, unit, false);
    setFlaps($("hero-home-code"), home.code, `Home, ${home.city}`);
    setFlaps($("hero-home-temp"), homeText, homeText);
    setFlaps($("hero-away-code"), top.dest.code, `Best value, ${top.dest.city}`);
    setFlaps($("hero-away-temp"), awayText, awayText);
    $("hero-home-temp").classList.add("flaps--temp");
    $("hero-away-temp").classList.add("flaps--temp");
    $("hero-home-temp").parentElement.style.setProperty("--temp-color", tempColor(homeTemp));
    $("hero-away-temp").parentElement.style.setProperty("--temp-color", tempColor(awayTemp));
  }
}

/* ---------- Banner & toast ---------- */

let bannerRetry = null;

export function showBanner(message, onRetry = null) {
  $("banner-text").textContent = message;
  $("banner-retry").hidden = !onRetry;
  bannerRetry = onRetry;
  $("banner").hidden = false;
}

export function hideBanner() {
  $("banner").hidden = true;
  bannerRetry = null;
}

export function initBanner() {
  $("banner-close").addEventListener("click", hideBanner);
  $("banner-retry").addEventListener("click", () => {
    const retry = bannerRetry;
    hideBanner();
    retry?.();
  });
}

let toastTimer = null;

export function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 3200);
}
