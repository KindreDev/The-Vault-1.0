import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, Users } from 'lucide-react'
import { creatorsApi } from '../lib/api.js'
import { creatorAvatarUrl } from '../lib/media.js'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'

const TYPES = [
  { id: '',          label: 'All' },
  { id: 'cosplayer', label: 'Cosplayers' },
  { id: 'ethot',     label: 'eThots' },
  { id: 'artist',    label: 'Artists' },
  { id: 'character', label: 'Characters' },
  { id: 'actress',   label: 'Actresses' },
  { id: 'custom',    label: 'Custom' },
]

export default function CreatorList() {
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['creators', search, type],
    queryFn: () => creatorsApi.list({
      search: search || undefined,
      creator_type: type || undefined,
      sort_by: 'name',
      limit: 500,
    }).then(r => r.data),
  })

  return (
    <div>
      <PageHeader title="Creators" />

      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 px-3 rounded-xl" style={{ background: 'var(--c-card)' }}>
          <Search size={18} style={{ color: 'rgba(255,255,255,0.4)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Search creators"
                 className="flex-1 py-2.5 bg-transparent outline-none text-[16px]" />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {TYPES.map(t => (
          <button key={t.id} onClick={() => setType(t.id)}
                  className="shrink-0 px-3.5 py-1.5 rounded-full text-[14px] font-medium"
                  style={{
                    background: type === t.id ? 'var(--accent)' : 'var(--c-card)',
                    color: type === t.id ? '#fff' : 'rgba(255,255,255,0.6)',
                  }}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? <Spinner /> : !data?.length ? (
        <Empty icon={<Users size={40} />} text="No creators found" />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 px-4">
          {data.map(c => (
            <button key={c.id} onClick={() => nav(`/creator/${c.id}`)} className="flex flex-col items-center">
              <div className="w-full aspect-square rounded-full overflow-hidden" style={{ background: 'var(--c-card)' }}>
                {c.avatar_path && <img src={creatorAvatarUrl(c.id)} alt={c.name} loading="lazy" className="w-full h-full object-cover" />}
              </div>
              <div className="mt-1.5 text-[14px] text-center truncate w-full">{c.name}</div>
              <div className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{c.gallery_count || 0} galleries</div>
            </button>
          ))}
        </div>
      )}
      <div className="h-4" />
    </div>
  )
}
