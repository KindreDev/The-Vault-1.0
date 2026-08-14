import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { X, CheckSquare, Square, TrendingUp } from 'lucide-react'
import VaultCard, { RARITY_CONFIG } from './VaultCard'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cardsApi } from '../lib/api'
import toast from 'react-hot-toast'

const ROW_HEIGHT   = 88
const VISIBLE_ROWS = 6
const OVERSCAN     = 2

const CXP_FEED_YIELD = {
  common: 40, epic: 250, legendary: 800, celestial: 2500,
}
const TYPE_MULTS = { goon: 1.5, variant: 2.0 }
// Level steps per rarity (mirrors backend): CXP cap = step × 9 (level 10)
const LEVEL_CXP_STEP = { common: 100, epic: 400, legendary: 1200, celestial: 3000 }
const OVERFLOW_RATE = 5

function calcCxp(card) {
  const base = CXP_FEED_YIELD[card.rarity] ?? 30
  const mult = TYPE_MULTS[card.card_type] ?? 1.0
  return Math.max(1, Math.floor(base * mult))
}

export default function CardFeedPanel({ targetCard, inventoryId, onClose, onFed }) {
  const [selected, setSelected]   = useState(new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [flashId, setFlashId]     = useState(null)
  const [feedPopped, setFeedPopped] = useState(false)
  const qc = useQueryClient()

  // Feeding grows the card's LEVEL now — the cap is level 10 (step × 9)
  const threshold  = (LEVEL_CXP_STEP[targetCard.rarity] ?? 100) * 9
  const currentCxp = targetCard.cxp ?? 0

  const nextRarity = null   // rarity is fixed at birth — levels are the progression
  const nextCfg = null

  const { data: invData, isLoading } = useQuery({
    queryKey: ['card-inventory-feed'],
    queryFn:  () => cardsApi.inventory({ limit: 10000 }).then(r => r.data),
    staleTime: 10000,
  })

  const allItems = useMemo(() => {
    if (!invData?.items) return []
    return invData.items.filter(item => item.inventory_id !== inventoryId)
  }, [invData, inventoryId])

  const totals = useMemo(() => {
    let rawCxp = 0
    for (const id of selected) {
      const item = allItems.find(i => i.inventory_id === id)
      if (item) rawCxp += calcCxp(item)
    }
    const remaining = threshold !== null ? Math.max(0, threshold - currentCxp) : 0
    const apply     = threshold !== null ? Math.min(rawCxp, remaining) : 0
    const overflow  = rawCxp - apply
    const credits   = overflow > 0 ? Math.max(1, Math.floor(overflow / OVERFLOW_RATE)) : 0
    return { rawCxp, apply, overflow, credits }
  }, [selected, allItems, threshold, currentCxp])

  const isFull = threshold !== null && currentCxp + totals.apply >= threshold

  const feedMutation = useMutation({
    mutationFn: () => cardsApi.feedCards(inventoryId, Array.from(selected)).then(r => r.data),
    onSuccess: (data) => {
      const parts = [`+${data.cxp_gained.toLocaleString()} CXP`]
      if (data.overflow_credits > 0) parts.push(`+${data.overflow_credits} Credits`)
      toast.success(parts.join(' · '))
      qc.invalidateQueries({ queryKey: ['card-inventory'] })
      qc.invalidateQueries({ queryKey: ['card-inventory-feed'] })
      onFed(data)
      onClose()
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Feed failed'),
  })

  const toggle = useCallback((id) => {
    setFlashId(id)
    setTimeout(() => setFlashId(null), 260)
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      prev.size === allItems.length
        ? new Set()
        : new Set(allItems.map(i => i.inventory_id))
    )
  }, [allItems])

  // Virtual scrolling — measure the actual list DOM height so the flex layout
  // drives the size (footer is always visible) instead of a fixed pixel constant.
  const listRef       = useRef(null)
  const [listHeight, setListHeight] = useState(VISIBLE_ROWS * ROW_HEIGHT)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setListHeight(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const totalHeight  = allItems.length * ROW_HEIGHT
  const startIdx     = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIdx       = Math.min(allItems.length, startIdx + Math.ceil(listHeight / ROW_HEIGHT) + OVERSCAN * 2 + 1)
  const visibleItems = allItems.slice(startIdx, endIdx)
  const offsetTop    = startIdx * ROW_HEIGHT

  const currentPct = threshold ? Math.min(100, (currentCxp / threshold) * 100) : 0
  const gainPct    = threshold && totals.apply > 0
    ? Math.min(100 - currentPct, (totals.apply / threshold) * 100)
    : 0
  const allSelected = allItems.length > 0 && selected.size === allItems.length

  const barFillColor = isFull && nextCfg
    ? `linear-gradient(90deg, ${nextCfg.badge}bb, ${nextCfg.badge})`
    : '#6EE7C3'

  return (
    <div
      className="cfp-root"
      style={{
        width: 340,
        background: '#111115',
        border: '0.5px solid rgba(255,255,255,0.1)',
        borderRadius: 16,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 700,
        flexShrink: 0,
        overflow: 'hidden',   /* clips the rounded corners only */
      }}
    >
      <style>{`
        .cfp-root {
          animation: cfp-slide-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes cfp-slide-in {
          from { transform: translateX(28px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        .cfp-row-flash {
          animation: cfp-row-pop 0.26s ease-out forwards;
        }
        @keyframes cfp-row-pop {
          0%   { background: rgba(110, 231, 195, 0.22); transform: scaleX(1.012); }
          60%  { background: rgba(110, 231, 195, 0.1);  transform: scaleX(1); }
          100% { background: rgba(110, 231, 195, 0.06); }
        }

        @keyframes cfp-bar-glow {
          0%, 100% { box-shadow: 0 0 8px var(--cfp-glow), 0 0 18px var(--cfp-glow-dim); }
          50%       { box-shadow: 0 0 18px var(--cfp-glow), 0 0 36px var(--cfp-glow-dim); }
        }

        /* Feed button — idle (cards selected) */
        .cfp-feed-btn {
          transition: background 0.18s ease, color 0.18s ease,
                      border-color 0.18s ease, box-shadow 0.18s ease,
                      transform 0.14s cubic-bezier(0.34, 1.56, 0.64, 1),
                      opacity 0.18s ease;
        }
        .cfp-feed-btn.cfp-active:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px color-mix(in srgb, var(--c-green) 35%, transparent), 0 0 0 1px rgba(110,231,195,0.25);
          filter: brightness(1.12);
        }
        .cfp-feed-btn.cfp-active:active {
          transform: scale(0.96) translateY(0);
          box-shadow: 0 2px 8px color-mix(in srgb, var(--c-green) 20%, transparent);
          filter: brightness(0.95);
        }
        .cfp-feed-btn.cfp-popped {
          animation: cfp-feed-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        @keyframes cfp-feed-pop {
          0%   { transform: scale(1); }
          25%  { transform: scale(0.93); }
          60%  { transform: scale(1.07); }
          80%  { transform: scale(0.98); }
          100% { transform: scale(1); }
        }

        /* Shimmer sweep on the button when cards are selected */
        .cfp-feed-btn.cfp-active::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(105deg,
            transparent 35%,
            rgba(110,231,195,0.12) 50%,
            transparent 65%);
          background-size: 200% 100%;
          animation: cfp-shimmer 2.8s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes cfp-shimmer {
          0%   { background-position: 200% 0; }
          60%  { background-position: -200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-accent-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={14} /> Level Up
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
            Sacrifice cards for CXP
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '0.5px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.4)',
            borderRadius: '50%', width: 28, height: 28,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* CXP preview bar */}
      {threshold !== null && (
        <div style={{ padding: '12px 16px 10px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 8,
          }}>
            <span>CXP {currentCxp.toLocaleString()} / {threshold.toLocaleString()}</span>
            {totals.apply > 0 && (
              <span style={{
                color: isFull && nextCfg ? nextCfg.badge : '#6EE7C3',
                fontWeight: 700,
                transition: 'color 0.4s ease',
              }}>
                +{totals.apply.toLocaleString()}{isFull ? ' · READY' : ''}
              </span>
            )}
          </div>

          {/* Bar track */}
          <div
            className={isFull ? 'cfp-bar-full' : undefined}
            style={{
              height: 9, borderRadius: 9,
              background: 'rgba(255,255,255,0.07)',
              overflow: 'hidden', display: 'flex',
              position: 'relative',
              ...(isFull && nextCfg ? {
                '--cfp-glow':     nextCfg.badge,
                '--cfp-glow-dim': `${nextCfg.badge}44`,
                animation: 'cfp-bar-glow 1.4s ease-in-out infinite',
                borderRadius: 9,
              } : {}),
            }}
          >
            {/* Existing CXP */}
            <div style={{
              height: '100%', width: `${currentPct}%`,
              background: 'color-mix(in srgb, var(--c-accent) 45%, transparent)',
              flexShrink: 0,
            }} />
            {/* Gain from selection */}
            <div style={{
              height: '100%',
              width: `${gainPct}%`,
              background: barFillColor,
              flexShrink: 0,
              transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1), background 0.5s ease',
            }} />
          </div>

          {totals.overflow > 0 && (
            <div style={{ fontSize: 10, color: 'var(--c-amber-text)', marginTop: 6 }}>
              {totals.overflow.toLocaleString()} overflow → +{totals.credits} Credits
            </div>
          )}
        </div>
      )}

      {threshold === null && (
        <div style={{ padding: '8px 16px', fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
          Max rarity — all CXP converts to Credits
        </div>
      )}

      {/* Select All bar */}
      <div style={{
        padding: '7px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <button
          onClick={toggleAll}
          style={{
            fontSize: 11, color: 'var(--c-accent-text)',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 0, display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          {allSelected ? <CheckSquare size={13} color="#6EE7C3" /> : <Square size={13} />}
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
          {selected.size}/{allItems.length}
        </span>
      </div>

      {/* Virtualised list — flex:1 so it fills remaining space; footer is always visible */}
      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
          Loading…
        </div>
      ) : allItems.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
          No other cards in collection
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
              {visibleItems.map(item => {
                const cxpGain    = calcCxp(item)
                const isSelected = selected.has(item.inventory_id)
                const isFlashing = flashId === item.inventory_id
                const cfg        = RARITY_CONFIG[item.rarity] || RARITY_CONFIG.common

                return (
                  <div
                    key={item.inventory_id}
                    onClick={() => toggle(item.inventory_id)}
                    className={isFlashing ? 'cfp-row-flash' : undefined}
                    style={{
                      height: ROW_HEIGHT,
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '0 14px 0 12px',
                      cursor: 'pointer',
                      background: isFlashing ? undefined : isSelected ? 'rgba(110,231,195,0.06)' : 'transparent',
                      borderBottom: '0.5px solid rgba(255,255,255,0.04)',
                      boxSizing: 'border-box',
                      transition: isFlashing ? undefined : 'background 0.15s ease',
                    }}
                  >
                    {/* Checkbox */}
                    <div style={{ flexShrink: 0, width: 16 }}>
                      {isSelected
                        ? <CheckSquare size={14} color="#6EE7C3" />
                        : <Square size={14} color="rgba(255,255,255,0.18)" />}
                    </div>

                    {/* Mini card with rarity glow */}
                    <div style={{
                      flexShrink: 0,
                      borderRadius: 8,
                      boxShadow: isSelected
                        ? `0 0 12px ${cfg.badge}99, 0 0 24px ${cfg.badge}44`
                        : `0 0 6px ${cfg.badge}44`,
                      transition: 'box-shadow 0.2s ease',
                    }}>
                      <VaultCard card={item} width={60} forceEffects={false} disableTilt={true} hideLabel={true} />
                    </div>

                    {/* Rarity + type badges — no name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, color: cfg.badge, fontWeight: 700,
                        textTransform: 'capitalize', letterSpacing: '0.02em',
                      }}>
                        {item.rarity}
                      </div>
                      <div style={{ fontSize: 10, marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                        {item.card_type === 'goon' && (
                          <span style={{ color: 'var(--c-pink)', fontWeight: 700 }}>GOON ×1.5</span>
                        )}
                        {item.card_type === 'variant' && (
                          <span style={{ color: '#c9a84c', fontWeight: 700 }}>VARIANT ×2</span>
                        )}
                        {item.quantity > 1 && (
                          <span style={{ color: 'rgba(255,255,255,0.28)' }}>×{item.quantity}</span>
                        )}
                      </div>
                    </div>

                    {/* CXP value */}
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{
                        fontSize: 14, fontWeight: 700,
                        color: isSelected ? '#6EE7C3' : 'rgba(110,231,195,0.55)',
                        transition: 'color 0.15s ease',
                      }}>
                        +{cxpGain.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>CXP</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '10px 14px 14px', borderTop: '0.5px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        {selected.size > 0 && totals.credits > 0 && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 8, textAlign: 'center' }}>
            Overflow → <span style={{ color: 'var(--c-amber-text)' }}>+{totals.credits} Credits</span>
          </div>
        )}
        <button
          className={[
            'cfp-feed-btn',
            selected.size > 0 ? 'cfp-active' : '',
            feedPopped ? 'cfp-popped' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => {
            if (selected.size === 0 || feedMutation.isPending) return
            setFeedPopped(true)
            setTimeout(() => setFeedPopped(false), 350)
            feedMutation.mutate()
          }}
          disabled={selected.size === 0 || feedMutation.isPending}
          style={{
            position: 'relative',
            overflow: 'hidden',
            width: '100%', padding: '11px 0', borderRadius: 10,
            fontSize: 13, fontWeight: 700,
            cursor: selected.size === 0 ? 'default' : 'pointer',
            background: selected.size > 0 ? 'color-mix(in srgb, var(--c-green) 20%, transparent)' : 'rgba(255,255,255,0.04)',
            color:  selected.size > 0 ? '#6EE7C3' : 'rgba(255,255,255,0.2)',
            border: selected.size > 0 ? '1px solid color-mix(in srgb, var(--c-green) 40%, transparent)' : '0.5px solid rgba(255,255,255,0.07)',
            opacity: feedMutation.isPending ? 0.6 : 1,
          }}
        >
          {feedMutation.isPending
            ? 'Feeding…'
            : selected.size > 0
            ? `Feed ${selected.size} → +${totals.apply.toLocaleString()} CXP`
            : 'Select cards to feed'}
        </button>
      </div>
    </div>
  )
}
