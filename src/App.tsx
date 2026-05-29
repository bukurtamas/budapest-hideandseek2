import { useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import MapView from './map/MapView'
import { loadData } from './data/load'
import { addBaseLayers } from './map/baseLayers'
import { applyStoreToMap } from './map/gameLayers'
import type { AppData } from './data/types'
import { useStore } from './store'
import { useGeolocation, useHiderNotify, useMapSync } from './hooks'
import { startSync } from './sync'
import RoleBar from './ui/RoleBar'
import Panel from './ui/Panel'
import Banners from './ui/Banners'
import Lobby from './ui/Lobby'

export default function App() {
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useStore((s) => s.started)
  const gps = useStore((s) => s.gpsEnabled)

  useEffect(() => { useStore.getState().init(); void startSync() }, [])
  useEffect(() => {
    loadData().then((d) => { setData(d); useStore.getState().provideData(d) }).catch((e) => setError(String(e)))
  }, [])
  useEffect(() => {
    if (!map || !data) return
    addBaseLayers(map, data)
    const b = bbox(data.boundary)
    const pad = 0.06 // matches the grey-overlay rectangle in build-data (MASK_PAD)
    map.setMaxBounds([[b[0] - pad, b[1] - pad], [b[2] + pad, b[3] + pad]])
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, animate: false })
    // Render the current zone/shade/positions once the source batch has settled
    // (the store subscription only fires on later changes, so without this the
    // initial shade would not appear until the first question).
    map.once('idle', () => applyStoreToMap(map, useStore.getState()))
  }, [map, data])

  useMapSync(map)
  useGeolocation(gps)
  useHiderNotify()

  if (!started) return <Lobby />

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <MapView onReady={setMap} />
      <RoleBar />
      <Banners />
      <Panel />
      {(error || !data) && (
        <div style={{
          position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,23,42,.9)', border: '1px solid var(--line)', borderRadius: 999,
          padding: '6px 14px', fontSize: 13, color: error ? '#fca5a5' : 'var(--muted)'
        }}>
          {error ? `Error: ${error}` : 'Loading data...'}
        </div>
      )}
    </div>
  )
}

function bbox(fc: AppData['boundary']): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90
  const walk = (arr: any): void => {
    if (typeof arr[0] === 'number') {
      if (arr[0] < w) w = arr[0]; if (arr[0] > e) e = arr[0]
      if (arr[1] < s) s = arr[1]; if (arr[1] > n) n = arr[1]
    } else for (const x of arr) walk(x)
  }
  for (const f of fc.features) walk((f.geometry as any).coordinates)
  return [w, s, e, n]
}
