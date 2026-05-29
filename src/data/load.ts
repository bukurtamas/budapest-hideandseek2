import type { AppData } from './types'

const BASE = import.meta.env.BASE_URL

async function gj<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}data/${name}`)
  if (!res.ok) throw new Error(`Nem sikerült betölteni: ${name} (HTTP ${res.status})`)
  return res.json() as Promise<T>
}

let cache: Promise<AppData> | null = null

export function loadData(): Promise<AppData> {
  if (cache) return cache
  cache = (async () => {
    const [boundary, districts, lines, stops, mask, hidingZone, m2Excluded, poi] = await Promise.all([
      gj<AppData['boundary']>('boundary.geojson'),
      gj<AppData['districts']>('districts.geojson'),
      gj<AppData['lines']>('rail-lines.geojson'),
      gj<AppData['stops']>('rail-stops.geojson'),
      gj<AppData['mask']>('mask.geojson'),
      gj<AppData['hidingZone']>('hiding-zone-initial.geojson'),
      gj<AppData['m2Excluded']>('m2-excluded.geojson'),
      gj<AppData['poi']>('poi.geojson')
    ])
    return { boundary, districts, lines, stops, mask, hidingZone, m2Excluded, poi }
  })()
  return cache
}
