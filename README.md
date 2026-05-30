# Hide + Seek: Budapest

A free, mobile-first PWA companion map for playing the [Jetlag: The Game](https://www.lifack.ch/)
**Hide and Seek** board game in a real city. It is built for the metric "small" game
in Budapest, restricted to rail-bound transit (metro, HEV, tram, train) inside the city
limits, but it is written so it can be re-pointed at almost any city and any set of
transit modes. See [Porting to another city](#porting-to-another-city) below.

It does three things a paper map cannot:

- **Live seeker tracking.** Seekers' GPS positions are shared in real time (via Firebase).
  The hider sees the seekers; the seekers never see the hider. The asymmetry is enforced
  at the data layer: the hider's position is never written to the shared room.
- **Automatic zone narrowing.** When seekers ask a question and the hider answers, the app
  intersects or subtracts the implied region from the "possible hiding zone" and shades the
  rest of the city. Radar, thermometer, matching (district / line / station / point of
  interest) and measuring questions all narrow the map automatically.
- **Works on a phone, offline-friendly.** Installable PWA, greyscale vector basemap, all
  game data is static GeoJSON cached on the device.

There is no backend to run. The transit, boundary and point-of-interest data are baked into
static files at build time; the only runtime services are the free map tiles and (optionally)
Firebase for live tracking. If Firebase is not configured the app runs in **local mode**:
everything works except cross-device sync.

---

## Table of contents

- [How the game maps to the app](#how-the-game-maps-to-the-app)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Project structure](#project-structure)
- [The data pipeline](#the-data-pipeline)
- [Porting to another city](#porting-to-another-city)
- [Going beyond rail: buses, ferries, or everything](#going-beyond-rail-buses-ferries-or-everything)
- [OSM vs GTFS: choosing a data source](#osm-vs-gtfs-choosing-a-data-source)
- [Firebase (optional live tracking)](#firebase-optional-live-tracking)
- [Deploying](#deploying)
- [Data sources and attribution](#data-sources-and-attribution)

---

## How the game maps to the app

- **Room and roles.** Players join a room by code (or via an invite link). Each player picks
  a team (A or B). One team is the **hider** and the other is the **seeker**, set by which
  team is chosen to hide, so nobody has to assign roles manually. One game is a single round
  (hiding then seeking); to play again, start a new room.
- **The possible zone.** Seekers see a bright "possible hiding zone" and a grey shade over
  everywhere the hider cannot be. The starting zone is the union of circles (default 1 km
  radius) around every usable transit stop, clipped to the city boundary. Each answered
  question shrinks it.
- **Phases and timers.** A game has a hiding phase and a seeking phase, each with its own
  time limit (defaults: 60 min hiding, 180 min seeking). The hider can play time-bonus cards
  that adjust the clock. If the seeking limit is `0` the clock counts up (open-ended) and the
  bonus is added; if the limit is non-zero the clock counts down and the bonus is subtracted
  from the time remaining.
- **The hider deck.** Drawing is done with the physical cards. In the app the hider keeps a
  small deck, and playing a card applies its effect automatically: time bonuses, a question
  veto, an ask-lock or delay on the seekers, or a notification for the rest.

Everything that is game-rule-specific (radii, time limits, the excluded metro segment, the
hiding radius) is adjustable in the in-app Settings without rebuilding any data.

---

## Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| App | Vite + React 18 + TypeScript | fast dev, trivial static hosting, good PWA story |
| Map | MapLibre GL JS | vector tiles, polygon shading, smooth on mobile |
| Tiles | [OpenFreeMap](https://openfreemap.org) (`positron` greyscale) | free, global, no API key, no limits |
| Geometry | [Turf.js](https://turfjs.org) in a Web Worker | buffer / union / intersect / difference off the UI thread |
| State | Zustand (+ `persist`) | tiny store; session survives an app restart |
| Realtime | Firebase Realtime Database + anonymous auth | low-latency sharing, no per-player accounts |
| PWA | `vite-plugin-pwa` (Workbox) | installable, caches the app shell, static data and tiles |

---

## Quick start

```bash
git clone https://github.com/bukurtamas/budapest-hideandseek2.git
cd budapest-hideandseek2
npm install
npm run dev          # http://localhost:5173
```

The committed `public/data/*.geojson` files mean the app runs immediately, with no data
build and no Firebase. To produce a build:

```bash
npm run build        # type-check + bundle into dist/
npm run preview      # serve the production build locally
```

To regenerate the map data from scratch (only needed when porting or refreshing):

```bash
npm run data         # writes public/data/*.geojson
npm run data -- --fresh   # ignore the local download cache
```

---

## Project structure

```
scripts/build-data.mjs     # the data pipeline: OSM/Overpass -> public/data/*.geojson
public/data/*.geojson      # committed game data (8 files, see below)
public/jetlag.svg          # favicon + PWA icon
index.html                 # page title + PWA meta
vite.config.ts             # base path + PWA manifest (app name, colors, icons)
.env.example               # Firebase placeholders (copy to .env)
.github/workflows/pages.yml# GitHub Pages deploy
netlify.toml               # Netlify / Cloudflare Pages build

src/
  main.tsx, App.tsx        # bootstrap; loads data, wires map + sync
  store.ts                 # Zustand store: room, role, phase, log, zone, settings, deck
  sync.ts                  # Firebase bridge (presence, state, log, effects)
  firebase.ts              # SDK init + anonymous auth (graceful if unconfigured)
  data/
    load.ts                # fetches the 8 GeoJSON files
    types.ts               # Mode, PoiCategory, labels and colors
    cards.ts               # the official hider deck definitions
  geo/
    zone.ts                # the zone engine (Turf): one region per question type
    zone.worker.ts         # runs zone.ts off the main thread
    answer.ts              # the hider's auto-suggested true answer (Turf-free)
  map/
    MapView.tsx            # MapLibre init + map center / zoom
    baseLayers.ts          # all static layers (lines, stops, boundary, shade, POI)
    gameLayers.ts          # dynamic layers (player markers, zone, district shading)
  ui/                      # Lobby, Panel (tabs), RoleBar, Banners
  types/game.ts            # shared types + DEFAULT_SETTINGS + radar/thermo ladders
```

---

## The data pipeline

`scripts/build-data.mjs` fetches free, openly-licensed data and writes eight GeoJSON files to
`public/data/`. The app loads exactly these eight at startup (`src/data/load.ts`), so **all
eight must exist**, even if some are empty.

| File | What it is | Used for |
| --- | --- | --- |
| `boundary.geojson` | the city outline (one polygon) | the play-area edge, zone clipping |
| `districts.geojson` | sub-city areas (boroughs / neighborhoods) | "same district?" questions, shading |
| `rail-lines.geojson` | one polyline per transit line | drawing the network |
| `rail-stops.geojson` | stops, snapped onto their line | hideability, station / measuring questions |
| `hiding-zone-initial.geojson` | precomputed starting zone | the initial possible zone (fast load) |
| `m2-excluded.geojson` | the closed metro segment | greyed-out track + removing those stops |
| `mask.geojson` | a rectangle minus the city | the grey "outside the play area" overlay |
| `poi.geojson` | game-relevant points of interest | matching / measuring against places |

Sources currently wired in:

- **City boundary** from `polygons.openstreetmap.fr` (OSM relation `37244`).
- **Districts** from a prebuilt GeoJSON repo of Hungarian admin areas.
- **Transit network and stops** from OpenStreetMap via the **Overpass API**
  (`route=subway | tram | light_rail`, plus suburban `route=train` with a `ref` of `H/S/G/Z`,
  plus heavy-rail stations).
- **Points of interest** from Overpass (museum, library, hospital, cinema, park, zoo, aquarium,
  theme park, golf course).

The script also: classifies each line into a **mode** (`metro` / `hev` / `tram` / `rail`),
stitches each line's ways into a single track and snaps stops onto it, drops stops that are only
reachable via the closed segment, precomputes the starting hiding zone (union of stop buffers
clipped to the boundary), and rounds coordinates to about 1 m to keep the files small.

---

## Porting to another city

This is the main thing forkers will want. The map, tiles and game logic are city-agnostic;
only the **data pipeline inputs** and a little **branding** are Budapest-specific. The plan:
edit the constants at the top of `scripts/build-data.mjs`, run `npm run data`, then update a
few labels. Everything below references real files and constants you can grep for.

### Step 1: city boundary

1. Find your city on [openstreetmap.org](https://www.openstreetmap.org) (or
   [nominatim.openstreetmap.org](https://nominatim.openstreetmap.org)). Open the boundary
   relation and note its numeric **relation id** (shown in the URL and the left panel).
   - Admin levels differ by country (`admin_level` runs 1 to 11). A "city" might be level 6, 7
     or 8 depending on the country. Pick the relation whose outline matches the area you want
     to allow.
2. In `scripts/build-data.mjs`, `getBoundary()` fetches
   `https://polygons.openstreetmap.fr/get_geojson.py?id=37244&params=0`. Replace `37244`
   with your relation id (and change the `name: 'Budapest'` property).

That single id drives the boundary, the map bounds, the grey mask and the zone clipping.

### Step 2: districts (optional but recommended)

Districts power the "same district?" matching question and per-area shading. You can use any
polygon set: boroughs, neighborhoods, postal-code areas, or even nothing.

- **Easiest, generic:** replace `getDistricts()` with an Overpass query for sub-areas inside
  your boundary, for example:

  ```overpassql
  [out:json][timeout:180];
  rel(YOUR_RELATION_ID); map_to_area->.city;
  relation[boundary=administrative][admin_level=9](area.city);
  out geom;
  ```

  Try `admin_level` 8, 9 or 10 to find the level that gives city sub-divisions in your country,
  then build one feature per relation with `num` / `name` / `label` properties.
- **No districts:** write an empty collection to `districts.geojson`
  (`{"type":"FeatureCollection","features":[]}`). The app still runs; district questions simply
  produce no constraint and the "same district?" option does nothing.

Each district feature needs `num`, `name` and `label` properties (see how `getDistricts()`
sets them). The Budapest version uses Roman numerals and a names table; delete those and use
your own naming.

### Step 3: transit network and modes

This is where you decide which transit counts as "usable" (and therefore where hiding is
allowed). Two knobs:

1. **Which route relations to fetch.** In `getRail()` the Overpass queries `q1`/`q2`/`q3`
   select the route types. For rail-only that is `route~"^(subway|tram|light_rail)$"` plus the
   suburban train filter. Add or remove modes here (see the next section for buses/ferries).
2. **How each route maps to a mode.** `classifyMode(tags)` turns OSM tags into one of the app's
   modes. The app's mode list lives in `src/data/types.ts`:

   ```ts
   export type Mode = 'metro' | 'hev' | 'tram' | 'rail'
   export const MODE_LABEL: Record<Mode, string> = { ... }
   export const MODE_COLOR: Record<Mode, string> = { ... }
   ```

   If you add a mode (say `bus`), add it to `Mode`, give it a label and color, handle it in
   `classifyMode()`, and add it to the styling fallbacks: `MODE_FALLBACK_COLOR` and
   `METRO_COLORS` in `build-data.mjs`, and the per-mode widths/colors in
   `src/map/baseLayers.ts` (`LYR.lineSolid` line-width match, `LYR.stops` circle-color match).

The hiding model is: **a stop is a valid hideout, and the starting zone is the union of
circles around all valid stops.** More modes means more (and denser) stops, which makes the
starting zone larger. Tune the radius (Step 6) accordingly.

### Step 4: excluded segment (the Budapest M2 special case)

Budapest closes one metro segment (Deak..Ors) for an event. This is encoded as a station list
and rendered as a greyed-out track. If your city has no such exclusion:

- Set `M2_EXCLUDED_SEGMENT = []` in `build-data.mjs`. `buildM2Excluded()` then finds no
  stations and skips, **but** `m2-excluded.geojson` must still exist for the loader. Make sure
  the file is present as an empty collection (write one once, or add a tiny guard in
  `buildM2Excluded()` that always writes an empty `FeatureCollection` when the segment is empty).
- Mirror the same change in `src/geo/zone.ts`: empty the `M2_SEGMENT` array so the zone engine
  agrees with the build script on which stops are valid.
- The in-app "M2 closed" toggle (`settings.m2Excluded`) becomes a no-op; you can hide that row
  in `src/ui/Panel.tsx` if you like.

To exclude a *different* segment, list its station names in both `M2_EXCLUDED_SEGMENT`
(build script) and `M2_SEGMENT` (zone engine). A station stays usable if another allowed line
also serves it.

### Step 5: points of interest

`POI_CATEGORIES` in `build-data.mjs` is a list of `{ id, tags }`, where tags are OSM
`key=value` selectors. These are generic OSM tags and work in any city. To change the set:

1. Edit `POI_CATEGORIES` (add/remove categories, change the OSM tags).
2. Keep `src/data/types.ts` in sync: the `PoiCategory` union, `POI_LABEL`, `POI_COLOR`.
3. Keep `src/map/baseLayers.ts` `POI_COLOR_MATCH` in sync (it mirrors `POI_COLOR`).

Generic places (restaurants, shops) are intentionally *not* baked in; they appear as muted
labels straight from the basemap when you zoom in, so the data files stay small.

### Step 6: map center, radii, branding

- **Map center and zoom:** `BUDAPEST_CENTER` and the `zoom`/`minZoom` in `src/map/MapView.tsx`.
  Set these to your city (the build script already bounds the map to the boundary bbox).
- **Map margin:** `MASK_PAD` in `build-data.mjs` (degrees of margin around the city for the
  grey overlay and the hard map bounds).
- **Default hiding radius:** `HIDE_RADIUS_KM` in `build-data.mjs` (used to precompute the fast
  starting zone) and `DEFAULT_SETTINGS.hidingRadiusM` in `src/types/game.ts`. Keep them equal so
  the precomputed file matches the default. The radius is also adjustable in-app at runtime.
- **Game radii / distances:** `RADAR_RADII_KM` and `THERMO_DISTANCES_KM` in
  `src/types/game.ts` are tuned for a small metric game; widen them for a larger city.
- **Time limits:** `DEFAULT_SETTINGS.hideMinutes` / `seekMinutes` in `src/types/game.ts`
  (also editable in-app).
- **Branding:** the app name and colors live in `vite.config.ts` (PWA `manifest`), the page
  title in `index.html`, the lobby heading in `src/ui/Lobby.tsx`, and the icon in
  `public/jetlag.svg`.

### Step 7: rebuild and verify

```bash
npm run data            # regenerate public/data/*.geojson for your city
npm run dev             # the map should center on your city; lines/stops/zone visible
```

Sanity checks: the boundary matches your city, stops sit on their lines, the starting shade
covers everywhere outside the union of stop circles, and asking "same district? No" shades that
district. Commit the regenerated `public/data/*.geojson`; they are part of the repo so the app
runs without a data build.

---

## Going beyond rail: buses, ferries, or everything

The rail-only restriction is a *house rule*, not a technical limit. To allow other modes you
mainly widen the Overpass route filter and teach the app a new mode. Concretely:

1. **Fetch more route types.** In `getRail()`, widen the `q1` relation filter. OSM tags route
   relations with `route=` one of: `subway`, `tram`, `light_rail`, `monorail`, `train`,
   `bus`, `trolleybus`, `ferry`, `funicular`, `share_taxi`. For "all public transport":

   ```overpassql
   relation[type=route][route~"^(subway|tram|light_rail|monorail|train|bus|trolleybus|ferry|funicular)$"](BBOX);
   ```

2. **Classify and style the new modes.** Extend `classifyMode()` (build script) and the `Mode`
   union + `MODE_LABEL` + `MODE_COLOR` in `src/data/types.ts`, plus the line/stop style matches
   in `src/map/baseLayers.ts`. Unmapped modes will fall through to the `rail` styling.

3. **Mind the stop extraction.** The current code reads route members whose role matches
   `/stop/`. Bus routes under the newer public-transport scheme (PTv2) often use `platform`
   members instead. If bus stops come out sparse, also accept `platform` roles, or query bus
   stops directly (`node[highway=bus_stop](BBOX)`) and merge them in.

4. **Re-tune the hiding zone.** This is the important design consequence. With buses, stops are
   everywhere, so "within 1 km of a usable stop" can cover the whole city and the starting zone
   stops being meaningful. Options:
   - Shrink `HIDE_RADIUS_KM` (and the matching default) so the zone is tight around stops.
   - Or change the hideability model: if *anywhere in the city* is fair game, make the starting
     zone the boundary itself. In `scripts/build-data.mjs` `buildHidingZone()`, write the
     boundary as the zone; in `src/geo/zone.ts` `initialZone()`, return `ctx.boundary`. The
     question-narrowing logic (radar, thermometer, matching, measuring) keeps working unchanged
     on top of whatever starting zone you choose.

5. **Adjust the "valid stop" rule.** `validHideStops()` (build script) and `isValidStop()`
   (`src/geo/zone.ts`) decide which stops count. With the segment exclusion removed they accept
   every stop; keep the two in sync.

For a walking-only or "no transit restriction" variant, the simplest path is: skip the line and
stop fetching entirely (write empty `rail-lines`/`rail-stops`), make the starting zone the
boundary, and rely on radar/thermometer/measuring questions to narrow it.

---

## OSM vs GTFS: choosing a data source

This project uses **OpenStreetMap via Overpass** because it gives clean line geometry and stop
positions with no key and no preprocessing, and it covers every mode with one query. That is
usually the right choice for this app.

The alternative is a **GTFS feed** (the standard transit schedule format). GTFS gives you the
agency's authoritative routes and stops, including `shapes.txt` (line geometry), `stops.txt`
(stop coordinates) and `routes.txt` (`route_type`: 0 tram, 1 subway/metro, 2 rail, 3 bus,
4 ferry, ...). Trade-offs:

- **OSM/Overpass (used here):** no key, global, easy geometry, but completeness depends on local
  mappers and you must classify modes yourself from tags.
- **GTFS:** authoritative and complete where published, but you must convert `shapes`/`stops`
  into GeoJSON, dedupe shared segments, and clip to your boundary. Many cities publish GTFS;
  many do not.

Where to find a GTFS feed for your city:

- [Mobility Database](https://mobilitydatabase.org/feeds) (the current canonical catalog;
  6000+ feeds across 99+ countries; search by location).
- [transit.land](https://www.transit.land/) (feed registry and API).
- Your transit agency's own open-data portal.

If you go the GTFS route, replace the Overpass calls in `getRail()` with a small GTFS reader
that emits the same `rail-lines.geojson` / `rail-stops.geojson` shape (one `MultiLineString`
feature per line with `ref`/`mode`/`name`/`colour`; one `Point` per stop with
`name`/`lines`/`modes`/`mode`). Everything downstream is unchanged.

---

## Firebase (optional live tracking)

Without Firebase the app runs in local mode (single device, no live sync). To enable
cross-device tracking, create a free Firebase project and fill in `.env` (copy `.env.example`):

1. [console.firebase.google.com](https://console.firebase.google.com) -> Add project (the free
   Spark plan is enough).
2. Build -> Realtime Database -> Create database (pick a region).
3. Build -> Authentication -> Sign-in method -> Anonymous -> Enable.
4. Project settings -> Your apps -> Web app -> copy the config values into `.env`:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_DATABASE_URL=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

5. Set Realtime Database rules so only signed-in clients can read/write rooms:

   ```json
   {
     "rules": {
       "rooms": {
         "$room": { ".read": "auth != null", ".write": "auth != null" }
       }
     }
   }
   ```

The Firebase web config values are client-side identifiers, not secrets; the database rules are
what protect the data. `.env` is gitignored. For CI builds (GitHub Pages), the same values are
provided to the build step in `.github/workflows/pages.yml` (move them to repo Secrets if you
prefer).

The room schema is deliberately asymmetric: seekers publish presence to
`/rooms/{code}/seekers/{id}`, the shared question log lives at `/rooms/{code}/log`, and the
hider's exact position is **never** written anywhere in the room.

---

## Deploying

`vite.config.ts` sets `base: './'`, so the build works on a domain root or a project subpath
with no extra config. Pick one:

- **GitHub Pages:** push to `main`. The included `.github/workflows/pages.yml` builds and
  deploys. Enable it once under repo Settings -> Pages -> Source: GitHub Actions.
- **Netlify / Cloudflare Pages:** point them at the repo; `netlify.toml` sets
  `command = "npm run build"` and `publish = "dist"`.
- **Anything static:** `npm run build` and serve `dist/`.

This is a PWA with `registerType: 'autoUpdate'`. After a deploy, installed users may need to
fully close and reopen the app once for the service worker to fetch the new version.

---

## Data sources and attribution

All data and tiles are free and openly licensed. If you ship this, keep the attribution
(the app shows it in Settings):

- Map tiles: **OpenFreeMap**, styles from **OpenMapTiles**.
- Map data: **(c) OpenStreetMap contributors** (ODbL), via OpenFreeMap / OpenMapTiles, and via
  the Overpass API for the transit, boundary and POI layers.

Game design is **Jetlag: The Game (Hide and Seek)** by Wendover/Nebula. This is an unofficial,
non-commercial companion tool; it does not include or replace the official rules or cards.

---

## License

The application code in this repository is provided as-is for personal, non-commercial use.
OpenStreetMap-derived data in `public/data/` is **(c) OpenStreetMap contributors**, licensed
under the [ODbL](https://opendatacommons.org/licenses/odbl/).
