import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Zap, Flame, Trophy, Pencil, Check, X, ChevronDown, Camera, Crosshair } from 'lucide-react'
import { gamiApi, economyApi, cardsApi, galleriesApi, sessionsApi } from '../lib/api'
import toast from 'react-hot-toast'

function fmtMs(ms) {
  if (!ms) return '—'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Level title definitions (mirrors backend LEVEL_TITLES) ────────────────────
const LEVEL_TITLES = [
  { level: 1,  title: 'The Lurker' },
  { level: 6,  title: 'Peeking Shadow' },
  { level: 11, title: 'Desire Seeker' },
  { level: 16, title: 'Vault Delver' },
  { level: 21, title: 'Sin Collector' },
  { level: 26, title: 'Acolyte of Lust' },
  { level: 31, title: 'Devoted Stroker' },
  { level: 36, title: 'Pleasure Archivist' },
  { level: 41, title: 'Goon Disciple' },
  { level: 46, title: 'Metadata Priest' },
  { level: 51, title: 'High Priest of HD' },
  { level: 56, title: 'Curator of Sin' },
  { level: 61, title: 'The Degenerate' },
  { level: 66, title: 'Elite Gooner' },
  { level: 71, title: 'Vault Sovereign' },
  { level: 76, title: 'Lord of Indulgence' },
  { level: 81, title: 'Grand Archivist' },
  { level: 86, title: 'Legendary Coomer' },
  { level: 91, title: 'The Completionist' },
  { level: 96, title: 'God Emperor of the Vault' },
]

// ── Title tier styling (increasingly epic) ────────────────────────────────────
function getTitleStyle(level) {
  if (level >= 96) return { color: '#FFD700', glow: '0 0 12px rgba(255,215,0,0.9), 0 0 30px rgba(255,215,0,0.5)', shimmer: true }
  if (level >= 91) return { color: '#FFD700', glow: '0 0 10px rgba(255,215,0,0.7), 0 0 20px rgba(255,215,0,0.35)', shimmer: true }
  if (level >= 86) return { color: '#E8C5FF', glow: '0 0 8px rgba(192,132,252,0.8), 0 0 18px rgba(192,132,252,0.4)', shimmer: true }
  if (level >= 81) return { color: '#C084FC', glow: '0 0 8px rgba(192,132,252,0.7), 0 0 16px rgba(192,132,252,0.3)', shimmer: false }
  if (level >= 76) return { color: '#FF8C42', glow: '0 0 8px rgba(255,107,53,0.7), 0 0 16px rgba(255,107,53,0.3)', shimmer: false }
  if (level >= 71) return { color: '#FF6B35', glow: '0 0 6px rgba(255,107,53,0.6)', shimmer: false }
  if (level >= 66) return { color: '#E24B4A', glow: '0 0 6px rgba(226,75,74,0.6)', shimmer: false }
  if (level >= 61) return { color: '#E24B4A', glow: '0 0 4px rgba(226,75,74,0.5)', shimmer: false }
  if (level >= 56) return { color: '#BA7517', glow: '0 0 6px rgba(186,117,23,0.6)', shimmer: false }
  if (level >= 51) return { color: '#D4A017', glow: '0 0 4px rgba(212,160,23,0.5)', shimmer: false }
  if (level >= 46) return { color: '#D4537E', glow: '0 0 4px rgba(212,83,126,0.5)', shimmer: false }
  if (level >= 41) return { color: '#D4537E', glow: '0 0 3px rgba(212,83,126,0.4)', shimmer: false }
  if (level >= 36) return { color: '#7F77DD', glow: '0 0 4px rgba(127,119,221,0.5)', shimmer: false }
  if (level >= 31) return { color: '#7F77DD', glow: '0 0 3px rgba(127,119,221,0.4)', shimmer: false }
  if (level >= 26) return { color: '#378ADD', glow: '0 0 3px rgba(55,138,221,0.4)', shimmer: false }
  if (level >= 21) return { color: '#378ADD', glow: 'none', shimmer: false }
  if (level >= 16) return { color: '#1D9E75', glow: 'none', shimmer: false }
  if (level >= 11) return { color: '#1D9E75', glow: 'none', shimmer: false }
  return { color: '#888780', glow: 'none', shimmer: false }
}

function getUnlockedTitles(level) {
  return LEVEL_TITLES.filter(t => t.level <= level)
}

function xpForLevel(lvl) {
  if (lvl <= 1) return 0
  return Array.from({ length: lvl - 1 }, (_, i) => 500 * (i + 1)).reduce((a, b) => a + b, 0)
}

function xpProgress(totalXp, level) {
  if (level >= 100) return 100
  const current = xpForLevel(level)
  const next    = xpForLevel(level + 1)
  if (next === current) return 100
  return Math.min(100, ((totalXp - current) / (next - current)) * 100)
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const diff = Date.now() - d.getTime()
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h > 24) return `${Math.floor(h / 24)}d ago`
  if (h > 0)  return `${h}h ago`
  return `${m}m ago`
}

const SOURCE_LABELS = {
  session_logged:     '🎮 Session logged',
  orgasm_logged:      '💧 O counted',
  gallery_added:      '🖼️ Gallery added',
  creator_added:      '👤 Creator added',
  file_added:         '📁 File added',
  daily_login:        '📅 Daily login',
  quest_complete:     '✅ Quest completed',
  achievement_unlock: '🏆 Achievement unlocked',
  pack_opened:        '🎴 Pack opened',
  card_dismantled:    '🔨 Card dismantled',
  tag_added:          '🏷️ Tag added',
  image_rated:        '⭐ Image rated',
  wiki_import:        '📖 Wiki import',
  tagging_mission:    '⚡ Tagging mission',
  max_level:          '♾️ Max level bonus',
}

// ── Shimmer CSS injected once ─────────────────────────────────────────────────
const SHIMMER_STYLE = `
@keyframes titleShimmer {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center; }
}
.title-shimmer {
  background: linear-gradient(90deg, #FFD700 0%, #fff8dc 40%, #FFD700 60%, #FFA500 100%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: titleShimmer 3s linear infinite;
}
`

export default function Profile() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileInputRef = useRef(null)

  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal]         = useState('')
  const [titleOpen, setTitleOpen]     = useState(false)
  const [avatarBust, setAvatarBust]   = useState(Date.now())
  const [focalMode, setFocalMode]     = useState(false)
  const avatarImgRef                  = useRef(null)

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => gamiApi.profile().then(r => r.data),
    staleTime: 0,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  })

  const { data: balance } = useQuery({
    queryKey: ['economy-balance'],
    queryFn: () => economyApi.balance().then(r => r.data),
    staleTime: 0,
  })

  const { data: materials } = useQuery({
    queryKey: ['forge-materials'],
    queryFn: () => cardsApi.materials().then(r => r.data),
    staleTime: 0,
  })

  const { data: xpHistory } = useQuery({
    queryKey: ['xp-history'],
    queryFn: () => gamiApi.xpHistory().then(r => r.data),
    staleTime: 0,
  })

  const { data: vaultStats } = useQuery({
    queryKey: ['vault-stats'],
    queryFn: () => galleriesApi.stats().then(r => r.data),
    staleTime: 0,
  })

  const { data: recentSessionsData } = useQuery({
    queryKey: ['recent-sessions-profile'],
    queryFn: () => sessionsApi.list({ limit: 5 }).then(r => r.data),
    staleTime: 0,
  })

  const updateMutation = useMutation({
    mutationFn: (d) => gamiApi.updateProfile(d).then(r => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      if ('username' in vars) setEditingName(false)
    },
    onError: () => toast.error('Update failed'),
  })

  const avatarMutation = useMutation({
    mutationFn: (file) => gamiApi.uploadAvatar(file).then(r => r.data),
    onSuccess: () => {
      setAvatarBust(Date.now())
      qc.invalidateQueries({ queryKey: ['profile'] })
      toast.success('Profile picture updated')
    },
    onError: () => toast.error('Upload failed'),
  })

  const craftMutation = useMutation({
    mutationFn: () => cardsApi.craftCatalyst().then(r => r.data),
    onSuccess: () => {
      toast.success('⚗️ Catalyst Token crafted!')
      qc.invalidateQueries({ queryKey: ['forge-materials'] })
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Need 150 shards'),
  })

  useEffect(() => {
    if (profile) setNameVal(profile.username || '')
  }, [profile?.username])

  // Close title dropdown on outside click
  useEffect(() => {
    if (!titleOpen) return
    const handler = (e) => {
      if (!e.target.closest('[data-title-dropdown]')) setTitleOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [titleOpen])

  if (!profile) return (
    <div style={{ minHeight: '100vh', background: '#080810', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)' }}>
      Loading…
    </div>
  )

  const isMaxLevel    = profile.level >= 100
  const progress      = xpProgress(profile.total_xp, profile.level)
  const xpToNext      = isMaxLevel ? 0 : (xpForLevel(profile.level + 1) - profile.total_xp)
  const credits       = balance?.vault_credits ?? 0
  const shards        = materials?.shards ?? 0
  const tokens        = materials?.catalyst_tokens ?? 0
  const hearts        = profile?.hearts ?? 0
  const recentXP      = xpHistory?.slice(0, 20) ?? []
  const recentCredit  = balance?.recent_events ?? []

  const displayTitle   = profile.selected_title || profile.level_title
  const titleEntry     = LEVEL_TITLES.find(t => t.title === displayTitle)
  const titleLevel     = titleEntry?.level ?? 1
  const titleStyle     = getTitleStyle(titleLevel)
  const unlockedTitles = getUnlockedTitles(profile.level)

  const avatarUrl = profile.avatar_path
    ? `/api/gamification/profile/avatar?v=${avatarBust}`
    : null

  return (
    <div style={{ minHeight: '100vh', background: '#080810', padding: '28px 32px', maxWidth: 900, margin: '0 auto', zoom: 1.15 }}>
      <style>{SHIMMER_STYLE}</style>

      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}
      >
        <ArrowLeft size={13} /> Back
      </button>

      {/* ── Hero card ──────────────────────────────────────────────────────── */}
      <div style={{
        borderRadius: 16, padding: 28, marginBottom: 20,
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.07)',
        position: 'relative',
        // NO overflow:hidden — lets the title dropdown escape the card boundary
      }}>
        {/* Ambient glow — clipped via a separate inner element so no overflow:hidden needed */}
        <div style={{
          position: 'absolute', top: 0, right: 0, width: '100%', height: '100%',
          borderRadius: 16, pointerEvents: 'none', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: -80, right: -80, width: 300, height: 300,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${titleStyle.color}18 0%, transparent 70%)`,
          }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 28, flexWrap: 'wrap', position: 'relative' }}>

          {/* ── Avatar ────────────────────────────────────────────────────── */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {/* Avatar circle */}
            <div
              ref={avatarImgRef}
              onClick={(e) => {
                if (focalMode && avatarUrl) {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
                  updateMutation.mutate({ avatar_focal_x: x, avatar_focal_y: y })
                  setFocalMode(false)
                } else if (!focalMode) {
                  fileInputRef.current?.click()
                }
              }}
              style={{
                width: 200, height: 200, borderRadius: '50%',
                cursor: focalMode ? 'crosshair' : 'pointer',
                background: avatarUrl ? '#111' : `linear-gradient(135deg, ${titleStyle.color}55, ${titleStyle.color}22)`,
                border: `2px solid ${focalMode ? titleStyle.color : titleStyle.color + '66'}`,
                boxShadow: focalMode
                  ? `0 0 0 3px ${titleStyle.color}88, 0 0 24px ${titleStyle.color}44`
                  : (titleStyle.glow !== 'none' ? `0 0 20px ${titleStyle.color}33` : 'none'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', position: 'relative',
                transition: 'box-shadow 0.2s, border-color 0.2s',
              }}
            >
              {avatarUrl
                ? <img
                    src={avatarUrl}
                    alt="avatar"
                    style={{
                      width: '100%', height: '100%', objectFit: 'cover',
                      objectPosition: `${(profile.avatar_focal_x ?? 0.5) * 100}% ${(profile.avatar_focal_y ?? 0.5) * 100}%`,
                    }}
                  />
                : <span style={{ fontSize: 64 }}>🃏</span>
              }
              {/* Focal mode overlay */}
              {focalMode && (
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.45)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: 4,
                }}>
                  <Crosshair size={28} style={{ color: '#fff' }} />
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 1.3 }}>Click to set<br/>focal point</span>
                </div>
              )}
            </div>

            {/* Bottom action buttons */}
            <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
              {/* Upload button */}
              <button
                onClick={() => { setFocalMode(false); fileInputRef.current?.click() }}
                title="Change photo"
                style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'rgba(14,14,20,0.92)', border: `1px solid ${titleStyle.color}66`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'rgba(255,255,255,0.75)',
                }}
              >
                <Camera size={13} />
              </button>
              {/* Focal point button — only shown when avatar exists */}
              {avatarUrl && (
                <button
                  onClick={() => setFocalMode(v => !v)}
                  title="Adjust position"
                  style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: focalMode ? `${titleStyle.color}33` : 'rgba(14,14,20,0.92)',
                    border: `1px solid ${focalMode ? titleStyle.color : titleStyle.color + '66'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: focalMode ? titleStyle.color : 'rgba(255,255,255,0.75)',
                  }}
                >
                  <Crosshair size={13} />
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) avatarMutation.mutate(f)
                e.target.value = ''
              }}
            />
          </div>

          {/* ── Name, Title, XP ───────────────────────────────────────────── */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
              Level {profile.level}{isMaxLevel ? ' — MAX' : ''}
            </div>

            {/* Username edit */}
            {editingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <input
                  autoFocus
                  value={nameVal}
                  onChange={e => setNameVal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') updateMutation.mutate({ username: nameVal })
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, padding: '6px 10px', color: '#fff', fontSize: 20, fontWeight: 700,
                    outline: 'none', width: 200,
                  }}
                />
                <button onClick={() => updateMutation.mutate({ username: nameVal })}
                  style={{ background: 'rgba(29,158,117,0.2)', border: '1px solid rgba(29,158,117,0.4)', borderRadius: 6, padding: '4px 8px', color: '#1D9E75', cursor: 'pointer' }}>
                  <Check size={14} />
                </button>
                <button onClick={() => setEditingName(false)}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 8px', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
                  {profile.username || 'Vault Master'}
                </span>
                <button
                  onClick={() => { setNameVal(profile.username || ''); setEditingName(true) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: 2, display: 'flex' }}
                >
                  <Pencil size={13} />
                </button>
              </div>
            )}

            {/* Title selector */}
            <div data-title-dropdown style={{ position: 'relative', display: 'inline-block', marginBottom: 16 }}>
              <button
                onClick={() => setTitleOpen(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(255,255,255,0.05)', border: `0.5px solid ${titleStyle.color}44`,
                  borderRadius: 8, padding: '5px 10px 5px 12px', cursor: 'pointer',
                  boxShadow: titleStyle.glow !== 'none' ? titleStyle.glow : 'none',
                }}
              >
                <span
                  className={titleStyle.shimmer ? 'title-shimmer' : ''}
                  style={titleStyle.shimmer ? { fontSize: 14, fontWeight: 600 } : { fontSize: 14, fontWeight: 600, color: titleStyle.color }}
                >
                  {displayTitle}
                </span>
                <ChevronDown size={12} style={{ color: titleStyle.color, transition: 'transform 0.2s', transform: titleOpen ? 'rotate(180deg)' : 'none' }} />
              </button>

              {/* Dropdown */}
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
                background: '#16161e', border: '0.5px solid rgba(255,255,255,0.12)',
                borderRadius: 10, overflow: 'hidden',
                maxHeight: titleOpen ? '320px' : '0',
                transition: 'max-height 0.25s cubic-bezier(0.4,0,0.2,1)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                minWidth: 220,
              }}>
                <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                  {unlockedTitles.map(({ level: tlvl, title }) => {
                    const ts = getTitleStyle(tlvl)
                    const active = displayTitle === title
                    return (
                      <button
                        key={title}
                        onClick={() => {
                          updateMutation.mutate({ selected_title: title })
                          setTitleOpen(false)
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '9px 14px', background: active ? `${ts.color}14` : 'transparent',
                          border: 'none', cursor: 'pointer',
                          borderLeft: active ? `2px solid ${ts.color}` : '2px solid transparent',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                      >
                        <span
                          className={ts.shimmer ? 'title-shimmer' : ''}
                          style={ts.shimmer ? { fontSize: 13, fontWeight: active ? 700 : 500 } : { fontSize: 13, fontWeight: active ? 700 : 500, color: ts.color, textShadow: ts.glow !== 'none' ? ts.glow : 'none' }}
                        >
                          {title}
                        </span>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 8 }}>Lv {tlvl}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* XP bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 5 }}>
                <span>{profile.total_xp.toLocaleString()} XP</span>
                <span>
                  {isMaxLevel
                    ? '✦ Max Level — XP → Credits'
                    : `${xpToNext.toLocaleString()} to Lv ${profile.level + 1}`}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4,
                  width: `${progress}%`,
                  background: isMaxLevel
                    ? 'linear-gradient(90deg, #FFD700aa, #FFD700)'
                    : `linear-gradient(90deg, ${titleStyle.color}aa, ${titleStyle.color})`,
                  boxShadow: `0 0 10px ${titleStyle.color}88`,
                  transition: 'width 0.6s ease',
                }} />
              </div>
              {profile.level >= 50 && !isMaxLevel && (
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>
                  ✦ CXP bonus: +{Math.min(profile.level - 50, 50)}% (level 50+ perk)
                </div>
              )}
              {isMaxLevel && (
                <div style={{ fontSize: 9, color: '#FFD700aa', marginTop: 3 }}>
                  ✦ CXP bonus: +50% max — all XP gains convert to Vault Credits
                </div>
              )}
            </div>
          </div>

          {/* Streak badge */}
          {profile.streak_days > 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '12px 16px', borderRadius: 12,
              background: 'rgba(186,117,23,0.12)', border: '0.5px solid rgba(186,117,23,0.3)',
            }}>
              <Flame size={18} style={{ color: '#FA9835' }} />
              <div style={{ fontSize: 20, fontWeight: 700, color: '#FAC775' }}>{profile.streak_days}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Day streak</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { icon: '💰', label: 'Vault Credits', value: credits.toLocaleString(), color: '#FAC775' },
          { icon: '🔷', label: 'Shards', value: shards.toLocaleString(), color: '#CECBF6' },
          { icon: '⚗️', label: 'Catalyst Tokens', value: tokens, color: '#1D9E75' },
          { icon: '❤️', label: 'Hearts', value: hearts.toLocaleString(), color: '#FF2D75' },
          { icon: '⚡', label: 'Total XP', value: profile.total_xp.toLocaleString(), color: '#7F77DD' },
        ].map(s => (
          <div key={s.label} style={{
            borderRadius: 12, padding: '14px 16px',
            background: 'rgba(255,255,255,0.03)',
            border: '0.5px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color, marginBottom: 2 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
          </div>
        ))}

        {/* Craft token button */}
        <div style={{
          borderRadius: 12, padding: '14px 16px',
          background: 'rgba(186,117,23,0.06)',
          border: '0.5px solid rgba(186,117,23,0.2)',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Craft Token
          </div>
          <button
            onClick={() => craftMutation.mutate()}
            disabled={craftMutation.isPending || shards < 150}
            style={{
              padding: '7px 0', borderRadius: 8, fontSize: 11, fontWeight: 600,
              cursor: shards >= 150 ? 'pointer' : 'not-allowed',
              background: shards >= 150 ? 'rgba(186,117,23,0.3)' : 'rgba(255,255,255,0.04)',
              color: shards >= 150 ? '#FAC775' : 'rgba(255,255,255,0.2)',
              border: shards >= 150 ? '0.5px solid rgba(186,117,23,0.5)' : '0.5px solid rgba(255,255,255,0.06)',
            }}
          >
            {craftMutation.isPending ? '…' : '⚗️ 150 shards'}
          </button>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>
            {shards < 150 ? `Need ${150 - shards} more shards` : 'Ready to craft'}
          </div>
        </div>
      </div>

      {/* ── Last session summary ────────────────────────────────────────────── */}
      {(() => {
        const sessions = recentSessionsData ?? []
        if (sessions.length === 0) return null
        const last = sessions[0]
        const ts = last.logged_at && !String(last.logged_at).endsWith('Z') ? last.logged_at + 'Z' : last.logged_at
        const when = (() => {
          const diff = Date.now() - new Date(ts).getTime()
          const d = Math.floor(diff / 86400000)
          if (d === 0) return 'Today'
          if (d === 1) return 'Yesterday'
          return DAYS[new Date(ts).getDay()]
        })()
        const dur = last.duration_sec ? (last.duration_sec >= 3600
          ? `${Math.floor(last.duration_sec / 3600)}h ${Math.floor((last.duration_sec % 3600) / 60)}m`
          : `${Math.floor(last.duration_sec / 60)}m`) : null

        // Collect all unique creator names from the 5 most recent sessions
        const allCreators = [...new Set(sessions.map(s => s.creator_name).filter(Boolean))]
        const mainCreator = last.creator_name
        const othersCount = allCreators.filter(n => n !== mainCreator).length

        const summaryParts = []
        if (dur) summaryParts.push(`gooned for ${dur}`)
        if (mainCreator) {
          const creatorStr = othersCount > 0 ? `${mainCreator} (+${othersCount} more)` : mainCreator
          summaryParts.push(`with ${creatorStr}`)
        }
        const summary = summaryParts.length > 0 ? summaryParts.join(' ') : 'session logged'

        return (
          <div style={{
            borderRadius: 14, padding: '16px 20px', marginBottom: 20,
            background: 'rgba(212,83,126,0.05)',
            border: '0.5px solid rgba(212,83,126,0.2)',
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>🎮</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                Last session · {when}
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
                You {summary}
              </div>
              {last.gallery_name && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                  {last.gallery_name}
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#7F77DD', flexShrink: 0 }}>
              +{last.xp_earned} XP
            </div>
          </div>
        )
      })()}

      {/* ── Gooning & Activity ─────────────────────────────────────────────── */}
      <div style={{
        borderRadius: 14, padding: 20, marginBottom: 20,
        background: 'rgba(212,83,126,0.03)',
        border: '0.5px solid rgba(212,83,126,0.1)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>💧</span> Gooning & Activity
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 10 }}>
          {[
            { icon: '❤️', label: 'Sessions logged',  value: (vaultStats?.total_sessions ?? 0).toLocaleString(),              color: '#D4537E' },
            { icon: '💧', label: 'Total Os',          value: (vaultStats?.total_cum_count ?? 0).toLocaleString(),             color: '#D4537E', cumStat: true },
            { icon: '⏱️', label: 'Time gooning',      value: fmtMs(vaultStats?.session_total_ms ?? 0),                       color: '#D4537E' },
            { icon: '⚡', label: 'Longest session',   value: fmtMs((vaultStats?.longest_session_sec ?? 0) * 1000),            color: '#7F77DD' },
            { icon: '🔥', label: 'Current streak',    value: `${profile.streak_days ?? 0}d`,                                 color: '#FA9835' },
            { icon: '🏆', label: 'Best streak',       value: `${profile.streak_best ?? 0}d`,                                 color: '#FA9835' },
            { icon: '📆', label: 'Peak month',        value: vaultStats?.most_active_month ? MONTHS[vaultStats.most_active_month - 1] : '—', color: '#CECBF6' },
            { icon: '📅', label: 'Peak day',          value: (vaultStats?.most_active_day != null) ? DAYS[vaultStats.most_active_day] : '—', color: '#CECBF6' },
          ].map(s => (
            <div key={s.label} className={s.cumStat ? 'vault-cum-stat' : ''} style={{
              borderRadius: 10, padding: '12px 14px',
              background: 'rgba(255,255,255,0.03)',
              border: '0.5px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ fontSize: 16, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, marginBottom: 2 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Event logs ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flexWrap: 'wrap' }}>
        {/* XP log */}
        <div style={{ borderRadius: 14, padding: 20, background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={13} style={{ color: '#7F77DD' }} /> XP Events
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {recentXP.length === 0 ? (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>No XP events yet</div>
            ) : recentXP.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{SOURCE_LABELS[e.reason] || e.reason}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{fmtTime(e.earned_at)}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7F77DD' }}>+{e.amount} XP</div>
              </div>
            ))}
          </div>
        </div>

        {/* Credit log */}
        <div style={{ borderRadius: 14, padding: 20, background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trophy size={13} style={{ color: '#FAC775' }} /> Credit Events
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {recentCredit.length === 0 ? (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>No credits earned yet — log sessions!</div>
            ) : recentCredit.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{SOURCE_LABELS[e.source] || e.source}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{fmtTime(e.logged_at)}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#FAC775' }}>+{e.amount} 💰</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
