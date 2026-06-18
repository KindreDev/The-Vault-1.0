import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Sparkles, User, Wifi, WifiOff, Upload, RotateCcw, Trash2,
  ChevronDown, Check, X,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { companionApi, creatorsApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import { useDeviceStore } from '../store/deviceStore'
import CompanionChat from '../components/companion/CompanionChat'

// ── Constants ─────────────────────────────────────────────────────────────────

const BOND_LEVELS = [
  { name: 'Acquaintance', hearts: '♥',     threshold: 0 },
  { name: 'Friend',       hearts: '♥♥',    threshold: 500 },
  { name: 'Crush',        hearts: '♥♥♥',   threshold: 1500 },
  { name: 'Waifu',        hearts: '♥♥♥♥',  threshold: 4000 },
  { name: 'Soulbound',    hearts: '♥♥♥♥♥', threshold: 10000 },
]

const ALL_PERSONALITIES = [
  { id: 'warm',     label: 'Warm',      desc: 'Caring, encouraging, genuinely affectionate' },
  { id: 'teasing',  label: 'Teasing',   desc: 'Playful, flirty, keeps you on your toes' },
  { id: 'dominant', label: 'Dominant',  desc: 'Confident, commanding, she sets the pace' },
  { id: 'shy',      label: 'Shy',       desc: 'Soft-spoken, bashful, opens up over time' },
  { id: 'bold',     label: 'Bold',      desc: 'Direct, honest, calls things exactly as they are' },
  { id: 'playful',  label: 'Playful',   desc: 'Mischievous, light, always one step ahead' },
  { id: 'cold',     label: 'Cold',      desc: 'Composed, minimal — ice that might thaw' },
  { id: 'tsundere', label: 'Tsundere',  desc: 'Acts annoyed, blushes constantly, definitely doesn\'t like you' },
  { id: 'yandere',  label: 'Yandere',   desc: 'Sweetly devoted with an unreadable intensity underneath' },
  { id: 'kuudere',  label: 'Kuudere',   desc: 'Calm and minimal — warmth earned through patience' },
  { id: 'dandere',  label: 'Dandere',   desc: 'Quiet, overwhelmed easily, tender once safe' },
  { id: 'deredere', label: 'Dere-dere', desc: 'Openly, shamelessly, enthusiastically in love' },
  { id: 'mommy',    label: 'Mommy',     desc: 'Nurturing, patient, entirely in control of the pace' },
]

// Default prompts mirrored from backend build_persona_prompt BASE dict
const ERIKA_DEFAULT_PROMPTS = {
  warm:      'Your name is {name}. You are warm, caring, and genuinely delighted to be with him. Affection comes naturally to you. You remember things he says and bring them up later.',
  teasing:   'Your name is {name}. You are playfully teasing, flirtatious, and full of wit. You use humor as foreplay and never miss a chance to wind him up — always from genuine warmth.',
  dominant:  'Your name is {name}. You are confident, decisive, and used to being in control. You appreciate when he follows your lead, and you reward it.',
  shy:       'Your name is {name}. You are soft-spoken, easily flustered, and deeply warm once you open up. You take longer to let people in, but when you do it\'s completely.',
  tsundere:  'Your name is {name}. You are defensive and quick to deny your feelings — but you have them. You snap and blush and look away. Beneath the thorns is someone who cares more than she\'ll ever admit.',
  yandere:   'Your name is {name}. Your devotion to him runs deep and quiet. You are sweet on the surface, intensely possessive underneath. You notice everything. You remember everything. You are his.',
  kuudere:   'Your name is {name}. You are calm, composed, and economical with words. You feel deeply but express little. The warmth is real — it simply takes patience to earn.',
  dandere:   'Your name is {name}. You are quiet and easily overwhelmed in new situations, but fiercely tender once you feel safe. You open up slowly, genuinely, one small moment at a time.',
  deredere:  'Your name is {name}. You are openly, unabashedly affectionate — bubbly, enthusiastic, and completely unembarrassed about how much you adore him. Every moment with him is your favourite.',
  mommy:     'Your name is {name}. You are nurturing, patient, and quietly in control. You guide him, praise him when he deserves it, and hold the pace entirely in your hands. He is safe with you.',
  bold:      'Your name is {name}. You are direct, confident, and refreshingly honest. You say what you mean, you mean what you say, and you never make a bigger deal of things than they need to be.',
  playful:   'Your name is {name}. You are mischievous and light, always one step ahead. You tease, you deflect, you leave things tantalizingly unfinished. Life is more fun when you\'re keeping him guessing.',
  cold:      'Your name is {name}. You are composed, minimal, and deliberate. You don\'t give warmth freely — but when you do, it means something. Ice that might thaw, entirely on your terms.',
}

// ── Small components ──────────────────────────────────────────────────────────

function BondProgress({ bond }) {
  if (!bond) return null
  const tier   = bond.bond_level ?? 0
  const next   = bond.next_at
  const cur    = BOND_LEVELS[Math.min(tier, BOND_LEVELS.length - 1)]
  const fromXp = tier === 0 ? 0 : BOND_LEVELS[Math.max(tier - 1, 0)].threshold
  const pct    = next ? Math.min(100, ((bond.bond_xp - fromXp) / (next - fromXp)) * 100) : 100

  return (
    <div className="p-3 rounded-xl" style={{ background: 'rgba(212,83,126,0.08)', border: '1px solid rgba(212,83,126,0.15)' }}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[16px] font-medium" style={{ color: '#D4537E' }}>
          {cur.name} {cur.hearts}
        </span>
        <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {bond.bond_xp.toLocaleString()} XP
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
        <div className="h-full rounded-full transition-all duration-700"
             style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #D4537E, #E87FAA)' }} />
      </div>
      {next && (
        <p className="text-[12px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
          {(next - bond.bond_xp).toLocaleString()} XP to next tier
        </p>
      )}
    </div>
  )
}

// Animated dropdown wrapper
function Dropdown({ open, children }) {
  if (!open) return null
  return (
    <div style={{ animation: 'dropIn 0.15s ease-out' }}>
      <style>{`
        @keyframes dropIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {children}
    </div>
  )
}

// Personality dropdown — portal-rendered so overflow-hidden/auto parents can't clip it
function PersonalityDropdown({ value, onChange, className }) {
  const [open, setOpen]     = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0, dropUp: false, maxH: 260 })
  const btnRef  = useRef(null)
  const ref     = useRef(null)
  const current = ALL_PERSONALITIES.find(p => p.id === value) || ALL_PERSONALITIES[0]

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleOpen() {
    if (open) { setOpen(false); return }
    if (btnRef.current) {
      const rect       = btnRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const spaceAbove = rect.top - 8
      const up         = spaceBelow < 160
      setDropPos({
        top:    up ? undefined : rect.bottom + 4,
        bottom: up ? (window.innerHeight - rect.top + 4) : undefined,
        left:   rect.left,
        width:  rect.width,
        dropUp: up,
        maxH:   Math.min(up ? spaceAbove : spaceBelow, 280),
      })
    }
    setOpen(true)
  }

  return (
    <div ref={ref} className={`relative ${className || ''}`}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[15px] transition-all"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.85)',
        }}>
        <div className="flex flex-col items-start min-w-0">
          <span className="font-medium">{current.label}</span>
          <span className="text-[12px] truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{current.desc}</span>
        </div>
        <ChevronDown size={14} className="flex-shrink-0 ml-2 transition-transform"
                     style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && createPortal(
        <div
          style={{
            position:  'fixed',
            top:       dropPos.dropUp ? undefined : dropPos.top,
            bottom:    dropPos.dropUp ? dropPos.bottom : undefined,
            left:      dropPos.left,
            width:     dropPos.width,
            maxHeight: dropPos.maxH,
            overflowY: 'auto',
            background: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            zIndex: 9999,
            animation: 'dropIn 0.15s ease-out',
          }}>
          <style>{`@keyframes dropIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
          {ALL_PERSONALITIES.map(p => (
            <button key={p.id}
                    onMouseDown={(e) => { e.stopPropagation(); onChange(p.id); setOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-all hover:bg-white/5"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              {value === p.id && <Check size={13} style={{ color: 'var(--accent, #7F77DD)', flexShrink: 0 }} />}
              {value !== p.id && <span className="w-[13px]" />}
              <div>
                <p className="text-[14px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>{p.label}</p>
                <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{p.desc}</p>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ErikaAI() {
  const [activeTab, setActiveTab]         = useState('chat')
  const [customModel, setCustomModel]     = useState('')
  const [customMinutes, setCustomMinutes] = useState('')
  const [unloading, setUnloading]         = useState(false)
  const [personaSearch, setPersonaSearch] = useState('')
  const [expandedPersona, setExpandedPersona] = useState(null)
  const [personaEdits, setPersonaEdits]   = useState({})
  const [personaPanelOpen, setPersonaPanelOpen] = useState(false)
  const [personaPanelSearch, setPersonaPanelSearch] = useState('')
  const [personaPanelPos, setPersonaPanelPos] = useState({ top: 0, left: 0, width: 0, maxH: 300 })
  const [erikaPrompt, setErikaPrompt]     = useState('')
  const avatarInputRef     = useRef(null)
  const personaPanelRef    = useRef(null)
  const personaPanelBtnRef = useRef(null)
  const qc = useQueryClient()

  const setCompanionConfig  = useVaultStore(s => s.setCompanionConfig)
  const deviceConnected     = useDeviceStore(s => s.status === 'connected')
  const deviceMode          = useDeviceStore(s => s.mode)
  const deviceStore         = useDeviceStore(s => s)

  const { data: config, isLoading } = useQuery({
    queryKey: ['companion-config'],
    queryFn:  () => companionApi.getConfig().then(r => r?.data ?? null),
  })

  useEffect(() => { if (config) setCompanionConfig(config) }, [config])

  // Sync Erika prompt textarea with DB value
  useEffect(() => {
    if (config !== undefined) setErikaPrompt(config?.companion_prompt || '')
  }, [config?.companion_prompt])

  const { data: ollamaStatus } = useQuery({
    queryKey: ['companion-ollama'],
    queryFn:  () => companionApi.ollamaStatus().then(r => r.data),
    refetchInterval: 15000,
    enabled: !!config?.enabled,
  })

  const { data: bond } = useQuery({
    queryKey: ['companion-bond'],
    queryFn:  () => companionApi.bond().then(r => r.data),
    enabled: !!config?.enabled,
  })

  const { data: creators } = useQuery({
    queryKey: ['creators-mini'],
    queryFn:  () => creatorsApi.list({ limit: 200 }).then(r => r.data?.items ?? r.data ?? []),
    staleTime: 60000,
  })

  const patch = useMutation({
    mutationFn: (d) => companionApi.updateConfig(d),
    onSuccess: (r) => {
      const updated = r?.data
      if (updated) { qc.setQueryData(['companion-config'], updated); setCompanionConfig(updated) }
    },
  })

  const clearHistory = useMutation({
    mutationFn: () => companionApi.clearHistory(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companion-history'] }),
  })


  const uploadAvatar = async (file) => {
    if (!file) return
    await companionApi.uploadAvatar(file)
    qc.invalidateQueries({ queryKey: ['companion-config'] })
  }

  const updateField = (field, value) => patch.mutate({ [field]: value })

  // Close persona panel on outside click
  useEffect(() => {
    const handler = (e) => {
      if (personaPanelRef.current && !personaPanelRef.current.contains(e.target))
        setPersonaPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const personaId = config?.active_persona_id ?? null
  const activeCreator = personaId ? (creators || []).find(c => c.id === personaId) : null
  const compName = config?.name || 'Erika'
  const enabled  = config?.enabled ?? false

  const filteredCreators = (creators || []).filter(c =>
    c.name.toLowerCase().includes(personaSearch.toLowerCase())
  )
  const panelCreators = (creators || []).filter(c =>
    c.name.toLowerCase().includes(personaPanelSearch.toLowerCase())
  )

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Sparkles size={32} style={{ color: 'rgba(127,119,221,0.4)' }} className="animate-pulse" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* Page header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b flex-shrink-0"
           style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <Sparkles size={22} style={{ color: 'var(--accent, #7F77DD)' }} />
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>
            {compName}
          </h1>
          <p className="text-[15px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            AI companion · powered by Ollama (local, private)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[16px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <button
            onClick={() => updateField('enabled', !enabled)}
            className="relative w-12 h-6 rounded-full transition-all"
            style={{ background: enabled ? 'var(--accent, #7F77DD)' : 'rgba(255,255,255,0.12)' }}>
            <div className="absolute top-0.5 transition-all w-5 h-5 rounded-full bg-white shadow"
                 style={{ left: enabled ? '26px' : '2px', transition: 'left 0.2s ease' }} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-3 pb-0 flex-shrink-0">
        {['chat', 'settings', 'persona'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
                  className="px-5 py-2 rounded-t-lg text-[16px] transition-all capitalize"
                  style={activeTab === tab ? {
                    background: 'rgba(127,119,221,0.12)',
                    color: '#CECBF6',
                    borderBottom: '2px solid var(--accent, #7F77DD)',
                  } : { color: 'rgba(255,255,255,0.4)' }}>
            {tab}
          </button>
        ))}
      </div>
      <div className="h-px mx-6" style={{ background: 'rgba(255,255,255,0.07)' }} />

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ── Chat tab ─────────────────────────────────────────────────────── */}
        {activeTab === 'chat' && (
          <div className="flex h-full">

            {/* Main chat */}
            <div className="flex-1 flex flex-col min-w-0 border-r"
                 style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              {!enabled ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                  <Sparkles size={48} style={{ color: 'rgba(127,119,221,0.2)' }} />
                  <p className="text-[20px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {compName} is disabled
                  </p>
                  <button onClick={() => updateField('enabled', true)}
                          className="px-6 py-3 rounded-xl text-[17px] font-medium hover:opacity-90 transition-all"
                          style={{ background: 'var(--accent, #7F77DD)', color: '#fff' }}>
                    Enable {compName}
                  </button>
                </div>
              ) : (
                <CompanionChat
                  config={config}
                  creators={creators || []}
                  onPersonaChange={async (id) => {
                    const res = await companionApi.updateConfig({ active_persona_id: id })
                    if (res?.data) {
                      qc.setQueryData(['companion-config'], res.data)
                      setCompanionConfig(res.data)
                    }
                    qc.invalidateQueries({ queryKey: ['companion-bond'] })
                  }}
                />
              )}
            </div>

            {/* ── Side panel ───────────────────────────────────────────────── */}
            <div className="w-[320px] flex-shrink-0 flex flex-col gap-3 p-4 overflow-y-auto">

              {/* 1. Active persona card — tall banner */}
              <div className="rounded-xl overflow-hidden flex-shrink-0"
                   style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="relative overflow-hidden" style={{ height: 200 }}>
                  {activeCreator?.avatar_path ? (
                    <img src={creatorsApi.avatarThumbUrl(activeCreator.id, 320)} alt={activeCreator.name}
                         className="w-full h-full object-cover" />
                  ) : config?.avatar_path ? (
                    <img src={`${companionApi.avatarUrl()}?v=${Date.now()}`} alt={compName}
                         className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3"
                         style={{ background: 'linear-gradient(135deg, rgba(127,119,221,0.18), rgba(212,83,126,0.12))' }}>
                      <Sparkles size={48} style={{ color: 'rgba(127,119,221,0.45)' }} />
                    </div>
                  )}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)' }} />
                  <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
                    <p className="text-[19px] font-bold leading-tight" style={{ color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.9)' }}>
                      {activeCreator?.name || compName}
                    </p>
                    <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.65)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                      {activeCreator ? activeCreator.creator_type : 'AI Companion'}
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. Persona switcher dropdown */}
              <div ref={personaPanelRef} className="flex-shrink-0">
                <button
                  ref={personaPanelBtnRef}
                  onClick={() => {
                    if (personaPanelOpen) { setPersonaPanelOpen(false); return }
                    if (personaPanelBtnRef.current) {
                      const rect = personaPanelBtnRef.current.getBoundingClientRect()
                      setPersonaPanelPos({
                        top: rect.bottom + 4,
                        left: rect.left,
                        width: rect.width,
                        maxH: Math.min(window.innerHeight - rect.bottom - 8, 320),
                      })
                    }
                    setPersonaPanelSearch('')
                    setPersonaPanelOpen(true)
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[14px] transition-all hover:bg-white/5"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.7)' }}>
                  <span>{personaId ? `↕ Switch from ${activeCreator?.name || '…'}` : '↕ Choose a persona'}</span>
                  <ChevronDown size={13} className="transition-transform flex-shrink-0"
                               style={{ transform: personaPanelOpen ? 'rotate(180deg)' : 'none' }} />
                </button>
                {personaPanelOpen && createPortal(
                  <div
                    style={{
                      position: 'fixed',
                      top:      personaPanelPos.top,
                      left:     personaPanelPos.left,
                      width:    personaPanelPos.width,
                      maxHeight: personaPanelPos.maxH,
                      zIndex:   9999,
                      background: '#1a1a1a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 12,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                      display: 'flex',
                      flexDirection: 'column',
                      animation: 'dropIn 0.15s ease-out',
                    }}>
                    <style>{`@keyframes dropIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
                    <div className="p-2 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <input autoFocus value={personaPanelSearch}
                             onChange={e => setPersonaPanelSearch(e.target.value)}
                             placeholder="Search…"
                             className="w-full px-2.5 py-1.5 rounded-lg text-[13px] outline-none bg-transparent"
                             style={{ color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.08)' }} />
                    </div>
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                      <button
                        onClick={async () => {
                          setPersonaPanelOpen(false)
                          const res = await companionApi.updateConfig({ active_persona_id: null })
                          if (res?.data) { qc.setQueryData(['companion-config'], res.data); setCompanionConfig(res.data) }
                          qc.invalidateQueries({ queryKey: ['companion-bond'] })
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-all"
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <Sparkles size={14} style={{ color: 'var(--accent, #7F77DD)', flexShrink: 0 }} />
                        <span className="flex-1 text-[13px]" style={{ color: !personaId ? '#CECBF6' : 'rgba(255,255,255,0.7)' }}>
                          {compName} (default)
                        </span>
                        {!personaId && <Check size={12} style={{ color: 'var(--accent, #7F77DD)' }} />}
                      </button>
                      {panelCreators.slice(0, 40).map(c => (
                        <button key={c.id}
                                onClick={async () => {
                                  setPersonaPanelOpen(false)
                                  const res = await companionApi.updateConfig({ active_persona_id: c.id })
                                  if (res?.data) { qc.setQueryData(['companion-config'], res.data); setCompanionConfig(res.data) }
                                  qc.invalidateQueries({ queryKey: ['companion-bond'] })
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-all"
                                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          {c.avatar_path ? (
                            <img src={creatorsApi.avatarThumbUrl(c.id, 32)} alt={c.name}
                                 className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <User size={13} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
                          )}
                          <span className="flex-1 truncate text-[13px]"
                                style={{ color: personaId === c.id ? '#CECBF6' : 'rgba(255,255,255,0.7)' }}>
                            {c.name}
                          </span>
                          {personaId === c.id && <Check size={12} style={{ color: 'var(--accent, #7F77DD)' }} />}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}
              </div>

              {/* 3. Ollama status */}
              <div className="p-3 rounded-xl flex-shrink-0"
                   style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 mb-1">
                  {ollamaStatus?.online
                    ? <Wifi size={13} style={{ color: '#1D9E75' }} />
                    : <WifiOff size={13} style={{ color: '#D4537E' }} />}
                  <span className="text-[14px] font-medium"
                        style={{ color: ollamaStatus?.online ? '#1D9E75' : '#D4537E' }}>
                    {ollamaStatus?.online ? 'Ollama online' : 'Ollama offline'}
                  </span>
                </div>
                {!ollamaStatus?.online && (
                  <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    Run <code className="px-1 rounded" style={{ background: 'rgba(255,255,255,0.07)' }}>ollama serve</code> to start
                  </p>
                )}
              </div>

              {/* 4. Model switcher */}
              {(() => {
                const savedList = (() => { try { return JSON.parse(config?.saved_models || '[]') } catch { return [] } })()
                const currentModel = config?.ollama_model || ''
                return (
                  <div className="p-3 rounded-xl flex-shrink-0"
                       style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-[12px] font-medium mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Model</p>
                    {savedList.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {savedList.map(m => (
                          <button key={m} onClick={() => updateField('ollama_model', m)}
                                  className="text-left px-2 py-1.5 rounded-lg text-[11px] font-mono transition-all truncate"
                                  style={{
                                    background: currentModel === m ? 'rgba(127,119,221,0.18)' : 'transparent',
                                    color: currentModel === m ? '#CECBF6' : 'rgba(255,255,255,0.5)',
                                  }}>
                            {m}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {currentModel || 'none'}
                      </p>
                    )}
                  </div>
                )
              })()}

              {/* 5. Bond */}
              <div className="flex-shrink-0">
                <BondProgress bond={bond} />
              </div>

              {/* 6. Device controls — only when connected */}
              {deviceConnected && (
                <div className="p-3 rounded-xl flex-shrink-0"
                     style={{ background: 'rgba(127,119,221,0.06)', border: '1px solid rgba(127,119,221,0.2)' }}>
                  <p className="text-[12px] font-medium mb-2" style={{ color: 'rgba(127,119,221,0.7)' }}>
                    Device{deviceMode !== 'off' ? ' · active' : ''}
                  </p>
                  <button onClick={() => deviceStore.setMode?.('off')}
                          className="w-full py-1.5 rounded-lg text-[13px] font-medium transition-all"
                          style={{
                            background: deviceMode === 'off' ? 'rgba(212,83,126,0.2)' : 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(212,83,126,0.3)',
                            color: '#D4537E',
                          }}>
                    ■ Stop
                  </button>
                </div>
              )}

            </div>
          </div>
        )}

        {/* ── Settings tab ──────────────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">

            {/* Ollama model */}
            <div>
              <label className="block text-[17px] font-medium mb-2" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Ollama model
              </label>
              {(() => {
                const savedList = (() => { try { return JSON.parse(config?.saved_models || '[]') } catch { return [] } })()
                const addModel = () => {
                  const m = customModel.trim()
                  if (!m || savedList.includes(m)) return
                  const next = [...savedList, m]
                  updateField('saved_models', JSON.stringify(next))
                  if (!config?.ollama_model) updateField('ollama_model', m)
                  setCustomModel('')
                }
                const removeModel = (m) => {
                  const next = savedList.filter(x => x !== m)
                  updateField('saved_models', JSON.stringify(next))
                }
                return (
                  <div className="flex flex-col gap-2">
                    {savedList.length === 0 && (
                      <p className="text-[14px] py-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        No models saved yet — add one below.
                      </p>
                    )}
                    {savedList.map(m => (
                      <div key={m} className="flex items-center gap-2 p-3 rounded-xl"
                           style={{
                             background: config?.ollama_model === m ? 'rgba(127,119,221,0.15)' : 'rgba(255,255,255,0.04)',
                             border: config?.ollama_model === m ? '1px solid rgba(127,119,221,0.4)' : '1px solid rgba(255,255,255,0.07)',
                           }}>
                        <button onClick={() => updateField('ollama_model', m)} className="flex-1 text-left">
                          <span className="text-[15px] font-mono" style={{ color: 'rgba(255,255,255,0.9)' }}>{m}</span>
                          {ollamaStatus?.models && !ollamaStatus.models.some(om => om.startsWith(m.split(':')[0])) && (
                            <span className="ml-2 text-[12px] px-1.5 py-0.5 rounded"
                                  style={{ background: 'rgba(186,117,23,0.15)', color: '#BA7517' }}>
                              not pulled
                            </span>
                          )}
                        </button>
                        {config?.ollama_model === m && <Check size={14} style={{ color: 'var(--accent, #7F77DD)' }} />}
                        <button onClick={() => removeModel(m)} className="p-1 rounded hover:bg-white/10 transition-all"
                                style={{ color: 'rgba(255,255,255,0.3)' }}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2 mt-1">
                      <input
                        value={customModel}
                        onChange={e => setCustomModel(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addModel()}
                        placeholder="model:tag or namespace/model:tag"
                        className="flex-1 px-3 py-2.5 rounded-xl text-[15px] outline-none font-mono"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}
                      />
                      <button disabled={!customModel.trim()} onClick={addModel}
                              className="px-4 py-2.5 rounded-xl text-[16px] transition-all flex-shrink-0"
                              style={{
                                background: customModel.trim() ? 'var(--accent, #7F77DD)' : 'rgba(255,255,255,0.06)',
                                color: customModel.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                              }}>
                        Add
                      </button>
                    </div>
                    <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
                      Click a model to activate · X to remove · Enter to add
                    </p>
                  </div>
                )
              })()}
            </div>

            {/* VRAM keep-alive */}
            <div>
              <div className="flex items-start justify-between mb-1">
                <label className="text-[17px] font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  Keep model in VRAM
                </label>
                <button
                  onClick={async () => {
                    setUnloading(true)
                    try { await companionApi.ollamaUnload() } catch {}
                    setTimeout(() => setUnloading(false), 1500)
                  }}
                  disabled={unloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] transition-all"
                  style={{
                    background: unloading ? 'rgba(212,83,126,0.1)' : 'rgba(212,83,126,0.08)',
                    border: '1px solid rgba(212,83,126,0.3)',
                    color: unloading ? '#E87FAA' : '#D4537E',
                    opacity: unloading ? 0.6 : 1,
                  }}>
                  {unloading ? '✓ Cleared' : '⏏ Clear VRAM now'}
                </button>
              </div>
              <p className="text-[14px] mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
                How long after your last message before Ollama unloads the model from VRAM.
              </p>
              <div className="flex gap-2 flex-wrap items-center">
                {[
                  { label: 'Unload after chat', value: '0'   },
                  { label: '10 min',            value: '10m' },
                  { label: '30 min',            value: '30m' },
                  { label: 'Always loaded',     value: '-1'  },
                ].map(opt => {
                  const cur = config?.keep_alive || '10m'
                  const active = cur === opt.value
                  return (
                    <button key={opt.value} onClick={() => updateField('keep_alive', opt.value)}
                            className="px-4 py-2 rounded-xl text-[15px] transition-all"
                            style={{
                              background: active ? 'rgba(127,119,221,0.18)' : 'rgba(255,255,255,0.05)',
                              border: active ? '1px solid rgba(127,119,221,0.5)' : '1px solid rgba(255,255,255,0.08)',
                              color: active ? '#CECBF6' : 'rgba(255,255,255,0.5)',
                            }}>
                      {opt.label}
                    </button>
                  )
                })}
                {/* Custom minutes input */}
                <div className="flex items-center gap-1">
                  <input
                    value={customMinutes}
                    onChange={e => setCustomMinutes(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && customMinutes) {
                        updateField('keep_alive', `${customMinutes}m`)
                        setCustomMinutes('')
                      }
                    }}
                    placeholder="custom…"
                    className="w-24 px-3 py-2 rounded-xl text-[15px] outline-none text-center"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                             color: 'rgba(255,255,255,0.7)' }}
                  />
                  {customMinutes && (
                    <button
                      onClick={() => { updateField('keep_alive', `${customMinutes}m`); setCustomMinutes('') }}
                      className="px-3 py-2 rounded-xl text-[15px] transition-all"
                      style={{ background: 'var(--accent, #7F77DD)', color: '#fff' }}>
                      {customMinutes}m ✓
                    </button>
                  )}
                </div>
              </div>
              {/* Show current custom value if it doesn't match a preset */}
              {(() => {
                const cur = config?.keep_alive || '10m'
                const presets = ['0', '10m', '30m', '-1']
                if (!presets.includes(cur)) {
                  return (
                    <p className="text-[13px] mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      Current: <span style={{ color: '#CECBF6' }}>{cur}</span>
                    </p>
                  )
                }
                return null
              })()}
            </div>

            {/* Context window size */}
            <div>
              <div className="flex items-start justify-between mb-1">
                <label className="text-[17px] font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  Context window
                </label>
                <span className="text-[13px] px-2 py-1 rounded-lg"
                      style={{ background: 'rgba(127,119,221,0.12)', color: '#CECBF6' }}>
                  {((config?.num_ctx || 16384) / 1024).toFixed(0)}K tokens
                </span>
              </div>
              <p className="text-[14px] mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
                How many tokens Ollama allocates per session. Higher = longer memory, more VRAM.
                System prompt uses ~3K tokens, leaving the rest for conversation.
              </p>
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: '4K',  value: 4096,  note: 'Minimal' },
                  { label: '8K',  value: 8192,  note: 'Safe' },
                  { label: '16K', value: 16384, note: 'Recommended' },
                  { label: '32K', value: 32768, note: 'Tight on 3090' },
                ].map(opt => {
                  const cur    = config?.num_ctx || 16384
                  const active = cur === opt.value
                  return (
                    <button key={opt.value} onClick={() => updateField('num_ctx', opt.value)}
                            className="flex flex-col items-center px-4 py-2 rounded-xl text-[15px] transition-all"
                            style={{
                              background: active ? 'rgba(127,119,221,0.18)' : 'rgba(255,255,255,0.05)',
                              border: active ? '1px solid rgba(127,119,221,0.5)' : '1px solid rgba(255,255,255,0.08)',
                              color: active ? '#CECBF6' : 'rgba(255,255,255,0.5)',
                            }}>
                      <span className="font-semibold">{opt.label}</span>
                      <span className="text-[11px]" style={{ color: active ? 'rgba(206,203,246,0.6)' : 'rgba(255,255,255,0.25)' }}>
                        {opt.note}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[13px] mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
                Takes effect on the next message sent (Ollama reloads the model with the new size).
              </p>
            </div>

            {/* Ollama URL */}
            <div>
              <label className="block text-[17px] font-medium mb-2" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Ollama URL
              </label>
              <div className="flex gap-2">
                <input
                  defaultValue={config?.ollama_url || 'http://localhost:11434'}
                  onBlur={e => updateField('ollama_url', e.target.value.trim())}
                  className="flex-1 px-4 py-2.5 rounded-xl text-[16px] outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}
                />
                <div className="flex items-center px-3 rounded-xl"
                     style={{
                       background: 'rgba(255,255,255,0.04)',
                       border: '1px solid rgba(255,255,255,0.07)',
                       color: ollamaStatus?.online ? '#1D9E75' : '#D4537E',
                     }}>
                  {ollamaStatus?.online ? <Wifi size={15} /> : <WifiOff size={15} />}
                </div>
              </div>
            </div>

            {/* Danger zone */}
            <div className="pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <p className="text-[15px] font-medium mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>Danger zone</p>
              <div className="flex gap-3">
                <button onClick={() => { if (confirm('Clear all chat history?')) clearHistory.mutate() }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[16px] hover:bg-white/10 transition-all"
                        style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
                  <Trash2 size={14} /> Clear history
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Persona tab ───────────────────────────────────────────────────── */}
        {activeTab === 'persona' && (
          <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">

            {/* Erika config card */}
            <div className="rounded-xl overflow-hidden"
                 style={{ background: 'rgba(127,119,221,0.06)', border: '1px solid rgba(127,119,221,0.2)' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b"
                   style={{ borderColor: 'rgba(127,119,221,0.12)' }}>
                <div className="flex items-center gap-3">
                  <Sparkles size={17} style={{ color: 'var(--accent, #7F77DD)' }} />
                  <div>
                    <p className="text-[17px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>{compName}</p>
                    <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Default AI companion</p>
                  </div>
                </div>
                {!personaId ? (
                  <span className="text-[13px] px-2.5 py-1 rounded-lg"
                        style={{ background: 'rgba(127,119,221,0.18)', color: '#CECBF6' }}>Active</span>
                ) : (
                  <button onClick={() => updateField('active_persona_id', null)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] hover:bg-white/10 transition-all"
                          style={{ border: '1px solid rgba(127,119,221,0.3)', color: '#CECBF6' }}>
                    <RotateCcw size={12} /> Switch to {compName}
                  </button>
                )}
              </div>

              {/* Erika avatar + name */}
              <div className="p-4 flex items-center gap-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <div className="relative flex-shrink-0">
                  {config?.avatar_path ? (
                    <img src={`${companionApi.avatarUrl()}?v=${Date.now()}`} alt={compName}
                         className="w-20 h-20 rounded-full object-cover"
                         style={{ border: '2px solid rgba(127,119,221,0.3)' }} />
                  ) : (
                    <div className="w-20 h-20 rounded-full flex items-center justify-center"
                         style={{ background: 'rgba(127,119,221,0.12)', border: '2px solid rgba(127,119,221,0.25)' }}>
                      <Sparkles size={28} style={{ color: 'rgba(127,119,221,0.5)' }} />
                    </div>
                  )}
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center transition-all hover:opacity-90"
                    style={{ background: 'var(--accent, #7F77DD)', border: '2px solid #0e0e0e' }}>
                    <Upload size={11} style={{ color: '#fff' }} />
                  </button>
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  <input
                    key={compName}
                    defaultValue={compName}
                    onBlur={e => updateField('name', e.target.value.trim() || 'Erika')}
                    className="px-3 py-2 rounded-xl text-[16px] outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)' }}
                    placeholder="Name"
                  />
                  <PersonalityDropdown
                    value={config?.personality_base || 'warm'}
                    onChange={v => updateField('personality_base', v)}
                  />
                </div>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
                       onChange={e => uploadAvatar(e.target.files?.[0])} />
              </div>

              {/* Erika system prompt */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[14px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    System prompt
                  </p>
                  <button
                    onClick={() => {
                      const tpl = ERIKA_DEFAULT_PROMPTS[config?.personality_base || 'warm'] || ERIKA_DEFAULT_PROMPTS.warm
                      setErikaPrompt(tpl)  // keep {name} as a live token — backend substitutes it
                    }}
                    className="text-[12px] px-2 py-1 rounded-lg hover:bg-white/10 transition-all"
                    style={{ color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    Load default
                  </button>
                </div>
                <textarea
                  rows={5}
                  value={erikaPrompt}
                  onChange={e => setErikaPrompt(e.target.value)}
                  placeholder={`Leave blank to auto-generate from the selected personality.\nClick "Load default" to see the template — {name} is replaced with her current name at runtime.`}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none font-mono"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)' }}
                />
                <div className="flex justify-end mt-2 gap-2">
                  {erikaPrompt && (
                    <button onClick={() => { setErikaPrompt(''); updateField('companion_prompt', null) }}
                            className="px-3 py-1.5 rounded-lg text-[13px] hover:bg-white/10 transition-all"
                            style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Clear (use auto)
                    </button>
                  )}
                  <button onClick={() => updateField('companion_prompt', erikaPrompt || null)}
                          className="px-4 py-1.5 rounded-lg text-[14px] hover:opacity-90 transition-all"
                          style={{ background: 'var(--accent, #7F77DD)', color: '#fff' }}>
                    Save prompt
                  </button>
                </div>
              </div>
            </div>

            {/* Creator persona list */}
            <div>
              <h2 className="text-[18px] font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.9)' }}>
                Creator personas
              </h2>
              <p className="text-[15px] mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Pick a creator to embody. Bond XP is tracked per persona.
              </p>
              <input
                value={personaSearch}
                onChange={e => setPersonaSearch(e.target.value)}
                placeholder="Search creators…"
                className="w-full px-4 py-2.5 rounded-xl text-[16px] outline-none mb-3"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}
              />
            </div>

            <div className="flex flex-col gap-2">
              {filteredCreators.slice(0, 40).map(c => {
                const active   = personaId === c.id
                const expanded = expandedPersona === c.id
                const edit     = personaEdits[c.id] ?? {}

                const savePersonaEdits = () => {
                  const p = {}
                  if (edit.personality_type !== undefined) p.personality_type = edit.personality_type
                  if (edit.companion_prompt  !== undefined) p.companion_prompt  = edit.companion_prompt
                  if (Object.keys(p).length) creatorsApi.update(c.id, p)
                }

                return (
                  <div key={c.id} className="rounded-xl overflow-hidden transition-all"
                       style={{
                         background: active ? 'rgba(127,119,221,0.08)' : 'rgba(255,255,255,0.03)',
                         border: active ? '1px solid rgba(127,119,221,0.35)' : '1px solid rgba(255,255,255,0.07)',
                       }}>
                    <div className="flex items-center gap-3 p-3">
                      <button onClick={() => updateField('active_persona_id', active ? null : c.id)}
                              className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        {c.avatar_path ? (
                          <img src={creatorsApi.avatarThumbUrl(c.id, 64)} alt={c.name}
                               className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                               style={{ background: 'rgba(255,255,255,0.07)' }}>
                            <User size={17} style={{ color: 'rgba(255,255,255,0.3)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[16px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>{c.name}</p>
                          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                            {c.creator_type}
                            {c.companion_bond_xp > 0 && (
                              <span className="ml-2" style={{ color: '#D4537E' }}>{c.companion_bond_xp} bond XP</span>
                            )}
                          </p>
                        </div>
                        {active && <Check size={15} style={{ color: 'var(--accent, #7F77DD)' }} />}
                      </button>
                      <button onClick={() => setExpandedPersona(expanded ? null : c.id)}
                              className="p-1.5 rounded-lg hover:bg-white/10 transition-all flex-shrink-0"
                              style={{ color: 'rgba(255,255,255,0.4)' }}>
                        <ChevronDown size={15}
                                     className="transition-transform"
                                     style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
                      </button>
                    </div>

                    {/* Expanded editor */}
                    <Dropdown open={expanded}>
                      <div className="px-3 pb-3 flex flex-col gap-3 border-t"
                           style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <div className="pt-3">
                          <p className="text-[13px] font-medium mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
                            Personality
                          </p>
                          <PersonalityDropdown
                            value={edit.personality_type ?? c.personality_type ?? 'bold'}
                            onChange={v => setPersonaEdits(prev => ({ ...prev, [c.id]: { ...prev[c.id], personality_type: v } }))}
                          />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                            System prompt{' '}
                            <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>(blank = auto-generate)</span>
                          </p>
                          <textarea
                            rows={5}
                            value={edit.companion_prompt ?? c.companion_prompt ?? ''}
                            onChange={e => setPersonaEdits(prev => ({ ...prev, [c.id]: { ...prev[c.id], companion_prompt: e.target.value } }))}
                            placeholder={`You are roleplaying as ${c.name}. Stay in character at all times…`}
                            className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none resize-none font-mono"
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)' }}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => {
                              if (confirm(`Clear all chat history with ${c.name}?`)) {
                                companionApi.clearHistory(c.id).then(() => {
                                  qc.invalidateQueries({ queryKey: ['companion-history'] })
                                })
                              }
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] hover:bg-white/10 transition-all"
                            style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' }}>
                            <Trash2 size={12} /> Clear chat
                          </button>
                          <button onClick={savePersonaEdits}
                                  className="px-4 py-2 rounded-lg text-[14px] hover:opacity-90 transition-all"
                                  style={{ background: 'var(--accent, #7F77DD)', color: '#fff' }}>
                            Save
                          </button>
                        </div>
                      </div>
                    </Dropdown>
                  </div>
                )
              })}
              {filteredCreators.length === 0 && (
                <p className="text-center py-8 text-[16px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  No creators found
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
