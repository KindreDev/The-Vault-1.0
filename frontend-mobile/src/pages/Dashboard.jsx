import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Flame, Images, Users, Film, Droplet, ListMusic, ChevronRight, Plus, Shuffle, Play } from 'lucide-react'
import { galleriesApi, imagesApi, creatorsApi, playlistsApi, gamiApi } from '../lib/api.js'
import { useVaultStore } from '../store/vault.js'
import { coverUrl, imageThumbUrl, creatorAvatarUrl } from '../lib/media.js'
import { Spinner } from '../components/ui.jsx'

// Tabbed random discovery — mirrors the desktop dashboard's "Discover" section.
const DISCOVER_TABS = [
  { key: 'galleries', label: 'Galleries', color: 'var(--accent)' },
  { key: 'photos',    label: 'Photos',    color: 'var(--c-pink)' },
  { key: 'videos',    label: 'Videos',    color: 'var(--accent)' },
  { key: 'creators',  label: 'Creators',  color: 'var(--c-amber)' },
]

function Discover({ galleries, photos, videos, creators }) {
  const nav = useNavigate()
  const [tab, setTab] = useState('galleries')
  const data = { galleries, photos, videos, creators }
  const items = data[tab] ?? []
  const browse = { galleries: '/galleries', photos: '/galleries', videos: '/galleries', creators: '/creators' }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 px-4 mb-2.5">
        <Shuffle size={18} style={{ color: 'var(--accent)' }} />
        <h2 className="text-lg font-bold">Discover</h2>
        <button onClick={() => nav(browse[tab])} className="ml-auto flex items-center gap-1 text-[15px]" style={{ color: 'var(--accent)' }}>
          See all <ChevronRight size={16} />
        </button>
      </div>

      {/* Tab pills */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {DISCOVER_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
                  className="shrink-0 px-3.5 py-1.5 rounded-full text-[14px] font-medium"
                  style={{
                    background: tab === t.key ? t.color : 'var(--c-card)',
                    color: tab === t.key ? '#fff' : 'rgba(255,255,255,0.6)',
                  }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-2 px-4">
        {items.map(item => {
          if (tab === 'creators') {
            return (
              <button key={item.id} onClick={() => nav(`/creator/${item.id}`)} className="text-left">
                <div className="aspect-square rounded-vault overflow-hidden flex items-center justify-center" style={{ background: 'var(--c-card)' }}>
                  {item.avatar_path
                    ? <img src={creatorAvatarUrl(item.id)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : <span className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{(item.name || '?')[0].toUpperCase()}</span>}
                </div>
                <div className="mt-1 text-[14px] truncate">{item.name}</div>
              </button>
            )
          }
          if (tab === 'galleries') {
            const cover = coverUrl(item)
            return (
              <button key={item.id} onClick={() => nav(`/gallery/${item.id}`)} className="text-left">
                <div className="aspect-[3/4] rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>
                  {cover && <img src={cover} alt={item.name} loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <div className="mt-1 text-[14px] truncate">{item.name}</div>
              </button>
            )
          }
          // photos + videos
          return (
            <button key={item.id} onClick={() => nav(`/photo/${item.id}`)}
                    className="relative aspect-square rounded-lg overflow-hidden" style={{ background: 'var(--c-card)' }}>
              <img src={imageThumbUrl(item)} alt="" loading="lazy" className="w-full h-full object-cover" />
              {tab === 'videos' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Play size={26} color="#fff" fill="#fff" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))' }} />
                </span>
              )}
              {item.cum_count > 0 && (
                <span className="absolute top-1 right-1 text-[11px] px-1 rounded font-bold" style={{ background: 'var(--c-pink)', color: '#fff' }}>{item.cum_count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StatTile({ icon, label, value, color }) {
  return (
    <div className="flex flex-col gap-1 rounded-vault p-3" style={{ background: 'var(--c-card)' }}>
      <div style={{ color }}>{icon}</div>
      <div className="text-xl font-bold leading-none">{value ?? 0}</div>
      <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</div>
    </div>
  )
}

function GalleryThumb({ g, onClick }) {
  const cover = coverUrl(g)
  return (
    <button onClick={onClick} className="shrink-0 w-32 text-left">
      <div className="w-32 h-44 rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>
        {cover && <img src={cover} alt={g.name} loading="lazy" className="w-full h-full object-cover" />}
      </div>
      <div className="mt-1.5 text-[14px] truncate">{g.name}</div>
    </button>
  )
}

export default function Dashboard() {
  const nav = useNavigate()
  const profile = useVaultStore(s => s.profile)
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => galleriesApi.stats().then(r => r.data) })
  const { data: recent, isLoading } = useQuery({ queryKey: ['recent'], queryFn: () => galleriesApi.recent(12).then(r => r.data) })
  const { data: playlists } = useQuery({ queryKey: ['playlists'], queryFn: () => playlistsApi.list().then(r => r.data) })

  // Discover — random galleries / photos / videos / creators (matches desktop)
  const { data: discGalleries } = useQuery({ queryKey: ['disc-galleries'], queryFn: () => galleriesApi.randomPicks(9).then(r => r.data) })
  const { data: discPhotos }    = useQuery({ queryKey: ['disc-photos'],    queryFn: () => imagesApi.randomPicks(9).then(r => r.data) })
  const { data: discVideos }    = useQuery({ queryKey: ['disc-videos'],    queryFn: () => imagesApi.randomVideos(9).then(r => r.data) })
  const { data: discCreators }  = useQuery({ queryKey: ['disc-creators'],  queryFn: () => creatorsApi.randomPicks(9).then(r => r.data) })

  const pct = profile?.xp_to_next
    ? Math.min(100, Math.round(((profile.total_xp || 0) / ((profile.total_xp || 0) + profile.xp_to_next)) * 100))
    : 0

  return (
    <div>
      {/* Profile header — tap the PFP (or name) to open your profile,
          since Profile left the bottom bar to make room for Feed */}
      <div className="px-4 pt-[calc(var(--sat)+16px)] pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0" onClick={() => nav('/profile')}>
            <img src={gamiApi.avatarUrl(profile?.level)} alt=""
                 onError={e => { e.target.style.visibility = 'hidden' }}
                 className="w-14 h-14 rounded-full object-cover shrink-0"
                 style={{ border: '2.5px solid var(--accent)' }} />
            <div className="min-w-0">
              <div className="text-[15px] truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {profile?.username || 'Vault Master'} · Level {profile?.level ?? 1}
              </div>
              <div className="text-2xl font-bold truncate">{profile?.selected_title || profile?.level_title || 'The Lurker'}</div>
            </div>
          </div>
          <span className="flex items-center gap-1 text-[15px] shrink-0" style={{ color: 'var(--c-amber)' }}>
            <Flame size={18} /> {profile?.streak_days ?? 0}
          </span>
        </div>
        {/* XP bar */}
        <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-card)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
        </div>
        <div className="mt-1 text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {profile?.total_xp ?? 0} XP{profile?.xp_to_next ? ` · ${profile.xp_to_next} to next` : ''}
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-3 gap-2.5 px-4">
        <StatTile icon={<Images size={20} />} label="Galleries" value={stats?.total_galleries} color="var(--accent)" />
        <StatTile icon={<Users size={20} />}  label="Creators"  value={stats?.total_creators}  color="var(--accent)" />
        <StatTile icon={<Film size={20} />}    label="Videos"    value={stats?.total_videos}    color="var(--accent)" />
        <StatTile icon={<Images size={20} />} label="Images"    value={stats?.total_images}    color="var(--accent)" />
        <StatTile icon={<Droplet size={20} />} label="Cum count" value={stats?.total_cum_count} color="var(--c-pink)" />
        <StatTile icon={<Flame size={20} />}   label="Sessions"  value={stats?.total_sessions}  color="var(--c-amber)" />
      </div>

      {/* Recent */}
      <div className="mt-6">
        <h2 className="px-4 text-lg font-bold mb-2.5">Recently added</h2>
        {isLoading ? <Spinner /> : (
          <div className="flex gap-3 overflow-x-auto px-4 pb-1">
            {recent?.map(g => <GalleryThumb key={g.id} g={g} onClick={() => nav(`/gallery/${g.id}`)} />)}
          </div>
        )}
      </div>

      {/* Playlists (between creators/stats and random picks) */}
      <div className="mt-6">
        <div className="flex items-center justify-between px-4 mb-2.5">
          <h2 className="text-lg font-bold">Playlists</h2>
          <button onClick={() => nav('/playlists')} className="flex items-center gap-1 text-[15px]" style={{ color: 'var(--accent)' }}>
            See all <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex gap-2.5 overflow-x-auto px-4 pb-1">
          <button onClick={() => nav('/playlists')}
                  className="shrink-0 w-32 h-20 rounded-vault flex flex-col items-center justify-center gap-1"
                  style={{ background: 'var(--c-card)', border: '1px dashed rgba(255,255,255,0.2)' }}>
            <Plus size={22} style={{ color: 'var(--accent)' }} />
            <span className="text-[14px]" style={{ color: 'var(--accent)' }}>Create</span>
          </button>
          {playlists?.map(p => (
            <button key={p.id} onClick={() => nav(`/playlist/${p.id}`)}
                    className="shrink-0 w-32 h-20 rounded-vault p-3 flex flex-col justify-between text-left" style={{ background: 'var(--c-card)' }}>
              <ListMusic size={20} style={{ color: 'var(--accent)' }} />
              <div>
                <div className="text-[14px] font-semibold truncate">{p.name}</div>
                <div className="text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{p.image_count ?? 0} items</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Discover — tabbed random galleries / photos / videos / creators */}
      <Discover galleries={discGalleries} photos={discPhotos} videos={discVideos} creators={discCreators} />

      <div className="h-6" />
    </div>
  )
}
