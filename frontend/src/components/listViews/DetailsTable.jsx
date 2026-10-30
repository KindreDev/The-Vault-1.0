import React from 'react'
import { CheckSquare, Square, SortAsc, SortDesc } from 'lucide-react'
import { useT } from '../../i18n'

// Sortable table view shared by the Photos, Videos and Galleries lists.
// Sorting goes through the list's own sort (server side, across all pages):
// clicking the active column flips direction, another column switches to it.
//
// columns: [{ key, label, sort?, align?, width?, render(row) }]
export default function DetailsTable({
  rows, columns, thumb, thumbWidth = 60, sortBy, sortDir, onSort, onSortDir,
  onRowClick, onContextMenu, bulkMode, selected, onSelect,
}) {
  const t = useT()
  const headerClick = (col) => {
    if (!col.sort) return
    if (col.sort === sortBy) onSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else onSort(col.sort)
  }
  const SortIcon = sortDir === 'asc' ? SortAsc : SortDesc

  return (
    <div className="vault-details-table overflow-x-auto rounded-[10px]"
         style={{ border: '0.5px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
      <table className="w-full text-[14px]" style={{ borderCollapse: 'collapse', minWidth: 940 }}>
        <thead>
          <tr style={{ borderBottom: '0.5px solid rgba(255,255,255,0.1)' }}>
            {bulkMode && <th style={{ width: 36 }} />}
            <th style={{ width: thumbWidth + 12 }} />
            {columns.map(col => {
              const active = col.sort && col.sort === sortBy
              return (
                <th key={col.key}
                    onMouseDown={() => headerClick(col)}
                    className={`px-3 py-2 font-normal whitespace-nowrap select-none ${col.sort ? 'cursor-pointer hover:text-[rgba(255,255,255,0.8)]' : ''}`}
                    style={{
                      textAlign: col.align || 'left',
                      width: col.width,
                      // The name column flexes but never shrinks below this.
                      minWidth: col.primary ? 180 : undefined,
                      color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.4)',
                      fontSize: 13,
                    }}>
                  <span className="inline-flex items-center gap-1">
                    {t(col.label)}
                    {active && <SortIcon size={11} />}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isSelected = selected?.has(row.id)
            return (
              <tr key={row.id}
                  onClick={(e) => bulkMode ? onSelect(row.id, e) : onRowClick(row, index)}
                  onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(row, e) }}
                  className="cursor-pointer hover:bg-[rgba(255,255,255,0.04)]"
                  style={{
                    borderBottom: '0.5px solid rgba(255,255,255,0.05)',
                    background: isSelected ? 'color-mix(in srgb, var(--c-accent) 14%, transparent)' : undefined,
                    contentVisibility: 'auto',
                    containIntrinsicSize: '0 52px',
                  }}>
                {bulkMode && (
                  <td className="pl-3" onClick={e => { e.stopPropagation(); onSelect(row.id, e) }}>
                    {isSelected
                      ? <CheckSquare size={15} style={{ color: 'var(--c-accent)' }} />
                      : <Square size={15} style={{ color: 'rgba(255,255,255,0.4)' }} />}
                  </td>
                )}
                <td className="py-1.5 pl-3 pr-1">
                  <div className="rounded-[6px] overflow-hidden" style={{ width: thumbWidth, height: 40, background: 'rgba(255,255,255,0.05)' }}>
                    {thumb(row)}
                  </div>
                </td>
                {columns.map(col => (
                  <td key={col.key} className="px-3 py-1.5"
                      style={{
                        textAlign: col.align || 'left',
                        color: col.primary ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)',
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: col.align === 'right' ? 'tabular-nums' : undefined,
                        // The name column takes whatever width is left and
                        // truncates (max-width 0 + width 100% is the table trick).
                        ...(col.primary ? { width: '100%', maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } : null),
                      }}>
                    {/* Other text columns truncate inside a capped box. */}
                    {col.align === 'right' || col.primary
                      ? col.render(row)
                      : <div style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.render(row)}</div>}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
