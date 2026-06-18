import React from 'react'

// Without this, any render-time error unmounts the whole React tree and the
// screen goes black (the near-black --c-bg body with nothing on it). This
// catches the error and shows it instead, so failures are diagnosable on-device.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface to the console too (visible via remote debugging).
    console.error('[Vault] UI crash:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    const e = this.state.error
    return (
      <div style={{
        minHeight: '100%', padding: 'calc(env(safe-area-inset-top) + 24px) 20px 24px',
        background: '#0e0e0e', color: 'rgba(255,255,255,0.9)',
        fontFamily: 'system-ui, sans-serif', overflowY: 'auto',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Something broke</h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', marginBottom: 16 }}>
          The screen would normally go black here. This is the error:
        </p>
        <pre style={{
          fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          background: '#1e1e1e', padding: 14, borderRadius: 10, color: '#ff9a9a',
        }}>{String(e?.message || e)}{e?.stack ? '\n\n' + e.stack : ''}</pre>
        <button
          onClick={() => { this.setState({ error: null }); location.reload() }}
          style={{
            marginTop: 18, padding: '12px 20px', borderRadius: 999, border: 'none',
            background: '#7F77DD', color: '#fff', fontSize: 16, fontWeight: 600,
          }}>
          Reload
        </button>
      </div>
    )
  }
}
