import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Sparkles, ImagePlus, X, ChevronDown, User, Check, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { companionApi, creatorsApi, galleriesApi, systemApi } from '../../lib/api'
import { usePersonalMode } from '../../hooks/usePersonalMode'
import { useDeviceStore } from '../../store/deviceStore'
import { deviceService } from '../../services/device'

const BOND_HEARTS = ['♥', '♥♥', '♥♥♥', '♥♥♥♥', '♥♥♥♥♥']

function stripAndFireDeviceTags(text, deviceStore) {
  // Match <device ... /> or <device ...> — handles both self-closing styles and case variants
  const stripped = text.replace(/<device\b([^>]*?)\/?>/gi, (match, attrs) => {
    const attr = (key) => {
      const m = attrs.match(new RegExp(`${key}="([^"]+)"`))
      return m ? m[1] : null
    }
    const action = attr('action')
    if (!action || !deviceStore) return ''
    try {
      if (action === 'stroke') {
        const spm    = Math.round(parseFloat(attr('speed')  || '40'))
        const top    = Math.round(parseFloat(attr('top')    || '0.9') * 100)
        const bottom = Math.round(parseFloat(attr('bottom') || '0.1') * 100)
        deviceStore.setCustomPattern?.({ spm, strokeMax: Math.max(top, bottom), strokeMin: Math.min(top, bottom), waveform: 'sine' })
        deviceStore.setActivePreset?.('custom')
        // Only start the engine if it isn't already running — avoids the brief stop/gap on pattern changes
        if (deviceStore.mode !== 'freestyle') deviceService.startFreestyle()
      } else if (action === 'speed') {
        const val    = attr('value') || '0'
        const cur    = deviceStore.customPattern?.spm ?? 40
        const newSpm = val.startsWith('+') || val.startsWith('-')
          ? Math.max(5, cur + parseFloat(val))
          : Math.max(5, parseFloat(val))
        deviceStore.setCustomPattern?.({ ...(deviceStore.customPattern || {}), spm: Math.round(newSpm) })
        deviceStore.setActivePreset?.('custom')
        // Engine already running — picks up new spm on next tick, no gap
      } else if (action === 'stop') {
        deviceService.stop()
      } else if (action === 'edge') {
        deviceService.setEdgeMode(true)
        if (deviceStore.mode !== 'freestyle') deviceService.startFreestyle()
      }
    } catch (_) {}
    return ''
  })
  // Collapse any 3+ consecutive newlines (from stripped tag lines) down to 2
  return stripped.replace(/\n{3,}/g, '\n\n')
}

function ThinkingDots({ startedAt }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500)
    return () => clearInterval(t)
  }, [startedAt])
  return (
    <span className="flex items-center gap-2 py-0.5">
      <span className="flex gap-1.5 items-center">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-2 h-2 rounded-full" style={{
            background: 'var(--accent, var(--c-accent))', opacity: 0.6,
            animation: 'thinkBounce 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </span>
      {elapsed >= 3 && (
        <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
          {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
          {elapsed >= 20 && ' — loading model…'}
        </span>
      )}
      <style>{`
        @keyframes thinkBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%            { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </span>
  )
}

// Matches /creators/... and /galleries/... paths + vault://photo/{id} the user pastes
const VAULT_LINK_SPLIT = /(\/(?:creators|galleries)\/[^\s,;.!?'")\]]+|vault:\/\/photo\/\d+)/
const VAULT_LINK_TEST  = /^\/(creators|galleries)\//
const VAULT_PHOTO_TEST = /^vault:\/\/photo\/(\d+)$/
const DEVICE_TAG_RE    = /<device\b([^>]*?)\/?>/gi

// Inline markdown: **bold** and *italic*
function applyMarkdown(text, baseKey) {
  const parts = []
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g
  let last = 0, match, idx = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const m = match[0]
    if (m.startsWith('**')) {
      parts.push(<strong key={`${baseKey}-b${idx++}`} style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 700 }}>{m.slice(2, -2)}</strong>)
    } else {
      parts.push(<em key={`${baseKey}-i${idx++}`} style={{ color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' }}>{m.slice(1, -1)}</em>)
    }
    last = match.index + m.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function resolveVaultLinkLabel(path, creators, galleries) {
  const m = path.match(/^\/(creators|galleries)\/(\d+)/)
  if (!m) return path
  const [, type, rawId] = m
  const id = parseInt(rawId, 10)
  if (type === 'creators') {
    const c = (creators || []).find(c => c.id === id)
    return c ? c.name : `Creator #${id}`
  }
  const g = (galleries || []).find(g => g.id === id)
  return g ? g.name : `Gallery #${id}`
}

function renderContent(text, navigate, creators, galleries) {
  if (!text) return <span className="opacity-40 italic">…</span>
  // Strip any device tags that made it into saved history
  const clean = text.replace(DEVICE_TAG_RE, '').replace(/\n{3,}/g, '\n\n')
  // Split by vault links, then apply markdown to text segments
  const parts = clean.split(VAULT_LINK_SPLIT)
  return parts.map((part, i) => {
    const photo = part.match(VAULT_PHOTO_TEST)
    if (photo) {
      // A vault photo the user linked — show it as a thumbnail chip
      return (
        <img key={i} src={`/api/images/${photo[1]}/thumb`} alt="linked photo"
             className="inline-block rounded-lg my-1 cursor-pointer align-middle"
             style={{ maxHeight: 120, maxWidth: '70%', border: '1px solid rgba(255,255,255,0.12)' }} />
      )
    }
    if (VAULT_LINK_TEST.test(part)) {
      const label = resolveVaultLinkLabel(part, creators, galleries)
      return (
        <span key={i}
              onClick={() => navigate(part)}
              title={`Open ${part}`}
              className="cursor-pointer inline-flex items-center rounded-md px-1.5 py-0.5 mx-0.5 transition-all hover:brightness-125 active:scale-95"
              style={{
                background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)',
                border: '1px solid color-mix(in srgb, var(--c-accent) 35%, transparent)',
                color: 'var(--c-accent-text)',
                fontSize: '0.9em',
              }}>
          {label}
        </span>
      )
    }
    return <React.Fragment key={i}>{applyMarkdown(part, i)}</React.Fragment>
  })
}

function MessageBubble({ msg, navigate, activeCreator, creators, galleries }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
         style={{ animation: 'msgFadeIn 0.2s ease-out' }}>
      <style>{`
        @keyframes msgFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {!isUser && (
        <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center"
             style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
          {activeCreator?.avatar_path
            ? <img src={creatorsApi.avatarThumbUrl(activeCreator.id, 64)} alt={activeCreator.name}
                   className="w-full h-full object-cover" />
            : <Sparkles size={14} style={{ color: 'var(--accent, var(--c-accent))' }} />}
        </div>
      )}
      <div className="flex flex-col gap-1 max-w-[80%]">
        {msg.imageUrl && (
          <img src={msg.imageUrl} alt="attached"
               className="rounded-xl object-cover max-h-48"
               style={{ border: '1px solid rgba(255,255,255,0.1)' }} />
        )}
        <div className="rounded-2xl px-4 py-2.5 text-[17px] leading-relaxed whitespace-pre-wrap"
             style={isUser ? {
               background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--c-accent) 25%, transparent)',
               color: 'rgba(255,255,255,0.9)', borderBottomRightRadius: 6,
             } : {
               background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
               color: 'rgba(255,255,255,0.85)', borderBottomLeftRadius: 6,
             }}>
          {/* Render both sides through renderContent so a vault photo you paste
              shows as a thumbnail in your own bubble too */}
          {renderContent(msg.content, navigate, creators, galleries)}
        </div>
      </div>
    </div>
  )
}

// ── Persona switcher dropdown content ─────────────────────────────────────────
function PersonaSwitcherDropdown({ open, creators, personaId, compName, search, onSearch, onSelect, align = 'left' }) {
  if (!open) return null
  const filtered = (creators || []).filter(c =>
    c.name.toLowerCase().includes((search || '').toLowerCase())
  )
  const posStyle = align === 'right' ? { right: 0 } : { left: 0 }
  return (
    <div style={{ animation: 'dropInChat 0.15s ease-out', position: 'absolute', ...posStyle,
                  top: '100%', zIndex: 100, marginTop: 4, width: 260 }}>
      <style>{`
        @keyframes dropInChat {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="rounded-xl overflow-hidden"
           style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
        <div className="p-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <input autoFocus value={search} onChange={e => onSearch(e.target.value)}
                 placeholder="Search…"
                 className="w-full px-2.5 py-1.5 rounded-lg text-[13px] outline-none bg-transparent"
                 style={{ color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.08)' }} />
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {/* Erika / default */}
          <button onClick={() => onSelect(null)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-all"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <Sparkles size={13} style={{ color: 'var(--accent, var(--c-accent))', flexShrink: 0 }} />
            <span className="flex-1 text-[13px]" style={{ color: !personaId ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.7)' }}>
              {compName} (default)
            </span>
            {!personaId && <Check size={12} style={{ color: 'var(--accent, var(--c-accent))' }} />}
          </button>
          {/* Creator list */}
          {filtered.slice(0, 40).map(c => (
            <button key={c.id} onClick={() => onSelect(c.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-all"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              {c.avatar_path ? (
                <img src={creatorsApi.avatarThumbUrl(c.id, 32)} alt={c.name}
                     className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
              ) : (
                <User size={13} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
              )}
              <span className="flex-1 truncate text-[13px]"
                    style={{ color: personaId === c.id ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.7)' }}>
                {c.name}
              </span>
              {personaId === c.id && <Check size={12} style={{ color: 'var(--accent, var(--c-accent))' }} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CompanionChat({ config, creators = [], onPersonaChange, compact = false }) {
  const [input, setInput]               = useState('')
  const [messages, setMessages]         = useState([])
  const [streaming, setStreaming]       = useState(false)
  const [thinking, setThinking]         = useState(false)
  const [thinkStarted, setThinkStarted] = useState(0)
  const [pendingImage, setPendingImage] = useState(null)
  const [personaOpen, setPersonaOpen]     = useState(false)
  const [personaSearch, setPersonaSearch] = useState('')
  const [deviceOpen, setDeviceOpen]       = useState(true)
  const [breakHover, setBreakHover]       = useState(false)

  // ── /secrets — typed in chat, never sent to the LLM. Toggles personal mode. ──
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false)
  const [unlockPassword, setUnlockPassword]     = useState('')
  const [unlockError, setUnlockError]           = useState(false)

  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)
  const imageRef    = useRef(null)
  const personaRef  = useRef(null)
  const avatarV     = useRef(Date.now()).current

  const navigate       = useNavigate()
  const qc             = useQueryClient()
  const deviceStore    = useDeviceStore(s => s)
  const deviceConnected = useDeviceStore(s => s.status === 'connected')
  const deviceMode     = useDeviceStore(s => s.mode)
  const activePresetId = useDeviceStore(s => s.activePresetId)
  const intensity      = useDeviceStore(s => s.intensity)
  const glansShift     = useDeviceStore(s => s.glansShift)
  const variance       = useDeviceStore(s => s.variance)

  const personaId    = config?.active_persona_id ?? null
  const activeCreator = personaId ? creators.find(c => c.id === personaId) : null

  // Close persona dropdown on outside click
  useEffect(() => {
    const h = (e) => { if (personaRef.current && !personaRef.current.contains(e.target)) setPersonaOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const { data: bond } = useQuery({
    // Key on personaId so switching who you're chatting with refetches the bond
    // (name + tier are per-persona — a shared key left both stale until refresh)
    queryKey: ['companion-bond', personaId],
    queryFn:  () => companionApi.bond().then(r => r.data),
    staleTime: 30000,
    enabled: !!config?.enabled,
  })

  const { data: galleries } = useQuery({
    queryKey: ['galleries-mini'],
    queryFn:  () => galleriesApi.list({ limit: 500 }).then(r => r.data?.items ?? r.data ?? []),
    staleTime: 120000,
    enabled: !!config?.enabled,
  })

  const personalMode = usePersonalMode()
  const unlockMutation = useMutation({
    mutationFn: (password) => systemApi.unlockPersonalMode(password).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal-mode'] })
      setShowUnlockPrompt(false)
      setUnlockPassword('')
      setUnlockError(false)
    },
    onError: () => setUnlockError(true),
  })
  const lockMutation = useMutation({
    mutationFn: () => systemApi.lockPersonalMode().then(r => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['personal-mode'] }),
  })

  const sessionBreak = useMutation({
    mutationFn: () => companionApi.sessionBreak(personaId ?? undefined),
    onSuccess: (res) => {
      const marker = res?.data
      setMessages(prev => [...prev, {
        id: marker?.id ?? Date.now(),
        role: 'break',
        content: '',
      }])
    },
  })

  // Reload history when active persona changes
  useEffect(() => {
    if (!config?.enabled) return
    setMessages([])
    companionApi.history(50, personaId ?? undefined).then(r => {
      if (r?.data) {
        // Map DB messages → display messages; restore image previews from stored data URLs
        setMessages(r.data.map(m => ({
          ...m,
          imageUrl: m.image_data_url || undefined,
        })))
      }
    })
  }, [config?.enabled, personaId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target.result
      const b64 = dataUrl.split(',')[1]
      setPendingImage({ dataUrl, b64, name: file.name })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const sendMessage = useCallback(async (text) => {
    // A slash command, not a message — never reaches Ollama.
    if (text.trim().toLowerCase() === '/secrets') {
      setInput('')
      if (personalMode) lockMutation.mutate()
      else setShowUnlockPrompt(true)
      return
    }
    if ((!text.trim() && !pendingImage) || streaming) return
    const imgSnap = pendingImage
    setInput('')
    setPendingImage(null)

    const userMsg = { role: 'user', content: text, id: Date.now(), imageUrl: imgSnap?.dataUrl }
    setMessages(prev => [...prev, userMsg])
    setThinkStarted(Date.now())
    setThinking(true)
    setStreaming(true)

    try {
      const body = { message: text, device_connected: deviceConnected }
      if (imgSnap) {
        body.image_b64      = imgSnap.b64
        body.image_data_url = imgSnap.dataUrl  // stored in DB so it survives reload
      }

      const res = await fetch('/api/companion/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let full       = ''
      let lineBuf    = ''
      let gotContent = false

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        lineBuf += decoder.decode(value, { stream: true })
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') break outer
          try {
            const parsed = JSON.parse(payload)
            if (parsed.error) {
              setThinking(false)
              setMessages(prev => [...prev, { role: 'assistant', content: `⚠ ${parsed.error}`, id: Date.now() }])
              gotContent = true
              break outer
            }
            const chunk = parsed.text ?? ''
            if (chunk) {
              full += chunk
              const clean = stripAndFireDeviceTags(full, deviceStore)
              if (!gotContent) {
                gotContent = true
                setThinking(false)
                setMessages(prev => [...prev, { role: 'assistant', content: clean, id: Date.now() + 1 }])
              } else {
                setMessages(prev => {
                  const u = [...prev]
                  u[u.length - 1] = { ...u[u.length - 1], content: clean }
                  return u
                })
              }
            }
          } catch (e) { console.warn('SSE parse error:', e) }
        }
      }

      if (!gotContent) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⚠ Model returned an empty response. It may still be loading — try again in a moment.',
          id: Date.now()
        }])
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠ ${e.message || 'Could not reach Ollama. Is it running?'}`,
        id: Date.now()
      }])
    } finally {
      setThinking(false)
      setStreaming(false)
      qc.invalidateQueries({ queryKey: ['companion-bond'] })
    }
  }, [streaming, pendingImage, deviceConnected, deviceStore, qc, personalMode, lockMutation])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  const handlePersonaSelect = (id) => {
    setPersonaOpen(false)
    setPersonaSearch('')
    if (onPersonaChange) onPersonaChange(id)
  }

  const bondTier  = bond?.bond_level ?? 0
  const bondName  = bond?.bond_name  ?? 'Acquaintance'
  const hearts    = BOND_HEARTS[Math.min(bondTier, BOND_HEARTS.length - 1)]
  // Prefer the active creator's name so the header updates the instant you switch,
  // before the bond query refetches; fall back to bond/config for the default (Erika)
  const compName  = activeCreator?.name || bond?.persona_name || config?.name || 'Erika'
  const erikaName = config?.name || 'Erika'  // base companion name, never the active persona's name

  // ── PFP helper ──────────────────────────────────────────────────────────────
  const pfpContent = (size) => {
    if (activeCreator?.avatar_path) {
      return <img src={creatorsApi.avatarThumbUrl(activeCreator.id, size * 2)} alt={activeCreator.name}
                  className="w-full h-full object-cover" />
    }
    if (config?.avatar_path) {
      return <img src={`${companionApi.avatarUrl()}?v=${avatarV}`} alt={compName}
                  className="w-full h-full object-cover" />
    }
    return (
      <div className="w-full h-full flex items-center justify-center"
           style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)' }}>
        <Sparkles size={Math.round(size * 0.35)} style={{ color: 'var(--accent, var(--c-accent))' }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {compact ? (
        /* Compact header — row layout for the floating bubble */
        <div className="flex items-center gap-2.5 px-3 py-2.5 border-b flex-shrink-0"
             style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0"
               style={{ border: '1.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
            {pfpContent(36)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-medium leading-tight truncate"
               style={{ color: 'rgba(255,255,255,0.9)' }}>{compName}</p>
            <p className="text-[12px] leading-tight" style={{ color: 'var(--c-pink)' }}>
              {bondName} {hearts}
            </p>
          </div>
          {/* Compact persona switcher */}
          {onPersonaChange && (
            <div ref={personaRef} className="relative flex-shrink-0">
              <button
                onClick={() => { setPersonaOpen(!personaOpen); setPersonaSearch('') }}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] transition-all hover:bg-white/10"
                style={{ border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.45)' }}
                title="Switch persona">
                <User size={12} />
                <ChevronDown size={10}
                  style={{ transform: personaOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </button>
              <PersonaSwitcherDropdown
                open={personaOpen} creators={creators} personaId={personaId}
                compName={erikaName} search={personaSearch}
                onSearch={setPersonaSearch} onSelect={handlePersonaSelect}
                align="right"
              />
            </div>
          )}
        </div>
      ) : (
        /* Full header — horizontal row: PFP left, info right */
        <div className="flex items-start gap-4 px-4 pt-4 pb-4 border-b flex-shrink-0"
             style={{ borderColor: 'rgba(255,255,255,0.07)' }}>

          {/* PFP */}
          <div className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0"
               style={{ border: '2px solid color-mix(in srgb, var(--c-accent) 35%, transparent)',
                        boxShadow: '0 0 20px color-mix(in srgb, var(--c-accent) 16%, transparent)' }}>
            {pfpContent(80)}
          </div>

          {/* Info column — fills remaining width */}
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">

            {/* Name + bond */}
            <div>
              <p className="text-[20px] font-semibold leading-tight" style={{ color: 'rgba(255,255,255,0.92)' }}>
                {compName}
              </p>
              <p className="text-[13px]" style={{ color: 'var(--c-pink)' }}>
                {bondName} {hearts}
              </p>
            </div>

            {/* Persona switcher */}
            {onPersonaChange && (
              <div ref={personaRef} className="relative" style={{ maxWidth: 240 }}>
                <button
                  onClick={() => { setPersonaOpen(!personaOpen); setPersonaSearch('') }}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-[13px] transition-all hover:bg-white/5"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
                           color: 'rgba(255,255,255,0.5)' }}>
                  <span className="flex items-center gap-1.5 truncate">
                    <User size={11} className="flex-shrink-0" />
                    <span className="truncate">
                      {personaId ? `Switch from ${activeCreator?.name || '…'}` : 'Switch persona'}
                    </span>
                  </span>
                  <ChevronDown size={11} className="flex-shrink-0 ml-1"
                    style={{ transform: personaOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
                <PersonaSwitcherDropdown
                  open={personaOpen} creators={creators} personaId={personaId}
                  compName={erikaName} search={personaSearch}
                  onSearch={setPersonaSearch} onSelect={handlePersonaSelect}
                />
              </div>
            )}

            {/* Creator stats — only when a creator persona is active */}
            {activeCreator && (
              <>
                {/* Personality pill + stats in one row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Personality</span>
                  <span className="text-[12px] font-medium capitalize px-2 py-0.5 rounded-lg"
                        style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)' }}>
                    {activeCreator.personality_type || 'bold'}
                  </span>
                  <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.12)' }}>·</span>
                  {[
                    { label: 'Sessions',  value: activeCreator.session_count  ?? 0 },
                    { label: 'Galleries', value: activeCreator.gallery_count  ?? 0 },
                    { label: 'Bond XP',   value: activeCreator.companion_bond_xp ?? 0 },
                  ].map((s, i, arr) => (
                    <React.Fragment key={s.label}>
                      <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>{s.value}</span>
                        {' '}{s.label}
                      </span>
                      {i < arr.length - 1 && (
                        <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.12)' }}>·</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
                {/* Description */}
                {activeCreator.description && (
                  <p className="text-[13px] leading-snug line-clamp-2"
                     style={{ color: 'rgba(255,255,255,0.38)' }}>
                    {activeCreator.description}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0"
           style={{ scrollbarWidth: 'thin' }}>
        {messages.length === 0 && !streaming && !thinking && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <Sparkles size={32} style={{ color: 'color-mix(in srgb, var(--c-accent) 30%, transparent)' }} />
            <p className="text-[17px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Say hello to {compName}…
            </p>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'break') {
            return (
              <div key={m.id ?? i} className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
                <span className="text-[12px] px-2 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }}>
                  — new session —
                </span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
              </div>
            )
          }
          return <MessageBubble key={m.id ?? i} msg={m} navigate={navigate} activeCreator={activeCreator} creators={creators} galleries={galleries} />
        })}
        {thinking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
                 style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
              <Sparkles size={14} style={{ color: 'var(--accent, var(--c-accent))' }} />
            </div>
            <div className="rounded-2xl px-4 py-2.5"
                 style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                          borderBottomLeftRadius: 6 }}>
              <ThinkingDots startedAt={thinkStarted} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Device controls ──────────────────────────────────────────────────── */}
      {deviceConnected && (
        <div className="border-t flex-shrink-0"
             style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>

          {/* Header row — always visible */}
          <div className="flex items-center gap-1.5 px-3 py-2">
            <span className="text-[11px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Device{deviceMode !== 'off' ? ' · active' : ''}
            </span>
            <button onClick={() => deviceService.stop()}
                    className="px-2.5 py-1 rounded-lg text-[12px] transition-all"
                    style={{
                      background: deviceMode === 'off' ? 'color-mix(in srgb, var(--c-pink) 18%, transparent)' : 'rgba(255,255,255,0.04)',
                      border: '1px solid color-mix(in srgb, var(--c-pink) 30%, transparent)', color: 'var(--c-pink)',
                    }}>
              Stop
            </button>
            {/* Collapse toggle */}
            <button onClick={() => setDeviceOpen(v => !v)}
                    className="ml-auto px-2 py-1 rounded-lg text-[11px] transition-all hover:bg-white/5"
                    style={{ color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
              {deviceOpen ? '▲' : '▼'}
            </button>
          </div>

          {/* Collapsible sliders */}
          {deviceOpen && (
            <div className="px-3 pb-3 flex flex-col gap-2"
                 style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              {[
                {
                  label: 'Intensity',
                  value: Math.round(intensity * 100),
                  display: `${Math.round(intensity * 100)}%`,
                  color: intensity > 2 ? 'var(--c-pink)' : intensity > 1 ? 'var(--c-amber)' : 'var(--c-green)',
                  min: 10, max: 500, step: 5,
                  onChange: v => deviceStore.setIntensity?.(v / 100),
                },
                {
                  label: 'Glans Focus',
                  value: Math.round(glansShift * 100),
                  display: `${Math.round(glansShift * 100)}%`,
                  color: 'var(--accent, var(--c-accent))',
                  min: 0, max: 100, step: 5,
                  onChange: v => deviceStore.setGlansShift?.(v / 100),
                },
                {
                  label: 'Variance',
                  value: variance,
                  display: `${variance}%`,
                  color: 'rgba(255,255,255,0.5)',
                  min: 0, max: 100, step: 5,
                  onChange: v => deviceStore.setVariance?.(v),
                },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2 pt-1.5">
                  <span className="text-[11px] w-20 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {s.label}
                  </span>
                  <input type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                         onChange={e => s.onChange(parseInt(e.target.value, 10))}
                         className="flex-1"
                         style={{ accentColor: s.color, cursor: 'pointer' }} />
                  <span className="text-[12px] font-mono w-10 text-right flex-shrink-0"
                        style={{ color: s.color }}>
                    {s.display}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Pending image preview ─────────────────────────────────────────────── */}
      {pendingImage && (
        <div className="px-4 pt-2 flex-shrink-0">
          <div className="relative inline-block">
            <img src={pendingImage.dataUrl} alt="pending"
                 className="h-20 rounded-xl object-cover"
                 style={{ border: '1px solid rgba(255,255,255,0.15)' }} />
            <button onClick={() => setPendingImage(null)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.2)' }}>
              <X size={10} style={{ color: 'rgba(255,255,255,0.7)' }} />
            </button>
          </div>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
            ⚠ Not all models support images — vision models only (e.g. llava, bakllava)
          </p>
        </div>
      )}

      {/* ── Input ────────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t flex-shrink-0"
           style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="flex gap-2 items-end">
          <input ref={imageRef} type="file" accept="image/*" className="hidden"
                 onChange={handleImageSelect} />
          <button onClick={() => imageRef.current?.click()} disabled={streaming}
                  title="Attach image (vision models only)"
                  className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:bg-white/10"
                  style={{ border: '1px solid rgba(255,255,255,0.1)',
                           color: pendingImage ? 'var(--accent, var(--c-accent))' : 'rgba(255,255,255,0.3)' }}>
            <ImagePlus size={17} />
          </button>
          <div className="relative flex-shrink-0"
               onMouseEnter={() => setBreakHover(true)}
               onMouseLeave={() => setBreakHover(false)}>
            <button
              onClick={() => sessionBreak.mutate()}
              disabled={streaming || messages.length === 0 || messages[messages.length - 1]?.role === 'break'}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:bg-white/10"
              style={{ border: '1px solid rgba(255,255,255,0.08)',
                       color: messages.length > 0 && messages[messages.length - 1]?.role !== 'break'
                         ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)' }}>
              <RefreshCw size={15} />
            </button>
            {breakHover && (
              <div className="absolute bottom-full left-0 mb-2 px-3 py-2 rounded-xl text-[13px] whitespace-nowrap pointer-events-none z-50"
                   style={{
                     background: '#1e1e1e',
                     border: '1px solid rgba(255,255,255,0.1)',
                     color: 'rgba(255,255,255,0.7)',
                     boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                   }}>
                <p className="font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>New session</p>
                <p style={{ color: 'rgba(255,255,255,0.4)' }}>Keeps history · resets context window</p>
              </div>
            )}
          </div>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={onKeyDown} placeholder={`Message ${compName}…`}
                    rows={1} disabled={streaming}
                    className="flex-1 resize-none rounded-xl px-4 py-2.5 text-[17px] outline-none transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.85)', maxHeight: compact ? 80 : 120, scrollbarWidth: 'none',
                    }} />
          <button onClick={() => sendMessage(input)}
                  disabled={(!input.trim() && !pendingImage) || streaming}
                  className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all"
                  style={{
                    background: (input.trim() || pendingImage) && !streaming ? 'var(--accent, var(--c-accent))' : 'rgba(255,255,255,0.07)',
                    color: (input.trim() || pendingImage) && !streaming ? '#fff' : 'rgba(255,255,255,0.25)',
                  }}>
            {streaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Enter to send · Shift+Enter for newline
        </p>
      </div>

      {/* ── /secrets password prompt ────────────────────────────────────────── */}
      {showUnlockPrompt && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
             style={{ background: 'rgba(0,0,0,0.75)' }}
             onClick={() => { setShowUnlockPrompt(false); setUnlockPassword(''); setUnlockError(false) }}>
          <div className="rounded-[16px] p-7 max-w-sm w-full"
               style={{ background: '#1a1a1a', border: '1px solid color-mix(in srgb, var(--c-accent) 40%, transparent)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: 14 }}>Password</div>
            <input
              type="password"
              autoFocus
              value={unlockPassword}
              onChange={e => { setUnlockPassword(e.target.value); setUnlockError(false) }}
              onKeyDown={e => { if (e.key === 'Enter' && unlockPassword) unlockMutation.mutate(unlockPassword) }}
              className="w-full px-4 py-3 rounded-[8px] text-[16px] outline-none mb-3"
              style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${unlockError ? 'color-mix(in srgb, var(--c-pink) 50%, transparent)' : 'rgba(255,255,255,0.1)'}`, color: 'rgba(255,255,255,0.9)' }}
            />
            {unlockError && <div style={{ fontSize: 15, color: '#F4C0D1', marginBottom: 10 }}>Incorrect.</div>}
            <div className="flex gap-3">
              <button onClick={() => unlockMutation.mutate(unlockPassword)}
                      disabled={!unlockPassword || unlockMutation.isPending}
                      className="flex-1 px-4 py-3 rounded-[8px] text-[15px] font-medium cursor-pointer disabled:opacity-40"
                      style={{ background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                Unlock
              </button>
              <button onClick={() => { setShowUnlockPrompt(false); setUnlockPassword(''); setUnlockError(false) }}
                      className="px-4 py-3 rounded-[8px] text-[15px] cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
