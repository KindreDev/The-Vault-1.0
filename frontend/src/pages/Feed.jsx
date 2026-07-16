import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Newspaper } from 'lucide-react'
import { feedApi } from '../lib/api'
import FeedPost from '../components/feed/FeedPost'
import SimProfileHeader from '../components/feed/SimProfileHeader'
import StoriesRow from '../components/feed/StoriesRow'
import StoryViewer from '../components/feed/StoryViewer'
import SuggestedRail from '../components/feed/SuggestedRail'
import ProfilePostGrid from '../components/feed/ProfilePostGrid'
import PostModal from '../components/feed/PostModal'
import DMPingBanner from '../components/feed/DMPingBanner'
import { LayoutGrid, Rows3, Newspaper as NewspaperIcon } from 'lucide-react'
import { useT } from '../i18n'

const PAGE_SIZE = 8

export default function Feed() {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const creatorId = searchParams.get('creator_id')

  const [posts, setPosts] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [generated, setGenerated] = useState(false)
  const [storyGroup, setStoryGroup] = useState(null)   // group index open in the viewer
  const [seenIds, setSeenIds] = useState(() => new Set())
  const [profileView, setProfileView] = useState('cards')  // 'cards' | 'grid' (creator view)
  const [modalPost, setModalPost] = useState(null)          // grid item opened as an IG post
  const ioRef = useRef(null)
  const stateRef = useRef({ hasMore: true, fetching: false })
  // "The algorithm" — a fresh seed per visit reshuffles the timeline every time
  // you come back; stable within the visit so pagination never repeats posts.
  const seedRef = useRef(Math.floor(Math.random() * 99991) + 1)

  // First visit of the day mints today's posts + stories
  useEffect(() => {
    feedApi.generate().catch(() => {}).finally(() => setGenerated(true))
  }, [])

  // Reset pagination when switching between global and creator-filtered views
  useEffect(() => {
    setPosts([])
    setPage(0)
    setHasMore(true)
  }, [creatorId])

  const { data, isFetching } = useQuery({
    queryKey: ['feed', creatorId, page],
    queryFn: () => feedApi.list({
      creator_id: creatorId || undefined,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      // global feed is shuffled per visit; a creator's own feed stays chronological
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
    enabled: generated && !creatorId,
    staleTime: 60000,
  })

  const { data: dmPingList } = useQuery({
    queryKey: ['feed-dm'],
    queryFn: () => feedApi.dmPings().then(r => r.data),
    enabled: generated && !creatorId,
    staleTime: 60000,
  })
  const [dismissedPings, setDismissedPings] = useState(() => new Set())
  const activePing = (dmPingList ?? []).find(p => !dismissedPings.has(p.id))

  // Overlay locally-seen stories so rings grey out instantly while the viewer is open
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
      if (e.isIntersecting && stateRef.current.hasMore && !stateRef.current.fetching) {
        setPage(p => p + 1)
      }
    }, { rootMargin: '900px' })
    io.observe(node)
    ioRef.current = io
  }, [])
  useEffect(() => () => ioRef.current?.disconnect(), [])

  const openCreatorFeed = (id) => setSearchParams({ creator_id: String(id) })

  return (
    <div className="p-3 md:p-6 flex justify-center gap-8">
      <div className="w-full" style={{ maxWidth: creatorId ? 900 : 620 }}>

        {/* Page header (global view only — creator view gets the profile card) */}
        {!creatorId && (
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-[12px] flex items-center justify-center"
                 style={{ background: 'rgba(127,119,221,0.15)', border: '0.5px solid rgba(127,119,221,0.3)' }}>
              <Newspaper size={18} style={{ color: '#A79FF0' }} />
            </div>
            <div>
              <div className="text-[22px] font-semibold" style={{ color: 'rgba(255,255,255,0.92)' }}>{t('Feed')}</div>
              <div className="text-[14px]" style={{ color: 'rgba(255,255,255,0.38)' }}>
                {t('Your collection, posting daily')}
              </div>
            </div>
          </div>
        )}

        {/* She texted first 💌 */}
        {!creatorId && activePing && (
          <DMPingBanner
            ping={activePing}
            onDismiss={() => setDismissedPings(prev => new Set(prev).add(activePing.id))}
          />
        )}

        {/* Stories rail */}
        {!creatorId && (
          <StoriesRow groups={displayGroups} onOpen={(i) => setStoryGroup(i)} />
        )}

        {/* Creator sim-profile header */}
        {creatorId && profile && (
          <SimProfileHeader profile={profile} onBack={() => setSearchParams({})} />
        )}

        {/* Grid / cards toggle (creator view only) */}
        {creatorId && posts.length > 0 && (
          <div className="flex items-center justify-center gap-1 mb-5 border-t pt-2"
               style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            {[
              { key: 'cards', icon: Rows3,      label: 'Posts' },
              { key: 'grid',  icon: LayoutGrid, label: 'Grid'  },
            ].map(v => {
              const active = profileView === v.key
              const Icon = v.icon
              return (
                <button key={v.key} onClick={() => setProfileView(v.key)}
                        className="relative flex items-center gap-2 px-6 py-2.5 text-[14px] font-medium cursor-pointer transition-colors"
                        style={{ color: active ? '#fff' : 'rgba(255,255,255,0.4)', background: 'none', border: 'none' }}>
                  <Icon size={16} /> {t(v.label)}
                  {active && (
                    <motion.div layoutId="profile-view-underline"
                                className="absolute -top-[9px] left-0 right-0 h-[2px] rounded-full"
                                style={{ background: 'var(--accent)' }}
                                transition={{ type: 'spring', stiffness: 380, damping: 32 }} />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Grid mode — Instagram profile grid of her posts */}
        {creatorId && profileView === 'grid' ? (
          <ProfilePostGrid posts={posts} onOpenPost={setModalPost} />
        ) : (
          /* Timeline — posts drift up into view as you scroll */
          <div className="flex flex-col gap-5">
            {posts.map(post => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, y: 28, scale: 0.985 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <FeedPost post={post} onCreatorClick={openCreatorFeed} />
              </motion.div>
            ))}
          </div>
        )}

        {/* Empty / loading states */}
        {posts.length === 0 && !isFetching && generated && (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <Newspaper size={40} style={{ color: 'rgba(255,255,255,0.12)' }} />
            <div className="text-[16px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {creatorId ? t('No posts from this creator yet — check back tomorrow') : t('No posts yet — the feed fills up as days pass')}
            </div>
          </div>
        )}

        {/* Infinite scroll sentinel */}
        {hasMore && posts.length > 0 && (
          <div ref={sentinelRef} className="flex justify-center py-8 text-[14px]"
               style={{ color: 'rgba(255,255,255,0.3)' }}>
            {isFetching ? t('Loading…') : ''}
          </div>
        )}
        {!hasMore && posts.length > 0 && (
          <div className="flex justify-center py-8 text-[14px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {t("You're all caught up ✨")}
          </div>
        )}
      </div>

      {/* Suggested creators rail — fills the desktop whitespace, IG style */}
      {!creatorId && (
        <aside className="hidden xl:block flex-shrink-0 sticky self-start" style={{ width: 330, top: 24 }}>
          <SuggestedRail onOpen={openCreatorFeed} />
        </aside>
      )}

      {/* Grid item opened as a full IG-style post */}
      {modalPost && (
        <PostModal
          post={modalPost}
          onClose={() => setModalPost(null)}
          onCreatorClick={(id) => { setModalPost(null); openCreatorFeed(id) }}
        />
      )}

      {/* Fullscreen story viewer */}
      {storyGroup !== null && displayGroups.length > 0 && (
        <StoryViewer
          groups={displayGroups}
          startGroup={Math.min(storyGroup, displayGroups.length - 1)}
          onClose={() => { setStoryGroup(null); qc.invalidateQueries({ queryKey: ['feed-stories'] }) }}
          onSeen={(id) => setSeenIds(prev => prev.has(id) ? prev : new Set(prev).add(id))}
          onOpenProfile={(id) => { setStoryGroup(null); openCreatorFeed(id) }}
        />
      )}
    </div>
  )
}
