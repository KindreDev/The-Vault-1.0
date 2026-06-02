/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          bg:       '#0e0e0e',
          surface:  '#161616',
          card:     '#1e1e1e',
          border:   'rgba(255,255,255,0.08)',
          text:     'rgba(255,255,255,0.85)',
          muted:    'rgba(255,255,255,0.4)',
          accent:   '#7F77DD',
          pink:     '#D4537E',
          amber:    '#BA7517',
          green:    '#1D9E75',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        vault: '10px',
      },
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'modal-pop': {
          '0%':   { opacity: '0', transform: 'scale(0.94) translateY(6px)' },
          '100%': { opacity: '1', transform: 'scale(1)   translateY(0)' },
        },
        'dropdown-in': {
          '0%':   { opacity: '0', transform: 'scaleY(0.92) translateY(-4px)' },
          '100%': { opacity: '1', transform: 'scaleY(1)    translateY(0)' },
        },
        // Sweeping shine highlight for metallic podium badges
        'badge-shine': {
          '0%':   { transform: 'translateX(-180%) skewX(-20deg)' },
          '100%': { transform: 'translateX(380%)  skewX(-20deg)' },
        },
      },
      animation: {
        'fade-in':     'fade-in     150ms ease-out both',
        'modal-pop':   'modal-pop   180ms ease-out both',
        'dropdown-in': 'dropdown-in 140ms ease-out both',
        'badge-shine': 'badge-shine 2.2s  ease-in-out infinite',
      },
    }
  },
  plugins: [],
  // Force badge-shine keyframe into CSS output (referenced by inline animation styles)
  safelist: ['animate-badge-shine'],
}
