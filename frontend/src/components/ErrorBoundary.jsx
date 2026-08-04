import React from 'react'

// A lazily-imported page lives in its own hashed chunk. If the app is updated
// while it's still open, the shell in memory keeps asking for chunk names from
// the build it started on — and those files are gone, so the import 404s.
// Retrying the same import can never succeed; only reloading the shell can.
const CHUNK_ERROR = /dynamically imported module|loading chunk|importing a module script failed|failed to fetch dynamically/i

const RELOAD_MARK = 'vault_chunk_reload_at'

function isChunkError(err) {
  return CHUNK_ERROR.test(String(err?.message || err || ''))
}

// Reload with a fresh query key so nothing can be answered from cache.
function hardReload() {
  try {
    const u = new URL(window.location.href)
    u.searchParams.set('r', Date.now().toString(36))
    window.location.replace(u.toString())
  } catch {
    window.location.reload()
  }
}

/**
 * Catches any unhandled JS error inside a page tree and shows a graceful
 * fallback instead of a blank white screen. Wrap each route (or the Outlet)
 * with this so a single broken page never kills the whole app.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomePageOrTree />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Log to console for devtools — keep it visible so bugs are obvious
    console.error('[ErrorBoundary] Caught:', error)
    console.error('[ErrorBoundary] Component stack:', info.componentStack)

    // A missing chunk means the build changed underneath us. Reload the shell so
    // it picks up the current chunk names. Time-guarded rather than once-per-
    // session: a tight loop is prevented, but a genuine later occurrence still
    // self-heals instead of stranding the user.
    if (isChunkError(error)) {
      let last = 0
      try { last = Number(sessionStorage.getItem(RELOAD_MARK)) || 0 } catch {}
      if (Date.now() - last > 10000) {
        try { sessionStorage.setItem(RELOAD_MARK, String(Date.now())) } catch {}
        hardReload()
      }
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const stale = isChunkError(this.state.error)

    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-24">
        <div style={{ fontSize: 44, opacity: 0.15 }}>{stale ? '⟳' : '⚠️'}</div>
        <div
          className="text-[18px] font-medium"
          style={{ color: 'rgba(255,255,255,0.4)' }}
        >
          {stale ? 'The Vault was updated' : 'Something went wrong'}
        </div>
        <div
          className="text-[14px] text-center"
          style={{ color: 'rgba(255,255,255,0.22)', maxWidth: 420 }}
        >
          {stale
            ? 'This window is still running the previous version. Reloading picks up the new one — nothing in your collection is affected.'
            : (this.state.error?.message || 'An unexpected error occurred on this page.')}
        </div>
        <button
          // Retrying a failed chunk import can only fail again — the shell has to
          // be reloaded. Non-chunk errors keep the cheap in-place retry.
          onClick={() => (stale ? hardReload() : this.setState({ hasError: false, error: null }))}
          className="mt-2 px-5 py-2.5 rounded-full text-[14px] font-medium cursor-pointer"
          style={{
            background: 'rgba(127,119,221,0.15)',
            color: '#CECBF6',
            border: '0.5px solid rgba(127,119,221,0.3)',
          }}
        >
          {stale ? 'Reload' : 'Try again'}
        </button>
      </div>
    )
  }
}
