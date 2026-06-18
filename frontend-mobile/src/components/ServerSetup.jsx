import { useState } from 'react'
import { Server, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { setServerBase, getServerBase } from '../lib/server.js'
import { refreshApiBase, systemApi } from '../lib/api.js'

// First-launch screen: the user types their PC's LAN address. We verify the
// backend responds before saving and continuing.
export default function ServerSetup({ onConnected }) {
  const [value, setValue] = useState(getServerBase() || '')
  const [state, setState] = useState('idle') // idle | testing | ok | fail
  const [error, setError] = useState('')

  async function test() {
    if (!value.trim()) return
    setState('testing'); setError('')
    setServerBase(value)
    refreshApiBase()
    try {
      await systemApi.health()
      setState('ok')
      setTimeout(() => onConnected(), 500)
    } catch (e) {
      setState('fail')
      setError('Could not reach the server. Check the address and that The Vault is running on your PC.')
    }
  }

  return (
    <div className="min-h-full flex flex-col justify-center px-7 safe-top safe-bottom"
         style={{ background: 'var(--c-bg)' }}>
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
             style={{ background: 'var(--accent)' }}>
          <Server size={32} color="#fff" />
        </div>
        <h1 className="text-2xl font-bold">Connect to The Vault</h1>
        <p className="text-[15px] text-center mt-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Enter your PC's address. Your phone must be on the same WiFi.
        </p>
      </div>

      <label className="text-[15px] mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
        Server address
      </label>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && test()}
        placeholder="192.168.1.42:8000"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        name="vault-server-address"
        inputMode="url"
        className="w-full px-4 py-3.5 rounded-xl text-[17px] outline-none border"
        style={{ background: 'var(--c-card)', borderColor: 'var(--accent)', color: '#fff' }}
      />

      {error && (
        <div className="flex items-start gap-2 mt-3 text-[14px]" style={{ color: 'var(--c-pink)' }}>
          <XCircle size={18} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <button
        onClick={test}
        disabled={state === 'testing' || !value.trim()}
        className="mt-6 w-full py-3.5 rounded-xl text-[17px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {state === 'testing' && <Loader2 size={20} className="animate-spin" />}
        {state === 'ok' && <CheckCircle2 size={20} />}
        {state === 'testing' ? 'Connecting…' : state === 'ok' ? 'Connected!' : 'Connect'}
      </button>

      <p className="text-[13px] text-center mt-6" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Find your PC's IP with <span className="font-mono">ipconfig</span> (Windows) — look for the
        IPv4 address, then add <span className="font-mono">:8000</span>.
      </p>
    </div>
  )
}
