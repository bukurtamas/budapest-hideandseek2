import { useEffect, useState } from 'react'
import { useStore } from '../store'

// Status banners under the role bar: waiting for players, incoming questions
// (hider), and active played-card effects (everyone). Effect banners auto-expire
// and can be dismissed with the x button.
export default function Banners() {
  const role = useStore((s) => s.myRole())
  const roomCode = useStore((s) => s.roomCode)
  const active = useStore((s) => s.gameActive())
  const present = useStore((s) => s.presentRoles())
  const pending = useStore((s) => s.log.filter((e) => e.status === 'pending').length)
  const effects = useStore((s) => s.effects)
  const dismissed = useStore((s) => s.dismissedEffectIds)
  const dismiss = useStore((s) => s.dismissEffect)
  const [, setN] = useState(0)
  useEffect(() => { const i = setInterval(() => setN((n) => n + 1), 1000); return () => clearInterval(i) }, [])

  const now = Date.now()
  const fixed: { key: string; text: string; color: string }[] = []
  if (roomCode && !active) {
    const need: string[] = []
    if (!present.hider) need.push('a hider')
    if (!present.seeker) need.push('a seeker')
    fixed.push({ key: 'wait', text: `Waiting for ${need.join(' and ')} to join the room`, color: 'var(--warn)' })
  }
  if (role === 'hider' && pending > 0) fixed.push({ key: 'pend', text: `${pending} question${pending > 1 ? 's' : ''} to answer (Answer tab)`, color: 'var(--hider)' })
  if (role === 'seeker' && pending > 0) fixed.push({ key: 'wait2', text: `Waiting for the hider to answer ${pending} question${pending > 1 ? 's' : ''}`, color: 'var(--muted)' })

  const cards = effects.filter((e) => (!e.until || e.until > now) && !dismissed.includes(e.id))

  if (!fixed.length && !cards.length) return null
  return (
    <div style={{
      position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 44px)', left: 8, right: 8,
      display: 'grid', gap: 6, pointerEvents: 'none', maxHeight: '40vh', overflow: 'hidden'
    }}>
      {fixed.map((b) => (
        <div key={b.key} style={bannerStyle(b.color)}>{b.text}</div>
      ))}
      {cards.map((e) => {
        const lock = e.kind === 'askLock' || e.kind === 'delay'
        return (
          <div key={e.id} style={{ ...bannerStyle(lock ? 'var(--hider)' : 'var(--accent)'), pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>{e.cardName}{e.until ? ' (' + cd(e.until) + ')' : ''}</span>
            <button onClick={() => dismiss(e.id)} style={{ padding: '2px 8px', fontSize: 12, background: 'transparent', border: '1px solid currentColor', color: 'inherit' }}>x</button>
          </div>
        )
      })}
    </div>
  )
}

function bannerStyle(color: string): React.CSSProperties {
  return {
    background: 'rgba(15,23,42,.92)', border: `1px solid ${color}`, color,
    borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 600, textAlign: 'center'
  }
}
function cd(until: number): string {
  const s = Math.max(0, Math.round((until - Date.now()) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
