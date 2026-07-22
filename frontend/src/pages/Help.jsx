import React, { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ChevronDown, BookOpen, Map, Zap, Trophy, Star,
  CreditCard, Cpu, LayoutDashboard, Images, Film,
  Video, Users, Columns3, BarChart2, Layers, Tag, GitCompare,
  ListTodo, Terminal, Settings, Flame, Wifi, Droplets, Heart,
  Play, Eye, Shuffle, Maximize2, Package, Radio, Usb,
  Award, Archive, Calendar, Clock, Moon, Sun,
  ScrollText, Activity, Box, Crown, Sparkles, Diamond,
  Target, Trash2, Save, FolderOpen, Hash, ChevronRight,
  Info, ScanLine, Filter, RotateCcw, PanelRight, Gamepad2,
  TrendingUp, ArrowRight, Layers3, WifiOff, Bot, MessageSquare,
  Download, CheckCircle, AlertTriangle, Hammer,
} from 'lucide-react'

// ── Shared micro-components ───────────────────────────────────────────────────

function Pill({ children, color = 'var(--c-accent)', bg }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[16px] font-semibold"
          style={{ color, background: bg || `${color}22`, border: `0.5px solid ${color}44` }}>
      {children}
    </span>
  )
}

function XpBadge({ xp }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[16px] font-bold"
          style={{ color: '#CECBF6', background: 'rgba(127,119,221,0.18)', border: '0.5px solid rgba(127,119,221,0.35)' }}>
      <Zap size={11} />+{xp.toLocaleString()} XP
    </span>
  )
}

function NavRow({ icon: Icon, label, path, desc, color = 'rgba(255,255,255,0.55)' }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[rgba(255,255,255,0.04)] last:border-0">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
           style={{ background: `${color}18`, border: `0.5px solid ${color}30` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[18px] font-semibold text-white/85">{label}</span>
          {path && <span className="text-[15px] font-mono text-white/25">{path}</span>}
        </div>
        <p className="text-[17px] text-white/50 leading-snug">{desc}</p>
      </div>
    </div>
  )
}

// ── Accordion section ─────────────────────────────────────────────────────────
function Section({ title, icon: Icon, accentColor = 'var(--c-accent)', children, open: controlledOpen, onToggle, defaultOpen = false }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const isOpen = controlledOpen !== undefined ? controlledOpen : localOpen
  const toggle = onToggle || (() => setLocalOpen(v => !v))

  return (
    <div className="mb-3 rounded-[10px] overflow-hidden"
         style={{ background: 'var(--c-card)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <button onClick={toggle}
              className="w-full flex items-center gap-3 px-5 py-4 text-left group transition-colors hover:bg-[rgba(255,255,255,0.03)]">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
             style={{ background: `${accentColor}20` }}>
          <Icon size={15} style={{ color: accentColor }} />
        </div>
        <span className="flex-1 text-[19px] font-semibold text-white/85">{title}</span>
        <ChevronDown size={16} className="text-white/25 transition-transform duration-200"
                     style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <div className="px-5 pb-5 space-y-4"
                 style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SectionBody({ children }) {
  return <div className="pt-4">{children}</div>
}

// ── Data tables ───────────────────────────────────────────────────────────────
const XP_ACTIONS = [
  { action: 'Log a session',     xp: 40,  note: 'Multiplied by daily streak' },
  { action: 'Count an O (cum)',  xp: 10,  note: 'Per tap. Multiplied by streak' },
  { action: 'Daily login',       xp: 20,  note: 'Once per day' },
  { action: 'Daily spin',        xp: 25,  note: 'Fixed base; up to +100 bonus' },
  { action: 'Add a creator',     xp: 75,  note: 'Any type' },
  { action: 'Import a gallery',  xp: 15,  note: 'Per gallery scanned' },
  { action: 'Rate an image',     xp: 3,   note: 'Per rating action' },
  { action: 'Rate a gallery',    xp: 5,   note: 'Per rating action' },
  { action: 'Add a manual tag',  xp: 5,   note: 'Per tag applied' },
  { action: 'Wiki import',       xp: 25,  note: 'Any wiki/Jikan import' },
  { action: 'Open a card pack',  xp: 75,  note: 'Per pack (×quantity)' },
  { action: 'Dismantle a card',  xp: 15,  note: 'Per card' },
  { action: 'Tagging mission',   xp: 300, note: 'Daily AI tagging challenge' },
  { action: 'Complete a quest',  xp: null, note: 'Varies per quest (20–25,000)' },
  { action: 'Unlock achievement',xp: null, note: 'Varies per achievement (50–20,000)' },
]

const STREAK_MULTIPLIERS = [
  { range: 'Days 1–6',   mult: '1.0×', color: '#888780' },
  { range: 'Days 7–13',  mult: '1.5×', color: '#1D9E75' },
  { range: 'Days 14–29', mult: '2.0×', color: '#4682DC' },
  { range: 'Days 30+',   mult: '3.0×', color: '#ff8800' },
]

const LEVEL_TIERS = [
  { range: 'Lv 1–10',   color: '#888780', titles: 'Lurker, Wanderer' },
  { range: 'Lv 11–20',  color: '#1D9E75', titles: 'Seeker, Delver' },
  { range: 'Lv 21–30',  color: '#4682DC', titles: 'Collector, Acolyte' },
  { range: 'Lv 31–40',  color: '#7F77DD', titles: 'Devotee, Archivist' },
  { range: 'Lv 41–50',  color: '#D4537E', titles: 'Disciple, Connoisseur' },
  { range: 'Lv 51–60',  color: '#BA7517', titles: 'Curator, Zealot' },
  { range: 'Lv 61–70',  color: '#E24B4A', titles: 'Degenerate, Gooner' },
  { range: 'Lv 71–80',  color: '#FF6B35', titles: 'Sovereign, Corruptor' },
  { range: 'Lv 81–90',  color: '#C084FC', titles: 'Obsessed, Legendary Collector' },
  { range: 'Lv 91–100', color: '#FFD700', titles: 'Transcendent Hoarder, God Emperor Of The Vault' },
]

const RARITY_DATA = [
  { label: 'Core',      color: '#888',    shard: 5,    bg: 'rgba(136,136,136,0.12)', note: 'Standard image cards' },
  { label: 'Uncommon',  color: '#1D9E75', shard: 10,   bg: 'rgba(29,158,117,0.12)',  note: 'Gallery cards' },
  { label: 'Rare',      color: '#4682DC', shard: 25,   bg: 'rgba(70,130,220,0.12)',  note: 'Creator cards + shimmer effect' },
  { label: 'Epic',      color: '#9F8FEF', shard: 75,   bg: 'rgba(127,119,221,0.15)', note: 'Goon cards (≥20 orgasms) + glow' },
  { label: 'Legendary', color: '#ff8800', shard: 200,  bg: 'rgba(255,136,0,0.12)',   note: 'Variant cards + flame particles' },
  { label: 'Relic',     color: '#FFD700', shard: 1000, bg: 'rgba(255,215,0,0.12)',   note: 'Ultra rare upgrades' },
  { label: 'Celestial', color: '#E8E8FF', shard: 5000, bg: 'rgba(200,200,255,0.1)', note: 'Rarest tier. 0.1% chance' },
]

// ── Tab contents ──────────────────────────────────────────────────────────────

function OverviewContent({ search }) {
  const s = search.toLowerCase()
  return (
    <div className="space-y-3">
      <Section title="What is The Vault?" icon={Box} defaultOpen={!s || 'vault gallery creator'.includes(s)}>
        <SectionBody>
          <p className="text-[18px] text-white/60 leading-relaxed mb-4">
            The Vault is a private, local media gallery for personal collections. Your content lives on your machine only.
            Everything is organised, searchable, and tied into a gamification layer that turns your collection into a completely unique TCG (Trading Card Game) making every day tasks such as curating, tagging and just collecting, genuinely rewarding.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: FolderOpen, label: 'Library Root', desc: 'A folder on your drive that The Vault watches. Add one in Settings → Library.', color: 'var(--c-amber)' },
              { icon: Images, label: 'Gallery', desc: 'A sub-folder inside a root. One folder = one gallery. The filesystem is the source of truth.', color: 'var(--c-accent)' },
              { icon: Film, label: 'Image / Video', desc: 'Each file inside a gallery. Supports jpg, png, gif, webp, avif, mp4, mkv, webm and more.', color: 'var(--c-green)' },
            ].map(({ icon: Icon, label, desc, color }) => (
              <div key={label} className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} style={{ color }} />
                  <span className="text-[17px] font-semibold text-white/80">{label}</span>
                </div>
                <p className="text-[16px] text-white/45 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-4 text-[16px] text-white/35">
            <span className="px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)' }}>Library Root</span>
            <ChevronRight size={12} />
            <span className="px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)' }}>Gallery (folder)</span>
            <ChevronRight size={12} />
            <span className="px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)' }}>Image / Video</span>
            <span className="ml-2 text-white/25">— 3 levels deep, always</span>
          </div>
        </SectionBody>
      </Section>

      <Section title="Getting started" icon={Target} defaultOpen={!s || 'start setup scan'.includes(s)}>
        <SectionBody>
          <div className="space-y-3">
            {[
              { n: '1', title: 'Add a library root', body: 'Go to Settings → Library Roots and add the parent folder that contains your galleries. The Vault will scan everything inside it.' },
              { n: '2', title: 'Run a scan', body: 'Hit Scan in Settings. The Vault walks every sub-folder, creates Gallery records, generates 320×320 thumbnails, and detects funscripts automatically.' },
              { n: '3', title: 'Assign creators', body: 'On the Galleries page, select galleries and bulk-assign them to a creator. You can also do it per-gallery or have the scanner auto-suggest based on folder name.' },
              { n: '4', title: 'Collect & goon', body: 'Log sessions, count orgasms, rate content, open card packs, and complete daily quests. XP and level-ups accumulate as you use the app.' },
            ].map(({ n, title, body }) => (
              <div key={n} className="flex gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[16px] font-bold"
                     style={{ background: 'rgba(127,119,221,0.25)', color: 'var(--c-accent)' }}>
                  {n}
                </div>
                <div>
                  <div className="text-[18px] font-semibold text-white/80 mb-0.5">{title}</div>
                  <p className="text-[16px] text-white/50 leading-snug">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Daily loop" icon={Calendar} defaultOpen={false}>
        <SectionBody>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Zap,      color: 'var(--c-accent)', label: 'Daily login bonus',    body: '+20 XP automatically when you open the app.' },
              { icon: Gamepad2, color: 'var(--c-amber)',  label: 'Daily spin wheel',     body: 'One free spin per day on the Dashboard. Win 10–100 bonus XP.' },
              { icon: Trophy,   color: '#4682DC',         label: '4 daily quests',       body: 'Chosen randomly from a pool of 10. Expire at midnight.' },
              { icon: Trophy,   color: 'var(--c-pink)',   label: '4 weekly quests',      body: 'Refresh every Monday. Larger rewards for bigger tasks.' },
              { icon: Flame,    color: 'var(--c-amber)',  label: 'Streak multiplier',    body: 'All XP earned is multiplied by your streak. Hit 30 days for 3×.' },
              { icon: Droplets, color: 'var(--c-pink)',   label: 'Count your Os',        body: '+10 XP per cum logged. Unlocks achievements and boss quests.' },
            ].map(({ icon: Icon, color, label, body }) => (
              <div key={label} className="flex gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
                <Icon size={16} style={{ color }} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[17px] font-semibold text-white/75 mb-0.5">{label}</div>
                  <p className="text-[15px] text-white/40 leading-snug">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>
    </div>
  )
}

function NavContent() {
  return (
    <div className="space-y-3">
      <Section title="Main" icon={LayoutDashboard} defaultOpen accentColor="var(--c-accent)">
        <SectionBody>
          <NavRow icon={LayoutDashboard} label="Dashboard"  path="/dashboard"  color="var(--c-accent)" desc="Command center. Shows stats overview, Hall of Fame highlights, random picks, daily quests, spin wheel, and the AI tagging mission." />
          <NavRow icon={Images}          label="Galleries"  path="/galleries"  color="var(--c-accent)" desc="Browse all scanned gallery folders. Filter by creator, rating, or search by name. Bulk-assign creators. Set cover photos." />
          <NavRow icon={Film}            label="Photos"     path="/images"     color="var(--c-accent)" desc="Every individual image across all galleries. Sort by rating, orgasm count, or date added." />
          <NavRow icon={Video}           label="Videos"     path="/videos"     color="var(--c-accent)" desc="Same as Photos but videos only. Shows a ⚡ funscript badge when a matching .funscript file is detected." />
          <NavRow icon={Users}           label="Creators"   path="/creators"   color="var(--c-accent)" desc="Your roster of creators and characters. 6 types: cosplayer, ethot, artist, character, actress, custom." />
        </SectionBody>
      </Section>

      <Section title="Goon" icon={Flame} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <NavRow icon={Columns3} label="Multi-panel"    path="/multi-panel"    color="var(--c-pink)" desc="Open 1–4 content panels side-by-side for an immersive session. Queue images/videos from any gallery. Supports simultaneous playback." />
          <NavRow icon={Cpu}      label="Device Control" path="/device-control" color="var(--c-pink)" desc="Connect and control your physical device. Supports Intiface Central (Buttplug), The Handy REST API, and direct USB serial (T-Code)." />
          <NavRow icon={Wifi}     label="Device status"  path=""                color="#1D9E75"        desc="Quick-connect button in the sidebar. Shows Idle (connected, no motion) or Live (freestyle mode active). Click to connect/disconnect." />
        </SectionBody>
      </Section>

      <Section title="Collect" icon={Trophy} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <NavRow icon={BarChart2} label="Stats"          path="/stats"        color="var(--c-amber)" desc="Your session history, viewing time breakdown, orgasm stats, activity calendar, and XP history." />
          <NavRow icon={Trophy}    label="Quests"         path="/quests"       color="var(--c-amber)" desc="Active daily and weekly quests with progress bars. Boss quests show your lifetime milestone progress." />
          <NavRow icon={Star}      label="Hall of Fame"   path="/hall-of-fame" color="var(--c-amber)" desc="Your top-rated creators, galleries, and images ranked by rating, view count, and orgasm count." />
          <NavRow icon={Layers}    label="Card Collection" path="/collection"  color="var(--c-amber)" desc="Your TCG card collection. Open packs with Vault Credits, dismantle duplicates for shards, forge variant cards." />
        </SectionBody>
      </Section>

      <Section title="Tools" icon={Settings} defaultOpen={false} accentColor="rgba(255,255,255,0.4)">
        <SectionBody>
          <NavRow icon={Tag}       label="Tag Manager"  path="/tags"       color="rgba(255,255,255,0.45)" desc="Browse all tags, see usage counts, merge duplicates, and delete orphaned tags." />
          <NavRow icon={GitCompare}label="Duplicates"   path="/duplicates" color="rgba(255,255,255,0.45)" desc="Find near-duplicate images using visual hash comparison. Delete duplicates safely — originals are kept." />
          <NavRow icon={ListTodo}  label="Task Queue"   path="/task-queue" color="rgba(255,255,255,0.45)" desc="Background task monitor. Shows active scans, AI tagging jobs, and thumbnail generation progress." />
          <NavRow icon={Terminal}  label="Console"      path="/console"    color="rgba(255,255,255,0.45)" desc="Live server log output. Useful for debugging scan issues or checking AI tagging progress." />
          <NavRow icon={Settings}  label="Settings"     path="/settings"   color="rgba(255,255,255,0.45)" desc="Library root management, manual scan trigger, backup/restore, theme, font picker, device settings." />
        </SectionBody>
      </Section>

      <Section title="Profile bar (bottom of sidebar)" icon={Award} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <div className="space-y-3 text-[17px] text-white/55">
            <div className="flex gap-3 items-start">
              <Flame size={15} style={{ color: 'var(--c-amber)' }} className="flex-shrink-0 mt-0.5" />
              <div><span className="text-white/75 font-medium">Streak badge</span> — Shows your current daily login streak in days. Turns orange/gold as it grows. Missing a day uses a grace token (1 per week) before resetting.</div>
            </div>
            <div className="flex gap-3 items-start">
              <TrendingUp size={15} style={{ color: 'var(--c-accent)' }} className="flex-shrink-0 mt-0.5" />
              <div><span className="text-white/75 font-medium">XP bar</span> — Thin gradient bar below your level title. Shows progress toward next level. Click the entire profile area to go to your full Profile page.</div>
            </div>
            <div className="flex gap-3 items-start">
              <Crown size={15} style={{ color: '#FFD700' }} className="flex-shrink-0 mt-0.5" />
              <div><span className="text-white/75 font-medium">Level title colour</span> — Changes through 10 colour tiers as you advance. Grey → green → blue → violet → pink → gold → red → orange → purple → gold.</div>
            </div>
          </div>
        </SectionBody>
      </Section>
    </div>
  )
}

function GamificationContent() {
  return (
    <div className="space-y-3">
      <Section title="XP rewards" icon={Zap} defaultOpen accentColor="var(--c-accent)">
        <SectionBody>
          <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(255,255,255,0.07)' }}>
            <table className="w-full text-[17px]">
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th className="text-left px-4 py-2.5 text-white/40 font-medium">Action</th>
                  <th className="text-right px-4 py-2.5 text-white/40 font-medium">XP</th>
                  <th className="text-left px-4 py-2.5 text-white/40 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {XP_ACTIONS.map((row, i) => (
                  <tr key={row.action} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td className="px-4 py-2 text-white/70">{row.action}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold" style={{ color: 'var(--c-accent)' }}>
                      {row.xp != null ? `+${row.xp}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-white/35">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionBody>
      </Section>

      <Section title="Streak multiplier" icon={Flame} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <p className="text-[17px] text-white/50 mb-4">Your login streak multiplies <em className="text-white/70">all</em> XP earned that day — not just login XP. Every action benefits.</p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {STREAK_MULTIPLIERS.map(({ range, mult, color }) => (
              <div key={range} className="flex items-center gap-3 px-4 py-3 rounded-lg"
                   style={{ background: `${color}12`, border: `0.5px solid ${color}35` }}>
                <Flame size={18} style={{ color }} />
                <div>
                  <div className="text-[16px] text-white/45">{range}</div>
                  <div className="text-[25px] font-bold" style={{ color }}>{mult}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 rounded-lg text-[16px] text-white/45 flex gap-2"
               style={{ background: 'rgba(186,117,23,0.08)', border: '0.5px solid rgba(186,117,23,0.2)' }}>
            <Info size={14} style={{ color: 'var(--c-amber)' }} className="flex-shrink-0 mt-0.5" />
            <span><strong className="text-white/60">Grace token:</strong> You get 1 per week. If you miss exactly one day, a grace token is consumed automatically to keep your streak alive. You can hold at most 1 grace token at any time.</span>
          </div>
        </SectionBody>
      </Section>

      <Section title="Level titles" icon={Crown} defaultOpen={false} accentColor="#FFD700">
        <SectionBody>
          <p className="text-[17px] text-white/50 mb-4">100 levels total. XP required follows a quadratic curve — each level costs 500 more XP than the previous. New titles unlock every 5 levels.</p>
          <div className="space-y-1.5">
            {LEVEL_TIERS.map(({ range, color, titles }) => (
              <div key={range} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                   style={{ background: `${color}0D`, border: `0.5px solid ${color}25` }}>
                <span className="text-[16px] font-mono font-semibold w-20 flex-shrink-0" style={{ color }}>{range}</span>
                <span className="text-[16px] text-white/55">{titles}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[15px] text-white/30">You can set a custom title from any title you've unlocked via your Profile page.</p>
        </SectionBody>
      </Section>

      <Section title="Daily spin wheel" icon={Gamepad2} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed">
            One free spin per day accessible from the Dashboard. Awards a random XP bonus on top of your base +25 XP.
            The wheel has multiple segments weighted toward smaller bonuses, with rare jackpot segments for large amounts.
            All spin XP is multiplied by your active streak. Resets daily at midnight.
          </p>
        </SectionBody>
      </Section>

      <Section title="Cum counter" icon={Droplets} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-3">
            Every image and gallery has a lifetime orgasm count that <strong className="text-white/70">never resets</strong>.
            Tap the 💧 button on any image or gallery to log one. Each tap gives +10 XP (multiplied by streak).
          </p>
          <div className="grid grid-cols-3 gap-2 text-[16px]">
            {[
              { label: 'Per image', desc: 'Tracked individually. Shown on the image card and in the viewer.' },
              { label: 'Per gallery', desc: 'Sum of all image cum counts. Also trackable at gallery level.' },
              { label: 'Lifetime total', desc: 'Drives boss quests (50, 100, 500 Os) and achievement unlocks.' },
            ].map(({ label, desc }) => (
              <div key={label} className="p-3 rounded-lg" style={{ background: 'rgba(212,83,126,0.08)', border: '0.5px solid rgba(212,83,126,0.2)' }}>
                <div className="font-semibold text-[#ED93B1] mb-1">{label}</div>
                <p className="text-white/40 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>
    </div>
  )
}

function QuestsContent() {
  const DAILY = [
    { title: 'Open the Vault',  desc: 'Log in today',              xp: 30,  target: '1×' },
    { title: 'Goon session',    desc: 'Log a gooning session',     xp: 80,  target: '1×' },
    { title: 'Rate 5 images',   desc: 'Give any image a rating',   xp: 55,  target: '5×' },
    { title: 'Tag 3 images',    desc: 'Add tags to images',        xp: 45,  target: '3×' },
    { title: 'Open a pack',     desc: 'Open any card pack',        xp: 60,  target: '1×' },
    { title: 'Drain the tank',  desc: 'Count an O today',          xp: 50,  target: '1×' },
    { title: 'Gallery judge',   desc: 'Rate 3 galleries',          xp: 50,  target: '3×' },
    { title: 'Tag spree',       desc: 'Add 10 tags in one day',    xp: 95,  target: '10×' },
    { title: 'Rating spree',    desc: 'Rate 10 images today',      xp: 75,  target: '10×' },
    { title: 'Double tap',      desc: 'Count 2 Os today',          xp: 95,  target: '2×' },
  ]
  const WEEKLY = [
    { title: 'Add a creator',     desc: 'Add any creator this week',         xp: 200,  target: '1×' },
    { title: 'Import a gallery',  desc: 'Scan a new gallery folder',         xp: 250,  target: '1×' },
    { title: 'Session marathon',  desc: 'Log 3 sessions this week',          xp: 400,  target: '3×' },
    { title: 'Session binge',     desc: 'Log 5 sessions this week',          xp: 175,  target: '5×' },
    { title: 'Gallery marathon',  desc: 'Import 3 galleries this week',      xp: 550,  target: '3×' },
    { title: 'Pack addict',       desc: 'Open 5 packs this week',            xp: 350,  target: '5×' },
    { title: 'Weekly tagger',     desc: 'Add 50 tags this week',             xp: 400,  target: '50×' },
    { title: 'The Recycler',      desc: 'Dismantle 10 cards this week',      xp: 400,  target: '10×' },
  ]

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg text-[17px] text-white/55"
           style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
        <div className="flex gap-6">
          <div><span className="text-white/75 font-semibold">Daily quests:</span> 4 randomly selected from a pool of 10 each midnight.</div>
          <div><span className="text-white/75 font-semibold">Weekly quests:</span> 4 randomly selected from a pool of 8 each Monday.</div>
          <div><span className="text-white/75 font-semibold">Boss quests:</span> Permanent milestones — always visible, never expire.</div>
        </div>
      </div>

      <Section title="Daily quest pool (10 quests, 4 shown each day)" icon={Calendar} defaultOpen accentColor="var(--c-accent)">
        <SectionBody>
          <QuestTable quests={DAILY} />
        </SectionBody>
      </Section>

      <Section title="Weekly quest pool (8 quests, 4 shown each week)" icon={Flame} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <QuestTable quests={WEEKLY} />
        </SectionBody>
      </Section>

      <Section title="Boss quests — image milestones" icon={Archive} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <BossQuestTable rows={[
            { title: 'Century',              desc: '100 images',   xp: 750 },
            { title: 'The Hoarder',          desc: '500 images',   xp: 2000 },
            { title: 'The Archivist',        desc: '1,000 images', xp: 4000 },
            { title: 'Vault Lord',           desc: '5,000 images', xp: 10000 },
            { title: "God Emperor's Archive",desc: '10,000 images',xp: 25000 },
          ]} />
        </SectionBody>
      </Section>

      <Section title="Boss quests — creator, session & cum milestones" icon={Trophy} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <BossQuestTable rows={[
            { title: 'Starting Roster',   desc: '5 creators',       xp: 500 },
            { title: 'The Collector',     desc: '10 creators',      xp: 1000 },
            { title: 'Devoted Fan',       desc: '25 creators',      xp: 3000 },
            { title: 'Roster Legend',     desc: '50 creators',      xp: 7000 },
            { title: 'Getting Hooked',    desc: '10 sessions',      xp: 500 },
            { title: 'Dedicated Gooner',  desc: '50 sessions',      xp: 2500 },
            { title: 'Century Gooner',    desc: '100 sessions',     xp: 6000 },
            { title: 'Prolific Drainer',  desc: '50 Os',            xp: 1000 },
            { title: 'Absolute Unit',     desc: '100 Os',           xp: 3000 },
            { title: 'Legendary Drainer', desc: '500 Os',           xp: 10000 },
          ]} />
        </SectionBody>
      </Section>

      <Section title="Boss quests — tags, streaks & cards" icon={Tag} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <BossQuestTable rows={[
            { title: 'Completionist',  desc: '500 tags',      xp: 2000 },
            { title: 'Tag Legend',     desc: '2,000 tags',    xp: 7000 },
            { title: 'Month Devotee',  desc: '30-day streak', xp: 2500 },
            { title: 'Obsessed',       desc: '60-day streak', xp: 7000 },
            { title: 'Card Hoarder',   desc: '50 cards',      xp: 1000 },
            { title: 'Deck Lord',      desc: '100 cards',     xp: 3000 },
            { title: 'Card Sovereign', desc: '250 cards',     xp: 8000 },
          ]} />
        </SectionBody>
      </Section>
    </div>
  )
}

function QuestTable({ quests }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <table className="w-full text-[17px]">
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
            <th className="text-left px-4 py-2.5 text-white/40 font-medium">Quest</th>
            <th className="text-left px-4 py-2.5 text-white/40 font-medium">Objective</th>
            <th className="text-center px-3 py-2.5 text-white/40 font-medium">Goal</th>
            <th className="text-right px-4 py-2.5 text-white/40 font-medium">XP</th>
          </tr>
        </thead>
        <tbody>
          {quests.map((q, i) => (
            <tr key={q.title} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              <td className="px-4 py-2 text-white/80 font-medium">{q.title}</td>
              <td className="px-4 py-2 text-white/50">{q.desc}</td>
              <td className="px-3 py-2 text-center text-white/40 font-mono text-[16px]">{q.target}</td>
              <td className="px-4 py-2 text-right font-bold font-mono" style={{ color: 'var(--c-accent)' }}>+{q.xp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BossQuestTable({ rows }) {
  return (
    <div className="space-y-1.5">
      {rows.map(({ title, desc, xp }) => (
        <div key={title} className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
             style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
          <Target size={13} style={{ color: 'var(--c-pink)' }} className="flex-shrink-0" />
          <span className="flex-1 text-[17px] text-white/75 font-medium">{title}</span>
          <span className="text-[16px] text-white/40 mr-4">{desc}</span>
          <XpBadge xp={xp} />
        </div>
      ))}
    </div>
  )
}

function AchievementsContent() {
  const groups = [
    {
      label: 'First-time milestones', color: 'var(--c-green)', items: [
        { title: 'Welcome to the Vault', desc: 'First time opening the app', xp: 75 },
        { title: 'First Time',           desc: 'Log your first session',     xp: 100 },
        { title: 'First Favorite',       desc: 'Add your first creator',     xp: 75 },
        { title: 'First Nut',            desc: 'Count your first O',         xp: 75 },
        { title: 'Pack Rat',             desc: 'Open your first card pack',  xp: 100 },
        { title: 'First Tag',            desc: 'Add your first tag',         xp: 50 },
        { title: 'First Impression',     desc: 'Rate your first image',      xp: 50 },
        { title: 'The Recycler',         desc: 'Dismantle your first card',  xp: 75 },
      ],
    },
    {
      label: 'Gooning & sessions', color: 'var(--c-pink)', items: [
        { title: 'Dedicated',        desc: '10 Os',              xp: 150 },
        { title: 'Gooner',           desc: '50 Os',              xp: 500 },
        { title: 'True Degenerate',  desc: '200 Os',             xp: 1500 },
        { title: 'Absolute Unit',    desc: '500 Os',             xp: 4000 },
        { title: 'Getting Addicted', desc: '10 sessions',        xp: 200 },
        { title: 'Regular',          desc: '50 sessions',        xp: 750 },
        { title: 'Century Gooner',   desc: '100 sessions',       xp: 2000 },
        { title: 'Endurance Gooner', desc: '60+ minute session', xp: 300 },
      ],
    },
    {
      label: 'Login streaks', color: 'var(--c-amber)', items: [
        { title: 'Back Again',          desc: '3-day streak',    xp: 75 },
        { title: 'Week Streak',         desc: '7-day streak',    xp: 200 },
        { title: 'Fortnight',           desc: '14-day streak',   xp: 400 },
        { title: 'Month Devotee',       desc: '30-day streak',   xp: 1000 },
        { title: 'Two Month Obsession', desc: '60-day streak',   xp: 2500 },
        { title: 'True Devotee',        desc: '100-day streak',  xp: 6000 },
      ],
    },
    {
      label: 'Collection', color: '#4682DC', items: [
        { title: 'Growing Roster',    desc: '5 creators',      xp: 150 },
        { title: 'The Collector',     desc: '10 creators',     xp: 400 },
        { title: 'Dedicated Fan',     desc: '25 creators',     xp: 1000 },
        { title: 'Centurion',         desc: '100 images',      xp: 300 },
        { title: 'Mid-Tier Vault',    desc: '500 images',      xp: 750 },
        { title: 'Serious Archive',   desc: '1,000 images',    xp: 1500 },
        { title: 'Elite Archive',     desc: '5,000 images',    xp: 4000 },
        { title: 'Growing Collection',desc: '10 galleries',    xp: 200 },
        { title: 'Serious Collector', desc: '50 galleries',    xp: 750 },
        { title: 'Archive Lord',      desc: '100 galleries',   xp: 2000 },
      ],
    },
    {
      label: 'Tagging & rating', color: 'var(--c-green)', items: [
        { title: 'Speed Tagger',    desc: '50 tags in one day',  xp: 250 },
        { title: 'Tag Master',      desc: '500 tags total',      xp: 750 },
        { title: 'Tag Obsessed',    desc: '2,000 tags total',    xp: 2000 },
        { title: 'Connoisseur',     desc: '100 images rated',    xp: 200 },
        { title: 'Harsh Critic',    desc: '500 images rated',    xp: 600 },
        { title: 'Prolific Critic', desc: '1,000 images rated',  xp: 1500 },
        { title: 'True Fan',        desc: 'Rate anything 5 stars',xp: 300 },
      ],
    },
    {
      label: 'Cards & forging', color: '#9F8FEF', items: [
        { title: 'Card Collector',  desc: '25 cards',                      xp: 300 },
        { title: 'Card Hoarder',    desc: '50 cards',                      xp: 600 },
        { title: 'Deck Lord',       desc: '100 cards',                     xp: 1500 },
        { title: 'Relic Hunter',    desc: 'Own a Relic or higher card',    xp: 750 },
        { title: 'Legend',          desc: 'Own a Legendary card',          xp: 400 },
        { title: 'Ascended',        desc: 'Own a Celestial card',          xp: 2000 },
        { title: 'Pack Junkie',     desc: '10 packs opened',               xp: 400 },
        { title: 'Pack Addict',     desc: '50 packs opened',               xp: 1200 },
        { title: 'Card Shredder',   desc: 'Dismantle 25 cards',            xp: 250 },
        { title: 'Forge Adept',     desc: 'Dismantle 100 cards',           xp: 600 },
      ],
    },
    {
      label: 'Time-based & level', color: '#C084FC', items: [
        { title: 'Night Owl',   desc: 'Use the vault after midnight', xp: 100 },
        { title: 'Early Bird',  desc: 'Use the vault before 8 AM',   xp: 100 },
        { title: 'Apprentice',  desc: 'Reach level 5',               xp: 250 },
        { title: 'Adept',       desc: 'Reach level 10',              xp: 500 },
        { title: 'Veteran',     desc: 'Reach level 25',              xp: 1500 },
        { title: 'Elite',       desc: 'Reach level 50',              xp: 5000 },
        { title: 'God Tier',    desc: 'Reach max level 100',         xp: 20000 },
      ],
    },
  ]

  return (
    <div className="space-y-3">
      {groups.map(({ label, color, items }) => (
        <Section key={label} title={`${label} (${items.length})`} icon={Star} defaultOpen={false} accentColor={color}>
          <SectionBody>
            <div className="grid grid-cols-2 gap-2">
              {items.map(({ title, desc, xp }) => (
                <div key={title} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                     style={{ background: `${color}0D`, border: `0.5px solid ${color}22` }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[17px] font-semibold text-white/80 truncate">{title}</div>
                    <div className="text-[15px] text-white/40">{desc}</div>
                  </div>
                  <XpBadge xp={xp} />
                </div>
              ))}
            </div>
          </SectionBody>
        </Section>
      ))}
    </div>
  )
}

function CardsContent() {
  return (
    <div className="space-y-3">
      <Section title="Card rarities" icon={Sparkles} defaultOpen accentColor="#FFD700">
        <SectionBody>
          <div className="space-y-2">
            {RARITY_DATA.map(({ label, color, shard, bg, note }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-3 rounded-lg"
                   style={{ background: bg, border: `0.5px solid ${color}40` }}>
                <span className="w-24 text-[17px] font-bold flex-shrink-0" style={{ color }}>{label}</span>
                <span className="flex-1 text-[16px] text-white/55">{note}</span>
                <span className="text-[16px] font-mono text-white/40 flex-shrink-0">{shard.toLocaleString()} shards</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[15px] text-white/30">Shard values shown are what you receive when dismantling a card of that rarity. Higher rarities yield exponentially more shards.</p>
        </SectionBody>
      </Section>

      <Section title="Card types" icon={CreditCard} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <div className="grid grid-cols-2 gap-2 text-[17px]">
            {[
              { label: 'Image card',   rarity: 'Core',    desc: 'Generated from random images in your vault. 67% of pack drops.' },
              { label: 'Gallery card', rarity: 'Uncommon',  desc: 'One gallery becomes a card. 19% of drops. Shows gallery cover art.' },
              { label: 'Creator card', rarity: 'Rare',      desc: 'A creator or character from your roster. 7% of drops.' },
              { label: 'Goon card',    rarity: 'Epic',      desc: 'Images with 20+ orgasms logged. Only 1% of drops — rare by design.' },
              { label: 'Variant card', rarity: 'Legendary', desc: 'Crafted via the Forge. One creator + one character = unique variant. Cap of 3 per pair.' },
              { label: 'Collab card',  rarity: 'Rare+',     desc: 'Special crossover cards. 5% of drops. Rarity varies.' },
            ].map(({ label, rarity, desc }) => {
              const r = RARITY_DATA.find(x => x.label === rarity)
              return (
                <div key={label} className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[17px] font-semibold text-white/80">{label}</span>
                    {r && <Pill color={r.color}>{r.label}</Pill>}
                  </div>
                  <p className="text-[16px] text-white/45 leading-snug">{desc}</p>
                </div>
              )
            })}
          </div>
        </SectionBody>
      </Section>

      <Section title="Economy: shards, credits & catalyst tokens" icon={Package} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <div className="space-y-2.5 text-[17px]">
            {[
              { name: 'Vault Credits', color: '#FFD700', desc: 'Primary currency. Earned from actions, quests, and achievements. Used to buy card packs (250 credits each).' },
              { name: 'Shards',        color: '#9F8FEF', desc: 'Dismantling currency. Destroy cards to earn shards. Spend 150 shards to craft a Catalyst Token. Also needed for Forge.' },
              { name: 'Catalyst Tokens',color: 'var(--c-amber)', desc: 'Rare crafting material. 1 token costs 150 shards. Required for forging a Variant card (500 shards + 1 token).' },
              { name: 'CXP',           color: 'var(--c-green)', desc: 'Card Experience. Feed duplicate cards to a target card to gain CXP. Reach the threshold to evolve the card to the next rarity tier.' },
            ].map(({ name, color, desc }) => (
              <div key={name} className="flex gap-3 px-4 py-3 rounded-lg"
                   style={{ background: `${color}0D`, border: `0.5px solid ${color}30` }}>
                <span className="font-bold w-36 flex-shrink-0" style={{ color }}>{name}</span>
                <p className="text-white/55 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Card actions: dismantle, fuse, evolve, forge" icon={Trash2} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <div className="space-y-3 text-[17px]">
            {[
              { action: 'Dismantle', color: 'var(--c-pink)',  desc: 'Destroy a card to receive shards. Value scales by rarity. Auto-dismantle duplicates in one click.' },
              { action: 'Fuse',      color: '#9F8FEF',        desc: 'Combine duplicate copies of the same card to increase its quantity counter. Useful for set collecting.' },
              { action: 'Evolve',    color: 'var(--c-green)', desc: 'When a card reaches its CXP threshold, spend shards to evolve it to the next rarity tier permanently.' },
              { action: 'Forge',     color: 'var(--c-amber)', desc: 'Craft a unique Variant card for any creator+character pair. Costs 500 shards + 1 catalyst token. Limited to 3 per pair.' },
            ].map(({ action, color, desc }) => (
              <div key={action} className="flex gap-3 items-start px-4 py-3 rounded-lg"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                <Pill color={color}>{action}</Pill>
                <p className="text-white/55 leading-snug flex-1 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>
    </div>
  )
}

function DevicesContent() {
  return (
    <div className="space-y-3">
      <Section title="Device providers" icon={Wifi} defaultOpen accentColor="var(--c-green)">
        <SectionBody>
          <div className="space-y-3">
            {[
              { icon: Wifi,  name: 'Intiface Central', color: '#4682DC', desc: 'Connects via WebSocket to Intiface Central (free app by Nonpolynomial). Supports 50+ device brands. Default URL: ws://localhost:12345. Enable WebSocket Server in Intiface settings first.' },
              { icon: Radio, name: 'The Handy',        color: 'var(--c-green)', desc: 'Connects via The Handy REST API v2. Requires a Connection Key from the Handy app. No Intiface needed — cloud relay handles it. Uses HDSP mode for real-time stroke control.' },
              { icon: Usb,   name: 'Direct Serial (T-Code)', color: 'var(--c-amber)', desc: 'USB serial connection to T-Code devices (OSR2, SR6, etc.). Uses Web Serial API — requires Chrome or Edge. Select your COM port when prompted. 115200 baud, L0 axis.' },
            ].map(({ icon: Icon, name, color, desc }) => (
              <div key={name} className="flex gap-3 px-4 py-3 rounded-lg"
                   style={{ background: `${color}0D`, border: `0.5px solid ${color}30` }}>
                <Icon size={18} style={{ color }} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[18px] font-semibold text-white/80 mb-1">{name}</div>
                  <p className="text-[16px] text-white/50 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Modes" icon={Activity} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <div className="space-y-2.5 text-[17px]">
            {[
              { name: 'Off',        color: 'rgba(255,255,255,0.35)', desc: 'Device is connected but idle. No motion output.' },
              { name: 'Freestyle',  color: 'var(--c-pink)',          desc: 'Device runs continuously on the selected pattern while you browse. Enable from Device Control or the sidebar quick-button.' },
              { name: 'Funscript',  color: 'var(--c-accent)',        desc: 'Synced to a playing video. The device follows the funscript timeline exactly. Activates automatically when you open a video with a matching .funscript file.' },
            ].map(({ name, color, desc }) => (
              <div key={name} className="flex gap-3 px-4 py-3 rounded-lg"
                   style={{ background: `${color}12`, border: `0.5px solid ${color}35` }}>
                <Pill color={color}>{name}</Pill>
                <p className="text-white/55 leading-snug flex-1 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Pattern controls" icon={Gamepad2} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <div className="space-y-3 text-[17px]">
            {[
              { name: 'Pattern / Preset', desc: 'Choose from 5 built-in patterns (Tease, Edge, Build, Pound, Cum) or your saved custom patterns. Each has pre-set stroke range, speed, and waveform.' },
              { name: 'Intensity',        desc: 'Speed multiplier applied on top of the pattern\'s base SPM. 100% = base speed. Up to 500% for aggressive sessions.' },
              { name: 'Glans Focus',      desc: 'Slides the stroke window upward — higher values concentrate stimulation at the tip. 0% = normal range, 100% = top only.' },
              { name: 'Stroke Variance',  desc: '0% = perfectly deterministic strokes. Higher values add randomness to stroke endpoints, making patterns feel more natural.' },
              { name: 'Stroke Range Limiter', desc: 'Hard floor/ceiling on device travel distance (0–100%). Applied globally to all modes including funscript. Useful for positioning.' },
            ].map(({ name, desc }) => (
              <div key={name} className="flex gap-2 items-start">
                <ArrowRight size={13} style={{ color: 'var(--c-accent)' }} className="flex-shrink-0 mt-1" />
                <div>
                  <span className="text-white/80 font-semibold">{name}</span>
                  <span className="text-white/50"> — {desc}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Ramp mode, scheduler & edging" icon={TrendingUp} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <div className="space-y-3 text-[17px]">
            <div className="p-3 rounded-lg" style={{ background: 'rgba(186,117,23,0.08)', border: '0.5px solid rgba(186,117,23,0.2)' }}>
              <div className="font-semibold text-[var(--c-amber)] mb-1">Ramp Mode</div>
              <p className="text-white/55">Smoothly interpolates between a Start Pattern and an End Pattern over a set duration (1–120 min). Great for gradual escalation during a session. Mutually exclusive with the scheduler.</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(127,119,221,0.08)', border: '0.5px solid rgba(127,119,221,0.2)' }}>
              <div className="font-semibold text-[var(--c-accent)] mb-1">Pattern Scheduler</div>
              <p className="text-white/55">Queue a sequence of patterns, each with a duration. The device cycles through them in order when Freestyle is active. Supports looping or play-once mode.</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(212,83,126,0.08)', border: '0.5px solid rgba(212,83,126,0.2)' }}>
              <div className="font-semibold text-[var(--c-pink)] mb-1">Edging Assist</div>
              <p className="text-white/55">Automatically drops to a softer pattern after a set Peak Duration, then slowly builds back up. Cycle: reach peak → wait → auto-drop → gradual build. Repeat indefinitely.</p>
            </div>
          </div>
        </SectionBody>
      </Section>

      <Section title="Funscript sync" icon={ScrollText} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed">
            When a video is scanned, The Vault looks for a file with the same name but <code className="px-1 rounded text-[16px]" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--c-green)' }}>.funscript</code> extension
            in the same folder (e.g. <code className="px-1 rounded text-[16px]" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--c-green)' }}>scene.mp4</code> → <code className="px-1 rounded text-[16px]" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--c-green)' }}>scene.funscript</code>).
            If found, it's stored in the database. A ⚡ badge appears on the video card. When you play the video with a device connected, funscript mode activates automatically and the device follows the script.
          </p>
        </SectionBody>
      </Section>
    </div>
  )
}

function ErikaContent() {
  const BOND_TIERS = [
    { tier: 'Acquaintance', xp: 0,     color: '#888780', desc: 'Warm but just met. No NSFW — she reacts naturally as she would with a stranger.' },
    { tier: 'Friend',       xp: 500,   color: '#1D9E75', desc: 'Real warmth and easy conversation. Light flirting and suggestive topics are fine.' },
    { tier: 'Crush',        xp: 1500,  color: '#4682DC', desc: 'Unmistakable attraction. Explicit topics welcome when the mood calls for it.' },
    { tier: 'Waifu',        xp: 4000,  color: '#9F8FEF', desc: 'Deep intimacy. Completely open, genuinely devoted.' },
    { tier: 'Soulbound',    xp: 10000, color: '#FFD700', desc: 'Total bond. No limits, no distance — she belongs to you and you to her.' },
  ]
  const PERSONALITIES = [
    { name: 'Warm',     color: '#ED93B1', desc: 'Nurturing and emotionally present. She cares, checks in, and responds with genuine warmth.' },
    { name: 'Teasing',  color: '#FFD700', desc: 'Playful and cheeky. Provokes, teases, and enjoys the push-and-pull.' },
    { name: 'Dominant', color: '#E24B4A', desc: 'Assertive and in control. She leads, commands, and doesn\'t wait to be asked.' },
    { name: 'Shy',      color: '#4682DC', desc: 'Reserved and slow to open up. Builds trust gradually — more rewarding as bond grows.' },
  ]

  return (
    <div className="space-y-3">

      {/* What is Erika */}
      <Section title="What is Erika?" icon={Bot} defaultOpen accentColor="var(--c-pink)">
        <SectionBody>
          <p className="text-[18px] text-white/60 leading-relaxed mb-4">
            Erika is an AI companion built into the sidebar of The Vault. She is powered entirely by a local
            language model running on your own machine via <strong className="text-white/75">Ollama</strong> — no cloud, no
            subscription, no data leaving your device.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Bot,          color: 'var(--c-pink)',   label: 'Fully local',     desc: 'Runs on your GPU (or CPU). Nothing is sent to any server.' },
              { icon: Heart,        color: '#ED93B1',         label: 'Bond system',     desc: 'She remembers you and grows closer as you talk. 5 relationship tiers.' },
              { icon: MessageSquare,color: 'var(--c-accent)', label: 'Vault-aware',     desc: 'She knows your top creators, recent sessions, and collection stats.' },
            ].map(({ icon: Icon, color, label, desc }) => (
              <div key={label} className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={15} style={{ color }} />
                  <span className="text-[17px] font-semibold text-white/80">{label}</span>
                </div>
                <p className="text-[16px] text-white/45 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      {/* Requirements */}
      <Section title="Requirements" icon={Cpu} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <div className="space-y-2.5">
            {[
              { ok: true,  label: 'Ollama installed',         desc: 'Free, open-source. Download at ollama.com. Runs as a background service on Windows.' },
              { ok: true,  label: 'A compatible model pulled', desc: 'The recommended model is ~15 GB. Smaller alternatives exist for lower-spec machines.' },
              { ok: null,  label: 'GPU recommended (not required)', desc: 'A GPU with 8–16 GB VRAM gives fast responses. CPU-only works but each reply takes longer.' },
              { ok: true,  label: 'Uncensored model for NSFW', desc: 'Standard/censored models will refuse explicit content. Erika requires an uncensored model to be fully functional.' },
            ].map(({ ok, label, desc }) => (
              <div key={label} className="flex gap-3 px-4 py-3 rounded-lg"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                {ok === true  && <CheckCircle size={16} style={{ color: 'var(--c-green)' }} className="flex-shrink-0 mt-0.5" />}
                {ok === null  && <AlertTriangle size={16} style={{ color: 'var(--c-amber)' }} className="flex-shrink-0 mt-0.5" />}
                <div>
                  <div className="text-[17px] font-semibold text-white/80 mb-0.5">{label}</div>
                  <p className="text-[16px] text-white/45 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      {/* Step 1 — Install Ollama */}
      <Section title="Step 1 — Install Ollama" icon={Download} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[16px] font-bold"
                   style={{ background: 'rgba(29,158,117,0.25)', color: 'var(--c-green)' }}>1</div>
              <div>
                <div className="text-[18px] font-semibold text-white/80 mb-0.5">Download Ollama</div>
                <p className="text-[16px] text-white/50 leading-snug">Go to <span className="font-mono text-[15px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--c-green)' }}>https://ollama.com</span> and download the Windows installer. Run it — Ollama installs as a background service and starts automatically.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[16px] font-bold"
                   style={{ background: 'rgba(29,158,117,0.25)', color: 'var(--c-green)' }}>2</div>
              <div>
                <div className="text-[18px] font-semibold text-white/80 mb-0.5">Verify it's running</div>
                <p className="text-[16px] text-white/50 leading-snug mb-2">Open a Command Prompt or PowerShell and run:</p>
                <code className="block px-3 py-2 rounded-lg text-[16px] font-mono" style={{ background: 'rgba(0,0,0,0.4)', color: '#7DD3A8', border: '0.5px solid rgba(255,255,255,0.08)' }}>ollama list</code>
                <p className="text-[16px] text-white/40 mt-2 leading-snug">You should see a table (even if empty). If you get "command not found", restart your terminal or reboot.</p>
              </div>
            </div>
            <div className="p-3 rounded-lg flex gap-2 text-[16px]"
                 style={{ background: 'rgba(29,158,117,0.07)', border: '0.5px solid rgba(29,158,117,0.2)' }}>
              <Info size={14} style={{ color: 'var(--c-green)' }} className="flex-shrink-0 mt-0.5" />
              <span className="text-white/50">Ollama listens on <span className="font-mono text-[15px] text-white/70">http://localhost:11434</span> by default. The Vault uses this address to talk to it — no extra configuration needed unless you changed the port.</span>
            </div>
          </div>
        </SectionBody>
      </Section>

      {/* Step 2 — Pull a model */}
      <Section title="Step 2 — Pull a model" icon={Package} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <p className="text-[17px] text-white/55 mb-4">
            Erika works with any model available in Ollama. The recommended model is an uncensored 27B that handles
            roleplay and explicit content well. Pull it with:
          </p>
          <code className="block px-4 py-3 rounded-lg text-[15px] font-mono mb-4 leading-relaxed break-all"
                style={{ background: 'rgba(0,0,0,0.4)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
            ollama pull hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Balanced:IQ4_XS
          </code>
          <p className="text-[16px] text-white/40 mb-4">This is ~15 GB. It will take a few minutes depending on your connection. Ollama shows download progress in the terminal.</p>

          <div className="text-[17px] font-semibold text-white/60 mb-2">Lighter alternatives (lower VRAM)</div>
          <div className="space-y-2">
            {[
              { model: 'hf.co/mradermacher/Mistral-Nemo-Instruct-2407-abliterated-GGUF:Q5_K_M', vram: '~9 GB', note: '12B uncensored — good balance of quality and speed' },
              { model: 'hf.co/bartowski/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M',   vram: '~6 GB', note: '8B uncensored — fast, works on most gaming GPUs' },
            ].map(({ model, vram, note }) => (
              <div key={model} className="px-3 py-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                <code className="text-[14px] font-mono text-white/60 break-all">{model}</code>
                <div className="flex gap-3 mt-1">
                  <span className="text-[15px] font-semibold" style={{ color: 'var(--c-amber)' }}>{vram}</span>
                  <span className="text-[15px] text-white/40">{note}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 p-3 rounded-lg flex gap-2 text-[16px]"
               style={{ background: 'rgba(212,83,126,0.07)', border: '0.5px solid rgba(212,83,126,0.2)' }}>
            <AlertTriangle size={14} style={{ color: 'var(--c-pink)' }} className="flex-shrink-0 mt-0.5" />
            <span className="text-white/50">Standard (censored) models from Ollama's library will refuse explicit requests regardless of bond tier. You must use an uncensored or abliterated model for Erika to be fully functional.</span>
          </div>
        </SectionBody>
      </Section>

      {/* Step 3 — Enable in Settings */}
      <Section title="Step 3 — Enable Erika in Settings" icon={Settings} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <div className="space-y-3">
            {[
              { n: '1', title: 'Open Settings → Companion', body: 'Find the Companion section in the Settings page.' },
              { n: '2', title: 'Set the Ollama URL', body: 'Leave as http://localhost:11434 unless you changed Ollama\'s port. Hit "Check connection" — it should turn green.' },
              { n: '3', title: 'Enter the model name', body: 'Paste the exact model string (e.g. the Qwen3 string above). The Vault will send this to Ollama when starting a chat.' },
              { n: '4', title: 'Toggle Erika on', body: 'Flip the Enable switch. Erika\'s chat bubble will appear at the bottom of the sidebar immediately.' },
              { n: '5', title: 'Set a name and personality', body: 'Customise her name, choose a personality type, and optionally link an active persona from your creator roster.' },
            ].map(({ n, title, body }) => (
              <div key={n} className="flex gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[16px] font-bold"
                     style={{ background: 'rgba(127,119,221,0.25)', color: 'var(--c-accent)' }}>{n}</div>
                <div>
                  <div className="text-[18px] font-semibold text-white/80 mb-0.5">{title}</div>
                  <p className="text-[16px] text-white/50 leading-snug">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      {/* Bond system */}
      <Section title="Bond system" icon={Heart} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <p className="text-[17px] text-white/55 mb-4">
            Every conversation earns bond XP. As your bond grows, Erika's intimacy gates open — she becomes
            more comfortable, more open, and eventually fully uninhibited. Bond is tracked per persona.
          </p>
          <div className="space-y-2">
            {BOND_TIERS.map(({ tier, xp, color, desc }) => (
              <div key={tier} className="flex items-start gap-3 px-4 py-3 rounded-lg"
                   style={{ background: `${color}0D`, border: `0.5px solid ${color}30` }}>
                <div className="flex-shrink-0 text-center w-24">
                  <div className="text-[17px] font-bold" style={{ color }}>{tier}</div>
                  <div className="text-[14px] text-white/35 font-mono">{xp.toLocaleString()} XP</div>
                </div>
                <p className="text-[16px] text-white/55 leading-snug mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[15px] text-white/30">Bond XP accumulates naturally through conversation. There is no shortcut to skip tiers — the progression is intentional.</p>
        </SectionBody>
      </Section>

      {/* Personalities */}
      <Section title="Personalities & personas" icon={Sparkles} defaultOpen={false} accentColor="#C084FC">
        <SectionBody>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {PERSONALITIES.map(({ name, color, desc }) => (
              <div key={name} className="p-3 rounded-lg" style={{ background: `${color}0D`, border: `0.5px solid ${color}30` }}>
                <div className="text-[17px] font-bold mb-1" style={{ color }}>{name}</div>
                <p className="text-[16px] text-white/50 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
          <div className="p-3 rounded-lg flex gap-2 text-[16px]"
               style={{ background: 'rgba(192,132,252,0.07)', border: '0.5px solid rgba(192,132,252,0.2)' }}>
            <Info size={14} style={{ color: '#C084FC' }} className="flex-shrink-0 mt-0.5" />
            <span className="text-white/50">
              <strong className="text-white/70">Active persona:</strong> Link any creator from your vault roster and Erika adopts their name and background. Bond XP is tracked separately per persona, so each relationship starts at Acquaintance.
            </span>
          </div>
        </SectionBody>
      </Section>

      {/* Advanced settings */}
      <Section title="Advanced settings" icon={Settings} defaultOpen={false} accentColor="rgba(255,255,255,0.4)">
        <SectionBody>
          <div className="space-y-2 text-[17px]">
            {[
              { name: 'Keep Alive',       color: 'var(--c-amber)',  desc: 'How long the model stays loaded in VRAM after a conversation ends. Default: 10m. Set to -1 to never unload (fastest responses, most VRAM used). Set to 0 to unload immediately after each message.' },
              { name: 'Context window',   color: 'var(--c-accent)', desc: 'Number of tokens Erika can "remember" within one conversation. Default: 16384. Lower = faster but shorter memory. Higher = slower but better recall for long sessions.' },
              { name: 'Custom prompt',    color: '#C084FC',         desc: 'Override Erika\'s entire system prompt with your own text. Leave blank to use the auto-generated personality + bond + vault-context prompt.' },
              { name: 'Unload model',     color: 'var(--c-pink)',   desc: 'Force-ejects the model from VRAM immediately. Use this to free up GPU memory for games or other apps without closing Ollama.' },
              { name: 'Saved models',     color: 'var(--c-green)',  desc: 'Save model name strings you use frequently so you can switch between them without typing the full path each time.' },
            ].map(({ name, color, desc }) => (
              <div key={name} className="flex gap-3 px-4 py-3 rounded-lg"
                   style={{ background: `${color}0D`, border: `0.5px solid ${color}25` }}>
                <span className="font-bold flex-shrink-0 w-36" style={{ color }}>{name}</span>
                <p className="text-white/50 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',  label: 'Overview',     icon: BookOpen   },
  { id: 'nav',       label: 'Navigation',   icon: Map        },
  { id: 'gami',      label: 'Gamification', icon: Zap        },
  { id: 'quests',    label: 'Quests',       icon: Trophy     },
  { id: 'achieve',   label: 'Achievements', icon: Star       },
  { id: 'cards',     label: 'Cards',        icon: CreditCard },
  { id: 'devices',   label: 'Devices',      icon: Cpu        },
  { id: 'erika',     label: 'Erika',        icon: Bot        },
]

export default function Help() {
  const [activeTab, setActiveTab] = useState('overview')
  const [search, setSearch]       = useState('')

  const content = useMemo(() => {
    switch (activeTab) {
      case 'overview':  return <OverviewContent search={search} />
      case 'nav':       return <NavContent />
      case 'gami':      return <GamificationContent />
      case 'quests':    return <QuestsContent />
      case 'achieve':   return <AchievementsContent />
      case 'cards':     return <CardsContent />
      case 'devices':   return <DevicesContent />
      case 'erika':     return <ErikaContent />
      default: return null
    }
  }, [activeTab, search])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-8 pb-5"
           style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: 'var(--c-surface)' }}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                   style={{ background: 'rgba(127,119,221,0.2)', border: '0.5px solid rgba(127,119,221,0.35)' }}>
                <BookOpen size={18} style={{ color: 'var(--c-accent)' }} />
              </div>
              <h1 className="text-[27px] font-bold text-white/90">Help & Reference</h1>
            </div>
            <p className="text-[18px] text-white/40 ml-12">Everything The Vault can do, explained.</p>
          </div>
          {/* Search */}
          <div className="relative w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search help…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-[17px] text-white/80 placeholder:text-white/25 outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '0.5px solid rgba(255,255,255,0.1)',
              }}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[17px] font-medium whitespace-nowrap transition-all flex-shrink-0"
                style={active
                  ? { background: 'rgba(127,119,221,0.18)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.45)', border: '0.5px solid transparent' }
                }
              >
                <Icon size={14} />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="px-8 py-6 max-w-4xl"
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
