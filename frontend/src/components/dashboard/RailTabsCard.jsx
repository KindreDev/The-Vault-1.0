import { useState } from 'react'

const CAT_COLORS = {
  body_part:       '#D4537E',
  subject:         '#7F77DD',
  clothing:        '#378ADD',
  physical_feature:'#BA7517',
  sex_act:         '#E24B4A',
  nudity_level:    '#D4537E',
  position:        '#7F77DD',
  pose:            '#1D9E75',
  rating:          '#888780',
  character:       '#FAC775',
  style:           '#9FE1CB',
  general:         '#888780',
}
export const catColor = (cat) => CAT_COLORS[cat] || 'var(--c-accent)'

// Rail card with a title and a small segmented switch between related lists.
// The switch reuses the Curation mode toggle style so Dashboard controls match.
export default function RailTabsCard({ icon: Icon, iconColor, title, tabs, action }) {
  const [active, setActive] = useState(tabs[0]?.id)
  const current = tabs.find(tab => tab.id === active) || tabs[0]
  if (!current) return null
  return (
    <div className="rounded-[12px] p-4"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 font-medium uppercase tracking-wider"
             style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
          <Icon size={14} style={{ color: iconColor }} /> {title}
        </div>
        {action}
      </div>
      {tabs.length > 1 && (
        <div className="flex items-center gap-0.5 p-0.5 rounded-full mb-3 w-fit flex-wrap" role="tablist"
             style={{ background: 'rgba(0,0,0,0.2)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 25%, transparent)' }}>
          {tabs.map(tab => (
            <button key={tab.id} type="button" role="tab" onClick={() => setActive(tab.id)}
                    aria-selected={current.id === tab.id}
                    className="px-2 py-1 rounded-full cursor-pointer"
                    style={{ fontSize: 16, background: current.id === tab.id ? 'color-mix(in srgb, var(--c-accent) 28%, transparent)' : 'transparent', color: current.id === tab.id ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.45)' }}>
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {current.content}
    </div>
  )
}
