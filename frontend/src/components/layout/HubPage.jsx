import React, { Suspense } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useT } from '../../i18n'
import ErrorBoundary from '../ErrorBoundary'

// A page that groups several existing pages under one sidebar entry. Each tab
// renders the original page unchanged; the tab lives in the path
// (/progress/stats) so the pages keep their own query parameters.
//
// Tab buttons reuse the Settings tab classes and styles, so they look the same
// and theme packs restyle both.
export default function HubPage({ basePath, tabs }) {
  const t = useT()
  const navigate = useNavigate()
  const { tab } = useParams()
  const current = tabs.find(item => item.id === tab)
  if (!current) return <Navigate to={`${basePath}/${tabs[0].id}`} replace />

  return (
    <div className="vault-hub-page flex flex-col h-full">
      <div className="vault-theme-settings-tabs flex gap-1 overflow-x-auto flex-shrink-0 px-5 pt-4 pb-3"
           role="tablist"
           style={{ scrollbarWidth: 'none', borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: 'var(--c-surface)' }}>
        {tabs.map(({ id, label, icon: Icon, badge }) => {
          const active = id === current.id
          return (
            <button key={id} type="button" role="tab" aria-selected={active} data-active={active}
                    onClick={() => navigate(`${basePath}/${id}`)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-[17px] font-medium whitespace-nowrap transition-all flex-shrink-0 cursor-pointer"
                    style={active
                      ? { background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }
                      : { background: 'transparent', color: 'rgba(255,255,255,0.45)', border: '0.5px solid transparent' }
                    }>
              <Icon size={14} />
              {t(label)}
              {badge ? (
                <span className="text-[13px] font-medium px-1.5 rounded-full"
                      style={{ background: 'color-mix(in srgb, var(--c-accent) 35%, transparent)', color: 'var(--c-accent-text)' }}>
                  {badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col" role="tabpanel">
        {/* Keyed per tab: a crash in one tab clears when switching to another. */}
        <ErrorBoundary key={current.id}>
          <Suspense fallback={<div className="p-8 text-[16px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('Loading')}</div>}>
            {current.element}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
