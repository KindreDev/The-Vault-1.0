import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { systemApi } from '../../lib/api'
import { useT } from '../../i18n'
import { useVaultStore } from '../../store/vault'

// Average seconds to build one clip, measured on real videos (0.5–4.7 s).
const SECONDS_PER_CLIP = 1.5
const LARGE_LIBRARY = 5000

function formatSize(bytes) {
  if (!bytes) return '0 MB'
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

function formatDuration(seconds, t) {
  const hours = seconds / 3600
  if (hours >= 1) return t('about {n} hours', { n: Math.round(hours) })
  return t('about {n} minutes', { n: Math.max(1, Math.round(seconds / 60)) })
}

function Switch({ on, onClick }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
            className="relative flex-shrink-0 w-14 h-8 rounded-full cursor-pointer transition-colors"
            style={{ background: on ? 'var(--c-green)' : 'rgba(255,255,255,0.12)' }}>
      <span className="absolute top-1 w-6 h-6 rounded-full bg-white transition-all" style={{ left: on ? 28 : 4 }} />
    </button>
  )
}

const ROW = { background: 'rgba(255,255,255,0.035)', border: '0.5px solid rgba(255,255,255,0.08)' }

// Settings → Performance: hover previews on/off, and building every video's
// hover clip ahead of time (off by default; meant for smaller libraries).
export default function HoverClipSettings() {
  const t = useT()
  const previewsOn = useVaultStore(s => s.hoverPreviewsEnabled)
  const setPreviewsOn = useVaultStore(s => s.setHoverPreviewsEnabled)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 p-3 rounded-[9px]" style={ROW}>
        <div>
          <div className="text-[17px] font-semibold text-white/75">{t('Play video previews on hover')}</div>
          <div className="text-[16px] text-white/40 mt-1">
            {t('Video tiles play a short muted clip while you hover them. Turn off to keep grids still and lighter on slower PCs.')}
          </div>
        </div>
        <Switch on={previewsOn} onClick={() => setPreviewsOn(!previewsOn)} />
      </div>
      {previewsOn && <PregenerateClips />}
    </div>
  )
}

function PregenerateClips() {
  const t = useT()
  const qc = useQueryClient()
  const { data: status } = useQuery({
    queryKey: ['hover-clip-status'],
    queryFn: () => systemApi.hoverClipStatus().then(r => r.data),
    refetchInterval: (query) => query.state.data?.running ? 2000 : false,
  })
  const enabled = !!status?.enabled
  const count = status?.video_count ?? 0

  const toggle = async () => {
    try {
      const { data } = await systemApi.setHoverClipPregen(!enabled)
      qc.setQueryData(['hover-clip-status'], old => ({ ...old, ...data }))
      qc.invalidateQueries({ queryKey: ['hover-clip-status'] })
      toast.success(!enabled ? t('Building hover previews in the background') : t('Hover preview building paused'))
    } catch {
      toast.error(t('Could not save hover preview setting'))
    }
  }

  const progress = status?.total ? (status.checked / status.total) * 100 : 0

  return (
    <div className="p-3 rounded-[9px]" style={ROW}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[17px] font-semibold text-white/75">{t('Pre-generate video hover previews')}</div>
          <div className="text-[16px] text-white/40 mt-1">
            {t('Builds every video\'s hover preview in the background, so even the first hover plays at once. New videos are covered after each scan. Best for smaller collections.')}
          </div>
          {status && (
            <div className="text-[15px] text-white/35 mt-1.5">
              {t('{count} videos · about {size} of disk · {time} to build', {
                count: count.toLocaleString(),
                size: formatSize(status.estimated_bytes),
                time: formatDuration(count * SECONDS_PER_CLIP, t),
              })}
            </div>
          )}
          {count > LARGE_LIBRARY && (
            <div className="text-[15px] mt-1" style={{ color: 'var(--c-amber)' }}>
              {t('Large library: without this, each video builds its preview the first time you hover it.')}
            </div>
          )}
        </div>
        <Switch on={enabled} onClick={toggle} />
      </div>

      {status && (status.running || status.total > 0) && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
            <div className="h-full rounded-full bg-[var(--c-accent)] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[14px] text-white/35 mt-1">
            {status.message ? `${t(status.message)} · ` : ''}
            {status.checked.toLocaleString()} / {status.total.toLocaleString()}
            {' · '}{t('{n} built', { n: status.built.toLocaleString() })}
            {status.failed > 0 && <> · {t('{n} failed', { n: status.failed.toLocaleString() })}</>}
            {status.skipped > 0 && <> · {t('{n} offline', { n: status.skipped.toLocaleString() })}</>}
            {' · '}{formatSize(status.bytes)}
          </div>
        </div>
      )}
    </div>
  )
}
