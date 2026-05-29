// Build static GeoJSON data for the app from free sources.
//
//   - City boundary:  polygons.openstreetmap.fr (OSM relation 37244)
//   - Districts:      github.com/integralvision/geo-data-hungary (OSM-derived)
//   - Rail network:   OpenStreetMap via Overpass API
//
// Output -> public/data/*.geojson  (committed, so the app runs without re-running this)
// Run:  npm run data        (add --fresh to ignore the local download cache)
//
// Licenses: OSM data is ODbL (© OpenStreetMap contributors) — attributed in-app.

import * as turf from '@turf/turf'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'public', 'data')
const CACHE = join(__dirname, '.cache')
const FRESH = process.argv.includes('--fresh')

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const UA = 'bujocska-budapest/1.0 (hide-and-seek map; contact: local use)'

// M2 metro segment closed for the Champions League final (Deák F. tér -> Örs vezér tere).
// A station stays a valid hideout if some OTHER allowed line serves it; only stops
// served *exclusively* by M2 on this segment become unusable.
const M2_EXCLUDED_SEGMENT = [
  'Deák Ferenc tér', 'Astoria', 'Blaha Lujza tér', 'Keleti pályaudvar',
  'Puskás Ferenc Stadion', 'Pillangó utca', 'Örs vezér tere'
]

const DISTRICT_NAMES = {
  1: 'Várkerület', 3: 'Óbuda-Békásmegyer', 4: 'Újpest', 5: 'Belváros-Lipótváros',
  6: 'Terézváros', 7: 'Erzsébetváros', 8: 'Józsefváros', 9: 'Ferencváros',
  10: 'Kőbánya', 11: 'Újbuda', 12: 'Hegyvidék', 14: 'Zugló', 17: 'Rákosmente',
  18: 'Pestszentlőrinc-Pestszentimre', 19: 'Kispest', 20: 'Pesterzsébet',
  21: 'Csepel', 22: 'Budafok-Tétény', 23: 'Soroksár'
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI',
  'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII']

const METRO_COLORS = { M1: '#FCD946', M2: '#E41F18', M3: '#005CA5', M4: '#19A949' }
const MODE_FALLBACK_COLOR = { metro: '#888', tram: '#F2A900', hev: '#7E4E9B', rail: '#6b7280' }

const HIDE_RADIUS_KM = 1.0 // default hiding zone radius (adjustable in-app)
const MASK_PAD = 0.06 // degrees of margin around the city for the grey overlay / map bounds

// Game-relevant point categories (Jetlag question set). Generic places
// (restaurants/shops) are intentionally NOT included; those stay on the basemap.
const POI_CATEGORIES = [
  { id: 'museum', tags: ['tourism=museum'] },
  { id: 'library', tags: ['amenity=library'] },
  { id: 'hospital', tags: ['amenity=hospital'] },
  { id: 'cinema', tags: ['amenity=cinema'] },
  { id: 'park', tags: ['leisure=park'] },
  { id: 'zoo', tags: ['tourism=zoo'] },
  { id: 'aquarium', tags: ['tourism=aquarium'] },
  { id: 'theme_park', tags: ['tourism=theme_park'] },
  { id: 'golf', tags: ['leisure=golf_course'] }
]

const log = (...a) => console.log(...a)
const norm = (s) => (s || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()

async function cached(name, producer) {
  await mkdir(CACHE, { recursive: true })
  const file = join(CACHE, name)
  if (!FRESH) {
    try {
      await stat(file)
      const txt = await readFile(file, 'utf8')
      log(`  (cache) ${name}`)
      return JSON.parse(txt)
    } catch { /* miss */ }
  }
  const data = await producer()
  await writeFile(file, JSON.stringify(data))
  return data
}

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Accept: 'application/json'
    },
    body: 'data=' + encodeURIComponent(query)
  })
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// Turf v7 takes a FeatureCollection for these boolean ops.
const union = (feats) => feats.length === 1 ? feats[0] : turf.union(turf.featureCollection(feats))
const intersect = (a, b) => turf.intersect(turf.featureCollection([a, b]))

function classifyMode(tags) {
  const route = tags.route
  const ref = tags.ref || ''
  const op = (tags.operator || '') + ' ' + (tags.network || '')
  if (route === 'subway') return 'metro'
  if (route === 'tram') return 'tram'
  if (route === 'light_rail') return 'hev'
  if (route === 'train') {
    if (/^H\d/i.test(ref) || /hév/i.test(op)) return 'hev'
    if (/^[SGZ]\d/i.test(ref)) return 'rail'
    return 'rail'
  }
  return null
}

// Connect a relation's member ways (mostly already in order) into one polyline.
function stitchWays(ways) {
  const valid = ways.filter((w) => Array.isArray(w) && w.length >= 2).map((w) => w.slice())
  if (!valid.length) return []
  const close = (p, q) => Math.abs(p[0] - q[0]) < 1e-5 && Math.abs(p[1] - q[1]) < 1e-5
  let line = valid[0].slice()
  for (let i = 1; i < valid.length; i++) {
    let w = valid[i]
    const last = line[line.length - 1]
    if (close(last, w[w.length - 1]) && !close(last, w[0])) w = w.slice().reverse()
    line = close(line[line.length - 1], w[0]) ? line.concat(w.slice(1)) : line.concat(w)
  }
  return line
}

function clipLine(coords, bbox) {
  // coords: [[lon,lat],...]; returns array of LineString coord arrays clipped to bbox
  if (coords.length < 2) return []
  const clipped = turf.bboxClip(turf.lineString(coords), bbox)
  const g = clipped.geometry
  if (!g) return []
  if (g.type === 'LineString') return g.coordinates.length >= 2 ? [g.coordinates] : []
  if (g.type === 'MultiLineString') return g.coordinates.filter((c) => c.length >= 2)
  return []
}

async function getBoundary() {
  log('• City boundary (OSM relation 37244)…')
  const geom = await cached('boundary.json', async () => {
    const res = await fetch('https://polygons.openstreetmap.fr/get_geojson.py?id=37244&params=0', {
      headers: { 'User-Agent': UA }
    })
    if (!res.ok) throw new Error(`boundary HTTP ${res.status}`)
    return res.json()
  })
  const feature = turf.feature(geom, { name: 'Budapest' })
  await writeJSON('boundary.geojson', turf.featureCollection([feature]))
  return feature
}

async function getDistricts() {
  log('• Districts (1–23)…')
  const features = []
  for (let i = 1; i <= 23; i++) {
    const fname = `${String(i).padStart(3, '0')}-budapest-${String(i).padStart(2, '0')}-kerulet.geojson`
    const url = `https://raw.githubusercontent.com/integralvision/geo-data-hungary/main/GeoJSON/l40-district/${fname}`
    const fc = await cached(`district-${i}.json`, async () => {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`district ${i} HTTP ${res.status}`)
      return res.json()
    })
    const src = fc.features ? fc.features[0] : fc
    features.push(turf.feature(src.geometry, {
      num: i,
      roman: ROMAN[i],
      name: DISTRICT_NAMES[i] || `${ROMAN[i]}. kerület`,
      label: `${ROMAN[i]}. ker.`
    }))
  }
  await writeJSON('districts.geojson', turf.featureCollection(features))
  log(`  ${features.length} districts`)
  return turf.featureCollection(features)
}

async function getRail(boundary, bbox) {
  log('• Rail network (Overpass)…')
  const pad = 0.03
  const bb = `${bbox[1] - pad},${bbox[0] - pad},${bbox[3] + pad},${bbox[2] + pad}` // S,W,N,E

  // Q1: metro / tram / HÉV route relations (+ their member nodes for stop names)
  const q1 = await cached('overpass-relations.json', () => overpass(`
    [out:json][timeout:180];
    ( relation[type=route][route~"^(subway|tram|light_rail)$"](${bb}); )->.r;
    .r out geom;
    node(r.r); out body;
  `))

  // Q2: suburban / HÉV heavy-rail route relations (ref H*/S*/G*/Z*) — bounded, skips intercity
  const q2 = await cached('overpass-train-routes.json', () => overpass(`
    [out:json][timeout:180];
    ( relation[type=route][route=train][ref~"^[HSGZ]",i](${bb}); )->.r;
    .r out geom;
    node(r.r); out body;
  `))

  // Q3: mainline rail tracks + MÁV stations/halts within bbox (geometry + station points)
  const q3 = await cached('overpass-rail-infra.json', () => overpass(`
    [out:json][timeout:180];
    ( way[railway=rail][usage~"^(main|branch)$"](${bb}); ); out geom;
    ( node[railway=station][station!=subway](${bb});
      node[railway=halt](${bb}); ); out;
  `))

  // --- assemble nodes lookup (id -> {lat,lon,tags}) from relation member-node dumps ---
  const nodeTags = {}
  for (const el of [...q1.elements, ...q2.elements]) {
    if (el.type === 'node') nodeTags[el.id] = el
  }

  // --- routes (lines) from relations ---
  const linesByKey = new Map() // `${mode}:${ref}` -> {ref,mode,colour,name,coords:[[...]]}
  const stops = new Map()      // nodeId -> {name,lon,lat,lines:Set,modes:Set}
  const m2Ordered = []         // stitched polyline per M2 direction relation

  function addRouteRelation(el) {
    const mode = classifyMode(el.tags || {})
    if (!mode) return
    const ref = el.tags.ref || el.tags.name || '?'
    const key = `${mode}:${ref}`
    let L = linesByKey.get(key)
    if (!L) {
      L = {
        ref, mode, name: el.tags.name || ref,
        colour: el.tags.colour || (mode === 'metro' ? METRO_COLORS[ref] : null) || MODE_FALLBACK_COLOR[mode],
        coords: []
      }
      linesByKey.set(key, L)
    }
    const relWays = []
    for (const m of el.members || []) {
      if (m.type === 'way' && Array.isArray(m.geometry)) {
        const c = m.geometry.map((g) => [g.lon, g.lat])
        L.coords.push(c)
        relWays.push(c)
      } else if (m.type === 'node' && /stop/i.test(m.role || '')) {
        const nd = nodeTags[m.ref]
        const name = nd?.tags?.name
        if (!name) continue
        let s = stops.get(m.ref)
        if (!s) { s = { name, lon: nd.lon, lat: nd.lat, lines: new Set(), modes: new Set() }; stops.set(m.ref, s) }
        s.lines.add(ref); s.modes.add(mode)
      }
    }
    if (ref === 'M2') m2Ordered.push(stitchWays(relWays))
  }
  for (const el of q1.elements) if (el.type === 'relation') addRouteRelation(el)
  for (const el of q2.elements) if (el.type === 'relation') addRouteRelation(el)

  // --- heavy-rail tracks + stations from infra query ---
  const railLineCoords = []
  for (const el of q3.elements) {
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      railLineCoords.push(el.geometry.map((g) => [g.lon, g.lat]))
    } else if (el.type === 'node' && el.tags?.name) {
      const id = 'rail-' + el.id
      if (!stops.has(id)) stops.set(id, { name: el.tags.name, lon: el.lon, lat: el.lat, lines: new Set(), modes: new Set() })
      stops.get(id).modes.add('rail')
    }
  }
  if (railLineCoords.length) {
    linesByKey.set('rail:MÁV', { ref: 'Vasút', mode: 'rail', name: 'Vasútvonalak', colour: MODE_FALLBACK_COLOR.rail, coords: railLineCoords })
  }

  // --- build line features (bbox-clipped) ---
  const lineFeatures = []
  for (const L of linesByKey.values()) {
    const parts = []
    for (const c of L.coords) parts.push(...clipLine(c, [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad]))
    if (!parts.length) continue
    const feat = turf.multiLineString(parts, {
      ref: L.ref, mode: L.mode, name: L.name, colour: L.colour
    })
    turf.simplify(feat, { tolerance: 0.00006, highQuality: false, mutate: true })
    lineFeatures.push(feat)
  }
  await writeJSON('rail-lines.geojson', turf.featureCollection(lineFeatures))
  log(`  ${lineFeatures.length} line features`)

  // --- dedupe stops by name + proximity, keep only those inside the city boundary ---
  const raw = [...stops.values()]
  const merged = []
  for (const s of raw) {
    if (!turf.booleanPointInPolygon([s.lon, s.lat], boundary)) continue
    const hit = merged.find((m) => norm(m.name) === norm(s.name) &&
      turf.distance([m.lon, m.lat], [s.lon, s.lat], { units: 'kilometers' }) < 0.25)
    if (hit) {
      for (const l of s.lines) hit.lines.add(l)
      for (const md of s.modes) hit.modes.add(md)
    } else {
      merged.push({ name: s.name, lon: s.lon, lat: s.lat, lines: new Set(s.lines), modes: new Set(s.modes) })
    }
  }
  const stopFeatures = merged.map((s) => turf.point([s.lon, s.lat], {
    name: s.name,
    lines: [...s.lines],
    modes: [...s.modes],
    // primary mode for styling priority: metro > hev > tram > rail
    mode: ['metro', 'hev', 'tram', 'rail'].find((m) => s.modes.has(m)) || 'rail'
  }))
  await writeJSON('rail-stops.geojson', turf.featureCollection(stopFeatures))
  log(`  ${stopFeatures.length} stops (inside boundary)`)

  return { lineFeatures, stopFeatures, m2Ordered }
}

function validHideStops(stopFeatures) {
  // A stop is a valid hideout unless its only serving line(s) are M2 on the closed segment.
  const seg = new Set(M2_EXCLUDED_SEGMENT.map(norm))
  return stopFeatures.filter((f) => {
    const { lines = [], modes = [], name } = f.properties
    let serving = lines.slice()
    if (seg.has(norm(name))) serving = serving.filter((r) => r !== 'M2')
    // heavy-rail stations carry no line refs but a 'rail' mode → still valid
    return serving.length > 0 || modes.includes('rail')
  })
}

async function buildHidingZone(stopFeatures, boundary) {
  log(`• Precomputing default hiding zone (${HIDE_RADIUS_KM} km around valid stops)…`)
  const valid = validHideStops(stopFeatures)
  const circles = valid.map((f) => turf.buffer(f, HIDE_RADIUS_KM, { units: 'kilometers', steps: 12 }))
    .filter(Boolean)
  const dissolved = union(circles)
  const clipped = intersect(dissolved, boundary) || dissolved
  clipped.properties = { kind: 'hiding-zone-initial' }
  await writeJSON('hiding-zone-initial.geojson', turf.featureCollection([clipped]))
  log(`  zone from ${valid.length}/${stopFeatures.length} valid stops`)
}

async function buildM2Excluded(m2Ordered, stopFeatures) {
  log('• M2 closed segment (Deák -> Örs) along the real track…')
  const find = (nm) => stopFeatures.find((s) => norm(s.properties.name) === norm(nm))
  const deak = find('Deák Ferenc tér')
  const ors = find('Örs vezér tere')
  const m2line = (m2Ordered || []).filter((l) => l && l.length >= 2).sort((a, b) => b.length - a.length)[0]
  let seg
  if (m2line && deak && ors) {
    seg = turf.lineSlice(turf.point(deak.geometry.coordinates), turf.point(ors.geometry.coordinates), turf.lineString(m2line))
  } else {
    const pts = M2_EXCLUDED_SEGMENT.map(find).filter(Boolean).map((s) => s.geometry.coordinates)
    if (pts.length < 2) { log('  skipped (stations not found)'); return }
    seg = turf.lineString(pts)
  }
  seg.properties = { kind: 'm2-excluded' }
  await writeJSON('m2-excluded.geojson', turf.featureCollection([seg]))
  log(`  length ${turf.length(seg).toFixed(2)} km`)
}

async function getPOI(boundary, bbox) {
  log('• POI (game categories)…')
  const bb = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}` // S,W,N,E (clip to boundary below)
  const parts = []
  for (const cat of POI_CATEGORIES) {
    for (const t of cat.tags) {
      const [k, v] = t.split('=')
      parts.push(`node["${k}"="${v}"](${bb});`, `way["${k}"="${v}"](${bb});`)
    }
  }
  const data = await cached('overpass-poi.json', () => overpass(`[out:json][timeout:180];(${parts.join('')});out center tags;`))
  const catOf = (tags) => {
    for (const cat of POI_CATEGORIES) for (const t of cat.tags) { const [k, v] = t.split('='); if (tags?.[k] === v) return cat.id }
    return null
  }
  const seen = []
  const feats = []
  for (const el of data.elements) {
    const lon = el.lon ?? el.center?.lon
    const lat = el.lat ?? el.center?.lat
    if (lon == null || lat == null) continue
    const cat = catOf(el.tags)
    if (!cat) continue
    const name = el.tags?.name || ''
    if (cat === 'park' && !name) continue // OSM tags countless tiny greens as park; keep named ones
    if (!turf.booleanPointInPolygon([lon, lat], boundary)) continue
    if (seen.some((p) => p.cat === cat && Math.hypot(p.lon - lon, p.lat - lat) < 0.0006)) continue
    seen.push({ cat, lon, lat })
    feats.push(turf.point([lon, lat], { category: cat, name }))
  }
  await writeJSON('poi.geojson', turf.featureCollection(feats))
  const counts = {}
  for (const f of feats) counts[f.properties.category] = (counts[f.properties.category] || 0) + 1
  log(`  ${feats.length} POIs ${JSON.stringify(counts)}`)
}

async function buildMask(boundary, bbox) {
  // Rectangle (city bbox + small margin) minus Budapest -> grey "outside play area".
  // The map is also bounded to this rectangle, so nothing outside is ever loaded.
  const rect = turf.bboxPolygon([bbox[0] - MASK_PAD, bbox[1] - MASK_PAD, bbox[2] + MASK_PAD, bbox[3] + MASK_PAD])
  const mask = turf.difference(turf.featureCollection([rect, boundary]))
  await writeJSON('mask.geojson', turf.featureCollection([mask]))
}

async function writeJSON(name, obj) {
  await mkdir(OUT, { recursive: true })
  // round every number to 5 decimals (~1 m) to shrink coordinate payloads
  const json = JSON.stringify(obj, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v))
  await writeFile(join(OUT, name), json)
}

async function main() {
  log(`Building data → ${OUT}${FRESH ? '  (--fresh)' : ''}`)
  const boundary = await getBoundary()
  const bbox = turf.bbox(boundary) // [W,S,E,N]
  await getDistricts()
  const { stopFeatures, m2Ordered } = await getRail(boundary, bbox)
  await buildM2Excluded(m2Ordered, stopFeatures)
  await getPOI(boundary, bbox)
  await buildMask(boundary, bbox)
  await buildHidingZone(stopFeatures, boundary)
  log('Done.')
}

main().catch((e) => { console.error('\nFAILED:', e); process.exit(1) })
