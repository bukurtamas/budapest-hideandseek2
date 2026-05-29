import { useEffect, useState } from 'react'
import { useStore } from '../store'
import {
  RADAR_RADII_KM, THERMO_DISTANCES_KM, type Category, type LngLat, type LogEntry,
  type MatchKind, type MeasureFeature, type Team
} from '../types/game'
import { POI_LABEL, type PoiCategory } from '../data/types'
import { suggestAnswer, type Suggestion } from '../geo/answer'
import { CARDS, CARD_GROUPS } from '../data/cards'

const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`)
const fmtPos = (p: LngLat | null) => (p ? `${p[1].toFixed(5)}, ${p[0].toFixed(5)}` : 'not set')

type Tab = 'ask' | 'answer' | 'deck' | 'log' | 'pos' | 'set'
const TAB_LABEL: Record<Tab, string> = { ask: 'Ask', answer: 'Answer', deck: 'Deck', log: 'Log', pos: 'Loc', set: 'Set' }
const PHASE_LABEL: Record<string, string> = { idle: 'idle', hiding: 'hiding', seeking: 'seeking', done: 'over' }

const POI_CATS: PoiCategory[] = ['museum', 'library', 'hospital', 'cinema', 'park', 'zoo', 'aquarium', 'theme_park', 'golf']

type MatchOpt = { label: string; kind: MatchKind; poi?: PoiCategory }
const MATCH_OPTS: MatchOpt[] = [
  { label: 'Administrative division (district)', kind: 'district' },
  { label: 'Transit station', kind: 'station' },
  { label: 'Transit line', kind: 'line' },
  ...POI_CATS.map((c) => ({ label: POI_LABEL[c], kind: 'poi' as MatchKind, poi: c }))
]
type MeasureOpt = { label: string; feature: MeasureFeature; poi?: PoiCategory }
const MEASURE_OPTS: MeasureOpt[] = [
  { label: 'A rail station', feature: 'rail-station' },
  { label: 'A district border', feature: 'district-border' },
  { label: 'The city border', feature: 'city-border' },
  ...POI_CATS.map((c) => ({ label: `A ${POI_LABEL[c].toLowerCase()}`, feature: 'poi' as MeasureFeature, poi: c }))
]

export default function Panel() {
  const role = useStore((s) => s.myRole())
  const [open, setOpen] = useState(true)
  const tabs: Tab[] = role === 'hider' ? ['answer', 'deck', 'log', 'pos', 'set'] : ['ask', 'log', 'pos', 'set']
  const [tab, setTab] = useState<Tab>(tabs[0])
  useEffect(() => { if (!tabs.includes(tab)) setTab(tabs[0]) }, [role]) // eslint-disable-line

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 'env(safe-area-inset-bottom, 0px)',
      background: 'var(--panel)', borderTop: '1px solid var(--line)',
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
      boxShadow: '0 -4px 20px rgba(0,0,0,.4)'
    }}>
      <PhaseBar />
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', gap: 6 }}>
        <button onClick={() => setOpen((o) => !o)} style={{ padding: '4px 10px' }}>{open ? 'v' : '^'}</button>
        {tabs.map((t) => (
          <button key={t} onClick={() => { setTab(t); setOpen(true) }}
            className={tab === t ? 'primary' : ''} style={{ flex: 1, padding: '6px 4px', fontSize: 13 }}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {open && (
        <div style={{ maxHeight: '46vh', overflowY: 'auto', padding: '4px 12px 14px' }}>
          {tab === 'ask' && <AskTab />}
          {tab === 'answer' && <AnswerTab />}
          {tab === 'deck' && <DeckTab />}
          {tab === 'log' && <LogTab />}
          {tab === 'pos' && <PosTab />}
          {tab === 'set' && <SetTab />}
        </div>
      )}
    </div>
  )
}

function PhaseBar() {
  const phase = useStore((s) => s.phase)
  const hideMin = useStore((s) => s.settings.hideMinutes)
  const startPhase = useStore((s) => s.startPhase)
  const nextRound = useStore((s) => s.nextRound)
  let label: string, action: () => void, color: string
  if (phase === 'hiding') { label = 'Start seeking'; action = () => startPhase('seeking'); color = '#f97316' }
  else if (phase === 'seeking') { label = 'End round (next round)'; action = () => nextRound(); color = '#b91c1c' }
  else { label = `Start hiding (${hideMin} min)`; action = () => startPhase('hiding'); color = 'var(--hider)' }
  return (
    <div style={{ display: 'flex', gap: 8, padding: '10px 10px 2px' }}>
      <button onClick={action} style={{
        flex: 1, padding: '13px', fontSize: 15, fontWeight: 800, letterSpacing: 0.3,
        background: color, color: '#fff', border: 'none', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.35)'
      }}>{label}</button>
      {phase !== 'idle' && <button onClick={() => startPhase('idle')} style={{ padding: '13px 14px' }}>Stop</button>}
    </div>
  )
}

const CATS: { id: Category; label: string }[] = [
  { id: 'matching', label: 'Matching' },
  { id: 'radar', label: 'Radar' },
  { id: 'thermometer', label: 'Thermometer' },
  { id: 'measuring', label: 'Measuring' },
  { id: 'tentacle', label: 'Tentacles' },
  { id: 'photo', label: 'Photos' }
]

// ---- SEEKER: compose and send a question ----
function AskTab() {
  const ref = useStore((s) => s.seekerRef)
  const myPos = useStore((s) => s.myPos)
  const setRef = useStore((s) => s.setSeekerRef)
  const ask = useStore((s) => s.askQuestion)
  const active = useStore((s) => s.gameActive())
  const block = useStore((s) => s.askBlock())
  useTick(block.blocked)
  const canSend = active && !block.blocked

  const [cat, setCat] = useState<Category>('radar')
  const [matchIdx, setMatchIdx] = useState(0)
  const [radiusKm, setRadiusKm] = useState(1)
  const [thermoMin, setThermoMin] = useState(THERMO_DISTANCES_KM[0])
  const [thermoFrom, setThermoFrom] = useState<LngLat | null>(null)
  const [measureIdx, setMeasureIdx] = useState(0)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)

  const spatial = cat !== 'tentacle' && cat !== 'photo'
  const noRef = spatial && !ref
  const m = MATCH_OPTS[matchIdx]
  const f = MEASURE_OPTS[measureIdx]
  const flash = () => { setSent(true); setTimeout(() => setSent(false), 1200) }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {!active && <div style={{ color: 'var(--warn)', fontSize: 13 }}>Waiting for the hider to join the room before you can ask.</div>}
      {block.blocked && <div style={{ color: 'var(--hider)', fontSize: 13, fontWeight: 600 }}>Questions locked by "{block.reason}" {countdown(block.until)}</div>}
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        Asker location: <b style={{ color: 'var(--text)' }}>{fmtPos(ref)}</b>
        {noRef && <div style={{ color: 'var(--warn)' }}>Tap the map, or use your location.</div>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => myPos && setRef(myPos)} disabled={!myPos} style={{ flex: 1 }}>Use my location</button>
        {ref && <button onClick={() => setRef(null)} style={{ flex: 1 }}>Clear</button>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {CATS.map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={cat === c.id ? 'primary' : ''}
            style={{ padding: '6px 10px', fontSize: 13 }}>{c.label}</button>
        ))}
      </div>

      {cat === 'matching' && (
        <Section title="Is your nearest ___ the same as mine?">
          <Select value={matchIdx} onChange={setMatchIdx} options={MATCH_OPTS.map((o, i) => [i, o.label])} />
          <Send disabled={noRef || !canSend} onClick={() => { ask({ category: 'matching', matchKind: m.kind, poiCategory: m.poi, seeker: ref!, approx: m.kind === 'line', label: `Matching: ${m.label}` }); flash() }} sent={sent} />
        </Section>
      )}
      {cat === 'radar' && (
        <Section title="Are you within this distance of me?">
          <Choices value={radiusKm} set={setRadiusKm} opts={RADAR_RADII_KM.map((r) => [r, fmtKm(r)] as [number, string])} />
          <Send disabled={noRef || !canSend} onClick={() => { ask({ category: 'radar', radiusKm, seeker: ref!, label: `Radar: within ${fmtKm(radiusKm)}?` }); flash() }} sent={sent} />
        </Section>
      )}
      {cat === 'thermometer' && (
        <Section title="After I move, am I hotter or colder?">
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Start point: <b style={{ color: 'var(--text)' }}>{fmtPos(thermoFrom)}</b></div>
          <Choices value={thermoMin} set={setThermoMin} opts={THERMO_DISTANCES_KM.map((d) => [d, `at least ${fmtKm(d)}`] as [number, string])} />
          <button onClick={() => setThermoFrom(ref)} disabled={noRef}>Set start point (current asker location)</button>
          <Send disabled={noRef || !thermoFrom || !canSend} onClick={() => { ask({ category: 'thermometer', from: thermoFrom!, to: ref!, thermoMinKm: thermoMin, label: `Thermometer: moved at least ${fmtKm(thermoMin)}` }); flash() }} sent={sent} />
        </Section>
      )}
      {cat === 'measuring' && (
        <Section title="Compared to me, are you closer to or further from ___?">
          <Select value={measureIdx} onChange={setMeasureIdx} options={MEASURE_OPTS.map((o, i) => [i, o.label])} />
          <Send disabled={noRef || !canSend} onClick={() => { ask({ category: 'measuring', measureFeature: f.feature, poiCategory: f.poi, seeker: ref!, label: `Measuring: ${f.label}` }); flash() }} sent={sent} />
        </Section>
      )}
      {(cat === 'tentacle' || cat === 'photo') && (
        <Section title={cat === 'tentacle' ? 'Tentacles (manual)' : 'Photos (manual)'}>
          <input placeholder="Describe the question" value={note} onChange={(e) => setNote(e.target.value)} />
          <Send disabled={!canSend} onClick={() => { ask({ category: cat, label: `${cat === 'tentacle' ? 'Tentacles' : 'Photo'}: ${note || '(question)'}` }); setNote(''); flash() }} sent={sent} />
        </Section>
      )}
    </div>
  )
}

// ---- HIDER: answer incoming questions (with a suggested answer) ----
function AnswerTab() {
  const log = useStore((s) => s.log)
  const myPos = useStore((s) => s.myPos)
  const data = useStore((s) => s.appData)
  const answer = useStore((s) => s.answerQuestion)
  const pending = log.filter((e) => e.status === 'pending')
  const answered = [...log].filter((e) => e.status === 'answered').reverse()

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {!myPos && <div style={{ color: 'var(--warn)', fontSize: 13 }}>Turn on GPS in the Location tab to get suggested answers.</div>}
      {pending.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No questions waiting. You will be notified when the seekers ask.</div>}
      {pending.map((e) => {
        const sug = data && myPos ? suggestAnswer(data, myPos, e) : null
        return (
          <div key={e.id} style={{ display: 'grid', gap: 8, padding: '10px', background: 'var(--panel-2)', borderRadius: 10, border: '1px solid var(--accent)' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{e.label}</div>
            {e.askedBy && <div style={{ fontSize: 11, color: 'var(--muted)' }}>from {e.askedBy}</div>}
            <AnswerControls entry={e} suggestion={sug} onAnswer={(a) => answer(e.id, a)} />
            {sug !== null && <div style={{ fontSize: 11, color: 'var(--seeker)' }}>Suggested: {fmtAnswer(sug)} (auto-computed from your location)</div>}
          </div>
        )
      })}
      {answered.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Answered</div>
          {answered.slice(0, 8).map((e) => (
            <div key={e.id} style={{ fontSize: 12, padding: '6px 8px', background: 'var(--panel-2)', borderRadius: 8, marginBottom: 4 }}>
              {e.label} -&gt; <b>{fmtAnswer(e.answer)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AnswerControls({ entry, suggestion, onAnswer }: { entry: LogEntry; suggestion: Suggestion; onAnswer: (a: LogEntry['answer']) => void }) {
  const [text, setText] = useState('')
  const opts = answerOptions(entry)
  if (opts.length === 0) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="Type your answer" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="primary" onClick={() => onAnswer(text || 'answered')}>Send</button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {opts.map(([val, label]) => (
        <button key={String(val)} onClick={() => onAnswer(val)} className={suggestion === val ? 'primary' : ''} style={{ flex: 1 }}>
          {label}{suggestion === val ? ' *' : ''}
        </button>
      ))}
    </div>
  )
}

function answerOptions(e: LogEntry): [LogEntry['answer'], string][] {
  switch (e.category) {
    case 'radar': return [[true, 'Within'], [false, 'Outside']]
    case 'matching': return [[true, 'Same'], [false, 'Different']]
    case 'thermometer': return [['hotter', 'Hotter'], ['colder', 'Colder']]
    case 'measuring': return [['closer', 'Closer'], ['farther', 'Further']]
    default: return []
  }
}
function fmtAnswer(a: LogEntry['answer']): string {
  if (a === true) return 'yes'
  if (a === false) return 'no'
  if (a == null) return 'pending'
  return String(a)
}

// ---- HIDER: deck (manual add + play) ----
function DeckTab() {
  const hand = useStore((s) => s.hand)
  const bonus = useStore((s) => s.bonusMinutes)
  const add = useStore((s) => s.addCardToDeck)
  const play = useStore((s) => s.playCard)
  const remove = useStore((s) => s.removeHandCard)
  const [pick, setPick] = useState('')
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 13 }}>Time banked: <b style={{ color: 'var(--seeker)' }}>+{bonus} min</b></div>
      <Section title="Add a card you drew">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose a card...</option>
          {CARD_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button className="primary" disabled={!pick} onClick={() => { const c = CARDS.find((x) => x.id === pick); if (c) add(c); setPick('') }}>Add to deck</button>
      </Section>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Your deck ({hand.length})</div>
      {hand.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No cards yet. Add the cards you draw with the physical deck.</div>}
      {hand.map((c) => (
        <div key={c.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--panel-2)', borderRadius: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
            {c.text && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.text}</div>}
          </div>
          <button className="primary" onClick={() => play(c.uid)}>Play</button>
          <button className="danger" onClick={() => remove(c.uid)} style={{ padding: '6px 9px' }}>x</button>
        </div>
      ))}
    </div>
  )
}

function LogTab() {
  const log = useStore((s) => s.log)
  const toggle = useStore((s) => s.toggleEntry)
  const remove = useStore((s) => s.removeEntry)
  const clear = useStore((s) => s.clearLog)
  if (!log.length) return <div style={{ color: 'var(--muted)', fontSize: 13 }}>No questions yet.</div>
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {[...log].reverse().map((e) => (
        <div key={e.id} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          background: 'var(--panel-2)', borderRadius: 10, opacity: e.active ? 1 : 0.45
        }}>
          <span style={{ flex: 1, fontSize: 13 }}>
            {e.label} {e.status === 'pending' ? <i style={{ color: 'var(--warn)' }}>(waiting)</i> : <>-&gt; <b>{fmtAnswer(e.answer)}</b></>}{e.approx ? ' (approx)' : ''}
          </span>
          {e.status === 'answered' && <button onClick={() => toggle(e.id)} style={{ padding: '4px 8px', fontSize: 12 }}>{e.active ? 'off' : 'on'}</button>}
          <button onClick={() => remove(e.id)} className="danger" style={{ padding: '4px 8px', fontSize: 12 }}>x</button>
        </div>
      ))}
      <button onClick={clear} className="danger">Clear log</button>
    </div>
  )
}

function PosTab() {
  const gps = useStore((s) => s.gpsEnabled)
  const setGps = useStore((s) => s.setGps)
  const requestGps = useStore((s) => s.requestGps)
  const gpsError = useStore((s) => s.gpsError)
  const myPos = useStore((s) => s.myPos)
  const ref = useStore((s) => s.seekerRef)
  const setMyPos = useStore((s) => s.setMyPos)
  const role = useStore((s) => s.myRole())
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Row label="My location (GPS)"><b>{fmtPos(myPos)}</b></Row>
      <button className={gps ? 'primary' : ''} onClick={() => (gps ? setGps(false) : requestGps())}>
        {gps ? 'GPS tracking ON (tap to stop)' : 'Turn on GPS tracking'}
      </button>
      {gpsError && <div style={{ fontSize: 12, color: 'var(--warn)' }}>{gpsError}</div>}
      {role === 'seeker' && <>
        <Row label="Asker location"><b>{fmtPos(ref)}</b></Row>
        <button onClick={() => ref && setMyPos(ref)} disabled={!ref}>Set my location to asker point (testing)</button>
      </>}
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {role === 'hider'
          ? 'Keep GPS on so the app can suggest the correct answer to each question.'
          : 'Tap the map to set the asker location (where the question is asked from).'}
      </div>
    </div>
  )
}

function SetTab() {
  const s = useStore()
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <fieldset style={fs}><legend>You</legend>
        <Row label="Name"><input value={s.name} onChange={(e) => s.setIdentity(e.target.value, s.team)} placeholder="Player" /></Row>
        <Row label="My team"><TeamPick value={s.team} onChange={(t) => s.setIdentity(s.name, t)} /></Row>
      </fieldset>

      <fieldset style={fs}><legend>Round and time</legend>
        <Row label="Team hiding first"><TeamPick value={s.startingTeam} onChange={s.setStartingTeam} /></Row>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Round {s.round}, team <b>{s.hidingTeam()}</b> is hiding. Phase: <b>{PHASE_LABEL[s.phase]}</b>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={s.phase === 'hiding' ? 'primary' : ''} onClick={() => s.startPhase('hiding')}>Start hiding ({s.settings.hideMinutes} min)</button>
          <button className={s.phase === 'seeking' ? 'primary' : ''} onClick={() => s.startPhase('seeking')}>Start seeking</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => s.startPhase('idle')}>Stop timer</button>
          <button className="danger" onClick={() => s.nextRound()}>End round, next round</button>
        </div>
      </fieldset>

      <fieldset style={fs}><legend>Rules</legend>
        <Row label="Hiding (min)"><Num value={s.settings.hideMinutes} onChange={(v) => s.patchSettings({ hideMinutes: v })} /></Row>
        <Row label="Seeking limit (min)"><Num value={s.settings.seekMinutes} onChange={(v) => s.patchSettings({ seekMinutes: v })} /></Row>
        <Row label="Hiding zone radius (m)"><Num value={s.settings.hidingRadiusM} onChange={(v) => s.patchSettings({ hidingRadiusM: v })} /></Row>
        <Row label="M2 Deak..Ors closed">
          <button className={s.settings.m2Excluded ? 'primary' : ''} onClick={() => s.patchSettings({ m2Excluded: !s.settings.m2Excluded })}>
            {s.settings.m2Excluded ? 'Yes (final)' : 'no'}
          </button>
        </Row>
      </fieldset>

      <fieldset style={fs}><legend>Map and room</legend>
        <Row label="Show places (POI)">
          <button className={s.showPoi ? 'primary' : ''} onClick={() => s.setShowPoi(!s.showPoi)}>{s.showPoi ? 'On' : 'Off'}</button>
        </Row>
        <Row label="Room code"><input value={s.roomCode ?? ''} onChange={(e) => s.setRoom(e.target.value || null)} placeholder="e.g. BUDA42" /></Row>
        <button onClick={() => s.leaveGame()}>Back to waiting room</button>
      </fieldset>
    </div>
  )
}

// building blocks
function useTick(active: boolean) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const i = setInterval(() => setN((n) => n + 1), 1000)
    return () => clearInterval(i)
  }, [active])
}
function countdown(until?: number): string {
  if (!until) return ''
  const s = Math.max(0, Math.round((until - Date.now()) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const fs: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', margin: 0 }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 8, padding: '8px 10px', background: 'var(--panel-2)', borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  )
}
function Send({ onClick, disabled, sent }: { onClick: () => void; disabled?: boolean; sent?: boolean }) {
  return <button className="primary" onClick={onClick} disabled={disabled} style={{ padding: '10px' }}>{sent ? 'Sent' : 'Send question'}</button>
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', fontSize: 13 }}>
    <span style={{ color: 'var(--muted)' }}>{label}</span>{children}
  </label>
}
function Choices<T extends string | number>({ value, set, opts }: { value: T; set: (v: T) => void; opts: [T, string][] }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
    {opts.map(([v, l]) => (
      <button key={String(v)} onClick={() => set(v)} className={value === v ? 'primary' : ''} style={{ padding: '5px 10px', fontSize: 13 }}>{l}</button>
    ))}
  </div>
}
function Select({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: [number, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}
function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ width: 90 }} />
}
function TeamPick({ value, onChange }: { value: Team; onChange: (t: Team) => void }) {
  return <div style={{ display: 'flex', gap: 6 }}>
    {(['A', 'B'] as Team[]).map((t) => (
      <button key={t} onClick={() => onChange(t)} className={value === t ? 'primary' : ''} style={{ padding: '5px 14px' }}>{t}</button>
    ))}
  </div>
}
