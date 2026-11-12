// The destination drawer: Wikipedia summary, forecast strip, the
// "same seat, three prices" comparison, how to pay, and spending money.

import { fetchWikiSummary } from "./api.js";
import {
  describeWeather,
  formatDay,
  formatMoney,
  formatNumber,
  formatTemp,
  formatUSD,
  tempColor,
  weekdayShort,
} from "./format.js";
import { shareTrip } from "./share.js";
import { toast } from "./ui.js";

const $ = (id) => document.getElementById(id);

const dialog = $("detail");
let getContext = null;
let currentCode = null;
let selectedProgram = null;
let wikiRequest = 0; // Bumped on every load so a slow, older answer is ignored.
let onCloseCallback = () => {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

/**
 * contextFor(code) must return:
 * { result, home, unit, date, today, trip, forecast, weatherStatus, data, rates, ratesStatus, retryRates }
 */
export function initDetail({ contextFor, onClose }) {
  getContext = contextFor;
  onCloseCallback = onClose;

  $("detail-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    wikiRequest += 1;
    currentCode = null;
    onCloseCallback();
  });
  // Clicking the dimmed backdrop (outside the drawer) closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  $("detail-prices").addEventListener("change", (event) => {
    selectedProgram = event.target.value;
    renderFunding(getContext(currentCode));
  });
  $("budget-input").addEventListener("input", () => renderMoney(getContext(currentCode)));
  $("share-btn").addEventListener("click", handleShare);
}

export function isDetailOpen() {
  return dialog.open;
}

export function openDetail(code) {
  const ctx = getContext(code);
  if (!ctx?.result) return;
  currentCode = code;
  selectedProgram = ctx.result.best?.programId ?? null;
  renderAll(ctx);
  loadWiki(ctx.result.dest);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

/** Re-render with fresh state (e.g. weather or rates just arrived). */
export function refreshDetail() {
  if (!dialog.open || !currentCode) return;
  const ctx = getContext(currentCode);
  if (!ctx?.result) {
    dialog.close();
    return;
  }
  if (!ctx.result.options.some((option) => option.programId === selectedProgram)) {
    selectedProgram = ctx.result.best?.programId ?? null;
  }
  renderAll(ctx);
}

function renderAll(ctx) {
  const { dest } = ctx.result;
  $("detail-route").textContent = `${ctx.home.code} → ${dest.code} · ${formatNumber(ctx.result.miles)} mi`;
  $("detail-city").textContent = dest.city;
  $("detail-country").textContent = dest.country;
  $("detail-pitch").textContent = dest.pitch;
  const highColor = ctx.result.day ? tempColor(ctx.result.day.high) : null;
  dialog.style.setProperty("--temp", highColor ?? "var(--amber)");

  renderForecast(ctx);
  renderPrices(ctx);
  renderFunding(ctx);
  renderMoney(ctx);
}

/* ---------- Forecast strip: five days around the travel date ---------- */

function renderForecast(ctx) {
  const list = $("detail-forecast");
  const forecast = ctx.forecast;
  if (!forecast) {
    const message = ctx.weatherStatus === "loading" ? "Loading the forecast…" : "No forecast available right now.";
    list.replaceChildren(el("li", "forecast__empty", message));
    return;
  }
  const index = forecast.dates.indexOf(ctx.date);
  const center = index === -1 ? 0 : index;
  const start = Math.max(0, Math.min(center - 2, forecast.dates.length - 5));

  const items = [];
  for (let i = start; i < start + 5 && i < forecast.dates.length; i += 1) {
    const iso = forecast.dates[i];
    const weather = describeWeather(forecast.codes[i]);
    const li = el("li");
    li.classList.toggle("is-selected", iso === ctx.date);
    li.style.setProperty("--day-color", tempColor(forecast.highs[i]));
    li.title = `${formatDay(iso, "long")}: ${weather.label}`;
    li.append(
      el("span", "", iso === ctx.today ? "Today" : weekdayShort(iso)),
      icon(weather.icon),
      el("span", "forecast__temp", formatTemp(forecast.highs[i], ctx.unit, false)),
      el("span", "visually-hidden", weather.label),
    );
    items.push(li);
  }
  list.replaceChildren(...items);
}

/* ---------- Same seat, three prices ---------- */

function renderPrices(ctx) {
  const fieldset = $("detail-prices");
  const legend = fieldset.querySelector("legend");
  const { options, best } = ctx.result;
  const { travelers, roundTrip, cabin } = ctx.trip;

  $("prices-note").textContent = `Points needed for ${travelers} ${travelers === 1 ? "traveler" : "travelers"}, ${
    roundTrip ? "round trip" : "one way"
  }, ${cabin}. Pick a program to see how to pay.`;

  // Tag the best affordable option; if nothing is affordable, tag the cheapest one.
  const anyCovered = options.some((option) => option.plan.covered);
  const fewest = options.reduce((min, option) => (option.points < min.points ? option : min), options[0]);
  const tagged = anyCovered ? best : fewest;
  const tagText = anyCovered ? "Best for you" : "Fewest points";

  const rows = options.map((option) => {
    const airline = ctx.data.airlinesById[option.programId];
    const label = el("label", "price-option");
    label.style.setProperty("--prog-color", airline.color);

    const input = el("input");
    input.type = "radio";
    input.name = "detail-program";
    input.value = option.programId;
    input.checked = option.programId === selectedProgram;

    const name = el("span", "price-option__name", airline.short);
    if (option === tagged) {
      name.append(el("span", "price-option__tag", tagText));
    }

    // Row 1, right: the price of the trip in this program.
    const cost = el("span", "price-option__cost");
    cost.append(formatNumber(option.points), el("span", "price-option__unit", ` ${airline.unit}`));

    // Row 2, left: which chart band set the price.
    const meta = el(
      "span",
      "price-option__meta",
      `Price band: ${option.label}${option.estimated ? " (estimated)" : ""}`,
    );

    // Row 2, right: can the user pay for it?
    const status = el("span", "price-option__status");
    if (option.plan.covered) {
      status.classList.add("is-ok");
      status.textContent = `✓ You can book · uses ≈ ${formatUSD(option.plan.value)} of points`;
    } else {
      const have = option.points - option.plan.shortBy;
      status.classList.add("is-short");
      status.textContent = `You have ${formatNumber(have)} of ${formatNumber(option.points)}`;
    }

    label.append(input, name, cost, meta, status);
    return label;
  });

  fieldset.replaceChildren(legend, ...rows);
}

/* ---------- How to pay ---------- */

function pill(text, color) {
  const node = el("span", "pill");
  node.style.setProperty("--pill-color", color);
  node.append(el("span", "pill__dot"), text);
  return node;
}

function renderFunding(ctx) {
  const box = $("detail-funding");
  const option = ctx?.result.options.find((o) => o.programId === selectedProgram);
  if (!option) {
    box.replaceChildren();
    return;
  }
  const airline = ctx.data.airlinesById[option.programId];
  const { plan } = option;
  const travelers = ctx.trip.travelers;
  const tripWord = `${ctx.trip.roundTrip ? "round trip" : "one way"}${travelers > 1 ? `, ${travelers} travelers` : ""}`;

  const title = el("p", "funding__title", `Paying with ${airline.short} (${tripWord})`);
  const steps = el("ol", "funding__steps");

  for (const step of plan.steps) {
    const li = el("li", "funding__step");
    if (step.type === "held") {
      li.append(pill(`${formatNumber(step.miles)} ${airline.unit}`, airline.color), "already in your account");
    } else {
      const bank = ctx.data.banksById[step.bankId];
      li.append(
        "Move",
        pill(`${formatNumber(step.points)} ${bank.short}`, bank.color),
        icon("arrow"),
        pill(`${formatNumber(step.miles)} ${airline.unit}`, airline.color),
      );
    }
    steps.append(li);
  }

  const summary = el("p", "funding__total");
  if (plan.covered) {
    summary.textContent = `Covers all ${formatNumber(option.points)} ${airline.unit}, using about ${formatUSD(
      plan.value,
    )} worth of points. Taxes and fees are extra.`;
  } else {
    const feeders = ctx.data.transfers
      .filter((t) => t.to === option.programId)
      .map((t) => ctx.data.banksById[t.from].short);
    const feederText = feeders.length ? ` ${airline.short} accepts transfers from ${listJoin(feeders)}.` : "";
    summary.textContent = plan.steps.length
      ? `That still leaves you ${formatNumber(plan.shortBy)} ${airline.unit} short.${feederText}`
      : `None of your points can reach ${airline.short} yet.${feederText}`;
  }

  box.replaceChildren(title, ...(plan.steps.length ? [steps] : []), summary);
}

function listJoin(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ---------- Spending money (Frankfurter) ---------- */

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });

function currencyLabel(code) {
  const name = currencyNames.of(code);
  return name && name !== code ? `${name} (${code})` : code;
}

function formatRate(rate) {
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 }).format(rate);
}

function renderMoney(ctx) {
  if (!ctx) return;
  const { dest } = ctx.result;
  const currency = dest.currency;
  const budget = Math.max(0, Number($("budget-input").value) || 0);
  const out = $("budget-out");
  const intro = $("money-intro");
  const rateLine = $("rate-line");
  const note = $("rate-note");

  $("budget-out-currency").textContent = currencyLabel(currency);
  intro.textContent = `How far your cash goes in ${dest.city}. Type a budget in US dollars to convert it into ${currencyLabel(
    currency,
  )} at today's exchange rate.`;

  if (currency === "USD") {
    out.textContent = formatUSD(budget);
    intro.textContent = `${dest.city} uses the US dollar, so your budget stays the same. No currency exchange needed.`;
    rateLine.textContent = "";
    note.textContent = "";
    return;
  }

  const liveRate = ctx.rates?.rates[currency];
  const peg = ctx.data.pegs[currency];
  const rate = liveRate ?? peg;

  if (rate) {
    out.textContent = formatMoney(budget * rate, currency);
    rateLine.textContent = `Exchange rate: 1 USD = ${formatRate(rate)} ${currency}`;
    note.textContent = liveRate
      ? `European Central Bank reference rate for ${formatDay(ctx.rates.date)}, via the Frankfurter API.`
      : `${currency} is pegged to the US dollar by its central bank, so this rate holds steady.`;
    return;
  }

  out.textContent = "—";
  rateLine.textContent = "";
  if (ctx.ratesStatus === "ok") {
    intro.textContent = `How far your cash goes in ${dest.city}. There's no live exchange rate for ${currencyLabel(
      currency,
    )}, so we can't convert this one.`;
  }
  if (ctx.ratesStatus === "loading") {
    note.textContent = "Loading today's exchange rates…";
  } else if (ctx.ratesStatus === "error") {
    const retry = el("button", "btn btn--ghost btn--small", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => {
      note.textContent = "Loading today's exchange rates…";
      ctx.retryRates();
    });
    note.replaceChildren("We couldn't load exchange rates right now. ", retry);
  } else {
    note.textContent = `The European Central Bank doesn't publish a rate for ${currency}. Pay with a card that has no foreign transaction fee and your bank will convert at the card network's rate.`;
  }
}

/* ---------- Wikipedia ---------- */

async function loadWiki(dest) {
  wikiRequest += 1;
  const request = wikiRequest;

  const slot = $("detail-photo-slot");
  const extract = $("detail-extract");
  const credit = $("detail-credit");
  slot.replaceChildren(); // The gradient behind the slot shows until a photo loads.
  extract.textContent = "Loading a quick introduction…";
  credit.replaceChildren();

  try {
    // A few country pages lead with a flag, so those destinations take their
    // photo from a more scenic page (photoWiki) instead.
    const [summary, photoPage] = await Promise.all([
      fetchWikiSummary(dest.wiki),
      dest.photoWiki ? fetchWikiSummary(dest.photoWiki).catch(() => null) : null,
    ]);
    if (request !== wikiRequest) return; // The user moved on to another destination.

    extract.textContent = summary.extract || dest.pitch;
    const link = el("a", "", "Wikipedia");
    link.href = summary.pageUrl;
    link.target = "_blank";
    link.rel = "noopener";
    credit.append("Summary and photo from ", link, ", available under CC BY-SA.");

    const photoSource = dest.photoWiki ? photoPage : summary;
    if (photoSource?.image) {
      slot.append(buildPhoto(photoSource, dest));
    }
  } catch (error) {
    if (request !== wikiRequest) return;
    extract.textContent = `We couldn't load the Wikipedia summary for ${dest.city} right now. ${error.message}`;
  }
}

/**
 * Wikipedia doesn't send a caption, but photo file names usually describe the
 * scene: ".../Old_San_Juan_skyline.jpg" -> "Old San Juan skyline".
 * Names with no real words in them fall back to a plain description.
 */
function photoAlt(imageUrl, dest) {
  const fallback = `A view of ${dest.city}, ${dest.country}`;
  const words = decodeURIComponent(new URL(imageUrl).pathname.split("/").pop())
    .replace(/^\d+px-/, "") // the size prefix Wikipedia adds
    .replace(/(\.\w{2,4})+$/, "") // file extension(s)
    .replace(/\d{4}-\d{2}-\d{2}/g, "") // dates
    .replace(/[_-]+/g, " ")
    .replace(/\((crop\w*|\d+)\)|\b\d{4,}\b/gi, "") // "(cropped)", "(34)", years and photo numbers
    .replace(/\b(dsc|img|collage)\w*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return /[a-z]{4}/i.test(words) && words.length < 90 ? words : fallback;
}

function buildPhoto(summary, dest) {
  const photo = el("img", "detail__photo");
  photo.alt = photoAlt(summary.image, dest);
  photo.decoding = "async";
  photo.addEventListener("error", () => {
    if (summary.imageFallback && photo.src !== summary.imageFallback) {
      photo.src = summary.imageFallback; // The wider size didn't exist; use Wikipedia's own thumbnail.
    } else {
      photo.remove(); // The gradient behind it shows instead.
    }
  });
  photo.src = summary.image;
  return photo;
}

/* ---------- Share (Web Share API, Clipboard fallback) ---------- */

async function handleShare() {
  const ctx = getContext(currentCode);
  if (!ctx) return;
  const { dest, day } = ctx.result;
  const option = ctx.result.options.find((o) => o.programId === selectedProgram) ?? ctx.result.best;
  const airline = ctx.data.airlinesById[option.programId];
  const weather = day ? ` ${formatTemp(day.high, ctx.unit)} and ${describeWeather(day.code).adjective} on ${formatDay(ctx.date)}.` : "";

  const url = new URL(window.location.href);
  url.hash = new URLSearchParams({ from: ctx.home.code, to: dest.code, date: ctx.date }).toString();

  const result = await shareTrip({
    title: `${ctx.home.code} → ${dest.code} on points`,
    text: `${ctx.home.code} → ${dest.code}: ${dest.city} for ${formatNumber(option.points)} ${airline.short}.${weather} Found with Sunshine for Points.`,
    url: url.toString(),
  });

  if (result === "failed") {
    // Last resort: put the trip link in the address bar so it can be copied by hand.
    history.replaceState(null, "", url);
  }
  const messages = {
    shared: "Shared. Enjoy the sun!",
    copied: "Trip link copied to your clipboard.",
    failed: "Couldn't copy automatically. The trip link is now in your address bar.",
  };
  if (messages[result]) toast(messages[result]);
}

