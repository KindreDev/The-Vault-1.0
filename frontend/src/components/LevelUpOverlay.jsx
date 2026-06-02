import React, { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { useVaultStore } from '../store/vault'
import { gamiApi } from '../lib/api'

// ── Particle burst ─────────────────────────────────────────────────────────────
function Particle({ angle, color, delay }) {
  const dist = 120 + Math.random() * 160
  const rad  = (angle * Math.PI) / 180
  const tx   = Math.cos(rad) * dist
  const ty   = Math.sin(rad) * dist
  return (
    <motion.div
      className="absolute w-2 h-2 rounded-full pointer-events-none"
      style={{ background: color, top: '50%', left: '50%', marginTop: -4, marginLeft: -4 }}
      initial={{ scale: 0, x: 0, y: 0, opacity: 1 }}
      animate={{ scale: [0, 1.4, 0.6, 0], x: tx, y: ty, opacity: [1, 1, 0.6, 0] }}
      transition={{ duration: 1.4, delay, ease: 'easeOut' }}
    />
  )
}

function ParticleBurst() {
  const colors = ['#7F77DD', '#D4537E', '#BA7517', '#ffffff', '#C45FD4', '#4A9ED9']
  const count = 32
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden rounded-full">
      {Array.from({ length: count }).map((_, i) => (
        <Particle
          key={i}
          angle={(360 / count) * i}
          color={colors[i % colors.length]}
          delay={0.15 + (i % 4) * 0.04}
        />
      ))}
    </div>
  )
}

// ── Scan-line shimmer ──────────────────────────────────────────────────────────
function ScanLine() {
  return (
    <motion.div
      className="absolute inset-x-0 h-[2px] pointer-events-none"
      style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(127,119,221,0.8) 50%, transparent 100%)' }}
      initial={{ top: '-2px', opacity: 0 }}
      animate={{ top: ['0%', '100%'], opacity: [0, 0.8, 0] }}
      transition={{ duration: 1.8, delay: 0.3, ease: 'linear' }}
    />
  )
}

// ── Main overlay ──────────────────────────────────────────────────────────────
export default function LevelUpOverlay() {
  const levelUpData       = useVaultStore(s => s.levelUpData)
  const dismissLevelUp    = useVaultStore(s => s.dismissLevelUp)
  const avatarBust        = useVaultStore(s => s.avatarBust)
  const confettiEnabled   = useVaultStore(s => s.confettiEnabled)
  const timerRef          = useRef(null)

  useEffect(() => {
    if (levelUpData) {
      timerRef.current = setTimeout(dismissLevelUp, 5000)
      if (confettiEnabled) {
        const fire = (opts) => confetti({ particleCount: 60, spread: 70, origin: { y: 0.55 }, ...opts })
        fire({ colors: ['#7F77DD', '#D4537E', '#BA7517', '#ffffff'], angle: 60,  origin: { x: 0.1, y: 0.6 } })
        fire({ colors: ['#7F77DD', '#D4537E', '#BA7517', '#ffffff'], angle: 120, origin: { x: 0.9, y: 0.6 } })
        setTimeout(() => fire({ colors: ['#C45FD4', '#4A9ED9'], angle: 90, origin: { x: 0.5, y: 0.5 }, particleCount: 80 }), 300)
      }
    }
    return () => clearTimeout(timerRef.current)
  }, [levelUpData])

  const handleClick = () => {
    clearTimeout(timerRef.current)
    dismissLevelUp()
  }

  return (
    <AnimatePresence>
      {levelUpData && (
        <motion.div
          key="levelup-overlay"
          className="fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer"
          style={{ background: 'rgba(6, 6, 10, 0.92)', backdropFilter: 'blur(12px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={handleClick}
        >
          {/* Background glow orb */}
          <motion.div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: 600, height: 600,
              background: 'radial-gradient(circle, rgba(127,119,221,0.18) 0%, rgba(212,83,126,0.08) 50%, transparent 75%)',
            }}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: [0.4, 1.2, 1.0], opacity: [0, 1, 0.8] }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />

          {/* Card */}
          <motion.div
            className="relative flex flex-col items-center gap-5 px-16 py-12 rounded-3xl select-none"
            style={{
              background: 'linear-gradient(160deg, rgba(30,28,50,0.95) 0%, rgba(20,18,35,0.98) 100%)',
              border: '1px solid rgba(127,119,221,0.35)',
              boxShadow: '0 0 60px rgba(127,119,221,0.25), 0 0 120px rgba(212,83,126,0.1)',
            }}
            initial={{ scale: 0.6, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: -20 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.05 }}
          >
            <ScanLine />

            {/* LEVEL UP banner */}
            <motion.div
              initial={{ opacity: 0, y: -12, letterSpacing: '0.1em' }}
              animate={{ opacity: 1, y: 0, letterSpacing: '0.35em' }}
              transition={{ duration: 0.55, delay: 0.25 }}
              className="text-xs font-black tracking-[0.35em] uppercase"
              style={{ color: 'rgba(127,119,221,0.8)' }}
            >
              ✦ Level Up ✦
            </motion.div>

            {/* Avatar + particle burst */}
            <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
              <ParticleBurst />

              {/* Glow ring */}
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background: 'conic-gradient(from 0deg, #7F77DD, #D4537E, #BA7517, #7F77DD)',
                  padding: 3,
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              />

              {/* Avatar */}
              <motion.div
                className="relative z-10 rounded-full overflow-hidden"
                style={{ width: 128, height: 128 }}
                initial={{ scale: 0.5 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
              >
                <img
                  src={gamiApi.avatarUrl(avatarBust)}
                  alt="avatar"
                  className="w-full h-full object-cover"
                  onError={e => {
                    e.target.style.display = 'none'
                    e.target.parentElement.style.background = 'linear-gradient(135deg, #7F77DD, #D4537E)'
                  }}
                />
              </motion.div>
            </div>

            {/* Level number */}
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 350, damping: 18, delay: 0.35 }}
              className="font-black leading-none"
              style={{
                fontSize: 96,
                background: 'linear-gradient(135deg, #ffffff 0%, #7F77DD 50%, #D4537E 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                textShadow: 'none',
                lineHeight: 1,
              }}
            >
              {levelUpData.level}
            </motion.div>

            {/* Title */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="font-semibold text-center"
              style={{ fontSize: 22, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}
            >
              {levelUpData.title}
            </motion.div>

            {/* Divider */}
            <motion.div
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.55 }}
              className="w-full h-px"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(127,119,221,0.5), transparent)' }}
            />

            {/* Dismiss hint */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.45 }}
              transition={{ delay: 1.2 }}
              style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}
            >
              Click anywhere to continue
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
