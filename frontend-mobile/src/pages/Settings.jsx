import { useState, useEffect, useRef } from 'react'
import { Check, RefreshCw, FolderSync, Server, Power, Loader2 } from 'lucide-react'
import { scannerApi, systemApi } from '../lib/api.js'
import { getServerBase, setServerBase } from '../lib/server.js'
import { refreshApiBase } from '../lib/api.js'
import { useVaultStore, PALETTES } from '../store/vault.js'
import { PageHeader } from '../components/ui.jsx'

function Section({ title, children }) {
  return (
    <div className="px-4 mt-6">
      <h2 className="text-[15px] font-semibold mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>{title}</h2>
      <div className="rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>{children}</div>
    </div>
  )
}

function Row({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[16px] disabled:opacity-50"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      {children}
    </button>
  )
}

export default function Settings() {
  const palette = useVaultStore(s => s.palette)
  const setPalette = useVaultStore(s => s.setPalette)
  const addToast = useVaultStore(s => s.addToast)

  const [scan, setScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [addr, setAddr] = useState(getServerBase())
  const [version, setVersion] = useState('')
  const poll = useRef(null)

  useEffect(() => {
    systemApi.getVersion().then(r => setVersion(r.data?.version || '')).catch(() => {})
    return () => clearInterval(poll.current)
  }, [])

  async function triggerScan() {
    try {
      await scannerApi.scan()
      setScanning(true)
      addToast('Scan started', 'info')
      clearInterval(poll.current)
      poll.current = setInterval(async () => {
        try {
          const { data } = await scannerApi.status()
          setScan(data)
          if (!data.running) {
            clearInterval(poll.current)
            setScanning(false)
            addToast(`Scan done · +${data.new_galleries} galleries`, 'xp')
          }
        } catch { clearInterval(poll.current); setScanning(false) }
      }, 1200)
    } catch (e) {
      addToast(e?.response?.data?.detail || 'Scan failed', 'info')
    }
  }

  async function restart() {
    if (!confirm('Restart the Vault server? The app will lose connection for a moment.')) return
    try { await systemApi.restart(); addToast('Server restarting…', 'info') }
    catch { addToast('Restart signal sent', 'info') }
  }

  function saveAddr() {
    const v = setServerBase(addr)
    refreshApiBase()
    setAddr(v)
    addToast('Server address saved', 'info')
  }

  return (
    <div>
      <PageHeader title="Settings" />

      {/* Theme */}
      <Section title="THEME">
        <div className="grid grid-cols-4 gap-3 p-4">
          {PALETTES.map(p => {
            const active = palette.id === p.id
            return (
              <button key={p.id} onClick={() => setPalette(p)} className="flex flex-col items-center gap-1.5">
                <div className="relative w-full aspect-square rounded-full overflow-hidden border-2"
                     style={{ borderColor: active ? p.accent : 'transparent', background: p.bg }}>
                  <div className="absolute inset-0 flex">
                    <div className="flex-1" style={{ background: p.accent }} />
                    <div className="flex-1" style={{ background: p.pink }} />
                    <div className="flex-1" style={{ background: p.amber }} />
                  </div>
                  {active && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Check size={20} color="#fff" />
                    </div>
                  )}
                </div>
                <span className="text-[13px]" style={{ color: active ? p.accent : 'rgba(255,255,255,0.5)' }}>{p.label}</span>
              </button>
            )
          })}
        </div>
      </Section>

      {/* Library */}
      <Section title="LIBRARY">
        <Row onClick={triggerScan} disabled={scanning}>
          {scanning ? <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
                    : <FolderSync size={20} style={{ color: 'var(--accent)' }} />}
          <div className="flex-1">
            <div>{scanning ? 'Scanning…' : 'Scan library'}</div>
            {scan && scanning && (
              <div className="text-[14px] truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {scan.progress}/{scan.total} · {scan.message}
              </div>
            )}
          </div>
        </Row>
      </Section>

      {/* Server */}
      <Section title="SERVER">
        <div className="px-4 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2 mb-2 text-[15px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <Server size={18} /> Vault PC address
          </div>
          <div className="flex gap-2">
            <input value={addr} onChange={e => setAddr(e.target.value)}
                   placeholder="192.168.1.42:8000" autoCapitalize="none" autoCorrect="off"
                   className="flex-1 px-3 py-2.5 rounded-xl bg-transparent outline-none text-[16px]"
                   style={{ border: '1px solid rgba(255,255,255,0.12)' }} />
            <button onClick={saveAddr} className="px-4 rounded-xl text-[15px] font-semibold"
                    style={{ background: 'var(--accent)', color: '#fff' }}>Save</button>
          </div>
        </div>
        <Row onClick={restart}>
          <Power size={20} style={{ color: 'var(--c-pink)' }} />
          <span className="flex-1">Restart server</span>
        </Row>
      </Section>

      <div className="text-center text-[14px] mt-8 mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
        The Vault Mobile{version ? ` · v${version}` : ''}
      </div>
      <div className="h-4" />
    </div>
  )
}
