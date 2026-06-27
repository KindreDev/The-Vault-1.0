import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Droplet, Star, Play, X, ListPlus, Scissors, CheckSquare } from 'lucide-react'
import { galleriesApi } from '../lib/api.js'
import { imageThumbUrl } from '../lib/media.js'
import { useVaultStore } from '../store/vault.js'
import { Spinner } from '../components/ui.jsx'
import LongPress from '../components/LongPress.jsx'
import BottomSheet from '../components/BottomSheet.jsx'

export default function GalleryView() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const addToast = useVaultStore(s => s.addToast)
  const openPlaylistPicker = useVaultStore(s => s.openPlaylistPicker)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState([])
  const [sheet, setSheet] = useState(null)        // single image long-press target
  const [extracting, setExtracting] = useState(false)
  const [extractName, setExtractName] = useState('')

  const { data: g } = useQuery({ queryKey: ['gallery', id], queryFn: () => galleriesApi.get(id).then(r => r.data) })
  const { data: images, isLoading } = useQuery({
    queryKey: ['gallery-images', id],
    queryFn: () => galleriesApi.images(id, { limit: 1000 }).then(r => r.data),
  })

  useEffect(() => { galleriesApi.view(id).catch(() => {}) }, [id])

  async function logCum() {
    try { await galleriesApi.cum(id); addToast('Cum logged', 'xp'); qc.invalidateQueries({ queryKey: ['gallery', id] }) }
    catch { addToast('Failed', 'info') }
  }
  async function rate(r) {
    try { await galleriesApi.rate(id, r); addToast('Rated', 'xp'); qc.invalidateQueries({ queryKey: ['gallery', id] }) }
    catch {}
  }

  function openImage(img, idx) {
    // Photos AND videos open in the same swipeable viewer.
    nav(`/view/${id}?i=${idx}`)
  }
  function toggleSel(imgId) { setSelected(s => s.includes(imgId) ? s.filter(x => x !== imgId) : [...s, imgId]) }
  function exitSelect() { setSelectMode(false); setSelected([]) }

  async function doExtract() {
    const name = extractName.trim()
    if (!name || !selected.length) return
    try { await galleriesApi.extract(id, selected, name); addToast('Extracted to new gallery', 'xp'); qc.invalidateQueries({ queryKey: ['gallery-images', id] }); exitSelect() }
    catch (e) { addToast(e?.response?.data?.detail || 'Extract failed', 'info') }
    setExtracting(false); setExtractName('')
  }

  return (
    <div>
      <div className="sticky top-0 z-30 flex items-center gap-2 px-2 pb-2 backdrop-blur"
           style={{ paddingTop: 'calc(var(--sat) + 10px)', background: 'color-mix(in srgb, var(--c-bg) 88%, transparent)' }}>
        <button onClick={() => selectMode ? exitSelect() : nav(-1)} className="p-2">
          {selectMode ? <X size={26} /> : <ChevronLeft size={26} />}
        </button>
        <h1 className="text-xl font-bold truncate flex-1">{selectMode ? `${selected.length} selected` : (g?.name || '')}</h1>
      </div>

      {/* Meta row (hidden in select mode) */}
      {g && !selectMode && (
        <div className="px-4 pb-3 flex items-center gap-4 flex-wrap">
          <button onClick={logCum} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[15px] font-semibold"
                  style={{ background: 'var(--c-pink)', color: '#fff' }}>
            <Droplet size={16} /> {g.cum_count}
          </button>
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => rate((g.rating || 0) === n ? 0 : n)}>
                <Star size={18} fill={(g.rating || 0) >= n ? 'var(--c-amber)' : 'none'} color="var(--c-amber)" />
              </button>
            ))}
          </div>
          {g.creators?.length > 0 && (
            <button onClick={() => nav(`/creator/${g.creators[0].id}`)} className="text-[15px]" style={{ color: 'var(--accent)' }}>
              {g.creators.map(c => c.name).join(', ')}
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && selected.length > 0 && (
        <div className="flex gap-2 px-4 pb-3">
          <button onClick={() => openPlaylistPicker(selected)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[15px] font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff' }}><ListPlus size={18} /> Add to playlist</button>
          <button onClick={() => setExtracting(true)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[15px] font-semibold"
                  style={{ background: 'var(--c-card)' }}><Scissors size={18} /> Extract</button>
        </div>
      )}

      {isLoading ? <Spinner /> : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 px-1">
          {images?.map((img, idx) => {
            const sel = selected.includes(img.id)
            return (
              <LongPress key={img.id}
                onClick={() => selectMode ? toggleSel(img.id) : openImage(img, idx)}
                onLongPress={() => { if (!selectMode) setSheet(img) }}
                className="relative aspect-square overflow-hidden" style={{ background: 'var(--c-card)', outline: sel ? '3px solid var(--accent)' : 'none' }}>
                <img src={imageThumbUrl(img)} alt="" loading="lazy" className="w-full h-full object-cover" />
                {img.is_video && (
                  <span className="absolute bottom-1 right-1 bg-black/60 rounded-full p-1"><Play size={12} fill="#fff" color="#fff" /></span>
                )}
                {img.cum_count > 0 && (
                  <span className="absolute top-1 right-1 text-[11px] px-1 rounded font-bold" style={{ background: 'var(--c-pink)', color: '#fff' }}>{img.cum_count}</span>
                )}
                {selectMode && (
                  <div className="absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center"
                       style={{ background: sel ? 'var(--accent)' : 'rgba(0,0,0,0.5)', border: '2px solid #fff' }}>
                    {sel && <CheckSquare size={11} color="#fff" />}
                  </div>
                )}
              </LongPress>
            )
          })}
        </div>
      )}
      <div className="h-4" />

      {/* Single image action sheet */}
      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title="Image"
        actions={sheet ? [
          { label: 'Add to playlist', icon: <ListPlus size={20} />, onClick: () => openPlaylistPicker([sheet.id]) },
          { label: 'Select multiple', icon: <CheckSquare size={20} />, onClick: () => { setSelectMode(true); setSelected([sheet.id]) } },
        ] : []} />

      {/* Extract sheet */}
      <BottomSheet open={extracting} onClose={() => { setExtracting(false); setExtractName('') }} title={`Extract ${selected.length} to new gallery`}>
        <div className="px-5 pb-4">
          <input autoFocus value={extractName} onChange={e => setExtractName(e.target.value)} placeholder="New gallery name" maxLength={120}
                 className="w-full px-3 py-3 rounded-xl bg-transparent outline-none text-[16px] mb-3"
                 style={{ border: '1px solid rgba(255,255,255,0.15)' }} />
          <button onClick={doExtract} className="w-full py-3 rounded-xl text-[16px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Extract</button>
          <p className="text-[13px] mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Moves the selected files into a new folder/gallery on your PC.</p>
        </div>
      </BottomSheet>
    </div>
  )
}
