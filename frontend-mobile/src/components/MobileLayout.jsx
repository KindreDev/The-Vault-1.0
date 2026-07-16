import { useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, Images, Users, Layers, Newspaper } from 'lucide-react'
import ChatBubble from './ChatBubble.jsx'

// Ricardo's order: HOME · Galleries · FEED (center) · Cards · Creators.
// Profile moved off the bar — reachable by tapping your PFP on the Home screen.
const TABS = [
  { to: '/',          icon: Home,      label: 'Home' },
  { to: '/galleries', icon: Images,    label: 'Galleries' },
  { to: '/feed',      icon: Newspaper, label: 'Feed' },
  { to: '/cards',     icon: Layers,    label: 'Cards' },
  { to: '/creators',  icon: Users,     label: 'Creators' },
]

const SWIPE_X = 70   // min horizontal px
const SWIPE_Y = 60   // max vertical drift

export default function MobileLayout({ children }) {
  const loc = useLocation()
  const navigate = useNavigate()
  const touchRef = useRef(null)

  // Hide the bottom bar inside the fullscreen viewers.
  const hideNav = loc.pathname.startsWith('/view/') ||
                  loc.pathname.startsWith('/video/') ||
                  loc.pathname.startsWith('/photo/') ||
                  loc.pathname.endsWith('/view')

  const onMainTab = TABS.some(t => t.to === loc.pathname) || loc.pathname === '/feed'
  const onExplore = loc.pathname === '/explore'

  // IG-style: Explore lives to the RIGHT of the main UI. Swipe finger
  // right-to-left on any main tab → Explore; left-to-right on Explore → back.
  const onTouchStart = (e) => {
    // Ignore swipes that start on horizontally-scrolling UI (carousels, rails)
    if (e.target.closest('[data-hswipe], .snap-x, .overflow-x-auto')) { touchRef.current = null; return }
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e) => {
    const start = touchRef.current
    touchRef.current = null
    if (!start || hideNav) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = Math.abs(t.clientY - start.y)
    if (dy > SWIPE_Y) return
    if (dx < -SWIPE_X && onMainTab) navigate('/explore')
    else if (dx > SWIPE_X && onExplore) navigate(-1)
  }

  return (
    <div className="min-h-full flex flex-col" style={{ background: 'var(--c-bg)' }}
         onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: hideNav ? 0 : 'calc(64px + var(--sab))' }}>
        {children}
      </main>

      <ChatBubble />

      {!hideNav && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 border-t flex"
          style={{
            background: 'var(--c-surface)',
            borderColor: 'var(--c-card)',
            paddingBottom: 'var(--sab)',
          }}
        >
          {TABS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className="relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5"
            >
              {({ isActive }) => (
                <>
                  {/* Sliding pill that animates between tabs */}
                  {isActive && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-x-3 top-1 bottom-1 rounded-xl -z-0"
                      style={{ background: 'var(--accent)', opacity: 0.16 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    />
                  )}
                  <motion.span
                    className="relative z-10 flex flex-col items-center gap-0.5"
                    animate={{ scale: isActive ? 1.06 : 1, y: isActive ? -1 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  >
                    <Icon size={24} color={isActive ? 'var(--accent)' : 'rgba(255,255,255,0.45)'} />
                    <span className="text-[11px]" style={{ color: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.45)' }}>
                      {label}
                    </span>
                  </motion.span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
