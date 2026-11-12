import { useT } from '../../i18n'
import { useTaggerStatus } from './useAITagging'

// Small live badge on the Dashboard "AI Tagging" tool button.
export default function AITaggingToolBadge() {
  const t = useT()
  const { status, queued } = useTaggerStatus()
  let label = null
  if (status?.running && status.total > 0) label = `${Math.floor((status.progress / status.total) * 100)}%`
  else if (status?.running) label = t('Starting')
  else if (status?.paused) label = t('Paused')
  else if (queued) label = t('Queued')
  if (!label) return null
  return (
    <span className="ml-auto px-2 rounded-full" style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-pink) 28%, transparent)' }}
          title={status?.message || ''}>
      {label}
    </span>
  )
}
