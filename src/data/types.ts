import type { Feature, FeatureCollection, Point, LineString, MultiLineString, Polygon, MultiPolygon } from 'geojson'

export type Mode = 'metro' | 'hev' | 'tram' | 'rail'

export interface StopProps {
  name: string
  lines: string[]
  modes: Mode[]
  mode: Mode
}
export type StopFeature = Feature<Point, StopProps>

export interface LineProps {
  ref: string
  mode: Mode
  name: string
  colour: string
}
export type LineFeature = Feature<LineString | MultiLineString, LineProps>

export interface DistrictProps {
  num: number
  roman: string
  name: string
  label: string
}
export type DistrictFeature = Feature<Polygon | MultiPolygon, DistrictProps>

export type PoiCategory =
  | 'museum' | 'library' | 'hospital' | 'cinema' | 'park' | 'zoo' | 'aquarium' | 'theme_park' | 'golf'
export interface PoiProps { category: PoiCategory; name: string }
export type PoiFeature = Feature<Point, PoiProps>

export interface AppData {
  boundary: FeatureCollection<Polygon | MultiPolygon>
  districts: FeatureCollection<Polygon | MultiPolygon, DistrictProps>
  lines: FeatureCollection<LineString | MultiLineString, LineProps>
  stops: FeatureCollection<Point, StopProps>
  mask: FeatureCollection<Polygon | MultiPolygon>
  hidingZone: FeatureCollection<Polygon | MultiPolygon>
  m2Excluded: FeatureCollection<LineString>
  poi: FeatureCollection<Point, PoiProps>
}

export const POI_LABEL: Record<PoiCategory, string> = {
  museum: 'Museum', library: 'Library', hospital: 'Hospital', cinema: 'Movie theater',
  park: 'Park', zoo: 'Zoo', aquarium: 'Aquarium', theme_park: 'Amusement park', golf: 'Golf course'
}
export const POI_COLOR: Record<PoiCategory, string> = {
  museum: '#a855f7', library: '#0ea5e9', hospital: '#ef4444', cinema: '#f59e0b',
  park: '#22c55e', zoo: '#84cc16', aquarium: '#06b6d4', theme_park: '#ec4899', golf: '#16a34a'
}

export const MODE_LABEL: Record<Mode, string> = {
  metro: 'Metró',
  hev: 'HÉV',
  tram: 'Villamos',
  rail: 'Vasút'
}

export const MODE_COLOR: Record<Mode, string> = {
  metro: '#1f2937',
  hev: '#7E4E9B',
  tram: '#F2A900',
  rail: '#6b7280'
}
