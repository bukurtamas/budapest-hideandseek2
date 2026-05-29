import type maplibregl from 'maplibre-gl'
import type { AppData } from '../data/types'

export const SRC = {
  mask: 'src-mask',
  districts: 'src-districts',
  boundary: 'src-boundary',
  lines: 'src-lines',
  stops: 'src-stops',
  m2: 'src-m2',
  zone: 'src-zone', // current possible-zone (complement is shaded)
  shade: 'src-shade', // grey overlay = inside city minus possible-zone
  myzone: 'src-myzone', // hider's own hiding zone
  poi: 'src-poi' // game-relevant points of interest
}

export const LYR = {
  mask: 'lyr-mask',
  shade: 'lyr-shade',
  districtShade: 'lyr-district-shade',
  districtOutline: 'lyr-district-outline',
  districtLabel: 'lyr-district-label',
  boundary: 'lyr-boundary',
  zoneOutline: 'lyr-zone-outline',
  lineDash: 'lyr-line-dash',
  lineSolid: 'lyr-line-solid',
  m2Casing: 'lyr-m2-casing',
  m2: 'lyr-m2',
  stops: 'lyr-stops',
  stopLabels: 'lyr-stop-labels',
  myzoneFill: 'lyr-myzone-fill',
  myzoneLine: 'lyr-myzone-line',
  poi: 'lyr-poi',
  poiLabels: 'lyr-poi-labels'
}

const POI_COLOR_MATCH: any = [
  'match', ['get', 'category'],
  'museum', '#a855f7', 'library', '#0ea5e9', 'hospital', '#ef4444', 'cinema', '#f59e0b',
  'park', '#22c55e', 'zoo', '#84cc16', 'aquarium', '#06b6d4', 'theme_park', '#ec4899', 'golf', '#16a34a',
  '#64748b'
]

export function addBaseLayers(map: maplibregl.Map, data: AppData) {
  if (map.getSource(SRC.boundary)) return // already added

  map.addSource(SRC.mask, { type: 'geojson', data: data.mask })
  map.addSource(SRC.districts, { type: 'geojson', data: data.districts, promoteId: 'num' })
  map.addSource(SRC.boundary, { type: 'geojson', data: data.boundary })
  map.addSource(SRC.lines, { type: 'geojson', data: data.lines })
  map.addSource(SRC.stops, { type: 'geojson', data: data.stops })
  map.addSource(SRC.poi, { type: 'geojson', data: data.poi })
  map.addSource(SRC.m2, { type: 'geojson', data: data.m2Excluded })
  map.addSource(SRC.zone, { type: 'geojson', data: data.hidingZone })
  map.addSource(SRC.shade, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource(SRC.myzone, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  // Grey out everything outside the city limit.
  map.addLayer({
    id: LYR.mask, type: 'fill', source: SRC.mask,
    paint: { 'fill-color': '#0b1120', 'fill-opacity': 0.55 }
  })

  // Per-district shading via feature-state { shaded: true } (matching questions / manual).
  map.addLayer({
    id: LYR.districtShade, type: 'fill', source: SRC.districts,
    paint: {
      'fill-color': '#0b1120',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'shaded'], false], 0.5, 0]
    }
  })

  map.addLayer({
    id: LYR.districtOutline, type: 'line', source: SRC.districts,
    paint: { 'line-color': '#64748b', 'line-width': 1, 'line-opacity': 0.6 }
  })

  map.addLayer({
    id: LYR.districtLabel, type: 'symbol', source: SRC.districts, minzoom: 10.5,
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-allow-overlap': false },
    paint: { 'text-color': '#475569', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 }
  })

  // Shade = inside city minus possible-zone (driven by the zone worker later).
  map.addLayer({
    id: LYR.shade, type: 'fill', source: SRC.shade,
    paint: { 'fill-color': '#0b1120', 'fill-opacity': 0.5 }
  })

  map.addLayer({
    id: LYR.boundary, type: 'line', source: SRC.boundary,
    paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-opacity': 0.9 }
  })

  // Possible-zone outline (the bright area seekers narrow down).
  map.addLayer({
    id: LYR.zoneOutline, type: 'line', source: SRC.zone,
    paint: { 'line-color': '#38bdf8', 'line-width': 1.5, 'line-dasharray': [2, 1], 'line-opacity': 0.7 }
  })

  // Hider's own 400 m hiding zone.
  map.addLayer({ id: LYR.myzoneFill, type: 'fill', source: SRC.myzone, paint: { 'fill-color': '#f43f5e', 'fill-opacity': 0.12 } })
  map.addLayer({ id: LYR.myzoneLine, type: 'line', source: SRC.myzone, paint: { 'line-color': '#f43f5e', 'line-width': 2, 'line-dasharray': [2, 1] } })

  // Heavy rail (no per-line colour) — dashed grey.
  map.addLayer({
    id: LYR.lineDash, type: 'line', source: SRC.lines,
    filter: ['==', ['get', 'mode'], 'rail'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#94a3b8', 'line-width': 1.8, 'line-dasharray': [2, 2] }
  })

  // Metro / HÉV / tram — coloured by their OSM colour.
  map.addLayer({
    id: LYR.lineSolid, type: 'line', source: SRC.lines,
    filter: ['!=', ['get', 'mode'], 'rail'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['coalesce', ['get', 'colour'], '#888'],
      'line-width': ['match', ['get', 'mode'], 'metro', 4, 'hev', 3.5, 'tram', 2.2, 2],
      'line-opacity': 0.9
    }
  })

  // Closed M2 corridor (Deák..Örs): a white casing + solid dark grey over the
  // real track, so the base red line clearly reads as disabled on that section.
  map.addLayer({
    id: LYR.m2Casing, type: 'line', source: SRC.m2,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 }
  })
  map.addLayer({
    id: LYR.m2, type: 'line', source: SRC.m2,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#475569', 'line-width': 5, 'line-opacity': 1 }
  })

  // Game-relevant POIs (colored by category) - shown when zoomed in.
  map.addLayer({
    id: LYR.poi, type: 'circle', source: SRC.poi, minzoom: 12,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6],
      'circle-color': POI_COLOR_MATCH,
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1
    }
  })
  map.addLayer({
    id: LYR.poiLabels, type: 'symbol', source: SRC.poi, minzoom: 13.5,
    layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 }
  })

  // Stops.
  map.addLayer({
    id: LYR.stops, type: 'circle', source: SRC.stops,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 13, 4, 16, 7],
      'circle-color': ['match', ['get', 'mode'], 'metro', '#111827', 'hev', '#7E4E9B', 'tram', '#F2A900', '#6b7280'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2
    }
  })
  map.addLayer({
    id: LYR.stopLabels, type: 'symbol', source: SRC.stops, minzoom: 12.5,
    layout: {
      'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top',
      'text-optional': true
    },
    paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 }
  })
}
