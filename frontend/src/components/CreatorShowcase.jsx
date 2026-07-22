import React, { useState } from 'react'
import { Plus, X, Trophy } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { creatorsApi } from '../lib/api'
import VaultCard from './VaultCard'

const SLOT_META = {
  creator:  { label: 'Creator',  hint: 'Her creator or HOF card' },
  gallery:  { label: 'Gallery',  hint: 'One of her 10 rarest gallery cards' },
  goon:     { label: 'Goon',     hint: 'A goon card of her content' },
  photo:    { label: 'Photo',    hint: 'One of her 10 rarest photo cards' },
  wildcard: { label: 'Wildcard', hint: 'Any card special enough (Legendary-grade+)' },
}
const SLOT_ORDER = ['creator', 'gallery', 'goon', 'photo', 'wildcard']
const SLOT_W = 96

// ── Card picker overlay for one slot ─────────────────────────────────────────
function SlotPicker({ creatorId, slot, onClose, onPicked }) {
  const { data: eligible, isLoading } = useQuery({
    queryKey: ['showcase-eligible', creatorId, slot],
    queryFn:  () => creatorsApi.showcaseEligible(creatorId, slot).then(r => r.data),
  })

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
         onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="rounded-2xl p-5 flex flex-col gap-4"
           style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.1)',
                    maxWidth: 900, maxHeight: '80vh', width: '90%' }}>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[18px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>
              {SLOT_META[slot].label} slot
            </p>
            <p className="text-[16px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {SLOT_META[slot].hint}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10"
                  style={{ color: 'rgba(255,255,255,0.4)' }}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0" style={{ scrollbarWidth: 'thin' }}>
          {isLoading ? (
            <p className="text-[16px] py-8 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading…</p>
          ) : (eligible || []).length === 0 ? (
            <p className="text-[16px] py-8 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              No eligible cards yet — pull some packs featuring her first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-4 justify-center py-2">
              {(eligible || []).map(c => (
                <VaultCard key={c.inventory_id} card={c} width={170} onClick={() => onPicked(c)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The Showcase — 5 card display slots on a creator's profile hero.
 * Fill all 5 for MASTERY: a one-time bond surge, a badge... and she notices.
 */
export default function CreatorShowcase({ creatorId, slotWidth = SLOT_W }) {
  const [pickingSlot, setPickingSlot] = useState(null)
  const qc = useQueryClient()

  const { data: showcase } = useQuery({
    queryKey: ['creator-showcase', creatorId],
    queryFn:  () => creatorsApi.showcase(creatorId).then(r => r.data),
    enabled:  !!creatorId,
  })

  const setSlot = useMutation({
    mutationFn: ({ slot, invId }) => creatorsApi.showcaseSet(creatorId, slot, invId).then(r => r.data),
    onSuccess: (data) => {
      qc.setQueryData(['creator-showcase', creatorId], data)
      qc.invalidateQueries({ queryKey: ['showcase-eligible'] })
      if (data.mastery_awarded) {
        toast('🏆 MASTERY! She noticed…', { duration: 5000, style: { background: '#2a1e00', color: '#FFD700' } })
        qc.invalidateQueries({ queryKey: ['feed-dm'] })
      }
      setPickingSlot(null)
    },
    onError: (e) => toast.error(e.response?.data?.detail || 'Could not place card'),
  })

  const clearSlot = useMutation({
    mutationFn: (slot) => creatorsApi.showcaseClear(creatorId, slot).then(r => r.data),
    onSuccess: (data) => {
      qc.setQueryData(['creator-showcase', creatorId], data)
      qc.invalidateQueries({ queryKey: ['showcase-eligible'] })
    },
  })

  const slots = showcase?.slots || {}
  const mastery = !!showcase?.mastery

  return (
    <div className="flex flex-col items-start gap-1.5 flex-shrink-0">
      <div className="flex items-center gap-2">
        {mastery && <Trophy size={15} style={{ color: '#FFD700' }} />}
        <span className="text-[16px] font-medium uppercase tracking-wider"
              style={{ color: mastery ? '#FFD700' : 'rgba(255,255,255,0.4)',
                       textShadow: mastery ? '0 0 12px rgba(255,215,0,0.5)' : 'none' }}>
          {mastery ? 'Showcase · Mastered' : `Showcase · ${showcase?.filled ?? 0}/5`}
        </span>
      </div>
      <div className="flex gap-2 p-2 rounded-2xl"
           style={{
             background: 'rgba(0,0,0,0.35)',
             border: mastery ? '1px solid rgba(255,215,0,0.45)' : '1px solid rgba(255,255,255,0.08)',
             boxShadow: mastery ? '0 0 24px rgba(255,215,0,0.18)' : 'none',
             backdropFilter: 'blur(6px)',
           }}>
        {SLOT_ORDER.map(slot => {
          const card = slots[slot]
          return card ? (
            <div key={slot} className="relative group/slot">
              <VaultCard card={card} width={slotWidth} hideLabel disableTilt
                         onClick={() => setPickingSlot(slot)} />
              <button
                onClick={e => { e.stopPropagation(); clearSlot.mutate(slot) }}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full items-center justify-center hidden group-hover/slot:flex"
                style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.25)',
                         color: 'rgba(255,255,255,0.7)', zIndex: 20 }}>
                <X size={10} />
              </button>
            </div>
          ) : (
            <button key={slot} onClick={() => setPickingSlot(slot)}
                    title={SLOT_META[slot].hint}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl transition-all hover:bg-white/5 cursor-pointer"
                    style={{
                      width: slotWidth + 6, height: Math.round(slotWidth * 1.45) + 6,
                      border: '1.5px dashed rgba(255,255,255,0.18)',
                      color: 'rgba(255,255,255,0.3)',
                    }}>
              <Plus size={16} />
              <span className="text-[13px] font-medium uppercase tracking-wide">{SLOT_META[slot].label}</span>
            </button>
          )
        })}
      </div>

      {pickingSlot && (
        <SlotPicker
          creatorId={creatorId}
          slot={pickingSlot}
          onClose={() => setPickingSlot(null)}
          onPicked={(c) => setSlot.mutate({ slot: pickingSlot, invId: c.inventory_id })}
        />
      )}
    </div>
  )
}
