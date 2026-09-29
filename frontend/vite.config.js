import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:8000', changeOrigin: true },
      '/thumbs': { target: process.env.VITE_API_TARGET || 'http://localhost:8000', changeOrigin: true },
      '/theme-packs': { target: process.env.VITE_API_TARGET || 'http://localhost:8000', changeOrigin: true },
      '/masks': { target: process.env.VITE_API_TARGET || 'http://localhost:8000', changeOrigin: true },
      '/foil-maps': { target: process.env.VITE_API_TARGET || 'http://localhost:8000', changeOrigin: true },
    }
  }
})
