// Explore — lives to the RIGHT of the main UI (swipe left from any tab, IG-style).
// Masonry grid of the whole collection that learns your taste; tapping a tile
// opens an immersive snap-scroll stream of post-style cards ("reels" feel).
// ⚠️ NO framer entrance/exit animations in the immersive view — heavy image
// decode starves rAF and freezes them (see desktop Explore for the war story).
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Compass, Sparkles, Heart, FolderOpen, Play, Search, X } from 'lucide-react'
import { feedApi } from '../lib/api.js'
import { abs } from '../lib/server.js'
import { Spinner } from '../components/ui.jsx'
import { VideoSlide, creatorAvatar } from '../components/FeedBits.jsx'

// Module-level cache: opening a photo navigates away and unmounts this page —
// without this you'd lose the exact stream (and the post you wanted to like).
// The cache is only considered fresh for EXPLORE_TTL after you leave; come back
// later (or restart the app, which clears module state) and you get a new feed.
const EXPLORE_TTL = 30_000
const CACHE = {
  mode: 'grid', seedItem: null,
  grid: { items: [], seen: new Set() },
  stream: { items: [], seen: new Set() },
  gridScroll: 0, streamScroll: 0,
  savedAt: 0,   // set on unmount; 0 while mounted/active
}

function resetCache() {
  CACHE.mode = 'grid'
  CACHE.seedItem = null
  CACHE.grid = { items: [], seen: new Set() }
  CACHE.stream = { items: [], seen: new Set() }
  CACHE.gridScroll = 0
  CACHE.streamScroll = 0
}

function useEndless(seedImage, batch, bucket) {
  const [items, setItems] = useState(bucket.items)
  const [loading, setLoading] = useState(false)
  const loadMore = useCallback(async () => {
    setLoading(true)
    try {
      const r = await feedApi.explore(seedImage, batch)
      const fresh = (r.data || []).filter(it => !bucket.seen.has(it.id) && bucket.seen.add(it.id))
      setItems(prev => { const next = [...prev, ...fresh]; bucket.items = next; return next })
    } catch {}
    finally { setLoading(false) }
  }, [seedImage, batch, bucket])
  const reset = useCallback((prime = []) => {
    bucket.seen = new Set(prime)
    bucket.items = []
    setItems([])
  }, [bucket])
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

function StreamCard({ item, onOpenVault, onOpenCreator, saveTag = null }) {
  const [liked, setLiked] = useState(!!item._liked)
  const [burst, setBurst] = useState(false)
  const tapTimer = useRef(null)

  const like = () => {
    const next = !liked
    setLiked(next)
    item._liked = next   // survives in the module cache so it sticks when you come back
    // Search mode: liking PERSISTS this ephemeral post into the real feed
    if (saveTag != null) feedApi.searchSave(item.id, saveTag).catch(() => { setLiked(!next); item._liked = !next })
    else if (next) feedApi.exploreInteract(item.id, 2).catch(() => {})
  }
  // IG rules: double tap = like, single tap = open (after a short delay)
  const tap = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current); tapTimer.current = null
      if (!liked) like()
      setBurst(true); setTimeout(() => setBurst(false), 650)
    } else {
      tapTimer.current = setTimeout(() => { tapTimer.current = null; onOpenVault(item) }, 280)
    }
  }
  useEffect(() => () => clearTimeout(tapTimer.current), [])
  return (
    <div style={{ scrollSnapAlign: 'center', scrollSnapStop: 'always' }}>
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--c-surface)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {item.creator ? (
            <>
              <img src={creatorAvatar(item.creator) || ''} alt=""
                   onClick={() => onOpenCreator(item.creator.id)}
                   onError={e => { e.target.style.visibility = 'hidden' }}
                   className="w-10 h-10 rounded-full object-cover shrink-0"
                   style={{ border: '2px solid rgba(127,119,221,0.55)' }} />
              <div className="min-w-0 flex-1" onClick={() => onOpenCreator(item.creator.id)}>
                <div className="text-[15px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.92)' }}>{item.creator.name}</div>
                <div className="text-[12px] truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>@{item.creator.handle}</div>
              </div>
            </>
          ) : <div className="flex-1 text-[14px]" style={{ color: 'rgba(255,255,255,0.5)' }}>From your vault</div>}
          <div className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium shrink-0"
               style={{ background: 'rgba(127,119,221,0.16)', color: 'var(--accent)' }}>
            <Sparkles size={12} /> {saveTag != null ? `#${saveTag}` : 'For you'}
          </div>
        </div>
        {/* overflow-hidden is load-bearing: blur bg is scaled and bleeds otherwise */}
        <div className="relative overflow-hidden" style={{ height: '58vh', background: '#0a0a0a' }}
             onClick={() => !item.is_video && tap()}>
          {burst && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 5 }}>
              <Heart size={90} fill="#FF2D75" stroke="none" style={{ filter: 'drop-shadow(0 4px 24px rgba(255,45,117,0.6))', animation: 'heartPop 0.6s ease' }} />
            </div>
          )}
          {item.is_video ? (
            <VideoSlide image={item} onClick={() => tap()} />
          ) : (
            <>
              <img src={abs(`/api/images/${item.id}/thumb`)} alt="" aria-hidden
                   className="absolute inset-0 w-full h-full object-cover"
                   style={{ filter: 'blur(24px) brightness(0.5)', transform: 'scale(1.25)' }} />
              <img src={abs(`/api/images/${item.id}/preview?w=1080`)} alt="" loading="lazy"
                   className="relative w-full h-full object-contain"
                   onError={e => { e.target.style.opacity = 0 }} />
            </>
          )}
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button onClick={like} style={{ color: liked ? '#FF2D75' : 'rgba(255,255,255,0.7)', background: 'none', border: 'none' }}>
            <Heart size={24} fill={liked ? '#FF2D75' : 'none'} />
          </button>
          <button onClick={() => onOpenVault(item)} style={{ color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none' }}>
            <FolderOpen size={22} />
          </button>
          <span className="ml-auto text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {saveTag != null
              ? (liked ? 'saved to your feed 💜' : 'tap ♥ to save')
              : (liked ? 'the algorithm hears you 💜' : 'like it to see more')}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Explore() {
  const navigate = useNavigate()

  // Once per mount, before reading the cache into state: if we've been away
  // longer than the TTL, wipe it so this visit starts a fresh feed. savedAt is
  // cleared to 0 so a re-render can never re-trigger this mid-session.
  const hydrated = useRef(false)
  if (!hydrated.current) {
    hydrated.current = true
    if (CACHE.savedAt && Date.now() - CACHE.savedAt > EXPLORE_TTL) resetCache()
    CACHE.savedAt = 0
  }

  const [mode, setModeState] = useState(CACHE.mode)
  const [seedItem, setSeedItem] = useState(CACHE.seedItem)
  const streamRef = useRef(null)

  const setMode = (m) => { CACHE.mode = m; setModeState(m) }
  const grid = useEndless(null, 20, CACHE.grid)
  const stream = useEndless(seedItem?.id ?? null, 8, CACHE.stream)

  useEffect(() => { if (CACHE.grid.items.length === 0) grid.loadMore() }, [])

  // Stamp the leave time on unmount — starts the TTL clock for the next visit.
  useEffect(() => () => { CACHE.savedAt = Date.now() }, [])

  // Restore scroll position when returning from a photo/video
  useEffect(() => {
    if (mode === 'immersive' && streamRef.current) streamRef.current.scrollTop = CACHE.streamScroll
    if (mode === 'grid') window.scrollTo(0, CACHE.gridScroll)
  }, [mode])

  const openImmersive = (item) => {
    feedApi.exploreInteract(item.id).catch(() => {})
    CACHE.seedItem = item
    CACHE.streamScroll = 0
    setSeedItem(item)
    stream.reset([item.id])
    setTimeout(stream.loadMore, 0)
    setMode('immersive')
  }
  const openInVault = (item) => {
    feedApi.exploreInteract(item.id).catch(() => {})
    if (streamRef.current) CACHE.streamScroll = streamRef.current.scrollTop
    if (item.is_video) navigate(`/video/${item.id}`)
    else navigate(`/photo/${item.id}`)
  }
  const openCreator = (id) => navigate(`/feed?creator_id=${id}`)
  const streamItems = seedItem ? [seedItem, ...stream.items.filter(i => i.id !== seedItem.id)] : stream.items

  // ── Smart search (local state — transient, independent of the explore CACHE) ──
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState(null)                                 // { q, seed } or null
  const [searchData, setSearchData] = useState({ creators: [], images: [], tag: null })
  const [searchSkip, setSearchSkip] = useState(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchView, setSearchView] = useState('results')                    // 'results' | 'immersive'
  const [searchSeedItem, setSearchSeedItem] = useState(null)
  const searchStreamRef = useRef(null)

  const loadSearch = async (q, seed, skip, fresh) => {
    setSearchLoading(true)
    try {
      const r = await feedApi.search(q, seed, skip, 24).then(res => res.data)
      setSearchData(prev => fresh ? r : {
        creators: prev.creators, tag: prev.tag || r.tag,
        images: [...prev.images, ...(r.images || [])],
      })
    } catch {} finally { setSearchLoading(false) }
  }
  const runSearch = () => {
    const q = searchInput.trim()
    if (!q) return clearSearch()
    const seed = Math.floor(Math.random() * 99991) + 1
    setSearch({ q, seed }); setSearchSkip(0); setSearchView('results'); setSearchSeedItem(null)
    setSearchData({ creators: [], images: [], tag: null })
    loadSearch(q, seed, 0, true)
  }
  const clearSearch = () => {
    setSearchInput(''); setSearch(null); setSearchView('results'); setSearchSeedItem(null)
    setSearchData({ creators: [], images: [], tag: null })
  }
  const loadMoreSearch = () => {
    if (!search) return
    const next = searchSkip + 24; setSearchSkip(next)
    loadSearch(search.q, search.seed, next, false)
  }
  const openSearchImmersive = (item) => { setSearchSeedItem(item); setSearchView('immersive') }
  const searchStreamItems = searchSeedItem
    ? [searchSeedItem, ...searchData.images.filter(i => i.id !== searchSeedItem.id)]
    : searchData.images
  const saveTag = searchData.tag?.name ?? null

  const inSearchImmersive = !!search && searchView === 'immersive'
  const inExploreImmersive = !search && mode === 'immersive'
  const showBar = !inSearchImmersive && !inExploreImmersive

  const GridTile = (item, onTap) => {
    const ar = item.width && item.height ? Math.min(2, Math.max(0.5, item.width / item.height)) : 1
    return (
      <button key={item.id} onClick={() => onTap(item)}
              className="relative w-full mb-2 overflow-hidden bg-transparent block"
              style={{ borderRadius: 12, border: 'none', breakInside: 'avoid', padding: 0 }}>
        <div style={{ aspectRatio: String(ar), background: 'var(--c-card)' }}>
          <img src={abs(`/api/images/${item.id}/thumb`)} alt="" loading="lazy"
               className="w-full h-full object-cover" onError={e => { e.target.style.opacity = 0 }} />
        </div>
        {item.is_video && (
          <div className="absolute top-1.5 right-1.5" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}>
            <Play size={15} color="#fff" fill="#fff" />
          </div>
        )}
      </button>
    )
  }

  return (
    <div className="px-3 pt-3">
      <div className="flex items-center gap-2 mb-3 px-1">
        {(inSearchImmersive || inExploreImmersive) ? (
          <button onClick={() => inSearchImmersive ? setSearchView('results') : setMode('grid')}
                  className="flex items-center gap-1 text-[14px] px-2.5 py-1.5 rounded-full"
                  style={{ color: 'rgba(255,255,255,0.8)', background: 'var(--c-card)', border: 'none' }}>
            <ArrowLeft size={14} /> {inSearchImmersive ? (search?.q ? `#${searchData.tag?.name || search.q}` : 'Back') : 'Explore'}
          </button>
        ) : (
          <>
            <Compass size={20} style={{ color: 'var(--accent)' }} />
            <div>
              <div className="text-[20px] font-bold leading-tight" style={{ color: 'rgba(255,255,255,0.92)' }}>Explore</div>
              <div className="text-[12px] flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.38)' }}>
                <Sparkles size={11} /> Learns what you like the more you tap
              </div>
            </div>
          </>
        )}
      </div>

      {/* Search bar */}
      {showBar && (
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.35)' }} />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.currentTarget.blur(), runSearch())}
            placeholder="Search creators or #tags…"
            className="w-full rounded-full pl-10 pr-10 py-2.5 text-[15px] outline-none"
            style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.9)', border: 'none' }}
          />
          {(searchInput || search) && (
            <button onClick={clearSearch}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', border: 'none' }}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* ── Search results ─────────────────────────────────────────────── */}
      {search && searchView === 'results' ? (
        <>
          {searchData.creators.length > 0 && (
            <div className="mb-4">
              <div className="text-[12px] uppercase tracking-wide mb-2 px-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Creators</div>
              <div className="flex gap-3.5 overflow-x-auto pb-1" data-hswipe style={{ scrollbarWidth: 'none' }}>
                {searchData.creators.map(c => (
                  <button key={c.id} onClick={() => openCreator(c.id)}
                          className="flex flex-col items-center gap-1 shrink-0" style={{ width: 72, background: 'none', border: 'none' }}>
                    <img src={c.has_avatar ? abs(`/api/creators/${c.id}/avatar-thumb?size=96`) : '/logo.png'} alt=""
                         onError={e => { if (!(e.target.src || '').endsWith('/logo.png')) e.target.src = '/logo.png' }}
                         className="w-14 h-14 rounded-full object-cover" style={{ border: '2px solid rgba(127,119,221,0.5)' }} />
                    <span className="text-[12px] truncate w-full text-center" style={{ color: 'rgba(255,255,255,0.7)' }}>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {searchData.tag ? (
            <>
              <div className="text-[13px] mb-2 px-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
                <span style={{ color: '#8AB4F8' }}>#{searchData.tag.name}</span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}> · {searchData.tag.count} tagged · tap ♥ inside to keep</span>
              </div>
              <div style={{ columnCount: 2, columnGap: 8 }}>
                {searchData.images.map(item => GridTile(item, openSearchImmersive))}
              </div>
              <Sentinel onHit={loadMoreSearch} />
            </>
          ) : searchData.creators.length === 0 && !searchLoading ? (
            <div className="py-16 text-center text-[15px]" style={{ color: 'rgba(255,255,255,0.35)' }}>No creators or tags match “{search.q}”</div>
          ) : null}
          {searchLoading && searchData.images.length === 0 && <Spinner />}
        </>
      ) : search && searchView === 'immersive' ? (
        /* Search immersive — liking a card saves it into the real feed */
        <div ref={searchStreamRef} className="flex flex-col gap-4" data-hswipe
             style={{ height: 'calc(100vh - 170px)', overflowY: 'auto', scrollSnapType: 'y mandatory', scrollbarWidth: 'none', paddingBottom: '18vh' }}>
          {searchStreamItems.map(item => (
            <StreamCard key={item.id} item={item} onOpenVault={openInVault} onOpenCreator={openCreator} saveTag={saveTag} />
          ))}
          <Sentinel onHit={loadMoreSearch} />
          <div className="py-6 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.25)', scrollSnapAlign: 'none' }}>
            {searchLoading ? 'Loading…' : 'Keep scrolling ✨'}
          </div>
        </div>
      ) : mode === 'grid' ? (
        <>
          {grid.items.length === 0 && <Spinner />}
          <div style={{ columnCount: 2, columnGap: 8 }}>
            {grid.items.map(item => GridTile(item, openImmersive))}
          </div>
          <Sentinel onHit={grid.loadMore} />
        </>
      ) : (
        /* explore immersive — one card in focus at a time */
        <div ref={streamRef} className="flex flex-col gap-4" data-hswipe
             style={{ height: 'calc(100vh - 170px)', overflowY: 'auto', scrollSnapType: 'y mandatory', scrollbarWidth: 'none', paddingBottom: '18vh' }}>
          {streamItems.map(item => (
            <StreamCard key={item.id} item={item} onOpenVault={openInVault} onOpenCreator={openCreator} />
          ))}
          <Sentinel onHit={stream.loadMore} />
          <div className="py-6 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.25)', scrollSnapAlign: 'none' }}>
            {stream.loading ? 'Loading…' : 'Keep scrolling — it never ends ✨'}
          </div>
        </div>
      )}
      <style>{`@keyframes heartPop { 0% { transform: scale(0); opacity: 0.9 } 40% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1.3); opacity: 0 } }`}</style>
    </div>
  )
}
