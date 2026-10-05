import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag, AlignLeft, X } from 'lucide-react'
import { curationApi, apiErrorMessage } from '../lib/api'
import { useT } from '../i18n'
import TagAutocompleteInput from './TagAutocompleteInput'
import './gallery-metadata.css'

export default function GalleryMetadataPanel({ gallery }) {
  const t = useT()
  const qc = useQueryClient()
  // Null drafts follow server updates; active drafts survive background refetches.
  const [tagDraft, setTagDraft] = useState(null)
  const [noteDraft, setNoteDraft] = useState(null)
  const tags = tagDraft ?? (gallery.tags ?? []).map(tag => tag.name)
  const notes = noteDraft ?? gallery.description ?? ''
  const dirty = tagDraft !== null || noteDraft !== null
  const save = useMutation({
    mutationFn: payload => curationApi.save({
      gallery_id: gallery.id,
      mark_curated: false,
      ...payload,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['gallery', String(gallery.id)] })
      setTagDraft(null)
      setNoteDraft(null)
    },
  })
  const edit = () => { if (save.isError || save.isSuccess) save.reset() }

  return (
    <section className="gallery-metadata" aria-label={t('Gallery tags and notes')}>
      <fieldset disabled={save.isPending}>
        <div className="gallery-metadata-heading"><Tag size={17} /> {t('Gallery tags')}</div>
        {tags.length > 0 && (
          <div className="gallery-metadata-tags">
            {tags.map(name => (
              <span key={name} className="gallery-metadata-tag">
                <span>{name}</span>
                <button type="button" aria-label={`${t('Remove tag')}: ${name}`}
                        onClick={() => { edit(); setTagDraft(tags.filter(tag => tag !== name)) }}>
                  <X size={16} />
                </button>
              </span>
            ))}
          </div>
        )}
        <TagAutocompleteInput exclude={tags} placeholder={t('Add gallery tag…')}
          onAdd={name => {
            if (save.isPending) return
            edit()
            // Functional updates also preserve comma-separated additions.
            setTagDraft(current => [...new Set([...(current ?? tags), name])])
          }} />
        <label className="gallery-metadata-heading" htmlFor={`gallery-notes-${gallery.id}`}>
          <AlignLeft size={17} /> {t('Notes')}
        </label>
        <textarea id={`gallery-notes-${gallery.id}`} rows={3} value={notes}
          placeholder={t('Add notes about this gallery…')}
          onChange={event => { edit(); setNoteDraft(event.target.value) }} />
      </fieldset>
      <div className="gallery-metadata-footer">
        <span role="status" aria-live="polite" className={save.isError ? 'gallery-metadata-error' : ''}>
          {save.isPending ? t('Saving…') : save.isError ? apiErrorMessage(save.error, t('Save failed'))
            : dirty ? t('Unsaved changes') : save.isSuccess ? t('Saved') : ''}
        </span>
        <button type="button" disabled={!dirty || save.isPending}
          onClick={() => save.mutate({
            ...(tagDraft !== null ? { tags: tagDraft } : {}),
            ...(noteDraft !== null ? { description: noteDraft } : {}),
          })}>{t('Save')}</button>
      </div>
    </section>
  )
}
