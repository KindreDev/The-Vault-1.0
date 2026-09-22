import React, { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ChevronDown, BookOpen, Map, Compass, Zap, Trophy, Star,
  WalletCards, Cpu, LayoutDashboard, Images, Film,
  Video, Users, Columns3, BarChart2, Layers, Tag, GitCompare,
  ListTodo, Terminal, Settings, Flame, Wifi, Droplets, Heart,
  Play, Eye, Shuffle, Maximize2, Package, Radio, Usb,
  Award, Archive, Calendar, Clock, Moon, Sun,
  ScrollText, Activity, Box, Crown, Sparkles, Diamond,
  Target, Trash2, Save, FolderOpen, Hash, ChevronRight,
  Info, ScanLine, Filter, RotateCcw, PanelRight, Gamepad2,
  TrendingUp, ArrowRight, Layers3, WifiOff, Bot, MessageSquare,
  Download, CheckCircle, AlertTriangle, Hammer, Keyboard,
} from 'lucide-react'
import { HOTKEY_GROUPS, HOTKEY_ACTIONS, bindingToDisplay, SCOPE_VIEWER } from '../lib/hotkeys'
import { useVaultStore } from '../store/vault'

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
          style={{ color: 'var(--c-accent-text)', background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
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
          {path && <span className="text-[16px] font-mono text-white/25">{path}</span>}
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
  { action: 'Log a session',       xp: 40,  note: 'Multiplied by daily streak' },
  { action: 'Count an O (cum)',    xp: 10,  note: 'Per event. Multiplied by streak' },
  { action: 'Log an edge',         xp: 3,   note: 'Per edge event' },
  { action: 'Daily login',         xp: 20,  note: 'Once per day' },
  { action: 'Daily spin',          xp: null, note: 'Random 15–150 XP, or Vault Credits' },
  { action: 'Add a creator',       xp: 75,  note: 'Any creator type' },
  { action: 'Import a gallery',    xp: 15,  note: 'Per gallery imported or scanned' },
  { action: 'Rate an image',       xp: 3,   note: 'Per rating action' },
  { action: 'Rate a gallery',      xp: 5,   note: 'Per rating action' },
  { action: 'Add a manual tag',    xp: 5,   note: 'Per tag applied' },
  { action: 'Curate a gallery/file', xp: null, note: 'Scales with how much you fix' },
  { action: 'Wiki / character import', xp: 25, note: 'Any supported catalogue import' },
  { action: 'Open a TCG pack',     xp: 75,  note: 'Per published booster pack' },
  { action: 'Complete a quest',    xp: null, note: 'Varies by quest' },
  { action: 'Unlock achievement',  xp: null, note: 'One-time milestone reward' },
]

const CREDIT_ACTIONS = [
  { action: 'Log a session', value: '+40', note: 'Recurring activity income' },
  { action: 'Count an O', value: '+25', note: 'Up to 10 credit-paying events per day' },
  { action: 'Daily login', value: '+25', note: 'Once per day' },
  { action: 'Rate an image', value: '+8', note: 'Per rating action' },
  { action: 'Rate a gallery', value: '+15', note: 'Per rating action' },
  { action: 'Add a tag', value: '+10', note: 'Per manual tag' },
  { action: 'Curate a gallery/file', value: '+12–25', note: 'Depends on the curation action' },
  { action: 'Import a gallery', value: '+20', note: 'Setup work; bulk file imports pay 0' },
  { action: 'Add a creator', value: '+50', note: 'Per creator' },
  { action: 'Wiki / character import', value: '+15', note: 'Per supported import' },
  { action: 'Daily spin', value: '+50 or +100', note: 'Random credit result' },
  { action: 'Complete a quest', value: 'Varies', note: 'Active quest board shows the exact reward' },
]

const STREAK_MULTIPLIERS = [
  { range: 'Days 1–6',   mult: '1.0×', color: '#888780' },
  { range: 'Days 7–13',  mult: '1.5×', color: 'var(--c-green)' },
  { range: 'Days 14–29', mult: '2.0×', color: '#4682DC' },
  { range: 'Days 30+',   mult: '3.0×', color: '#ff8800' },
]

const LEVEL_TIERS = [
  { range: 'Lv 1–10',   color: '#888780', titles: 'Lurker, Wanderer' },
  { range: 'Lv 11–20',  color: 'var(--c-green)', titles: 'Seeker, Delver' },
  { range: 'Lv 21–30',  color: '#4682DC', titles: 'Collector, Acolyte' },
  { range: 'Lv 31–40',  color: 'var(--c-accent)', titles: 'Devotee, Archivist' },
  { range: 'Lv 41–50',  color: 'var(--c-pink)', titles: 'Disciple, Connoisseur' },
  { range: 'Lv 51–60',  color: 'var(--c-amber)', titles: 'Curator, Zealot' },
  { range: 'Lv 61–70',  color: '#E24B4A', titles: 'Degenerate, Gooner' },
  { range: 'Lv 71–80',  color: '#FF6B35', titles: 'Sovereign, Corruptor' },
  { range: 'Lv 81–90',  color: '#C084FC', titles: 'Obsessed, Legendary Collector' },
  { range: 'Lv 91–100', color: '#FFD700', titles: 'Transcendent Hoarder, God Emperor Of The Vault' },
]

// TCG V2 rarity ladder: one visible rarity axis, fixed when the card is published.
const RARITY_DATA = [
  { label: 'C',         color: '#888780', bg: 'rgba(136,135,128,0.12)', note: 'Common — the foundation of the permanent collection.' },
  { label: 'R',         color: '#55C2FF', bg: 'rgba(85,194,255,0.12)', note: 'Rare — a less common pull with a brighter treatment.' },
  { label: 'SR',        color: '#9F8FEF', bg: 'rgba(159,143,239,0.12)', note: 'Super Rare — scarcer artwork and stronger finish.' },
  { label: 'UR',        color: '#FFD700', bg: 'rgba(255,215,0,0.12)', note: 'Ultra Rare — a high-end chase card with premium effects.' },
  { label: 'SPR',       color: '#FF8ACB', bg: 'rgba(255,138,203,0.12)', note: 'Special Rare — a linked premium parallel with its own frozen printing.' },
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
                     style={{ background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)', color: 'var(--c-accent)' }}>
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
              { icon: Gamepad2, color: 'var(--c-amber)',  label: 'Daily spin wheel',     body: 'One free spin per day on the Dashboard. Win 15–150 XP, or 50/100 Vault Credits.' },
              { icon: Trophy,   color: '#4682DC',         label: '4 daily quests',       body: 'Chosen randomly from a pool of 11. Expire at midnight and can award XP plus Credits.' },
              { icon: Trophy,   color: 'var(--c-pink)',   label: '4 weekly quests',      body: 'Refresh every Monday. Larger rewards for bigger tasks.' },
              { icon: Flame,    color: 'var(--c-amber)',  label: 'Streak multiplier',    body: 'All XP earned is multiplied by your streak. Hit 30 days for 3×.' },
              { icon: Droplets, color: 'var(--c-pink)',   label: 'Count your Os',        body: '+10 XP and +25 Credits per event, with a daily credit cap. Unlocks achievements, quests, and Foundation SPR milestones.' },
            ].map(({ icon: Icon, color, label, body }) => (
              <div key={label} className="flex gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
                <Icon size={16} style={{ color }} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[17px] font-semibold text-white/75 mb-0.5">{label}</div>
                  <p className="text-[16px] text-white/40 leading-snug">{body}</p>
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
          <NavRow icon={LayoutDashboard} label="Dashboard"  path="/dashboard"  color="var(--c-accent)" desc="Command center with your stats, Hall of Fame highlights, random picks, Daily Spin, Collection Curating, Loading Bay, and active session controls." />
          <NavRow icon={Images}          label="Galleries"  path="/galleries"  color="var(--c-accent)" desc="Browse all scanned gallery folders. Filter by creator, rating, or search by name. Bulk-assign creators. Set cover photos." />
          <NavRow icon={Film}            label="Photos"     path="/images"     color="var(--c-accent)" desc="Every individual image across all galleries. Sort by rating, orgasm count, or date added." />
          <NavRow icon={Video}           label="Videos"     path="/videos"     color="var(--c-accent)" desc="Video-only browsing with duration badges, length sorting, browser-compatible playback, funscript detection, and the full viewer controls." />
          <NavRow icon={Users}           label="Creators"   path="/creators"   color="var(--c-accent)" desc="Your roster of creators and characters. 6 types: cosplayer, ethot, artist, character, actress, custom." />
        </SectionBody>
      </Section>

      <Section title="Goon" icon={Flame} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <NavRow icon={Columns3} label="Playlists"      path="/playlists"       color="var(--c-pink)" desc="Build and save playlists: queue media into up to 6 independent panels, save each arrangement, and resume it later." />
          <NavRow icon={ScrollText} label="Funscripts"    path="/funscripts"      color="var(--c-pink)" desc="Manage your funscript library and script-only playlists. Analyze scripts, inspect speed/action metrics, tag and rate them, and play them independently." />
          <NavRow icon={Cpu}      label="Device Control" path="/device-control" color="var(--c-pink)" desc="Connect and control your physical device. Supports Intiface Central (Buttplug), The Handy REST API, and direct USB serial (T-Code)." />
          <NavRow icon={Bot}      label="Erika AI"      path="/erika"          color="var(--c-pink)" desc="Optional local companion powered by Ollama. Her chat, bond, persona, and Vault context stay on your machine." />
          <NavRow icon={Wifi}     label="Device status"  path=""                color="var(--c-green)"        desc="Quick-connect button in the sidebar. Shows Idle (connected, no motion) or Live (freestyle mode active). Click to connect/disconnect." />
        </SectionBody>
      </Section>

      <Section title="Social" icon={Radio} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <NavRow icon={Radio} label="Feed"    path="/feed"    color="var(--c-accent)" desc="Your local social-style feed of Vault activity and collection posts." />
          <NavRow icon={Compass} label="Explore" path="/explore" color="var(--c-accent)" desc="Discover creators, galleries, and media across the collection without changing the library structure." />
        </SectionBody>
      </Section>

      <Section title="Collect" icon={Trophy} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <NavRow icon={BarChart2} label="Stats"          path="/stats"        color="var(--c-amber)" desc="Overview, Analytics, and Collection History: inspect sessions, viewing time, activity, orgasms, creators, XP, long-term phases, and curation health." />
          <NavRow icon={Trophy}    label="Quests"         path="/quests"       color="var(--c-amber)" desc="Active daily and weekly quests with progress bars. Boss quests show your lifetime milestone progress." />
          <NavRow icon={Star}      label="Hall of Fame"   path="/hall-of-fame" color="var(--c-amber)" desc="Expanded leaderboards for creators, galleries, and media, with period and all-time boards, rank movement, and detailed stats." />
          <NavRow icon={Activity}  label="Recap"          path="/recap"       color="var(--c-pink)" desc="A visual recap of your collection and session history, with highlights from the selected period." />
          <NavRow icon={WalletCards} label="Card Collection" path="/collection" color="var(--c-amber)" desc="Browse the published trading-card catalogue, releases, sets, boosters, binders, Workshop cosmetics, physical copies, and C / R / SR / UR / SPR rarities." />
          <NavRow icon={Box}         label="Collection Room" path="/collection/room" color="var(--c-amber)" desc="Optional first-person collector room for furniture, parcels, physical card copies, binders, cabinets, posters, and display layouts." />
        </SectionBody>
      </Section>

      <Section title="Tools" icon={Settings} defaultOpen={false} accentColor="rgba(255,255,255,0.4)">
        <SectionBody>
          <NavRow icon={Tag}       label="Tag Manager"  path="/tags"       color="rgba(255,255,255,0.45)" desc="Browse all tags, see usage counts, merge duplicates, and delete orphaned tags." />
          <NavRow icon={GitCompare}label="Duplicates"   path="/duplicates" color="rgba(255,255,255,0.45)" desc="Find near-duplicate images using visual hash comparison. Delete duplicates safely — originals are kept." />
          <NavRow icon={ListTodo}  label="Task Queue"   path="/task-queue" color="rgba(255,255,255,0.45)" desc="Background task monitor. Shows active scans, AI tagging jobs, and thumbnail generation progress." />
          <NavRow icon={Terminal}  label="Console"      path="/console"    color="rgba(255,255,255,0.45)" desc="Live server log output. Useful for debugging scan issues or checking AI tagging progress." />
          <NavRow icon={Settings}  label="Settings"     path="/settings"   color="rgba(255,255,255,0.45)" desc="Library and scanner controls, AI tagging, themes, typography, session behavior, hotkeys, backup/restore, storage, updates, and system maintenance." />
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
               style={{ background: 'color-mix(in srgb, var(--c-amber) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 20%, transparent)' }}>
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
          <p className="mt-3 text-[16px] text-white/30">You can set a custom title from any title you've unlocked via your Profile page.</p>
        </SectionBody>
      </Section>

      <Section title="Daily spin wheel" icon={Gamepad2} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed">
            One free spin per day is accessible from Dashboard → Daily Spin. It awards a random XP result, a 50/100-Credit result, or a small spotlight XP reward.
            XP results range from 15 to 150 and are multiplied by your active streak. The spin resets daily at midnight and the button becomes unavailable after it is consumed.
          </p>
        </SectionBody>
      </Section>

      <Section title="Cum counter" icon={Droplets} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-3">
            Every image and gallery has a lifetime orgasm count that <strong className="text-white/70">never resets</strong>.
            Tap the 💧 button on any image or gallery to log one. Each event gives +10 XP (multiplied by streak) and can give +25 Credits, up to the daily Credit cap.
          </p>
          <div className="grid grid-cols-3 gap-2 text-[16px]">
            {[
              { label: 'Per image', desc: 'Tracked individually. Shown on the image card and in the viewer.' },
              { label: 'Per gallery', desc: 'Sum of all image cum counts. Also trackable at gallery level.' },
              { label: 'Lifetime total', desc: 'Drives Foundation SPR milestones, boss quests (50, 100, 500 Os), and achievement unlocks.' },
            ].map(({ label, desc }) => (
              <div key={label} className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-pink) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 20%, transparent)' }}>
                <div className="font-semibold text-[var(--c-pink-text)] mb-1">{label}</div>
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
    { title: 'Open the Vault',  desc: 'Log in today',              xp: 30,  credit: 20,  target: '1×' },
    { title: 'Goon session',    desc: 'Log a gooning session',     xp: 80,  credit: 80,  target: '1×' },
    { title: 'Rate 5 images',   desc: 'Give any image a rating',   xp: 55,  credit: 60,  target: '5×' },
    { title: 'Tag 3 images',    desc: 'Add tags to images',        xp: 45,  credit: 60,  target: '3×' },
    { title: 'Open a pack',     desc: 'Open any card pack',        xp: 60,  credit: 30,  target: '1×' },
    { title: 'Drain the tank',  desc: 'Count an O today',          xp: 50,  credit: 45,  target: '1×' },
    { title: 'Gallery judge',   desc: 'Rate 3 galleries',          xp: 50,  credit: 50,  target: '3×' },
    { title: 'Tag spree',       desc: 'Add 10 tags in one day',    xp: 95,  credit: 120, target: '10×' },
    { title: 'Rating spree',    desc: 'Rate 10 images today',      xp: 75,  credit: 100, target: '10×' },
    { title: 'Double tap',      desc: 'Count 2 Os today',          xp: 95,  credit: 100, target: '2×' },
    { title: "Curator's eye",  desc: 'Curate 5 galleries',        xp: 70,  credit: 100, target: '5×' },
  ]
  const WEEKLY = [
    { title: 'Add a creator',     desc: 'Add any creator this week',         xp: 200,  credit: 150, target: '1×' },
    { title: 'Import a gallery',  desc: 'Scan a new gallery folder',         xp: 250,  credit: 100, target: '1×' },
    { title: 'Session marathon',  desc: 'Log 3 sessions this week',          xp: 400,  credit: 350, target: '3×' },
    { title: 'Session binge',     desc: 'Log 5 sessions this week',           xp: 175,  credit: 300, target: '5×' },
    { title: 'Gallery marathon',  desc: 'Import 3 galleries this week',       xp: 550,  credit: 250, target: '3×' },
    { title: 'Pack addict',       desc: 'Open 5 packs this week',             xp: 350,  credit: 300, target: '5×' },
    { title: 'Weekly tagger',     desc: 'Add 50 tags this week',              xp: 400,  credit: 600, target: '50×' },
    { title: 'Deep clean',        desc: 'Curate 30 galleries this week',      xp: 450,  credit: 600, target: '30×' },
  ]

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg text-[17px] text-white/55"
           style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
        <div className="flex gap-6">
          <div><span className="text-white/75 font-semibold">Daily quests:</span> 4 randomly selected from a pool of 11 each midnight. Each shows XP and Credits.</div>
          <div><span className="text-white/75 font-semibold">Weekly quests:</span> 4 randomly selected from a pool of 8 each Monday.</div>
          <div><span className="text-white/75 font-semibold">Boss quests:</span> Permanent milestones — always visible, never expire. Completing the whole daily/weekly board unlocks a separate pack reward to claim.</div>
        </div>
      </div>

      <Section title="Daily quest pool (11 quests, 4 shown each day)" icon={Calendar} defaultOpen accentColor="var(--c-accent)">
        <SectionBody>
          <QuestTable quests={DAILY} />
        </SectionBody>
      </Section>

      <Section title="Weekly quest pool (8 quests, 4 shown each week)" icon={Flame} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <QuestTable quests={WEEKLY} />
        </SectionBody>
      </Section>

      <Section title="Completion rewards" icon={Package} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <div className="grid grid-cols-2 gap-3 text-[16px]">
            <div className="p-4 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 25%, transparent)' }}>
              <div className="text-[18px] font-bold text-[var(--c-accent-text)] mb-1">Daily sweep</div>
              <p className="text-white/50 leading-snug">Complete every active daily quest, then claim <strong className="text-white/75">5 Permanent Vault Boosters</strong>. Each contains 10 cards with an SR-or-higher guarantee.</p>
            </div>
            <div className="p-4 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-amber) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 25%, transparent)' }}>
              <div className="text-[18px] font-bold text-[var(--c-amber-text)] mb-1">Weekly sweep</div>
              <p className="text-white/50 leading-snug">Complete every active weekly quest, choose a published release, then claim <strong className="text-white/75">1 Weekly Protection Pack</strong>: 4 cards with 3 UR + 1 SPR guaranteed.</p>
            </div>
          </div>
          <p className="mt-3 text-[16px] text-white/40">The board does not open these rewards silently. Click Claim. If a period rolls over before you claim, an earned completion reward waits for you instead of disappearing.</p>
        </SectionBody>
      </Section>

      <Section title="Boss quests — image milestones" icon={Archive} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <BossQuestTable rows={[
            { title: 'Century',              desc: '100 images',   xp: 750,   credit: 250 },
            { title: 'The Hoarder',          desc: '500 images',   xp: 2000,  credit: 700 },
            { title: 'The Archivist',        desc: '1,000 images', xp: 4000,  credit: 1500 },
            { title: 'Vault Lord',           desc: '5,000 images', xp: 10000, credit: 4000 },
            { title: "God Emperor's Archive",desc: '10,000 images',xp: 25000, credit: 10000 },
          ]} />
        </SectionBody>
      </Section>

      <Section title="Boss quests — creator, session & cum milestones" icon={Trophy} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <BossQuestTable rows={[
            { title: 'Starting Roster',   desc: '5 creators',       xp: 500,   credit: 150 },
            { title: 'The Collector',     desc: '10 creators',      xp: 1000,  credit: 350 },
            { title: 'Devoted Fan',       desc: '25 creators',      xp: 3000,  credit: 1000 },
            { title: 'Roster Legend',     desc: '50 creators',      xp: 7000,  credit: 2500 },
            { title: 'Getting Hooked',    desc: '10 sessions',      xp: 500,   credit: 175 },
            { title: 'Dedicated Gooner',  desc: '50 sessions',      xp: 2500,  credit: 900 },
            { title: 'Century Gooner',    desc: '100 sessions',     xp: 6000,  credit: 2500 },
            { title: 'Prolific Drainer',  desc: '50 Os',            xp: 1000,  credit: 350 },
            { title: 'Absolute Unit',     desc: '100 Os',           xp: 3000,  credit: 1000 },
            { title: 'Legendary Drainer', desc: '500 Os',           xp: 10000, credit: 4000 },
          ]} />
        </SectionBody>
      </Section>

      <Section title="Boss quests — tags, streaks & cards" icon={Tag} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <BossQuestTable rows={[
            { title: 'Completionist',  desc: '500 tags',      xp: 2000, credit: 750 },
            { title: 'Tag Legend',     desc: '2,000 tags',    xp: 7000, credit: 2500 },
            { title: 'Month Devotee',  desc: '30-day streak', xp: 2500, credit: 900 },
            { title: 'Obsessed',       desc: '60-day streak', xp: 7000, credit: 2500 },
            { title: 'Card Hoarder',   desc: '50 cards',      xp: 1000, credit: 350 },
            { title: 'Deck Lord',      desc: '100 cards',     xp: 3000, credit: 1000 },
            { title: 'Card Sovereign', desc: '250 cards',     xp: 8000, credit: 3000 },
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
            <th className="text-right px-4 py-2.5 text-white/40 font-medium">Credits</th>
          </tr>
        </thead>
        <tbody>
          {quests.map((q, i) => (
            <tr key={q.title} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              <td className="px-4 py-2 text-white/80 font-medium">{q.title}</td>
              <td className="px-4 py-2 text-white/50">{q.desc}</td>
              <td className="px-3 py-2 text-center text-white/40 font-mono text-[16px]">{q.target}</td>
              <td className="px-4 py-2 text-right font-bold font-mono" style={{ color: 'var(--c-accent)' }}>+{q.xp}</td>
              <td className="px-4 py-2 text-right font-bold font-mono" style={{ color: '#FFD700' }}>+{q.credit}</td>
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
      {rows.map(({ title, desc, xp, credit }) => (
        <div key={title} className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
             style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
          <Target size={13} style={{ color: 'var(--c-pink)' }} className="flex-shrink-0" />
          <span className="flex-1 text-[17px] text-white/75 font-medium">{title}</span>
          <span className="text-[16px] text-white/40 mr-4">{desc}</span>
          <XpBadge xp={xp} />
          <span className="text-[16px] font-bold font-mono" style={{ color: '#FFD700' }}>+{credit} Credits</span>
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
        { title: 'First Creator',        desc: 'Add your first creator',     xp: 75 },
        { title: 'First Nut',            desc: 'Count your first O',         xp: 75 },
        { title: 'Pack Rat',             desc: 'Open your first card pack',  xp: 100 },
        { title: 'First Tag',            desc: 'Add your first tag',         xp: 50 },
        { title: 'First Impression',     desc: 'Rate your first image',      xp: 50 },
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
        { title: 'True Fan',        desc: 'Rate a gallery 10/10',     xp: 300 },
      ],
    },
    {
      label: 'Cards & collection', color: '#9F8FEF', items: [
        { title: 'Card Collector',  desc: 'Own 25 cards',                   xp: 300 },
        { title: 'Card Hoarder',    desc: 'Own 50 cards',                   xp: 600 },
        { title: 'Deck Lord',       desc: 'Own 100 cards',                  xp: 1500 },
        { title: 'Rare Pull',       desc: 'Own an SR card',                 xp: 750 },
        { title: 'Ultra Pull',      desc: 'Own a UR card',                 xp: 1200 },
        { title: 'SPR Hunter',      desc: 'Own an SPR card',                xp: 2000 },
        { title: 'Pack Junkie',     desc: 'Open 10 packs',                  xp: 400 },
        { title: 'Pack Addict',     desc: 'Open 50 packs',                  xp: 1200 },
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
                    <div className="text-[16px] text-white/40">{desc}</div>
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

function LibraryContent() {
  return (
    <div className="space-y-3">
      <Section title="The library model" icon={FolderOpen} defaultOpen accentColor="var(--c-accent)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">
            The Vault is local-first and folder-based. A library root is a folder you choose; every gallery is a folder beneath it; every image or video stays attached to that gallery. The filesystem remains the source of truth, so scans reconcile the database with what is actually on disk instead of flattening your collection.
          </p>
          <div className="grid grid-cols-2 gap-3 text-[16px]">
            {[
              { icon: FolderOpen, label: 'Library root', desc: 'A watched location configured in Settings → Library. You can have more than one root.' },
              { icon: Images, label: 'Gallery', desc: 'One folder on disk. Nested gallery folders can be imported without losing their structure.' },
              { icon: Film, label: 'Media', desc: 'Images and videos retain their file identity, metadata, ratings, notes, tags, and history.' },
              { icon: Archive, label: 'Unsorted', desc: 'Files or complete galleries without a creator can wait in an Unsorted area for later relocation.' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                <Icon size={18} style={{ color: 'var(--c-accent)' }} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[17px] font-semibold text-white/80 mb-1">{label}</div>
                  <p className="text-[16px] text-white/45 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Vault Credit economy" icon={WalletCards} defaultOpen={false} accentColor="#FFD700">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">
            XP controls progression; <strong className="text-white/75">Vault Credits</strong> are the separate pack currency. Credit rewards are designed to make collecting, organizing, and using the Vault all worthwhile without turning a bulk import into an infinite faucet.
          </p>
          <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid rgba(255,255,255,0.07)' }}>
            <table className="w-full text-[16px]">
              <thead><tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium">Activity</th>
                <th className="text-right px-4 py-2.5 text-white/40 font-medium">Credits</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium">Rule</th>
              </tr></thead>
              <tbody>
                {CREDIT_ACTIONS.map((row, i) => (
                  <tr key={row.action} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td className="px-4 py-2 text-white/70">{row.action}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold" style={{ color: '#FFD700' }}>{row.value}</td>
                    <td className="px-4 py-2 text-white/45">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[16px]">
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,215,0,0.07)', border: '0.5px solid rgba(255,215,0,0.22)' }}>
              <div className="font-semibold text-[#FFD700] mb-1">What does not pay Credits?</div>
              <p className="text-white/45 leading-snug">Bulk file imports, pack opening itself, and card dismantling. Dismantling still produces forge materials; opening a pack never refunds its price.</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 22%, transparent)' }}>
              <div className="font-semibold text-[var(--c-accent-text)] mb-1">Why the cap?</div>
              <p className="text-white/45 leading-snug">Cum Credits are capped at 10 credit-paying events per day. Your lifetime counter and XP remain lifetime progression; only the recurring currency faucet is bounded.</p>
            </div>
          </div>
        </SectionBody>
      </Section>

      <Section title="Loading Bay — formerly Intake" icon={ScanLine} defaultOpen accentColor="var(--c-amber)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">
            Loading Bay is the safe staging area for files that are not ready to become ordinary library media. It can inspect archives, preview pending files, detect duplicates, import complete gallery folders, and place content into an existing gallery or Unsorted without breaking the folder model.
          </p>
          <div className="space-y-2.5 text-[16px]">
            {[
              ['Inspect first', 'Preview images, videos, archives, counts, filenames, thumbnails, video duration, and the reason a file matched another item.'],
              ['Import complete galleries', 'Bring in a whole folder, including nested folders and sidecars, without flattening it. Creator assignment is optional.'],
              ['Handle duplicates safely', 'Compare exact and visual matches, see resolution/file size/duration, then keep the original or use an explicit bulk action.'],
              ['Control archive cleanup', 'Inspect ZIP, 7z, and RAR archives, preview them, and choose whether an extracted archive is deleted, moved, or kept.'],
              ['Ignore or remove deliberately', 'Temporary hide, permanent ignore, and explicit disk deletion are separate actions. Deletion always requires confirmation.'],
            ].map(([label, desc]) => (
              <div key={label} className="flex gap-3 items-start">
                <CheckCircle size={16} style={{ color: 'var(--c-amber)' }} className="flex-shrink-0 mt-0.5" />
                <p className="text-white/55 leading-snug"><strong className="text-white/75">{label}:</strong> {desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg flex gap-2 text-[16px]" style={{ background: 'color-mix(in srgb, var(--c-amber) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 25%, transparent)' }}>
            <Info size={15} style={{ color: 'var(--c-amber)' }} className="flex-shrink-0 mt-0.5" />
            <span className="text-white/50">Loading Bay is an intake workflow, not a second library hierarchy. Once imported, the normal root → gallery → media model takes over.</span>
          </div>
        </SectionBody>
      </Section>

      <Section title="Collection Curating" icon={Sparkles} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">
            Collection Curating is the guided cleanup loop for galleries that still need attention. It presents one gallery at a time and lets you fix the metadata that makes the rest of the Vault useful.
          </p>
          <div className="grid grid-cols-2 gap-2 text-[16px]">
            {[
              ['What you can fix', 'Rename the folder, assign creators, add tags, rate the gallery, set a cover, mark it favourite, record period/price, or delete it.'],
              ['Save & next', 'Save the current work and move forward without losing the curation queue. Large mixed folders can be handled at file level.'],
              ['Not now', 'Snooze one gallery for a fortnight when you do not want to decide yet.'],
              ['Curation rotation', 'Completed galleries leave the active rotation for three months, so the queue keeps showing work that actually needs you.'],
            ].map(([label, desc]) => (
              <div key={label} className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-pink) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 22%, transparent)' }}>
                <div className="text-[17px] font-semibold text-white/80 mb-1">{label}</div>
                <p className="text-white/45 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Tags, AI tagging & provenance" icon={Tag} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <div className="space-y-3 text-[16px] text-white/55">
            <p><strong className="text-white/75">Manual tags</strong> are your explicit curation. <strong className="text-[#C084FC]">AI tags</strong> are model suggestions and stay visually distinct. Tag Manager can merge duplicates, remove orphaned tags, browse the raw WD14/JoyTag vocabulary, and enable or disable tags per model.</p>
            <p>Per-tag confidence overrides take priority over the global AI threshold. This is useful when a tag is consistently reliable or consistently noisy.</p>
            <p>ComfyUI images are identified from embedded workflow metadata during import. They receive the <strong className="text-white/75">AI generated</strong> provenance tag without needing to run an AI tagger.</p>
            <p>Creator and character assignment is metadata, not a forced folder level. A file can carry its own creator relationship while its gallery remains intact.</p>
          </div>
        </SectionBody>
      </Section>

      <Section title="Duplicates, missing folders & background work" icon={GitCompare} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <div className="space-y-3 text-[16px] text-white/55">
            <p><strong className="text-white/75">Duplicates</strong> uses exact and visual comparison. The safe deletion flow keeps the selected original and updates database references before removing a duplicate.</p>
            <p><strong className="text-white/75">Missing folders</strong> appears in Settings when a root or gallery is unavailable. Resolve all can scan online roots and relink confidently moved folders while protecting offline libraries; genuinely stale records can be removed explicitly.</p>
            <p><strong className="text-white/75">Task Queue</strong> is where long scans, thumbnail work, AI tagging, and other background jobs report progress. Long AI-tagging runs can pause, survive a restart, and resume from their last committed checkpoint.</p>
            <p><strong className="text-white/75">Console</strong> shows live server output when you need to diagnose a scan, model, or playback issue.</p>
          </div>
        </SectionBody>
      </Section>
    </div>
  )
}

function StatsContent() {
  return (
    <div className="space-y-3">
      <Section title="Stats has three jobs" icon={BarChart2} defaultOpen accentColor="var(--c-amber)">
        <SectionBody>
          <div className="grid grid-cols-3 gap-2 text-[16px]">
            {[
              ['Overview', 'Current totals, recent sessions, session controls, XP/profile progress, and the quick read of how you use the Vault.'],
              ['Analytics', 'Choose a page-wide range and compare viewing time, new versus rewatched media, creators, timing, edges, personal bests, and session patterns.'],
              ['Collection History', 'The long view formerly called Almanac: reconstruct collection years, phases, creator growth, curation health, and the written read from your own numbers.'],
            ].map(([label, desc]) => (
              <div key={label} className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-amber) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 22%, transparent)' }}>
                <div className="text-[17px] font-semibold text-white/80 mb-1">{label}</div>
                <p className="text-white/45 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Sessions are local, editable history" icon={Clock} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <div className="space-y-2.5 text-[16px] text-white/55">
            <p>Start and stop sessions from Dashboard, Stats, Playlists, or a viewer. A session can survive a refresh and the recovery prompt can resume an interrupted one.</p>
            <p>Session History uses your browser's local timezone for date and hour buckets. It can show multiple credited creators without turning one elapsed session into several sessions.</p>
            <p>Every history row can be edited or deleted, and you can add a session the app never observed. Creator attribution can be corrected without rewriting the rest of the session.</p>
            <p>The Session settings tab controls what ending a session means: count a climax automatically, ask each time, or never count one automatically. Edges are tracked separately.</p>
          </div>
        </SectionBody>
      </Section>

      <Section title="When analytics are unavailable" icon={Info} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed">
            Some charts require enough timestamped session history to say something useful. The Vault shows an honest unavailable state instead of inventing missing history. A shorter range may still work when the full history does not.
          </p>
        </SectionBody>
      </Section>
    </div>
  )
}

function CardsContent() {
  return (
    <div className="space-y-3">
      <Section title="One rarity ladder — C / R / SR / UR / SPR" icon={Sparkles} defaultOpen accentColor="#FFD700">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">
            Every printing has one visible rarity: <strong className="text-white/75">C → R → SR → UR → SPR</strong>. Each printing is frozen when it is created; Foundation may append a new linked SPR later when fresh personal engagement reaches its unlock milestone.
          </p>
          <div className="space-y-2">
            {RARITY_DATA.map(({ label, color, bg, note }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-3 rounded-lg"
                   style={{ background: bg, border: `0.5px solid ${color}40` }}>
                <span className="w-24 text-[17px] font-bold flex-shrink-0" style={{ color }}>{label}</span>
                <span className="flex-1 text-[16px] text-white/55">{note}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[16px] text-white/35">Rarity is not a live score or an upgrade track: an existing printing never changes, while an eligible Foundation source can receive one new linked SPR printing.</p>
        </SectionBody>
      </Section>

      <Section title="What rarity changes" icon={Diamond} defaultOpen={false} accentColor="#55C2FF">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">
            Rarity changes the material, foil, ornament density, embossing, and signature treatment while preserving the card type's identity. A published card's source, artwork, set, number, and rarity stay together as one immutable collectible.
          </p>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {[
              { c: 'C',   color: '#888780', pct: 'Common' },
              { c: 'R',   color: '#55C2FF', pct: 'Rare' },
              { c: 'SR',  color: '#9F8FEF', pct: 'Super Rare' },
              { c: 'UR',  color: '#FFD700', pct: 'Ultra Rare' },
              { c: 'SPR', color: '#FF8ACB', pct: 'Special Rare' },
            ].map(({ c, color, pct }) => (
              <div key={c} className="px-3 py-3 rounded-lg text-center" style={{ background: `${color}12`, border: `0.5px solid ${color}40` }}>
                <div className="text-[22px] font-extrabold" style={{ color }}>{c}</div>
                <div className="text-[16px] text-white/40 mt-0.5">{pct}</div>
              </div>
            ))}
          </div>
          <div className="p-3 rounded-lg text-[16px] text-white/50 flex gap-2"
               style={{ background: 'rgba(85,194,255,0.08)', border: '0.5px solid rgba(85,194,255,0.25)' }}>
            <Info size={14} style={{ color: '#55C2FF' }} className="flex-shrink-0 mt-0.5" />
            <span>Rarity is a publication fact, not a live score. Engagement can inform initial selection and append a linked Foundation SPR at the six-cum milestone, but it never rewrites the existing base card.</span>
          </div>
        </SectionBody>
      </Section>

      <Section title="Card types" icon={WalletCards} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <div className="grid grid-cols-2 gap-2 text-[17px]">
            {[
              { label: 'Scene',      desc: 'One real media item — photo, video, illustration, or 3D art — with its source identity preserved.' },
              { label: 'Gallery',    desc: 'One real Vault gallery, represented by a frozen cover and honest gallery metadata.' },
              { label: 'Creator',    desc: 'A canonical creator entity with a deliberate portrait and creator type.' },
              { label: 'Character',  desc: 'A fictional character independently of any creator portraying them.' },
              { label: 'Cosplay',    desc: 'A verified creator × character relationship supported by real Vault gallery metadata.' },
              { label: 'Collab',     desc: 'Two or more explicitly identified creators participating in the same gallery.' },
              { label: 'Bond',       desc: 'An earned card tied to a real media item and its persisted milestone history; never an ordinary pack drop.' },
              { label: 'Hall of Fame', desc: 'A permanent memento of a real Hall of Fame result, with the board period and rank frozen.' },
            ].map(({ label, desc }) => {
              return (
                <div key={label} className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[17px] font-semibold text-white/80">{label}</span>
                  </div>
                  <p className="text-[16px] text-white/45 leading-snug">{desc}</p>
                </div>
              )
            })}
          </div>
        </SectionBody>
      </Section>

      <Section title="Special Rare parallels" icon={Crown} defaultOpen={false} accentColor="#ff5db1">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-3">
            <strong className="text-white/75">SPR</strong> is a linked Special Rare printing, not a live upgrade button. It is created as its own immutable card definition with its own artwork, number, and rarity treatment. Foundation starts with a substantial engagement-ranked SPR pool and may append one linked SPR when a source reaches six lifetime cums. The collection keeps the base card and its SPR parallel distinct.
          </p>
          <div className="grid grid-cols-2 gap-2 text-[16px]">
            {[
              { label: 'Linked printing', desc: 'A parallel points back to its base card and remains tied to the same published source identity.' },
              { label: 'No silent upgrades', desc: 'Ownership and engagement never rewrite the existing base card; a milestone can add one separate parallel.' },
            ].map(({ label, desc }) => (
              <div key={label} className="p-3 rounded-lg" style={{ background: 'rgba(255,93,177,0.08)', border: '0.5px solid rgba(255,93,177,0.25)' }}>
                <div className="font-semibold text-[#ff9dd0] mb-1">{label}</div>
                <p className="text-white/45 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Card visuals (VFX)" icon={Sparkles} defaultOpen={false} accentColor="#C084FC">
        <SectionBody>
          <div className="space-y-2 text-[16px] text-white/55">
            <p><strong className="text-white/75">Rarity</strong> controls finish intensity — material, foil, embossing, ornament density, and signature treatment — while the card type keeps its own frame architecture.</p>
            <p><strong className="text-white/75">SPR</strong> uses the linked parallel treatment and is not a boolean foil toggle.</p>
            <p><strong className="text-white/75">Source art</strong> stays truthful: stills and video artwork come from real Vault media, and missing metadata is left unknown rather than invented.</p>
          </div>
        </SectionBody>
      </Section>

      <Section title="Published cards and owned copies" icon={TrendingUp} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-3">
            A <strong className="text-white/75">card definition</strong> is the published collectible: source, artwork, type, rarity, set, and collector number are frozen. An <strong className="text-white/75">owned copy</strong> only tracks inventory state such as quantity, acquisition date, lock/favorite state, and display assignment.
          </p>
          <div className="grid grid-cols-2 gap-2 text-[16px]">
            <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-green) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 25%, transparent)' }}>
              <div className="font-semibold text-[var(--c-green)] mb-1">Frozen identity</div>
              <p className="text-white/45 leading-snug">The same published printing remains the same card wherever it appears in the collection.</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-green) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 25%, transparent)' }}>
              <div className="font-semibold text-[var(--c-green)] mb-1">Separate ownership</div>
              <p className="text-white/45 leading-snug">Quantity and display choices belong to your owned copies, never to the printed definition.</p>
            </div>
          </div>
        </SectionBody>
      </Section>

      <Section title="Booster ecosystem" icon={Package} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <div className="grid grid-cols-2 gap-3 text-[16px]">
            <div className="p-4 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[18px] font-bold text-[var(--c-accent-text)]">Permanent Vault Booster</span>
              </div>
              <p className="text-white/50 leading-snug">The permanent pool: 10 cards drawn from the published Foundation catalogue with an SR-or-higher guarantee.</p>
            </div>
            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,136,0,0.08)', border: '0.5px solid rgba(255,136,0,0.3)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[18px] font-bold text-[#ffb347]">Release packs</span>
              </div>
              <p className="text-white/50 leading-snug">Standard packs contain 6 cards with an SR-or-higher slot. Premium packs contain 4 cards with a UR guarantee. Both draw from a named release checklist.</p>
            </div>
          </div>
        </SectionBody>
      </Section>

      <Section title="Dynamic monthly releases" icon={Calendar} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">
            Monthly releases scale with the published Foundation <strong className="text-white/75">base-card count</strong>, not with the number of SPR parallels. The target and economy modifier are frozen into the release when it is drafted, so a later library scan cannot silently change an existing release.
          </p>
          <div className="rounded-lg overflow-hidden mb-4" style={{ border: '0.5px solid rgba(255,255,255,0.07)' }}>
            <table className="w-full text-[16px]">
              <thead><tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium">Published base collection</th>
                <th className="text-right px-4 py-2.5 text-white/40 font-medium">Monthly base cards</th>
                <th className="text-right px-4 py-2.5 text-white/40 font-medium">Economy modifier</th>
              </tr></thead>
              <tbody>
                {[
                  ['Under 10,000', '120 minimum', '0.19× or lower'],
                  ['10,000', '300', '0.48×'],
                  ['30,000', '460', '0.74×'],
                  ['60,000', '620', '1.00×'],
                  ['100,000', '800', '1.29×'],
                  ['160,000+', '1,000 cap', '1.61× or higher'],
                ].map(([size, target, modifier], i) => (
                  <tr key={size} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td className="px-4 py-2 text-white/70">{size}</td>
                    <td className="px-4 py-2 text-right font-mono text-white/70">{target}</td>
                    <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--c-pink-text)' }}>{modifier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[16px] text-white/45 leading-snug">The modifier also scales future monthly pack prices in 25-Credit steps. At the 1.00× reference, Standard is 550 Credits regular / 700 launch and Premium is 1,000 regular / 1,250 launch. Published prices are frozen with the release; September's existing products are not rewritten.</p>
        </SectionBody>
      </Section>

      <Section title="Pack opening, copies & binders" icon={Archive} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <div className="space-y-3 text-[16px] text-white/55">
            <p>Opening a booster creates an acquisition record and durable physical-copy identity for each card. The published card definition stays frozen; duplicate pulls become additional owned copies rather than a different card.</p>
            <p>Binders, cabinets, display stands, and physical placements refer to owned copies. Collection filters, release checklists, provenance, and the approved card renderers remain authoritative in the ordinary Card Collection workspace.</p>
            <p>Pack odds are independent of the card's personal-value evidence. Engagement can decide which real sources deserve a printing or an SPR, but opening a pack does not rewrite a card's rarity or artwork.</p>
            <p>Legacy cards from before TCG V2 are preserved as Legacy and kept outside current rarity/type categories unless you explicitly enable the Legacy scope.</p>
          </div>
        </SectionBody>
      </Section>

      <Section title="Currencies and rewards" icon={WalletCards} defaultOpen={false} accentColor="#FFD700">
        <SectionBody>
          <div className="space-y-2.5 text-[17px]">
            {[
              { name: 'Vault Credits', color: '#FFD700', desc: 'The recurring pack currency earned through sessions, cums, curation, ratings, tags, imports, logins, spins, quests, and milestones. Bulk file imports do not create an infinite faucet.' },
              { name: 'Pack tokens',   color: 'var(--c-accent)', desc: 'Quest and event rewards that redeem a specific persisted pack product without inventing new cards. Daily and weekly completion rewards use this route.' },
              { name: 'Forge materials', color: 'var(--c-green)', desc: 'Shards, catalyst tokens, and CXP support dismantling, fusing, and evolution. Dismantling is a material sink, not a second credit faucet.' },
              { name: 'Bond rewards',  color: 'var(--c-pink)', desc: 'Bond and Hall of Fame cards are earned from real persisted activity and remain distinct from ordinary booster pulls.' },
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

      <Section title="Releases and publication" icon={Hammer} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <div className="space-y-3 text-[17px]">
            {[
              { action: 'Prepare', color: 'var(--c-pink)',  desc: 'The publication pipeline selects real sources, artwork, metadata, and rarity candidates from the Vault.' },
              { action: 'Validate', color: '#9F8FEF', desc: 'A release fails closed when its checklist, numbering, artwork, or required metadata cannot be supported honestly.' },
              { action: 'Publish', color: 'var(--c-amber)', desc: 'Once published, a card definition is immutable and becomes eligible for its recorded pack pools.' },
              { action: 'Reprint', color: '#ff5db1', desc: 'A reprint is a new card definition that explicitly reuses an earlier source; it does not silently alter the original.' },
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

function CollectionRoomContent() {
  return (
    <div className="space-y-3">
      <Section title="What the Collection Room is" icon={Box} defaultOpen accentColor="var(--c-amber)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">
            Collection Room is an optional first-person home for the TCG layer. It gives your cards a physical place to live: shelves, cabinets, binders, posters, stands, parcels, and furniture. The ordinary Card Collection remains authoritative; the room is its tactile display space.
          </p>
          <div className="grid grid-cols-2 gap-2 text-[16px]">
            {[
              ['I inventory', 'Press I to open the persistent inventory. Place exact owned furniture instances, inspect held items, and open collected parcels or earned booster tokens.'],
              ['In-room PC', 'Use the room computer to browse Booster Packs and place orders. The room treats ordering, delivery, collection, and opening as separate states.'],
              ['Physical copies', 'A displayed card is an owned physical copy. Moving a display item changes its room placement, not the card definition or its collection history.'],
              ['Safe persistence', 'Room layouts, furniture instances, parcels, and display assignments are persisted with revision-safe updates and undo/redo support.'],
            ].map(([label, desc]) => (
              <div key={label} className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-amber) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 22%, transparent)' }}>
                <div className="text-[17px] font-semibold text-white/80 mb-1">{label}</div>
                <p className="text-white/45 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="The parcel-to-card flow" icon={Package} defaultOpen={false} accentColor="var(--c-accent)">
        <SectionBody>
          <div className="space-y-2.5 text-[16px]">
            {[
              ['Order', 'Choose a published booster through the room computer or the normal collection shop. The order reserves its product and contents.'],
              ['Wait for delivery', 'The pack arrives as a delayed parcel. It is not opened at the moment of purchase.'],
              ['Collect and place', 'Use the I inventory to collect the parcel, carry it into the room, and place it where you want it.'],
              ['Open authoritatively', 'Open the parcel through the same persisted pack-opening and card-resolution path used by the main collection workspace.'],
              ['Display or bind', 'Place the resulting physical copies on stands, in cabinets, or in binders. The copy ledger prevents duplicate openings and preserves ownership.'],
            ].map(([label, desc], index) => (
              <div key={label} className="flex gap-3 items-start">
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[16px] font-bold" style={{ background: 'color-mix(in srgb, var(--c-accent) 22%, transparent)', color: 'var(--c-accent)' }}>{index + 1}</div>
                <p className="text-white/55 leading-snug"><strong className="text-white/75">{label}:</strong> {desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Placement rules" icon={Layers3} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <div className="space-y-2.5 text-[16px] text-white/55">
            <p><strong className="text-white/75">Floor furniture</strong> can be placed freely on the authored walkable floor and moved or rotated later.</p>
            <p><strong className="text-white/75">Wall shelves and posters</strong> are wall-only. The placement preview uses the actual authored wall faces rather than treating the whole room as a loose rectangle.</p>
            <p><strong className="text-white/75">Card stands</strong> belong inside authored shelf levels. Cards displayed in cabinets follow their parent shelf when it moves or rotates.</p>
            <p><strong className="text-white/75">Context actions</strong> stay attached to the live preview: Place, Return, Rotate, and Deselect. Right-click is reserved for deselecting rather than accidentally selecting another object.</p>
          </div>
        </SectionBody>
      </Section>

      <Section title="Module and display safety" icon={Settings} defaultOpen={false} accentColor="rgba(255,255,255,0.45)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed">
            The room is an optional downloadable module. Its installer can resume downloads, verify integrity, repair a damaged version, update it, cancel safely, and uninstall only the room module without deleting your collection. If the room is unavailable, your cards, binders, releases, and physical-copy ledger remain usable in the main TCG workspace.
          </p>
        </SectionBody>
      </Section>
    </div>
  )
}

function SettingsContent() {
  return (
    <div className="space-y-3">
      <Section title="Settings at a glance" icon={Settings} defaultOpen accentColor="var(--c-accent)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed mb-4">Settings is organized by the kind of thing it changes. The important distinction is between library paths, behavior preferences, and destructive maintenance.</p>
          <div className="grid grid-cols-2 gap-2 text-[16px]">
            {[
              ['Library', 'Roots, missing-folder resolution, creator-folder synchronization, and the configured data locations.'],
              ['Scanner', 'Hidden/system-file policy, thumbnail generation, video-length repair, archive behavior, and the central funscript library.'],
              ['AI Tagging', 'Download/check local models, choose WD14/JoyTag, set confidence thresholds, pause/resume runs, and inspect progress.'],
              ['Appearance', 'Theme palette, typography, animation/effects, Vault identity, and companion presentation.'],
              ['Session', 'End-session climax behavior, edge preferences, and Session History corrections.'],
              ['Hotkeys', 'Rebind global and viewer shortcuts, choose arrow-key behavior, and set normal/long seek distances.'],
              ['Backup', 'Download a database backup, restore a selected .db after an automatic safety backup, or change storage location.'],
              ['System', 'Connect a mobile device, check updates, read the in-app changelog, restart the server, or perform a factory reset.'],
            ].map(([label, desc]) => (
              <div key={label} className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                <div className="text-[17px] font-semibold text-white/80 mb-1">{label}</div>
                <p className="text-white/45 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </SectionBody>
      </Section>

      <Section title="Scanning and video compatibility" icon={ScanLine} defaultOpen={false} accentColor="var(--c-green)">
        <SectionBody>
          <div className="space-y-2.5 text-[16px] text-white/55">
            <p>Scans ignore hidden/system files and metadata folders by default. The Scanner setting can include them when a library needs that behavior.</p>
            <p>Video durations are recorded during new scans. Read video lengths is a resumable repair action for older imports, and unknown durations stay visibly unknown instead of being guessed.</p>
            <p>Funscripts can stay beside videos or be centralized in a configured library. Matching uses the video's filename and permanent links survive future playback.</p>
            <p>When Chromium cannot play a VLC/FFmpeg-compatible file directly, The Vault can create a cached browser-compatible playback copy while preserving the original media.</p>
          </div>
        </SectionBody>
      </Section>

      <Section title="Backup, restore & destructive actions" icon={AlertTriangle} defaultOpen={false} accentColor="var(--c-pink)">
        <SectionBody>
          <div className="space-y-2.5 text-[16px] text-white/55">
            <p>Use Backup before a large repair or economy/catalogue operation. Restore replaces the current database only after you choose a backup file, and the current database is saved automatically first.</p>
            <p>Changing the data location moves future database/thumb storage; the fixed configuration file remains the anchor so the app can find the setting again.</p>
            <p>Factory reset is different from restore: it wipes the collection and should be treated as irreversible. It does not mean “clear the current filters” or “re-scan the library.”</p>
          </div>
        </SectionBody>
      </Section>

      <Section title="Themes and semantic colours" icon={Sparkles} defaultOpen={false} accentColor="var(--c-amber)">
        <SectionBody>
          <p className="text-[17px] text-white/55 leading-relaxed">
            Theme palettes recolour the interface, surfaces, controls, and charts. Some colours intentionally remain semantic: rarity, AI-versus-manual tag source, and device status keep their meaning when the palette changes. This is why a rarity badge may stay gold or a connected device may stay green in every theme.
          </p>
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
              { icon: Radio, name: 'The Handy',        color: 'var(--c-green)', desc: 'Connects via The Handy REST API v3 (HSP streaming protocol). Requires a Connection Key from the Handy app, a free Developer API Key from user.handyfeeling.com, and firmware 4+ (an original Handy 1 works fine once updated). No Intiface needed — cloud relay handles it.' },
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
            <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-amber) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 20%, transparent)' }}>
              <div className="font-semibold text-[var(--c-amber)] mb-1">Ramp Mode</div>
              <p className="text-white/55">Smoothly interpolates between a Start Pattern and an End Pattern over a set duration (1–120 min). Great for gradual escalation during a session. Mutually exclusive with the scheduler.</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 20%, transparent)' }}>
              <div className="font-semibold text-[var(--c-accent)] mb-1">Pattern Scheduler</div>
              <p className="text-white/55">Queue a sequence of patterns, each with a duration. The device cycles through them in order when Freestyle is active. Supports looping or play-once mode.</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-pink) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 20%, transparent)' }}>
              <div className="font-semibold text-[var(--c-pink)] mb-1">Edge Mode</div>
              <p className="text-white/55">Arm it and the device cuts out — or slows to a set percentage — at random (or fixed) intervals, holds for a random (or fixed) stretch, then eases back. Works in Freestyle and during funscript playback, and can be toggled from the device panel in any viewer or by hotkey. Every edge adds +1 to the edge count of whatever is on screen.</p>
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
    { tier: 'Friend',       xp: 500,   color: 'var(--c-green)', desc: 'Real warmth and easy conversation. Light flirting and suggestive topics are fine.' },
    { tier: 'Crush',        xp: 1500,  color: '#4682DC', desc: 'Unmistakable attraction. Explicit topics welcome when the mood calls for it.' },
    { tier: 'Waifu',        xp: 4000,  color: '#9F8FEF', desc: 'Deep intimacy. Completely open, genuinely devoted.' },
    { tier: 'Soulbound',    xp: 10000, color: '#FFD700', desc: 'Total bond. No limits, no distance — she belongs to you and you to her.' },
  ]
  const PERSONALITIES = [
    { name: 'Warm',     color: 'var(--c-pink-text)', desc: 'Nurturing and emotionally present. She cares, checks in, and responds with genuine warmth.' },
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
              { icon: Heart,        color: 'var(--c-pink-text)',         label: 'Bond system',     desc: 'She remembers you and grows closer as you talk. 5 relationship tiers.' },
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
                   style={{ background: 'color-mix(in srgb, var(--c-green) 25%, transparent)', color: 'var(--c-green)' }}>1</div>
              <div>
                <div className="text-[18px] font-semibold text-white/80 mb-0.5">Download Ollama</div>
                <p className="text-[16px] text-white/50 leading-snug">Go to <span className="font-mono text-[16px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--c-green)' }}>https://ollama.com</span> and download the Windows installer. Run it — Ollama installs as a background service and starts automatically.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[16px] font-bold"
                   style={{ background: 'color-mix(in srgb, var(--c-green) 25%, transparent)', color: 'var(--c-green)' }}>2</div>
              <div>
                <div className="text-[18px] font-semibold text-white/80 mb-0.5">Verify it's running</div>
                <p className="text-[16px] text-white/50 leading-snug mb-2">Open a Command Prompt or PowerShell and run:</p>
                <code className="block px-3 py-2 rounded-lg text-[16px] font-mono" style={{ background: 'rgba(0,0,0,0.4)', color: '#7DD3A8', border: '0.5px solid rgba(255,255,255,0.08)' }}>ollama list</code>
                <p className="text-[16px] text-white/40 mt-2 leading-snug">You should see a table (even if empty). If you get "command not found", restart your terminal or reboot.</p>
              </div>
            </div>
            <div className="p-3 rounded-lg flex gap-2 text-[16px]"
                 style={{ background: 'color-mix(in srgb, var(--c-green) 7%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 20%, transparent)' }}>
              <Info size={14} style={{ color: 'var(--c-green)' }} className="flex-shrink-0 mt-0.5" />
              <span className="text-white/50">Ollama listens on <span className="font-mono text-[16px] text-white/70">http://localhost:11434</span> by default. The Vault uses this address to talk to it — no extra configuration needed unless you changed the port.</span>
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
          <code className="block px-4 py-3 rounded-lg text-[16px] font-mono mb-4 leading-relaxed break-all"
                style={{ background: 'rgba(0,0,0,0.4)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
            ollama pull hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Balanced:IQ4_XS
          </code>
          <p className="text-[16px] text-white/40 mb-4">This is ~15 GB. It will take a few minutes depending on your connection. Ollama shows download progress in the terminal.</p>

          <div className="mb-4 p-3 rounded-lg flex gap-2"
               style={{ background: 'color-mix(in srgb, var(--c-amber) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 25%, transparent)' }}>
            <AlertTriangle size={16} style={{ color: 'var(--c-amber)' }} className="flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[16px] font-semibold text-white/75 mb-1">Troubleshooting a Hugging Face redirect error</div>
              <p className="text-[16px] text-white/50 leading-snug mb-2">If Ollama reports a redirect or download error while fetching this model, update Ollama and retry the normal command above first. As a temporary workaround, run:</p>
              <code className="block px-3 py-2 rounded-lg text-[16px] font-mono leading-relaxed break-all"
                    style={{ background: 'rgba(0,0,0,0.4)', color: 'var(--c-amber)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                ollama pull --insecure hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Balanced:IQ4_XS
              </code>
              <p className="text-[16px] text-white/40 mt-2 leading-snug">This flag relaxes download security checks to work around the redirect. Use it only with the trusted <span className="font-mono text-[16px] text-white/60">hf.co</span> model address above, then prefer the normal command again after Ollama is updated.</p>
            </div>
          </div>

          <div className="text-[17px] font-semibold text-white/60 mb-2">Lighter alternatives (lower VRAM)</div>
          <div className="space-y-2">
            {[
              { model: 'hf.co/mradermacher/Mistral-Nemo-Instruct-2407-abliterated-GGUF:Q5_K_M', vram: '~9 GB', note: '12B uncensored — good balance of quality and speed' },
              { model: 'hf.co/bartowski/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M',   vram: '~6 GB', note: '8B uncensored — fast, works on most gaming GPUs' },
            ].map(({ model, vram, note }) => (
              <div key={model} className="px-3 py-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
                <code className="text-[16px] font-mono text-white/60 break-all">{model}</code>
                <div className="flex gap-3 mt-1">
                  <span className="text-[16px] font-semibold" style={{ color: 'var(--c-amber)' }}>{vram}</span>
                  <span className="text-[16px] text-white/40">{note}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 p-3 rounded-lg flex gap-2 text-[16px]"
               style={{ background: 'color-mix(in srgb, var(--c-pink) 7%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 20%, transparent)' }}>
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
                     style={{ background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)', color: 'var(--c-accent)' }}>{n}</div>
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
                  <div className="text-[16px] text-white/35 font-mono">{xp.toLocaleString()} XP</div>
                </div>
                <p className="text-[16px] text-white/55 leading-snug mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[16px] text-white/30">Bond XP accumulates naturally through conversation. There is no shortcut to skip tiers — the progression is intentional.</p>
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
// ── Hotkeys ───────────────────────────────────────────────────────────────────
// Rendered from the live registry and the user's own bindings, so this page can
// never go stale against Settings → Hotkeys — there is nothing here to update
// when an action is added.
function HotkeysContent() {
  const hotkeys = useVaultStore(s => s.hotkeys)
  const { seekStep, seekStepBig } = useVaultStore(s => s.hotkeySettings)

  const byGroup = useMemo(() => {
    const out = {}
    for (const a of HOTKEY_ACTIONS) (out[a.group] ||= []).push(a)
    return out
  }, [])

  return (
    <>
      <Section title="How the two kinds of shortcut differ" icon={Keyboard} defaultOpen accentColor="var(--c-accent)">
        <SectionBody>
          <p className="text-white/55">
            <b>Anywhere</b> shortcuts work on any page and use modifier combos so they never collide with typing.
            <b> Viewer</b> shortcuts are bare keys — they only exist while a viewer or the panel wall is open, and they
            win over an anywhere-shortcut on the same key. Nothing fires while you are typing in a box, with the single
            exception of Emergency stop.
          </p>
          <p className="mt-3 text-white/55">
            On the panel wall, <b>click a panel to pin it</b>. The pinned panel gets an accent ring, and it is what the
            viewer keys — including the number-key ratings — act on. The <b>wall</b> keys ignore the pin and drive every
            panel at once.
          </p>
          <p className="mt-3 text-[16px] text-white/30">
            Every binding below is yours to change in Settings → Hotkeys. Seek currently moves {seekStep}s,
            long seek {seekStepBig}s.
          </p>
        </SectionBody>
      </Section>

      {HOTKEY_GROUPS.map(group => {
        const actions = byGroup[group.name] ?? []
        if (!actions.length) return null
        return (
          <Section key={group.name}
                   title={`${group.name} — ${group.scope === SCOPE_VIEWER ? 'viewers only' : 'anywhere'}`}
                   icon={Keyboard}
                   defaultOpen={group.name === 'Viewer'}
                   accentColor={group.scope === SCOPE_VIEWER ? 'var(--c-accent)' : 'var(--c-amber)'}>
            <SectionBody>
              <p className="text-white/40 mb-3">{group.blurb}</p>
              <div className="flex flex-col gap-1.5">
                {actions.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-4 py-1.5"
                       style={{ borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
                    <div className="min-w-0">
                      <div className="text-[16px] text-white/70">{a.label}</div>
                      <div className="text-[16px] text-white/30">{a.hint}</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-[6px] text-[16px] font-mono flex-shrink-0"
                          style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '0.5px solid rgba(255,255,255,0.1)',
                            color: hotkeys[a.id] ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.25)',
                          }}>
                      {bindingToDisplay(hotkeys[a.id])}
                    </span>
                  </div>
                ))}
              </div>
            </SectionBody>
          </Section>
        )
      })}
    </>
  )
}

const TABS = [
  { id: 'overview',  label: 'Overview',     icon: BookOpen   },
  { id: 'nav',       label: 'Navigation',   icon: Map        },
  { id: 'library',   label: 'Library',      icon: FolderOpen },
  { id: 'stats',     label: 'Stats',        icon: BarChart2  },
  { id: 'gami',      label: 'Gamification', icon: Zap        },
  { id: 'quests',    label: 'Quests',       icon: Trophy     },
  { id: 'achieve',   label: 'Achievements', icon: Star       },
  { id: 'cards',     label: 'Cards',        icon: WalletCards },
  { id: 'room',      label: 'Collection Room', icon: Box      },
  { id: 'settings',  label: 'Settings',     icon: Settings   },
  { id: 'devices',   label: 'Devices',      icon: Cpu        },
  { id: 'hotkeys',   label: 'Hotkeys',      icon: Keyboard   },
  { id: 'erika',     label: 'Erika',        icon: Bot        },
]

export default function Help() {
  const [activeTab, setActiveTab] = useState('overview')
  const [search, setSearch]       = useState('')

  const content = useMemo(() => {
    switch (activeTab) {
      case 'overview':  return <OverviewContent search={search} />
      case 'nav':       return <NavContent />
      case 'library':   return <LibraryContent />
      case 'stats':     return <StatsContent />
      case 'gami':      return <GamificationContent />
      case 'quests':    return <QuestsContent />
      case 'achieve':   return <AchievementsContent />
      case 'cards':     return <CardsContent />
      case 'room':      return <CollectionRoomContent />
      case 'settings':  return <SettingsContent />
      case 'devices':   return <DevicesContent />
      case 'hotkeys':   return <HotkeysContent />
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
                   style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
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
                  ? { background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }
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
