import { LocalizedText, useT } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Coins, HeartHandshake, LoaderCircle, RefreshCw } from 'lucide-react'
import { economyApi, tcgTradersApi } from '../../lib/api'
import { readableTraderError, TRADER_TABS } from './traderVNState'
import { CardsView, ConversationPanel, HistoryView, OffersPanel, RequestsView, TradeView } from './TraderVNViews'
import TraderVNGrading from './TraderVNGrading'
import { localCalendarDay, selectDailyTraderOutfit, traderVisualKey, TRADER_VISUALS } from './traderVisuals'

const getError = readableTraderError

export default function TraderVN({ onClose }) {
  const t = useT()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('trade')
  const [selected, setSelected] = useState([])
  const [gradeSelected, setGradeSelected] = useState([])
  const [gradeResults, setGradeResults] = useState({})
  const [targets, setTargets] = useState([])
  const [credits, setCredits] = useState('0')
  const [shards, setShards] = useState('0')
  const [requestCardId, setRequestCardId] = useState('')
  const [busy, setBusy] = useState('')
  const [refreshState, setRefreshState] = useState('')
  const busyRef = useRef(false)
  const refreshTimer = useRef(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [dayKey, setDayKey] = useState(() => localCalendarDay())
  const [portraitFailed, setPortraitFailed] = useState(false)
  const [previewProfile, setPreviewProfile] = useState(null)
  const [rosterOpen, setRosterOpen] = useState(false)
  const introStarted = useRef(false)
  const balanceQuery = useQuery({
    queryKey: ['economy-balance'],
    queryFn: () => economyApi.balance().then(response => response.data),
    staleTime: 10_000,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  })
  const creditsBalance = Number(balanceQuery.data?.vault_credits)
  const hasCreditsBalance = balanceQuery.isSuccess && Number.isFinite(creditsBalance)
  const balanceUnavailable = balanceQuery.isError || (balanceQuery.isSuccess && !Number.isFinite(creditsBalance))
  const visitQuery = useQuery({ queryKey: ['tcg-trader-current'], queryFn: () => tcgTradersApi.current().then(r => r.data), staleTime: 0, refetchOnMount: 'always', retryOnMount: true, refetchOnReconnect: true })
  const rosterQuery = useQuery({ queryKey: ['tcg-trader-roster'], queryFn: () => tcgTradersApi.roster().then(r => r.data), staleTime: 5 * 60_000 })
  const visit = visitQuery.data
  const visitId = visit?.visit_id
  const query = (name, fn, placeholder) => useQuery({
    queryKey: ['tcg-trader', name, visitId],
    queryFn: () => fn().then(r => r.data),
    enabled: Boolean(visitId),
    placeholderData: placeholder,
    staleTime: 0,
    refetchOnMount: 'always',
    retryOnMount: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: attempt => Math.min(500 * (2 ** attempt), 4000),
  })
  const dialogueQuery = query('dialogue', () => tcgTradersApi.dialogue(visitId), [])
  const inventoryQuery = query('inventory', () => tcgTradersApi.inventory(visitId), [])
  const candidatesQuery = query('candidates', () => tcgTradersApi.tradeCandidates(visitId), { items: [], policy: {} })
  const requestsQuery = query('requests', () => tcgTradersApi.requests(visitId), [])
  const offersQuery = query('offers', () => tcgTradersApi.offers(visitId), [])
  const historyQuery = useQuery({
    queryKey: ['tcg-trader-history'],
    queryFn: () => tcgTradersApi.history().then(r => r.data),
    placeholderData: [],
    staleTime: 0,
    refetchOnMount: 'always',
    retryOnMount: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: attempt => Math.min(500 * (2 ** attempt), 4000),
  })
  const allQueries = useMemo(() => [dialogueQuery, inventoryQuery, candidatesQuery, requestsQuery, offersQuery, historyQuery], [dialogueQuery, inventoryQuery, candidatesQuery, requestsQuery, offersQuery, historyQuery])
  const stateError = allQueries.find(item => item.isError)?.error

  const recoveredVisitRef = useRef(null)
  useEffect(() => {
    if (!visitId || recoveredVisitRef.current === visitId || !inventoryQuery.isFetched || !candidatesQuery.isFetched
      || inventoryQuery.isPlaceholderData || candidatesQuery.isPlaceholderData) return
    const inventoryRows = Array.isArray(inventoryQuery.data) ? inventoryQuery.data : []
    const candidateRows = Array.isArray(candidatesQuery.data?.items) ? candidatesQuery.data.items : []
    const needsRecovery = inventoryQuery.isError || candidatesQuery.isError || !inventoryRows.length || !candidateRows.length
    if (!needsRecovery) {
      recoveredVisitRef.current = visitId
      return
    }
    const timer = window.setTimeout(() => {
      if (recoveredVisitRef.current === visitId) return
      recoveredVisitRef.current = visitId
      void Promise.all([
        queryClient.refetchQueries({ queryKey: ['tcg-trader', 'inventory', visitId], exact: true, type: 'active' }),
        queryClient.refetchQueries({ queryKey: ['tcg-trader', 'candidates', visitId], exact: true, type: 'active' }),
      ])
    }, 250)
    return () => window.clearTimeout(timer)
  }, [visitId, inventoryQuery.data, inventoryQuery.isError, inventoryQuery.isFetched, inventoryQuery.isPlaceholderData, candidatesQuery.data, candidatesQuery.isError, candidatesQuery.isFetched, candidatesQuery.isPlaceholderData, queryClient])

  const refresh = useCallback(async () => {
    const results = await Promise.all([visitQuery.refetch(), ...allQueries.map(item => item.refetch())])
    const failed = results.find(result => result.isError)
    if (failed) throw failed.error
  }, [allQueries, visitQuery])
  const refreshManually = async () => {
    if (refreshState === 'loading' || busyRef.current) return
    setRefreshState('loading'); setError('')
    try {
      await refresh()
      setRefreshState('updated')
      window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(() => setRefreshState(''), 2400)
    } catch (caught) {
      setRefreshState('')
      setError(getError(caught))
    }
  }
  const run = useCallback(async (label, operation, reaction, refreshData = true) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label); setError('')
    try {
      await operation()
      if (reaction && visitId) await tcgTradersApi.respond(visitId, reaction)
      if (refreshData) {
        void queryClient.invalidateQueries({ queryKey: ['economy-balance'] })
        void queryClient.invalidateQueries({ queryKey: ['tcg-trader-barter-quote'] })
        void queryClient.invalidateQueries({ queryKey: ['tcg-trader-grade-quote'] })
        await refresh()
      }
    } catch (caught) { setError(getError(caught)) } finally { busyRef.current = false; setBusy('') }
  }, [queryClient, refresh, visitId])

  const sendDialogue = useCallback(async action => {
    if (!visitId) return
    const response = await tcgTradersApi.respond(visitId, action)
    if (Array.isArray(response.data)) {
      queryClient.setQueryData(['tcg-trader', 'dialogue', visitId], response.data)
    }
  }, [queryClient, visitId])

  useEffect(() => {
    if (previewProfile || !visitId || !dialogueQuery.isFetched || dialogueQuery.isFetching || introStarted.current || dialogueQuery.data.length) return
    introStarted.current = true
    run('Starting conversation', () => sendDialogue('intro'), null, false)
  }, [dialogueQuery.data.length, dialogueQuery.isFetched, dialogueQuery.isFetching, previewProfile, run, sendDialogue, visitId])

  const chooseTab = next => { setTab(next); setError('') }
  const toggleCopy = copyId => setSelected(current => current.includes(copyId) ? current.filter(id => id !== copyId) : [...current, copyId])
  const toggleTarget = inventoryId => setTargets(current => {
    const next = current.includes(String(inventoryId)) ? current.filter(id => id !== String(inventoryId)) : [...current, String(inventoryId)]
    if (!next.length) { setCredits('0'); setShards('0') }
    return next
  })
  const confirmAction = ({ title, message, confirmLabel = 'Confirm', details = [], action }) => {
    setError('')
    setConfirmation({ title, message, confirmLabel, details, action })
  }
  const performConfirmation = async () => {
    const pending = confirmation
    setConfirmation(null)
    if (pending?.action) await pending.action()
  }
  const accept = offer => confirmAction({
    title: 'Accept this deal?',
    message: 'The cards and currency shown will be transferred.',
    confirmLabel: 'Accept deal',
    action: () => run('Accepting offer', () => tcgTradersApi.accept(offer.id), 'accepted'),
  })
  const refuse = offer => confirmAction({
    title: 'Decline this deal?',
    message: 'She will take back the cards reserved for this offer.',
    confirmLabel: 'Decline offer',
    action: () => run('Declining offer', () => tcgTradersApi.refuse(offer.id), 'refuse'),
  })
  const close = () => onClose()

  useEffect(() => {
    if (!confirmation) return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') setConfirmation(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmation])

  useEffect(() => () => window.clearTimeout(refreshTimer.current), [])

  useEffect(() => {
    const timer = window.setInterval(() => setDayKey(localCalendarDay()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => { setPortraitFailed(false) }, [dayKey, previewProfile?.id])

  const roster = Array.isArray(rosterQuery.data) ? rosterQuery.data : rosterQuery.data?.traders || []
  const choosePreview = profile => { setPreviewProfile({ ...profile, preview_only: true }); setPortraitFailed(false); setRosterOpen(false) }
  const selector = <div className="trader-vn__roster-wrap">
    <button className="trader-vn__roster-toggle" onClick={() => setRosterOpen(open => !open)}><HeartHandshake /><LocalizedText text={"Meet the traders"} /></button>
    {rosterOpen && <div className="trader-vn__roster-menu" role="dialog" aria-label={t("Meet the traders") }>
      <strong><LocalizedText text={"Trader profiles"} /></strong>
      {rosterQuery.isLoading && <p><LocalizedText text={"Loading trader profiles…"} /></p>}
      {rosterQuery.isError && <p role="alert">{getError(rosterQuery.error)}</p>}
      {roster.map(profile => <button key={profile.id} onClick={() => choosePreview(profile)}><span>{profile.name}</span><small><LocalizedText text={"Age"} after={" "} />{profile.age}</small></button>)}
    </div>}
  </div>
  if (visitQuery.isLoading && !previewProfile) return <main className="trader-vn trader-vn--loading"><LoaderCircle className="spin" /><strong><LocalizedText text={"Meeting today’s trader…"} /></strong>{selector}<button onClick={onClose}><ArrowLeft /><LocalizedText text={"Return to room"} before={" "} /></button></main>
  if ((visitQuery.isError || !visit) && !previewProfile) return <main className="trader-vn trader-vn--loading"><strong><LocalizedText text={"Trader unavailable"} /></strong><p>{getError(visitQuery.error)}</p><button onClick={() => visitQuery.refetch()}><RefreshCw /><LocalizedText text={"Retry"} before={" "} /></button>{selector}<button onClick={onClose}><ArrowLeft /><LocalizedText text={"Return to room"} before={" "} /></button></main>

  const isProfilePreview = Boolean(previewProfile)
  const trader = previewProfile || visit.trader
  const visualKey = traderVisualKey(trader)
  const visual = TRADER_VISUALS[visualKey]
  const outfit = selectDailyTraderOutfit(visualKey || String(trader.id), visual?.outfits, new Date())
  const activeDay = isProfilePreview ? null : (visit.day_key || dayKey)
  const dailyFocus = isProfilePreview ? null : visit.focus
  const focusLikes = Array.isArray(dailyFocus?.likes) ? dailyFocus.likes : []
  const focusAvoids = Array.isArray(dailyFocus?.avoids) ? dailyFocus.avoids : []
  const focusAvailable = Array.isArray(dailyFocus?.likes) && Array.isArray(dailyFocus?.avoids)
  return <main className="trader-vn" data-trader={trader.id} data-visual={visualKey || 'default'} style={visual ? { '--trader-accent': visual.palette.accent, '--trader-accent-soft': visual.palette.accentSoft, '--trader-glow': visual.palette.glow, '--trader-surface': visual.palette.surface, '--trader-surface-raised': visual.palette.surfaceRaised, '--trader-text': visual.palette.text } : undefined}>
    <div className="trader-vn__backdrop" aria-hidden="true" />
    <header className="trader-vn__topbar"><button onClick={close}><ArrowLeft /><LocalizedText text={"Return to room"} before={" "} /></button><div><CalendarDays /><span>{isProfilePreview ? <LocalizedText text={"Trader profile preview"} /> : activeDay}</span></div><div className="trader-vn__top-actions">{!isProfilePreview && <div className="trader-vn__wallet" aria-live="polite">
      <Coins aria-hidden="true" />
      {balanceQuery.isLoading && <span><LocalizedText text={"Loading balance…"} /></span>}
      {balanceUnavailable && <><span><LocalizedText text={"Balance unavailable"} /></span><button type="button" className="trader-vn__wallet-retry" onClick={() => balanceQuery.refetch()}><LocalizedText text={"Retry"} /></button></>}
      {hasCreditsBalance && <strong>{creditsBalance.toLocaleString()}<LocalizedText text={"Credits"} before={" "} /></strong>}
    </div>}{isProfilePreview && <button onClick={() => { setPreviewProfile(null); setPortraitFailed(false) }}><ArrowLeft /><LocalizedText text={"Today’s trader"} before={" "} /></button>}{selector}{!isProfilePreview && <><button disabled={refreshState === 'loading' || Boolean(busy)} onClick={refreshManually}>{refreshState === 'loading' ? <LoaderCircle className="spin" /> : <RefreshCw />}<LocalizedText text={refreshState === 'loading' ? "Refreshing…" : refreshState === 'updated' ? "Updated" : "Refresh"} before={" "} /></button><span className="trader-vn__refresh-status" aria-live="polite">{refreshState === 'updated' ? <LocalizedText text={"Trade details updated."} /> : ''}</span></>}</div></header>
    <aside className="trader-vn__portrait">
      {outfit && !portraitFailed ? <img className="trader-vn__portrait-art" key={`${outfit.id}-${dayKey}`} src={outfit.src} alt={`${trader.name} portrait`} onError={() => setPortraitFailed(true)} /> : <div className="trader-vn__art-unavailable"><span>{trader.name.split(/\s+/).map(part => part[0]).join('').slice(0,2)}</span><p>{visual && !portraitFailed ? <LocalizedText text={"Character artwork is being prepared."} /> : <LocalizedText text={"Portrait artwork is not available yet."} />}</p></div>}
      <div className="trader-vn__identity"><span className="eyebrow"><LocalizedText text={isProfilePreview ? "TRADER PROFILE" : "TODAY’S TRADER"} /></span><h1>{trader.name}</h1><strong><LocalizedText text={"Age"} after={" "} />{trader.age}</strong><p>{trader.personality || trader.biography}</p></div>
      <div className="trader-vn__preferences"><strong><HeartHandshake /><LocalizedText text={"Daily focus"} /></strong>{isProfilePreview ? <p className="trader-vn__focus-explainer"><LocalizedText text={"Her focus will appear when she visits."} /></p> : focusAvailable && (focusLikes.length || focusAvoids.length) ? <><div><b><LocalizedText text={"Especially looking for"} /></b>{focusLikes.length ? focusLikes.map(item => <span key={`focus-like-${item}`}>{item}</span>) : <span><LocalizedText text={"Nothing in particular"} /></span>}</div><div><b><LocalizedText text={"Avoiding"} /></b>{focusAvoids.length ? focusAvoids.map(item => <span key={`focus-avoid-${item}`}>{item}</span>) : <span><LocalizedText text={"Nothing in particular"} /></span>}</div></> : <p className="trader-vn__focus-explainer"><LocalizedText text={"She hasn't picked anything in particular today."} /></p>}</div>
      {outfit && <div className="trader-vn__outfit"><span>{activeDay || dayKey}</span></div>}
    </aside>
    <section className={`trader-vn__desk${isProfilePreview ? ' is-preview' : ''}`}>
      {!isProfilePreview && <nav aria-label={t("Trader views")}>{TRADER_TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => chooseTab(id)}>{label}</button>)}</nav>}
      <div className="trader-vn__status"><HeartHandshake /><span><strong>{isProfilePreview ? 'Profile preview' : 'Trading active'}</strong>{!isProfilePreview && <>{visit.requests_remaining}<LocalizedText text={"requests remaining"} before={" "} /></>}</span></div>
      {error && <div className="trader-vn__error" role="alert"><strong><LocalizedText text={"That did not go through."} /></strong><span>{error}</span><button onClick={() => setError('')}><LocalizedText text={"Dismiss"} /></button></div>}
      {!isProfilePreview && !error && stateError && <div className="trader-vn__error" role="alert"><strong><LocalizedText text={"Some trade details could not be loaded."} /></strong><span>{getError(stateError)}</span><button onClick={refresh}><LocalizedText text={"Retry"} /></button></div>}
      {busy && <div className="trader-vn__busy"><LoaderCircle className="spin" /><span>{busy}…</span></div>}
      <div className={`trader-vn__content${isProfilePreview ? ' is-profile-preview' : ''}`}>
        {isProfilePreview && <section className="trader-vn-preview-note"><header><HeartHandshake /><div><h2><LocalizedText text={"Trader profile"} /></h2><p><LocalizedText text={"Trading is available when she visits."} /></p></div></header></section>}
        {!isProfilePreview && tab === 'cards' && <CardsView inventory={inventoryQuery.data} loading={inventoryQuery.isFetching && (inventoryQuery.isPlaceholderData || !inventoryQuery.data?.length)} onBuy={(id, currency, amount) => confirmAction({ title: 'Ask to buy this card?', message: `Ask her to sell this card for ${amount.toLocaleString()} ${currency === 'credits' ? 'Credits' : 'Shards'}?`, confirmLabel: 'Make offer', action: () => run('Making offer', () => tcgTradersApi.buyOffer(visitId, id, currency)) })} />}
        {!isProfilePreview && tab === 'trade' && <TradeView visitId={visitId} inventory={inventoryQuery.data} candidates={candidatesQuery.data?.items || []} candidatesLoading={candidatesQuery.isFetching && (candidatesQuery.isPlaceholderData || !candidatesQuery.data?.items?.length)} inventoryLoading={inventoryQuery.isFetching && (inventoryQuery.isPlaceholderData || !inventoryQuery.data?.length)} selected={selected} gradedCopies={gradeResults} onToggle={toggleCopy} targets={targets} onToggleTarget={toggleTarget} credits={credits} shards={shards} onMoney={(kind, value) => kind === 'credits' ? setCredits(value) : setShards(value)} busy={Boolean(busy)} onSell={currency => confirmAction({ title: 'Sell your selected cards?', message: `Offer ${selected.length} ${selected.length === 1 ? 'card' : 'cards'} for ${currency === 'credits' ? 'Credits' : 'Shards'}? She may accept or counter.`, confirmLabel: 'Make offer', action: () => run('Selling cards', async () => { await tcgTradersApi.sellQuote(visitId, selected, currency); setSelected([]) }, 'counter') })} onBarter={() => confirmAction({ title: 'Send this trade offer?', message: 'She will review your offer and the cards you requested.', confirmLabel: 'Propose trade', action: () => run('Sending offer', async () => { await tcgTradersApi.barterOffer(visitId, targets.map(Number), selected, Number(credits || 0), Number(shards || 0)); setSelected([]); setTargets([]); setCredits('0'); setShards('0') }, 'counter') })} />}
        {!isProfilePreview && tab === 'grading' && <TraderVNGrading visitId={visitId} candidates={candidatesQuery.data?.items || []} loading={candidatesQuery.isFetching && (candidatesQuery.isPlaceholderData || !candidatesQuery.data?.items?.length)} selected={gradeSelected} onToggle={copyId => setGradeSelected(current => current.includes(copyId) ? current.filter(id => id !== copyId) : [...current, copyId])} gradedCopies={gradeResults} busy={Boolean(busy)} onConfirmGrade={quote => confirmAction({ title: 'Grade these cards?', message: `This will save the previewed tiers for ${quote.items.length} ${quote.items.length === 1 ? 'card' : 'cards'} at a total cost of ${quote.total_fee_credits.toLocaleString()} Credits.`, confirmLabel: 'Confirm grading', details: quote.items, action: () => run('Grading cards', async () => { const response = await tcgTradersApi.grade(visitId, quote.items.map(item => Number(item.copy_id))); const items = Array.isArray(response.data?.items) ? response.data.items : []; setGradeResults(current => ({ ...current, ...Object.fromEntries(items.filter(item => item?.grade).map(item => [item.copy_id, item])) })); await queryClient.invalidateQueries({ queryKey: ['tcg-trader-grade-quote', visitId] }) }) })} />}
        {!isProfilePreview && tab === 'requests' && <RequestsView visit={visit} requests={requestsQuery.data} cardId={requestCardId} onCardId={setRequestCardId} onRequest={() => confirmAction({ title: 'Request this card?', message: `Use one of your remaining requests for ${requestCardId}?`, confirmLabel: 'Request card', action: () => run('Requesting card', () => tcgTradersApi.requestCard(visitId, requestCardId), 'requests') })} />}
        {!isProfilePreview && tab === 'history' && <HistoryView history={historyQuery.data} />}
      </div>
      {!isProfilePreview && <OffersPanel offers={offersQuery.data} onAccept={accept} onRefuse={refuse} busy={Boolean(busy)} />}
    </section>
    <ConversationPanel visit={isProfilePreview ? trader : visit} messages={dialogueQuery.data} onDialogue={action => !isProfilePreview && run('Sending message', () => sendDialogue(action), null, false)} busy={Boolean(busy)} />
    {confirmation && <div className="trader-vn-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setConfirmation(null) }}>
      <section className="trader-vn-confirm" role="dialog" aria-modal="true" aria-labelledby="trader-vn-confirm-title" aria-describedby="trader-vn-confirm-message">
        <h2 id="trader-vn-confirm-title"><LocalizedText text={confirmation.title} /></h2>
        <p id="trader-vn-confirm-message"><LocalizedText text={confirmation.message} /></p>
        {confirmation.details?.length > 0 && <ul>{confirmation.details.map(item => <li key={item.copy_id}>
          <span>{item.name || item.catalog_code || `Card #${item.card_id}`}</span>
          <strong><LocalizedText text={item.grade} /><LocalizedText text={" tier · "} />{item.already_graded ? <LocalizedText text={"Already graded · 0 Credits"} /> : <><LocalizedText text={item.fee_credits.toLocaleString()} /><LocalizedText text={" Credits"} before={" "} /></>}</strong>
        </li>)}</ul>}
        <footer><button type="button" onClick={() => setConfirmation(null)}><LocalizedText text={"Cancel"} /></button><button type="button" className="primary" disabled={Boolean(busy)} onClick={performConfirmation}><LocalizedText text={confirmation.confirmLabel} /></button></footer>
      </section>
    </div>}
  </main>
}
