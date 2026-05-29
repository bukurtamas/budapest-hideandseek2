import { useEffect, useState } from 'react'
import { useStore } from '../store'

export default function RoleBar() {
  const role = useStore((s) => s.myRole())
  const round = useStore((s) => s.round)
  const area = useStore((s) => s.areaKm2)
  const empty = useStore((s) => s.empty)
  const computing = useStore((s) => s.computing)
  const bonus = useStore((s) => s.bonusMinutes)
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
  // Time bonuses played by the hider adjust their displayed time. How depends
  // on the mode: a non-zero limit counts down (bonus is taken off the time
  // remaining); a zero limit counts up (bonus is added to the elapsed time).
  const tb = isHider ? bonus : 0
  const timer = phaseTimer(phase, phaseStart, settings.hideMinutes, settings.seekMinutes, tb)

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
      {isHider && bonus > 0 && <span style={{ ...chip, color: 'var(--seeker)', fontWeight: 700 }} title={settings.seekMinutes > 0 ? 'time bonus taken off the remaining time' : 'time bonus added to the elapsed time'}>+{bonus}</span>}
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

function phaseTimer(phase: string, start: number | null, hideMin: number, seekMin: number, bonusMin: number) {
  if ((phase !== 'hiding' && phase !== 'seeking') || !start) return null
  const limitMin = phase === 'hiding' ? hideMin : seekMin
  const label = phase === 'hiding' ? 'Hiding' : 'Seeking'
  const elapsed = Math.floor((Date.now() - start) / 1000)
  const bonus = bonusMin * 60

  // Limit 0 => open-ended: the clock counts up and the time bonus is added on top.
  if (limitMin <= 0) {
    return { label, text: clock(elapsed + bonus), warn: false, over: false }
  }

  // Limit > 0 => countdown: the time bonus is taken off the remaining time.
  const remaining = limitMin * 60 - elapsed - bonus
  const over = remaining < 0
  return { label, text: `${over ? '+' : ''}${clock(Math.abs(remaining))}`, warn: !over && remaining < 300, over }
}

function clock(totalSec: number): string {
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function fmtArea(km2: number): string {
  if (!km2) return '–'
  if (km2 < 1) return `${Math.round(km2 * 100)} ha`
  return `${km2.toFixed(1)} km²`
}
