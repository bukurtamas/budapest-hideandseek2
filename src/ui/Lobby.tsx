import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { isFirebaseConfigured } from '../firebase'
import type { Team } from '../types/game'

function randomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]
  return s
}

export default function Lobby() {
  const s = useStore()
  const [copied, setCopied] = useState(false)

  // Prefill the room code from an invite link (?room=CODE).
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('room')
    if (code && !s.roomCode) s.setRoom(code.toUpperCase())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inviteLink = s.roomCode ? `${location.origin}${location.pathname}?room=${s.roomCode}` : ''
  const role = s.myRole()

  const canEnter = (s.name || '').trim().length > 0

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <div style={{
        maxWidth: 460, margin: '0 auto', display: 'grid', gap: 16,
        padding: 'calc(env(safe-area-inset-top, 0px) + 20px) 16px calc(env(safe-area-inset-bottom, 0px) + 24px)'
      }}>
        <header style={{ textAlign: 'center' }}>
          <h1 style={{ margin: '8px 0 2px', fontSize: 24 }}>Hide + Seek: Budapest</h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
            Rail transit only, within the city limits. Metric, small game.
          </p>
        </header>

        <Box title="Your player">
          <Field label="Name">
            <input value={s.name} onChange={(e) => s.setIdentity(e.target.value, s.team)} placeholder="Your name" autoFocus />
          </Field>
          <Field label="Team">
            <TeamPick value={s.team} onChange={(t) => s.setIdentity(s.name, t)} />
          </Field>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            You will be the{' '}
            <b style={{ color: role === 'hider' ? 'var(--hider)' : '#f97316' }}>{role === 'hider' ? 'Hider' : 'Seeker'}</b>.
          </p>
        </Box>

        <Box title="Game room">
          <Field label="Room code">
            <div style={{ display: 'flex', gap: 6, width: '60%' }}>
              <input value={s.roomCode ?? ''} onChange={(e) => s.setRoom(e.target.value.toUpperCase() || null)} placeholder="join or create" />
              <button onClick={() => s.setRoom(randomCode())} title="Create a new code">New</button>
            </div>
          </Field>
          {inviteLink && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>{inviteLink}</div>
              <button onClick={async () => { try { await navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ } }}>
                {copied ? 'Copied' : 'Copy invite link'}
              </button>
            </div>
          )}
          <p style={{ margin: 0, fontSize: 12, color: isFirebaseConfigured ? 'var(--seeker)' : 'var(--warn)' }}>
            {isFirebaseConfigured
              ? 'Live tracking is on for everyone in the same room.'
              : 'Firebase is not configured: local mode (no live tracking). Everything else works.'}
          </p>
        </Box>

        <Box title="Game settings">
          <Field label="Hiding team"><TeamPick value={s.startingTeam} onChange={s.setStartingTeam} /></Field>
          <Field label="Hiding (min)"><Num value={s.settings.hideMinutes} onChange={(v) => s.patchSettings({ hideMinutes: v })} /></Field>
          <Field label="Seeking limit (min)"><Num value={s.settings.seekMinutes} onChange={(v) => s.patchSettings({ seekMinutes: v })} /></Field>
          <Field label="Hiding zone radius (m)"><Num value={s.settings.hidingRadiusM} onChange={(v) => s.patchSettings({ hidingRadiusM: v })} /></Field>
          <Field label="M2 Deak..Ors closed">
            <button className={s.settings.m2Excluded ? 'primary' : ''} onClick={() => s.patchSettings({ m2Excluded: !s.settings.m2Excluded })}>
              {s.settings.m2Excluded ? 'Yes (final)' : 'No'}
            </button>
          </Field>
        </Box>

        <button className="primary" style={{ padding: '14px', fontSize: 16 }} disabled={!canEnter} onClick={() => s.enterGame()}>
          Enter game
        </button>
        {!canEnter && <p style={{ margin: 0, textAlign: 'center', fontSize: 12, color: 'var(--warn)' }}>Enter a name to continue.</p>}
      </div>
    </div>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', background: 'var(--panel)', display: 'grid', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 14, color: 'var(--accent)' }}>{title}</h2>
      {children}
    </section>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', fontSize: 14 }}>
    <span style={{ color: 'var(--muted)' }}>{label}</span>{children}
  </label>
}
function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} style={{ width: 100 }} />
}
function TeamPick({ value, onChange }: { value: Team; onChange: (t: Team) => void }) {
  return <div style={{ display: 'flex', gap: 6 }}>
    {(['A', 'B'] as Team[]).map((t) => (
      <button key={t} onClick={() => onChange(t)} className={value === t ? 'primary' : ''} style={{ padding: '6px 16px' }}>{t}</button>
    ))}
  </div>
}
