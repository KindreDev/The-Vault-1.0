import React, { useMemo } from 'react'
import { useVaultStore } from '../../store/vault'
import { useT } from '../../i18n'
import { groupByMonth } from './viewModes'

// Timeline view: the list's normal tiles, split into month sections with a
// sticky header. renderGroup gets [{ item, index }] where index is the
// position in the full page (used to open the viewer at the right item).
export default function TimelineSections({ items, getDate, renderGroup }) {
  const t = useT()
  const locale = useVaultStore(s => s.locale)
  const groups = useMemo(() => groupByMonth(items, getDate, locale), [items, getDate, locale])
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group, i) => (
        <section key={`${group.key}-${i}`}>
          <div className="vault-timeline-header sticky top-0 z-[15] flex items-baseline gap-2 py-2 mb-2"
               style={{ background: 'var(--c-bg, #141414)', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
            <span className="text-[16px] font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {group.label ?? t('No date')}
            </span>
            <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{group.entries.length}</span>
          </div>
          {renderGroup(group.entries)}
        </section>
      ))}
    </div>
  )
}
