import React, { useState } from 'react'
import { AlignLeft, FolderOpen, Heart, Star } from 'lucide-react'
import { CreatorPanel, TagPanel } from '../ViewerPanel'
import { useT } from '../../i18n'

const FIELD = {
  fontSize: 16,
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.9)',
  border: '0.5px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  padding: '9px 11px',
  width: '100%',
  outline: 'none',
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>
        <Icon size={15} style={{ color: 'rgba(255,255,255,0.35)' }} />
        {title}
      </div>
      {children}
    </div>
  )
}

/** Metadata editor for one file. Creator and tag changes use the same proven
 * file-level panels as the full viewer; rating, favourite and notes stay staged
 * until the curation action is committed. */
export default function FileCurationEditor({ file, draft, patch, tags, onTagsChanged, creators, onCreatorsChanged, onHasImageCreatorsChanged, onFileCreatorIdsChanged }) {
  const t = useT()
  const [ratingHover, setRatingHover] = useState(0)
  const directoryPath = file.directory_path || (file.file_path ? file.file_path.replace(/[\\/][^\\/]*$/, '') : '')
  const fileCreatorIds = draft.file_creator_ids || file.file_creator_ids || []
  const galleryCreatorIds = (creators || [])
    .filter(c => !fileCreatorIds.includes(c.id))
    .map(c => c.id)

  return (
    <aside className="flex flex-col gap-5 p-4 min-h-0 overflow-y-auto"
           style={{ width: 400, flexShrink: 0, borderLeft: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="truncate" style={{ fontSize: 18, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }} title={file.filename}>
        {file.filename}
      </div>
      <div className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
        {file.gallery_name || t('Unassigned gallery')}
      </div>
      <div className="flex items-start gap-2" title={directoryPath}>
        <FolderOpen size={15} style={{ color: 'rgba(255,255,255,0.3)', marginTop: 2, flexShrink: 0 }} />
        <div className="min-w-0">
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.32)' }}>{t('Directory on disk')}</div>
          <div className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)' }}>
            {directoryPath || t('Directory unavailable')}
          </div>
        </div>
      </div>

      <CreatorPanel
        imageId={file.id}
        galleryId={file.gallery_id}
        creators={creators}
        hasImageCreators={draft.has_image_creators}
        fileCreatorIds={fileCreatorIds}
        galleryCreatorIds={galleryCreatorIds}
        onCreatorsChanged={onCreatorsChanged}
        onHasImageCreatorsChanged={onHasImageCreatorsChanged}
        onFileCreatorIdsChanged={onFileCreatorIdsChanged}
        allowCreate
      />
      <TagPanel imageId={file.id} tags={tags} onTagsChanged={onTagsChanged} />

      <Section icon={Star} title={t('Rating')}>
        <div className="flex items-center gap-0.5" onMouseLeave={() => setRatingHover(0)}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
            const filled = n <= (ratingHover || draft.rating)
            return <button key={n} type="button" onMouseEnter={() => setRatingHover(n)}
                           onClick={() => patch({ rating: draft.rating === n ? 0 : n })}
                           className="cursor-pointer transition-transform hover:scale-125"
                           title={`${t('Rate')} ${n}/10`}>
              <Star size={20} fill={filled ? 'var(--c-amber)' : 'none'}
                    stroke={filled ? 'var(--c-amber)' : 'rgba(255,255,255,0.25)'} strokeWidth={1.5} />
            </button>
          })}
        </div>
      </Section>

      <button type="button" onClick={() => patch({ is_favorite: !draft.is_favorite })}
              className="flex items-center gap-2 rounded-[8px] px-3 py-2.5 cursor-pointer"
              style={{ fontSize: 16, background: draft.is_favorite ? 'color-mix(in srgb, var(--c-pink) 18%, transparent)' : 'rgba(255,255,255,0.05)', color: draft.is_favorite ? 'var(--c-pink-text)' : 'rgba(255,255,255,0.5)', border: `0.5px solid ${draft.is_favorite ? 'color-mix(in srgb, var(--c-pink) 40%, transparent)' : 'rgba(255,255,255,0.1)'}` }}>
        <Heart size={15} fill={draft.is_favorite ? 'currentColor' : 'none'} />
        {draft.is_favorite ? t('Favourite file') : t('Mark as favourite')}
      </button>

      <Section icon={AlignLeft} title={t('Notes')}>
        <textarea value={draft.notes} onChange={e => patch({ notes: e.target.value })}
                  rows={5} style={{ ...FIELD, resize: 'vertical' }} />
      </Section>
    </aside>
  )
}
