import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ListPlus, Plus } from 'lucide-react'
import { playlistsApi } from '../lib/api.js'
import { useVaultStore } from '../store/vault.js'
import BottomSheet from './BottomSheet.jsx'

// Mounted once in App. Watches the global `playlistTarget` (an array of image
// ids). When set, shows a sheet to pick an existing playlist or create a new
// one, then adds every target image to it.
export default function PlaylistPicker() {
  const qc = useQueryClient()
  const target = useVaultStore(s => s.playlistTarget)
  const close = useVaultStore(s => s.closePlaylistPicker)
  const addToast = useVaultStore(s => s.addToast)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const open = Array.isArray(target) && target.length > 0
  // Keep the last count so the sheet's title stays correct while it animates out
  // (target becomes null on close, but the sheet is still visible mid-dismiss).
  const [lastCount, setLastCount] = useState(0)
  useEffect(() => { if (open) setLastCount(target.length) }, [open, target])

  const { data: playlists } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlistsApi.list().then(r => r.data),
    enabled: open,
  })

  async function addToPlaylist(playlistId) {
    if (!target) return
    try {
      await Promise.all(target.map(im => playlistsApi.addImage(playlistId, im).catch(() => {})))
      addToast(`Added ${target.length} to playlist`, 'xp')
      qc.invalidateQueries({ queryKey: ['playlists'] })
    } catch { addToast('Failed to add', 'info') }
    reset()
  }

  async function createAndAdd() {
    const n = name.trim()
    if (!n) return
    try {
      const { data } = await playlistsApi.create({ name: n })
      await addToPlaylist(data.id)
    } catch { addToast('Could not create playlist', 'info'); reset() }
  }

  function reset() {
    setCreating(false); setName(''); close()
  }

  return (
    <BottomSheet open={open} onClose={reset} title={`Add ${lastCount} item${lastCount > 1 ? 's' : ''} to…`}>
      {creating ? (
        <div className="px-5 pb-4">
          <input
            autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="Playlist name" maxLength={60}
            className="w-full px-3 py-3 rounded-xl bg-transparent outline-none text-[16px] mb-3"
            style={{ border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <button onClick={createAndAdd}
                  className="w-full py-3 rounded-xl text-[16px] font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff' }}>
            Create & add
          </button>
        </div>
      ) : (
        <div className="pb-2 max-h-[50vh] overflow-y-auto">
          <button onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left text-[17px] active:bg-white/5"
                  style={{ color: 'var(--accent)' }}>
            <Plus size={22} /> New playlist
          </button>
          {playlists?.map(p => (
            <button key={p.id} onClick={() => addToPlaylist(p.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left text-[17px] active:bg-white/5"
                    style={{ color: 'rgba(255,255,255,0.9)' }}>
              <ListPlus size={22} style={{ color: 'rgba(255,255,255,0.4)' }} />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-[14px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{p.image_count ?? 0}</span>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
