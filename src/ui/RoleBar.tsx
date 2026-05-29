import { useEffect, useState } from 'react'
import { useStore } from '../store'

export default function RoleBar() {
  const role = useStore((s) => s.myRole())
  const round = useStore((s) => s.round)
  const area = useStore((s) => s.areaKm2)
  const empty = useStore((s) => s.empty)
  const computing = useStore((s) => s.computing)
  const phase = useStore((s) => s.phase)
  const phaseStart = useStore((s) => s.phaseStart)
  const settings = useStore((s) => s.settings)

  // tick every second so the countdown updates
  const [, setTick] = useState(0)
  useEffect(() => {
    if (phase !== 'hiding' && phase !== 'seeking') return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  const isHider = role === 'hider'
  const timer = phaseTimer(phase, phaseStart, settings.hideMinutes, settings.seekMinutes)

  return (
    <div style={{
      position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 8px)', left: 8, right: 52,
      display: 'flex', gap: 6, alignItems: 'center', pointerEvents: 'none', flexWrap: 'wrap'
    }}>
      <span style={{
        background: isHider ? 'var(--hider)' : '#f97316', color: '#fff', fontWeight: 700,
        borderRadius: 999, padding: '5px 12px', fontSize: 13, boxShadow: '0 1px 6px rgba(0,0,0,.3)'
      }}>
        {isHider ? 'HIDER' : 'SEEKER'}
      </span>
      <span style={chip}>Round {round}</span>
      {timer && (
        <span style={{ ...chip, background: timer.over ? '#7f1d1d' : timer.warn ? 'rgba(245,158,11,.9)' : chip.background, fontWeight: 700 }}>
          {timer.label} {timer.text}
        </span>
      )}
      <span style={{ ...chip, marginLeft: 'auto', color: empty ? '#fca5a5' : 'var(--text)' }}>
        {empty ? 'contradiction' : `area ${fmtArea(area)}`}{computing ? ' ...' : ''}
      </span>
    </div>
  )
}

const chip: React.CSSProperties = {
  background: 'rgba(15,23,42,.85)', borderRadius: 999, padding: '5px 10px', fontSize: 12, color: 'var(--text)'
}

function phaseTimer(phase: string, start: number | null, hideMin: number, seekMin: number) {
  if ((phase !== 'hiding' && phase !== 'seeking') || !start) return null
  const limit = (phase === 'hiding' ? hideMin : seekMin) * 60
  const elapsed = Math.floor((Date.now() - start) / 1000)
  const remaining = limit - elapsed
  const over = remaining < 0
  const abs = Math.abs(remaining)
  const mm = String(Math.floor(abs / 60)).padStart(2, '0')
  const ss = String(abs % 60).padStart(2, '0')
  return {
    label: phase === 'hiding' ? 'Hiding' : 'Seeking',
    text: `${over ? '+' : ''}${mm}:${ss}`,
    warn: !over && remaining < 300,
    over
  }
}

function fmtArea(km2: number): string {
  if (!km2) return '–'
  if (km2 < 1) return `${Math.round(km2 * 100)} ha`
  return `${km2.toFixed(1)} km²`
}
