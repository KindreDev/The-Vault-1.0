import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '../lib/api'
import {
  ScanLine, Brain, GitCompare, Image, Download,
  X, Trash2, CheckCircle, XCircle, AlertCircle, Clock, Play,
} from 'lucide-react'

const TYPE_META = {
  scan:          { label: 'Library Scan',       icon: ScanLine,   color: 'var(--c-green)' },
  regen_thumbs:  { label: 'Regen Thumbnails',   icon: Image,      color: '#378ADD' },
  ai_tag:        { label: 'AI Tagging',         icon: Brain,      color: 'var(--c-accent)' },
  model_download:{ label: 'Model Download',     icon: Download,   color: 'var(--c-amber)' },
  dedup_hash:    { label: 'Dedup Index',        icon: GitCompare, color: 'var(--c-pink)' },
}

function taskMeta(type) {
  return TYPE_META[type] || { label: type, icon: Play, color: 'var(--c-accent)' }
}

function StatusBadge({ status }) {
  const cfg = {
    queued:    { icon: Clock,        color: 'rgba(255,255,255,0.4)',  bg: 'rgba(255,255,255,0.07)',  label: 'Queued' },
    running:   { icon: Play,         color: 'var(--c-green)',                bg: 'color-mix(in srgb, var(--c-green) 15%, transparent)',   label: 'Running' },
    done:      { icon: CheckCircle,  color: 'var(--c-green)',                bg: 'color-mix(in srgb, var(--c-green) 12%, transparent)',   label: 'Done' },
    cancelled: { icon: XCircle,      color: 'rgba(255,255,255,0.4)',  bg: 'rgba(255,255,255,0.07)',  label: 'Cancelled' },
    failed:    { icon: AlertCircle,  color: 'var(--c-pink)',                bg: 'color-mix(in srgb, var(--c-pink) 12%, transparent)',   label: 'Failed' },
  }[status] || { icon: Clock, color: '#aaa', bg: 'rgba(255,255,255,0.07)', label: status }

  const Icon = cfg.icon
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-medium"
          style={{ color: cfg.color, background: cfg.bg }}>
      <Icon size={12} />
      {cfg.label}
    </span>
  )
}

function ProgressBar({ progress, total, color, animate }) {
  const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : (animate ? null : 0)
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
      {pct !== null ? (
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      ) : (
        <div className="h-full rounded-full animate-pulse" style={{ background: color, opacity: 0.6 }} />
      )}
    </div>
  )
}

function RunningTask({ task, onCancel }) {
  if (!task) return null
  const meta = taskMeta(task.type)
  const Icon = meta.icon
  const pct  = task.total > 0 ? Math.round((task.progress / task.total) * 100) : null

  return (
    <div className="rounded-xl border overflow-hidden"
         style={{ borderColor: `${meta.color}44`, background: `${meta.color}0a` }}>
      <div className="px-5 py-4 flex items-start gap-4">
        <div className="mt-0.5 p-2 rounded-lg" style={{ background: `${meta.color}22` }}>
          <Icon size={18} style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-semibold text-white/90 text-base">{task.label}</span>
            <StatusBadge status="running" />
            {pct !== null && (
              <span className="text-sm ml-auto" style={{ color: meta.color }}>{pct}%</span>
            )}
          </div>
          <p className="text-white/50 text-sm mb-3 truncate">{task.message}</p>
          <ProgressBar progress={task.progress} total={task.total} color={meta.color} animate />
          {task.total > 0 && (
            <p className="text-white/30 text-xs mt-1.5">
              {task.progress.toLocaleString()} / {task.total.toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={onCancel}
          className="mt-1 p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition flex-shrink-0"
          title="Cancel task"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

function QueuedTask({ task, onRemove, position }) {
  const meta = taskMeta(task.type)
  const Icon = meta.icon
  return (
    <div className="rounded-xl border border-white/8 bg-vault-card flex items-center gap-4 px-5 py-3.5">
      <div className="text-white/20 text-sm font-mono w-5 text-center flex-shrink-0">
        {position}
      </div>
      <div className="p-1.5 rounded-md" style={{ background: `${meta.color}18` }}>
        <Icon size={15} style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white/80 text-base font-medium">{task.label}</p>
        <p className="text-white/35 text-sm">Queued {new Date(task.created_at).toLocaleTimeString()}</p>
      </div>
      <StatusBadge status="queued" />
      <button
        onClick={() => onRemove(task.id)}
        className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition ml-2 flex-shrink-0"
        title="Remove from queue"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

function HistoryTask({ task }) {
  const meta = taskMeta(task.type)
  const Icon = meta.icon

  const elapsed = task.started_at && task.finished_at
    ? ((new Date(task.finished_at) - new Date(task.started_at)) / 1000)
    : null
  const elapsedStr = elapsed !== null
    ? elapsed >= 60 ? `${Math.round(elapsed / 60)}m ${Math.round(elapsed % 60)}s` : `${Math.round(elapsed)}s`
    : null

  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-white/5 last:border-0">
      <div className="p-1.5 rounded-md flex-shrink-0" style={{ background: `${meta.color}18` }}>
        <Icon size={14} style={{ color: meta.color, opacity: 0.7 }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white/70 text-base">{task.label}</p>
        <p className="text-white/30 text-sm truncate">{task.message}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {elapsedStr && <span className="text-white/25 text-sm">{elapsedStr}</span>}
        <StatusBadge status={task.status} />
      </div>
    </div>
  )
}

export default function TaskQueue() {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['task-queue'],
    queryFn: () => tasksApi.queue().then(r => r.data),
    refetchInterval: q => {
      const d = q.state.data
      return (d?.current || d?.queued?.length > 0) ? 600 : 3000
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => tasksApi.cancelCurrent(),
    onSuccess: () => qc.invalidateQueries(['task-queue']),
  })

  const removeMutation = useMutation({
    mutationFn: (id) => tasksApi.removeQueued(id),
    onSuccess: () => qc.invalidateQueries(['task-queue']),
  })

  const current = data?.current ?? null
  const queued  = data?.queued  ?? []
  const history = data?.history ?? []
  const idle    = !current && queued.length === 0

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white/90">Task Queue</h1>
        <p className="text-white/45 text-base mt-1">
          {idle
            ? 'No tasks running. One task runs at a time — others wait in queue.'
            : current
            ? `Running 1 task · ${queued.length} waiting`
            : `${queued.length} task${queued.length !== 1 ? 's' : ''} waiting to run`}
        </p>
      </div>

      {/* Running */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Now Running</h2>
        {current ? (
          <RunningTask task={current} onCancel={() => cancelMutation.mutate()} />
        ) : (
          <div className="rounded-xl border border-white/8 bg-vault-card px-5 py-5 text-white/30 text-base italic">
            Nothing running
          </div>
        )}
      </section>

      {/* Queue */}
      {queued.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Up Next</h2>
          <div className="flex flex-col gap-2">
            {queued.map((t, i) => (
              <QueuedTask
                key={t.id}
                task={t}
                position={i + 1}
                onRemove={id => removeMutation.mutate(id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">History</h2>
          <div className="rounded-xl border border-white/8 bg-vault-card overflow-hidden">
            {history.map((t, i) => (
              <HistoryTask key={t.id ?? i} task={t} />
            ))}
          </div>
        </section>
      )}

      {idle && history.length === 0 && (
        <div className="text-center py-20 text-white/20 text-base">
          No recent tasks. Start a scan, AI tagging, or dedup run to see it here.
        </div>
      )}
    </div>
  )
}
