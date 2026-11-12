# Sunshine for Points

Live site: https://bybyyy.github.io/sunshine-for-points/

Enter your credit card point balances and your home airport, and the app shows every warmer destination you can fly to in the next two weeks, with each one priced in three airline programs.

## Why I built this

Winter gets cold, and credit card points tend to sit around unused. The hard part of using points isn't finding a flight, it's working out which airline program to transfer to and whether you even have enough. Most points sites assume you already know that. This app does the math for you and sorts the answer by how much warmer it is than home.

## The idea

Bank points (Chase, Amex, Capital One, Citi, Bilt, Marriott) can be transferred to airline programs. Three of those programs price award seats with **fixed, distance-based charts**, so the cost of a flight can actually be calculated:

| Program | Airline | Fed by |
|---|---|---|
| **Avios** | British Airways | Chase, Amex, Capital One, Bilt, Marriott |
| **Asia Miles** | Cathay Pacific | Amex (1:0.8), Capital One, Citi, Bilt, Marriott |
| **Atmos Rewards** | Alaska Airlines | Bilt, Marriott |

All three airlines are in the oneworld alliance, so the same seat can often be booked through any of them **at three different prices**. For each destination, the app:

1. measures the great-circle distance from your home airport,
2. prices the trip in each program's chart,
3. finds the cheapest way to pay from *your* wallet (miles you already hold first, then the bank points worth the least),
4. ranks everything by **°/1k pts**: degrees warmer than home per 1,000 points spent.

## APIs used

| API | Type | What it does here | Failure handling |
|---|---|---|---|
| **Geolocation** | Browser | Finds your nearest major airport | If denied, unavailable or timed out: friendly message, focus moves to the airport search box |
| **Open-Meteo** | Data | 14-day forecast for home + 80 destinations in **one batched request**, cached for an hour | Banner with *Try again*; prices still work and temperatures show "—" |
| **Frankfurter** (ECB rates) | Data | Converts your spending money into the local currency | Falls back to fixed USD pegs (e.g. XCD, AED); otherwise explains why there's no rate and offers *Try again* |
| **Wikipedia REST** | Data | Destination summary + photo | Text message plus a gradient placeholder image |
| **Web Share** → **Clipboard** | Browser | "Share this trip" | Share sheet → clipboard → puts the link in the address bar |
| **Web Storage** | Browser | Remembers wallet, home airport and units, and caches forecasts for an hour | Wrapped in try/catch; the app works without it |

All APIs need no key and allow direct requests from the browser, which a static GitHub Pages site requires.

## Project structure

```
index.html            Page structure, icon sprite, <template>s
css/styles.css        Design tokens, layout, components (light + dark)
js/main.js            App state, event wiring, render loop
js/awards.js          Pure award math: distance, charts, funding plans
js/api.js             fetch wrapper with timeouts + every API call
js/location.js        Geolocation + nearest airport + airport search
js/map.js             Leaflet map, temperature markers, great-circle route
js/ui.js              Rendering for wallet, tickets, hero, banner, toast
js/detail.js          Destination drawer (forecast, prices, money, Wikipedia, share)
js/share.js           Web Share with Clipboard fallback
js/storage.js         Safe localStorage wrapper
js/format.js          Numbers, temperatures, weather codes, dates
data/                 Airports, destinations, banks, airlines, transfers, award charts
```

## Running locally

ES modules and `fetch()` of local JSON don't work from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (VS Code's Live Server extension works too.)

## Data notes

- **Award charts** (`data/charts/`) come from published and widely reported pricing as of November 2026. BA zones 5–9 are marked `"estimated"` (BA raised them about 10% in December 2025 without publishing exact numbers). Cathay no longer publishes a chart, so Asia Miles uses the widely reported partner pricing.
- **Transfer ratios** (`data/transfers.json`) change often. Check them on each bank's site before transferring.
- **Point values** (cents per point) are the app's own estimates, used only to compare options.
- Airports come from [OurAirports](https://ourairports.com/data/) (public domain), filtered to large airports with scheduled service.
- Prices are estimates for a direct oneworld flight. They don't check seat availability, taxes or fees.

## Credits

Weather by [Open-Meteo](https://open-meteo.com/) · Rates by [Frankfurter](https://frankfurter.dev/) · Summaries and photos from [Wikipedia](https://www.wikipedia.org/) (CC BY-SA) · Map by [Leaflet](https://leafletjs.com/) with tiles © [Esri](https://www.esri.com/) and © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · Fonts: Big Shoulders Display, IBM Plex Sans, IBM Plex Mono (Google Fonts).
