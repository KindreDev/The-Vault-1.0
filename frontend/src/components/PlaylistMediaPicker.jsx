import React, { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, X, Search, Video, Images, ChevronDown } from 'lucide-react'
import { LocalizedText, useT } from '../i18n'
import { galleriesApi, imagesApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'

const PAGE_SIZE = 96

export default function PlaylistMediaPicker({ onClose }) {
  const t = useT()
  const [tab, setTab] = useState('galleries')
  const [search, setSearch] = useState('')
  const [querySearch, setQuerySearch] = useState('')
  const [page, setPage] = useState(0)
  const [galleryId, setGalleryId] = useState(null)
  const [loadingGalId, setLoadingGalId] = useState(null)
  const resultsRef = useRef(null)
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const queue = useVaultStore(s => s.multiViewerQueue)
  const resetSearch = () => { setSearch(''); setQuerySearch(''); setPage(0) }
  useEffect(() => {
    const timeout = setTimeout(() => { setQuerySearch(search.trim()); setPage(0) }, 250)
    return () => clearTimeout(timeout)
  }, [search])
  useEffect(() => { if (resultsRef.current) resultsRef.current.scrollTop = 0 }, [tab, galleryId, querySearch, page])
  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ['playlist-media-picker', tab, galleryId, querySearch, page],
    queryFn: async () => {
      const params = { search: querySearch || undefined, skip: page * PAGE_SIZE, limit: PAGE_SIZE }
      const response = galleryId
        ? await galleriesApi.pickerMedia(galleryId, params)
        : tab === 'galleries'
          ? await galleriesApi.list({ ...params, sort_by: 'date_added' })
          : await imagesApi.list({ ...params, is_video: tab === 'videos', sort_by: 'date_added' })
      return { items: response.data, total: Number(response.headers['x-total-count'] ?? response.data.length) }
    },
  })
  const displayList = data?.items || []
  const filtered = displayList
  const total = data?.total || 0
  const queuedIds = new Set(queue.map(item => item.id))
  const handleAddImage = image => {
    if (addToMultiViewer({ id: `img-${image.id}`, type: 'image', media: image })) toast.success(t('Added to Playlists'))
    else toast.error(t('Already in queue'))
  }
  const handleAddGallery = async (event, gallery) => {
    event.stopPropagation()
    if (loadingGalId) return
    setLoadingGalId(gallery.id)
    try {
      const response = await galleriesApi.images(gallery.id)
      if (addToMultiViewer({ id: `gal-${gallery.id}`, type: 'gallery', media: gallery, images: response.data })) toast.success(t('Added gallery to Playlists'))
      else toast.error(t('Already in queue'))
    } catch { toast.error(t('Failed to load gallery images')) }
    finally { setLoadingGalId(null) }
  }
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.8)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col rounded-[16px] overflow-hidden shadow-2xl animate-modal-pop"
           style={{ width: 'clamp(380px, 60vw, 960px)', height: 'clamp(380px, 60vh, 820px)', background: 'var(--c-bg)' , border: '0.5px solid var(--c-border)' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
          {galleryId ? (
            <button onMouseDown={() => { setGalleryId(null); resetSearch() }}
                    className="text-[16px] cursor-pointer text-[rgba(255,255,255,0.45)] hover:text-white flex items-center gap-1">
              <ChevronDown size={12} className="rotate-90" /><LocalizedText text={"Back"} before={" "} after={"\n            "} /></button>
          ) : (
            <div className="flex gap-1">
              {[{ id: 'galleries', icon: Images, label: 'Galleries' },
                { id: 'images',    icon: Images, label: 'Photos'    },
                { id: 'videos',    icon: Video,  label: 'Videos'    }].map(t => (
                <button key={t.id} onMouseDown={() => { setTab(t.id); setGalleryId(null); resetSearch() }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[16px] cursor-pointer"
                        style={tab === t.id
                          ? { background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }
                          : { background: 'transparent', color: 'rgba(255,255,255,0.4)' }}>
                  <t.icon size={11} />{t.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1 rounded-full mx-2"
               style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <Search size={11} className="text-[rgba(255,255,255,0.3)]" />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                   placeholder={t("Search…")}
                   className="bg-transparent text-[16px] outline-none text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] w-full" />
          </div>
          <span className="text-[16px] text-[rgba(255,255,255,0.35)]">{queue.length.toLocaleString()} {t('queued')}</span>
          <button onMouseDown={onClose} className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white ml-1"><X size={15} /></button>
        </div>
        
        <div ref={resultsRef} className="flex-1 min-h-0 overflow-y-auto p-2" aria-busy={isFetching}>
          {isPending && <div className="p-5 text-center">{t('Loading…')}</div>}
          {isError && <div className="p-5 text-center">{t('Could not load media')} <button onClick={() => refetch()}>{t('Try again')}</button></div>}
          {!isPending && !isError && !displayList.length && <div className="p-5 text-center">{t('No matching media')}</div>}
          {tab === 'galleries' && !galleryId ? (
            <div className="grid grid-cols-3 gap-2">
              {filtered.map(g => {
                const inQ = queuedIds.has(`gal-${g.id}`)
                return (
                  <button key={g.id} onMouseDown={() => { setGalleryId(g.id); resetSearch() }}
                          className="relative rounded-[10px] overflow-hidden cursor-pointer group text-left"
                          style={{ aspectRatio: '1', background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                    {g.cover_thumb && <img src={g.cover_thumb} alt={g.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />}
                    <div className="absolute inset-0 flex items-end p-1.5" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }}>
                      <span className="text-[16px] text-white font-medium leading-tight line-clamp-2">{g.name}</span>
                    </div>
                    {/* Add entire gallery button */}
                    <div onMouseDown={(e) => !inQ && handleAddGallery(e, g)}
                         className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-opacity z-10"
                         style={{ 
                           background: inQ ? 'color-mix(in srgb, var(--c-accent) 70%, transparent)' : 'rgba(0,0,0,0.6)',
                           opacity: inQ ? 1 : 0 
                         }}
                         onMouseEnter={e => { if(!inQ) e.currentTarget.style.opacity = '1' }}
                         onMouseLeave={e => { if(!inQ) e.currentTarget.style.opacity = '0' }}>
                      {loadingGalId === g.id ? (
                        <span className="w-3 h-3 border-2 border-[rgba(255,255,255,0.3)] border-t-white rounded-full animate-spin" />
                      ) : inQ ? (
                        <span className="text-[16px] text-white">✓</span>
                      ) : (
                        <Plus size={12} color="#fff" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {displayList.map(img => {
                const inQ = queuedIds.has(`img-${img.id}`)
                return (
                  <button key={img.id} onMouseDown={() => !inQ && handleAddImage(img)}
                          className="relative rounded-[8px] overflow-hidden cursor-pointer group"
                          style={{ aspectRatio: '1', background: 'rgba(255,255,255,0.04)',
                            border: `0.5px solid ${inQ ? 'color-mix(in srgb, var(--c-accent) 50%, transparent)' : 'rgba(255,255,255,0.07)'}`,
                            opacity: inQ ? 0.6 : 1 }}>
                    <img src={`/api/images/${img.id}/thumb`} alt={img.filename} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" onError={e => { e.target.style.display = 'none' }} />
                    {img.is_video && (
                      <div className="absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
                        <Video size={8} color="#fff" />
                      </div>
                    )}
                    {inQ
                      ? <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)' }}><span className="text-[16px] font-medium text-[var(--c-accent-text)]">✓</span></div>
                      : <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.4)' }}><Plus size={18} color="rgba(255,255,255,0.8)" /></div>
                    }
                  </button>
                )
              })}
            </div>
          )}
          
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3 flex-shrink-0" style={{ borderTop: '0.5px solid var(--c-border)', fontSize: 16 }}>
          <span style={{ fontSize: 16 }} aria-live="polite">{isPending ? t('Loading…') : `${displayList.length ? page * PAGE_SIZE + 1 : 0}–${page * PAGE_SIZE + displayList.length} / ${total.toLocaleString()}`}</span>
          <div className="flex gap-3">
            <button disabled={page === 0 || isFetching} onClick={() => setPage(value => value - 1)} className="cursor-pointer disabled:opacity-30">{t('Previous')}</button>
            <button disabled={isFetching || (page + 1) * PAGE_SIZE >= total} onClick={() => setPage(value => value + 1)} className="cursor-pointer disabled:opacity-30">{t('Next')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

