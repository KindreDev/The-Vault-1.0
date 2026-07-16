import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Newspaper, ArrowLeft, BadgeCheck, ExternalLink, MessageCircleHeart, X, Compass } from 'lucide-react'
import { feedApi, creatorsApi, companionApi } from '../lib/api.js'
import { abs } from '../lib/server.js'
import { useVaultStore } from '../store/vault.js'
import { Spinner, Empty } from '../components/ui.jsx'
import FeedPost, { StoriesRow, StoryViewer, creatorAvatar } from '../components/FeedBits.jsx'

const PAGE_SIZE = 6

function fmtCount(n) {
  if (n == null) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

// ── Lean sim profile header ───────────────────────────────────────────────────
function SimProfile({ profile, onBack }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const setChatOpen = useVaultStore(s => s.setChatOpen)
  const bumpChatConfig = useVaultStore(s => s.bumpChatConfig)
  const openDM = async () => {
    try {
      await companionApi.updateConfig({ active_persona_id: profile.id, enabled: true })
      bumpChatConfig()
      setChatOpen(true)
    } catch {}
  }
  const follow = () => {
    // Follow = favorite; optimistic flip
    qc.setQueryData(['feed-profile', String(profile.id)], p => p ? { ...p, is_favorite: !p.is_favorite } : p)
    creatorsApi.update(profile.id, { is_favorite: !profile.is_favorite }).catch(() => {})
  }
  const bannerSrc = profile.banner_image_id
    ? abs(`/api/images/${profile.banner_image_id}/file`)
    : profile.has_banner ? abs(`/api/creators/${profile.id}/banner`) : null

  return (
    <div className="rounded-2xl overflow-hidden mb-4" style={{ background: 'var(--c-surface)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      <div className="relative" style={{ height: 150, background: 'rgba(127,119,221,0.08)' }}>
        {bannerSrc && <img src={bannerSrc} alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => { e.target.style.display = 'none' }} />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2), var(--c-surface))' }} />
        <button onClick={onBack} className="absolute top-3 left-3 flex items-center gap-1 text-[13px] px-2.5 py-1.5 rounded-full"
                style={{ color: '#fff', background: 'rgba(0,0,0,0.5)', border: 'none', zIndex: 2 }}>
          <ArrowLeft size={13} /> Feed
        </button>
        <button onClick={() => navigate(`/creator/${profile.id}`)}
                className="absolute top-3 right-3 flex items-center gap-1 text-[13px] px-2.5 py-1.5 rounded-full"
                style={{ color: '#fff', background: 'rgba(0,0,0,0.5)', border: 'none', zIndex: 2 }}>
          <ExternalLink size={12} /> Vault
        </button>
      </div>
      <div className="px-4 pb-4">
        <div className="flex items-end gap-3 -mt-12">
          <img src={creatorAvatar(profile, 480) || ''} alt=""
               onError={e => { e.target.style.visibility = 'hidden' }}
               className="w-[92px] h-[92px] rounded-full object-cover shrink-0 relative"
               style={{ border: '3px solid var(--accent)', zIndex: 2 }} />
          <div className="min-w-0 flex-1 pb-1" style={{ zIndex: 2 }}>
            <div className="flex items-center gap-1.5">
              <span className="text-[19px] font-semibold truncate" style={{ color: 'rgba(255,255,255,0.95)' }}>{profile.name}</span>
              <BadgeCheck size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            </div>
            <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>@{profile.handle}</div>
          </div>
        </div>
        {/* Follow / Message stack — placed BELOW the identity row so neither
            button is buried under the banner's absolutely-positioned image */}
        <div className="flex flex-col items-end gap-1.5 mt-2.5">
          <button onClick={follow}
                  className="w-32 px-4 py-1.5 rounded-lg text-[13px] font-semibold"
                  style={profile.is_favorite
                    ? { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: 'none' }
                    : { background: 'var(--accent)', color: '#fff', border: 'none' }}>
            {profile.is_favorite ? 'Following ✓' : 'Follow'}
          </button>
          <button onClick={openDM}
                  className="w-32 px-4 py-1.5 rounded-lg text-[13px] font-semibold"
                  style={{ background: 'rgba(212,83,126,0.2)', color: '#ED93B1', border: 'none' }}>
            Message 💬
          </button>
        </div>
        <div className="flex items-center gap-5 mt-3 flex-wrap">
          {[[profile.post_count, 'posts'], [fmtCount(profile.followers), 'followers'], [profile.following, 'following'], [fmtCount(profile.image_count), 'photos'], [fmtCount(profile.video_count), 'videos']].map(([v, l]) => (
            <div key={l} className="flex flex-col">
              <span className="text-[17px] font-semibold leading-tight" style={{ color: 'rgba(255,255,255,0.92)' }}>{v}</span>
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{l}</span>
            </div>
          ))}
        </div>
        {profile.bio && <div className="mt-2.5 text-[14px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>{profile.bio}</div>}
      </div>
    </div>
  )
}

// ── DM ping banner — she texted first ─────────────────────────────────────────
function DMBanner({ ping, onDismiss }) {
  const qc = useQueryClient()
  const setChatOpen = useVaultStore(s => s.setChatOpen)
  const bumpChatConfig = useVaultStore(s => s.bumpChatConfig)

  const markRead = () => { feedApi.dmRead(ping.id).catch(() => {}); qc.invalidateQueries({ queryKey: ['feed-dm'] }); onDismiss?.() }
  const reply = async () => {
    try {
      await companionApi.updateConfig({ active_persona_id: ping.creator.id, enabled: true })
      bumpChatConfig()
      setChatOpen(true)
      markRead()
    } catch { /* chat unavailable */ }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl px-3 py-3 mb-3" onClick={reply}
         style={{ background: 'linear-gradient(120deg, rgba(212,83,126,0.16), rgba(127,119,221,0.12))', border: '0.5px solid rgba(212,83,126,0.35)' }}>
      <img src={creatorAvatar(ping.creator) || ''} alt="" className="w-11 h-11 rounded-full object-cover shrink-0"
           style={{ border: '2px solid rgba(237,147,177,0.7)' }} onError={e => { e.target.style.visibility = 'hidden' }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.92)' }}>
          <MessageCircleHeart size={14} style={{ color: '#ED93B1' }} /> {ping.creator.name} sent you a message
        </div>
        <div className="text-[13px] italic truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>"{ping.message}"</div>
      </div>
      <button onClick={e => { e.stopPropagation(); markRead() }}
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', border: 'none' }}>
        <X size={13} />
      </button>
    </div>
  )
}

// ── Feed page ─────────────────────────────────────────────────────────────────
export default function Feed() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const creatorId = searchParams.get('creator_id')

  const [posts, setPosts] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [generated, setGenerated] = useState(false)
  const [storyGroup, setStoryGroup] = useState(null)
  const [seenIds, setSeenIds] = useState(() => new Set())
  const [dismissed, setDismissed] = useState(() => new Set())
  const ioRef = useRef(null)
  const stateRef = useRef({ hasMore: true, fetching: false })
  const seedRef = useRef(Math.floor(Math.random() * 99991) + 1)

  useEffect(() => { feedApi.generate().catch(() => {}).finally(() => setGenerated(true)) }, [])
  useEffect(() => { setPosts([]); setPage(0); setHasMore(true) }, [creatorId])

  const { data, isFetching } = useQuery({
    queryKey: ['feed-m', creatorId, page],
    queryFn: () => feedApi.list({
      creator_id: creatorId || undefined,
      skip: page * PAGE_SIZE, limit: PAGE_SIZE,
      seed: creatorId ? undefined : seedRef.current,
    }).then(r => r.data),
    enabled: generated,
  })
  useEffect(() => {
    if (!data) return
    setPosts(prev => page === 0 ? data : [...prev, ...data])
    setHasMore(data.length === PAGE_SIZE)
  }, [data])

  const { data: profile } = useQuery({
    queryKey: ['feed-profile', creatorId],
    queryFn: () => feedApi.profile(creatorId).then(r => r.data),
    enabled: !!creatorId,
  })
  const { data: storyGroups } = useQuery({
    queryKey: ['feed-stories'],
    queryFn: () => feedApi.stories().then(r => r.data),
    enabled: generated && !creatorId, staleTime: 60000,
  })
  const { data: pings } = useQuery({
    queryKey: ['feed-dm'],
    queryFn: () => feedApi.dmPings().then(r => r.data),
    enabled: generated && !creatorId, staleTime: 60000,
  })
  const activePing = (pings ?? []).find(p => !dismissed.has(p.id))

  const displayGroups = useMemo(() => {
    if (!storyGroups) return []
    return storyGroups.map(gr => {
      const stories = gr.stories.map(st => ({ ...st, viewed: st.viewed || seenIds.has(st.id) }))
      return { ...gr, stories, all_viewed: stories.every(st => st.viewed) }
    })
  }, [storyGroups, seenIds])

  stateRef.current = { hasMore, fetching: isFetching }
  const sentinelRef = useCallback(node => {
    ioRef.current?.disconnect()
    if (!node) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && stateRef.current.hasMore && !stateRef.current.fetching) setPage(p => p + 1)
    }, { rootMargin: '900px' })
    io.observe(node)
    ioRef.current = io
  }, [])
  useEffect(() => () => ioRef.current?.disconnect(), [])

  const openCreator = (id) => setSearchParams({ creator_id: String(id) })

  return (
    <div className="px-3 pt-3">
      {!creatorId && (
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <Newspaper size={20} style={{ color: 'var(--accent)' }} />
            <span className="text-[20px] font-bold" style={{ color: 'rgba(255,255,255,0.92)' }}>Feed</span>
          </div>
          {/* swipe left anywhere also works — this is the visible affordance */}
          <button onClick={() => navigate('/explore')}
                  className="flex items-center gap-1 text-[13px] px-2.5 py-1.5 rounded-full"
                  style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.6)', border: 'none' }}>
            <Compass size={14} /> Explore
          </button>
        </div>
      )}

      {!creatorId && activePing && <DMBanner ping={activePing} onDismiss={() => setDismissed(prev => new Set(prev).add(activePing.id))} />}
      {!creatorId && <StoriesRow groups={displayGroups} onOpen={setStoryGroup} />}
      {creatorId && profile && <SimProfile profile={profile} onBack={() => setSearchParams({})} />}

      <div className="flex flex-col gap-3.5">
        {posts.map(post => <FeedPost key={post.id} post={post} onCreatorClick={openCreator} />)}
      </div>

      {posts.length === 0 && !isFetching && generated && (
        <Empty icon={<Newspaper size={40} />} text={creatorId ? 'No posts yet — check back tomorrow' : 'The feed fills up as days pass'} />
      )}
      {isFetching && posts.length === 0 && <Spinner />}
      {hasMore && posts.length > 0 && <div ref={sentinelRef} className="py-6 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{isFetching ? 'Loading…' : ''}</div>}
      {!hasMore && posts.length > 0 && <div className="py-6 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.25)' }}>You're all caught up ✨</div>}

      {storyGroup !== null && displayGroups.length > 0 && (
        <StoryViewer
          groups={displayGroups}
          startGroup={Math.min(storyGroup, displayGroups.length - 1)}
          onClose={() => { setStoryGroup(null); qc.invalidateQueries({ queryKey: ['feed-stories'] }) }}
          onSeen={(id) => setSeenIds(prev => prev.has(id) ? prev : new Set(prev).add(id))}
          onOpenProfile={(id) => { setStoryGroup(null); openCreator(id) }}
        />
      )}
    </div>
  )
}
