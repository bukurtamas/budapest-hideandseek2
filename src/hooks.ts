import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import { useStore } from './store'
import { applyStoreToMap } from './map/gameLayers'

// Keep the map's dynamic layers in sync with the store.
// NOTE: sources/layers are created in App's data effect; we never call setData
// in the same tick a source is added (that leaves the geojson source's worker
// uninitialised), so all updates flow through this store subscription.
export function useMapSync(map: maplibregl.Map | null) {
  useEffect(() => {
    if (!map) return
    const unsub = useStore.subscribe((s) => applyStoreToMap(map, s))
    return () => { unsub() }
  }, [map])
}

// Browser notification to the hider when a new question arrives.
export function useHiderNotify() {
  const role = useStore((s) => s.myRole())
  const pendingIds = useStore((s) => s.log.filter((e) => e.status === 'pending').map((e) => e.id).join(','))
  const prev = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (role === 'hider' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [role])

  useEffect(() => {
    if (role !== 'hider') { prev.current = new Set(); return }
    const ids = new Set(pendingIds ? pendingIds.split(',') : [])
    const fresh = [...ids].filter((id) => !prev.current.has(id))
    if (fresh.length && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Hide + Seek', { body: 'New question to answer.' }) } catch { /* ignore */ }
    }
    prev.current = ids
  }, [pendingIds, role])
}

// Continuously track this device's GPS position into the store.
export function useGeolocation(enabled: boolean) {
  const setMyPos = useStore((s) => s.setMyPos)
  useEffect(() => {
    if (!enabled || !('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (pos) => setMyPos([pos.coords.longitude, pos.coords.latitude]),
      (err) => {
        // iOS fires a transient "kCLErrorDomain error 0" (POSITION_UNAVAILABLE)
        // even while location keeps working; ignore it. Only surface a denial.
        if (err.code === err.PERMISSION_DENIED) useStore.setState({ gpsEnabled: false, gpsError: 'Location permission denied. Enable it in Settings.' })
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [enabled, setMyPos])
}
