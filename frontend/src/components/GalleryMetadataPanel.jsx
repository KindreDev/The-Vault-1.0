import React, { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Tag, AlignLeft, X } from 'lucide-react'
import { curationApi, apiErrorMessage } from '../lib/api'
import { useT } from '../i18n'
import TagAutocompleteInput from './TagAutocompleteInput'
import './gallery-metadata.css'
import { createMetadataAutosave } from '../lib/metadataAutosave'

const autosaves = new WeakMap()

export default function GalleryMetadataPanel({ gallery }) {
  const t = useT()
  const qc = useQueryClient()
  const save = useMemo(() => {
    if (!autosaves.has(qc)) autosaves.set(qc, new Map())
    const controllers = autosaves.get(qc)
    if (!controllers.has(gallery.id)) {
      let storage
      try { storage = window.localStorage } catch { /* saves still reach the server */ }
      controllers.set(gallery.id, createMetadataAutosave({
        storage, key: `vault-gallery-metadata-pending:${gallery.id}`,
        save: payload => curationApi.save({ gallery_id: gallery.id, mark_curated: false, ...payload }),
        onSaved: payload => {
          qc.setQueryData(['gallery', String(gallery.id)], current => current && ({
            ...current,
            ...('description' in payload ? { description: payload.description } : {}),
            ...('tags' in payload ? { tags: payload.tags.map(name =>
              (current.tags ?? []).find(tag => tag.name === name) ?? { name }) } : {}),
          }))
          void qc.invalidateQueries({ queryKey: ['gallery', String(gallery.id)] })
        },
      }))
    }
    return controllers.get(gallery.id)
  }, [qc, gallery.id])
  const state = useSyncExternalStore(save.subscribe, save.getSnapshot, save.getSnapshot)
  useEffect(() => { void save.flush() }, [save])
  const tags = state.draft.tags ?? (gallery.tags ?? []).map(tag => tag.name)
  const notes = state.draft.description ?? gallery.description ?? ''

  return (
    <section className="gallery-metadata" aria-label={t('Gallery tags and notes')}>
      <fieldset>
        <div className="gallery-metadata-tag-editor">
        <div className="gallery-metadata-heading"><Tag size={17} /> {t('Gallery tags')}</div>
        {tags.length > 0 && (
          <div className="gallery-metadata-tags">
            {tags.map(name => (
              <span key={name} className="gallery-metadata-tag">
                <span>{name}</span>
                <button type="button" aria-label={`${t('Remove tag')}: ${name}`}
                        onClick={() => save.edit({ tags: tags.filter(tag => tag !== name) })}>
                  <X size={16} />
                </button>
              </span>
            ))}
          </div>
        )}
        <TagAutocompleteInput exclude={tags} placeholder={t('Add gallery tag…')}
          onAdd={name => {
            const current = save.getSnapshot().draft.tags ?? tags
            save.edit({ tags: [...new Set([...current, name])] })
          }} />
        </div>
        <div className="gallery-metadata-note-editor">
        <label className="gallery-metadata-heading" htmlFor={`gallery-notes-${gallery.id}`}>
          <AlignLeft size={17} /> {t('Notes')}
        </label>
        <textarea id={`gallery-notes-${gallery.id}`} rows={3} value={notes}
          placeholder={t('Add notes about this gallery…')}
          onChange={event => save.edit({ description: event.target.value })} />
        </div>
      </fieldset>
      {state.error && <div role="alert" className="gallery-metadata-error">
        {apiErrorMessage(state.error, t('Save failed'))}
      </div>}
    </section>
  )
}
