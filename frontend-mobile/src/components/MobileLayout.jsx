import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, Images, Users, Layers, User } from 'lucide-react'

const TABS = [
  { to: '/',          icon: Home,   label: 'Home' },
  { to: '/galleries', icon: Images, label: 'Galleries' },
  { to: '/creators',  icon: Users,  label: 'Creators' },
  { to: '/cards',     icon: Layers, label: 'Cards' },
  { to: '/profile',   icon: User,   label: 'Profile' },
]

export default function MobileLayout({ children }) {
  const loc = useLocation()
  // Hide the bottom bar inside the fullscreen viewers.
  const hideNav = loc.pathname.startsWith('/view/') ||
                  loc.pathname.startsWith('/video/') ||
                  loc.pathname.startsWith('/photo/') ||
                  loc.pathname.endsWith('/view')

  return (
    <div className="min-h-full flex flex-col" style={{ background: 'var(--c-bg)' }}>
      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: hideNav ? 0 : 'calc(64px + var(--sab))' }}>
        {children}
      </main>

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
