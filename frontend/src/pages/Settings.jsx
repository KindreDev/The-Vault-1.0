import { createUpdatePoll } from '../lib/updatePolling'
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, Check, X, ScrollText, AlertCircle, Cpu, Download, RefreshCw, ShieldCheck, HardDrive, Globe, Clock, Sparkles, Type, FolderOpen, ScanLine, Archive, SlidersHorizontal, Smartphone, Copy, Keyboard, Droplets, Waves, Play, Gauge } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { scannerApi, systemApi, creatorsApi, companionApi, themePacksApi } from '../lib/api'
import { useVaultStore, PALETTES, FONTS, themePackFontOption } from '../store/vault'
import { useT, LANGUAGES } from '../i18n'
import HotkeySettings from '../components/settings/HotkeySettings'
import HoverClipSettings from '../components/settings/HoverClipSettings'
import FolderPicker from '../components/FolderPicker'
import toast from 'react-hot-toast'

import ModalLayer from '../components/ModalLayer'
import RootDropdown from '../components/settings/RootDropdown'
import AITaggingPanel from '../components/ai-tagging/AITaggingPanel'
import TagRolesPanel from '../components/ai-tagging/TagRolesPanel'
// ── SettingsSection (accordion — mirrors Help.jsx Section) ───────────────────
function ChangelogBody({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const blocks = []
  let currentList = null
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) { currentList = null; continue }
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/)
    if (bulletMatch) {
      if (!currentList) { currentList = []; blocks.push({ type: 'list', items: currentList }) }
      currentList.push(bulletMatch[1])
      continue
    }
    currentList = null
    if (trimmed.startsWith('>')) continue // skip "reconstructed from git history"-style meta notes
    const headingMatch = trimmed.match(/^#{2,4}\s+(.*)$/) || trimmed.match(/^([A-Za-z][A-Za-z /]{1,40}):$/)
    if (headingMatch) {
      blocks.push({ type: 'heading', text: headingMatch[1] })
      continue
    }
    blocks.push({ type: 'para', text: trimmed })
  }
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return <div key={i} className="text-[16px] font-semibold text-white/65 mt-3 first:mt-0">{b.text}</div>
        }
        if (b.type === 'list') {
          return (
            <ul key={i} className="space-y-1.5 list-disc list-outside pl-5">
              {b.items.map((it, j) => <li key={j} className="text-[16px] text-white/45 leading-relaxed">{it}</li>)}
            </ul>
          )
        }
        return <div key={i} className="text-[16px] text-white/45 leading-relaxed">{b.text}</div>
      })}
    </div>
  )
}

function ChangelogEntry({ entry }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="rounded-[8px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
      <button onClick={() => setOpen(v => !v)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer">
        <span className="text-[17px] font-semibold text-white/75">v{entry.version}</span>
        {entry.date && <span className="text-[15px] text-white/30">{entry.date}</span>}
        <ChevronDown size={14} className="text-white/25 transition-transform duration-200 ml-auto"
                     style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
            <div className="px-4 pb-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
              <ChangelogBody text={entry.changelog} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SettingsSection({ title, icon: Icon, accentColor = 'var(--c-accent)', children, defaultOpen = true }) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="vault-theme-settings-section mb-3 rounded-[10px] overflow-hidden"
         style={{ background: 'var(--c-card)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <button onClick={() => setOpen(v => !v)}
              aria-expanded={open}
              className="vault-theme-settings-section-toggle w-full flex items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[rgba(255,255,255,0.03)]"
              style={{ background: 'transparent' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
             style={{ background: `${accentColor}20` }}>
          <Icon size={15} style={{ color: accentColor }} />
        </div>
        <span className="flex-1 text-[19px] font-semibold text-white/85">{title}</span>
        <ChevronDown size={16} className="text-white/25 transition-transform duration-200"
                     style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <div className="px-5 pb-5 pt-4"
                 style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const SETTINGS_TABS = [
  { id: 'library',    label: 'Library',    icon: FolderOpen     },
  { id: 'scanner',    label: 'Scanner',    icon: ScanLine       },
  { id: 'tagging',    label: 'AI Tagging', icon: Cpu            },
  { id: 'appearance', label: 'Appearance', icon: Sparkles       },
  { id: 'performance', label: 'Performance', icon: Gauge        },
  { id: 'session',    label: 'Session',    icon: Droplets       },
  { id: 'hotkeys',    label: 'Hotkeys',    icon: Keyboard       },
  { id: 'backup',     label: 'Backup',     icon: Archive        },
  { id: 'system',     label: 'System',     icon: ShieldCheck    },
]

export function Settings() {
  const showGoonBorder    = useVaultStore(s => s.showGoonBorder)
  const setShowGoonBorder = useVaultStore(s => s.setShowGoonBorder)
  const sessionEndClimax    = useVaultStore(s => s.sessionEndClimax)
  const setSessionEndClimax = useVaultStore(s => s.setSessionEndClimax)
  const currentPalette    = useVaultStore(s => s.palette)
  const setPalette        = useVaultStore(s => s.setPalette)
  const currentFont         = useVaultStore(s => s.font)
  const setFont             = useVaultStore(s => s.setFont)
  const animSpeed           = useVaultStore(s => s.animSpeed)
  const setAnimSpeed        = useVaultStore(s => s.setAnimSpeed)
  const vaultName           = useVaultStore(s => s.vaultName)
  const setVaultName        = useVaultStore(s => s.setVaultName)
  const confettiEnabled     = useVaultStore(s => s.confettiEnabled)
  const setConfettiEnabled  = useVaultStore(s => s.setConfettiEnabled)
  const sessionGlowColor    = useVaultStore(s => s.sessionGlowColor)
  const setSessionGlowColor = useVaultStore(s => s.setSessionGlowColor)
  const glassBackground     = useVaultStore(s => s.glassBackground)
  const setGlassBackground  = useVaultStore(s => s.setGlassBackground)
  const locale              = useVaultStore(s => s.locale)
  const setLocale           = useVaultStore(s => s.setLocale)
  const t                   = useT()
  const [vaultNameInput, setVaultNameInput] = React.useState(vaultName)
  const [glassBgLabel, setGlassBgLabel]     = React.useState(localStorage.getItem('vault_glass_bg_label') || '')
  const glassBgFileRef = React.useRef(null)
  const [newPath, setNewPath]               = React.useState('')
  const [newLabel, setNewLabel]             = React.useState('')
  const [showAllRoots, setShowAllRoots]     = React.useState(false)
  const [browsing, setBrowsing]             = React.useState(false)
  const [folderPickerTarget, setFolderPickerTarget] = React.useState(null)
  const [selectedRootId, setSelectedRootId] = React.useState('')
  const [folderScanning, setFolderScanning] = React.useState(false)
  const [regenning, setRegenning]           = React.useState(false)
  const [fsLibPath, setFsLibPath]           = React.useState('')
  const [fsLibDirty, setFsLibDirty]         = React.useState(false)
  const [fsMatching, setFsMatching]         = React.useState(false)
  const [syncing, setSyncing]               = React.useState(false)
  const [restartState, setRestartState]     = React.useState('idle') // idle | restarting | done
  const [updateState, setUpdateState]       = React.useState('idle') // idle | checking | up_to_date | available | downloading | installing | error
  const [updateInfo, setUpdateInfo]         = React.useState(null)
  const [updateProgress, setUpdateProgress] = React.useState(0)
  const [updateError, setUpdateError]       = React.useState('')
  const updatePollRef = React.useRef(null)
  const [restoreFile, setRestoreFile]       = React.useState(null)   // File | null
  const [restoreState, setRestoreState]     = React.useState('idle') // idle | confirming | uploading | restarting | done
  const [showResetModal, setShowResetModal] = React.useState(false)
  const [resetState, setResetState]         = React.useState('idle') // idle | resetting | done
  const restoreInputRef                     = React.useRef(null)
  const [storageInput, setStorageInput]     = React.useState('')
  const [storageState, setStorageState]     = React.useState('idle') // idle | saving | saved
  const qc = useQueryClient()
  const [settingsTab, setSettingsTab] = React.useState('library')
  const packFileRef = React.useRef(null)
  const [packImporting, setPackImporting] = React.useState(false)
  const { data: installedThemePacks = [] } = useQuery({
    queryKey: ['theme-packs'],
    queryFn: () => themePacksApi.list().then(response => response.data),
    enabled: settingsTab === 'appearance',
  })
  const activePackFont = currentPalette.id.startsWith('pack:')
    ? installedThemePacks.find(item => `pack:${item.id}` === currentPalette.id)?.font
    : null
  const availableFonts = activePackFont
    ? [...FONTS, themePackFontOption(currentPalette.id.slice(5), activePackFont.label)]
    : FONTS
  const importThemePack = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPackImporting(true)
    try {
      const response = await themePacksApi.import(file)
      await qc.invalidateQueries({ queryKey: ['theme-packs'] })
      const item = response.data
      await qc.invalidateQueries({ queryKey: ['theme-pack', item.id] })
      setPalette({ id: `pack:${item.id}`, label: item.name, ...item.palette })
      toast.success(t('{name} installed', { name: item.name }))
    } catch (error) {
      toast.error(error?.response?.data?.detail || t('Could not import theme pack'))
    } finally {
      setPackImporting(false)
    }
  }
  const removeThemePack = async item => {
    if (!window.confirm(`${t('Remove installed theme')} ${item.name}? ${t('A local backup will be kept.')}`)) return
    try {
      await themePacksApi.remove(item.id)
      if (currentPalette.id === `pack:${item.id}`) setPalette(PALETTES[0])
      await qc.invalidateQueries({ queryKey: ['theme-packs'] })
      toast.success(t('{name} removed', { name: item.name }))
    } catch (error) {
      toast.error(error?.response?.data?.detail || t('Could not remove theme pack'))
    }
  }

  const { data: compConfig, refetch: refetchComp } = useQuery({
    queryKey: ['companion-config'],
    queryFn:  () => companionApi.getConfig().then(r => r?.data ?? null),
  })
  const toggleCompanion = async () => {
    await companionApi.updateConfig({ enabled: !compConfig?.enabled })
    refetchComp()
  }

  const restorePollRef = React.useRef(null)
  const resetPollRef   = React.useRef(null)
  const restartPollRef = React.useRef(null)

  React.useEffect(() => {
    return () => {
      if (restorePollRef.current) clearInterval(restorePollRef.current)
      if (resetPollRef.current) clearInterval(resetPollRef.current)
      if (restartPollRef.current) clearInterval(restartPollRef.current)
      if (updatePollRef.current) clearInterval(updatePollRef.current)
    }
  }, [])

  const { data: configData } = useQuery({
    queryKey: ['system-config'],
    queryFn:  () => systemApi.getConfig().then(r => r.data),
  })

  // React Query v5 removed the useQuery `onSuccess` callback, so the inputs were
  // never populated from the loaded config — that's why the funscript-library
  // folder (and the storage path) appeared to clear on every reload even though
  // the value was saved. Populate them here instead.
  React.useEffect(() => {
    if (!configData) return
    if (!storageInput) setStorageInput(configData.data_dir || configData.effective_data_dir || '')
    if (!fsLibDirty) setFsLibPath(configData.funscript_library_path || '')
  }, [configData]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: mobileLink } = useQuery({
    queryKey: ['mobile-link'],
    queryFn:  () => systemApi.mobileLink().then(r => r.data),
    enabled:  settingsTab === 'system',
  })
  // Which address the phone gets (home Wi-Fi or Tailscale) and what the QR
  // opens: the browser version, or the Android app's pairing link.
  const [linkKind, setLinkKind] = React.useState(null)
  const [linkTarget, setLinkTarget] = React.useState('browser')
  const linkAddresses = mobileLink?.addresses ?? []
  const activeAddress = linkAddresses.find(a => a.kind === linkKind) ?? linkAddresses[0] ?? null
  const phoneLink = activeAddress
    ? (linkTarget === 'app'
        ? `thevault://connect?server=${encodeURIComponent(activeAddress.base)}`
        : `${activeAddress.base}/m`)
    : mobileLink?.url
  const phoneAddress = activeAddress
    ? (linkTarget === 'app' ? activeAddress.base : `${activeAddress.base}/m`)
    : mobileLink?.url


  const { data: startupData } = useQuery({
    queryKey: ['system-startup'],
    queryFn:  () => systemApi.getStartup().then(r => r.data),
  })

  const { data: versionData } = useQuery({
    queryKey: ['system-version'],
    queryFn:  () => systemApi.getVersion().then(r => r.data),
  })

  const { data: changelogData } = useQuery({
    queryKey: ['system-changelog'],
    queryFn:  () => systemApi.getChangelog(10).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
  const startupMutation = useMutation({
    mutationFn: (enabled) => systemApi.setStartup(enabled).then(r => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['system-startup'] }),
    onError:    (e) => toast.error(e?.response?.data?.detail || t('Failed to update startup setting')),
  })

  // Populate input once config loads
  React.useEffect(() => {
    if (configData && !storageInput) setStorageInput(configData.data_dir || configData.effective_data_dir)
  }, [configData])

  const handleStorageSave = async () => {
    if (!storageInput.trim()) return
    setStorageState('saving')
    try {
      await systemApi.setConfig(storageInput.trim())
      setStorageState('saved')
      qc.invalidateQueries({ queryKey: ['system-config'] })
      // Auto-restart so the new path takes effect immediately
      await systemApi.restart()
    } catch (err) {
      const msg = err?.response?.data?.detail || t('Failed to save storage path.')
      toast.error(msg)
      setStorageState('idle')
    }
  }

  const handleRestoreFileChange = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setRestoreFile(f)
    setRestoreState('confirming')
    e.target.value = ''  // allow re-selecting same file
  }

  const confirmRestore = async () => {
    if (!restoreFile) return
    setRestoreState('uploading')
    try {
      await systemApi.restore(restoreFile)
    } catch (err) {
      const msg = err?.response?.data?.detail || t('Restore failed — file may be invalid.')
      toast.error(msg)
      setRestoreState('idle')
      setRestoreFile(null)
      return
    }
    setRestoreState('restarting')
    setRestoreFile(null)
    // Poll until back online
    if (restorePollRef.current) clearInterval(restorePollRef.current)
    restorePollRef.current = setInterval(async () => {
      try {
        await systemApi.health()
        if (restorePollRef.current) {
          clearInterval(restorePollRef.current)
          restorePollRef.current = null
        }
        setRestoreState('done')
        setTimeout(() => setRestoreState('idle'), 4000)
      } catch { /* still restarting */ }
    }, 800)
    setTimeout(() => {
      if (restorePollRef.current) {
        clearInterval(restorePollRef.current)
        restorePollRef.current = null
      }
      setRestoreState('idle')
    }, 25000)
  }

  const handleReset = async () => {
    setResetState('resetting')
    let previousInstanceId = null
    try {
      const health = await systemApi.health()
      previousInstanceId = health?.data?.instance_id ?? null
    } catch { /* the reset request below will surface a real failure */ }
    try {
      const response = await systemApi.reset()
      previousInstanceId = response?.data?.instance_id ?? previousInstanceId
    } catch { /* server dies after accepting the request — expected */ }
    if (resetPollRef.current) clearInterval(resetPollRef.current)
    resetPollRef.current = setInterval(async () => {
      try {
        const health = await systemApi.health()
        const instanceId = health?.data?.instance_id ?? null
        // The old process deliberately stays alive long enough to deliver the
        // reset response. A plain HTTP 200 here used to be mistaken for a
        // successful restart, immediately before that old process exited.
        if (previousInstanceId && instanceId === previousInstanceId) return
        if (resetPollRef.current) {
          clearInterval(resetPollRef.current)
          resetPollRef.current = null
        }
        setResetState('done')
        setShowResetModal(false)
        qc.clear()
        window.location.reload()
      } catch { /* still restarting */ }
    }, 800)
    setTimeout(() => {
      if (resetPollRef.current) {
        clearInterval(resetPollRef.current)
        resetPollRef.current = null
      }
      setResetState('idle')
    }, 30000)
  }

  const handleSyncFolders = async () => {
    setSyncing(true)
    try {
      const res = await creatorsApi.syncSourceFolders()
      const { synced_creators, newly_assigned } = res.data
      if (newly_assigned > 0) {
        toast.success(t('Synced {count} creator folders — {assignments} new gallery assignments', { count: synced_creators, assignments: newly_assigned }))
      } else {
        toast.success(t('All up to date — checked {count} creator folders, nothing new to assign', { count: synced_creators }))
      }
    } catch {
      toast.error(t('Sync failed'))
    } finally {
      setSyncing(false)
    }
  }

  const handleCheckUpdate = async () => {
    setUpdateState('checking')
    setUpdateInfo(null)
    setUpdateError('')
    try {
      const r = await systemApi.checkUpdate()
      if (r.data.update_available) {
        setUpdateInfo(r.data)
        setUpdateState('available')
      } else {
        setUpdateState('up_to_date')
      }
    } catch (e) {
      setUpdateError(e?.response?.data?.detail || t('Could not reach update server.'))
      setUpdateState('error')
    }
  }

  const handleInstallUpdate = async () => {
    if (!updateInfo?.download_url) return
    setUpdateState('downloading')
    setUpdateProgress(0)
    try {
      const response = await systemApi.installUpdate(updateInfo.download_url)
      if (updatePollRef.current) clearInterval(updatePollRef.current)
      const stopPolling = () => {
        if (updatePollRef.current) clearInterval(updatePollRef.current)
        updatePollRef.current = null
      }
      const poll = createUpdatePoll({
        api: systemApi,
        targetVersion: response.data.version || updateInfo.latest_version,
        onStatus: state => {
          if (state.status === 'downloading') setUpdateProgress(state.progress || 0)
          if (state.status === 'installing' || state.status === 'idle') {
            setUpdateState('installing')
            setUpdateProgress(100)
          }
        },
        onComplete: () => { stopPolling(); window.location.reload() },
        onError: message => {
          stopPolling()
          setUpdateError(t(message || 'Installation failed.'))
          setUpdateState('error')
        },
      })
      updatePollRef.current = setInterval(poll, 1000)

    } catch (e) {
      setUpdateError(e?.response?.data?.detail || t('Update failed.'))
      setUpdateState('error')
    }
  }

  const handleRestart = async () => {
    setRestartState('restarting')
    // Capture the current process identity before asking it to hand off. A
    // healthy response from the old process is not proof that the restart has
    // completed, so the poll below waits for a different instance_id.
    let previousInstanceId = null
    try {
      const health = await systemApi.health()
      previousInstanceId = health?.data?.instance_id || null
    } catch { /* the process may already be going away */ }
    try {
      const response = await systemApi.restart()
      previousInstanceId = response?.data?.instance_id || previousInstanceId
    } catch { /* server died mid-response — that's expected */ }

    if (restartPollRef.current) clearInterval(restartPollRef.current)
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 1500)
        let response
        try {
          response = await fetch('/api/system/health', {
            signal: ctrl.signal,
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`Health check failed: ${response.status}`)
        } finally {
          clearTimeout(t)
        }
        const payload = await response.json().catch(() => null)
        const nextInstanceId = payload?.instance_id || null
        // If we know the old identity, only a new one counts as back online.
        // The no-identity fallback is for a server that died before either
        // health request could complete.
        if (previousInstanceId
          ? (!nextInstanceId || nextInstanceId === previousInstanceId)
          : !nextInstanceId) return
        if (restartPollRef.current) {
          clearInterval(restartPollRef.current)
          restartPollRef.current = null
        }
        setRestartState('done')
        setTimeout(() => setRestartState('idle'), 3000)
      } catch { /* still restarting */ }
      finally { polling = false }
    }
    restartPollRef.current = setInterval(poll, 800)
    poll()
    // Safety timeout — allow a cold Python process to finish importing before
    // giving up. The UI still remains usable if the handoff genuinely fails.
    setTimeout(() => {
      if (restartPollRef.current) {
        clearInterval(restartPollRef.current)
        restartPollRef.current = null
      }
      setRestartState('idle')
    }, 45000)
  }

  const { data: roots } = useQuery({
    queryKey: ['library-roots'],
    queryFn: () => fetch('/api/scanner/roots').then(r => r.json()),
  })

  const { data: missingGalleries = [] } = useQuery({
    queryKey: ['missing-galleries'],
    queryFn: () => scannerApi.missingGalleries().then(r => r.data),
    refetchInterval: 15000,
  })

  // Old galleries left behind by a library move, each with a new twin at the
  // same relative path. Only checked while something is missing.
  const { data: movedMatches } = useQuery({
    queryKey: ['moved-gallery-matches', missingGalleries.length],
    queryFn: () => scannerApi.movedGalleryMatches().then(r => r.data),
    enabled: settingsTab === 'library' && missingGalleries.length > 0,
    staleTime: 60000,
  })
  const [repairingMoved, setRepairingMoved] = React.useState(false)
  const repairMovedGalleries = async () => {
    setRepairingMoved(true)
    try {
      const { data } = await scannerApi.repairMovedGalleries()
      toast.success(t('Reconnected {count} moved galleries', { count: data.repaired }))
      if (data.failed) toast.error(t('{count} could not be reconnected — relink them manually', { count: data.failed }))
      for (const key of ['missing-galleries', 'moved-gallery-matches', 'galleries', 'images-list']) qc.invalidateQueries({ queryKey: [key] })
    } catch (error) {
      toast.error(error?.response?.data?.detail || t('Could not reconnect moved galleries'))
    } finally {
      setRepairingMoved(false)
    }
  }

  const { data: scanStatus } = useQuery({
    queryKey: ['scan-status'],
    queryFn: () => fetch('/api/scanner/status').then(r => r.json()),
    refetchInterval: (query) => query.state.data?.running ? 2000 : false,
  })

  const { data: durationStatus } = useQuery({
    queryKey: ['video-duration-status'],
    queryFn: () => scannerApi.durationStatus().then(r => r.data),
    enabled: settingsTab === 'scanner',
    refetchInterval: (query) => query.state.data?.running ? 1000 : false,
    staleTime: 0,
  })

  const addRoot = async () => {
    if (!newPath.trim()) return
    try {
      await fetch('/api/scanner/roots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath.trim(), label: newLabel.trim() || null }),
      })
      setNewPath('')
      setNewLabel('')
      qc.invalidateQueries({ queryKey: ['library-roots'] })
      toast.success(t('Library folder added!'))
    } catch (err) {
      toast.error(t('Failed to add folder'))
    }
  }

  const chooseSettingsFolder = async path => {
    if (folderPickerTarget === 'library') setNewPath(path)
    else if (folderPickerTarget === 'funscript') { setFsLibPath(path); setFsLibDirty(true) }
    else if (folderPickerTarget === 'storage') { setStorageInput(path); setStorageState('idle') }
    else if (folderPickerTarget?.galleryId) {
      await scannerApi.relinkGallery(folderPickerTarget.galleryId, path)
      qc.invalidateQueries({ queryKey: ['missing-galleries'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
    }
  }

  const startScan = async () => {
    try {
      const res = await fetch('/api/scanner/scan', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.detail || t('Failed to start scan'))
        return
      }
      qc.invalidateQueries({ queryKey: ['scan-status'] })
      qc.invalidateQueries({ queryKey: ['task-queue'] })
      toast.success(t('Scan queued!'))
    } catch (err) {
      toast.error(t('Failed to start scan'))
    }
  }

  const startFolderScan = async () => {
    if (!selectedRootId) return
    const root = (roots ?? []).find(r => String(r.id) === String(selectedRootId))
    if (!root) return
    setFolderScanning(true)
    try {
      await fetch(`/api/scanner/scan?root_id=${root.id}`, { method: 'POST' })
      toast.success(t('Scan queued: "{name}"', { name: root.label || root.path }))
      qc.invalidateQueries({ queryKey: ['scan-status'] })
      qc.invalidateQueries({ queryKey: ['task-queue'] })
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Failed to start scan'))
    } finally {
      setFolderScanning(false)
    }
  }

  return (
    <div className="vault-settings-page flex flex-col h-full overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="vault-theme-settings-header flex-shrink-0 px-8 pt-8 pb-5"
           style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: 'var(--c-surface)' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
               style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
            <SlidersHorizontal size={18} style={{ color: 'var(--c-accent)' }} />
          </div>
          <div>
            <h1 className="text-[27px] font-bold text-white/90">{t('Settings')}</h1>
            <p className="text-[18px] text-white/40">{t('Configure your Vault experience.')}</p>
          </div>
        </div>
        <div className="vault-theme-settings-tabs flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
            const active = settingsTab === id
            return (
              <button key={id} onClick={() => setSettingsTab(id)}
                      data-active={active}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-[17px] font-medium whitespace-nowrap transition-all flex-shrink-0"
                      style={active
                        ? { background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }
                        : { background: 'transparent', color: 'rgba(255,255,255,0.45)', border: '0.5px solid transparent' }
                      }>
                <Icon size={14} />
                {t(label)}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────── */}
      <div className="vault-theme-settings-content flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={settingsTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="vault-theme-settings-panel px-8 py-6 max-w-4xl"
          >

            {/* ── Library tab ──────────────────────────── */}
            {settingsTab === 'library' && (
              <div className="space-y-3">
                <SettingsSection title={t('Library folders')} icon={FolderOpen} accentColor="var(--c-amber)">
                  <p className="text-[16px] text-white/45 mb-4">
                    {t('Add folders to scan. Each subfolder becomes a gallery.')}
                  </p>
                  {(() => {
                    const allRoots = roots ?? []
                    const COLLAPSE_AT = 5
                    const visible = (!showAllRoots && allRoots.length > COLLAPSE_AT) ? allRoots.slice(0, COLLAPSE_AT) : allRoots
                    const hidden = allRoots.length - COLLAPSE_AT
                    return (
                      <>
                        {allRoots.length === 0 && (
                          <div className="text-[16px] text-white/25 py-2">{t('No library folders added yet.')}</div>
                        )}
                        {visible.map(r => (
                          <div key={r.id} className="flex items-center gap-3 py-2.5 border-b border-[rgba(255,255,255,0.06)]">
                            <div className="flex-1 min-w-0">
                              <div className="text-[16px] text-white/75 truncate">{r.path}</div>
                              {r.label && <div className="text-[14px] text-white/35">{r.label}</div>}
                            </div>
                            {r.last_scan && (
                              <div className="text-[13px] text-white/30 shrink-0">
                                {t('scanned')} {new Date(r.last_scan).toLocaleDateString()}
                              </div>
                            )}
                            <button onClick={async () => {
                              await fetch(`/api/scanner/roots/${r.id}`, { method: 'DELETE' })
                              qc.invalidateQueries({ queryKey: ['library-roots'] })
                            }} className="text-[13px] px-2.5 py-1 rounded cursor-pointer shrink-0"
                                    style={{ color: 'color-mix(in srgb, var(--c-pink) 70%, transparent)', background: 'color-mix(in srgb, var(--c-pink) 10%, transparent)' }}>
                              {t('Remove')}
                            </button>
                          </div>
                        ))}
                        {allRoots.length > COLLAPSE_AT && (
                          <button onClick={() => setShowAllRoots(v => !v)}
                                  className="mt-1 text-[14px] cursor-pointer"
                                  style={{ color: 'color-mix(in srgb, var(--c-accent) 70%, transparent)' }}>
                            {showAllRoots ? t('▲ Show less') : `▼ ${t('Show')} ${hidden} ${t('more folders')}…`}
                          </button>
                        )}
                      </>
                    )
                  })()}
                  <div className="flex flex-col gap-2 mt-5">
                    <div className="flex gap-2">
                      <input value={newPath} onChange={e => setNewPath(e.target.value)}
                             placeholder="C:\Users\You\Pictures\Collection"
                             className="flex-1 bg-transparent rounded-[8px] px-3 py-2 text-[16px] text-white/80 placeholder-[rgba(255,255,255,0.2)]"
                             style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}
                             onKeyDown={e => e.key === 'Enter' && addRoot()} />
                      <button onClick={() => setFolderPickerTarget('library')}
                              className="px-3 py-2 rounded-[8px] text-[16px] cursor-pointer whitespace-nowrap"
                              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                        {t('📁 Browse')}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                             placeholder={t('Label (optional — e.g. Cosplayers)')}
                             className="flex-1 bg-transparent rounded-[8px] px-3 py-2 text-[16px] text-white/80 placeholder-[rgba(255,255,255,0.2)]"
                             style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}
                             onKeyDown={e => e.key === 'Enter' && addRoot()} />
                      <button onClick={addRoot} disabled={!newPath.trim()}
                              className="px-4 py-2 rounded-[8px] text-[16px] cursor-pointer disabled:opacity-40"
                              style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                        {t('Add')}
                      </button>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Missing folders')} icon={AlertCircle} accentColor="var(--c-pink)" defaultOpen={missingGalleries.length > 0}>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <p className="text-base text-white/45">
                      {missingGalleries.length
                        ? `${missingGalleries.length} ${t('galleries are hidden because their folders are unavailable.')}`
                        : t('No missing gallery folders detected.')}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={async () => {
                                await scannerApi.reconcileGalleries()
                                qc.invalidateQueries({ queryKey: ['missing-galleries'] })
                                qc.invalidateQueries({ queryKey: ['galleries'] })
                              }}
                              className="px-3 py-2 rounded-lg text-base cursor-pointer"
                              style={{ color: 'var(--c-accent-text)', background: 'color-mix(in srgb, var(--c-accent) 16%, transparent)' }}>
                        {t('Check now')}
                      </button>
                      <button onClick={async () => {
                                try {
                                  await scannerApi.resolveMissingGalleries()
                                  qc.invalidateQueries({ queryKey: ['scan-status'] })
                                  qc.invalidateQueries({ queryKey: ['task-queue'] })
                                  toast.success(t('Missing-folder resolution started'))
                                } catch (error) {
                                  toast.error(error?.response?.data?.detail || t('Could not start missing-folder resolution'))
                                }
                              }}
                              // Resolving would remove the originals that moved galleries
                              // still need; reconnect those first.
                              disabled={!missingGalleries.length || scanStatus?.running || movedMatches?.count > 0}
                              title={movedMatches?.count > 0 ? t('Reconnect moved galleries first') : undefined}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-base cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ color: 'var(--c-green-text)', background: 'color-mix(in srgb, var(--c-green) 16%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
                        <RefreshCw size={16} />
                        {t('Resolve all')}
                      </button>
                    </div>
                  </div>
                  {movedMatches?.count > 0 && (
                    <div className="flex items-center justify-between gap-3 mb-4 rounded-lg p-3"
                         style={{ background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                      <div className="min-w-0">
                        <div className="text-base text-white/85">{t('{count} galleries were moved to a new location', { count: movedMatches.count })}</div>
                        <div className="text-base text-white/45">
                          {t('Each one now has a duplicate at its new folder. Reconnecting moves the original there and keeps its creators, ratings, history and cards.')}
                        </div>
                        {movedMatches.matches?.[0] && (
                          <div className="text-base text-white/35 truncate mt-1" title={`${movedMatches.matches[0].old_path} → ${movedMatches.matches[0].new_path}`}>
                            {t('e.g.')} {movedMatches.matches[0].old_path} → {movedMatches.matches[0].new_path}
                          </div>
                        )}
                      </div>
                      <button onClick={repairMovedGalleries} disabled={repairingMoved || scanStatus?.running}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-base cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ color: 'var(--c-accent-text)', background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                        <RefreshCw size={16} className={repairingMoved ? 'animate-spin' : ''} />
                        {repairingMoved ? t('Reconnecting…') : t('Reconnect moved galleries')}
                      </button>
                    </div>
                  )}
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {missingGalleries.map(gallery => (
                      <div key={gallery.id} className="rounded-lg p-3 border border-white/10 bg-black/20">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-base text-white/80 truncate">{gallery.name}</div>
                            <div className="text-base text-white/35 truncate" title={gallery.folder_path}>{gallery.folder_path}</div>
                            <div className="text-base mt-1" style={{ color: gallery.root_online ? 'var(--c-amber)' : 'var(--c-pink)' }}>
                              {gallery.root_online ? `${gallery.image_count} ${t('files')} · ${t('owning root is online')}` : t('Owning root is offline — protected from automatic removal')}
                            </div>
                          </div>
                          <button onClick={() => setFolderPickerTarget({ galleryId: gallery.id })}
                                  className="px-3 py-2 rounded-lg text-base cursor-pointer"
                                  style={{ color: 'var(--c-green-text)', background: 'color-mix(in srgb, var(--c-green) 15%, transparent)' }}>
                            {t('Relink')}
                          </button>
                          <button onClick={async () => {
                                    if (!window.confirm(`${t('Remove the missing gallery')} “${gallery.name}” ${t('from The Vault? Files on disk are not touched.')}`)) return
                                    await scannerApi.removeMissingGallery(gallery.id)
                                    qc.invalidateQueries({ queryKey: ['missing-galleries'] })
                                    qc.invalidateQueries({ queryKey: ['galleries'] })
                                  }}
                                  className="px-3 py-2 rounded-lg text-base cursor-pointer"
                                  style={{ color: '#F4C0D1', background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)' }}>
                            {t('Remove')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Creator folder sync')} icon={RefreshCw} accentColor="var(--c-accent)" defaultOpen={false}>
                  <p className="text-[16px] text-white/45 mb-4">
                    {t("Re-checks every creator's source folder and assigns any galleries added since it was last set. Also runs automatically on each scan — use this if you assigned a source folder after importing.")}
                  </p>
                  <button onClick={handleSyncFolders} disabled={syncing}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer disabled:opacity-50"
                          style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                    <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? t('Syncing…') : t('Sync now')}
                  </button>
                </SettingsSection>
              </div>
            )}

            {/* ── Scanner tab ──────────────────────────── */}
            {settingsTab === 'scanner' && (
              <div className="space-y-3">
                <SettingsSection title={t('Library scan')} icon={ScanLine} accentColor="var(--c-green)">
                  <div className="flex items-center justify-between gap-4 p-3 rounded-[9px] mb-5"
                       style={{ background: 'rgba(255,255,255,0.035)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <div className="text-[17px] font-semibold text-white/75">{t('Ignore hidden and system content')}</div>
                      <div className="text-[16px] text-white/40 mt-1">
                        {t('Prevents thumbnail caches and app metadata folders from becoming galleries. Also applies to Loading Bay.')}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={configData?.ignore_hidden_media !== false}
                      onClick={async () => {
                        const enabled = configData?.ignore_hidden_media === false
                        try {
                          await systemApi.setIgnoreHiddenMedia(enabled)
                          qc.setQueryData(['system-config'], old => old ? { ...old, ignore_hidden_media: enabled } : old)
                          toast.success(enabled ? t('Hidden content will be ignored') : t('Hidden content will be included'))
                        } catch {
                          toast.error(t('Could not save scanner setting'))
                        }
                      }}
                      className="relative flex-shrink-0 w-14 h-8 rounded-full cursor-pointer transition-colors"
                      style={{ background: configData?.ignore_hidden_media !== false ? 'var(--c-green)' : 'rgba(255,255,255,0.12)' }}>
                      <span className="absolute top-1 w-6 h-6 rounded-full bg-white transition-all"
                            style={{ left: configData?.ignore_hidden_media !== false ? 28 : 4 }} />
                    </button>
                  </div>
                  {scanStatus?.running ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[16px] text-white/60">{scanStatus.message}</div>
                        <button onClick={async () => { await scannerApi.cancel(); qc.invalidateQueries({ queryKey: ['scan-status'] }) }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[14px] cursor-pointer ml-2 flex-shrink-0"
                                style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                          <X size={10} /> {t('Cancel')}
                        </button>
                      </div>
                      <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden">
                        <div className="h-full rounded-full bg-[var(--c-accent)] transition-all"
                             style={{ width: `${scanStatus.total ? (scanStatus.progress / scanStatus.total) * 100 : 0}%` }} />
                      </div>
                      <div className="text-[14px] text-white/30 mt-1">
                        {scanStatus.progress} / {scanStatus.total} {t('folders')} · {scanStatus.new_galleries} {t('new galleries')} · {scanStatus.new_images} {t('new images')}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {scanStatus?.message && scanStatus.message !== 'Idle' && (
                        <div className="text-[16px] text-white/45">{scanStatus.message}</div>
                      )}
                      <div>
                        <div className="text-[17px] font-semibold text-white/70 mb-1">{t('Full library scan')}</div>
                        <p className="text-[15px] text-white/40 mb-3">{t('Walks every library folder, creates Gallery records, generates thumbnails, detects funscripts.')}</p>
                        <button onClick={startScan}
                                className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit"
                                style={{ background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
                          {t('Scan entire library')}
                        </button>
                      </div>
                      <div className="pt-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                        <div className="text-[17px] font-semibold text-white/70 mb-1">{t('Rescan a single folder')}</div>
                        {(roots ?? []).length === 0 ? (
                          <div className="text-[16px] text-white/25">{t('No library folders added yet.')}</div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <RootDropdown roots={roots ?? []} value={selectedRootId} onChange={setSelectedRootId} />
                            <button onClick={startFolderScan} disabled={!selectedRootId || folderScanning}
                                    className="px-4 py-2 rounded-[8px] text-[16px] cursor-pointer disabled:opacity-40 w-fit"
                                    style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                              {folderScanning ? t('Starting…') : t('Scan selected root')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </SettingsSection>

                <SettingsSection title={t('Thumbnails')} icon={RefreshCw} accentColor="var(--c-amber)" defaultOpen={false}>
                  <p className="text-[16px] text-white/45 mb-4">
                    {t('Purge deletes existing thumbnails; regenerate rebuilds any that are missing. To fully rebuild a type, purge it first, then regenerate. Everything runs in the background.')}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {[
                      { label: '🗑️ Purge image thumbnails', fn: () => scannerApi.purgeThumbs('images'), danger: true },
                      { label: '🗑️ Purge video thumbnails', fn: () => scannerApi.purgeThumbs('videos'), danger: true },
                    ].map(b => (
                      <button key={b.label} disabled={regenning}
                              onClick={async () => {
                                setRegenning(true)
                                try { await b.fn(); toast.success(t('Purge started!')) }
                                catch { toast.error(t('Failed to start')) }
                                finally { setTimeout(() => setRegenning(false), 3000) }
                              }}
                              className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                              style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: 'var(--c-pink-text)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                        {t(b.label)}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: '🖼️ Regenerate image thumbnails', fn: () => scannerApi.regenThumbs('images') },
                      { label: '🎬 Regenerate video thumbnails', fn: () => scannerApi.regenThumbs('videos') },
                    ].map(b => (
                      <button key={b.label} disabled={regenning}
                              onClick={async () => {
                                setRegenning(true)
                                try { await b.fn(); toast.success(t('Regeneration started!')) }
                                catch { toast.error(t('Failed to start')) }
                                finally { setTimeout(() => setRegenning(false), 3000) }
                              }}
                              className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                              style={{ background: 'color-mix(in srgb, var(--c-amber) 20%, transparent)', color: 'var(--c-amber-text)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)' }}>
                        {t(b.label)}
                      </button>
                    ))}
                  </div>
                  {/* This is deliberately a one-time legacy repair. Once every
                      video has a duration, normal scans keep it populated and
                      there is no reason to leave the repair button around. */}
                  {(durationStatus == null || durationStatus.missing > 0) && (
                    <div className="mt-4 pt-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                      <div className="text-[16px] text-white/75 mb-1">{t('Read video lengths')}</div>
                      <div className="text-[14px] text-white/30 mb-3">
                        {t('Fills in the length of videos imported before The Vault started reading it. A normal rescan skips them. Safe to cancel and resume.')}
                      </div>
                      <button disabled={regenning || durationStatus?.running}
                              onClick={async () => {
                                setRegenning(true)
                                try {
                                  const { data } = await scannerApi.backfillDurations()
                                  qc.invalidateQueries({ queryKey: ['video-duration-status'] })
                                  toast.success(data.queued
                                    ? `${t('Queued')} — ${data.missing} ${t('videos')}`
                                    : t('Every video already has a length'))
                                }
                                catch { toast.error(t('Failed to start')) }
                                finally { setTimeout(() => setRegenning(false), 3000) }
                              }}
                              className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                              style={{ background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' }}>
                        {durationStatus?.running ? t('Reading…') : t('⏱️ Read video lengths')}
                      </button>
                    </div>
                  )}
                </SettingsSection>

                <SettingsSection title={t('Funscript library')} icon={ScanLine} accentColor="var(--c-pink)" defaultOpen={false}>
                  <p className="text-[16px] text-white/45 mb-4">
                    {t('Keep all your .funscript files in one folder. The Vault matches each script to a video with the same filename anywhere in your library — handy when scripts and videos live in different folders.')}
                  </p>
                  <div className="flex gap-2 mb-3">
                    <input value={fsLibPath}
                           onChange={e => { setFsLibPath(e.target.value); setFsLibDirty(true) }}
                           placeholder={t('Path to your funscript folder')}
                           className="flex-1 px-3 py-2 rounded-[8px] text-[16px] bg-white/5 text-white/80 outline-none"
                           style={{ border: '0.5px solid rgba(255,255,255,0.1)' }} />
                    <button onClick={() => setFolderPickerTarget('funscript')}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[16px] cursor-pointer flex-shrink-0"
                            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                      <FolderOpen size={15} /> {t('Browse')}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => {
                              try {
                                await systemApi.setFunscriptLibrary(fsLibPath.trim())
                                setFsLibDirty(false)
                                qc.invalidateQueries({ queryKey: ['system-config'] })
                                toast.success(t('Funscript folder saved!'))
                              } catch (err) { toast.error(err?.response?.data?.detail || t('Failed to save folder')) }
                            }}
                            className="px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit"
                            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                      {t('Save folder')}
                    </button>
                    <button disabled={fsMatching || !fsLibPath.trim()}
                            onClick={async () => {
                              setFsMatching(true)
                              try {
                                await scannerApi.matchFunscripts(fsLibPath.trim())
                                qc.invalidateQueries({ queryKey: ['scan-status'] })
                                qc.invalidateQueries({ queryKey: ['task-queue'] })
                                toast.success(t('Funscript matching started!'))
                              } catch (err) { toast.error(err?.response?.data?.detail || t('Failed to start matching')) }
                              finally { setTimeout(() => setFsMatching(false), 3000) }
                            }}
                            className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[16px] cursor-pointer w-fit disabled:opacity-40"
                            style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                      {fsMatching ? t('Starting…') : t('🔗 Match funscripts now')}
                    </button>
                  </div>
                </SettingsSection>
              </div>
            )}

            {/* ── AI Tagging tab ───────────────────────── */}
            {settingsTab === 'tagging' && (
              <div className="space-y-3">
                <AITaggingPanel Section={SettingsSection} />
                <TagRolesPanel Section={SettingsSection} />
              </div>
            )}

            {/* ── Appearance tab ───────────────────────── */}
            {settingsTab === 'appearance' && (
              <div className="space-y-3">
                <SettingsSection title={t('Language')} icon={Globe} accentColor="var(--c-accent)">
                  <div className="text-[14px] text-white/25 mb-3">{t('Display language')}</div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                    {LANGUAGES.map(lang => (
                      <button key={lang.id} onClick={() => setLocale(lang.id)}
                              className="flex items-center gap-3 p-3 rounded-[10px] cursor-pointer text-left transition-all"
                              style={{ background: locale === lang.id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${locale === lang.id ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)'}` }}>
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="text-[16px] font-medium truncate" style={{ color: locale === lang.id ? 'var(--c-accent)' : 'rgba(255,255,255,0.7)' }}>{lang.native}</span>
                          <span className="text-[13px] text-white/30 truncate">{t(lang.label)}</span>
                        </div>
                        {locale === lang.id && <Check size={14} className="flex-shrink-0" style={{ color: 'var(--c-accent)' }} />}
                      </button>
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Theme')} icon={Sparkles} accentColor="var(--c-accent)">
                  <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                    {PALETTES.map(p => (
                      <button key={p.id} onClick={() => setPalette(p)}
                              className="flex flex-col gap-2 p-3 rounded-[10px] cursor-pointer text-left transition-all"
                              style={{ background: currentPalette.id === p.id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${currentPalette.id === p.id ? p.accent : 'rgba(255,255,255,0.08)'}` }}>
                        <div className="flex gap-1 items-center">
                          {[p.accent, p.pink, p.amber, p.green].map((c, i) => (
                            <div key={i} className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c }} />
                          ))}
                          {currentPalette.id === p.id && <Check size={12} className="ml-auto flex-shrink-0" style={{ color: p.accent }} />}
                        </div>
                        <div className="w-full h-1.5 rounded-full" style={{ background: `linear-gradient(to right, ${p.bg}, ${p.card})` }} />
                        <div className="text-[14px] font-medium" style={{ color: currentPalette.id === p.id ? p.accent : 'rgba(255,255,255,0.55)' }}>{t(p.label)}</div>
                      </button>
                    ))}
                  </div>
                  {currentPalette.id === 'glass' && (
                    <div className="pt-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                      <div className="text-[16px] font-semibold text-white/55 mb-1">{t('Glass Background Image')}</div>
                      <div className="text-[14px] text-white/25 mb-3">{t('Pick any image from your PC to use as the background behind the glass effect.')}</div>
                      <input ref={glassBgFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                             onChange={e => {
                               const file = e.target.files[0]; if (!file) return
                               const reader = new FileReader()
                               reader.onload = ev => { setGlassBackground(ev.target.result); setGlassBgLabel(file.name); localStorage.setItem('vault_glass_bg_label', file.name) }
                               reader.readAsDataURL(file)
                             }} />
                      <div className="flex items-center gap-2">
                        <button onClick={() => glassBgFileRef.current?.click()}
                                className="px-4 py-2 rounded-[8px] text-[15px] cursor-pointer"
                                style={{ background: 'rgba(160,180,208,0.15)', color: '#A0B4D0', border: '0.5px solid rgba(160,180,208,0.35)' }}>
                          {t('Browse…')}
                        </button>
                        {glassBgLabel ? <span className="text-[14px] text-white/50 truncate flex-1">{glassBgLabel}</span>
                                      : <span className="text-[14px] text-white/20 flex-1">{t('No image selected — using default gradient')}</span>}
                      </div>
                      {glassBackground && (
                        <button onClick={() => { setGlassBackground(''); setGlassBgLabel(''); localStorage.removeItem('vault_glass_bg_label'); if (glassBgFileRef.current) glassBgFileRef.current.value = '' }}
                                className="mt-2 text-[14px] text-white/30 hover:text-white/60 transition-colors">
                          {t('Reset to default')}
                        </button>
                      )}
                    </div>
                  )}
                </SettingsSection>

                <SettingsSection title={t('Character themes')} icon={Sparkles} accentColor="var(--c-amber)">
                  {installedThemePacks.map(item => (
                    <div key={item.id} className="mt-3 flex items-stretch gap-2">
                    <button type="button"
                            onClick={() => setPalette({ id: `pack:${item.id}`, label: item.name, ...item.palette })}
                            aria-pressed={currentPalette.id === `pack:${item.id}`}
                            className="flex-1 min-w-0 min-h-[108px] flex items-center gap-4 p-4 rounded-[12px] text-left cursor-pointer"
                            style={{ background: currentPalette.id === `pack:${item.id}` ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.03)',
                              border: `1px solid ${currentPalette.id === `pack:${item.id}` ? item.palette.accent : 'rgba(255,255,255,.1)'}` }}>
                      <span className="vault-theme-option__art" aria-hidden="true">
                        {item.preview_asset && <img src={`/theme-packs/${encodeURIComponent(item.id)}/${item.preview_asset}`} alt="" />}
                      </span>
                      <span className="flex gap-1" aria-hidden="true">
                        {[item.palette.accent, item.palette.pink, item.palette.amber].map((color, index) =>
                          <span key={index} className="w-5 h-5 rounded-full" style={{ background: color }} />)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <strong className="block text-[17px]">{item.name}</strong>
                        <span className="text-[16px] text-white/50">{item.image_count} {t('artwork placements')} · {t('local pack')}</span>
                      </span>
                      {currentPalette.id === `pack:${item.id}` && <Check size={20} aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => removeThemePack(item)}
                            className="px-3 rounded-[10px] text-[16px] text-white/55 hover:text-white cursor-pointer"
                            style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)' }}>
                      {t('Remove')}
                    </button>
                    </div>
                  ))}
                  <input ref={packFileRef} type="file" accept=".vaulttheme" hidden onChange={importThemePack} />
                  <button type="button" onClick={() => packFileRef.current?.click()} disabled={packImporting}
                          className="mt-3 px-4 py-2 rounded-[8px] cursor-pointer text-[16px]"
                          style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)' }}>
                    {packImporting ? t('Installing…') : t('Import theme pack…')}
                  </button>
                </SettingsSection>

                <SettingsSection title={t('Typography')} icon={Type} accentColor="rgba(255,255,255,0.4)" defaultOpen={false}>
                  <div>
                    <div className="text-[16px] font-semibold text-white/55 mb-2">{t('Font')}</div>
                    <div className="flex flex-wrap gap-2">
                      {availableFonts.map(f => (
                        <button key={f.id} onClick={() => setFont(f)}
                                className="px-4 py-2 rounded-[8px] cursor-pointer transition-all text-[16px]"
                                style={{ fontFamily: f.family, background: currentFont.id === f.id ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${currentFont.id === f.id ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)'}`, color: currentFont.id === f.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)' }}>
                          {t(f.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </SettingsSection>


                <SettingsSection title={t('Vault identity')} icon={Sparkles} accentColor="var(--c-amber)" defaultOpen={false}>
                  <div className="mb-5">
                    <div className="text-[16px] font-semibold text-white/55 mb-2">{t('Vault name')}</div>
                    <div className="flex gap-2">
                      <input value={vaultNameInput} onChange={e => setVaultNameInput(e.target.value)}
                             onKeyDown={e => e.key === 'Enter' && setVaultName(vaultNameInput)}
                             placeholder={t('The Vault')} maxLength={30}
                             className="flex-1 px-3 py-2 rounded-[8px] text-[16px] outline-none"
                             style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }} />
                      <button onClick={() => setVaultName(vaultNameInput)}
                              className="px-4 py-2 rounded-[8px] text-[15px] cursor-pointer"
                              style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                        {t('Save')}
                      </button>
                    </div>
                    <div className="text-[14px] text-white/20 mt-1.5">{t('Shown in the sidebar. Max 30 characters.')}</div>
                  </div>
                  <div>
                    <div className="text-[16px] font-semibold text-white/55 mb-2">{t('Session border glow')}</div>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { label: 'Pink',   value: 'var(--c-pink)',  swatch: '#D4537E' },
                        { label: 'Red',    value: '#FF3333',         swatch: '#FF3333' },
                        { label: 'Cyan',   value: '#00DDFF',         swatch: '#00DDFF' },
                        { label: 'Violet', value: 'var(--c-accent)', swatch: '#7F77DD' },
                        { label: 'White',  value: '#FFFFFF',         swatch: '#FFFFFF' },
                        { label: 'Green',  value: 'var(--c-green)',  swatch: '#1D9E75' },
                      ].map(opt => (
                        <button key={opt.label} onClick={() => setSessionGlowColor(opt.value)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[15px] cursor-pointer transition-all"
                                style={{ background: sessionGlowColor === opt.value ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${sessionGlowColor === opt.value ? opt.swatch : 'rgba(255,255,255,0.08)'}`, color: sessionGlowColor === opt.value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)' }}>
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: opt.swatch }} />
                          {t(opt.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Effects & Companion')} icon={Sparkles} accentColor="var(--c-pink)" defaultOpen={false}>
                  <div className="flex flex-col gap-4 mb-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[16px] text-white/75">{t('🎉 Confetti on level-up')}</div>
                        <div className="text-[14px] text-white/30 mt-0.5">{t('Burst of confetti every time you level up.')}</div>
                      </div>
                      <button onClick={() => setConfettiEnabled(!confettiEnabled)}
                              className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors"
                              style={{ background: confettiEnabled ? 'color-mix(in srgb, var(--c-pink) 60%, transparent)' : 'rgba(255,255,255,0.1)' }}>
                        <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                             style={{ left: confettiEnabled ? 'calc(100% - 17px)' : '3px' }} />
                      </button>
                    </div>
                  </div>
                  <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                    <div className="text-[17px] font-semibold text-white/75 mb-1">{t('Vault Companion')}</div>
                    <div className="text-[15px] text-white/35 mb-4">{t('AI companion powered by Ollama (local, private, uncensored). Requires Ollama to be installed.')}</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[16px] text-white/70">{compConfig?.enabled ? `${compConfig?.name || 'Erika'} ${t('is active')}` : t('Companion disabled')}</div>
                        <div className="text-[14px] text-white/30 mt-0.5">{t('When enabled, she appears in the sidebar and as a floating chat bubble.')}</div>
                      </div>
                      <button onClick={toggleCompanion}
                              className="w-10 h-5 rounded-full relative flex-shrink-0 ml-4 transition-colors"
                              style={{ background: compConfig?.enabled ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.1)' }}>
                        <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                             style={{ left: compConfig?.enabled ? 'calc(100% - 17px)' : '3px' }} />
                      </button>
                    </div>
                    {compConfig?.enabled && (
                      <a href="/erika" className="inline-flex items-center gap-1.5 mt-3 text-[15px] px-3 py-1.5 rounded-lg transition-colors hover:bg-white/10"
                         style={{ color: '#A89FE8', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                        <Sparkles size={12} /> {t('Open')} {compConfig?.name || 'Erika'} →
                      </a>
                    )}
                  </div>
                </SettingsSection>
              </div>
            )}

            {/* ── Performance tab ──────────────────────── */}
            {settingsTab === 'performance' && (
              <div className="space-y-3">
                <p className="text-[16px] text-white/40 px-1">
                  {t('Things that cost speed or graphics power. Turn them down if The Vault feels slow on this PC.')}
                </p>
                <SettingsSection title={t('Video hover previews')} icon={Play} accentColor="var(--c-accent)">
                  <HoverClipSettings />
                </SettingsSection>

                <SettingsSection title={t('Animations & effects')} icon={Gauge} accentColor="var(--c-green)">
                  <div className="mb-5">
                    <div className="text-[16px] font-semibold text-white/55 mb-2">{t('Animations')}</div>
                    <div className="flex gap-2">
                      {[['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']].map(([val, label]) => (
                        <button key={val} onClick={() => setAnimSpeed(val)}
                                className="flex-1 py-2 rounded-[8px] text-[16px] cursor-pointer transition-all"
                                style={{ background: animSpeed === val ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${animSpeed === val ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)'}`, color: animSpeed === val ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)' }}>
                          {t(label)}
                        </button>
                      ))}
                    </div>
                    <div className="text-[16px] text-white/40 mt-2">{t('"Off" disables all transitions and animations — useful on low-end hardware.')}</div>
                  </div>
                  <div className="flex flex-col gap-4" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[16px] text-white/75">{t('Neon border effect')}</div>
                        <div className="text-[14px] text-white/30 mt-0.5">{t('Pulsing glow around screen edges during a session.')}</div>
                      </div>
                      <button onClick={() => setShowGoonBorder(!showGoonBorder)}
                              className="w-10 h-5 rounded-full relative cursor-pointer flex-shrink-0 transition-colors"
                              style={{ background: showGoonBorder ? 'color-mix(in srgb, var(--c-pink) 60%, transparent)' : 'rgba(255,255,255,0.1)' }}>
                        <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                             style={{ left: showGoonBorder ? 'calc(100% - 17px)' : '3px' }} />
                      </button>
                    </div>
                  </div>
                </SettingsSection>
              </div>
            )}

            {/* ── Session tab ──────────────────────────── */}
            {settingsTab === 'session' && (
              <div className="space-y-3">
                <SettingsSection title={t('End session behaviour')} icon={Droplets} accentColor="var(--c-pink)">
                  <div className="mb-2">
                    <div className="flex flex-col gap-2">
                      {[
                        { value: 'always', label: 'Always count it',
                          hint: 'Ending a session logs a climax. The original behaviour.' },
                        { value: 'ask',    label: 'Ask me each time',
                          hint: 'Prompts on every finish. Backing out leaves the session running.' },
                        { value: 'never',  label: 'Never count it',
                          hint: 'Logs the time only. Mark climaxes yourself with the 💦 button.' },
                      ].map(opt => {
                        const active = sessionEndClimax === opt.value
                        return (
                          <button key={opt.value} onClick={() => setSessionEndClimax(opt.value)}
                                  className="text-left px-3 py-2.5 rounded-[9px] cursor-pointer transition-all"
                                  style={{
                                    background: active
                                      ? 'color-mix(in srgb, var(--c-pink) 16%, transparent)'
                                      : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${active
                                      ? 'color-mix(in srgb, var(--c-pink) 45%, transparent)'
                                      : 'rgba(255,255,255,0.08)'}`,
                                  }}>
                            <div className="text-[16px]" style={{
                              color: active ? 'color-mix(in srgb, var(--c-pink) 75%, white)' : 'rgba(255,255,255,0.7)',
                              fontWeight: active ? 600 : 400,
                            }}>{t(opt.label)}</div>
                            <div className="text-[14px] text-white/30 mt-0.5">{t(opt.hint)}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Edges')} icon={Waves} accentColor="var(--c-accent)" defaultOpen={false}>
                  <div className="text-[15px] text-white/35">
                    {t('Edge Mode logs an edge whenever the device cuts out. Without a device, log one yourself with the Edge button in any viewer, or the "Log an edge" hotkey.')}
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Session history')} icon={Clock} accentColor="var(--c-amber)" defaultOpen={false}>
                  <div className="text-[15px] text-white/35">
                    {t('Sessions are logged automatically, so a crash or a forgotten stop can leave one that is wrong. Every entry in Session History can be edited or deleted, and you can add sessions the app never saw.')}
                  </div>
                  <a href="/progress/stats" className="inline-flex items-center gap-1.5 mt-3 text-[15px] px-3 py-1.5 rounded-lg transition-colors hover:bg-white/10"
                     style={{ color: 'color-mix(in srgb, var(--c-amber) 80%, white)',
                              border: '0.5px solid color-mix(in srgb, var(--c-amber) 35%, transparent)' }}>
                    <Clock size={12} /> {t('Open Session History')} →
                  </a>
                </SettingsSection>
              </div>
            )}

            {/* ── Hotkeys tab ──────────────────────────── */}
            {settingsTab === 'hotkeys' && (
              <div className="space-y-3">
                <SettingsSection title={t('Hotkeys')} icon={Keyboard} accentColor="var(--c-accent)">
                  <HotkeySettings />
                </SettingsSection>
              </div>
            )}

            {/* ── Backup tab ───────────────────────────── */}
            {settingsTab === 'backup' && (
              <div className="space-y-3">
                <SettingsSection title={t('Backup & Restore')} icon={Archive} accentColor="var(--c-green)">
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-[17px] font-semibold text-white/80">{t('Backup database')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Downloads a snapshot of')} <code className="text-white/50">vault.db</code> {t('— all galleries, creators, sessions, and cards.')}</div>
                    </div>
                    <button onClick={() => { systemApi.backup(); toast.success(t('Backup download started!')) }}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 ml-4"
                            style={{ background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)' }}>
                      <Download size={14} /> {t('Download backup')}
                    </button>
                  </div>
                  <div style={{ height: '0.5px', background: 'color-mix(in srgb, var(--c-green) 20%, transparent)' }} />
                  <div className="flex items-start justify-between gap-4 pt-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[17px] font-semibold text-white/80">{t('Restore backup')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Select a')} <code className="text-white/50">.db</code> {t('backup file. Your current database is saved automatically before overwriting.')}</div>
                      {restoreState === 'confirming' && restoreFile && (
                        <div className="mt-3 p-3 rounded-[8px]"
                             style={{ background: 'color-mix(in srgb, var(--c-pink) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 35%, transparent)' }}>
                          <div className="text-[15px] font-medium mb-1" style={{ color: '#F4C0D1' }}>{t('⚠️ Replace entire database?')}</div>
                          <div className="text-[14px] mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
                            {t('File:')} <span style={{ color: 'rgba(255,255,255,0.7)' }}>{restoreFile.name}</span><br />
                            {t('This will replace all your current data. The app will restart automatically.')}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={confirmRestore}
                                    className="px-4 py-1.5 rounded-[6px] text-[15px] font-medium cursor-pointer"
                                    style={{ background: 'color-mix(in srgb, var(--c-pink) 30%, transparent)', color: '#FFD4E2', border: '0.5px solid color-mix(in srgb, var(--c-pink) 50%, transparent)' }}>
                              {t('Yes, restore')}
                            </button>
                            <button onClick={() => { setRestoreState('idle'); setRestoreFile(null) }}
                                    className="px-4 py-1.5 rounded-[6px] text-[15px] cursor-pointer"
                                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                              {t('Cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <input ref={restoreInputRef} type="file" accept=".db" className="hidden" onChange={handleRestoreFileChange} />
                    <button onClick={() => restoreState === 'idle' && restoreInputRef.current?.click()}
                            disabled={restoreState !== 'idle'}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 disabled:opacity-60"
                            style={restoreState === 'done'
                              ? { background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)' }
                              : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.15)' }}>
                      {restoreState === 'uploading' ? <><RefreshCw size={14} className="animate-spin" /> {t('Uploading…')}</>
                       : restoreState === 'restarting' ? <><RefreshCw size={14} className="animate-spin" /> {t('Restarting…')}</>
                       : restoreState === 'done' ? <><Check size={14} /> {t('Restored!')}</>
                       : <><Download size={14} style={{ transform: 'rotate(180deg)' }} /> {t('Restore backup')}</>}
                    </button>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Storage location')} icon={HardDrive} accentColor="var(--c-accent)" defaultOpen={false}>
                  <p className="text-[16px] text-white/45 mb-4">{t('Storage location for')} <code className="text-white/50">vault.db</code> {t('and the thumbnail cache. Move to a larger drive if C: space is limited. The server restarts automatically when saved.')}</p>
                  {configData && <div className="text-[15px] mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>{t('Active:')} <span className="font-mono" style={{ color: 'rgba(255,255,255,0.55)' }}>{configData.effective_data_dir}</span></div>}
                  {configData?.data_dir && configData.data_dir !== configData?.effective_data_dir && (
                    <div className="text-[14px] mb-3" style={{ color: 'var(--c-amber)' }}>{t('⚠ Configured path')} <span className="font-mono">{configData.data_dir}</span> {t('was not available at startup.')}</div>
                  )}
                  <div className="flex gap-2">
                    <input value={storageInput} onChange={e => { setStorageInput(e.target.value); setStorageState('idle') }}
                           placeholder="e.g. D:\VaultData"
                           className="flex-1 px-3 py-2 rounded-[7px] text-[15px] font-mono outline-none"
                           style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }} />
                    <button onClick={() => setFolderPickerTarget('storage')} className="px-3 py-2 rounded-[7px] text-[16px] cursor-pointer flex-shrink-0" style={{ background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.12)' }}>{t('Browse')}</button>
                    <button onClick={storageState === 'idle' ? handleStorageSave : undefined}
                            disabled={storageState === 'saving' || storageState === 'saved'}
                            className="flex items-center gap-2 px-4 py-2 rounded-[7px] text-[15px] font-medium cursor-pointer flex-shrink-0 disabled:opacity-60"
                            style={storageState === 'saved'
                              ? { background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)' }
                              : { background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                      {storageState === 'saving' ? <><RefreshCw size={12} className="animate-spin" /> {t('Saving…')}</>
                       : storageState === 'saved' ? <><Check size={12} /> {t('Saved — restarting…')}</>
                       : <><Check size={12} /> {t('Save & restart')}</>}
                    </button>
                  </div>
                </SettingsSection>
              </div>
            )}

            {/* ── System tab ───────────────────────────── */}
            {settingsTab === 'system' && (
              <div className="space-y-3">
                <SettingsSection title={t('Connect mobile device')} icon={Smartphone} accentColor="var(--c-accent)">
                  <div className="text-[16px] text-white/45 mb-4 leading-relaxed">
                    {t('Scan the code with your phone camera.')} <strong className="text-white/70">{t('Home Wi-Fi')}</strong> {t('works when the phone is on the same network as this PC.')} <strong className="text-white/70">{t('Tailscale')}</strong> {t('works from anywhere, as long as Tailscale is on for both devices, and its address never changes.')}
                  </div>
                  {mobileLink?.found === false && !linkAddresses.length && (
                    <div className="flex items-center gap-2 text-[16px] mb-4 p-3 rounded-[8px]"
                         style={{ background: 'color-mix(in srgb, var(--c-amber) 12%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 30%, transparent)', color: 'var(--c-amber-text)' }}>
                      <AlertCircle size={16} /> {t("Could not find this PC's network address. Make sure you're connected to Wi-Fi or a network.")}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-4 mb-4">
                    {linkAddresses.length > 1 && (
                      <div className="flex gap-1 p-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        {linkAddresses.map(a => (
                          <button key={a.kind} onClick={() => setLinkKind(a.kind)}
                                  className="px-3.5 py-1.5 rounded-full text-[15px] cursor-pointer"
                                  style={activeAddress?.kind === a.kind
                                    ? { background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)', color: 'var(--c-accent-text)' }
                                    : { color: 'rgba(255,255,255,0.5)' }}>
                            {a.kind === 'tailscale' ? t('Tailscale (anywhere)') : t('Home Wi-Fi')}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1 p-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      {[['browser', t('Phone browser')], ['app', t('Android app')]].map(([id, label]) => (
                        <button key={id} onClick={() => setLinkTarget(id)}
                                className="px-3.5 py-1.5 rounded-full text-[15px] cursor-pointer"
                                style={linkTarget === id
                                  ? { background: 'color-mix(in srgb, var(--c-accent) 25%, transparent)', color: 'var(--c-accent-text)' }
                                  : { color: 'rgba(255,255,255,0.5)' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-6 flex-wrap">
                    {phoneLink && (
                      <div className="p-3 rounded-[12px] bg-white flex-shrink-0">
                        <QRCodeCanvas value={phoneLink} size={168} level="M" includeMargin={false} />
                      </div>
                    )}
                    <div className="flex-1 min-w-[220px]">
                      <div className="text-[15px] text-white/35 mb-1">{linkTarget === 'app' ? t('Server address for the app') : t('Address for your phone')}</div>
                      <div className="flex items-center gap-2">
                        <code className="text-[18px] font-mono px-3 py-2 rounded-[8px] flex-1 break-all"
                              style={{ background: 'rgba(255,255,255,0.05)', color: '#D0CEFD', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                          {phoneAddress ?? '…'}
                        </code>
                        <button onClick={() => { if (phoneAddress) { navigator.clipboard?.writeText(phoneAddress); toast.success(t('Address copied')) } }}
                                disabled={!phoneAddress}
                                className="flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 disabled:opacity-40"
                                style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: '#B8B4F0', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                          <Copy size={15} /> {t('Copy')}
                        </button>
                      </div>
                      <div className="text-[15px] text-white/30 mt-3 leading-relaxed">
                        {linkTarget === 'app'
                          ? t('Scanning opens The Vault app and connects it to this PC. You can also type the address into the app.')
                          : t('Tap Add to Home Screen in the phone browser to get a full-screen app with no browser bars.')}
                        {' '}{t('Keep The Vault running on this PC — your phone reads the library straight from here, so nothing is copied to the phone.')}
                      </div>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Startup & Updates')} icon={RefreshCw} accentColor="var(--c-accent)">
                  <div className="flex items-center justify-between py-3 mb-4" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                    <div>
                      <div className="text-[17px] font-semibold text-white/80">{t('Run on startup')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Launch The Vault automatically when Windows starts.')}</div>
                      {startupData && !startupData.available && <div className="text-[14px] mt-1 text-white/25">{t('Only available in the installed version')}</div>}
                    </div>
                    <button disabled={!startupData?.available || startupMutation.isPending}
                            onClick={() => startupMutation.mutate(!startupData?.enabled)}
                            className="w-10 h-5 rounded-full relative flex-shrink-0 ml-4 transition-colors disabled:opacity-30"
                            style={{ background: startupData?.enabled ? 'color-mix(in srgb, var(--c-accent) 60%, transparent)' : 'rgba(255,255,255,0.1)', cursor: startupData?.available ? 'pointer' : 'not-allowed' }}>
                      <div className="w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all bg-white"
                           style={{ left: startupData?.enabled ? 'calc(100% - 17px)' : '3px' }} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-[17px] font-semibold text-white/80">{t('App updates')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">
                        {t('Current version:')} <span className="font-mono text-white/50">v{versionData?.version ?? '…'}</span>
                        {versionData && !versionData.is_installed && <span className="ml-2 text-white/25">{t('(dev mode)')}</span>}
                      </div>
                    </div>
                    <button onClick={handleCheckUpdate}
                            disabled={['checking','downloading','installing'].includes(updateState)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 ml-4 disabled:opacity-50"
                            style={{ background: 'color-mix(in srgb, var(--c-accent) 20%, transparent)', color: '#B8B4F0', border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)' }}>
                      {updateState === 'checking' ? <><RefreshCw size={14} className="animate-spin" /> {t('Checking…')}</> : <><RefreshCw size={14} /> {t('Check for updates')}</>}
                    </button>
                  </div>
                  {updateState === 'up_to_date' && <div className="flex items-center gap-2 text-[16px]" style={{ color: 'var(--c-green-text)' }}><CheckCircle2 size={14} /> {t("You're on the latest version.")}</div>}
                  {updateState === 'available' && updateInfo && (
                    <div className="rounded-[8px] p-4 space-y-2" style={{ background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                      <div className="text-[17px] font-semibold" style={{ color: '#D0CEFD' }}>v{updateInfo.latest_version} {t('available')}</div>
                      {updateInfo.changelog && <div className="text-[16px] whitespace-pre-line text-white/45">{updateInfo.changelog}</div>}
                      <button onClick={handleInstallUpdate}
                              className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer mt-1"
                              style={{ background: 'color-mix(in srgb, var(--c-accent) 30%, transparent)', color: '#D0CEFD', border: '0.5px solid color-mix(in srgb, var(--c-accent) 50%, transparent)' }}>
                        <Download size={14} /> {t('Download & Install')}
                      </button>
                    </div>
                  )}
                  {(updateState === 'downloading' || updateState === 'installing') && (
                    <div className="space-y-2">
                      <div className="text-[16px] text-white/50">{updateState === 'installing' ? t('Launching installer — the app will close and restart…') : `${t('Downloading…')} ${updateProgress}%`}</div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${updateProgress}%`, background: 'color-mix(in srgb, var(--c-accent) 70%, transparent)' }} />
                      </div>
                    </div>
                  )}
                  {updateState === 'error' && <div className="flex items-center gap-2 text-[16px]" style={{ color: '#F4C0D1' }}><AlertCircle size={13} /> {updateError}</div>}
                </SettingsSection>

                <SettingsSection title={t('Changelog')} icon={ScrollText} accentColor="var(--c-accent)" defaultOpen={false}>
                  {!changelogData?.entries?.length && (
                    <div className="text-[16px] text-white/35">{t('No changelog history yet.')}</div>
                  )}
                  <div className="space-y-2">
                    {changelogData?.entries?.map((entry) => (
                      <ChangelogEntry key={entry.version} entry={entry} />
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Server')} icon={RefreshCw} accentColor="var(--c-amber)" defaultOpen={false}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[17px] font-semibold text-white/80">{t('Restart server')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Restarts the Python backend and waits for the replacement process to come back online.')}</div>
                    </div>
                    <button onClick={restartState === 'idle' ? handleRestart : undefined}
                            disabled={restartState === 'restarting'}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 ml-4 disabled:opacity-60"
                            style={restartState === 'done'
                              ? { background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)' }
                              : { background: 'color-mix(in srgb, var(--c-amber) 20%, transparent)', color: 'var(--c-amber-text)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 40%, transparent)' }}>
                      {restartState === 'restarting' ? <><RefreshCw size={14} className="animate-spin" /> {t('Restarting…')}</>
                       : restartState === 'done' ? <><Check size={14} /> {t('Back online')}</>
                       : <><RefreshCw size={14} /> {t('Restart server')}</>}
                    </button>
                  </div>
                </SettingsSection>

                <SettingsSection title={t('Factory reset')} icon={AlertCircle} accentColor="var(--c-pink)" defaultOpen={false}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[17px] font-semibold" style={{ color: 'rgba(244,192,209,0.9)' }}>{t('Restore defaults')}</div>
                      <div className="text-[16px] text-white/35 mt-0.5">{t('Wipe all galleries, creators, sessions, and cards for a clean start.')}</div>
                    </div>
                    <button onClick={() => setShowResetModal(true)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[16px] font-medium cursor-pointer flex-shrink-0 ml-4"
                            style={{ background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: '#F4C0D1', border: '0.5px solid color-mix(in srgb, var(--c-pink) 35%, transparent)' }}>
                      <AlertCircle size={14} /> {t('Reset collection')}
                    </button>
                  </div>
                </SettingsSection>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {folderPickerTarget && <FolderPicker onSelect={chooseSettingsFolder} onClose={() => setFolderPickerTarget(null)} />}

      {/* ── Factory reset confirmation modal ───────────────────────────────── */}
      {showResetModal && (
        <ModalLayer><div className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
             style={{ background: 'rgba(0,0,0,0.75)' }}
             onClick={resetState === 'idle' ? () => setShowResetModal(false) : undefined}>
          <div className="rounded-[16px] p-7 max-w-md w-full"
               style={{ background: '#1a1a1a', border: '1px solid color-mix(in srgb, var(--c-pink) 40%, transparent)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#F4C0D1', marginBottom: 10 }}>{t('Wipe entire collection?')}</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 16 }}>{t('This will permanently delete:')}</div>
            <ul style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8, marginBottom: 20, paddingLeft: 20 }}>
              <li>{t('All galleries and images')}</li>
              <li>{t('All creators and characters')}</li>
              <li>{t('All session history and stats')}</li>
              <li>{t('All cards, packs, and TCG progress')}</li>
              <li>{t('All XP, levels, and achievements')}</li>
            </ul>
            <div className="p-3 rounded-[8px] mb-6" style={{ background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#F4C0D1', marginBottom: 4 }}>{t('This cannot be undone.')}</div>
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>{t('The only way to recover your data is from a backup file. Use')} <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{t('Download backup')}</strong> {t('first if you want to keep a copy.')}</div>
            </div>
            <div className="flex gap-3">
              <button onClick={resetState === 'idle' ? handleReset : undefined} disabled={resetState !== 'idle'}
                      className="flex items-center gap-2 px-5 py-3 rounded-[8px] text-[15px] font-medium cursor-pointer disabled:opacity-50"
                      style={{ background: 'color-mix(in srgb, var(--c-pink) 30%, transparent)', color: '#FFD4E2', border: '0.5px solid color-mix(in srgb, var(--c-pink) 50%, transparent)' }}>
                {resetState === 'resetting' ? <><RefreshCw size={15} className="animate-spin" /> {t('Wiping & restarting…')}</> : t('💣 Yes, wipe everything')}
              </button>
              <button onClick={() => setShowResetModal(false)} disabled={resetState === 'resetting'}
                      className="flex-1 px-4 py-3 rounded-[8px] text-[15px] cursor-pointer disabled:opacity-40"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div></ModalLayer>
      )}

    </div>
  )
}
