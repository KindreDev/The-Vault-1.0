import { LocalizedText, useT } from '../i18n'
import { lazy, Suspense } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Download, LoaderCircle, RefreshCw, Trash2, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'

import { tcgRoomModuleApi } from '../lib/api'
import './TCGRoomModule.css'

const ACTIVE_PHASES = new Set(['preparing', 'downloading', 'verifying', 'promoting'])
const TCGRoomRuntime = lazy(() => import('../components/tcg-room/TCGRoomRuntime'))

export default function TCGRoomModule() {
  const t = useT()
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: ['tcg-room-module'],
    queryFn: () => tcgRoomModuleApi.status().then(response => response.data),
    refetchInterval: query => ACTIVE_PHASES.has(query.state.data?.phase) ? 750 : false,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tcg-room-module'] })
  const action = useMutation({
    mutationFn: ({ name, version }) => name === 'uninstall'
      ? tcgRoomModuleApi.uninstall(version)
      : name === 'repair' ? tcgRoomModuleApi.repair(version) : tcgRoomModuleApi[name](),
    onSuccess: refresh,
    onError: error => toast.error(error.response?.data?.detail || t("Room module operation failed")),
  })
  const data = statusQuery.data
  const running = ACTIVE_PHASES.has(data?.phase)
  const installed = data?.installed_versions || []
  const progress = data?.bytes_total ? Math.min(100, Math.round(data.bytes_done / data.bytes_total * 100)) : 0
  const ready = installed.find(item => item.verified)

  if (ready) return <Suspense fallback={<main className="tcg-room tcg-room--booting" style={{ background: '#12111a' }}><div className="tcg-room__boot" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center' }}><i className="tcg-room__boot-mark" /></div></main>}><TCGRoomRuntime version={ready.version} /></Suspense>

  return <main className="tcg-room-module">
    <header>
      <Link to="/collection"><ArrowLeft size={20} /><LocalizedText text={"Card Collection"} before={" "} /></Link>
      <span><LocalizedText text={"OPTIONAL MODULE"} /></span>
      <h1><LocalizedText text={"Collection Room"} /></h1>
      <p><LocalizedText text={"The first-person room is installed separately so its models, textures, audio, and environment data never inflate the base Vault installation."} /></p>
    </header>

    {statusQuery.isLoading && <section className="tcg-room-module__panel"><LoaderCircle className="spin" /><strong><LocalizedText text={"Checking room module"} /></strong></section>}
    {statusQuery.isError && <section className="tcg-room-module__panel error"><strong><LocalizedText text={"Module status unavailable"} /></strong><button onClick={() => statusQuery.refetch()}><LocalizedText text={"Retry"} /></button></section>}
    {data && <section className="tcg-room-module__panel">
      <div className="tcg-room-module__status">
        <div><span><LocalizedText text={"Available version"} /></span><strong>{data.available_version}</strong></div>
        <div><span><LocalizedText text={"Room assets"} /></span><strong>{data.asset_count}</strong></div>
        <div><span><LocalizedText text={"Material sets"} /></span><strong>{data.material_count}</strong></div>
      </div>

      {running && <div className="tcg-room-module__progress" role="status" aria-live="polite">
        <div><strong>{data.phase === 'downloading' ? 'Downloading room data' : `${data.phase[0].toUpperCase()}${data.phase.slice(1)}`}</strong><span>{progress}%</span></div>
        <div className="tcg-room-module__bar"><i style={{ width: `${progress}%` }} /></div>
        <p>{data.current_file || t('{done} of {total} files', { done: data.files_done, total: data.files_total })}</p>
        <button onClick={() => action.mutate({ name: 'cancel' })}><LocalizedText text={"Cancel"} /></button>
      </div>}

      {!data.available && !installed.length && <div className="tcg-room-module__notice">
        <Wrench size={24} /><div><strong><LocalizedText text={"Asset package is not published yet"} /></strong><p><LocalizedText text={"The installer and verification pipeline are ready. The room becomes downloadable after the Blender-produced package receives its verified manifest."} /></p></div>
      </div>}

      {data.error && <p className="tcg-room-module__error">{data.error}</p>}

      <div className="tcg-room-module__actions">
        {!installed.length && <button disabled={!data.available || running || action.isPending} onClick={() => action.mutate({ name: 'download' })}><Download size={19} /><LocalizedText text={"Download module"} before={" "} /></button>}
        {installed.length > 0 && <button disabled={running || action.isPending} onClick={() => action.mutate({ name: 'update' })}><RefreshCw size={19} /><LocalizedText text={"Check and update"} before={" "} /></button>}
        {installed.length > 0 && <button disabled={running || action.isPending} onClick={() => action.mutate({ name: 'repair', version: installed[0].version })}><Wrench size={19} /><LocalizedText text={"Repair"} before={" "} /></button>}
      </div>

      {installed.map(item => <article key={item.version} className="tcg-room-module__installed">
        <div>{item.verified ? <CheckCircle2 size={22} /> : <Wrench size={22} />}<span><strong><LocalizedText text={"Version"} after={" "} />{item.version}</strong><small>{item.verified ? 'Verified and ready' : 'Needs repair'}</small></span></div>
        <button disabled={running || action.isPending} onClick={() => action.mutate({ name: 'uninstall', version: item.version })}><Trash2 size={18} /><LocalizedText text={"Uninstall"} before={" "} /></button>
      </article>)}
    </section>}
  </main>
}
