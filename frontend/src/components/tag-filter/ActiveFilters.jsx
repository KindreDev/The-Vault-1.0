import { Ban, Check, X } from 'lucide-react'
import { useT } from '../../i18n'
import { INCLUDE, EXCLUDE } from './tagFilterMeta'

function ModeSwitch({ value, options, colors, onChange }) {
  return (
    <div className="flex rounded-full overflow-hidden flex-shrink-0" style={{ border: `0.5px solid ${colors.line}` }}>
      {options.map(o => (
        <button key={o.value} type="button" onMouseDown={e => { e.preventDefault(); onChange(o.value) }}
                className="px-2.5 py-0.5 text-[16px] cursor-pointer"
                style={{ background: value === o.value ? colors.bg : 'transparent', color: value === o.value ? colors.text : 'rgba(255,255,255,0.45)' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Group({ icon: Icon, title, tokens, labelFor, colors, mode, modeOptions, onModeChange, onRemove }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1.5 text-[16px] font-semibold" style={{ color: colors.text }}>
        <Icon size={15} /> {title}
      </span>
      {tokens.length > 1 && <ModeSwitch value={mode} options={modeOptions} colors={colors} onChange={onModeChange} />}
      {tokens.map(token => (
        <span key={token} className="flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-[16px]"
              style={{ background: colors.bg, color: colors.text, border: `0.5px solid ${colors.line}` }}>
          {labelFor(token)}
          <button type="button" onMouseDown={e => { e.preventDefault(); onRemove(token) }}
                  className="cursor-pointer rounded-full p-0.5 hover:bg-[rgba(255,255,255,0.1)]" aria-label="Remove">
            <X size={14} />
          </button>
        </span>
      ))}
    </div>
  )
}

// The tags currently filtering the list, with how multiple tags combine.
export default function ActiveFilters({ includeTags, excludeTags, labelFor, includeMode, excludeMode,
                                        onIncludeModeChange, onExcludeModeChange, onRemove }) {
  const t = useT()
  if (!includeTags.length && !excludeTags.length) {
    return <div className="text-[16px] text-white/40">{t('Pick tags below: click a tag to require it, or use − to hide files that have it.')}</div>
  }
  return (
    <div className="flex flex-col gap-2">
      {!!includeTags.length && (
        <Group icon={Check} title={t('Must have')} tokens={includeTags} labelFor={labelFor} colors={INCLUDE}
               mode={includeMode} onModeChange={onIncludeModeChange} onRemove={onRemove}
               modeOptions={[{ value: 'all', label: t('all of these') }, { value: 'any', label: t('any of these') }]} />
      )}
      {!!excludeTags.length && (
        <Group icon={Ban} title={t('Hide if it has')} tokens={excludeTags} labelFor={labelFor} colors={EXCLUDE}
               mode={excludeMode} onModeChange={onExcludeModeChange} onRemove={onRemove}
               modeOptions={[{ value: 'any', label: t('any of these') }, { value: 'all', label: t('all of these together') }]} />
      )}
    </div>
  )
}
