import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, Heart, Gift, X } from 'lucide-react'
import { creatorsApi, galleriesApi } from '../lib/api.js'
import { creatorAvatarUrl, creatorBannerUrl, coverUrl, imageThumbUrl, imageFileUrl } from '../lib/media.js'
import { useVaultStore } from '../store/vault.js'
import { Spinner } from '../components/ui.jsx'

function Stat({ label, value }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-xl font-bold">{value ?? 0}</div>
      <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</div>
    </div>
  )
}

export default function CreatorProfile() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const addToast = useVaultStore(s => s.addToast)
  const [avatarOpen, setAvatarOpen] = useState(false)

  const { data: c, isLoading } = useQuery({ queryKey: ['creator', id], queryFn: () => creatorsApi.get(id).then(r => r.data) })
  const { data: galleries } = useQuery({
    queryKey: ['creator-galleries', id],
    queryFn: () => galleriesApi.list({ creator_id: id, sort_by: 'date_added', limit: 200 }).then(r => r.data),
  })
  const { data: topImages } = useQuery({
    queryKey: ['creator-top', id],
    queryFn: () => creatorsApi.topImages(id, 12).then(r => r.data).catch(() => []),
  })

  async function giftHeart() {
    try { await creatorsApi.giftHeart(id); addToast('Heart gifted', 'xp'); qc.invalidateQueries({ queryKey: ['creator', id] }) }
    catch (e) { addToast(e?.response?.data?.detail || 'No hearts to gift', 'info') }
  }

  if (isLoading) return <Spinner />

  // Banner source priority mirrors desktop: a chosen gallery image
  // (banner_image_id) takes precedence over a custom uploaded banner (banner_path).
  const bannerSrc = c?.banner_image_id ? imageFileUrl({ id: c.banner_image_id })
    : c?.banner_path ? creatorBannerUrl(id)
    : null
  // Framing values mirror desktop defaults so the saved crop looks identical.
  const bannerY = c?.banner_y != null ? c.banner_y : 20
  const bannerZoom = c?.banner_zoom != null ? c.banner_zoom : 1
  const bannerH = Math.round((typeof window !== 'undefined' ? window.innerHeight : 720) * 0.4)

  return (
    <div>
      {/* Banner — tall hero that reuses the desktop scale + objectPosition framing
          so a portrait isn't sliced to a thin band, and fades fully into the page
          background at the bottom (no blunt cut-off edge). */}
      <div className="relative overflow-hidden" style={{ height: bannerH, background: 'var(--c-card)' }}>
        {bannerSrc && (
          <img src={bannerSrc} alt="" className="absolute inset-0 w-full h-full object-cover"
               style={{
                 objectPosition: `center ${bannerY}%`,
                 transform: `scale(${(1.15 * bannerZoom).toFixed(3)})`,
                 transformOrigin: 'center top',
               }} />
        )}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.15) 45%, rgba(14,14,14,0.75) 80%, #0e0e0e 100%)' }} />
        <button onClick={() => nav(-1)} className="absolute left-2 p-2 rounded-full bg-black/40"
                style={{ top: 'calc(var(--sat) + 8px)' }}>
          <ChevronLeft size={24} color="#fff" />
        </button>
      </div>

      {/* Header */}
      <div className="px-4 -mt-12 relative">
        <button
          onClick={() => c?.avatar_path && setAvatarOpen(true)}
          className="w-24 h-24 rounded-full overflow-hidden border-4 block"
          style={{ borderColor: 'var(--c-bg)', background: 'var(--c-card)' }}
        >
          {c?.avatar_path && <img src={creatorAvatarUrl(id)} alt={c.name} className="w-full h-full object-cover" />}
        </button>
        <div className="flex items-end justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold">{c?.name}</h1>
            <div className="text-[14px] capitalize" style={{ color: 'var(--accent)' }}>{c?.creator_type}</div>
          </div>
          <button onClick={giftHeart} className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[14px] font-semibold"
                  style={{ background: 'var(--c-card)', color: 'var(--c-pink)' }}>
            <Gift size={16} /> Gift heart
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex justify-around py-4 mx-4 mt-4 rounded-vault" style={{ background: 'var(--c-card)' }}>
        <Stat label="Galleries" value={c?.gallery_count} />
        <Stat label="Images" value={c?.image_count} />
        <Stat label="Sessions" value={c?.session_count} />
        <Stat label="Bond" value={c?.bond_level} />
      </div>

      {c?.lore && (
        <p className="px-4 mt-4 text-[15px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>{c.lore}</p>
      )}

      {/* Top images */}
      {topImages?.length > 0 && (
        <div className="mt-6">
          <h2 className="px-4 text-lg font-bold mb-2">Top images</h2>
          <div className="flex gap-2 overflow-x-auto px-4 pb-1">
            {topImages.map(img => (
              <button key={img.id} onClick={() => img.gallery_id && nav(`/view/${img.gallery_id}`)}
                      className="shrink-0 w-28 h-28 rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>
                <img src={imageThumbUrl(img)} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Galleries */}
      <div className="mt-6">
        <h2 className="px-4 text-lg font-bold mb-2">Galleries</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 px-4">
          {galleries?.map(g => {
            const cover = coverUrl(g)
            return (
              <button key={g.id} onClick={() => nav(`/gallery/${g.id}`)} className="text-left">
                <div className="aspect-[3/4] rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>
                  {cover && <img src={cover} alt={g.name} loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <div className="mt-1 text-[14px] truncate">{g.name}</div>
              </button>
            )
          })}
        </div>
      </div>
      <div className="h-6" />

      {/* Fullscreen avatar viewer — tap the PFP to maximise it */}
      <AnimatePresence>
        {avatarOpen && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.92)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setAvatarOpen(false)}
          >
            <motion.img
              src={creatorAvatarUrl(id, 1200)} alt={c?.name} draggable={false}
              className="max-w-[92vw] max-h-[82vh] object-contain rounded-2xl"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            />
            <button onClick={() => setAvatarOpen(false)} className="absolute p-2 rounded-full bg-black/50"
                    style={{ top: 'calc(var(--sat) + 10px)', right: 14 }}>
              <X size={26} color="#fff" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
