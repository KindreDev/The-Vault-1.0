import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import queryClient from './lib/queryClient'
import './index.css'
import 'flag-icons/css/flag-icons.min.css'

// If a lazily-loaded route chunk can't be fetched (the app was rebuilt while a
// stale page was open), reload once to pull the fresh index.html + chunk names
// instead of showing "Failed to fetch dynamically imported module". The guard
// stops an endless reload loop if the chunk is genuinely gone.
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('vault_chunk_reloaded')) {
    sessionStorage.setItem('vault_chunk_reloaded', '1')
    window.location.reload()
  }
})
window.addEventListener('load', () => sessionStorage.removeItem('vault_chunk_reloaded'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#1e1e1e',
          color: 'rgba(255,255,255,0.85)',
          border: '0.5px solid rgba(255,255,255,0.1)',
          borderRadius: '10px',
          fontSize: '13px',
        }
      }}
    />
  </QueryClientProvider>
)
