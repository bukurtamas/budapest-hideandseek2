import { useStore } from '../store'

// Status banners under the role bar: waiting for players, and (for the hider)
// incoming questions to answer.
export default function Banners() {
  const role = useStore((s) => s.myRole())
  const roomCode = useStore((s) => s.roomCode)
  const active = useStore((s) => s.gameActive())
  const present = useStore((s) => s.presentRoles())
  const pending = useStore((s) => s.log.filter((e) => e.status === 'pending').length)

  const items: { key: string; text: string; color: string }[] = []
  if (roomCode && !active) {
    const need: string[] = []
    if (!present.hider) need.push('a hider')
    if (!present.seeker) need.push('a seeker')
    items.push({ key: 'wait', text: `Waiting for ${need.join(' and ')} to join the room`, color: 'var(--warn)' })
  }
  if (role === 'hider' && pending > 0) {
    items.push({ key: 'pend', text: `${pending} question${pending > 1 ? 's' : ''} to answer (Answer tab)`, color: 'var(--hider)' })
  }
  if (role === 'seeker' && pending > 0) {
    items.push({ key: 'wait2', text: `Waiting for the hider to answer ${pending} question${pending > 1 ? 's' : ''}`, color: 'var(--muted)' })
  }
  if (!items.length) return null

  return (
    <div style={{
      position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 44px)', left: 8, right: 8,
      display: 'grid', gap: 6, pointerEvents: 'none'
    }}>
      {items.map((b) => (
        <div key={b.key} style={{
          background: 'rgba(15,23,42,.92)', border: `1px solid ${b.color}`, color: b.color,
          borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 600, textAlign: 'center'
        }}>{b.text}</div>
      ))}
    </div>
  )
}
