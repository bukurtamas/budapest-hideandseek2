import { create } from 'zustand'
import type { LngLat, LogEntry, Phase, PlayerState, Role, Settings, Team, ComputeResult } from './types/game'
import { DEFAULT_SETTINGS } from './types/game'
import type { AppData } from './data/types'

let worker: Worker | null = null
let debounce: ReturnType<typeof setTimeout> | undefined

function gpsErrText(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return 'Location permission denied. Enable it in your browser/site settings.'
  if (err.code === err.POSITION_UNAVAILABLE) return 'Location unavailable. Check that GPS/location is on.'
  if (err.code === err.TIMEOUT) return 'Location timed out. Try again outdoors.'
  return err.message || 'Could not get your location.'
}

interface State {
  // identity
  playerId: string
  name: string
  team: Team
  // session
  roomCode: string | null
  startingTeam: Team // which team hides in round 1
  round: number
  phase: Phase
  phaseStart: number | null // epoch ms when the current phase started
  settings: Settings
  // play
  log: LogEntry[]
  players: Record<string, PlayerState> // all known players incl. self (from sync)
  myPos: LngLat | null
  seekerRef: LngLat | null // reference point for the next question
  // computed zone
  zone: GeoJSON.Feature | null
  shade: GeoJSON.Feature | null
  areaKm2: number
  empty: boolean
  computing: boolean
  // UI
  started: boolean // false => lobby, true => in game
  showPoi: boolean
  gpsEnabled: boolean
  gpsError: string | null
  appData: AppData | null // map data, kept for hider answer suggestions

  // derived
  myRole: () => Role
  hidingTeam: () => Team
  visiblePlayers: () => PlayerState[]
  presentRoles: () => { hider: boolean; seeker: boolean }
  gameActive: () => boolean

  // actions
  init: () => void
  provideData: (data: AppData) => void
  setIdentity: (name: string, team: Team) => void
  setRoom: (code: string | null) => void
  setShowPoi: (v: boolean) => void
  setGps: (v: boolean) => void
  requestGps: () => void
  enterGame: () => void
  leaveGame: () => void
  setRound: (n: number) => void
  setStartingTeam: (t: Team) => void
  startPhase: (phase: Phase) => void
  nextRound: () => void
  patchSettings: (p: Partial<Settings>) => void
  setMyPos: (p: LngLat | null) => void
  setSeekerRef: (p: LngLat | null) => void
  upsertPlayer: (p: PlayerState) => void
  setPlayers: (players: Record<string, PlayerState>) => void
  addEntry: (e: Omit<LogEntry, 'id' | 'ts' | 'active' | 'status'>) => void
  askQuestion: (q: Omit<LogEntry, 'id' | 'ts' | 'active' | 'status' | 'answer' | 'askedBy' | 'answeredAt'>) => void
  answerQuestion: (id: string, answer: LogEntry['answer']) => void
  setLog: (log: LogEntry[]) => void
  applyRemoteState: (p: { round?: number; startingTeam?: Team; settings?: Settings; phase?: Phase; phaseStart?: number | null }) => void
  toggleEntry: (id: string) => void
  removeEntry: (id: string) => void
  clearLog: () => void
  recompute: () => void
}

export const useStore = create<State>((set, get) => ({
  playerId: '',
  name: '',
  team: 'A',
  roomCode: null,
  startingTeam: 'A',
  round: 1,
  phase: 'idle',
  phaseStart: null,
  settings: { ...DEFAULT_SETTINGS },
  log: [],
  players: {},
  myPos: null,
  seekerRef: null,
  zone: null,
  shade: null,
  areaKm2: 0,
  empty: false,
  computing: false,
  started: false,
  showPoi: true,
  gpsEnabled: false,
  gpsError: null,
  appData: null,

  hidingTeam: () => {
    const { startingTeam, round } = get()
    const other: Team = startingTeam === 'A' ? 'B' : 'A'
    return round % 2 === 1 ? startingTeam : other
  },
  myRole: () => (get().team === get().hidingTeam() ? 'hider' : 'seeker'),
  presentRoles: () => {
    const ht = get().hidingTeam()
    const ps = Object.values(get().players)
    return { hider: ps.some((p) => p.team === ht), seeker: ps.some((p) => p.team !== ht) }
  },
  gameActive: () => {
    if (!get().roomCode) return true // local / single-device testing
    const r = get().presentRoles()
    return r.hider && r.seeker
  },
  visiblePlayers: () => {
    const { players, playerId } = get()
    const role = get().myRole()
    const hidingTeam = get().hidingTeam()
    return Object.values(players).filter((p) => {
      if (p.id === playerId) return true // always see myself
      if (role === 'hider') return p.team !== hidingTeam // hider sees seekers
      return p.team !== hidingTeam // seeker sees only fellow seekers (never the hider)
    })
  },

  init: () => {
    if (!get().playerId) set({ playerId: crypto.randomUUID() })
    if (import.meta.env.DEV) (window as unknown as { __store?: unknown }).__store = useStore
    if (!worker) {
      worker = new Worker(new URL('./geo/zone.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<ComputeResult>) => {
        const r = e.data
        set({ zone: r.zone, shade: r.shade, areaKm2: r.areaKm2, empty: r.emptyConstraint, computing: false })
      }
    }
    // first compute happens once the data is provided (see provideData)
  },
  provideData: (data) => {
    set({ appData: data })
    if (worker) worker.postMessage({ type: 'init', data })
    get().recompute()
  },

  setIdentity: (name, team) => set({ name, team }),
  setRoom: (code) => set({ roomCode: code }),
  setShowPoi: (v) => set({ showPoi: v }),
  setGps: (v) => set({ gpsEnabled: v, gpsError: v ? get().gpsError : null }),
  // Must be called from a user gesture (button click) so mobile shows the prompt.
  requestGps: () => {
    if (!('geolocation' in navigator)) { set({ gpsError: 'This device has no geolocation.' }); return }
    set({ gpsError: null })
    navigator.geolocation.getCurrentPosition(
      (pos) => { get().setMyPos([pos.coords.longitude, pos.coords.latitude]); set({ gpsEnabled: true, gpsError: null }) },
      (err) => set({ gpsEnabled: false, gpsError: gpsErrText(err) }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  },
  enterGame: () => set({ started: true }),
  leaveGame: () => set({ started: false }),
  setRound: (n) => set({ round: Math.max(1, n) }),
  setStartingTeam: (t) => set({ startingTeam: t }),
  startPhase: (phase) => set({ phase, phaseStart: phase === 'idle' ? null : Date.now() }),
  nextRound: () => { set({ round: get().round + 1, phase: 'idle', phaseStart: null, log: [], seekerRef: null }); get().recompute() },
  patchSettings: (p) => { set({ settings: { ...get().settings, ...p } }); get().recompute() },
  setMyPos: (p) => {
    set({ myPos: p })
    // default the question reference to my position for seekers
    if (p && get().myRole() === 'seeker' && !get().seekerRef) set({ seekerRef: p })
  },
  setSeekerRef: (p) => set({ seekerRef: p }),
  upsertPlayer: (p) => set({ players: { ...get().players, [p.id]: p } }),
  setPlayers: (players) => set({ players }),

  addEntry: (e) => {
    const entry: LogEntry = { ...e, id: crypto.randomUUID(), ts: Date.now(), active: true, status: e.answer != null ? 'answered' : 'pending' }
    set({ log: [...get().log, entry] })
    get().recompute()
  },
  askQuestion: (q) => {
    const entry: LogEntry = { ...q, id: crypto.randomUUID(), ts: Date.now(), active: true, status: 'pending', answer: null, askedBy: get().name || 'Seeker' }
    set({ log: [...get().log, entry] })
  },
  answerQuestion: (id, answer) => {
    set({ log: get().log.map((e) => (e.id === id ? { ...e, answer, status: 'answered', answeredAt: Date.now() } : e)) })
    get().recompute()
  },
  setLog: (log) => { set({ log }); get().recompute() },
  applyRemoteState: (p) => {
    const patch: Partial<State> = {}
    if (p.round !== undefined) patch.round = p.round
    if (p.startingTeam) patch.startingTeam = p.startingTeam
    if (p.settings) patch.settings = p.settings
    if (p.phase !== undefined) patch.phase = p.phase
    if (p.phaseStart !== undefined) patch.phaseStart = p.phaseStart
    set(patch)
    get().recompute()
  },
  toggleEntry: (id) => {
    set({ log: get().log.map((e) => (e.id === id ? { ...e, active: !e.active } : e)) })
    get().recompute()
  },
  removeEntry: (id) => {
    set({ log: get().log.filter((e) => e.id !== id) })
    get().recompute()
  },
  clearLog: () => { set({ log: [] }); get().recompute() },

  recompute: () => {
    if (!worker) return
    clearTimeout(debounce)
    set({ computing: true })
    const { log, settings } = get()
    debounce = setTimeout(() => {
      worker!.postMessage({
        type: 'compute',
        log: log.filter((e) => e.active),
        m2Excluded: settings.m2Excluded,
        hidingRadiusM: settings.hidingRadiusM
      })
    }, 120)
  }
}))
