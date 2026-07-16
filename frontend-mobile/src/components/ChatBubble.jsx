// Floating companion chat bubble — the mobile face of Erika (or whichever
// persona is active). Streams replies from /api/companion/chat.
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X, Send, ChevronDown, Check } from 'lucide-react'
import { companionApi, creatorsApi, galleriesApi } from '../lib/api.js'
import { abs } from '../lib/server.js'
import { useVaultStore } from '../store/vault.js'

export default function ChatBubble() {
  const loc = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const chatOpen = useVaultStore(s => s.chatOpen)
  const setChatOpen = useVaultStore(s => s.setChatOpen)
  const chatConfigBust = useVaultStore(s => s.chatConfigBust)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [personaSearch, setPersonaSearch] = useState('')
  const [linkLabels, setLinkLabels] = useState({})   // 'creator:39'|'gallery:32' → name
  const scrollRef = useRef(null)

  const { data: config } = useQuery({
    queryKey: ['companion-config', chatConfigBust],
    queryFn: () => companionApi.config().then(r => r.data),
    staleTime: 30000,
  })
  const personaId = config?.active_persona_id ?? null

  // The persona's real name — the config only stores the companion's base name,
  // which is why "Erika" used to show with someone else's face
  const { data: personaCreator } = useQuery({
    queryKey: ['persona-creator', personaId],
    queryFn: () => creatorsApi.get(personaId).then(r => r.data),
    enabled: !!personaId,
    staleTime: 60000,
  })
  const name = personaId ? (personaCreator?.name || '…') : (config?.name || 'Erika')

  // Favorites are the quick default list; a search box queries ALL creators
  const { data: favorites } = useQuery({
    queryKey: ['chat-favorites'],
    queryFn: () => creatorsApi.favorites().then(r => r.data),
    enabled: pickerOpen,
    staleTime: 60000,
  })
  const query = personaSearch.trim()
  const { data: searchResults } = useQuery({
    queryKey: ['chat-persona-search', query],
    queryFn: () => creatorsApi.list({ search: query, limit: 30 }).then(r => r.data),
    enabled: pickerOpen && query.length > 0,
    staleTime: 30000,
  })
  const personaList = query ? (searchResults ?? []) : (favorites ?? [])

  useEffect(() => {
    if (!chatOpen) return
    companionApi.history(personaId)
      .then(r => setMessages((r.data || []).map(m => ({ role: m.role, content: m.content }))))
      .catch(() => setMessages([]))
  }, [chatOpen, personaId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, chatOpen])

  // The AI links to vault content as /creators/{id} or /galleries/{id}. Resolve
  // those ids to names so the chips read like the desktop chat's.
  useEffect(() => {
    const wanted = new Set()
    const re = /\/(creators?|galler(?:y|ies))\/(\d+)/gi
    for (const m of messages) {
      if (m.role === 'user') continue
      let mm
      while ((mm = re.exec(m.content || '')) !== null) {
        const type = /creator/i.test(mm[1]) ? 'creator' : 'gallery'
        wanted.add(`${type}:${mm[2]}`)
      }
    }
    const missing = [...wanted].filter(k => !(k in linkLabels))
    if (!missing.length) return
    missing.forEach(async key => {
      const [type, id] = key.split(':')
      try {
        const r = type === 'creator' ? await creatorsApi.get(id) : await galleriesApi.get(id)
        setLinkLabels(c => ({ ...c, [key]: r.data?.name || null }))
      } catch { setLinkLabels(c => ({ ...c, [key]: null })) }
    })
  }, [messages])   // eslint-disable-line react-hooks/exhaustive-deps

  // Render assistant/user text with /creators/{id} & /galleries/{id} as tappable
  // chips, and vault://photo/{id} (pasted from a post) as an image thumbnail.
  const VAULT_LINK = /(\/(?:creators?|galler(?:y|ies))\/\d+|vault:\/\/photo\/\d+)/gi
  const renderMessage = (text) => {
    if (!text) return '…'
    const clean = text.replace(/<device\b[^>]*?\/?>/gi, '').replace(/\n{3,}/g, '\n\n')
    return clean.split(VAULT_LINK).map((part, i) => {
      const photo = part.match(/^vault:\/\/photo\/(\d+)$/i)
      if (photo) {
        return (
          <img key={i} src={abs(`/api/images/${photo[1]}/thumb`)} alt="linked photo"
               className="inline-block rounded-lg my-1 align-middle"
               style={{ maxHeight: 110, maxWidth: '70%', border: '1px solid rgba(255,255,255,0.12)' }} />
        )
      }
      const m = part.match(/^\/(creators?|galler(?:y|ies))\/(\d+)$/i)
      if (!m) return part
      const type = /creator/i.test(m[1]) ? 'creator' : 'gallery'
      const id = m[2]
      const route = type === 'creator' ? `/creator/${id}` : `/gallery/${id}`
      const label = linkLabels[`${type}:${id}`] || (type === 'creator' ? 'Creator' : 'Gallery')
      return (
        <span key={i} onClick={() => { setChatOpen(false); navigate(route) }}
              style={{ color: '#CECBF6', background: 'rgba(127,119,221,0.18)', border: '1px solid rgba(127,119,221,0.35)',
                       borderRadius: 6, padding: '1px 7px', margin: '0 2px', display: 'inline-block', cursor: 'pointer' }}>
          {label}
        </span>
      )
    })
  }

  const switchPersona = async (creatorId) => {
    setPickerOpen(false)
    setPersonaSearch('')
    try {
      await companionApi.updateConfig({ active_persona_id: creatorId, enabled: true })
      qc.invalidateQueries({ queryKey: ['companion-config'] })
      useVaultStore.getState().bumpChatConfig()
    } catch {}
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    try {
      const res = await fetch(companionApi.chatUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // The backend streams SSE: each event is `data: {"text":"…"}\n\n`, ending
      // with `data: [DONE]`. Line-buffer and JSON.parse each payload to pull the
      // text out — mirrors the desktop CompanionChat parser exactly.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      let lineBuf = ''
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
            if (parsed.error) { full = `⚠ ${parsed.error}`; break outer }
            if (parsed.text) {
              full += parsed.text
              // Strip device tags so they never show as raw text (matches desktop)
              const clean = full.replace(/<device\b[^>]*?\/?>/gi, '').replace(/\n{3,}/g, '\n\n')
              setMessages(m => { const n = [...m]; n[n.length - 1] = { role: 'assistant', content: clean }; return n })
            }
          } catch { /* skip a malformed/partial line */ }
        }
      }
      if (!full) {
        setMessages(m => { const n = [...m]; n[n.length - 1] = { role: 'assistant', content: '(no response — the model may still be loading, try again)' }; return n })
      }
    } catch {
      setMessages(m => { const n = [...m]; n[n.length - 1] = { role: 'assistant', content: '(couldn\'t reach her — is Ollama running on the PC?)' }; return n })
    } finally {
      setBusy(false)
    }
  }

  const hidden = loc.pathname.startsWith('/view/') || loc.pathname.startsWith('/video/') || loc.pathname.startsWith('/photo/')
  if (hidden) return null
  if (config && config.enabled === false && !chatOpen) return null

  const personaAvatar = personaId ? abs(`/api/creators/${personaId}/avatar-thumb?size=96`) : null

  return (
    <>
      {/* Floating bubble */}
      <AnimatePresence>
        {!chatOpen && (
          <motion.button
            key="bubble"
            onClick={() => setChatOpen(true)}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileTap={{ scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            className="fixed z-[60] rounded-full flex items-center justify-center"
            style={{
              right: 14, bottom: 'calc(76px + var(--sab))', width: 52, height: 52,
              background: 'linear-gradient(135deg, var(--accent), #D4537E)',
              border: 'none', boxShadow: '0 6px 24px rgba(127,119,221,0.45)', overflow: 'hidden',
            }}>
            {personaAvatar
              ? <img src={personaAvatar} alt="" className="w-full h-full object-cover"
                     onError={e => { e.target.style.display = 'none' }} />
              : <Sparkles size={22} color="#fff" />}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat sheet — slides up like a real messaging app */}
      {createPortal(
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              key="chat-sheet"
              data-hswipe
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed inset-0 z-[95] flex flex-col"
              style={{ background: 'var(--c-bg)' }}
            >
              {/* header — tap the identity to switch who you're talking to */}
              <div className="flex items-center gap-3 px-4 py-3 border-b"
                   style={{ borderColor: 'var(--c-card)', paddingTop: 'calc(var(--sat, 0px) + 12px)', background: 'var(--c-surface)' }}>
                <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => { setPickerOpen(o => !o); setPersonaSearch('') }}>
                  {personaAvatar ? (
                    <img src={personaAvatar} alt="" onError={e => { e.target.style.visibility = 'hidden' }}
                         className="w-10 h-10 rounded-full object-cover" style={{ border: '2px solid var(--accent)' }} />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center"
                         style={{ background: 'linear-gradient(135deg, var(--accent), #D4537E)' }}>
                      <Sparkles size={18} color="#fff" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[17px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.92)' }}>{name}</span>
                      <ChevronDown size={15} style={{ color: 'rgba(255,255,255,0.4)', transform: pickerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--c-pink)' }}>{busy ? 'typing…' : 'online'}</div>
                  </div>
                </div>
                <button onClick={() => setChatOpen(false)} className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ background: 'var(--c-card)', color: '#fff', border: 'none' }}>
                  <X size={17} />
                </button>
              </div>

              {/* persona picker — Erika + your favorites */}
              <AnimatePresence>
                {pickerOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden border-b" style={{ background: 'var(--c-surface)', borderColor: 'var(--c-card)' }}>
                    {/* predictive search across all creators */}
                    <div className="px-3 pt-2.5 pb-1.5">
                      <input
                        value={personaSearch}
                        onChange={e => setPersonaSearch(e.target.value)}
                        placeholder="Search creators…"
                        className="w-full rounded-full px-4 py-2 text-[14px] outline-none"
                        style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.9)', border: 'none' }}
                      />
                    </div>
                    <div className="max-h-[42vh] overflow-y-auto pb-1">
                      {/* Erika / default — only when not searching */}
                      {!query && (
                        <button onClick={() => switchPersona(null)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-left" style={{ background: 'none', border: 'none' }}>
                          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                               style={{ background: 'linear-gradient(135deg, var(--accent), #D4537E)' }}>
                            <Sparkles size={16} color="#fff" />
                          </div>
                          <span className="flex-1 text-[15px]" style={{ color: 'rgba(255,255,255,0.85)' }}>{config?.name || 'Erika'} <span style={{ color: 'rgba(255,255,255,0.35)' }}>· default</span></span>
                          {!personaId && <Check size={16} style={{ color: 'var(--accent)' }} />}
                        </button>
                      )}
                      {personaList.map(c => (
                        <button key={c.id} onClick={() => switchPersona(c.id)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-left" style={{ background: 'none', border: 'none' }}>
                          <img src={abs(`/api/creators/${c.id}/avatar-thumb?size=96`)} alt=""
                               onError={e => { e.target.style.visibility = 'hidden' }}
                               className="w-9 h-9 rounded-full object-cover shrink-0" style={{ border: '1.5px solid rgba(127,119,221,0.4)' }} />
                          <span className="flex-1 text-[15px] truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>{c.name}</span>
                          {personaId === c.id && <Check size={16} style={{ color: 'var(--accent)' }} />}
                        </button>
                      ))}
                      {query && personaList.length === 0 && (
                        <div className="px-4 py-3 text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>No creators found</div>
                      )}
                      {!query && (favorites ?? []).length === 0 && (
                        <div className="px-4 py-3 text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          Search above to chat with any creator 💜
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
                {messages.length === 0 && (
                  <div className="text-center text-[14px] mt-10" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    Say hi to {name} 💜
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap"
                       style={m.role === 'user'
                         ? { alignSelf: 'flex-end', background: 'var(--accent)', color: '#fff', borderBottomRightRadius: 6 }
                         : { alignSelf: 'flex-start', background: 'var(--c-card)', color: 'rgba(255,255,255,0.88)', borderBottomLeftRadius: 6 }}>
                    {renderMessage(m.content)}
                  </div>
                ))}
              </div>

              {/* input */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-t"
                   style={{ borderColor: 'var(--c-card)', background: 'var(--c-surface)', paddingBottom: 'calc(10px + var(--sab))' }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && send()}
                  placeholder={`Message ${name}…`}
                  className="flex-1 rounded-full px-4 py-2.5 text-[15px] outline-none"
                  style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.9)', border: 'none' }}
                />
                <motion.button onClick={send} disabled={busy || !input.trim()} whileTap={{ scale: 0.85 }}
                        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: 'var(--accent)', color: '#fff', border: 'none', opacity: busy || !input.trim() ? 0.4 : 1 }}>
                  <Send size={18} />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
