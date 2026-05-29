import { useStore } from './store'
import { initFirebase, isFirebaseConfigured, type DbApi } from './firebase'
import type { LogEntry, PlayerState } from './types/game'

let api: DbApi | null = null
let currentRoom: string | null = null
let offFns: Array<() => void> = []
let applyingRemote = false
const last = { me: '', state: '', log: '' }

export async function startSync() {
  if (!isFirebaseConfigured) return
  api = await initFirebase()
  if (!api) return
  useStore.subscribe(onStoreChange)
  onStoreChange(useStore.getState())
}

function bindRoom(code: string | null) {
  offFns.forEach((f) => f())
  offFns = []
  currentRoom = code
  last.me = last.state = last.log = ''
  if (!api || !code) return
  const { db, ref, onValue, onDisconnect, remove } = api
  const myId = useStore.getState().playerId

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
  }))

  // Drop my presence when the tab closes.
  onDisconnect(ref(db, `rooms/${code}/players/${myId}`)).remove()
  void remove // keep type import used
}

function onStoreChange(s: ReturnType<typeof useStore.getState>) {
  if (!api) return
  if (s.roomCode !== currentRoom) bindRoom(s.roomCode)
  if (applyingRemote || !s.roomCode) return
  const { db, ref, set } = api
  const code = s.roomCode

  // Publish my presence. CRITICAL: the hider's exact position is never sent.
  const role = s.myRole()
  const me: PlayerState = {
    id: s.playerId,
    name: s.name || 'Játékos',
    team: s.team,
    pos: role === 'seeker' ? s.myPos ?? undefined : undefined,
    ts: Date.now()
  }
  const meJson = JSON.stringify({ ...me, ts: 0 })
  if (meJson !== last.me) { last.me = meJson; void set(ref(db, `rooms/${code}/players/${s.playerId}`), strip(me)) }

  const state = { round: s.round, startingTeam: s.startingTeam, settings: s.settings, phase: s.phase, phaseStart: s.phaseStart }
  const stateJson = JSON.stringify(state)
  if (stateJson !== last.state) { last.state = stateJson; void set(ref(db, `rooms/${code}/state`), state) }

  const logMap: Record<string, LogEntry> = {}
  for (const e of s.log) logMap[e.id] = e
  const logJson = JSON.stringify(s.log)
  if (logJson !== last.log) { last.log = logJson; void set(ref(db, `rooms/${code}/log`), logMap) }
}

// Firebase rejects `undefined` values — drop them.
function strip<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k]
  return out
}
