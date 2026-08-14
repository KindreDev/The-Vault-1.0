import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Compass, ArrowLeft, Play, Sparkles, Heart, FolderOpen, Search, X } from 'lucide-react'
import { feedApi } from '../lib/api'
import HoverVideoPreview from '../components/HoverVideoPreview'
import { VideoSlide } from '../components/feed/FeedPost'
import { useT } from '../i18n'

// ── Endless batch loader — each call appends a fresh algorithmic batch ─────────
function useEndlessExplore(seedImage, batch) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const seenRef = useRef(new Set())

  const loadMore = useCallback(async () => {
    setLoading(true)
    try {
      const r = await feedApi.explore(seedImage, batch)
      const fresh = (r.data || []).filter(it => {
        if (seenRef.current.has(it.id)) return false
        seenRef.current.add(it.id)
        return true
      })
      setItems(prev => [...prev, ...fresh])
    } catch {}
    finally { setLoading(false) }
  }, [seedImage, batch])

  const reset = useCallback((primeIds = []) => {
    seenRef.current = new Set(primeIds)
    setItems([])
  }, [])

  return { items, loading, loadMore, reset }
}

function Sentinel({ onHit }) {
  const ioRef = useRef(null)
  const ref = useCallback(node => {
    ioRef.current?.disconnect()
    if (!node) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) onHit() }, { rootMargin: '1200px' })
    io.observe(node)
    ioRef.current = io
  }, [onHit])
  return <div ref={ref} style={{ height: 1 }} />
}

// ── Masonry grid cell ─────────────────────────────────────────────────────────
function GridCell({ item, i, onOpen }) {
  const [hovered, setHovered] = useState(false)
  const ar = item.width && item.height ? item.width / item.height : 1
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: (i % 15) * 0.02, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => onOpen(item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="fx-btn relative w-full mb-2.5 overflow-hidden cursor-pointer bg-transparent block"
      style={{ borderRadius: 12, border: '0.5px solid rgba(255,255,255,0.08)', breakInside: 'avoid' }}
    >
      <div style={{ aspectRatio: String(Math.min(2, Math.max(0.5, ar))), background: '#161618' }}>
        <img src={`/api/images/${item.id}/thumb`} alt=""
             className="w-full h-full object-cover"
             style={{ transform: hovered ? 'scale(1.05)' : 'scale(1)', transition: 'transform 0.35s ease' }}
             onError={e => { e.target.style.opacity = 0 }} />
        {item.is_video && <HoverVideoPreview imageId={item.id} hovered={hovered} />}
      </div>
      {item.is_video && !hovered && (
        <div className="absolute top-2 right-2" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}>
          <Play size={16} color="#fff" fill="#fff" />
        </div>
      )}
    </motion.button>
  )
}

// ── Immersive card — a full IG-style post, one in focus at a time ─────────────
function ExplorePostCard({ item, onOpenVault, onOpenCreator, saveTag = null }) {
  const t = useT()
  const [liked, setLiked] = useState(false)

  const like = () => {
    const next = !liked
    setLiked(next)
    // In search mode, liking PERSISTS the ephemeral post into the real feed
    if (saveTag != null) feedApi.searchSave(item.id, saveTag).catch(() => setLiked(l => !l))
    else if (next) feedApi.exploreInteract(item.id, 2).catch(() => {})
  }

  return (
    <div className="mx-auto w-full" style={{ maxWidth: 620, scrollSnapAlign: 'center', scrollSnapStop: 'always' }}>
      {/* NO entrance animation here on purpose: decoding several 1080p images +
          blur filters starves rAF in this view, leaving framer fades frozen
          half-transparent (unreadable headers). Static = always crisp. */}
      <div
        className="rounded-[14px] overflow-hidden"
        style={{ background: '#161618', border: '0.5px solid rgba(255,255,255,0.09)' }}
      >
        {/* Header — the owning creator, like a real post */}
        <div className="flex items-center gap-3 px-4 py-3">
          {item.creator ? (
            <>
              <img
                src={item.creator.has_avatar ? `/api/creators/${item.creator.id}/avatar-thumb?size=96` : '/logo.png'}
                alt="" onError={e => { if (!e.target.src.endsWith('/logo.png')) e.target.src = '/logo.png' }}
                onClick={() => onOpenCreator(item.creator.id)}
                className="w-11 h-11 rounded-full object-cover cursor-pointer flex-shrink-0"
                style={{ border: '2px solid color-mix(in srgb, var(--c-accent) 55%, transparent)' }}
              />
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onOpenCreator(item.creator.id)}>
                <div className="text-[16px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.92)' }}>
                  {item.creator.name}
                </div>
                <div className="text-[13px] truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>
                  @{item.creator.handle}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 text-[15px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{t('From your vault')}</div>
          )}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-medium flex-shrink-0"
               style={{ background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)', color: '#A79FF0' }}>
            <Sparkles size={13} /> {saveTag != null ? `#${saveTag}` : t('For you')}
          </div>
        </div>

        {/* Media — fixed height so every card snaps identically.
            overflow-hidden is load-bearing: the blurred backdrop is scaled 1.25×
            and would otherwise bleed over the header, dimming it AND eating clicks. */}
        <div className="relative cursor-pointer overflow-hidden" style={{ height: '62vh', background: '#0a0a0a' }}
             onClick={() => !item.is_video && onOpenVault(item)}>
          {item.is_video ? (
            /* Same in-view autoplay + corner mute as feed posts */
            <VideoSlide image={item} onClick={() => onOpenVault(item)} />
          ) : (
            <>
              <img src={`/api/images/${item.id}/thumb`} alt="" aria-hidden
                   className="absolute inset-0 w-full h-full object-cover"
                   style={{ filter: 'blur(26px) brightness(0.5)', transform: 'scale(1.25)' }} />
              <img src={`/api/images/${item.id}/preview?w=1080`} alt=""
                   className="relative w-full h-full object-contain" loading="lazy"
                   onError={e => { e.target.style.opacity = 0 }} />
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-4 py-3">
          <motion.button onClick={like} whileTap={{ scale: 0.8 }} whileHover={{ scale: 1.12 }}
                         className="fx-btn cursor-pointer flex items-center justify-center bg-transparent"
                         style={{ color: liked ? '#FF2D75' : 'rgba(255,255,255,0.7)', border: 'none', transition: 'color 0.2s' }}>
            <Heart size={24} fill={liked ? '#FF2D75' : 'none'} />
          </motion.button>
          <button onClick={() => onOpenVault(item)} title={t('Open in Vault')}
                  className="cursor-pointer flex items-center justify-center bg-transparent"
                  style={{ color: 'rgba(255,255,255,0.7)', border: 'none' }}>
            <FolderOpen size={22} />
          </button>
          <span className="ml-auto text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {saveTag != null
              ? (liked ? t('saved to your feed 💜') : t('tap ♥ to save to your feed'))
              : (liked ? t('the algorithm hears you 💜') : t('like it to see more like this'))}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Explore() {
  const t = useT()
  const navigate = useNavigate()
  const [mode, setMode] = useState('grid')       // 'grid' | 'immersive'
  const [seedItem, setSeedItem] = useState(null)  // the tile you tapped — always shown first

  // ── Smart search: creators by name + seed-shuffled tag content ──────────────
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState(null)                                  // { q, seed } or null
  const [searchData, setSearchData] = useState({ creators: [], images: [], tag: null })
  const [searchSkip, setSearchSkip] = useState(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchImmersive, setSearchImmersive] = useState(false)               // immersive fed by search

  const grid = useEndlessExplore(null, 24)
  const stream = useEndlessExplore(seedItem?.id ?? null, 8)

  useEffect(() => { grid.loadMore() }, [])           // initial grid
  useEffect(() => {
    if (mode === 'immersive' && !searchImmersive && seedItem) {
      stream.reset([seedItem.id])   // never duplicate the seed in the stream
      setTimeout(stream.loadMore, 0)
    }
  }, [seedItem, mode, searchImmersive])

  const loadSearch = async (q, seed, skip, fresh) => {
    setSearchLoading(true)
    try {
      const r = await feedApi.search(q, seed, skip, 24)
      setSearchData(prev => fresh ? r.data : {
        creators: prev.creators,
        tag: prev.tag || r.data.tag,
        images: [...prev.images, ...(r.data.images || [])],
      })
    } catch {}
    finally { setSearchLoading(false) }
  }
  const runSearch = () => {
    const q = searchInput.trim()
    if (!q) return clearSearch()
    const seed = Math.floor(Math.random() * 99991) + 1   // fresh picks every search
    setSearch({ q, seed }); setSearchSkip(0); setSearchImmersive(false); setMode('grid')
    setSearchData({ creators: [], images: [], tag: null })
    loadSearch(q, seed, 0, true)
  }
  const clearSearch = () => {
    setSearchInput(''); setSearch(null); setSearchImmersive(false)
    setSearchData({ creators: [], images: [], tag: null })
  }
  const loadMoreSearch = () => {
    if (!search) return
    const next = searchSkip + 24
    setSearchSkip(next)
    loadSearch(search.q, search.seed, next, false)
  }

  const openImmersive = (item) => {
    feedApi.exploreInteract(item.id).catch(() => {})
    setSeedItem(item); setSearchImmersive(false); setMode('immersive')
  }
  const openSearchImmersive = (item) => { setSeedItem(item); setSearchImmersive(true); setMode('immersive') }
  const openInVault = (item) => {
    feedApi.exploreInteract(item.id).catch(() => {})
    if (item.gallery_id) navigate(`/galleries/${item.gallery_id}?openImage=${item.id}`)
  }
  const openCreator = (id) => navigate(`/feed?creator_id=${id}`)

  const streamItems = seedItem ? [seedItem, ...stream.items.filter(i => i.id !== seedItem.id)] : stream.items
  const searchStreamItems = seedItem ? [seedItem, ...searchData.images.filter(i => i.id !== seedItem.id)] : searchData.images
  const inSearch = !!search
  const saveTag = searchData.tag?.name ?? null

  return (
    <div className="p-3 md:p-6">
      {/* Header + search */}
      <div className="max-w-[1100px] mx-auto mb-5">
        <div className="flex items-center gap-3 mb-4">
          {mode === 'immersive' ? (
            <button onClick={() => setMode('grid')}
                    className="flex items-center gap-1.5 text-[15px] px-3 py-2 rounded-full cursor-pointer"
                    style={{ color: 'rgba(255,255,255,0.8)', background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
              <ArrowLeft size={15} /> {t('Explore')}
            </button>
          ) : (
            <>
              <div className="w-10 h-10 rounded-[12px] flex items-center justify-center"
                   style={{ background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                <Compass size={18} style={{ color: '#A79FF0' }} />
              </div>
              <div>
                <div className="text-[22px] font-semibold" style={{ color: 'rgba(255,255,255,0.92)' }}>{t('Explore')}</div>
                <div className="text-[14px] flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.38)' }}>
                  <Sparkles size={12} /> {t('Learns what you like the more you tap')}
                </div>
              </div>
            </>
          )}
        </div>
        {mode !== 'immersive' && (
          <div className="relative">
            <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.35)' }} />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runSearch()}
              placeholder={t('Search creators or #tags…')}
              className="w-full rounded-full pl-11 pr-11 py-2.5 text-[15px] outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.9)' }}
            />
            {(searchInput || inSearch) && (
              <button onClick={clearSearch}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', border: 'none' }}>
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* NO AnimatePresence: heavy image decode starves rAF and freezes mode="wait" exits. */}
      {mode === 'immersive' ? (
        <div className="flex flex-col gap-6"
             style={{ height: 'calc(100vh - 150px)', overflowY: 'auto', scrollSnapType: 'y mandatory', scrollbarWidth: 'none', paddingBottom: '20vh' }}>
          {(searchImmersive ? searchStreamItems : streamItems).map(item => (
            <ExplorePostCard key={item.id} item={item} onOpenVault={openInVault} onOpenCreator={openCreator}
                             saveTag={searchImmersive ? saveTag : null} />
          ))}
          <Sentinel onHit={searchImmersive ? loadMoreSearch : stream.loadMore} />
          <div className="py-8 text-[14px] text-center" style={{ color: 'rgba(255,255,255,0.25)', scrollSnapAlign: 'none' }}>
            {(searchImmersive ? searchLoading : stream.loading) ? t('Loading…') : t('Keep scrolling — it never ends ✨')}
          </div>
        </div>
      ) : inSearch ? (
        <div className="max-w-[1100px] mx-auto">
          {/* Creator matches */}
          {searchData.creators.length > 0 && (
            <div className="mb-6">
              <div className="text-[13px] uppercase tracking-wide mb-2.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('Creators')}</div>
              <div className="flex gap-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {searchData.creators.map(c => (
                  <button key={c.id} onClick={() => openCreator(c.id)}
                          className="flex flex-col items-center gap-1.5 flex-shrink-0 cursor-pointer" style={{ width: 92, background: 'none', border: 'none' }}>
                    <img src={c.has_avatar ? `/api/creators/${c.id}/avatar-thumb?size=96` : '/logo.png'} alt=""
                         onError={e => { if (!e.target.src.endsWith('/logo.png')) e.target.src = '/logo.png' }}
                         className="w-16 h-16 rounded-full object-cover" style={{ border: '2px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }} />
                    <span className="text-[13px] truncate w-full text-center" style={{ color: 'rgba(255,255,255,0.7)' }}>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Tag content grid */}
          {searchData.tag ? (
            <>
              <div className="text-[14px] mb-2.5 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                <span style={{ color: '#8AB4F8' }}>#{searchData.tag.name}</span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>· {searchData.tag.count} {t('tagged')} · {t('tap ♥ inside a post to keep it')}</span>
              </div>
              <div className="explore-masonry" style={{ columnCount: 4, columnGap: 10 }}>
                {searchData.images.map((item, i) => (
                  <GridCell key={item.id} item={item} i={i} onOpen={openSearchImmersive} />
                ))}
              </div>
              <Sentinel onHit={loadMoreSearch} />
            </>
          ) : searchData.creators.length === 0 && !searchLoading ? (
            <div className="py-16 text-center text-[15px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {t('No creators or tags match')} “{search.q}”
            </div>
          ) : null}
          {searchLoading && searchData.images.length === 0 && (
            <div className="py-8 text-center text-[14px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{t('Searching…')}</div>
          )}
        </div>
      ) : (
        <div className="explore-masonry max-w-[1100px] mx-auto" style={{ columnCount: 4, columnGap: 10 }}>
          {grid.items.map((item, i) => (
            <GridCell key={item.id} item={item} i={i} onOpen={openImmersive} />
          ))}
          <Sentinel onHit={grid.loadMore} />
        </div>
      )}

      {/* Masonry column-count responsiveness */}
      <style>{`
        @media (max-width: 1100px) { .explore-masonry { column-count: 3 !important; } }
        @media (max-width: 720px)  { .explore-masonry { column-count: 2 !important; } }
      `}</style>
    </div>
  )
}
