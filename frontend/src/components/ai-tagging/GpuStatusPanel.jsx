import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { scannerApi } from '../../lib/api'
import { useT } from '../../i18n'

const pill = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-[16px] font-medium w-fit'

// GPU readiness for AI tagging: ready badge, one-time CUDA download, progress.
export default function GpuStatusPanel() {
  const qc = useQueryClient()
  const t = useT()
  const { data: gpu, isLoading } = useQuery({
    queryKey: ['gpu-status'],
    queryFn: () => scannerApi.gpuStatus().then(r => r.data),
    // Only keep polling during an active DLL download; otherwise fetch once.
    refetchInterval: (q) => {
      const d = q.state.data
      if (!d) return 2000
      if (d.phase === 'downloading' || d.phase === 'extracting') return 1500
      return false
    },
  })

  const downloadMutation = useMutation({
    mutationFn: () => scannerApi.gpuDownload(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gpu-status'] }),
    onError: (e) => toast.error(e?.response?.data?.detail || t('Download failed')),
  })

  if (isLoading || !gpu) return null

  if (gpu.cuda_available) {
    return (
      <span className={pill}
            style={{ background: 'color-mix(in srgb, var(--c-green) 15%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 35%, transparent)' }}>
        {t('⚡ GPU ready (CUDA)')}
      </span>
    )
  }

  if (gpu.running) {
    const pct = gpu.bytes_total > 0 ? Math.round((gpu.bytes_done / gpu.bytes_total) * 100) : null
    const doneMB = Math.round(gpu.bytes_done / (1024 * 1024))
    const totalMB = Math.round(gpu.bytes_total / (1024 * 1024))
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 25%, transparent)' }}>
        <div className="flex items-center justify-between gap-3 mb-2 text-[16px]">
          <span className="font-medium" style={{ color: 'var(--c-accent-text)' }}>
            {t('Downloading GPU support')} ({gpu.package_index}/{gpu.package_total}) — {gpu.package}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>
            {pct !== null ? `${pct}%` : '…'} · {doneMB} / {totalMB} MB
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
          {pct !== null
            ? <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--c-accent)' }} />
            : <div className="h-full rounded-full animate-pulse" style={{ width: '100%', background: 'color-mix(in srgb, var(--c-accent) 50%, transparent)' }} />
          }
        </div>
        {gpu.phase === 'extracting' && (
          <div className="text-[16px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>{t('Extracting DLLs…')}</div>
        )}
      </div>
    )
  }

  if (gpu.phase === 'done' && gpu.dlls_present && !gpu.cuda_available) {
    return (
      <div className="rounded-[10px] p-3 text-[16px]"
           style={{ background: 'color-mix(in srgb, var(--c-green) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)', color: 'var(--c-green-text)' }}>
        {t('✓ GPU DLLs downloaded — restart the backend to activate GPU')}
      </div>
    )
  }

  if (gpu.phase === 'error') {
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'color-mix(in srgb, var(--c-pink) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
        <div className="text-[16px] mb-2" style={{ color: '#F4C0D1' }}>{t('GPU download failed:')} {gpu.error}</div>
        <button onClick={() => downloadMutation.mutate()}
                className="text-[16px] px-3 py-1 rounded-full cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
          {t('Retry')}
        </button>
      </div>
    )
  }

  if (gpu.has_nvidia_gpu && !gpu.dlls_present) {
    return (
      <div className="rounded-[10px] p-3" style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 20%, transparent)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-[16px]">
            <div className="font-medium mb-0.5" style={{ color: 'var(--c-accent-text)' }}>{t('⚡ NVIDIA GPU detected')}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)' }}>
              {t('Download GPU acceleration (~1.6 GB, one-time). Tagging will be dramatically faster.')}
            </div>
          </div>
          <button
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[16px] font-medium cursor-pointer flex-shrink-0"
            style={{ background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }}>
            <Download size={14} /> {t('Download GPU support')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <span className={pill}
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
      {t('🖥 CPU only — no NVIDIA GPU detected')}
    </span>
  )
}
