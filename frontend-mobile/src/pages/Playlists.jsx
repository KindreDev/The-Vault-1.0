import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ListMusic, Plus, Trash2 } from 'lucide-react'
import { playlistsApi } from '../lib/api.js'
import { useVaultStore } from '../store/vault.js'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'
import LongPress from '../components/LongPress.jsx'
import BottomSheet from '../components/BottomSheet.jsx'

export default function Playlists() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const addToast = useVaultStore(s => s.addToast)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [sheet, setSheet] = useState(null)

  const { data, isLoading } = useQuery({ queryKey: ['playlists'], queryFn: () => playlistsApi.list().then(r => r.data) })

  async function create() {
    const n = name.trim()
    if (!n) return
    try { await playlistsApi.create({ name: n }); addToast('Playlist created', 'xp'); qc.invalidateQueries({ queryKey: ['playlists'] }) }
    catch { addToast('Failed', 'info') }
    setName(''); setCreating(false)
  }
  async function del(p) {
    try { await playlistsApi.delete(p.id); addToast('Playlist deleted', 'info'); qc.invalidateQueries({ queryKey: ['playlists'] }) }
    catch { addToast('Failed', 'info') }
  }

  return (
    <div>
      <PageHeader title="Playlists" right={
        <button onClick={() => setCreating(true)} className="p-2 -mr-2"><Plus size={24} /></button>
      } />

      {isLoading ? <Spinner /> : !data?.length ? (
        <Empty icon={<ListMusic size={40} />} text="No playlists yet — tap + to make one" />
      ) : (
        <div className="px-4 flex flex-col gap-2.5">
          {data.map(p => (
            <LongPress key={p.id} onClick={() => nav(`/playlist/${p.id}`)} onLongPress={() => setSheet(p)}>
              <div className="flex items-center gap-3 p-3 rounded-vault" style={{ background: 'var(--c-card)' }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                  <ListMusic size={24} color="#fff" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-semibold truncate">{p.name}</div>
                  <div className="text-[14px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{p.image_count ?? 0} items</div>
                </div>
              </div>
            </LongPress>
          ))}
        </div>
      )}
      <div className="h-4" />

      {/* Create sheet */}
      <BottomSheet open={creating} onClose={() => { setCreating(false); setName('') }} title="New playlist">
        <div className="px-5 pb-4">
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Playlist name" maxLength={60}
                 className="w-full px-3 py-3 rounded-xl bg-transparent outline-none text-[16px] mb-3"
                 style={{ border: '1px solid rgba(255,255,255,0.15)' }} />
          <button onClick={create} className="w-full py-3 rounded-xl text-[16px] font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff' }}>Create</button>
        </div>
      </BottomSheet>

      {/* Action sheet */}
      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.name}
        actions={sheet ? [
          { label: 'Delete playlist', icon: <Trash2 size={20} />, danger: true, onClick: () => del(sheet) },
        ] : []} />
    </div>
  )
}
