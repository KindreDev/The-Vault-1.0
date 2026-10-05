import { useQuery } from '@tanstack/react-query'
import { useT } from '../i18n'
import { imagesApi } from '../lib/api'

function durationLabel(seconds) {
  if (!seconds) return '—'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  return `${hours ? `${hours}:` : ''}${hours ? String(Math.floor(total / 60) % 60).padStart(2, '0') : Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function ViewerInfo({ image, viewCount }) {
  const t = useT()
  const query = useQuery({
    queryKey: ['video-metadata', image.id],
    queryFn: () => imagesApi.videoMetadata(image.id).then(r => r.data),
    enabled: !!image.is_video,
    staleTime: 300000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const data = query.data
  const unavailable = query.isLoading ? t('Loading…') : '—'
  const width = data?.width || image.width
  const height = data?.height || image.height
  const rows = [
    [(image.is_video ? 'Resolution' : 'Size'), width && height ? `${width} × ${height}` : unavailable],
    ...(image.is_video ? [
      ['Duration', data?.duration || image.duration ? durationLabel(data?.duration || image.duration) : unavailable],
      ['Frame rate', data?.fps ? `${Number(data.fps.toFixed(3))} fps` : unavailable],
      ['Format', data?.format ? `${data.format}${data.codec ? ` · ${data.codec.toUpperCase()}` : ''}` : unavailable],
      ['Bit rate', data?.bit_rate ? `${(data.bit_rate / 1000000).toFixed(2)} Mbps` : unavailable],
    ] : []),
    ['File', image.file_size ? `${(image.file_size / 1024 / 1024).toFixed(1)} MB` : '—'],
    ['Views', viewCount ?? image.view_count ?? 0],
  ]
  return <div className="p-3" style={{ borderBottom: '0.5px solid var(--c-border, rgba(255,255,255,.1))', fontSize: 16 }}>
    <div className="uppercase tracking-widest mb-2" style={{ color: 'var(--c-muted, rgba(255,255,255,.55))' }}>{t('Info')}</div>
    {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-1">
      <span style={{ color: 'var(--c-muted, rgba(255,255,255,.55))' }}>{t(label)}</span>
      <span className="text-right break-words min-w-0" style={{ color: 'var(--c-text)' }}>{value}</span>
    </div>)}
    {image.is_video && query.isError && <p className="mt-2" style={{ color: 'var(--c-muted, rgba(255,255,255,.55))' }}>{t('Video information unavailable')}</p>}
  </div>
}

