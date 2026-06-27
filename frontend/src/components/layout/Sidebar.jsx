import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Images, Users, Play, ListMusic,
  Columns3, Gamepad2, Trophy, Star, Map, CreditCard,
  ScanLine, Tag, Settings, Flame, Box, Film, Video, Cpu, ScrollText, Layers,
  Wifi, WifiOff, Activity, BarChart2, GitCompare, ListTodo, Terminal, BookOpen,
  Sparkles,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useVaultStore } from '../../store/vault'
import { useDeviceStore } from '../../store/deviceStore'
import { deviceService } from '../../services/device'
import { gamiApi, companionApi } from '../../lib/api'
import { useT } from '../../i18n'

const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/galleries',   icon: Images,          label: 'Galleries' },
  { to: '/images',      icon: Film,            label: 'Photos' },
  { to: '/videos',      icon: Video,           label: 'Videos' },
  { to: '/creators',    icon: Users,           label: 'Creators' },
]

const GOON_NAV = [
  { to: '/multi-panel',    icon: Columns3,   label: 'Multi-panel' },
  { to: '/device-control', icon: Cpu,        label: 'Device Control' },
]

const COLLECT_NAV = [
  { to: '/stats',         icon: BarChart2,  label: 'Stats' },
  { to: '/quests',        icon: Trophy,     label: 'Quests' },
  { to: '/hall-of-fame',  icon: Star,       label: 'Hall of Fame' },
  { to: '/collection',    icon: Layers,     label: 'Card Collection' },
]

const LIB_NAV = [
  { to: '/tags',        icon: Tag,         label: 'Tag Manager' },
  { to: '/duplicates',  icon: GitCompare,  label: 'Duplicates' },
  { to: '/task-queue',  icon: ListTodo,    label: 'Task Queue' },
  { to: '/console',     icon: Terminal,    label: 'Console' },
  { to: '/help',        icon: BookOpen,    label: 'Help' },
  { to: '/settings',    icon: Settings,    label: 'Settings' },
]

const LEVEL_COLORS = {
  'The Lurker':            '#888780',
  'Peeking Shadow':        '#888780',
  'Desire Seeker':         '#1D9E75',
  'Vault Delver':          '#1D9E75',
  'Sin Collector':         '#378ADD',
  'Acolyte of Lust':       '#378ADD',
  'Devoted Stroker':       '#7F77DD',
  'Pleasure Archivist':    '#7F77DD',
  'Goon Disciple':         '#D4537E',
  'Metadata Priest':       '#D4537E',
  'High Priest of HD':     '#BA7517',
  'Curator of Sin':        '#BA7517',
  'The Degenerate':        '#E24B4A',
  'Elite Gooner':          '#E24B4A',
  'Vault Sovereign':       '#FF6B35',
  'Lord of Indulgence':    '#FF6B35',
  'Grand Archivist':       '#C084FC',
  'Legendary Coomer':      '#C084FC',
  'The Completionist':     '#FFD700',
  'God Emperor of the Vault': '#FFD700',
}

// Quadratic XP formula: xpForLevel(n) = 500 * (1 + 2 + ... + (n-1)) = 250 * n * (n-1)
function xpForLevel(lvl) {
  if (lvl <= 1) return 0
  return Array.from({ length: lvl - 1 }, (_, i) => 500 * (i + 1)).reduce((a, b) => a + b, 0)
}

function xpProgress(totalXp, level) {
  if (level >= 100) return 100
  const current = xpForLevel(level)
  const next    = xpForLevel(level + 1)
  if (next === current) return 100
  return Math.min(100, Math.max(0, ((totalXp - current) / (next - current)) * 100))
}

const STATUS_DOT = {
  disconnected: 'rgba(255,255,255,0.2)',
  connecting:   '#BA7517',
  connected:    '#1D9E75',
  error:        '#D4537E',
}

function QuickConnect() {
  const status  = useDeviceStore(s => s.status)
  const mode    = useDeviceStore(s => s.mode)
  const color   = STATUS_DOT[status] || STATUS_DOT.disconnected
  const t       = useT()

  const handleClick = async () => {
    if (status === 'connected') await deviceService.disconnect()
    else await deviceService.connect()
  }

  return (
    <button onClick={handleClick}
      className="flex items-center gap-3 px-4 py-2.5 mx-2 rounded-[10px] text-[20px] w-[calc(100%-16px)] transition-all hover:bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.45)] hover:text-[rgba(255,255,255,0.75)]">
      <div className="relative w-5 h-5 flex items-center justify-center flex-shrink-0">
        {status === 'connected' ? <Wifi size={20} style={{ color }} /> : <WifiOff size={20} style={{ color }} />}
        {mode === 'freestyle' && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#D4537E] animate-pulse" />
        )}
      </div>
      <span className="flex-1 text-left" style={{ color }}>
        {status === 'connected' ? (mode === 'freestyle' ? t('Device · Live') : t('Device · Idle')) : status === 'connecting' ? t('Connecting…') : t('Device · Off')}
      </span>
    </button>
  )
}

function NavItem({ to, icon: Icon, label, badge }) {
  const t = useT()
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-[10px] text-[20px] transition-all duration-150 cursor-pointer active:scale-95
         ${isActive
           ? 'bg-[rgba(127,119,221,0.15)] text-[#CECBF6]'
           : 'text-[rgba(255,255,255,0.45)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.75)]'
         }`
      }
    >
      <Icon size={20} />
      <span className="flex-1">{t(label)}</span>
      {badge > 0 && (
        <span className="text-[15px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: 'rgba(127,119,221,0.35)', color: '#CECBF6' }}>
          {badge}
        </span>
      )}
    </NavLink>
  )
}

function ActionItem({ icon: Icon, label, onClick, color = 'rgba(255,255,255,0.45)', activeColor }) {
  const t = useT()
  return (
    <button onClick={onClick}
      className="flex items-center gap-3 px-4 py-2.5 mx-2 rounded-[10px] text-[20px] w-[calc(100%-16px)] transition-all hover:bg-[rgba(255,255,255,0.05)] cursor-pointer"
      style={{ color }}>
      <Icon size={20} />
      <span className="flex-1 text-left">{t(label)}</span>
    </button>
  )
}

function SectionLabel({ label }) {
  const t = useT()
  return (
    <div className="text-[17px] font-medium text-[rgba(255,255,255,0.2)] uppercase tracking-[.06em] px-5 pt-4 pb-1">
      {t(label)}
    </div>
  )
}

export default function Sidebar() {
  const navigate         = useNavigate()
  const t                = useT()
  const queueCount       = useVaultStore(s => s.multiViewerQueue.length)
  const avatarBust       = useVaultStore(s => s.avatarBust)
  const vaultName        = useVaultStore(s => s.vaultName)
  const setCompanionConfig = useVaultStore(s => s.setCompanionConfig)
  const companionEnabled = useVaultStore(s => s.companion.enabled)

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn:  () => gamiApi.profile().then(r => r.data),
    staleTime: 30000,
  })

  const { data: companionConfig } = useQuery({
    queryKey: ['companion-config'],
    queryFn:  () => companionApi.getConfig().then(r => r?.data ?? null),
    staleTime: 60000,
  })
  useEffect(() => { if (companionConfig) setCompanionConfig(companionConfig) }, [companionConfig])

  const { data: taskState } = useQuery({
    queryKey: ['task-queue'],
    queryFn:  () => fetch('/api/tasks').then(r => r.json()),
    refetchInterval: q => {
      const d = q.state.data
      return (d?.current || d?.queued?.length > 0) ? 600 : 8000
    },
  })

  const activeTask    = taskState?.current ?? null
  const queuedCount   = taskState?.queued?.length ?? 0
  const progress      = profile ? xpProgress(profile.total_xp, profile.level) : 0
  const levelColor    = profile ? (LEVEL_COLORS[profile.level_title] || '#7F77DD') : '#7F77DD'

  return (
    <aside className="w-[260px] min-w-[260px] flex flex-col border-r border-[rgba(255,255,255,0.07)]"
           style={{ background: 'var(--c-surface)' }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0 border-b border-[rgba(255,255,255,0.07)]">
        <img src="/logo.png" alt="The Vault"
             className="w-9 h-9 rounded-[10px] object-cover"
             onError={e => {
               e.target.style.display = 'none'
               e.target.nextSibling.style.display = 'flex'
             }} />
        <div className="w-9 h-9 rounded-[10px] items-center justify-center hidden"
             style={{ background: '#7F77DD' }}>
          <Box size={20} color="#fff" />
        </div>
        <span className="text-[22px] font-medium text-[rgba(255,255,255,0.9)]">{vaultName}</span>
      </div>

      {/* Nav — scrollable so nothing gets cut off on 1080p */}
      <nav className="flex-1 py-2 overflow-y-auto min-h-0"
           style={{ scrollbarWidth: 'none' }}>
        {NAV.map(n => <NavItem key={n.to} {...n} />)}

        <SectionLabel label="Goon" />
        <NavItem to="/multi-panel" icon={Columns3} label="Multi-panel" badge={queueCount} />
        {GOON_NAV.filter(n => n.to !== '/multi-panel').map(n => <NavItem key={n.to} {...n} />)}
        <NavItem to="/erika" icon={Sparkles} label="Erika AI" />
        <QuickConnect />

        <SectionLabel label="Collect" />
        {COLLECT_NAV.map(n => <NavItem key={n.to} {...n} />)}
        <SectionLabel label="Tools" />
        {activeTask && (
          <NavLink to="/task-queue" className="block mx-2 mb-1 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors" style={{ textDecoration: 'none' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: '#1D9E75' }} />
              <span className="text-xs text-white/60 truncate flex-1">{activeTask.label}</span>
              {queuedCount > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(127,119,221,0.2)', color: '#7F77DD' }}>
                  +{queuedCount}
                </span>
              )}
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
              {activeTask.total > 0 ? (
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round((activeTask.progress / activeTask.total) * 100)}%`,
                    background: '#1D9E75',
                  }}
                />
              ) : (
                <div className="h-full rounded-full animate-pulse" style={{ background: '#1D9E75', opacity: 0.5 }} />
              )}
            </div>
          </NavLink>
        )}
        {LIB_NAV.map(n => <NavItem key={n.to} {...n} />)}
      </nav>

      {/* Profile area — always visible at bottom (not inside scroll) */}
      <div
        className="border-t border-[rgba(255,255,255,0.07)] cursor-pointer hover:bg-[rgba(255,255,255,0.03)] transition-colors flex-shrink-0"
        onClick={() => navigate('/profile')}
        title={t('View profile')}
      >
        {profile ? (
          <>
            {profile.avatar_path && (
              <div className="px-4 pt-3 pb-1">
                <img
                  src={`/api/gamification/profile/avatar?v=${avatarBust}`}
                  alt="avatar"
                  style={{
                    width: 46, height: 46, borderRadius: '50%', objectFit: 'cover',
                    border: `2px solid ${levelColor}55`,
                    boxShadow: `0 0 12px ${levelColor}22`,
                    objectPosition: `${(profile.avatar_focal_x ?? 0.5) * 100}% ${(profile.avatar_focal_y ?? 0.5) * 100}%`,
                  }}
                />
              </div>
            )}

            <div className="px-4 pb-3" style={{ paddingTop: profile.avatar_path ? 0 : 12 }}>
              <div className="flex justify-between text-[17px] text-[rgba(255,255,255,0.4)] mb-1">
                <span className="font-medium truncate" style={{ color: levelColor }}>
                  Lv {profile.level} — {profile.selected_title || profile.level_title}
                </span>
              </div>
              <div className="h-[3px] rounded-full bg-[rgba(255,255,255,0.07)] mb-2 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                     style={{ width: `${progress}%`, background: levelColor }} />
              </div>
              <div className="flex items-center gap-2 text-[17px]">
                <span className="text-[rgba(255,255,255,0.35)]">{profile.total_xp.toLocaleString()} XP</span>
                {profile.streak_days > 0 && (
                  <span className="flex items-center gap-1.5 ml-auto px-2 py-0.5 rounded-full text-[#EF9F27]"
                        style={{ background: 'rgba(186,117,23,0.15)' }}>
                    <Flame size={14} className="streak-flame" />
                    {profile.streak_days}d
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="p-4 text-[17px] text-[rgba(255,255,255,0.2)]">{t('Loading...')}</div>
        )}
      </div>

    </aside>
  )
}
