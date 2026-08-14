import React from 'react'
import { motion } from 'framer-motion'
import { Flame, Droplets, Clock, Crown, Sparkles, Images, TrendingUp, Zap } from 'lucide-react'

// ── Shared bits ───────────────────────────────────────────────────────────────

const ACCENT = 'var(--c-amber-text)'

export const fmtHM = (secs) => {
  const h = Math.floor((secs || 0) / 3600)
  const m = Math.round(((secs || 0) % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

const hourLabel = (h) => {
  const ampm = h < 12 ? 'am' : 'pm'
  const base = h % 12 === 0 ? 12 : h % 12
  return `${base}${ampm}`
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function creatorAvatar(c, size = 400) {
  if (!c?.avatar_path) return null
  const bust = encodeURIComponent(String(c.avatar_path).split(/[\\/]/).pop() || '')
  return `/api/creators/${c.id}/avatar-thumb?size=${size}&v=${bust}`
}

// Some creators have a video file as their avatar_path, which the thumb
// endpoint can't render — fall back to the initial rather than an empty frame.
function Avatar({ creator, fontSize = 48 }) {
  const [failed, setFailed] = React.useState(false)
  const src = creatorAvatar(creator)
  if (src && !failed) {
    return <img src={src} alt="" onError={() => setFailed(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  }
  return (
    <div className="w-full h-full flex items-center justify-center"
         style={{ fontSize, color: 'rgba(255,255,255,0.22)', fontWeight: 800 }}>
      {creator?.name?.[0] ?? '?'}
    </div>
  )
}

// Every card animates in the same way, so the deck reads as one object being
// flipped through rather than eleven separate screens.
const rise = {
  hidden:  { opacity: 0, y: 26 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: 0.08 + i * 0.09, duration: 0.5, ease: [0.22, 1, 0.36, 1] } }),
}

function Line({ children, i = 0, className = '', style }) {
  return (
    <motion.div variants={rise} initial="hidden" animate="show" custom={i}
                className={className} style={style}>
      {children}
    </motion.div>
  )
}

function Big({ children, color = '#fff', size = 88 }) {
  return (
    <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1, color, letterSpacing: '-0.03em' }}>
      {children}
    </div>
  )
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '0.14em',
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>
      {children}
    </div>
  )
}

function Delta({ pct }) {
  if (pct === null || pct === undefined) return null
  const up = pct >= 0
  return (
    <span style={{ fontSize: 17, fontWeight: 700, color: up ? 'var(--c-green)' : 'var(--c-pink)' }}>
      {up ? '▲' : '▼'} {Math.abs(pct)}% vs last
    </span>
  )
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function Opening({ card }) {
  return (
    <div className="flex flex-col justify-center h-full gap-5">
      <Line i={0}><Label>The Vault Recap</Label></Line>
      <Line i={1}><Big size={92} color={ACCENT}>{card.title}</Big></Line>
      <Line i={2}>
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.6)' }}>{card.range}</div>
      </Line>
      <Line i={3}>
        <div className="flex gap-8 mt-6">
          <div>
            <Big size={44}>{card.active_days}</Big>
            <Label>active days</Label>
          </div>
          <div>
            <Big size={44}>{(card.xp || 0).toLocaleString()}</Big>
            <Label>xp earned</Label>
          </div>
        </div>
      </Line>
    </div>
  )
}

function Volume({ card }) {
  return (
    <div className="flex flex-col justify-center h-full gap-7">
      <Line i={0}><Label>What you actually did</Label></Line>
      <Line i={1}>
        <Big size={100} color={ACCENT}>{fmtHM(card.session_secs)}</Big>
        <div className="mt-2 flex items-center gap-3">
          <span style={{ fontSize: 20, color: 'rgba(255,255,255,0.5)' }}>logged across {card.sessions} sessions</span>
        </div>
        <div className="mt-1"><Delta pct={card.deltas?.session_secs} /></div>
      </Line>
      <Line i={2}>
        <div className="flex gap-10 mt-4">
          <div>
            <div className="flex items-baseline gap-2">
              <Big size={52} color="var(--c-pink)">{card.cum}</Big>
              <Droplets size={22} style={{ color: 'var(--c-pink)' }} />
            </div>
            <Label>orgasms</Label>
            <div className="mt-1"><Delta pct={card.deltas?.cum} /></div>
          </div>
          {card.edges > 0 && (
            <div>
              <Big size={52} color="var(--c-accent)">{card.edges}</Big>
              <Label>edges</Label>
            </div>
          )}
        </div>
      </Line>
      {card.longest_sec > 0 && (
        <Line i={3}>
          <div style={{ fontSize: 19, color: 'rgba(255,255,255,0.45)' }}>
            Longest single session — <span style={{ color: '#fff', fontWeight: 700 }}>{fmtHM(card.longest_sec)}</span>
          </div>
        </Line>
      )}
    </div>
  )
}

// 24 spokes around a dial. A bar chart would say the same thing, but a clock
// face makes "you are a 2pm creature" legible in one glance.
function ClockCard({ card }) {
  const max = Math.max(...card.hours) || 1
  const R0 = 56, R1 = 152, CX = 175, CY = 175
  // Square-root scale, not linear: one hour can hold half the day's activity,
  // which on a linear scale flattens all 23 others into invisible stubs and
  // throws away the shape the chart exists to show.
  const reach = (v) => (v > 0 ? Math.max(0.09, Math.sqrt(v / max)) : 0)
  return (
    <div className="flex flex-col justify-center h-full gap-6">
      <Line i={0}><Label>Your clock</Label></Line>
      <Line i={1} className="flex justify-center">
        <svg width="350" height="350" viewBox="0 0 350 350">
          <circle cx={CX} cy={CY} r={R0 - 10} fill="none" stroke="rgba(255,255,255,0.07)" />
          {card.hours.map((v, h) => {
            const a = (h / 24) * Math.PI * 2 - Math.PI / 2
            // Dead hours still get a stub, so the dial always reads as a full
            // 24-spoke clock rather than a broken one.
            const len = v > 0 ? R0 + (R1 - R0) * reach(v) : R0 + 5
            const peak = h === card.peak_hour
            return (
              <motion.line key={h}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 + h * 0.02 }}
                    x1={CX + Math.cos(a) * R0} y1={CY + Math.sin(a) * R0}
                    x2={CX + Math.cos(a) * len} y2={CY + Math.sin(a) * len}
                    stroke={peak ? ACCENT : v > 0 ? 'color-mix(in srgb, var(--c-accent) 80%, transparent)' : 'rgba(255,255,255,0.09)'}
                    strokeWidth={peak ? 11 : 8} strokeLinecap="round" />
            )
          })}
          {[0, 6, 12, 18].map(h => {
            const a = (h / 24) * Math.PI * 2 - Math.PI / 2
            return (
              <text key={h} x={CX + Math.cos(a) * (R1 + 22)} y={CY + Math.sin(a) * (R1 + 22)}
                    textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: 16, fill: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>
                {hourLabel(h)}
              </text>
            )
          })}
        </svg>
      </Line>
      <Line i={2}>
        <Big size={62} color={ACCENT}>{hourLabel(card.peak_hour)}</Big>
        <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
          is your hour — {card.peak_share}% of everything happens then
        </div>
        {card.night_share >= 25 && (
          <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
            {card.night_share}% of it after dark
          </div>
        )}
      </Line>
    </div>
  )
}

function Rhythm({ card }) {
  const max = Math.max(...card.days) || 1
  return (
    <div className="flex flex-col justify-center h-full gap-7">
      <Line i={0}><Label>Your week</Label></Line>
      <Line i={1}>
        <div className="flex items-end gap-3" style={{ height: 190 }}>
          {card.days.map((v, i) => (
            <div key={i} className="flex flex-col items-center gap-2" style={{ flex: 1 }}>
              <motion.div initial={{ height: 0 }} animate={{ height: `${(v / max) * 160}px` }}
                          transition={{ delay: 0.25 + i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                          style={{ width: '100%', borderRadius: 8,
                                   background: i === card.peak_day ? ACCENT : 'color-mix(in srgb, var(--c-accent) 55%, transparent)' }} />
              <span style={{ fontSize: 16, fontWeight: i === card.peak_day ? 700 : 500,
                             color: i === card.peak_day ? ACCENT : 'rgba(255,255,255,0.4)' }}>
                {DAY_NAMES[i]}
              </span>
            </div>
          ))}
        </div>
      </Line>
      <Line i={2}>
        <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.75)' }}>
          <b style={{ color: ACCENT }}>{DAY_NAMES[card.peak_day]}</b> is when it happens.
        </div>
      </Line>
      <Line i={3}>
        <div className="flex gap-10 mt-2">
          <div>
            <div className="flex items-baseline gap-2">
              <Big size={50} color="var(--c-amber)">{card.streak.longest}</Big>
              <Flame size={22} style={{ color: 'var(--c-amber)' }} />
            </div>
            <Label>longest streak</Label>
          </div>
          <div>
            <Big size={50}>{card.active_days}</Big>
            <Label>days active</Label>
          </div>
        </div>
      </Line>
    </div>
  )
}

// One creator per screen, counted down — the reveal is the whole point, so a
// top-5 list rendered at once would throw away the only drama the deck has.
function CountdownEntry({ card }) {
  const c = card.creator
  const isTop = card.place === 1
  return (
    <div className="flex flex-col justify-center h-full gap-5">
      <Line i={0}><Label>{isTop ? 'Your number one' : `Number ${card.place}`}</Label></Line>
      <Line i={1} className="flex items-center gap-6">
        <div style={{ width: isTop ? 168 : 128, height: isTop ? 224 : 170, borderRadius: 16,
                      overflow: 'hidden', flexShrink: 0,
                      border: `1px solid ${isTop ? 'color-mix(in srgb, var(--c-amber) 55%, transparent)' : 'rgba(255,255,255,0.12)'}`,
                      boxShadow: isTop ? '0 0 44px 6px color-mix(in srgb, var(--c-amber) 25%, transparent)' : 'none',
                      background: 'rgba(255,255,255,0.04)' }}>
          <Avatar creator={c} fontSize={isTop ? 56 : 44} />
        </div>
        <div style={{ fontSize: isTop ? 108 : 76, fontWeight: 800, lineHeight: 0.9,
                      color: isTop ? ACCENT : 'rgba(255,255,255,0.14)' }}>
          {card.place}
        </div>
      </Line>
      <Line i={2}>
        <div style={{ fontSize: isTop ? 46 : 36, fontWeight: 800, color: '#fff', lineHeight: 1.05 }}>
          {c.name}
        </div>
      </Line>
      <Line i={3}>
        <div className="flex gap-6 flex-wrap" style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)' }}>
          {c.view_seconds > 0 && <span><Clock size={16} className="inline mr-1.5" />{fmtHM(c.view_seconds)}</span>}
          {c.cum > 0 && <span style={{ color: 'var(--c-pink)' }}><Droplets size={16} className="inline mr-1.5" />{c.cum}</span>}
          {c.sessions > 0 && <span>{c.sessions} session{c.sessions === 1 ? '' : 's'}</span>}
        </div>
      </Line>
      {isTop && (
        <Line i={4}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mt-2"
               style={{ background: 'color-mix(in srgb, var(--c-amber) 14%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 40%, transparent)' }}>
            <Crown size={17} style={{ color: ACCENT }} />
            <span style={{ fontSize: 17, fontWeight: 700, color: ACCENT }}>{card.periodLabel} champion</span>
          </div>
        </Line>
      )}
    </div>
  )
}

function Devotion({ card }) {
  const share = card.top3_share
  const C = 2 * Math.PI * 76
  return (
    <div className="flex flex-col justify-center h-full gap-7">
      <Line i={0}><Label>Where the attention went</Label></Line>
      <Line i={1} className="flex justify-center">
        <svg width="200" height="200" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="76" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="20" />
          <motion.circle cx="100" cy="100" r="76" fill="none" stroke={ACCENT} strokeWidth="20"
                         strokeLinecap="round" transform="rotate(-90 100 100)"
                         strokeDasharray={C}
                         initial={{ strokeDashoffset: C }}
                         animate={{ strokeDashoffset: C * (1 - share / 100) }}
                         transition={{ delay: 0.35, duration: 1, ease: [0.22, 1, 0.36, 1] }} />
          <text x="100" y="100" textAnchor="middle" dominantBaseline="middle"
                style={{ fontSize: 46, fontWeight: 800, fill: '#fff' }}>{share}%</text>
        </svg>
      </Line>
      <Line i={2}>
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.7)', lineHeight: 1.45 }}>
          of your attention went to just <b style={{ color: ACCENT }}>three</b> of the{' '}
          <b style={{ color: '#fff' }}>{card.roster}</b> creators you engaged with.
        </div>
      </Line>
      <Line i={3}>
        <div className="flex flex-col gap-1.5 mt-1">
          {card.names.filter(Boolean).map((n, i) => (
            <div key={i} style={{ fontSize: 19, color: 'rgba(255,255,255,0.55)' }}>
              <span style={{ color: ACCENT, fontWeight: 700 }}>{i + 1}.</span> {n}
            </div>
          ))}
        </div>
      </Line>
    </div>
  )
}

function Newcomer({ card }) {
  const c = card.creator
  return (
    <div className="flex flex-col justify-center h-full gap-6">
      <Line i={0}><Label>New in the rotation</Label></Line>
      <Line i={1}>
        <div style={{ width: 150, height: 200, borderRadius: 16, overflow: 'hidden',
                      border: '1px solid color-mix(in srgb, var(--c-green) 45%, transparent)',
                      boxShadow: '0 0 40px 4px color-mix(in srgb, var(--c-green) 18%, transparent)' }}>
          <Avatar creator={c} fontSize={44} />
        </div>
      </Line>
      <Line i={2}><Big size={44} color="var(--c-green-text)">{c.name}</Big></Line>
      <Line i={3}>
        <div style={{ fontSize: 21, color: 'rgba(255,255,255,0.55)', lineHeight: 1.45 }}>
          Didn't exist to you before this. {c.sessions} session{c.sessions === 1 ? '' : 's'} later, she does.
        </div>
      </Line>
    </div>
  )
}

function Relic({ card }) {
  const img = card.image
  return (
    <div className="flex flex-col justify-center h-full gap-6">
      <Line i={0}><Label>The relic</Label></Line>
      <Line i={1}>
        <div style={{ width: '100%', maxWidth: 320, aspectRatio: '3/4', borderRadius: 16,
                      overflow: 'hidden', border: '1px solid color-mix(in srgb, var(--c-pink) 45%, transparent)',
                      boxShadow: '0 0 46px 6px color-mix(in srgb, var(--c-pink) 20%, transparent)' }}>
          <img src={`/api/images/${img.id}/thumb`} alt=""
               style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      </Line>
      <Line i={2}>
        <div className="flex items-baseline gap-3">
          <Big size={64} color="var(--c-pink)">{img.cum}</Big>
          <span style={{ fontSize: 22, color: 'rgba(255,255,255,0.55)' }}>times, this one</span>
        </div>
      </Line>
      <Line i={3}>
        <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)' }}>
          {img.gallery_name || img.filename}
        </div>
      </Line>
    </div>
  )
}

function Growth({ card }) {
  return (
    <div className="flex flex-col justify-center h-full gap-7">
      <Line i={0}><Label>The collection grew</Label></Line>
      <Line i={1}>
        <div className="flex items-baseline gap-3">
          <Big size={92} color="var(--c-accent)">{card.files.toLocaleString()}</Big>
          <Images size={28} style={{ color: 'var(--c-accent)' }} />
        </div>
        <Label>files added</Label>
      </Line>
      <Line i={2}>
        <Big size={52}>{card.galleries.toLocaleString()}</Big>
        <Label>new galleries</Label>
      </Line>
    </div>
  )
}

function Archetype({ card }) {
  return (
    <div className="flex flex-col justify-center h-full gap-6">
      <Line i={0}><Label>Your type</Label></Line>
      <Line i={1}>
        <div style={{ fontSize: 62, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.03em',
                      background: 'linear-gradient(100deg, var(--c-amber-text), var(--c-pink) 55%, var(--c-accent))',
                      WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          {card.name}
        </div>
      </Line>
      <Line i={2}>
        <div style={{ fontSize: 21, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{card.blurb}</div>
      </Line>
      <Line i={3}>
        <div className="flex flex-col gap-2.5 mt-3">
          {card.axes.map((a, i) => (
            <motion.div key={a.axis}
                        initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.5 + i * 0.11 }}
                        className="flex items-center gap-3">
              <span className="px-3 py-1.5 rounded-lg" style={{ fontSize: 16, fontWeight: 700, color: ACCENT,
                            background: 'color-mix(in srgb, var(--c-amber) 13%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 32%, transparent)',
                            minWidth: 116, textAlign: 'center' }}>
                {a.label}
              </span>
              <span style={{ fontSize: 17, color: 'rgba(255,255,255,0.45)' }}>{a.copy}</span>
            </motion.div>
          ))}
        </div>
      </Line>
    </div>
  )
}

function Closing({ card }) {
  return (
    <div className="flex flex-col justify-center h-full gap-6">
      <Line i={0}><Label>{card.range}</Label></Line>
      <Line i={1}><Big size={72} color={ACCENT}>{card.title}</Big></Line>
      <Line i={2}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 mt-4">
          <div><Big size={40}>{fmtHM(card.session_secs)}</Big><Label>logged</Label></div>
          <div><Big size={40} color="var(--c-pink)">{card.cum}</Big><Label>orgasms</Label></div>
          <div><Big size={40}>{card.sessions}</Big><Label>sessions</Label></div>
          <div><Big size={40}>{card.active_days}</Big><Label>active days</Label></div>
        </div>
      </Line>
      {card.top_name && (
        <Line i={3}>
          <div className="mt-4" style={{ fontSize: 21, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
            Ruled by <b style={{ color: '#fff' }}>{card.top_name}</b>
            {card.archetype && <> — and you were <b style={{ color: ACCENT }}>{card.archetype}</b>.</>}
          </div>
        </Line>
      )}
    </div>
  )
}

const RENDERERS = {
  opening:   Opening,
  volume:    Volume,
  clock:     ClockCard,
  rhythm:    Rhythm,
  countdown: CountdownEntry,
  devotion:  Devotion,
  newcomer:  Newcomer,
  relic:     Relic,
  growth:    Growth,
  archetype: Archetype,
  closing:   Closing,
}

export default function RecapCard({ card }) {
  const C = RENDERERS[card.type]
  if (!C) return null
  return <C card={card} />
}
