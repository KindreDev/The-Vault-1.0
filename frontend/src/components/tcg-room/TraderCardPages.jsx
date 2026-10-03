import { useState } from 'react'
import { LocalizedText } from '../../i18n'

const PAGE_SIZE = 36

export function useTraderPage(items, resetKey) {
  const [state, setState] = useState({ key: resetKey, page: 0 })
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const page = state.key === resetKey ? Math.min(state.page, pages - 1) : 0
  return {
    items: items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), page, pages,
    go: next => setState({ key: resetKey, page: Math.max(0, Math.min(next, pages - 1)) }),
  }
}

export default function TraderCardPages({ pagination }) {
  const { page, pages, go } = pagination
  if (pages <= 1) return null
  return <nav className="trader-vn-pagination" aria-label="Card pages">
    <button type="button" disabled={page === 0} onClick={() => go(page - 1)}><LocalizedText text="Previous" /></button>
    <span aria-live="polite">{page + 1} / {pages}</span>
    <button type="button" disabled={page + 1 === pages} onClick={() => go(page + 1)}><LocalizedText text="Next" /></button>
  </nav>
}
