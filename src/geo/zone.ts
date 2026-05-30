// Pure geometry engine for narrowing the hider's possible zone from Q&A.
// Imported ONLY by the worker, so the heavy Turf dependency stays off the UI thread.
import * as turf from '@turf/turf'
import type { Feature, Point, Polygon, MultiPolygon } from 'geojson'
import type { LngLat, LogEntry } from '../types/game'
import type { AppData } from '../data/types'

const M2_SEGMENT = ['deák ferenc tér', 'astoria', 'blaha lujza tér', 'keleti pályaudvar',
  'puskás ferenc stadion', 'pillangó utca', 'örs vezér tere']
const normalize = (s: string) => (s || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()

type AnyFeat = Feature<any>

export interface Ctx {
  boundary: Feature<Polygon | MultiPolygon>
  boundaryLine: AnyFeat
  districts: AppData['districts']
  districtBorders: AnyFeat // MultiLineString of all district edges
  stops: AppData['stops']
  stopsMulti: Feature<any> // MultiPoint of all stop coords
  cells: (AnyFeat | null)[] // voronoi cell per stop (index-aligned)
  lines: AppData['lines']
  poiByCat: Map<string, AnyFeat[]> // game-relevant POIs grouped by category
  hidingZoneDefault: Feature<Polygon | MultiPolygon> // precomputed (m2 excluded)
}

export function buildCtx(data: AppData): Ctx {
  const boundary = data.boundary.features[0] as Feature<Polygon | MultiPolygon>
  const coords = data.stops.features.map((f) => (f.geometry as Point).coordinates)
  const stopsMulti = turf.multiPoint(coords)
  const bb = turf.bbox(turf.buffer(boundary, 1, { units: 'kilometers' }) || boundary)
  let cells: (AnyFeat | null)[] = []
  try {
    const vor = turf.voronoi(turf.featureCollection(data.stops.features as any), { bbox: bb as any })
    cells = (vor.features as any[]).map((c) => c || null)
  } catch {
    cells = data.stops.features.map(() => null)
  }
  const borders = data.districts.features.map((d) => turf.polygonToLine(d as any))
  const districtBorders = turf.combine(turf.featureCollection(flattenLines(borders))).features[0] as AnyFeat
  const boundaryLine = turf.polygonToLine(boundary as any) as AnyFeat

  const poiByCat = new Map<string, AnyFeat[]>()
  for (const f of data.poi.features) {
    const c = (f.properties as any).category as string
    if (!poiByCat.has(c)) poiByCat.set(c, [])
    poiByCat.get(c)!.push(f as AnyFeat)
  }

  return {
    boundary,
    boundaryLine,
    districts: data.districts,
    districtBorders,
    stops: data.stops,
    stopsMulti,
    cells,
    lines: data.lines,
    poiByCat,
    hidingZoneDefault: data.hidingZone.features[0] as Feature<Polygon | MultiPolygon>
  }
}

// Voronoi cells per POI category (lazy, cached).
const poiVorCache = new Map<string, (AnyFeat | null)[]>()
function poiCell(ctx: Ctx, cat: string, p: LngLat): AnyFeat | null {
  const pts = ctx.poiByCat.get(cat) || []
  if (!pts.length) return null
  if (pts.length === 1) return turf.buffer(pts[0], 0.5, { units: 'kilometers' }) as AnyFeat
  let cells = poiVorCache.get(cat)
  if (!cells) {
    try {
      const bb = turf.bbox(turf.buffer(ctx.boundary, 1, { units: 'kilometers' }) || ctx.boundary)
      const v = turf.voronoi(turf.featureCollection(pts as any), { bbox: bb as any })
      cells = (v.features as any[]).map((c) => c || null)
    } catch { cells = pts.map(() => null) }
    poiVorCache.set(cat, cells)
  }
  let bi = -1, bd = Infinity
  pts.forEach((f, i) => {
    const d = turf.distance(p, (f.geometry as Point).coordinates, { units: 'kilometers' })
    if (d < bd) { bd = d; bi = i }
  })
  return cells[bi] || (turf.buffer(pts[bi], 0.5, { units: 'kilometers' }) as AnyFeat)
}

function flattenLines(feats: any[]): any[] {
  const out: any[] = []
  for (const f of feats) {
    if (f.type === 'FeatureCollection') out.push(...f.features)
    else out.push(f)
  }
  return out
}

// ---- valid hideouts (same rule as the build script) ----
export function isValidStop(props: { name: string; lines?: string[]; modes?: string[] }, m2Excluded: boolean): boolean {
  let serving = (props.lines || []).slice()
  if (m2Excluded && M2_SEGMENT.includes(normalize(props.name))) serving = serving.filter((r) => r !== 'M2')
  return serving.length > 0 || (props.modes || []).includes('rail')
}

export function initialZone(ctx: Ctx, m2Excluded: boolean, radiusM: number): Feature<Polygon | MultiPolygon> {
  // Default precomputed case (1 km, M2 excluded) → use the bundled file (fast).
  if (m2Excluded && Math.abs(radiusM - 1000) < 1) return ctx.hidingZoneDefault
  const valid = ctx.stops.features.filter((f) => isValidStop(f.properties as any, m2Excluded))
  const circles = valid
    .map((f) => turf.buffer(f, radiusM / 1000, { units: 'kilometers', steps: 12 }))
    .filter(Boolean) as AnyFeat[]
  const dissolved = circles.length > 1 ? turf.union(turf.featureCollection(circles as any)) : circles[0]
  const clipped = turf.intersect(turf.featureCollection([dissolved as any, ctx.boundary as any]))
  return (clipped || dissolved) as Feature<Polygon | MultiPolygon>
}

// ---- geometric helpers ----
function containingDistrict(ctx: Ctx, p: LngLat): AnyFeat | null {
  for (const d of ctx.districts.features) {
    if (turf.booleanPointInPolygon(p, d as any)) return d as AnyFeat
  }
  return null
}

function nearestStopIndex(ctx: Ctx, p: LngLat): number {
  let best = -1, bestD = Infinity
  ctx.stops.features.forEach((f, i) => {
    const d = turf.distance(p, (f.geometry as Point).coordinates, { units: 'kilometers' })
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

function nearestLine(ctx: Ctx, p: LngLat): AnyFeat | null {
  let best: AnyFeat | null = null, bestD = Infinity
  for (const l of ctx.lines.features) {
    try {
      const d = turf.pointToLineDistance(p, l as any, { units: 'kilometers' })
      if (d < bestD) { bestD = d; best = l as AnyFeat }
    } catch { /* skip bad geom */ }
  }
  return best
}

// Half-plane of points closer to one end of the from->to segment than the other.
// `side: 'to'` keeps the half containing `to` (used for "hotter"); `'from'` the
// other. The result is verified to actually contain the target point and flipped
// if the winding put it on the wrong side, so the thermometer can never invert.
function halfPlane(from: LngLat, to: LngLat, side: 'to' | 'from'): AnyFeat {
  const target = side === 'to' ? to : from
  const brg = turf.bearing(from, to)
  const mid = turf.midpoint(from, to)
  const BIG = 200
  const km = { units: 'kilometers' as const }
  const a = turf.destination(mid, BIG, brg + 90, km).geometry.coordinates
  const b = turf.destination(mid, BIG, brg - 90, km).geometry.coordinates
  const push = side === 'to' ? brg : brg + 180
  const ext = (base: number[], bearing: number) => turf.destination(turf.point(base), 2 * BIG, bearing, km).geometry.coordinates
  let poly = turf.polygon([[a, b, ext(b, push), ext(a, push), a]])
  if (!turf.booleanPointInPolygon(turf.point(target), poly)) {
    poly = turf.polygon([[a, b, ext(b, push + 180), ext(a, push + 180), a]])
  }
  return poly
}

function minDistToLines(p: LngLat, line: AnyFeat): number {
  try { return turf.pointToLineDistance(p, line as any, { units: 'kilometers' }) } catch { return 1 }
}

interface Constraint { op: 'intersect' | 'difference'; region: AnyFeat }

function constraintFor(entry: LogEntry, ctx: Ctx): Constraint | null {
  const yes = (region: AnyFeat | null | undefined, positive: boolean): Constraint | null =>
    region ? { op: positive ? 'intersect' : 'difference', region } : null

  switch (entry.category) {
    case 'radar': {
      if (!entry.seeker || !entry.radiusKm || typeof entry.answer !== 'boolean') return null
      const region = turf.circle(entry.seeker, entry.radiusKm, { units: 'kilometers', steps: 64 })
      return yes(region, entry.answer)
    }
    case 'matching': {
      if (!entry.seeker || typeof entry.answer !== 'boolean') return null
      if (entry.matchKind === 'district') {
        // The hider confirms or picks their own district, so border GPS jitter
        // cannot misfire. When known, pin the zone to exactly that district.
        if (entry.hiderDistrict != null) {
          const d = ctx.districts.features.find((f) => (f.properties as { num?: number }).num === entry.hiderDistrict)
          return d ? { op: 'intersect', region: d as AnyFeat } : null
        }
        return yes(containingDistrict(ctx, entry.seeker), entry.answer)
      }
      if (entry.matchKind === 'station') {
        const i = nearestStopIndex(ctx, entry.seeker)
        const cell = ctx.cells[i]
        const region = cell || turf.buffer(turf.point((ctx.stops.features[i].geometry as Point).coordinates), 0.4, { units: 'kilometers' })
        return yes(region as AnyFeat, entry.answer)
      }
      if (entry.matchKind === 'line') {
        const l = nearestLine(ctx, entry.seeker)
        if (!l) return null
        // approximate: "same nearest line" => near that line
        const region = turf.buffer(l as any, entry.answer ? 0.6 : 0.3, { units: 'kilometers' })
        return yes(region as AnyFeat, entry.answer)
      }
      if (entry.matchKind === 'poi' && entry.poiCategory) {
        return yes(poiCell(ctx, entry.poiCategory, entry.seeker), entry.answer)
      }
      return null
    }
    case 'thermometer': {
      if (!entry.from || !entry.to || (entry.answer !== 'hotter' && entry.answer !== 'colder')) return null
      // No real movement => no usable direction, skip it.
      if (turf.distance(entry.from, entry.to, { units: 'kilometers' }) < 0.02) return null
      const region = halfPlane(entry.from, entry.to, entry.answer === 'hotter' ? 'to' : 'from')
      return { op: 'intersect', region }
    }
    case 'measuring': {
      if (!entry.seeker || (entry.answer !== 'closer' && entry.answer !== 'farther')) return null
      const positive = entry.answer === 'closer' // closer => inside buffer(feature, d_seeker)
      if (entry.measureFeature === 'rail-station') {
        const i = nearestStopIndex(ctx, entry.seeker)
        const d = turf.distance(entry.seeker, (ctx.stops.features[i].geometry as Point).coordinates, { units: 'kilometers' })
        const region = turf.buffer(ctx.stopsMulti as any, Math.max(d, 0.02), { units: 'kilometers', steps: 12 })
        return yes(region as AnyFeat, positive)
      }
      if (entry.measureFeature === 'district-border') {
        const d = minDistToLines(entry.seeker, ctx.districtBorders)
        const region = turf.buffer(ctx.districtBorders as any, Math.max(d, 0.02), { units: 'kilometers' })
        return yes(region as AnyFeat, positive)
      }
      if (entry.measureFeature === 'city-border') {
        const d = minDistToLines(entry.seeker, ctx.boundaryLine)
        const region = turf.buffer(ctx.boundaryLine as any, Math.max(d, 0.02), { units: 'kilometers' })
        return yes(region as AnyFeat, positive)
      }
      if (entry.measureFeature === 'poi' && entry.poiCategory) {
        const pts = ctx.poiByCat.get(entry.poiCategory) || []
        if (!pts.length) return null
        let d = Infinity
        for (const f of pts) d = Math.min(d, turf.distance(entry.seeker, (f.geometry as Point).coordinates, { units: 'kilometers' }))
        const region = turf.buffer(turf.multiPoint(pts.map((f) => (f.geometry as Point).coordinates)), Math.max(d, 0.02), { units: 'kilometers', steps: 10 })
        return yes(region as AnyFeat, positive)
      }
      return null
    }
    default:
      return null // tentacle / photo => manual
  }
}

function safeIntersect(a: AnyFeat, b: AnyFeat): AnyFeat | null {
  try { return turf.intersect(turf.featureCollection([a as any, b as any])) as AnyFeat | null } catch { return a }
}
function safeDifference(a: AnyFeat, b: AnyFeat): AnyFeat | null {
  try { return turf.difference(turf.featureCollection([a as any, b as any])) as AnyFeat | null } catch { return a }
}

export interface ZoneResult {
  zone: AnyFeat | null
  shade: AnyFeat | null
  emptyConstraint: boolean
  areaKm2: number
}

export function computeZone(ctx: Ctx, entries: LogEntry[], m2Excluded: boolean, radiusM: number): ZoneResult {
  let zone: AnyFeat | null = initialZone(ctx, m2Excluded, radiusM)
  let empty = false
  for (const e of entries) {
    if (!e.active) continue
    const c = constraintFor(e, ctx)
    if (!c || !zone) continue
    const next: AnyFeat | null = c.op === 'intersect' ? safeIntersect(zone, c.region) : safeDifference(zone, c.region)
    if (!next) { empty = true; zone = null; break }
    zone = next
  }
  const shade = zone
    ? safeDifference(ctx.boundary as AnyFeat, zone)
    : (ctx.boundary as AnyFeat)
  const areaKm2 = zone ? turf.area(zone as any) / 1e6 : 0
  return { zone, shade, emptyConstraint: empty, areaKm2 }
}
