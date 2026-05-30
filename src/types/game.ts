// Shared game types (used by both the UI thread and the zone worker).

export type Team = 'A' | 'B'
export type Role = 'hider' | 'seeker'
export type Phase = 'idle' | 'hiding' | 'seeking' | 'done'
export type Category = 'matching' | 'measuring' | 'radar' | 'thermometer' | 'tentacle' | 'photo'

export type LngLat = [number, number]

// Metric radar radii (km) used by the small game (subset of the full ladder).
export const RADAR_RADII_KM = [0.075, 0.15, 0.3, 0.45, 1, 1.5, 3, 8]
// Thermometer minimum travel options (km) for the small game.
export const THERMO_DISTANCES_KM = [1, 5]

export type MatchKind = 'district' | 'station' | 'line' | 'poi'
export type MeasureFeature = 'rail-station' | 'district-border' | 'city-border' | 'poi'

export type QuestionStatus = 'pending' | 'answered'

export interface LogEntry {
  id: string
  ts: number
  category: Category
  label: string // human-readable summary
  active: boolean // included in the zone computation (toggle / undo)
  status: QuestionStatus // pending = asked by seeker, awaiting hider; answered = hider replied
  askedBy?: string // seeker name
  answeredAt?: number

  // seeker reference position at ask time (lng,lat)
  seeker?: LngLat

  // radar
  radiusKm?: number
  // thermometer: seeker moved from -> to (>= distance)
  from?: LngLat
  to?: LngLat
  thermoMinKm?: number
  // matching
  matchKind?: MatchKind
  // district the hider confirmed/selected (matchKind === 'district')
  hiderDistrict?: number
  // measuring
  measureFeature?: MeasureFeature
  // poi category (when matchKind/measureFeature === 'poi')
  poiCategory?: string

  // result (string covers manual tentacle/photo answers)
  answer: boolean | 'hotter' | 'colder' | 'closer' | 'farther' | string | null
  approx?: boolean // region is approximate (e.g. nearest-line)
}

export interface Settings {
  hideMinutes: number
  seekMinutes: number
  hidingRadiusM: number
  m2Excluded: boolean
  questionCooldownMin: number
}

export const DEFAULT_SETTINGS: Settings = {
  hideMinutes: 60,
  seekMinutes: 180,
  hidingRadiusM: 1000,
  m2Excluded: true,
  questionCooldownMin: 5
}

export interface ActiveEffect {
  id: string
  kind: 'askLock' | 'delay' | 'notify' | 'veto'
  cardName: string
  by: string
  text?: string
  until?: number // epoch ms when the effect/timer expires
  ts: number
}

export interface PlayerState {
  id: string
  name: string
  team: Team
  pos?: LngLat
  ts?: number
}

// worker protocol
export interface ComputeRequest {
  type: 'compute'
  log: LogEntry[]
  m2Excluded: boolean
  hidingRadiusM: number
}
export interface ComputeResult {
  type: 'result'
  zone: GeoJSON.Feature | null
  shade: GeoJSON.Feature | null
  emptyConstraint: boolean // true if answers contradict (zone collapsed to empty)
  areaKm2: number
}
