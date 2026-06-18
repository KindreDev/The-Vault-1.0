/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          bg:      '#0e0e0e',
          surface: '#161616',
          card:    '#1e1e1e',
          border:  'rgba(255,255,255,0.08)',
          text:    'rgba(255,255,255,0.85)',
          muted:   'rgba(255,255,255,0.4)',
          accent:  '#7F77DD',
          pink:    '#D4537E',
          amber:   '#BA7517',
          green:   '#1D9E75',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        vault: '10px',
      },
    },
  },
  plugins: [],
}
