import { LocalizedText, useT } from '../../i18n'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen, ListVideo, Search, UserRound, X } from 'lucide-react'
import { creatorsApi, galleriesApi, playlistsApi } from '../../lib/api'
import { DEFAULT_SOURCE, asList } from './roomMedia'

const KINDS = [
  ['search', 'Search', Search],
  ['gallery', 'Gallery', FolderOpen],
  ['creator', 'Creator', UserRound],
  ['playlist', 'Playlist', ListVideo],
]

function useSettled(value, delay = 280) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value.trim()), delay)
    return () => window.clearTimeout(timer)
  }, [delay, value])
  return settled
}

/** Searchable list of galleries, creators or playlists to pick one from. */
function SourceList({ kind, onPick }) {
  const t = useT()
  const [text, setText] = useState('')
  const search = useSettled(text)
  const { data = [], isFetching } = useQuery({
    queryKey: ['room-source-list', kind, kind === 'playlist' ? '' : search],
    queryFn: async () => {
      if (kind === 'playlist') return asList((await playlistsApi.list()).data)
      const api = kind === 'gallery' ? galleriesApi : creatorsApi
      return asList((await api.list({ search: search || undefined, limit: 40 })).data)
    },
    staleTime: 60_000,
  })
  const rows = kind === 'playlist' && search
    ? data.filter(row => String(row.name || '').toLowerCase().includes(search.toLowerCase()))
    : data
  return <div className="tcg-room-source__list">
    <label className="tcg-room-display-manager__search"><Search size={18} />
      <input value={text} onChange={event => setText(event.target.value)} autoFocus
        placeholder={t(kind === 'gallery' ? 'Find a gallery' : kind === 'creator' ? 'Find a creator' : 'Find a playlist')} />
    </label>
    <div>{rows.map(row => <button key={row.id} type="button" onClick={() => onPick({ kind, id: row.id, name: String(row.name || row.title || `#${row.id}`).slice(0, 80) })}>
      <strong>{row.name || row.title || `#${row.id}`}</strong>
      {(row.image_count ?? row.media_count ?? row.file_count) != null && <small>{Number(row.image_count ?? row.media_count ?? row.file_count).toLocaleString()}</small>}
    </button>)}</div>
    {!rows.length && !isFetching && <div className="tcg-room-empty"><strong><LocalizedText text="Nothing matches" /></strong></div>}
  </div>
}

/**
 * Where a room piece takes its photos from.  `value` is a media source (see
 * roomMedia.js); `onChange` gets the new one.  Search changes are debounced.
 */
export default function RoomSourcePicker({ value = DEFAULT_SOURCE, onChange, searchPlaceholder }) {
  const t = useT()
  const [kind, setKind] = useState(value?.kind || 'search')
  const [text, setText] = useState(value?.kind === 'search' ? value.query || '' : '')
  const query = useSettled(text)
  useEffect(() => {
    if (kind === 'search' && (value?.kind !== 'search' || (value.query || '') !== query)) onChange({ kind: 'search', query })
  }, [kind, query]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = value && value.kind === kind && value.kind !== 'search' && value.id ? value : null
  return <div className="tcg-room-source">
    <div className="tcg-room-source__kinds" role="tablist" aria-label={t('Photo source')}>
      {KINDS.map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={kind === id}
        className={kind === id ? 'selected' : ''} onClick={() => setKind(id)}><Icon size={15} /><LocalizedText text={label} /></button>)}
    </div>
    {kind === 'search' && <label className="tcg-room-display-manager__search"><Search size={18} />
      <input value={text} onChange={event => setText(event.target.value)} placeholder={searchPlaceholder || t('Search tags or filename')} />
    </label>}
    {kind !== 'search' && chosen && <div className="tcg-room-source__chosen">
      <span><LocalizedText text={kind === 'gallery' ? 'Gallery' : kind === 'creator' ? 'Creator' : 'Playlist'} /></span>
      <strong>{chosen.name}</strong>
      <button type="button" onClick={() => onChange({ kind, id: null })} aria-label={t('Choose another')} title={t('Choose another')}><X size={16} /></button>
    </div>}
    {kind !== 'search' && !chosen && <SourceList kind={kind} onPick={onChange} />}
  </div>
}
