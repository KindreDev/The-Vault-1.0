/**
 * <SubgalleriesPanel /> — galleries that live inside this gallery's folder.
 *
 * "Folder = gallery" means nesting on disk is the only definition of a
 * subgallery; there is no parent_id to keep in sync. About a third of the
 * library is nested this way, and it goes several levels deep, so this fetches
 * one level at a time and only when opened — expanding a child asks the server
 * for its own children rather than walking the whole tree up front.
 *
 * Collapsed by default: most galleries have no children, and the ones that do
 * can have hundreds.
 */
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FolderTree, Images, Droplets } from 'lucide-react'
import { galleriesApi } from '../lib/api'
import { useT } from '../i18n'

function Row({ gallery, depth, onOpen }) {
  const [expanded, setExpanded] = useState(false)
  const t = useT()
  const hasKids = (gallery.subgallery_count ?? 0) > 0

  return (
    <>
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-[8px] transition-colors hover:bg-white/[0.04]"
           style={{ paddingLeft: 8 + depth * 18 }}>
        <button
          onClick={() => hasKids && setExpanded(e => !e)}
          className="flex-shrink-0 p-0.5 rounded"
          style={{ cursor: hasKids ? 'pointer' : 'default',
                   color: hasKids ? 'rgba(255,255,255,0.45)' : 'transparent' }}
          title={hasKids ? t('Show what is inside') : undefined}>
          <ChevronRight size={14}
                        style={{ transform: expanded ? 'rotate(90deg)' : 'none',
                                 transition: 'transform 0.15s ease' }} />
        </button>

        <button onClick={() => onOpen(gallery)}
                className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer">
          {gallery.cover_thumb
            ? <img src={gallery.cover_thumb} alt="" className="rounded-[5px] flex-shrink-0"
                   style={{ width: 34, height: 34, objectFit: 'cover' }} />
            : <div className="rounded-[5px] flex-shrink-0 flex items-center justify-center"
                   style={{ width: 34, height: 34, background: 'rgba(255,255,255,0.05)' }}>
                <Images size={14} style={{ color: 'rgba(255,255,255,0.25)' }} />
              </div>}
          <span className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.8)' }}>
            {gallery.name}
          </span>
        </button>

        <span className="flex items-center gap-3 flex-shrink-0">
          {hasKids && (
            <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.3)' }}
                  title={t('galleries inside this one')}>
              {gallery.subgallery_count} {t('inside')}
            </span>
          )}
          <span className="flex items-center gap-1" style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)' }}>
            <Images size={12} /> {(gallery.image_count ?? 0).toLocaleString()}
          </span>
          {gallery.cum_count > 0 && (
            <span className="flex items-center gap-1" style={{ fontSize: 15, color: 'var(--c-pink-text)' }}>
              <Droplets size={12} /> {gallery.cum_count}
            </span>
          )}
        </span>
      </div>

      {expanded && <Level galleryId={gallery.id} depth={depth + 1} onOpen={onOpen} />}
    </>
  )
}

function Level({ galleryId, depth, onOpen }) {
  const { data, isLoading } = useQuery({
    queryKey: ['subgalleries', galleryId],
    queryFn: () => galleriesApi.subgalleries(galleryId).then(r => r.data),
    staleTime: 60_000,
  })
  const t = useT()

  if (isLoading) {
    return (
      <div style={{ paddingLeft: 8 + depth * 18, fontSize: 15, color: 'rgba(255,255,255,0.25)' }}
           className="px-2 py-1.5">
        {t('Looking inside…')}
      </div>
    )
  }
  if (!data?.length) {
    return (
      <div style={{ paddingLeft: 8 + depth * 18, fontSize: 15, color: 'rgba(255,255,255,0.25)' }}
           className="px-2 py-1.5">
        {t('Nothing nested here')}
      </div>
    )
  }
  return data.map(g => <Row key={g.id} gallery={g} depth={depth} onOpen={onOpen} />)
}

export default function SubgalleriesPanel({ galleryId, onOpen }) {
  const [open, setOpen] = useState(false)   // retracted by default
  const t = useT()

  // Cheap existence check so the section hides itself entirely for the ~65% of
  // galleries that contain nothing.
  const { data: peek } = useQuery({
    queryKey: ['subgalleries', galleryId],
    queryFn: () => galleriesApi.subgalleries(galleryId).then(r => r.data),
    staleTime: 60_000,
  })
  if (!peek?.length) return null

  return (
    <div className="rounded-[10px] overflow-hidden"
         style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <button onClick={() => setOpen(o => !o)}
              className="w-full flex items-center gap-2.5 px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.03]">
        <FolderTree size={16} style={{ color: 'var(--c-accent-text)' }} />
        <span style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>
          {t('Subgalleries')}
        </span>
        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
          {peek.length}
        </span>
        <ChevronRight size={15} className="ml-auto"
                      style={{ color: 'rgba(255,255,255,0.3)',
                               transform: open ? 'rotate(90deg)' : 'none',
                               transition: 'transform 0.15s ease' }} />
      </button>
      {open && (
        <div className="pb-2" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
          <Level galleryId={galleryId} depth={0} onOpen={onOpen} />
        </div>
      )}
    </div>
  )
}
