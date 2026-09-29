import { LocalizedText, useT } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, HeartHandshake, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { tcgTradersApi } from '../../lib/api'
import { TRADER_TABS, traderGate } from './traderVNState'
import { CardsView, DialogueView, HistoryView, OffersPanel, RequestsView, SellView, TradeView } from './TraderVNViews'

const ACTION_BY_TAB = { cards: 'browse', sell: 'sell', trade: 'trade', requests: 'requests' }
const getError = error => error?.response?.data?.detail || error?.message || 'The saved trader state could not be updated.'

export default function TraderVN({ onClose }) {
  const t = useT()
  const [tab, setTab] = useState('dialogue')
  const [selected, setSelected] = useState([])
  const [target, setTarget] = useState('')
  const [credits, setCredits] = useState('0')
  const [shards, setShards] = useState('0')
  const [requestCardId, setRequestCardId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const introStarted = useRef(false)
  const lastTabAction = useRef('')
  const visitQuery = useQuery({ queryKey: ['tcg-trader-current'], queryFn: () => tcgTradersApi.current().then(r => r.data), staleTime: 30_000 })
  const visit = visitQuery.data
  const visitId = visit?.visit_id
  const query = (name, fn, fallback) => useQuery({ queryKey: ['tcg-trader', name, visitId], queryFn: () => fn().then(r => r.data), enabled: Boolean(visitId), initialData: fallback })
  const dialogueQuery = query('dialogue', () => tcgTradersApi.dialogue(visitId), [])
  const inventoryQuery = query('inventory', () => tcgTradersApi.inventory(visitId), [])
  const candidatesQuery = query('candidates', () => tcgTradersApi.tradeCandidates(visitId), { items: [], policy: {} })
  const requestsQuery = query('requests', () => tcgTradersApi.requests(visitId), [])
  const offersQuery = query('offers', () => tcgTradersApi.offers(visitId), [])
  const historyQuery = useQuery({ queryKey: ['tcg-trader-history'], queryFn: () => tcgTradersApi.history().then(r => r.data), initialData: [] })
  const allQueries = useMemo(() => [dialogueQuery, inventoryQuery, candidatesQuery, requestsQuery, offersQuery, historyQuery], [dialogueQuery, inventoryQuery, candidatesQuery, requestsQuery, offersQuery, historyQuery])
  const stateError = allQueries.find(item => item.isError)?.error

  const refresh = useCallback(async () => { await Promise.all(allQueries.map(item => item.refetch())) }, [allQueries])
  const run = useCallback(async (label, operation, reaction) => {
    setBusy(label); setError('')
    try {
      await operation()
      if (reaction && visitId) await tcgTradersApi.respond(visitId, reaction)
      await refresh()
    } catch (caught) { setError(getError(caught)) } finally { setBusy('') }
  }, [refresh, visitId])

  useEffect(() => {
    if (!visitId || !dialogueQuery.isFetched || dialogueQuery.isFetching || introStarted.current || dialogueQuery.data.length) return
    introStarted.current = true
    run('Introducing visitor', () => tcgTradersApi.respond(visitId, 'intro'))
  }, [dialogueQuery.data.length, dialogueQuery.isFetched, dialogueQuery.isFetching, run, visitId])

  const chooseTab = next => {
    setTab(next); setError('')
    const action = ACTION_BY_TAB[next]
    if (action && action !== lastTabAction.current) {
      lastTabAction.current = action
      run('Saving conversation', () => tcgTradersApi.respond(visitId, action))
    }
  }
  const toggleCopy = copyId => setSelected(current => current.includes(copyId) ? current.filter(id => id !== copyId) : current.length < 5 ? [...current, copyId] : current)
  const confirmAction = (message, action) => window.confirm(message) && action()
  const accept = offer => confirmAction('Accept this persisted deal? The exchange and ledger will settle atomically.', () => run('Settling deal', () => tcgTradersApi.accept(offer.id), 'accepted'))
  const refuse = offer => confirmAction('Refuse this deal? Reserved cards will return to their prior locations.', () => run('Refusing deal', () => tcgTradersApi.refuse(offer.id), 'refuse'))
  const close = () => {
    if (visitId) tcgTradersApi.respond(visitId, 'goodbye').catch(() => {})
    onClose()
  }

  if (visitQuery.isLoading) return <main className="trader-vn trader-vn--loading"><LoaderCircle className="spin" /><strong><LocalizedText text={"Opening this week’s visit…"} /></strong><span><LocalizedText text={"The saved visitor and conversation are not being rerolled."} /></span></main>
  if (visitQuery.isError || !visit) return <main className="trader-vn trader-vn--loading"><strong><LocalizedText text={"Visitor unavailable"} /></strong><p>{getError(visitQuery.error)}</p><button onClick={() => visitQuery.refetch()}><RefreshCw /><LocalizedText text={"Retry"} before={" "} /></button><button onClick={onClose}><ArrowLeft /><LocalizedText text={"Return to room"} before={" "} /></button></main>

  const trader = visit.trader
  const gate = traderGate(visit)
  return <main className="trader-vn" data-trader={trader.id}>
    <div className="trader-vn__backdrop" aria-hidden="true" />
    <header className="trader-vn__topbar"><button onClick={close}><ArrowLeft /><LocalizedText text={"Return to room"} before={" "} /></button><div><CalendarDays /><span>{visit.week_key}<LocalizedText text={"· saved weekly visitor"} before={" "} /></span></div><button onClick={refresh}><RefreshCw /><LocalizedText text={"Refresh"} before={" "} /></button></header>
    <aside className="trader-vn__portrait">
      <div className="trader-vn__placeholder" data-portrait={trader.id}><span>{trader.name.split(' ').map(word => word[0]).join('')}</span></div>
      <div className="trader-vn__identity"><span className="eyebrow"><LocalizedText text={"WEEKLY VISITOR"} /></span><h1>{trader.name}</h1><strong><LocalizedText text={"Adult · Age"} after={" "} />{trader.age}</strong><p>{trader.personality}</p></div>
      <div className="trader-vn__manifest"><ShieldCheck /><span><LocalizedText text={"Replaceable temporary portrait"} /></span><small><LocalizedText text={"Final local artwork will be supplied later."} /></small></div>
    </aside>
    <section className="trader-vn__desk">
      <nav aria-label={t("Trader views")}>{TRADER_TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => chooseTab(id)}>{label}</button>)}</nav>
      <div className="trader-vn__status"><HeartHandshake /><span><strong>{gate.locked ? 'Conversation-only preview' : 'Trading active'}</strong>{visit.requests_remaining}<LocalizedText text={"requests remaining · visit seed frozen"} before={" "} /></span></div>
      {error && <div className="trader-vn__error" role="alert"><strong><LocalizedText text={"That did not go through."} /></strong><span>{error}</span><button onClick={() => setError('')}><LocalizedText text={"Dismiss"} /></button></div>}
      {!error && stateError && <div className="trader-vn__error" role="alert"><strong><LocalizedText text={"Some saved details did not load."} /></strong><span>{getError(stateError)}</span><button onClick={refresh}><LocalizedText text={"Retry"} /></button></div>}
      {busy && <div className="trader-vn__busy"><LoaderCircle className="spin" /><span>{busy}…</span></div>}
      <div className="trader-vn__content">
        {tab === 'dialogue' && <DialogueView visit={visit} messages={dialogueQuery.data} onDialogue={action => run('Saving response', () => tcgTradersApi.respond(visitId, action))} />}
        {tab === 'cards' && <CardsView visit={visit} inventory={inventoryQuery.data} onBuy={(id, currency) => confirmAction(`Create a fixed ${currency} offer for this card?`, () => run('Creating offer', () => tcgTradersApi.buyOffer(visitId, id, currency), 'counter'))} />}
        {tab === 'sell' && <SellView visit={visit} candidates={candidatesQuery.data.items} policy={candidatesQuery.data.policy} selected={selected} onToggle={toggleCopy} onQuote={currency => confirmAction(`Reserve ${selected.length} selected duplicate ${selected.length === 1 ? 'copy' : 'copies'} for a fixed ${currency} quote?`, () => run('Creating sell quote', () => tcgTradersApi.sellQuote(visitId, selected, currency), 'counter'))} />}
        {tab === 'trade' && <TradeView visit={visit} inventory={inventoryQuery.data} candidates={candidatesQuery.data.items} selected={selected} onToggle={toggleCopy} target={target} onTarget={setTarget} credits={credits} shards={shards} onMoney={(kind, value) => kind === 'credits' ? setCredits(value) : setShards(value)} onBarter={() => confirmAction('Persist this barter proposal and reserve both sides?', () => run('Checking barter', () => tcgTradersApi.barterOffer(visitId, Number(target), selected, Number(credits || 0), Number(shards || 0)), 'counter'))} />}
        {tab === 'requests' && <RequestsView visit={visit} requests={requestsQuery.data} cardId={requestCardId} onCardId={setRequestCardId} onRequest={() => confirmAction('Use one persisted request for this published card? The result cannot be rerolled.', () => run('Making request', () => tcgTradersApi.requestCard(visitId, Number(requestCardId)), 'requests'))} />}
        {tab === 'history' && <HistoryView history={historyQuery.data} />}
      </div>
      <OffersPanel offers={offersQuery.data} onAccept={accept} onRefuse={refuse} />
    </section>
  </main>
}
