import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Tags, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { insightsApi } from '../../lib/api'
import { useT } from '../../i18n'

const ROLE_LABELS = {
  content: 'Content', looks: 'Looks', baseline: 'Baseline', framing: 'Framing',
  people: 'People', medium: 'Medium', spice: 'Spice', system: 'System',
}
// Roles you can pick by hand. Spice, people and medium follow the tag's category.
const PICKABLE = ['content', 'looks', 'baseline', 'framing', 'system']

function RoleChips({ tag, onSet, t }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {PICKABLE.map(role => {
        const active = tag.role === role
        return (
          <button key={role} type="button" onClick={() => onSet(tag, role === tag.auto_role ? null : role)}
                  className="px-2.5 py-0.5 rounded-full text-[16px] cursor-pointer"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--c-accent) 22%, transparent)' : 'rgba(255,255,255,0.04)',
                    color: active ? 'var(--c-accent-text)' : 'rgba(255,255,255,0.55)',
                    border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                  }}>
            {t(ROLE_LABELS[role])}
          </button>
        )
      })}
    </div>
  )
}

function TagLine({ tag, onSet, t }) {
  const overridden = tag.role !== tag.auto_role
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap py-2" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
      <div className="min-w-0">
        <div className="text-[16px] text-white/85">{tag.name}</div>
        <div className="text-[16px] text-white/40">
          {t('on {pct}% of files', { pct: (tag.share * 100).toFixed(1) })}
          {overridden && <> · {t('auto: {role}', { role: t(ROLE_LABELS[tag.auto_role]) })}</>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <RoleChips tag={tag} onSet={onSet} t={t} />
        {overridden && (
          <button type="button" onClick={() => onSet(tag, null)} title={t('Back to automatic')}
                  className="p-1 rounded-full cursor-pointer text-white/45 hover:text-white/80">
            <RotateCcw size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

// Settings → AI Tagging → Tag roles. Baseline tags (on at least half of all
// files) are hidden from rankings but stay fully searchable and filterable.
export default function TagRolesPanel({ Section }) {
  const t = useT()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const { data } = useQuery({ queryKey: ['insights', 'roles'], queryFn: () => insightsApi.roles().then(r => r.data) })
  const tags = data?.tags ?? []

  const baseline = tags.filter(tag => tag.role === 'baseline' || tag.auto_role === 'baseline')
  const overrides = tags.filter(tag => tag.role !== tag.auto_role && tag.auto_role !== 'baseline')
  const q = query.trim().toLowerCase()
  const results = useMemo(() => (q ? tags.filter(tag => tag.name.includes(q)).slice(0, 12) : []), [tags, q])

  const setRole = async (tag, role) => {
    try {
      await insightsApi.setRole(tag.id, role)
      qc.invalidateQueries({ queryKey: ['insights'] })
      qc.invalidateQueries({ queryKey: ['tags'] })
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Could not change the tag role'))
    }
  }

  return (
    <Section title={t('Tag roles')} icon={Tags} accentColor="var(--c-accent)" defaultOpen={false}>
      <p className="text-[16px] text-white/50 mb-4">
        {t('Rankings, Tag Hall of Fame and your taste profile only use Content and Looks tags. Tags on at least {pct}% of your files become Baseline automatically: still searchable, never ranked.', { pct: Math.round((data?.baseline_share ?? 0.5) * 100) })}
      </p>

      <div className="text-[16px] font-semibold text-white/65 mb-1">{t('Baseline right now')}</div>
      {baseline.length
        ? baseline.map(tag => <TagLine key={tag.id} tag={tag} onSet={setRole} t={t} />)
        : <div className="text-[16px] text-white/40 py-2">{t('No tag is common enough to be baseline.')}</div>}

      {!!overrides.length && (
        <>
          <div className="text-[16px] font-semibold text-white/65 mt-5 mb-1">{t('Your changes')}</div>
          {overrides.map(tag => <TagLine key={tag.id} tag={tag} onSet={setRole} t={t} />)}
        </>
      )}

      <div className="text-[16px] font-semibold text-white/65 mt-5 mb-2">{t('Change any tag')}</div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-[10px]" style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <Search size={16} className="text-white/40" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search tags…')}
               className="flex-1 bg-transparent outline-none text-[16px]" style={{ color: 'rgba(255,255,255,0.88)' }} />
      </div>
      {results.map(tag => <TagLine key={tag.id} tag={tag} onSet={setRole} t={t} />)}
    </Section>
  )
}
