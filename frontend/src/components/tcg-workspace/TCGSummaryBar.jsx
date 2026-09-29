import { LocalizedText, useT } from '../../i18n'
import { Archive, Copy, Layers3, Shapes, Sparkles } from 'lucide-react'

const ITEMS = [
  ['owned_printings', 'Owned', Archive],
  ['missing', 'Missing', Shapes],
  ['duplicates', 'Duplicates', Copy],
  ['set_count', 'Sets', Layers3],
  ['release_count', 'Releases', Sparkles],
]

export default function TCGSummaryBar({ summary }) {
  const t = useT()
  return (
    <div className="tcgws-summary">
      {ITEMS.map(([key, label, Icon]) => (
        <div key={key}><Icon size={17} /><span>{t(label)}</span><strong>{Number(summary?.[key] || 0).toLocaleString()}</strong></div>
      ))}
      <div className="tcgws-completion">
        <span><LocalizedText text={"Collection completion"} /></span>
        <strong>{summary?.catalog_total ? Math.round(summary.owned_printings / summary.catalog_total * 100) : 0}%</strong>
        <i><b style={{ width: `${summary?.catalog_total ? summary.owned_printings / summary.catalog_total * 100 : 0}%` }} /></i>
      </div>
    </div>
  )
}
