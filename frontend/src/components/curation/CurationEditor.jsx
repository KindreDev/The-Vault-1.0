import React, { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FolderPen, Users, Tag as TagIcon, Star, Heart, X, Search,
  Calendar, DollarSign, AlignLeft, UserPlus, Loader2,
} from 'lucide-react'
import { creatorsApi } from '../../lib/api'
import TagAutocompleteInput from '../TagAutocompleteInput'
import { useT } from '../../i18n'
import toast from 'react-hot-toast'

// Same six the rest of the app uses. Offered inline because the whole point of
// the run is not having to leave it — bouncing to the Creators page to add a
// name mid-curation is exactly the friction that kills the habit.
const CREATOR_TYPES = ['cosplayer', 'ethot', 'artist', 'character', 'actress', 'custom']

const LABEL = { fontSize: 16, color: 'rgba(255,255,255,0.45)' }
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

function Section({ icon: Icon, title, hint, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: 'rgba(255,255,255,0.35)' }} />
        <span style={LABEL}>{title}</span>
        {hint && <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/**
 * The staged-edit sidebar. Nothing here writes to the server — every change
 * lands in `draft` and is committed as one unit by the run's Save action. That
 * is what makes "you have unsaved changes, keep them?" an honest question on
 * close rather than a lie about work already written to disk.
 */
export default function CurationEditor({ draft, patch, gallery }) {
  const t = useT()
  const qc = useQueryClient()
  const [creatorSearch, setCreatorSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [ratingHover, setRatingHover] = useState(0)

  const { data: creatorList = [] } = useQuery({
    queryKey: ['curation-creators'],
    queryFn: () => creatorsApi.list({ limit: 2000 }).then(r =>
      Array.isArray(r.data) ? r.data : (r.data?.items ?? [])),
    staleTime: 5 * 60 * 1000,
  })

  const selectedCreators = useMemo(
    () => creatorList.filter(c => draft.creator_ids.includes(c.id)),
    [creatorList, draft.creator_ids],
  )

  const matches = useMemo(() => {
    const q = creatorSearch.trim().toLowerCase()
    if (!q) return []
    return creatorList
      .filter(c => c.name?.toLowerCase().includes(q) && !draft.creator_ids.includes(c.id))
      .slice(0, 8)
  }, [creatorSearch, creatorList, draft.creator_ids])

  const addCreator = (id) => {
    patch({ creator_ids: [...draft.creator_ids, id] })
    setCreatorSearch('')
  }

  // The one action here that isn't staged: a creator has to exist server-side
  // before a draft can reference her id. Created immediately, then assigned to
  // the draft like any other pick.
  const createCreator = async (type) => {
    const name = creatorSearch.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const r = await creatorsApi.create({ name, creator_type: type })
      await qc.invalidateQueries({ queryKey: ['curation-creators'] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      addCreator(r.data.id)
      toast.success(t('Created {name}').replace('{name}', name))
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not create that creator'))
    } finally {
      setCreating(false)
    }
  }

  const exactMatch = creatorList.some(
    c => c.name?.toLowerCase() === creatorSearch.trim().toLowerCase())
  const canCreate = creatorSearch.trim().length >= 2 && !exactMatch

  return (
    <div className="flex flex-col gap-5 p-4 overflow-y-auto"
         style={{ width: 400, flexShrink: 0, borderLeft: '0.5px solid rgba(255,255,255,0.07)' }}>

      {/* ── Folder name — renames on disk when saved ─────────────────────── */}
      <Section icon={FolderPen} title={t('Folder name')} hint={t('renames on disk')}>
        <input value={draft.folder_name}
               onChange={e => patch({ folder_name: e.target.value })}
               style={FIELD} spellCheck={false} />
        <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.22)' }}
             className="truncate" title={gallery.parent_path}>
          {gallery.parent_path}
        </div>
      </Section>

      {/* ── Display name ─────────────────────────────────────────────────── */}
      <Section icon={AlignLeft} title={t('Display name')}>
        <input value={draft.name}
               onChange={e => patch({ name: e.target.value })}
               style={FIELD} />
      </Section>

      {/* ── Creators ─────────────────────────────────────────────────────── */}
      <Section icon={Users} title={t('Creators')}
               hint={draft.creator_ids.length ? null : t('none assigned')}>
        {selectedCreators.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedCreators.map(c => (
              <span key={c.id}
                    className="flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1"
                    style={{
                      fontSize: 16,
                      background: c.is_favorite ? 'color-mix(in srgb, var(--c-pink) 18%, transparent)' : 'color-mix(in srgb, var(--c-accent) 18%, transparent)',
                      color: c.is_favorite ? 'var(--c-pink-text)' : 'var(--c-accent-text)',
                      border: `0.5px solid ${c.is_favorite ? 'color-mix(in srgb, var(--c-pink) 40%, transparent)' : 'color-mix(in srgb, var(--c-accent) 35%, transparent)'}`,
                    }}>
                {c.is_favorite && <Heart size={11} fill="currentColor" />}
                {c.name}
                <button onClick={() => patch({ creator_ids: draft.creator_ids.filter(id => id !== c.id) })}
                        className="cursor-pointer opacity-60 hover:opacity-100">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <Search size={14}
                  style={{ position: 'absolute', left: 10, top: 12, color: 'rgba(255,255,255,0.3)' }} />
          <input value={creatorSearch}
                 onChange={e => setCreatorSearch(e.target.value)}
                 placeholder={t('Search creators…')}
                 style={{ ...FIELD, paddingLeft: 32 }} />
          {(matches.length > 0 || canCreate) && (
            <div className="absolute left-0 right-0 mt-1 rounded-[8px] overflow-hidden z-20"
                 style={{ background: '#232323', border: '0.5px solid rgba(255,255,255,0.12)' }}>
              {matches.map(c => (
                <button key={c.id} onClick={() => addCreator(c.id)}
                        className="flex items-center gap-2 w-full text-left px-3 py-2 cursor-pointer hover:bg-white/5"
                        style={{ fontSize: 16, color: 'rgba(255,255,255,0.8)' }}>
                  {c.is_favorite && <Heart size={12} fill="var(--c-pink)" color="var(--c-pink)" />}
                  {c.name}
                </button>
              ))}

              {/* Create-new sits below the matches, never above them: reusing an
                  existing creator must stay the path of least resistance, or the
                  roster forks on every typo. */}
              {canCreate && (
                <div className="px-3 py-2.5 flex flex-col gap-2"
                     style={{ borderTop: matches.length ? '0.5px solid rgba(255,255,255,0.09)' : 'none',
                              background: 'color-mix(in srgb, var(--c-green) 7%, transparent)' }}>
                  <div className="flex items-center gap-2" style={{ fontSize: 16, color: 'var(--c-green-text)' }}>
                    {creating ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                    {t('Create')} “{creatorSearch.trim()}” {t('as')}…
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CREATOR_TYPES.map(type => (
                      <button key={type} onClick={() => createCreator(type)} disabled={creating}
                              className="px-2.5 py-1 rounded-full cursor-pointer disabled:opacity-40"
                              style={{
                                fontSize: 16,
                                background: 'color-mix(in srgb, var(--c-green) 16%, transparent)', color: 'var(--c-green-text)',
                                border: '0.5px solid color-mix(in srgb, var(--c-green) 32%, transparent)',
                              }}>
                        {t(type)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── Tags ─────────────────────────────────────────────────────────── */}
      <Section icon={TagIcon} title={t('Gallery tags')}>
        {draft.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {draft.tags.map(name => (
              <span key={name} className="flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1"
                    style={{
                      fontSize: 16, background: 'rgba(255,255,255,0.07)',
                      color: 'rgba(255,255,255,0.85)',
                      border: '0.5px solid rgba(255,255,255,0.12)',
                    }}>
                {name}
                <button onClick={() => patch({ tags: draft.tags.filter(x => x !== name) })}
                        className="cursor-pointer opacity-60 hover:opacity-100">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <TagAutocompleteInput
          exclude={draft.tags}
          placeholder={t('Add gallery tag…')}
          onAdd={name => {
            const n = String(name).toLowerCase().trim()
            if (n && !draft.tags.includes(n)) patch({ tags: [...draft.tags, n] })
          }}
        />
      </Section>

      {/* ── Rating ───────────────────────────────────────────────────────────
          Ten stars, not five: galleries are rated 0-10 everywhere else in the
          app and the backend rejects anything above 10. A five-star control
          here silently wrote half the intended value. */}
      <Section icon={Star} title={t('Rating')}
               hint={draft.rating > 0 ? `${draft.rating}/10` : null}>
        <div className="flex items-center gap-0.5" onMouseLeave={() => setRatingHover(0)}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
            const filled = ratingHover ? n <= ratingHover : n <= draft.rating
            return (
              <button key={n} type="button"
                      onMouseEnter={() => setRatingHover(n)}
                      onClick={() => patch({ rating: draft.rating === n ? 0 : n })}
                      className="cursor-pointer transition-transform hover:scale-125"
                      title={`${t('Rate')} ${n}/10`}>
                <Star size={20}
                      fill={filled ? (ratingHover ? 'color-mix(in srgb, var(--c-amber) 70%, transparent)' : 'var(--c-amber)') : 'none'}
                      stroke={filled ? 'var(--c-amber)' : 'rgba(255,255,255,0.25)'}
                      strokeWidth={1.5} />
              </button>
            )
          })}
          {draft.rating > 0 && (
            <button onClick={() => patch({ rating: 0 })}
                    className="ml-2 cursor-pointer"
                    style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
              {t('clear')}
            </button>
          )}
        </div>
      </Section>

      {/* ── Favourite ────────────────────────────────────────────────────── */}
      <button onClick={() => patch({ is_favorite: !draft.is_favorite })}
              className="flex items-center gap-2 rounded-[8px] px-3 py-2.5 cursor-pointer"
              style={{
                fontSize: 16,
                background: draft.is_favorite ? 'color-mix(in srgb, var(--c-pink) 18%, transparent)' : 'rgba(255,255,255,0.05)',
                color: draft.is_favorite ? 'var(--c-pink-text)' : 'rgba(255,255,255,0.5)',
                border: `0.5px solid ${draft.is_favorite ? 'color-mix(in srgb, var(--c-pink) 40%, transparent)' : 'rgba(255,255,255,0.1)'}`,
              }}>
        <Heart size={15} fill={draft.is_favorite ? 'currentColor' : 'none'} />
        {draft.is_favorite ? t('Favourite gallery') : t('Mark as favourite')}
      </button>

      {/* ── Period & value ───────────────────────────────────────────────── */}
      <Section icon={Calendar} title={t('Period & value')} hint={t('optional')}>
        <div className="flex gap-2">
          <input type="number" min={1} max={12} placeholder={t('Month')}
                 value={draft.period_month ?? ''}
                 onChange={e => patch({ period_month: e.target.value ? Number(e.target.value) : null })}
                 style={{ ...FIELD, width: 90 }} />
          <input type="number" min={1990} max={2100} placeholder={t('Year')}
                 value={draft.period_year ?? ''}
                 onChange={e => patch({ period_year: e.target.value ? Number(e.target.value) : null })}
                 style={{ ...FIELD, width: 110 }} />
          <div className="relative flex-1">
            <DollarSign size={14}
                        style={{ position: 'absolute', left: 9, top: 12, color: 'rgba(255,255,255,0.3)' }} />
            <input type="number" min={0} step="0.01" placeholder="0.00"
                   value={draft.purchase_value || ''}
                   onChange={e => patch({ purchase_value: e.target.value ? Number(e.target.value) : 0 })}
                   style={{ ...FIELD, paddingLeft: 28 }} />
          </div>
        </div>
      </Section>

      {/* ── Notes ────────────────────────────────────────────────────────── */}
      <Section icon={AlignLeft} title={t('Notes')}>
        <textarea value={draft.description}
                  onChange={e => patch({ description: e.target.value })}
                  rows={3}
                  style={{ ...FIELD, resize: 'vertical' }} />
      </Section>
    </div>
  )
}
