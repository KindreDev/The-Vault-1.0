import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, ChevronDown, Coins, Heart, Flame, FolderSync, Server, Power, Loader2, Award,
         Images, Film, Users, Droplet, Trophy, Clock, Calendar, Layers } from 'lucide-react'
import { gamiApi, scannerApi, systemApi, galleriesApi, sessionsApi } from '../lib/api.js'
import { getServerBase, setServerBase } from '../lib/server.js'
import { refreshApiBase } from '../lib/api.js'
import { useVaultStore, PALETTES } from '../store/vault.js'
import { Spinner } from '../components/ui.jsx'
import BottomSheet from '../components/BottomSheet.jsx'

// Level titles — mirrors backend LEVEL_TITLES (unlocked by reaching the level).
const LEVEL_TITLES = [
  { level: 1, title: 'The Lurker' },      { level: 6, title: 'Peeking Shadow' },
  { level: 11, title: 'Desire Seeker' },  { level: 16, title: 'Vault Delver' },
  { level: 21, title: 'Sin Collector' },  { level: 26, title: 'Acolyte of Lust' },
  { level: 31, title: 'Devoted Stroker' },{ level: 36, title: 'Pleasure Archivist' },
  { level: 41, title: 'Goon Disciple' },  { level: 46, title: 'Metadata Priest' },
  { level: 51, title: 'High Priest of HD' }, { level: 56, title: 'Curator of Sin' },
  { level: 61, title: 'The Degenerate' }, { level: 66, title: 'Elite Gooner' },
  { level: 71, title: 'Vault Sovereign' },{ level: 76, title: 'Lord of Indulgence' },
  { level: 81, title: 'Grand Archivist' },{ level: 86, title: 'Legendary Coomer' },
  { level: 91, title: 'The Completionist' }, { level: 96, title: 'God Emperor of the Vault' },
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// Format a millisecond duration into a compact "Xh Ym" / "Ym" string.
function fmtMs(ms) {
  if (!ms || ms < 1000) return '0m'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// A compact stat tile for the data grids.
function StatBox({ icon, label, value, color }) {
  return (
    <div className="flex flex-col gap-1 rounded-vault p-3" style={{ background: 'var(--c-card)' }}>
      <div style={{ color }}>{icon}</div>
      <div className="text-xl font-bold leading-none">{value ?? 0}</div>
      <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="px-4 mt-6">
      <h2 className="text-[15px] font-semibold mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>{title}</h2>
      <div className="rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>{children}</div>
    </div>
  )
}

function Row({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[16px] disabled:opacity-50"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      {children}
    </button>
  )
}

export default function Profile() {
  const qc = useQueryClient()
  const profile = useVaultStore(s => s.profile)
  const setProfile = useVaultStore(s => s.setProfile)
  const palette = useVaultStore(s => s.palette)
  const setPalette = useVaultStore(s => s.setPalette)
  const addToast = useVaultStore(s => s.addToast)

  const [titleOpen, setTitleOpen] = useState(false)
  const [scan, setScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [addr, setAddr] = useState(getServerBase())
  const [version, setVersion] = useState('')
  const [avatarBust, setAvatarBust] = useState(Date.now())
  const fileRef = useRef(null)
  const poll = useRef(null)

  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => galleriesApi.stats().then(r => r.data) })
  const { data: lastSessions } = useQuery({ queryKey: ['recent-sessions'], queryFn: () => sessionsApi.list({ limit: 1 }).then(r => r.data) })

  useEffect(() => {
    systemApi.getVersion().then(r => setVersion(r.data?.version || '')).catch(() => {})
    return () => clearInterval(poll.current)
  }, [])

  if (!profile) return <Spinner />

  const level = profile.level ?? 1
  const displayTitle = profile.selected_title || profile.level_title || 'The Lurker'
  const unlockedTitles = LEVEL_TITLES.filter(t => t.level <= level)
  const pct = profile.xp_to_next
    ? Math.min(100, Math.round(((profile.total_xp || 0) / ((profile.total_xp || 0) + profile.xp_to_next)) * 100))
    : 0
  const avatarUrl = profile.avatar_path ? gamiApi.avatarUrl(avatarBust) : null

  async function pickTitle(title) {
    setTitleOpen(false)
    try {
      const { data } = await gamiApi.updateProfile({ selected_title: title })
      setProfile({ ...profile, selected_title: data.selected_title })
    } catch { addToast('Failed', 'info') }
  }

  async function onAvatar(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await gamiApi.uploadAvatar(file)
      const { data } = await gamiApi.profile()
      setProfile(data); setAvatarBust(Date.now())
      addToast('Photo updated', 'xp')
    } catch { addToast('Upload failed', 'info') }
    e.target.value = ''
  }

  async function triggerScan() {
    try {
      await scannerApi.scan(); setScanning(true); addToast('Scan started', 'info')
      clearInterval(poll.current)
      poll.current = setInterval(async () => {
        try {
          const { data } = await scannerApi.status()
          setScan(data)
          if (!data.running) { clearInterval(poll.current); setScanning(false); addToast(`Scan done · +${data.new_galleries} galleries`, 'xp') }
        } catch { clearInterval(poll.current); setScanning(false) }
      }, 1200)
    } catch (e) { addToast(e?.response?.data?.detail || 'Scan failed', 'info') }
  }
  async function restart() {
    if (!confirm('Restart the Vault server? The app will lose connection for a moment.')) return
    try { await systemApi.restart(); addToast('Server restarting…', 'info') }
    catch { addToast('Restart signal sent', 'info') }
  }
  function saveAddr() {
    const v = setServerBase(addr); refreshApiBase(); setAddr(v); addToast('Server address saved', 'info')
  }

  return (
    <div>
      {/* Profile header */}
      <div className="px-4 pt-[calc(var(--sat)+20px)] pb-2 flex items-center gap-4">
        <button onClick={() => fileRef.current?.click()} className="relative shrink-0">
          <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center"
               style={{ background: 'var(--c-card)', border: '2px solid var(--accent)' }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              : <span className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>{(profile.username || 'V')[0].toUpperCase()}</span>}
          </div>
          <span className="absolute bottom-0 right-0 p-1.5 rounded-full" style={{ background: 'var(--accent)' }}>
            <Camera size={14} color="#fff" />
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatar} />
        <div className="flex-1 min-w-0">
          <div className="text-2xl font-bold truncate">{profile.username || 'Vault User'}</div>
          <div className="text-[15px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Level {level}</div>
          <button onClick={() => setTitleOpen(true)} className="mt-1 flex items-center gap-1 text-[15px] font-semibold"
                  style={{ color: 'var(--accent)' }}>
            <Award size={16} /> {displayTitle} <ChevronDown size={15} />
          </button>
        </div>
      </div>

      {/* XP bar */}
      <div className="px-4 pt-2">
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-card)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
        </div>
        <div className="mt-1 text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {profile.total_xp ?? 0} XP{profile.xp_to_next ? ` · ${profile.xp_to_next} to next` : ''}
        </div>
      </div>

      {/* Credits / hearts / streak (moved off the dashboard) */}
      <div className="grid grid-cols-3 gap-2.5 px-4 mt-4">
        <div className="flex flex-col items-center gap-1 rounded-vault p-3" style={{ background: 'var(--c-card)' }}>
          <Coins size={22} style={{ color: 'var(--c-amber)' }} />
          <div className="text-xl font-bold">{profile.vault_credits ?? 0}</div>
          <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Credits</div>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-vault p-3" style={{ background: 'var(--c-card)' }}>
          <Heart size={22} style={{ color: 'var(--c-pink)' }} />
          <div className="text-xl font-bold">{profile.hearts ?? 0}</div>
          <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Hearts</div>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-vault p-3" style={{ background: 'var(--c-card)' }}>
          <Flame size={22} style={{ color: 'var(--c-amber)' }} />
          <div className="text-xl font-bold">{profile.streak_days ?? 0}</div>
          <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Day streak</div>
        </div>
      </div>

      {/* ── Last session summary ───────────────────────────────── */}
      {(() => {
        const last = lastSessions?.[0]
        if (!last) return null
        const ts = last.logged_at && !String(last.logged_at).endsWith('Z') ? last.logged_at + 'Z' : last.logged_at
        const when = (() => {
          const diff = Date.now() - new Date(ts).getTime()
          const d = Math.floor(diff / 86400000)
          if (d <= 0) return 'Today'
          if (d === 1) return 'Yesterday'
          return DAYS[new Date(ts).getDay()]
        })()
        const dur = last.duration_sec ? fmtMs(last.duration_sec * 1000) : null
        const parts = []
        if (dur) parts.push(`gooned for ${dur}`)
        if (last.creator_name) parts.push(`with ${last.creator_name}`)
        const summary = parts.length ? parts.join(' ') : 'session logged'
        return (
          <div className="mx-4 mt-5 rounded-vault flex items-center gap-3 p-4"
               style={{ background: 'rgba(212,83,126,0.07)', border: '0.5px solid rgba(212,83,126,0.25)' }}>
            <span className="text-2xl shrink-0">🎮</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>Last session · {when}</div>
              <div className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>You {summary}</div>
              {last.gallery_name && <div className="text-[13px] truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{last.gallery_name}</div>}
            </div>
            {last.xp_earned > 0 && <div className="text-[14px] font-bold shrink-0" style={{ color: 'var(--accent)' }}>+{last.xp_earned} XP</div>}
          </div>
        )
      })()}

      {/* ── Collection ─────────────────────────────────────────── */}
      <div className="px-4 mt-6">
        <h2 className="text-[15px] font-semibold mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>COLLECTION</h2>
        <div className="grid grid-cols-3 gap-2.5">
          <StatBox icon={<Images size={20} />} label="Galleries" value={stats?.total_galleries} color="var(--accent)" />
          <StatBox icon={<Users size={20} />}  label="Creators"  value={stats?.total_creators}  color="var(--accent)" />
          <StatBox icon={<Layers size={20} />} label="Images"    value={stats?.total_images}    color="var(--accent)" />
          <StatBox icon={<Film size={20} />}    label="Videos"    value={stats?.total_videos}    color="var(--accent)" />
          <StatBox icon={<Droplet size={20} />} label="Total Os"  value={stats?.total_cum_count} color="var(--c-pink)" />
          <StatBox icon={<Flame size={20} />}   label="Sessions"  value={stats?.total_sessions}  color="var(--c-amber)" />
        </div>
      </div>

      {/* ── Gooning & activity ─────────────────────────────────── */}
      <div className="px-4 mt-6">
        <h2 className="text-[15px] font-semibold mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>GOONING &amp; ACTIVITY</h2>
        <div className="grid grid-cols-3 gap-2.5">
          <StatBox icon={<Clock size={20} />}   label="Time gooning"    value={fmtMs(stats?.session_total_ms ?? 0)} color="var(--c-pink)" />
          <StatBox icon={<Trophy size={20} />}  label="Longest"         value={fmtMs((stats?.longest_session_sec ?? 0) * 1000)} color="var(--accent)" />
          <StatBox icon={<Flame size={20} />}   label="Best streak"     value={`${profile.streak_best ?? 0}d`} color="var(--c-amber)" />
          <StatBox icon={<Calendar size={20} />} label="Peak month"     value={stats?.most_active_month ? MONTHS[stats.most_active_month - 1] : '—'} color="var(--accent)" />
          <StatBox icon={<Calendar size={20} />} label="Peak day"       value={stats?.most_active_day != null ? DAYS[stats.most_active_day] : '—'} color="var(--accent)" />
          <StatBox icon={<Award size={20} />}   label="Total XP"        value={(profile.total_xp ?? 0).toLocaleString()} color="var(--accent)" />
        </div>
      </div>

      {/* ── Settings ───────────────────────────────────────────── */}
      <Section title="THEME">
        <div className="grid grid-cols-4 gap-3 p-4">
          {PALETTES.map(p => {
            const active = palette.id === p.id
            return (
              <button key={p.id} onClick={() => setPalette(p)} className="flex flex-col items-center gap-1.5">
                <div className="relative w-full aspect-square rounded-full overflow-hidden border-2"
                     style={{ borderColor: active ? p.accent : 'transparent', background: p.bg }}>
                  <div className="absolute inset-0 flex">
                    <div className="flex-1" style={{ background: p.accent }} />
                    <div className="flex-1" style={{ background: p.pink }} />
                    <div className="flex-1" style={{ background: p.amber }} />
                  </div>
                  {active && <div className="absolute inset-0 flex items-center justify-center bg-black/30"><Check size={20} color="#fff" /></div>}
                </div>
                <span className="text-[13px]" style={{ color: active ? p.accent : 'rgba(255,255,255,0.5)' }}>{p.label}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="LIBRARY">
        <Row onClick={triggerScan} disabled={scanning}>
          {scanning ? <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
                    : <FolderSync size={20} style={{ color: 'var(--accent)' }} />}
          <div className="flex-1">
            <div>{scanning ? 'Scanning…' : 'Scan library'}</div>
            {scan && scanning && (
              <div className="text-[14px] truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>{scan.progress}/{scan.total} · {scan.message}</div>
            )}
          </div>
        </Row>
      </Section>

      <Section title="SERVER">
        <div className="px-4 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2 mb-2 text-[15px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <Server size={18} /> Vault PC address
          </div>
          <div className="flex gap-2">
            <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="192.168.1.42:8000"
                   autoCapitalize="none" autoCorrect="off"
                   className="flex-1 px-3 py-2.5 rounded-xl bg-transparent outline-none text-[16px]"
                   style={{ border: '1px solid rgba(255,255,255,0.12)' }} />
            <button onClick={saveAddr} className="px-4 rounded-xl text-[15px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Save</button>
          </div>
        </div>
        <Row onClick={restart}>
          <Power size={20} style={{ color: 'var(--c-pink)' }} />
          <span className="flex-1">Restart server</span>
        </Row>
      </Section>

      <div className="text-center text-[14px] mt-8 mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
        The Vault Mobile{version ? ` · v${version}` : ''}
      </div>
      <div className="h-4" />

      {/* Title picker */}
      <BottomSheet open={titleOpen} onClose={() => setTitleOpen(false)} title="Select title"
        actions={unlockedTitles.slice().reverse().map(t => ({
          label: t.title + (displayTitle === t.title ? '  ✓' : ''),
          onClick: () => pickTitle(t.title),
        }))} />
    </div>
  )
}
