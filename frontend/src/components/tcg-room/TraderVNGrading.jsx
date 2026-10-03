import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import TraderCardPages, { useTraderPage } from './TraderCardPages'
import { BadgeCheck, Search, Sparkles } from 'lucide-react'
import { LocalizedText } from '../../i18n'
import { tcgTradersApi } from '../../lib/api'
import { readableTraderError } from './traderVNState'
import { GRADE_FEE_BY_RARITY, matchesCardSearch, sortByRarity, TradeCardOption } from './TraderVNViews'

const quoteNumber = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

const rarityOf = item => String(item?.rarity || item?.print_rarity || item?.rarity_class || 'C').toUpperCase()

function GradeEmpty({ children }) {
  return <div className="trader-vn-empty"><Sparkles size={28} /><p>{children}</p></div>
}

export default function TraderVNGrading({ visitId, candidates, loading = false, selected, onToggle, gradedCopies = {}, busy = false, onConfirmGrade }) {
  const [search, setSearch] = useState('')
  const allCandidates = Array.isArray(candidates) ? candidates : []
  const selectedCopyIds = [...new Set(selected)].sort((a, b) => Number(a) - Number(b))
  const gradeQuoteQuery = useQuery({
    queryKey: ['tcg-trader-grade-quote', visitId, selectedCopyIds.join(',')],
    queryFn: () => tcgTradersApi.gradeQuote(visitId, selectedCopyIds).then(response => response.data),
    enabled: Boolean(visitId && selectedCopyIds.length),
    staleTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })
  const quote = gradeQuoteQuery.data
  const quoteItems = Array.isArray(quote?.items) ? quote.items : []
  const quoteByCopyId = new Map(quoteItems.map(item => [String(item.copy_id), item]))
  const quoteIsReady = Boolean(selectedCopyIds.length && gradeQuoteQuery.isSuccess && !gradeQuoteQuery.isFetching
    && quoteItems.length === selectedCopyIds.length && quoteNumber(quote?.total_fee_credits) !== null)
  const totalFee = quoteNumber(quote?.total_fee_credits)
  const creditsBalance = quoteNumber(quote?.credits_balance)
  const insufficientCredits = quoteIsReady && creditsBalance !== null && totalFee > creditsBalance
  const allAlreadyGraded = quoteIsReady && quoteItems.every(item => item.already_graded)
  const searchTerm = search.trim().toLocaleLowerCase()
  const sortedCandidates = sortByRarity(allCandidates)
  const visibleCandidates = sortedCandidates.filter(item => matchesCardSearch(item, searchTerm))
  const candidatePage = useTraderPage(visibleCandidates, `${visitId}:${searchTerm}`)
  const selectedPreviewsReady = quoteIsReady && quoteItems.length > 0

  let status = null
  if (!selectedCopyIds.length) status = <LocalizedText text={"Select cards to preview each grade and its Credit cost."} />
  else if (gradeQuoteQuery.isFetching) status = <LocalizedText text={"Loading grade preview…"} />
  else if (gradeQuoteQuery.isError) status = <><LocalizedText text={readableTraderError(gradeQuoteQuery.error)} /> <button type="button" className="trader-vn-quote-retry" onClick={() => gradeQuoteQuery.refetch()}><LocalizedText text={"Try again"} /></button></>
  else if (quoteIsReady && insufficientCredits) status = <><LocalizedText text={"You need"} /> {Math.max(0, totalFee - creditsBalance).toLocaleString()} <LocalizedText text={"more Credits to grade these cards."} before={" "} /></>
  else if (allAlreadyGraded) status = <LocalizedText text={"These copies already have saved grades and will not be charged again."} />
  else if (quoteIsReady) status = <LocalizedText text={"Review each tier before you confirm."} />

  return <section className="trader-vn-view trader-vn-grading">
    <header><BadgeCheck /><div><h2><LocalizedText text={"Grading"} /></h2><p><LocalizedText text={"Choose copies to preview their grade tier and Credit cost."} /></p></div></header>
    <label className="trader-vn-trade-search"><span><LocalizedText text={"Search cards"} /></span><div><Search aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Card code, title, creator, type, or tag" /></div></label>
    <div className="trader-vn-grade-summary" aria-live="polite">
      <div><span><LocalizedText text={"Total cost"} /></span><strong>{quoteIsReady ? totalFee.toLocaleString() : '—'}<LocalizedText text={"Credits"} before={" "} /></strong></div>
      <div><span><LocalizedText text={"Credits available"} /></span><strong>{creditsBalance === null ? '—' : creditsBalance.toLocaleString()}</strong></div>
      <p className={insufficientCredits ? 'is-gap' : quoteIsReady && !allAlreadyGraded ? 'is-enough' : ''}>{status}</p>
    </div>
    {selectedPreviewsReady && <section className="trader-vn-grade-preview" aria-label="Grade preview">
      <h3><LocalizedText text={"Grade preview"} /></h3>
      {quoteItems.map(item => <article key={item.copy_id}>
        <span>{item.name || item.catalog_code || `Card #${item.card_id}`}</span>
        <strong><LocalizedText text={item.grade} /><LocalizedText text={" tier"} /></strong>
        <span>{item.already_graded ? <LocalizedText text={"Already graded · 0 Credits"} /> : <><LocalizedText text={item.fee_credits.toLocaleString()} /><LocalizedText text={" Credits"} before={" "} /></>}</span>
      </article>)}
    </section>}
    <div className="trader-vn-card-options" aria-label="Cards available for grading">
      {visibleCandidates.length ? candidatePage.items.map(item => {
        const quoteItem = quoteByCopyId.get(String(item.copy_id))
        const savedGrade = item.grade || gradedCopies[item.copy_id]?.grade
        const alreadyGraded = Boolean(item.is_graded || gradedCopies[item.copy_id])
        const rarity = rarityOf(item)
        const fee = quoteItem ? quoteItem.fee_credits : alreadyGraded ? 0 : (GRADE_FEE_BY_RARITY[rarity] ?? GRADE_FEE_BY_RARITY.C)
        const previewGrade = quoteItem?.grade || savedGrade
        return <TradeCardOption key={item.copy_id} cardId={item.card_id} selected={selected.includes(item.copy_id)} onClick={() => onToggle(item.copy_id)}>
          <span><LocalizedText text={rarity} /><LocalizedText text={" · "} /><LocalizedText text={fee.toLocaleString()} /><LocalizedText text={" Credits"} before={" "} /></span>
          {previewGrade && <span className="trader-vn-card-option__grade"><LocalizedText text={previewGrade} /><LocalizedText text={" tier"} />{alreadyGraded && <LocalizedText text={" · graded"} />}</span>}
        </TradeCardOption>
      }) : loading ? <GradeEmpty><LocalizedText text={"Loading your cards…"} /></GradeEmpty> : searchTerm ? <GradeEmpty><LocalizedText text={"No cards match this search."} /></GradeEmpty> : <GradeEmpty><LocalizedText text={"No cards are available to grade right now."} /></GradeEmpty>}
    </div>
    <TraderCardPages pagination={candidatePage} />
    <footer className="trader-vn-grade-actions"><span>{selectedCopyIds.length}<LocalizedText text={selectedCopyIds.length === 1 ? " card selected" : " cards selected"} before={" "} /></span><button className="primary" type="button" disabled={!quoteIsReady || insufficientCredits || allAlreadyGraded || busy} onClick={() => onConfirmGrade(quote)}><BadgeCheck /><LocalizedText text={"Grade selected cards"} before={" "} /></button></footer>
  </section>
}
