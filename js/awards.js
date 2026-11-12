// Award pricing: pure functions with no DOM and no network.
//
// The flow for one destination:
//   distance -> price in each program's chart -> how to pay for it from the
//   user's wallet -> pick the program that spends the least value.

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance between two points, in statute miles. */
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

function findBand(bands, miles) {
  return bands.find((band) => band.maxMiles === null || miles <= band.maxMiles);
}

function bandRangeLabel(bands, band) {
  const index = bands.indexOf(band);
  const low = index === 0 ? 1 : bands[index - 1].maxMiles + 1;
  const fmt = (n) => n.toLocaleString("en-US");
  return band.maxMiles === null ? `${fmt(low)}+ mi` : `${fmt(low)}–${fmt(band.maxMiles)} mi`;
}

/**
 * One-way, one-traveler price from a chart.
 * route = { miles, cabin, originCountry, region }
 * Returns { points, label, estimated } or null if the chart can't price it.
 */
export function oneWayPrice(chart, route) {
  let bands;
  let chartLabel = "";
  let miles = route.miles;

  if (chart.type === "distance") {
    bands = chart.bands;
    const floor = chart.domesticFloor;
    if (
      floor &&
      floor.originCountries.includes(route.originCountry) &&
      floor.destinationRegions.includes(route.region)
    ) {
      miles = Math.max(miles, floor.minMiles);
    }
  } else if (chart.type === "regional-distance") {
    const chartName = chart.regionCharts[route.region];
    const subChart = chart.charts[chartName];
    if (!subChart) {
      return null;
    }
    bands = subChart.bands;
    chartLabel = subChart.label;
  } else {
    return null;
  }

  const band = findBand(bands, miles);
  if (!band) {
    return null;
  }

  const zone = band.zone !== undefined ? (typeof band.zone === "number" ? `Zone ${band.zone}` : band.zone) : "";
  const label = [chartLabel, zone, bandRangeLabel(bands, band)].filter(Boolean).join(" · ");

  return {
    points: band[route.cabin],
    label,
    estimated: Boolean(band.estimated),
  };
}

/** Every bank that can transfer into `programId`, with its ratio and bank info. */
export function transferSources(programId, data) {
  return data.transfers
    .filter((link) => link.to === programId)
    .map((link) => ({ ...link, bank: data.banksById[link.from] }));
}

/** Largest number of points a bank lets you move (transfers go in fixed steps). */
function transferable(balance, step) {
  return Math.floor(balance / step) * step;
}

/** Total airline miles the wallet could produce for one program. */
export function buyingPower(programId, wallet, data) {
  const held = wallet.airlines[programId] || 0;
  return transferSources(programId, data).reduce((sum, source) => {
    const balance = wallet.banks[source.from] || 0;
    return sum + Math.round(transferable(balance, source.bank.step) * source.ratio);
  }, held);
}

/**
 * Cheapest way to pay `cost` miles in `programId`.
 *   1. Miles already in the airline account.
 *   2. Bank transfers, cheapest effective cost per airline mile first
 *      (bank cents-per-point / ratio), rounded up to the bank's transfer step.
 *
 * Returns { steps, covered, shortBy, value } where value is the dollar value
 * of everything spent (using our cents-per-point estimates).
 */
export function fundingPlan(programId, cost, wallet, data) {
  const airline = data.airlinesById[programId];
  const steps = [];
  let remaining = cost;
  let value = 0;

  const held = Math.min(wallet.airlines[programId] || 0, remaining);
  if (held > 0) {
    steps.push({ type: "held", programId, miles: held });
    remaining -= held;
    value += (held * airline.cpp) / 100;
  }

  const sources = transferSources(programId, data)
    .map((source) => ({ ...source, costPerMile: source.bank.cpp / source.ratio }))
    .sort((a, b) => a.costPerMile - b.costPerMile);

  for (const source of sources) {
    if (remaining <= 0) {
      break;
    }
    const { step } = source.bank;
    const available = transferable(wallet.banks[source.from] || 0, step);
    if (available <= 0) {
      continue;
    }
    const needed = Math.ceil(remaining / source.ratio / step) * step;
    const points = Math.min(needed, available);
    const miles = Math.round(points * source.ratio);
    steps.push({ type: "transfer", bankId: source.from, programId, points, miles });
    remaining -= miles;
    value += (points * source.bank.cpp) / 100;
  }

  return {
    steps,
    covered: remaining <= 0,
    shortBy: Math.max(0, remaining),
    value,
  };
}

/**
 * Prices one destination in every enabled program and picks the best.
 * trip = { cabin, travelers, roundTrip }
 */
export function priceDestination(dest, home, trip, wallet, data, enabledPrograms) {
  const miles = haversineMiles(home.lat, home.lon, dest.lat, dest.lon);
  const route = {
    miles,
    cabin: trip.cabin,
    originCountry: home.country,
    region: dest.region,
  };
  const multiplier = trip.travelers * (trip.roundTrip ? 2 : 1);

  const options = data.airlines
    .filter((airline) => enabledPrograms.has(airline.id))
    .map((airline) => {
      const price = oneWayPrice(data.charts[airline.id], route);
      if (!price) {
        return null;
      }
      const points = price.points * multiplier;
      return {
        programId: airline.id,
        points,
        label: price.label,
        estimated: price.estimated,
        plan: fundingPlan(airline.id, points, wallet, data),
      };
    })
    .filter(Boolean);

  return { miles, options, best: pickBest(options) };
}

/** Affordable options: least value spent wins. Otherwise: the one you're closest to. */
export function pickBest(options) {
  if (options.length === 0) {
    return null;
  }
  const affordable = options.filter((option) => option.plan.covered);
  if (affordable.length > 0) {
    return affordable.reduce((best, option) =>
      option.plan.value < best.plan.value ||
      (option.plan.value === best.plan.value && option.points < best.points)
        ? option
        : best,
    );
  }
  return options.reduce((best, option) =>
    option.plan.shortBy < best.plan.shortBy ? option : best,
  );
}
