import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { scannerApi, systemApi, creatorsApi, taggerApi, tasksApi } from '../../lib/api'
import { useT } from '../../i18n'

const PREFS_KEY = 'vault.aiTagging.prefs'
const DEFAULT_PREFS = { model: 'auto', media: 'all', extras: [], threshold: 0.35, retag: false }

function readPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
  } catch {
    return DEFAULT_PREFS
  }
}

function writePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
}

// Live tagger state (shared by the Dashboard button badge and the panel).
export function useTaggerStatus() {
  const { data: queue } = useQuery({
    queryKey: ['task-queue'],
    queryFn: () => tasksApi.queue().then(r => r.data),
    refetchInterval: q => {
      const d = q.state.data
      return (d?.current || d?.queued?.length > 0) ? 800 : 8000
    },
  })
  const aiTypes = new Set(['ai_tag', 'model_download'])
  const queued = !!queue?.queued?.some(item => aiTypes.has(item.type))
  const active = aiTypes.has(queue?.current?.type)
  const { data: status } = useQuery({
    queryKey: ['ai-tag-status'],
    queryFn: () => taggerApi.status().then(r => r.data),
    refetchInterval: q => (q.state.data?.running || queued || active) ? 1500 : 8000,
  })
  return { status, queued, active }
}

// Everything the AI tagging panel needs: choices, model list, actions.
export function useAITagging() {
  const t = useT()
  const qc = useQueryClient()
  const { status, queued } = useTaggerStatus()

  const [prefs, setPrefs] = React.useState(readPrefs)
  const update = React.useCallback(patch => {
    setPrefs(prev => {
      const next = { ...prev, ...patch }
      writePrefs(next)
      return next
    })
  }, [])
  const [scope, setScope] = React.useState('library')   // library | folder | creator
  const [rootId, setRootId] = React.useState('')
  const [creatorId, setCreatorId] = React.useState('')
  const [creatorSearch, setCreatorSearch] = React.useState('')
  const [starting, setStarting] = React.useState(false)

  const { data: modelData, refetch: refetchModels } = useQuery({
    queryKey: ['ai-tag-models'],
    queryFn: () => taggerApi.modelStatus().then(r => r.data),
    refetchInterval: status?.running ? 3000 : false,
  })
  const models = modelData?.models ?? []
  const taggers = models.filter(m => m.kind === 'tagger')
  const detectors = models.filter(m => m.kind === 'detector')

  const { data: creators = [] } = useQuery({
    queryKey: ['creators-list-tagger'],
    queryFn: () => creatorsApi.list({ limit: 1000, sort_by: 'name' }).then(r => r.data),
    staleTime: 60000,
  })
  const filteredCreators = React.useMemo(() => {
    const q = creatorSearch.toLowerCase().trim()
    const list = q ? creators.filter(c => c.name.toLowerCase().includes(q)) : creators
    return list.slice(0, 50)
  }, [creators, creatorSearch])
  const selectedCreator = creators.find(c => String(c.id) === String(creatorId)) || null

  const { data: roots = [] } = useQuery({
    queryKey: ['library-roots'],
    queryFn: () => scannerApi.roots().then(r => r.data),
  })

  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => systemApi.getConfig().then(r => r.data),
  })
  const gpuMutation = useMutation({
    mutationFn: useGpu => systemApi.setGpuMode(useGpu).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-config'] }),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-tag-status'] })
    qc.invalidateQueries({ queryKey: ['task-queue'] })
  }

  // A remembered model or extra that has since disappeared falls back quietly.
  const readyKeys = new Set(models.filter(m => m.ready).map(m => m.key))
  const model = prefs.model === 'auto' || readyKeys.has(prefs.model) ? prefs.model : 'auto'
  const extras = prefs.extras.filter(k => readyKeys.has(k))

  const start = async () => {
    const folderPath = roots.find(r => String(r.id) === String(rootId))?.path ?? null
    if (scope === 'folder' && !folderPath) return toast.error(t('Select a library folder to tag'))
    if (scope === 'creator' && !creatorId) return toast.error(t('Select a creator to tag'))
    setStarting(true)
    try {
      await taggerApi.start({
        scope,
        folder_path: scope === 'folder' ? folderPath : null,
        creator_id: scope === 'creator' ? parseInt(creatorId, 10) : null,
        threshold: prefs.threshold,
        retag: prefs.retag,
        model_override: model === 'auto' ? null : model,
        media: prefs.media,
        extra_models: extras,
      })
      refresh()
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Failed to start tagging'))
    } finally {
      setStarting(false)
    }
  }

  const download = async key => {
    try {
      await taggerApi.downloadModels({ models: [key] })
      const label = models.find(m => m.key === key)?.label ?? key
      toast.success(t('Downloading {model}…', { model: label }))
      refresh()
      refetchModels()
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Download failed'))
    }
  }

  return {
    status, queued, models, taggers, detectors,
    anyTaggerReady: taggers.some(m => m.ready),
    prefs, update, model, extras,
    scope, setScope, rootId, setRootId, roots,
    creatorId, setCreatorId, creatorSearch, setCreatorSearch, filteredCreators, selectedCreator,
    gpuOn: config?.use_gpu !== false, toggleGpu: () => gpuMutation.mutate(config?.use_gpu === false),
    gpuBusy: gpuMutation.isPending,
    starting, start, download,
    pause: async () => { await taggerApi.pause(); refresh() },
    resume: async () => { await taggerApi.resume(status?.job_id); refresh() },
    cancel: async () => { await taggerApi.cancel(); refresh() },
  }
}
