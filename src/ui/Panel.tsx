import { useState } from 'react'
import { useStore } from '../store'
import {
  RADAR_RADII_KM, THERMO_DISTANCES_KM, type Category, type LngLat,
  type MatchKind, type MeasureFeature, type Team
} from '../types/game'
import { POI_LABEL, type PoiCategory } from '../data/types'

const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`)
const fmtPos = (p: LngLat | null) => (p ? `${p[1].toFixed(5)}, ${p[0].toFixed(5)}` : 'not set')

type Tab = 'ask' | 'log' | 'pos' | 'set'
const TAB_LABEL: Record<Tab, string> = { ask: 'Ask', log: 'Log', pos: 'Location', set: 'Settings' }
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
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('ask')

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      background: 'var(--panel)', borderTop: '1px solid var(--line)',
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
      boxShadow: '0 -4px 20px rgba(0,0,0,.4)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', gap: 6 }}>
        <button onClick={() => setOpen((o) => !o)} style={{ padding: '4px 10px' }}>{open ? 'v' : '^'}</button>
        {(['ask', 'log', 'pos', 'set'] as Tab[]).map((t) => (
          <button key={t} onClick={() => { setTab(t); setOpen(true) }}
            className={tab === t ? 'primary' : ''} style={{ flex: 1, padding: '6px 4px', fontSize: 13 }}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {open && (
        <div style={{ maxHeight: '46vh', overflowY: 'auto', padding: '4px 12px 14px' }}>
          {tab === 'ask' && <AskTab />}
          {tab === 'log' && <LogTab />}
          {tab === 'pos' && <PosTab />}
          {tab === 'set' && <SetTab />}
        </div>
      )}
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

function AskTab() {
  const ref = useStore((s) => s.seekerRef)
  const myPos = useStore((s) => s.myPos)
  const setRef = useStore((s) => s.setSeekerRef)
  const addEntry = useStore((s) => s.addEntry)

  const [cat, setCat] = useState<Category>('radar')
  const [matchIdx, setMatchIdx] = useState(0)
  const [radiusKm, setRadiusKm] = useState(1)
  const [thermoMin, setThermoMin] = useState(THERMO_DISTANCES_KM[0])
  const [thermoFrom, setThermoFrom] = useState<LngLat | null>(null)
  const [measureIdx, setMeasureIdx] = useState(0)
  const [note, setNote] = useState('')

  const noRef = !ref
  const m = MATCH_OPTS[matchIdx]
  const f = MEASURE_OPTS[measureIdx]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        Asker location: <b style={{ color: 'var(--text)' }}>{fmtPos(ref)}</b>
        {noRef && <div style={{ color: 'var(--warn)' }}>Tap the map, or set your own location.</div>}
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
          {m.kind === 'line' && <Hint text="Transit line matching is approximate." />}
          <YesNo disabled={noRef} yes="Yes, same" no="No, different"
            onYes={() => addEntry({ category: 'matching', matchKind: m.kind, poiCategory: m.poi, seeker: ref!, answer: true, approx: m.kind === 'line', label: `Matching, ${m.label}: yes` })}
            onNo={() => addEntry({ category: 'matching', matchKind: m.kind, poiCategory: m.poi, seeker: ref!, answer: false, approx: m.kind === 'line', label: `Matching, ${m.label}: no` })} />
        </Section>
      )}

      {cat === 'radar' && (
        <Section title="Are you within this distance of me?">
          <Choices value={radiusKm} set={setRadiusKm} opts={RADAR_RADII_KM.map((r) => [r, fmtKm(r)] as [number, string])} />
          <YesNo disabled={noRef} yes="Yes, within" no="No, outside"
            onYes={() => addEntry({ category: 'radar', radiusKm, seeker: ref!, answer: true, label: `Radar ${fmtKm(radiusKm)}: within` })}
            onNo={() => addEntry({ category: 'radar', radiusKm, seeker: ref!, answer: false, label: `Radar ${fmtKm(radiusKm)}: outside` })} />
        </Section>
      )}

      {cat === 'thermometer' && (
        <Section title="After moving, am I hotter or colder?">
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Start point: <b style={{ color: 'var(--text)' }}>{fmtPos(thermoFrom)}</b></div>
          <Choices value={thermoMin} set={setThermoMin} opts={THERMO_DISTANCES_KM.map((d) => [d, `at least ${fmtKm(d)}`] as [number, string])} />
          <button onClick={() => setThermoFrom(ref)} disabled={noRef}>Set start point (current asker location)</button>
          <YesNo disabled={noRef || !thermoFrom} yes="Hotter" no="Colder"
            onYes={() => { addEntry({ category: 'thermometer', from: thermoFrom!, to: ref!, thermoMinKm: thermoMin, answer: 'hotter', label: `Thermometer at least ${fmtKm(thermoMin)}: hotter` }); setThermoFrom(ref) }}
            onNo={() => { addEntry({ category: 'thermometer', from: thermoFrom!, to: ref!, thermoMinKm: thermoMin, answer: 'colder', label: `Thermometer at least ${fmtKm(thermoMin)}: colder` }); setThermoFrom(ref) }} />
        </Section>
      )}

      {cat === 'measuring' && (
        <Section title="Compared to me, are you closer to or further from ___?">
          <Select value={measureIdx} onChange={setMeasureIdx} options={MEASURE_OPTS.map((o, i) => [i, o.label])} />
          <YesNo disabled={noRef} yes="Closer" no="Further"
            onYes={() => addEntry({ category: 'measuring', measureFeature: f.feature, poiCategory: f.poi, seeker: ref!, answer: 'closer', label: `Measuring, ${f.label}: closer` })}
            onNo={() => addEntry({ category: 'measuring', measureFeature: f.feature, poiCategory: f.poi, seeker: ref!, answer: 'farther', label: `Measuring, ${f.label}: further` })} />
        </Section>
      )}

      {(cat === 'tentacle' || cat === 'photo') && (
        <Section title={cat === 'tentacle' ? 'Tentacles (manual, no auto zone)' : 'Photos (manual, no auto zone)'}>
          <input placeholder="Note for the log" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" onClick={() => { addEntry({ category: cat, answer: null, label: `${cat === 'tentacle' ? 'Tentacles' : 'Photo'}: ${note || '(none)'}` }); setNote('') }}>Add to log</button>
        </Section>
      )}
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
          <span style={{ flex: 1, fontSize: 13 }}>{e.label}{e.approx ? ' (approx)' : ''}</span>
          <button onClick={() => toggle(e.id)} style={{ padding: '4px 8px', fontSize: 12 }}>{e.active ? 'off' : 'on'}</button>
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
  const myPos = useStore((s) => s.myPos)
  const ref = useStore((s) => s.seekerRef)
  const setMyPos = useStore((s) => s.setMyPos)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Row label="My location (GPS)"><b>{fmtPos(myPos)}</b></Row>
      <button className={gps ? 'primary' : ''} onClick={() => setGps(!gps)}>{gps ? 'GPS tracking ON' : 'Turn on GPS tracking'}</button>
      <Row label="Asker location"><b>{fmtPos(ref)}</b></Row>
      <button onClick={() => ref && setMyPos(ref)} disabled={!ref}>Set my location to asker point (testing)</button>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        Tip: tap the map to set the asker location (where the question is asked from). Seeker positions appear live when Firebase is configured.
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

      <fieldset style={fs}><legend>Map</legend>
        <Row label="Show places (POI)">
          <button className={s.showPoi ? 'primary' : ''} onClick={() => s.setShowPoi(!s.showPoi)}>{s.showPoi ? 'On' : 'Off'}</button>
        </Row>
        <Row label="Room code"><input value={s.roomCode ?? ''} onChange={(e) => s.setRoom(e.target.value || null)} placeholder="e.g. BUDA42" /></Row>
        <button onClick={() => s.leaveGame()}>Back to lobby</button>
      </fieldset>
    </div>
  )
}

// building blocks
const fs: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', margin: 0 }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 8, padding: '8px 10px', background: 'var(--panel-2)', borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  )
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', fontSize: 13 }}>
    <span style={{ color: 'var(--muted)' }}>{label}</span>{children}
  </label>
}
function Hint({ text }: { text: string }) {
  return <div style={{ fontSize: 11, color: 'var(--muted)' }}>{text}</div>
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
function YesNo({ onYes, onNo, disabled, yes = 'Yes', no = 'No' }: { onYes: () => void; onNo: () => void; disabled?: boolean; yes?: string; no?: string }) {
  return <div style={{ display: 'flex', gap: 8 }}>
    <button onClick={onYes} disabled={disabled} className="primary" style={{ flex: 1 }}>{yes}</button>
    <button onClick={onNo} disabled={disabled} style={{ flex: 1, background: '#7f1d1d' }}>{no}</button>
  </div>
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
