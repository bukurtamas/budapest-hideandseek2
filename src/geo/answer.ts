// Lightweight, Turf-free geometry to suggest the hider's truthful answer to a
// seeker question, evaluated at the hider's own position. Approximations are
// fine: the hider can always override the suggestion.
import type { AppData } from '../data/types'
import type { LngLat, LogEntry } from '../types/game'

function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function inRing(pt: LngLat, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    const hit = (yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}
function inPolygon(pt: LngLat, geom: any): boolean {
  if (!geom) return false
  if (geom.type === 'Polygon') {
    const [outer, ...holes] = geom.coordinates
    return inRing(pt, outer) && !holes.some((h: number[][]) => inRing(pt, h))
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly: number[][][]) => {
      const [outer, ...holes] = poly
      return inRing(pt, outer) && !holes.some((h) => inRing(pt, h))
    })
  }
  return false
}

function districtNum(data: AppData, p: LngLat): number | null {
  for (const d of data.districts.features) if (inPolygon(p, d.geometry)) return (d.properties as any).num
  return null
}

// The district containing a point (num + display name), or null if outside all.
export function districtAt(data: AppData, p: LngLat): { num: number; name: string; label: string } | null {
  for (const d of data.districts.features) {
    if (inPolygon(p, d.geometry)) {
      const pr = d.properties as { num: number; name: string; label?: string }
      return { num: pr.num, name: pr.name, label: pr.label || pr.name }
    }
  }
  return null
}
function nearest<T extends { geometry: { coordinates: number[] } }>(items: T[], p: LngLat): { item: T | null; dist: number } {
  let best: T | null = null, bd = Infinity
  for (const it of items) {
    const d = haversine(p, it.geometry.coordinates as LngLat)
    if (d < bd) { bd = d; best = it }
  }
  return { item: best, dist: bd }
}
function poiOfCat(data: AppData, cat: string) {
  return data.poi.features.filter((f) => (f.properties as any).category === cat)
}
function minDistToVertices(p: LngLat, coords: any): number {
  let best = Infinity
  const walk = (a: any): void => {
    if (typeof a[0] === 'number') { const d = haversine(p, a as LngLat); if (d < best) best = d }
    else for (const x of a) walk(x)
  }
  walk(coords)
  return best
}
function distToDistrictBorders(data: AppData, p: LngLat): number {
  let best = Infinity
  for (const d of data.districts.features) best = Math.min(best, minDistToVertices(p, (d.geometry as any).coordinates))
  return best
}
function nearestLineRef(data: AppData, p: LngLat): string | null {
  let best: string | null = null, bd = Infinity
  for (const l of data.lines.features) {
    const d = minDistToVertices(p, (l.geometry as any).coordinates)
    if (d < bd) { bd = d; best = (l.properties as any).ref }
  }
  return best
}

export type Suggestion = boolean | 'hotter' | 'colder' | 'closer' | 'farther' | null

// Returns the truthful answer at `me`, or null if it cannot be auto-computed.
export function suggestAnswer(data: AppData, me: LngLat, e: LogEntry): Suggestion {
  const seeker = e.seeker
  switch (e.category) {
    case 'radar':
      if (!seeker || !e.radiusKm) return null
      return haversine(me, seeker) <= e.radiusKm * 1000
    case 'thermometer':
      if (!e.from || !e.to) return null
      return haversine(me, e.to) < haversine(me, e.from) ? 'hotter' : 'colder'
    case 'matching': {
      if (!seeker) return null
      if (e.matchKind === 'district') return districtNum(data, me) === districtNum(data, seeker)
      if (e.matchKind === 'station') {
        const a = nearest(data.stops.features as any, me).item
        const b = nearest(data.stops.features as any, seeker).item
        return !!a && !!b && (a as any).properties?.name === (b as any).properties?.name
      }
      if (e.matchKind === 'line') return nearestLineRef(data, me) === nearestLineRef(data, seeker)
      if (e.matchKind === 'poi' && e.poiCategory) {
        const pts = poiOfCat(data, e.poiCategory)
        const a = nearest(pts as any, me).item
        const b = nearest(pts as any, seeker).item
        return !!a && a === b
      }
      return null
    }
    case 'measuring': {
      if (!seeker) return null
      const cmp = (dMe: number, dSeeker: number): Suggestion => (dMe < dSeeker ? 'closer' : 'farther')
      if (e.measureFeature === 'rail-station') return cmp(nearest(data.stops.features as any, me).dist, nearest(data.stops.features as any, seeker).dist)
      if (e.measureFeature === 'district-border') return cmp(distToDistrictBorders(data, me), distToDistrictBorders(data, seeker))
      if (e.measureFeature === 'city-border') return cmp(minDistToVertices(me, (data.boundary.features[0].geometry as any).coordinates), minDistToVertices(seeker, (data.boundary.features[0].geometry as any).coordinates))
      if (e.measureFeature === 'poi' && e.poiCategory) {
        const pts = poiOfCat(data, e.poiCategory)
        return cmp(nearest(pts as any, me).dist, nearest(pts as any, seeker).dist)
      }
      return null
    }
    default:
      return null // tentacle / photo: answered manually
  }
}
