import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import queryClient from './lib/queryClient'
import './index.css'
import 'flag-icons/css/flag-icons.min.css'

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
