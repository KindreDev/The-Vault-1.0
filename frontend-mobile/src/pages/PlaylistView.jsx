import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Play, X } from 'lucide-react'
import { playlistsApi } from '../lib/api.js'
import { imageThumbUrl } from '../lib/media.js'
import { useVaultStore } from '../store/vault.js'
import { Spinner, Empty } from '../components/ui.jsx'
import LongPress from '../components/LongPress.jsx'

export default function PlaylistView() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const addToast = useVaultStore(s => s.addToast)

  const { data, isLoading } = useQuery({
    queryKey: ['playlist-detail', id],
    queryFn: () => playlistsApi.detail(id).then(r => r.data),
  })

  function open(img, idx) {
    // Photos AND videos open in the same swipeable viewer.
    nav(`/playlist/${id}/view?i=${idx}`)
  }
  async function remove(img) {
    try { await playlistsApi.removeImage(id, img.id); addToast('Removed', 'info'); qc.invalidateQueries({ queryKey: ['playlist-detail', id] }) }
    catch {}
  }

  const images = data?.images || []

  return (
    <div>
      <div className="sticky top-0 z-30 flex items-center gap-2 px-2 pb-2 backdrop-blur"
           style={{ paddingTop: 'calc(var(--sat) + 10px)', background: 'color-mix(in srgb, var(--c-bg) 88%, transparent)' }}>
        <button onClick={() => nav(-1)} className="p-2"><ChevronLeft size={26} /></button>
        <h1 className="text-xl font-bold truncate flex-1">{data?.name || ''}</h1>
        <span className="text-[14px] pr-2" style={{ color: 'rgba(255,255,255,0.45)' }}>{images.length}</span>
      </div>

      {isLoading ? <Spinner /> : !images.length ? (
        <Empty icon={<Play size={40} />} text="Empty playlist — long-press items elsewhere to add them" />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 px-1">
          {images.map((img, idx) => (
            <LongPress key={img.id} onClick={() => open(img, idx)} onLongPress={() => remove(img)}
                       className="relative aspect-square overflow-hidden" style={{ background: 'var(--c-card)' }}>
              <img src={imageThumbUrl(img)} alt="" loading="lazy" className="w-full h-full object-cover" />
              {img.is_video && (
                <span className="absolute bottom-1 right-1 bg-black/60 rounded-full p-1">
                  <Play size={12} fill="#fff" color="#fff" />
                </span>
              )}
              {img.cum_count > 0 && (
                <span className="absolute top-1 right-1 text-[11px] px-1 rounded font-bold"
                      style={{ background: 'var(--c-pink)', color: '#fff' }}>{img.cum_count}</span>
              )}
            </LongPress>
          ))}
        </div>
      )}
      <p className="text-center text-[13px] mt-4 px-8" style={{ color: 'rgba(255,255,255,0.3)' }}>
        Long-press an item to remove it from this playlist.
      </p>
      <div className="h-4" />
    </div>
  )
}
