import { Cpu, Download } from 'lucide-react'
import { useT } from '../../i18n'
import { useAITagging } from './useAITagging'
import GpuStatusPanel from './GpuStatusPanel'
import ModelList from './ModelList'
import RunProgress from './RunProgress'
import RunForm from './RunForm'

function PlainSection({ title, icon: Icon, children }) {
  return (
    <section className="rounded-[10px] p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2.5 mb-4 text-[18px] font-semibold text-white/85">
        <Icon size={17} style={{ color: 'var(--c-accent)' }} /> {title}
      </div>
      {children}
    </section>
  )
}

// AI tagging controls shared by Settings and the Dashboard modal. Settings
// passes its accordion section so the tab keeps its look.
export default function AITaggingPanel({ Section = PlainSection, runFirst = false }) {
  const t = useT()
  const tagging = useAITagging()
  const { status } = tagging
  const running = status?.running || status?.paused

  const models = (
    <Section key="models" title={t('AI models')} icon={Download} accentColor="var(--c-accent)" defaultOpen={!runFirst}>
      <p className="text-[16px] text-white/50 mb-4">
        {t('Local models only, nothing is sent to the cloud. Pick one tagger per run; add-ons run alongside it on the same pixels.')}
      </p>
      <div className="mb-4"><GpuStatusPanel /></div>
      <ModelList models={tagging.models} busy={status?.running} onDownload={tagging.download} />
    </Section>
  )
  const run = (
    <Section key="run" title={t('Run tagging')} icon={Cpu} accentColor="var(--c-accent)">
      {running
        ? <RunProgress status={status} onPause={tagging.pause} onResume={tagging.resume} onCancel={tagging.cancel} />
        : <RunForm tagging={tagging} />}
    </Section>
  )
  return <div className="flex flex-col gap-3">{runFirst ? [run, models] : [models, run]}</div>
}
