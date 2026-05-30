import { useStore } from './store'
import { initFirebase, isFirebaseConfigured, type DbApi } from './firebase'
import type { ActiveEffect, LogEntry, PlayerState } from './types/game'

let api: DbApi | null = null
let currentRoom: string | null = null
let offFns: Array<() => void> = []
let applyingRemote = false
let lastLogIds = new Set<string>()
const last = { me: '', state: '', log: '', effects: '' }

export async function startSync() {
  if (!isFirebaseConfigured) return
  api = await initFirebase()
  if (!api) return
  useStore.subscribe(onStoreChange)
  onStoreChange(useStore.getState())
}

function bindRoom(code: string | null) {
  const st = useStore.getState()
  // Leaving the previous room: drop our presence there so rooms stay independent.
  if (api && currentRoom && currentRoom !== code) {
    api.remove(api.ref(api.db, `rooms/${currentRoom}/players/${st.playerId}`)).catch(() => {})
  }
  offFns.forEach((f) => f())
  offFns = []
  currentRoom = code
  // Pre-seed the "last published" markers with the current LOCAL values so that
  // joining a room never republishes (and thus never clobbers) shared data
  // before the first snapshot arrives. Presence (me) is still announced.
  last.me = ''
  last.state = JSON.stringify({ startingTeam: st.startingTeam, settings: st.settings, phase: st.phase, phaseStart: st.phaseStart })
  last.log = JSON.stringify(st.log)
  last.effects = JSON.stringify(st.effects)
  lastLogIds = new Set(st.log.map((e) => e.id))
  if (!api || !code) return
  const { db, ref, onValue, onDisconnect } = api
  const myId = st.playerId

  offFns.push(onValue(ref(db, `rooms/${code}/players`), (snap) => {
    const v = (snap.val() || {}) as Record<string, PlayerState>
    applyingRemote = true
    useStore.getState().setPlayers(v)
    applyingRemote = false
    if (v[myId]) last.me = JSON.stringify({ ...v[myId], ts: 0 })
  }))

  offFns.push(onValue(ref(db, `rooms/${code}/state`), (snap) => {
    const v = snap.val()
    if (!v) return
    applyingRemote = true
    useStore.getState().applyRemoteState(v)
    applyingRemote = false
    last.state = JSON.stringify(v)
  }))

  offFns.push(onValue(ref(db, `rooms/${code}/log`), (snap) => {
    const v = (snap.val() || {}) as Record<string, LogEntry>
    const arr = Object.values(v).sort((a, b) => a.ts - b.ts)
    applyingRemote = true
    useStore.getState().setLog(arr)
    applyingRemote = false
    last.log = JSON.stringify(arr)
    lastLogIds = new Set(arr.map((e) => e.id))
  }))

  offFns.push(onValue(ref(db, `rooms/${code}/effects`), (snap) => {
    const v = (snap.val() || {}) as Record<string, ActiveEffect>
    const arr = Object.values(v).sort((a, b) => a.ts - b.ts)
    applyingRemote = true
    useStore.getState().setEffects(arr)
    applyingRemote = false
    last.effects = JSON.stringify(arr)
  }))

  // Drop my presence when the tab closes.
  onDisconnect(ref(db, `rooms/${code}/players/${myId}`)).remove()
}

function onStoreChange(s: ReturnType<typeof useStore.getState>) {
  if (!api) return
  if (s.roomCode !== currentRoom) bindRoom(s.roomCode)
  if (applyingRemote || !s.roomCode) return
  const { db, ref, set, update } = api
  const code = s.roomCode

  // Presence (per-id write, never clobbers others). Hider's position never sent.
  const role = s.myRole()
  const me: PlayerState = {
    id: s.playerId,
    name: s.name || 'Player',
    team: s.team,
    pos: role === 'seeker' ? s.myPos ?? undefined : undefined,
    ts: Date.now()
  }
  const meJson = JSON.stringify({ ...me, ts: 0 })
  if (meJson !== last.me) { last.me = meJson; write(set(ref(db, `rooms/${code}/players/${s.playerId}`), strip(me)), 'players') }

  const state = { startingTeam: s.startingTeam, settings: s.settings, phase: s.phase, phaseStart: s.phaseStart }
  const stateJson = JSON.stringify(state)
  if (stateJson !== last.state) { last.state = stateJson; write(set(ref(db, `rooms/${code}/state`), strip(state)), 'state') }

  // Log: merge individual entries (and delete removed ones) so two devices can
  // both write without overwriting each other's questions. Firebase rejects
  // `undefined`, so each entry is stripped of undefined fields first.
  const logJson = JSON.stringify(s.log)
  if (logJson !== last.log) {
    last.log = logJson
    const updates: Record<string, Partial<LogEntry> | null> = {}
    for (const e of s.log) updates[e.id] = strip(e)
    for (const id of lastLogIds) if (!s.log.some((e) => e.id === id)) updates[id] = null
    lastLogIds = new Set(s.log.map((e) => e.id))
    if (Object.keys(updates).length) write(update(ref(db, `rooms/${code}/log`), updates), 'log')
  }

  // Played-card effects are the hider's domain (only the hider writes them).
  if (role === 'hider') {
    const effMap: Record<string, Partial<ActiveEffect>> = {}
    for (const e of s.effects) effMap[e.id] = strip(e)
    const effJson = JSON.stringify(s.effects)
    if (effJson !== last.effects) { last.effects = effJson; write(set(ref(db, `rooms/${code}/effects`), effMap), 'effects') }
  }
}

function write(p: Promise<unknown>, what: string) {
  p.catch((e) => console.error(`[sync] write failed: ${what}`, e))
}

// Firebase rejects `undefined` values - drop them.
function strip<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k]
  return out
}
