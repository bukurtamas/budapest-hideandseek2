import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'

export const BUDAPEST_CENTER: [number, number] = [19.0514, 47.4979]

type Props = {
  /** Called once the map has fully loaded, so parents can add sources/layers. */
  onReady?: (map: maplibregl.Map) => void
}

export default function MapView({ onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      // greyscale style: grey roads (not confused with tram lines), no 3D
      // building extrusions, lighter to render
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: BUDAPEST_CENTER,
      zoom: 11,
      minZoom: 10,
      attributionControl: false,
      hash: false,
      // enables canvas capture (screenshots) during local development
      preserveDrawingBuffer: import.meta.env.DEV
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => onReady?.(map))

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}
