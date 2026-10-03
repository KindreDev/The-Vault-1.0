import { LocalizedText } from '../../i18n'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Check, History, MessageCircle, Search, Sparkles, X } from 'lucide-react'
import { tcgTradersApi } from '../../lib/api'
import TraderCardPreview from './TraderCardPreview'
import TraderCardPages, { useTraderPage } from './TraderCardPages'
import { offerSummary } from './traderVNState'

function Empty({ children }) { return <div className="trader-vn-empty"><Sparkles size={28} /><p>{children}</p></div> }

const RARITY_RANK = Object.freeze({ C: 0, R: 1, SR: 2, UR: 3, SPR: 4 })
export const GRADE_FEE_BY_RARITY = Object.freeze({ C: 100, R: 200, SR: 400, UR: 800, SPR: 1600 })

const cardRarity = item => String(
  item?.rarity || item?.print_rarity || item?.rarity_class
  || item?.valuation?.inputs?.rarity || item?.valuation?.rarity || 'C',
).toUpperCase()

export function sortByRarity(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({ item, index })).sort((left, right) => {
    const rankDifference = (RARITY_RANK[cardRarity(right.item)] ?? -1) - (RARITY_RANK[cardRarity(left.item)] ?? -1)
    return rankDifference || left.index - right.index
  }).map(entry => entry.item)
}

const flattenSearchValue = value => {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap(flattenSearchValue)
  if (typeof value === 'object') return Object.values(value).flatMap(flattenSearchValue)
  return typeof value === 'string' || typeof value === 'number' ? [String(value)] : []
}

export function matchesCardSearch(item, term, details = {}) {
  if (!term) return true
  const searchFields = [
    item?.search_text, item?.catalog_code, item?.release_code, item?.card_id,
    item?.copy_id, item?.inventory_id, item?.id, item?.title, item?.display_title,
    item?.display_name, item?.card_name, item?.card_type, item?.type, item?.rarity,
    item?.tags, item?.tag_names, item?.creator_name, item?.linked_creator_name,
    item?.linked_creator, item?.linked_creators, item?.subjects,
    details?.search_text, details?.catalog_code, details?.stable_card_id,
    details?.display_title, details?.display_name, details?.name,
    details?.creator_name, details?.character_name, details?.gallery_name,
    details?.card_type, details?.creator_type, details?.tags, details?.tag_names,
    details?.subjects, details?.collab_data,
  ]
  return flattenSearchValue(searchFields).join(' ').toLocaleLowerCase().includes(term)
}

const tierText = grade => grade ? <><LocalizedText text={grade} /><LocalizedText text={" tier"} /></> : null

const PLAYER_QUESTIONS = Object.freeze({
  like: 'What kinds of cards do you collect?',
  dislike: 'Are there any cards you prefer to avoid?',
})

export function DialogueView({ visit, messages, onDialogue, compact = false, busy = false }) {
  const logRef = useRef(null)
  const messageRows = Array.isArray(messages) ? messages : []
  const displayedMessages = messageRows.flatMap((message, index) => {
    const role = message?.role === 'user' ? 'user' : 'trader'
    const question = PLAYER_QUESTIONS[message?.action]
    const previous = messageRows[index - 1]
    const alreadyPaired = previous?.role === 'user' && previous.action === message?.action
    if (role === 'trader' && question && !alreadyPaired) {
      return [{ role: 'user', action: message.action, text: question }, message]
    }
    return [message]
  })
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [displayedMessages.length, displayedMessages[displayedMessages.length - 1]?.text])
  return <section className={`trader-vn-view trader-vn-dialogue${compact ? ' trader-vn-dialogue--compact' : ''}`}>
    <header><MessageCircle /><div><h2><LocalizedText text={"Conversation"} /></h2><p><LocalizedText text={"Ask what she is looking for today."} /></p></div></header>
    <div className="trader-vn-dialogue__log" ref={logRef}>
      {displayedMessages.length ? displayedMessages.map((message, index) => {
        const role = message?.role === 'user' ? 'user' : 'trader'
        return <article className={`trader-vn-dialogue__message is-${role}`} key={`${role}-${message.action || 'message'}-${index}`}><span>{role === 'user' ? <LocalizedText text={"You"} /> : visit.trader?.name || visit.name}</span><p>{message.text}</p></article>
      }) : <Empty><LocalizedText text={"She is waiting for you to speak."} /></Empty>}
    </div>
    <div className="trader-vn-dialogue__choices">
      <button disabled={busy} onClick={() => onDialogue('like')}><LocalizedText text={"Ask what cards she collects"} /></button>
      <button disabled={busy} onClick={() => onDialogue('dislike')}><LocalizedText text={"Ask which cards she avoids"} /></button>
    </div>
  </section>
}

export function ConversationPanel({ visit, messages, onDialogue, busy = false }) {
  if (visit?.preview_only) return <aside className="trader-vn__conversation"><section className="trader-vn-view trader-vn-preview-note"><header><MessageCircle /><div><h2><LocalizedText text={"Conversation"} /></h2><p><LocalizedText text={"You can chat when she visits."} /></p></div></header><article><strong>{visit.name}</strong><p>{visit.personality || visit.biography}</p></article></section></aside>
  return <aside className="trader-vn__conversation">
    <DialogueView visit={visit} messages={messages} onDialogue={onDialogue} compact busy={busy} />
  </aside>
}

export function CardsView({ inventory, onBuy, loading = false }) {
  const inventoryRows = Array.isArray(inventory) ? inventory : []
  const sortedInventory = sortByRarity(inventoryRows)
  return <section className="trader-vn-view"><header><Sparkles /><div><h2><LocalizedText text={"Her Cards"} /></h2><p><LocalizedText text={"Cards she is offering today."} /></p></div></header>
    {loading && !inventoryRows.length && <Empty><LocalizedText text={"Loading her cards…"} /></Empty>}
    {!loading && !inventoryRows.length && <Empty><LocalizedText text={"She has no cards to offer today."} /></Empty>}
    <div className="trader-vn-card-grid">{sortedInventory.map(item => <article key={item.id}><TraderCardPreview cardId={item.card_id} />{item.unavailable_reason && <p role="status">{item.unavailable_reason}</p>}<p className="trader-vn-card-price">{item.credits.toLocaleString()}<LocalizedText text={"Credits ·"} before={" "} after={" "} />{item.shards.toLocaleString()}<LocalizedText text={"Shards"} before={" "} /></p><div className="trader-vn-card-actions"><button disabled={!item.available} onClick={() => onBuy(item.id, 'credits', item.credits)}><LocalizedText text={"Buy with Credits"} /></button><button disabled={!item.available} onClick={() => onBuy(item.id, 'shards', item.shards)}><LocalizedText text={"Buy with Shards"} /></button></div></article>)}</div>
  </section>
}

export function TradeCardOption({ cardId, selected, disabled = false, onClick, children }) {
  return <button type="button" className={`trader-vn-card-option${selected ? ' selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>
    <TraderCardPreview cardId={cardId} />
    <div className="trader-vn-card-option__details">{children}</div>
    {selected && <Check className="trader-vn-card-option__check" size={20} />}
  </button>
}

const validMoneyAmount = value => {
  const text = String(value ?? '').trim()
  if (!text) return true
  const amount = Number(text)
  return Number.isFinite(amount) && Number.isInteger(amount) && amount >= 0
}

const quoteNumber = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

export function TradeView({ visitId, inventory, candidates, candidatesLoading = false, inventoryLoading = false, selected, gradedCopies = {}, onToggle, targets, onToggleTarget, credits, shards, onMoney, busy = false, onBarter, onSell }) {
  const [search, setSearch] = useState('')
  const allInventory = Array.isArray(inventory) ? inventory : []
  const allCandidates = Array.isArray(candidates) ? candidates : []
  const availableInventory = sortByRarity(allInventory.filter(row => row.available > 0))
  const selectedTargets = availableInventory.filter(row => targets.includes(String(row.id)))
  const sortedCandidates = sortByRarity(allCandidates)
  const selectedCopyIds = allCandidates.filter(item => selected.includes(item.copy_id)).map(item => item.copy_id)
  const inventoryIds = selectedTargets.map(row => Number(row.id)).sort((a, b) => a - b)
  const copyIds = [...selectedCopyIds].sort((a, b) => a - b)
  const selectedCopies = allCandidates.filter(item => selected.includes(item.copy_id))
  const searchTerm = search.trim().toLocaleLowerCase()
  const matchesSearch = item => matchesCardSearch(item, searchTerm)
  const filteredCandidates = sortedCandidates.filter(matchesSearch)
  const filteredInventory = availableInventory.filter(matchesSearch)
  const candidatePage = useTraderPage(filteredCandidates, `${visitId}:${searchTerm}`)
  const inventoryPage = useTraderPage(filteredInventory, `${visitId}:${searchTerm}`)
  const moneyIsValid = validMoneyAmount(credits) && validMoneyAmount(shards)
  const creditAmount = moneyIsValid && selectedTargets.length ? Number(credits || 0) : 0
  const shardAmount = moneyIsValid && selectedTargets.length ? Number(shards || 0) : 0
  const quoteEnabled = Boolean(visitId) && moneyIsValid
  const quoteQuery = useQuery({
    queryKey: ['tcg-trader-barter-quote', visitId, inventoryIds.join(','), copyIds.join(','), creditAmount, shardAmount],
    queryFn: () => tcgTradersApi.barterQuote(visitId, inventoryIds, copyIds, creditAmount, shardAmount).then(response => response.data),
    enabled: quoteEnabled,
    staleTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const quote = quoteQuery.data
  const offerValue = quoteNumber(quote?.offer_value_units)
  const minimum = quoteNumber(quote?.required_value_units)
  const shortfall = quoteNumber(quote?.shortfall_units)
  const payoutAmount = quoteNumber(quote?.payout_amount)
  const payoutCurrency = quote?.payout_currency === 'credits' ? 'Credits' : quote?.payout_currency === 'shards' ? 'Shards' : null
  const quoteIsValid = quoteEnabled && quoteQuery.isSuccess && !quoteQuery.isError && !quoteQuery.isFetching && offerValue !== null
  const comparisonIsValid = inventoryIds.length > 0 && quoteIsValid
    && minimum !== null && shortfall !== null && typeof quote?.meets_minimum === 'boolean'
  const hasOffer = copyIds.length > 0 || creditAmount > 0 || shardAmount > 0
  const isBusyQuote = quoteEnabled && quoteQuery.isFetching
  const selectedCardValues = selectedCopies.map(item => quoteNumber(item.barter_value_units))
  const candidateValuesReady = selectedCopies.length === selected.length && selectedCardValues.every(value => value !== null)
  const liveOfferValue = moneyIsValid && candidateValuesReady
    ? selectedCardValues.reduce((total, value) => total + value, 0) + creditAmount / 10 + shardAmount / 2.5
    : null
  const visibleOfferValue = liveOfferValue ?? (quoteIsValid ? offerValue : null)
  const quoteMessage = !moneyIsValid
      ? <LocalizedText text={"Enter a whole number of Credits or Shards."} />
      : !selectedTargets.length
        ? liveOfferValue === null
          ? isBusyQuote ? <LocalizedText text={"Loading card values…"} /> : <LocalizedText text={"Card values are unavailable."} />
          : <LocalizedText text={"Choose one or more of her cards to see the minimum."} />
        : isBusyQuote
          ? <LocalizedText text={"Checking her minimum…"} />
          : !quoteIsValid
            ? <><LocalizedText text={"Trade value is unavailable."} /> <button type="button" className="trader-vn-quote-retry" onClick={() => quoteQuery.refetch()}><LocalizedText text={"Try again"} /></button></>
            : !comparisonIsValid
              ? <LocalizedText text={"Her minimum is unavailable. Refresh and try again."} />
              : !hasOffer
                ? <LocalizedText text={"Choose cards to offer or add Credits or Shards."} />
                : quote.meets_minimum
                  ? <LocalizedText text={"This offer meets her minimum."} />
                  : shortfall > 0
                    ? <><LocalizedText text={"Add"} /> {shortfall.toLocaleString(undefined, { maximumFractionDigits: 1 })} <LocalizedText text={"more value to meet her minimum."} before={" "} /></>
                    : <LocalizedText text={"This offer is below her minimum."} />
  const quoteTone = comparisonIsValid && hasOffer && quote.meets_minimum ? 'is-enough' : comparisonIsValid && hasOffer ? 'is-gap' : ''
  const payoutMessage = comparisonIsValid && hasOffer && quote.meets_minimum && payoutCurrency && payoutAmount !== null
    && payoutAmount > 0
    ? <><LocalizedText text={"She’d add"} /> {payoutAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} {payoutCurrency} <LocalizedText text={"for the difference."} before={" "} /></>
    : null
  return <section className="trader-vn-view trader-vn-trade">
    <header><ArrowLeftRight /><div><h2><LocalizedText text={"Trade cards"} /></h2><p><LocalizedText text={"Offer cards or currency for any cards you want."} /></p></div></header>
      <label className="trader-vn-trade-search"><span><LocalizedText text={"Search cards"} /></span><div><Search aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Card code, title, creator, type, or tag" /></div></label>
      <div className="trader-vn-value-summary" aria-live="polite">
        <div><span><LocalizedText text={"Value"} /></span><strong>{visibleOfferValue === null ? '—' : visibleOfferValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></div>
        <ArrowLeftRight aria-hidden="true" />
        <div><span><LocalizedText text={"Her minimum"} /></span><strong>{comparisonIsValid ? minimum.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</strong></div>
        <p className={quoteTone}>{quoteMessage}</p>
        {payoutMessage && <p className="trader-vn-value-summary__payout">{payoutMessage}</p>}
      </div>
      <div className="trader-vn-offer-pair">
        <section className="trader-vn-offer-side"><header><div><h3><LocalizedText text={"Your Offer"} /></h3><span>{selectedCopyIds.length}<LocalizedText text={selectedCopyIds.length === 1 ? " card selected" : " cards selected"} before={" "} /></span></div></header>
          <div className="trader-vn-card-options" aria-label="Your cards">
            {filteredCandidates.length ? candidatePage.items.map(item => {
              const isSelected = selected.includes(item.copy_id)
              const individualValue = quoteNumber(item.barter_value_units)
              const grade = item.grade || gradedCopies[item.copy_id]?.grade
              const isGraded = Boolean(item.is_graded || gradedCopies[item.copy_id])
              return <TradeCardOption key={item.copy_id} cardId={item.card_id} selected={isSelected} onClick={() => onToggle(item.copy_id)}>
                {isGraded && <span className="trader-vn-card-option__grade">{grade ? <>{tierText(grade)}<LocalizedText text={" · graded"} /></> : <LocalizedText text={"Graded"} />}</span>}
                <span className="trader-vn-card-option__value">{individualValue === null ? <LocalizedText text={"Value unavailable"} /> : <><LocalizedText text={"Value"} after={" "} />{individualValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}</>}</span>
              </TradeCardOption>
            }) : candidatesLoading ? <Empty><LocalizedText text={"Loading your cards…"} /></Empty> : searchTerm ? <Empty><LocalizedText text={"No cards match this search."} /></Empty> : <Empty><LocalizedText text={"No cards are available to offer right now."} /></Empty>}
          </div>
          <TraderCardPages pagination={candidatePage} />
        </section>
        <div className="trader-vn-offer-swap" aria-hidden="true"><ArrowLeftRight size={30} /></div>
        <section className="trader-vn-offer-side"><header><div><h3><LocalizedText text={"Her Cards"} /></h3><span>{selectedTargets.length}<LocalizedText text={selectedTargets.length === 1 ? " card selected" : " cards selected"} before={" "} /></span></div></header>
          <div className="trader-vn-card-options" aria-label="Her available cards">
            {filteredInventory.length ? inventoryPage.items.map(row => <TradeCardOption key={row.id} cardId={row.card_id} selected={targets.includes(String(row.id))} onClick={() => onToggleTarget(row.id)}><span>{row.credits.toLocaleString()}<LocalizedText text={" Credits"} before={" "} /><span aria-hidden="true"> · </span>{row.shards.toLocaleString()}<LocalizedText text={" Shards"} before={" "} /></span></TradeCardOption>) : inventoryLoading ? <Empty><LocalizedText text={"Loading her cards…"} /></Empty> : searchTerm ? <Empty><LocalizedText text={"No cards match this search."} /></Empty> : <Empty><LocalizedText text={"She has no available cards to trade."} /></Empty>}
          </div>
          <TraderCardPages pagination={inventoryPage} />
        </section>
      </div>
      <div className="trader-vn-trade-footer">{selectedTargets.length ? <><div className="trader-vn-money"><label><LocalizedText text={"Add Credits"} /><input type="number" min="0" step="1" value={credits} onChange={event => onMoney('credits', event.target.value)} /></label><label><LocalizedText text={"Add Shards"} /><input type="number" min="0" step="1" value={shards} onChange={event => onMoney('shards', event.target.value)} /></label></div><button className="primary" disabled={!comparisonIsValid || !quote?.meets_minimum || !hasOffer || isBusyQuote || busy} onClick={onBarter}><ArrowLeftRight /><LocalizedText text={"Propose trade"} before={" "} /></button></> : <div className="trader-vn-sell-actions"><p>{selectedCopyIds.length ? <LocalizedText text={"Sell your selected cards for Credits or Shards."} /> : <LocalizedText text={"Select cards to sell, or choose her cards to trade."} />}</p><button disabled={!selectedCopyIds.length || busy} onClick={() => onSell('credits')}><LocalizedText text={"Sell for Credits"} /></button><button disabled={!selectedCopyIds.length || busy} onClick={() => onSell('shards')}><LocalizedText text={"Sell for Shards"} /></button></div>}</div>
  </section>
}

export function RequestsView({ visit, requests, cardId, onCardId, onRequest }) {
  return <section className="trader-vn-view"><header><Search /><div><h2><LocalizedText text={"Request a card"} /></h2><p>{visit.requests_remaining}<LocalizedText text={"requests remaining"} before={" "} /> · <LocalizedText text={"72% chance she brings it on her next visit."} /></p></div></header>
    <div className="trader-vn-request"><label><LocalizedText text={"Card catalog code"} /><input type="text" value={cardId} onChange={event => onCardId(event.target.value)} placeholder="REL-2026-10-435" /></label><button disabled={!cardId.trim() || !visit.requests_remaining} onClick={onRequest}><LocalizedText text={"Request card"} /></button></div>
    <div className="trader-vn-request-log">{requests.map(item => <article key={item.id}><TraderCardPreview cardId={item.card_id} compact /><div><strong>{item.catalog_code || item.result?.catalog_code || <LocalizedText text={"Catalog code unavailable"} />}</strong><span>{item.status === 'pending' ? 'Waiting for her next visit' : item.status === 'fulfilled' ? 'She brought your card' : item.status === 'offered' ? 'Offer found' : 'She could not find it'}</span><p>{item.result?.reason || (item.status === 'pending' ? 'Waiting for her next visit.' : item.result?.credits ? `${item.result.credits.toLocaleString()} Credits` : '')}</p></div></article>)}</div>
  </section>
}
export function OffersPanel({ offers, onAccept, onRefuse, busy = false }) {
  const open = offers.filter(offer => offer.status === 'open')
  if (!open.length) return null
  return <aside className="trader-vn-offers"><header><AlertTriangle /><strong><LocalizedText text={"Open deal"} />{open.length === 1 ? '' : 's'}</strong></header>{open.map(offer => <article key={offer.id}><div><strong>{offer.kind.toUpperCase()}<LocalizedText text={"· Offer #"} before={" "} />{offer.id}</strong><span>{offerSummary(offer)}</span></div><button disabled={busy} onClick={() => onAccept(offer)}><Check /><LocalizedText text={"Accept"} before={" "} /></button><button disabled={busy} onClick={() => onRefuse(offer)}><X /><LocalizedText text={"Refuse"} before={" "} /></button></article>)}</aside>
}

export function HistoryView({ history }) {
  return <section className="trader-vn-view"><header><History /><div><h2><LocalizedText text={"Deal History"} /></h2><p><LocalizedText text={"Your completed trades with past visitors."} /></p></div></header>{history.length ? <div className="trader-vn-history">{history.map(item => <article key={item.id}><div><strong>{item.kind.toUpperCase()}<LocalizedText text={"· Deal #"} before={" "} />{item.id}</strong><span>{new Date(item.completed_at).toLocaleString()}</span></div><p>{offerSummary(item)} · {item.lines.length}<LocalizedText text={"card line"} before={" "} />{item.lines.length === 1 ? '' : 's'}</p></article>)}</div> : <Empty><LocalizedText text={"Completed trades will appear here."} /></Empty>}</section>
}
