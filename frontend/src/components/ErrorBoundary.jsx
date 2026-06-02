import React from 'react'

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
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-24">
        <div style={{ fontSize: 44, opacity: 0.15 }}>⚠️</div>
        <div
          className="text-[18px] font-medium"
          style={{ color: 'rgba(255,255,255,0.4)' }}
        >
          Something went wrong
        </div>
        <div
          className="text-[14px] text-center"
          style={{ color: 'rgba(255,255,255,0.22)', maxWidth: 420 }}
        >
          {this.state.error?.message || 'An unexpected error occurred on this page.'}
        </div>
        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          className="mt-2 px-5 py-2.5 rounded-full text-[14px] font-medium cursor-pointer"
          style={{
            background: 'rgba(127,119,221,0.15)',
            color: '#CECBF6',
            border: '0.5px solid rgba(127,119,221,0.3)',
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}
