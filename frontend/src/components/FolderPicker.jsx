import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronLeft, ChevronRight, FolderOpen, Loader2, X } from 'lucide-react'
import { relocateApi } from '../lib/api'
import { useT } from '../i18n'

const LAST_FOLDER_KEY = 'vault_last_folder_picker_location'

function startingPath(initialPath) {
  try { return localStorage.getItem(LAST_FOLDER_KEY) ?? initialPath ?? '' }
  catch { return initialPath || '' }
}

export default function FolderPicker({ initialPath = '', onSelect, onClose }) {
  const t = useT()
  const [path, setPath] = useState(() => startingPath(initialPath))
  const [address, setAddress] = useState(() => startingPath(initialPath))
  const history = useRef([path])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['relocate-directories', path],
    queryFn: () => relocateApi.directories(path).then(response => response.data),
  })

  useEffect(() => {
    if (typeof data?.path !== 'string') return
    try { localStorage.setItem(LAST_FOLDER_KEY, data.path) } catch { /* browsing still works without storage */ }
  }, [data])

  const navigate = nextPath => {
    const next = nextPath.trim()
    setAddress(next)
    if (next === path) return
    history.current = [...history.current.slice(0, historyIndex + 1), next]
    setHistoryIndex(history.current.length - 1)
    setPath(next)
  }

  const travel = direction => {
    const nextIndex = historyIndex + direction
    if (nextIndex < 0 || nextIndex >= history.current.length) return
    setHistoryIndex(nextIndex)
    setPath(history.current[nextIndex])
    setAddress(history.current[nextIndex])
  }

  const choose = async () => {
    if (!data?.path) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await onSelect(data.path)
      onClose()
    } catch (reason) {
      setSubmitError(reason?.response?.data?.detail || t('Could not choose this folder'))
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center p-6"
         style={{ background: 'rgba(0,0,0,0.75)' }} onMouseDown={event => event.stopPropagation()}>
      <div className="flex flex-col rounded-[16px] overflow-hidden"
           style={{ width: 560, maxWidth: '94vw', maxHeight: '78vh', background: 'var(--c-surface)', border: '1px solid rgba(255,255,255,0.14)' }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <FolderOpen size={20} color="var(--accent)" />
          <div className="flex-1 font-semibold" style={{ fontSize: 18 }}>{t('Choose destination folder')}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg" title={t('Close')}><X size={20} /></button>
        </div>
        <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={() => travel(-1)} disabled={historyIndex === 0} title={t('Back')} className="p-2 rounded-lg disabled:opacity-30 hover:bg-white/[0.07]"><ChevronLeft size={20} /></button>
          <button onClick={() => travel(1)} disabled={historyIndex >= history.current.length - 1} title={t('Forward')} className="p-2 rounded-lg disabled:opacity-30 hover:bg-white/[0.07]"><ChevronRight size={20} /></button>
          <input autoFocus value={address} onChange={event => setAddress(event.target.value)}
                 onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); navigate(address) } }}
                 aria-label={t('Folder address')} placeholder={t('This computer')}
                 className="flex-1 min-w-0 rounded-lg px-3 py-2 outline-none"
                 style={{ fontSize: 16, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }} />
          <button onClick={() => navigate(address)} className="px-3 py-2 rounded-lg" style={{ fontSize: 16, background: 'rgba(255,255,255,0.08)' }}>{t('Go')}</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3" style={{ fontSize: 16 }}>
          {isLoading || (isFetching && !data) ? <div className="flex justify-center p-6"><Loader2 className="animate-spin" /></div>
            : error ? <div className="p-3"><div role="alert" style={{ color: 'var(--c-pink)' }}>{error?.response?.data?.detail || (error?.message ? t(error.message) : t('Could not open this folder.'))}</div><button onClick={() => navigate('')} className="mt-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)' }}>{t('This computer')}</button></div>
            : <>
              {data && data.parent !== null && <button onClick={() => navigate(data.parent)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/[0.07]"><ArrowRight size={17} className="rotate-180" />{t('Up one folder')}</button>}
              {data?.folders?.map(folder => <button key={folder.path} onClick={() => navigate(folder.path)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/[0.07]"><FolderOpen size={17} /><span className="truncate">{folder.name}</span></button>)}
              {!data?.folders?.length && <div className="p-3" style={{ opacity: .6 }}>{t('No subfolders')}</div>}
            </>}
        </div>
        {submitError && <div role="alert" className="px-5 py-2" style={{ fontSize: 16, color: 'var(--c-pink)' }}>{submitError}</div>}
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg" style={{ fontSize: 16 }}>{t('Cancel')}</button>
          <button onClick={choose} disabled={!data?.path || address.trim() !== path || isFetching || !!error || submitting}
                  className="px-4 py-2 rounded-lg disabled:opacity-40" style={{ fontSize: 16, background: 'var(--accent)' }}>{submitting ? <Loader2 size={18} className="animate-spin" /> : t('Choose this folder')}</button>
        </div>
      </div>
    </div>, document.body
  )
}
