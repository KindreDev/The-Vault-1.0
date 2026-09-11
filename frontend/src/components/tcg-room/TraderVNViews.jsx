import { AlertTriangle, Check, Coins, History, LockKeyhole, MessageCircle, Search, Sparkles, X } from 'lucide-react'
import TraderCardPreview from './TraderCardPreview'
import { offerSummary, traderGate } from './traderVNState'

function Gate({ visit }) {
  const gate = traderGate(visit)
  if (!gate.locked) return null
  return <div className="trader-vn-gate"><LockKeyhole size={34} /><div><strong>{gate.title}</strong><p>{gate.detail}</p><span>SPR supply remains disabled.</span></div></div>
}

function Empty({ children }) { return <div className="trader-vn-empty"><Sparkles size={28} /><p>{children}</p></div> }

export function DialogueView({ visit, messages, onDialogue }) {
  return <section className="trader-vn-view trader-vn-dialogue">
    <header><MessageCircle /><div><h2>Conversation</h2><p>Authored, deterministic, and remembered for this visit.</p></div></header>
    <div className="trader-vn-dialogue__log">
      {messages.length ? messages.map((message, index) => <article key={`${message.action}-${index}`}><span>{visit.trader.name}</span><p>{message.text}</p></article>) : <Empty>She is waiting for you to speak.</Empty>}
    </div>
    <div className="trader-vn-dialogue__choices">
      <button onClick={() => onDialogue('like')}>Ask what she wants</button>
      <button onClick={() => onDialogue('dislike')}>Ask what she avoids</button>
      <button onClick={() => onDialogue('counter')}>Talk negotiation</button>
    </div>
  </section>
}

export function CardsView({ visit, inventory, onBuy }) {
  return <section className="trader-vn-view"><header><Sparkles /><div><h2>Her Cards</h2><p>Frozen for {visit.week_key}; leaving or restarting cannot reroll them.</p></div></header>
    <Gate visit={visit} />
    {!inventory.length && visit.production_enabled && <Empty>Her frozen case is empty this week.</Empty>}
    <div className="trader-vn-card-grid">{inventory.map(item => <article key={item.id}><TraderCardPreview cardId={item.card_id} /><p>{item.credits.toLocaleString()} Credits · {item.shards.toLocaleString()} Shards</p><div><button disabled={!item.available} onClick={() => onBuy(item.id, 'credits')}>Buy with Credits</button><button disabled={!item.available} onClick={() => onBuy(item.id, 'shards')}>Buy with Shards</button></div></article>)}</div>
  </section>
}

function CandidatePicker({ candidates, selected, onToggle }) {
  return <div className="trader-vn-candidates">
    {candidates.length ? candidates.map(item => <button key={item.copy_id} className={selected.includes(item.copy_id) ? 'selected' : ''} onClick={() => onToggle(item.copy_id)}><span className={`rarity rarity--${item.rarity}`}>{item.rarity}</span><strong>{item.catalog_code || `Card #${item.card_id}`}</strong><small>Copy {item.copy_ordinal} of {item.owned_quantity} · {item.location_kind.replaceAll('_', ' ')}</small>{selected.includes(item.copy_id) && <Check size={19} />}</button>) : <Empty>No backend-approved duplicate copies are available.</Empty>}
  </div>
}

export function SellView({ visit, candidates, policy, selected, onToggle, onQuote }) {
  return <section className="trader-vn-view"><header><Coins /><div><h2>Sell duplicates</h2><p>Choose up to five backend-approved physical copies.</p></div></header><Gate visit={visit} />
    <div className="trader-vn-policy"><LockKeyhole size={21} /><span>Your final copy, earned HOF and Bond cards, unpublished cards, and disabled SPR supply are protected by the server.</span></div>
    {!traderGate(visit).locked && <><CandidatePicker candidates={candidates} selected={selected} onToggle={onToggle} /><footer><span>{selected.length} / {policy.max_copies_per_offer || 5} selected</span><button disabled={!selected.length} onClick={() => onQuote('credits')}>Quote Credits</button><button disabled={!selected.length} onClick={() => onQuote('shards')}>Quote Shards</button></footer></>}
  </section>
}

export function TradeView({ visit, inventory, candidates, selected, onToggle, target, onTarget, credits, shards, onMoney, onBarter }) {
  return <section className="trader-vn-view"><header><Sparkles /><div><h2>Build a trade</h2><p>Offer one to five duplicate copies, with optional Credits or Shards.</p></div></header><Gate visit={visit} />
    {!traderGate(visit).locked && <div className="trader-vn-trade-builder"><label>Her card<select value={target} onChange={event => onTarget(event.target.value)}><option value="">Choose frozen stock</option>{inventory.filter(row => row.available).map(row => <option key={row.id} value={row.id}>Card #{row.card_id} · {row.credits} Credits</option>)}</select></label><CandidatePicker candidates={candidates} selected={selected} onToggle={onToggle} /><div className="trader-vn-money"><label>Extra Credits<input type="number" min="0" value={credits} onChange={event => onMoney('credits', event.target.value)} /></label><label>Extra Shards<input type="number" min="0" value={shards} onChange={event => onMoney('shards', event.target.value)} /></label></div><button className="primary" disabled={!target || !selected.length} onClick={onBarter}>Ask for this trade</button></div>}
  </section>
}

export function RequestsView({ visit, requests, cardId, onCardId, onRequest }) {
  return <section className="trader-vn-view"><header><Search /><div><h2>Specific-card requests</h2><p>{visit.requests_remaining} persisted request{visit.requests_remaining === 1 ? '' : 's'} remain this visit.</p></div></header><Gate visit={visit} />
    {!traderGate(visit).locked && <div className="trader-vn-request"><label>Published card ID<input inputMode="numeric" value={cardId} onChange={event => onCardId(event.target.value.replace(/\D/g, ''))} placeholder="Enter a card ID" /></label><button disabled={!cardId || !visit.requests_remaining} onClick={onRequest}>Make persisted request</button></div>}
    <div className="trader-vn-request-log">{requests.map(item => <article key={item.id}><TraderCardPreview cardId={item.card_id} compact /><div><strong>{item.status === 'offered' ? 'Offer found' : 'Request refused'}</strong><p>{item.result?.reason || (item.result?.credits ? `${item.result.credits.toLocaleString()} Credits` : 'Result persisted for this visit.')}</p></div></article>)}</div>
  </section>
}

export function OffersPanel({ offers, onAccept, onRefuse }) {
  const open = offers.filter(offer => offer.status === 'open')
  if (!open.length) return null
  return <aside className="trader-vn-offers"><header><AlertTriangle /><strong>Open deal{open.length === 1 ? '' : 's'}</strong></header>{open.map(offer => <article key={offer.id}><div><strong>{offer.kind.toUpperCase()} · Offer #{offer.id}</strong><span>{offerSummary(offer)}</span></div><button onClick={() => onAccept(offer)}><Check /> Accept</button><button onClick={() => onRefuse(offer)}><X /> Refuse</button></article>)}</aside>
}

export function HistoryView({ history }) {
  return <section className="trader-vn-view"><header><History /><div><h2>Deal History</h2><p>Immutable completed transactions from current and prior visits.</p></div></header>{history.length ? <div className="trader-vn-history">{history.map(item => <article key={item.id}><div><strong>{item.kind.toUpperCase()} · Ledger #{item.id}</strong><span>{new Date(item.completed_at).toLocaleString()}</span></div><p>{offerSummary(item)} · {item.lines.length} card line{item.lines.length === 1 ? '' : 's'}</p></article>)}</div> : <Empty>No completed deals yet. She still remembers the conversation.</Empty>}</section>
}
