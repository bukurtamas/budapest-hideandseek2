import maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import type { LngLat, PlayerState, Role } from '../types/game'
import { SRC } from './baseLayers'

export interface StoreLike {
  zone: Feature | null
  shade: Feature | null
  playerId: string
  myPos: LngLat | null
  seekerRef: LngLat | null
  showPoi: boolean
  settings: { hidingRadiusM: number }
  myRole: () => Role
  visiblePlayers: () => PlayerState[]
}

const emptyFC = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

// Dynamic point overlays (players, me, reference) use DOM Markers rather than a
// geojson source — markers sidestep the source/worker pipeline entirely and are
// ideal for a handful of frequently-moving points.
let otherMarkers = new Map<string, maplibregl.Marker>()
let meMarker: maplibregl.Marker | null = null
let refMarker: maplibregl.Marker | null = null
let markerMap: maplibregl.Map | null = null

export function applyStoreToMap(map: maplibregl.Map, s: StoreLike) {
  updateZone(map, s.zone, s.shade, true)
  setData(map, SRC.myzone, s.myRole() === 'hider' && s.myPos
    ? { type: 'FeatureCollection', features: [geoCircle(s.myPos, s.settings.hidingRadiusM)] }
    : emptyFC())
  const vis = s.showPoi ? 'visible' : 'none'
  for (const id of ['lyr-poi', 'lyr-poi-labels', 'basemap-poi']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
  }
  updateMarkers(map, s)
}

export function updateZone(map: maplibregl.Map, zone: Feature | null, shade: Feature | null, showShade: boolean) {
  setData(map, SRC.zone, zone ? { type: 'FeatureCollection', features: [zone] } : emptyFC())
  setData(map, SRC.shade, showShade && shade ? { type: 'FeatureCollection', features: [shade] } : emptyFC())
}

function updateMarkers(map: maplibregl.Map, s: StoreLike) {
  if (markerMap && markerMap !== map) {
    otherMarkers.forEach((m) => m.remove()); otherMarkers = new Map()
    meMarker?.remove(); meMarker = null
    refMarker?.remove(); refMarker = null
  }
  markerMap = map

  const others = s.visiblePlayers().filter((p) => p.id !== s.playerId && p.pos)
  const seen = new Set<string>()
  for (const p of others) {
    seen.add(p.id)
    let mk = otherMarkers.get(p.id)
    if (!mk) { mk = new maplibregl.Marker({ element: dotEl('#f97316', p.name) }).setLngLat(p.pos!).addTo(map); otherMarkers.set(p.id, mk) }
    else { mk.setLngLat(p.pos!); setLabel(mk.getElement(), p.name) }
  }
  for (const [id, mk] of otherMarkers) if (!seen.has(id)) { mk.remove(); otherMarkers.delete(id) }

  if (s.myPos) {
    if (!meMarker) meMarker = new maplibregl.Marker({ element: dotEl('#2563eb') }).setLngLat(s.myPos).addTo(map)
    else meMarker.setLngLat(s.myPos)
  } else if (meMarker) { meMarker.remove(); meMarker = null }

  if (s.seekerRef) {
    if (!refMarker) refMarker = new maplibregl.Marker({ element: ringEl() }).setLngLat(s.seekerRef).addTo(map)
    else refMarker.setLngLat(s.seekerRef)
  } else if (refMarker) { refMarker.remove(); refMarker = null }
}

function dotEl(color: string, name?: string): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:relative;width:16px;height:16px'
  const dot = document.createElement('div')
  dot.style.cssText = `width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)`
  el.appendChild(dot)
  if (name) {
    const lbl = document.createElement('div')
    lbl.className = 'mk-label'
    lbl.textContent = name
    lbl.style.cssText = 'position:absolute;top:18px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:600;color:#0f172a;background:rgba(255,255,255,.85);border-radius:6px;padding:0 4px;white-space:nowrap'
    el.appendChild(lbl)
  }
  return el
}
function ringEl(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:rgba(56,189,248,.2);border:2px solid #38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,.25)'
  return el
}
function setLabel(el: HTMLElement, name: string) {
  const lbl = el.querySelector('.mk-label')
  if (lbl) lbl.textContent = name
}

function setData(map: maplibregl.Map, id: string, data: FeatureCollection) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  if (src) src.setData(data as never)
}

// Geographic circle polygon (meters) without pulling Turf into the UI bundle.
export function geoCircle(center: LngLat, radiusM: number, n = 64): Feature {
  const [lng, lat] = center
  const R = 6378137
  const d = radiusM / R
  const latR = (lat * Math.PI) / 180
  const lngR = (lng * Math.PI) / 180
  const coords: number[][] = []
  for (let i = 0; i <= n; i++) {
    const brng = (2 * Math.PI * i) / n
    const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brng))
    const lng2 = lngR + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(latR), Math.cos(d) - Math.sin(latR) * Math.sin(lat2))
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }
}
