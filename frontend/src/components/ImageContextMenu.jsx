import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { Eye, ImagePlus, LayoutTemplate, FolderInput, FolderMinus, Trash2, UserCircle, UserPlus, ImageIcon, ChevronRight, MousePointer2, Copy } from 'lucide-react'
import { creatorsApi } from '../lib/api'
import { useAllCreators } from '../hooks/useAllCreators'

/**
 * Right-click context menu for image / video thumbnails.
 *
 * Props
 *   image          – the image object
 *   position       – { x, y }
 *   onClose
 *   onView         – open in viewer
 *   onSetCover     – set as gallery cover (omit to hide this item)
 *   onSendToViewer
 *   onTransfer     – move to another gallery (omit to hide this item)
 *   onCopyTo       – copy a reference into a mix gallery (omit to hide this item)
 *   onDelete       – (mode: 'vault' | 'disk')
 *   creators       – array of creators assigned to this gallery (for avatar/banner)
 *   onSetAsAvatar  – (creatorId) set image as creator avatar
 *   onSetAsBanner  – (creatorId) set image as creator banner
 */
export default function ImageContextMenu({
  image, position, onClose, bulkCount,
  onView, onSetCover, onSendToViewer, onTransfer, onCopyTo, onDelete,
  creators, onSetAsAvatar, onSetAsBanner,
  onSelectMode, onAssignCreator,
}) {
  const menuRef = useRef(null)
  const [avatarOpen,  setAvatarOpen]  = useState(false)
  const [bannerOpen,  setBannerOpen]  = useState(false)
  const [assignOpen,  setAssignOpen]  = useState(false)
  const [assignSearch, setAssignSearch] = useState('')

  const { data: allCreators } = useAllCreators()

  const filteredAssign = useMemo(() => {
    if (!allCreators) return []
    return allCreators.filter(c => c.name.toLowerCase().includes(assignSearch.toLowerCase()))
  }, [allCreators, assignSearch])

  useEffect(() => {
    const onKey  = (e) => { if (e.key === 'Escape') onClose() }
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // Avatar and banner both work for videos (they open a frame picker upstream)
  const hasCreators = creators && creators.length > 0
  const canBanner   = hasCreators

  // Estimate menu height for edge collision — base + 2 expandable rows + possible creator list rows
  const creatorRowH = 32
  const expandedRows = (avatarOpen ? creators?.length ?? 0 : 0) + (bannerOpen ? creators?.length ?? 0 : 0)
  const MENU_W = 210
  const MENU_H = 340
    + (hasCreators ? 52 : 0)
    + expandedRows * creatorRowH
    + (onAssignCreator ? 32 : 0)
    + (assignOpen ? 200 : 0)

  const x = Math.min(position.x, window.innerWidth  - MENU_W - 8)
  const y = Math.min(position.y, window.innerHeight - MENU_H - 8)

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        key="img-ctx"
        initial={{ opacity: 0, scale: 0.94, y: -6 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{    opacity: 0, scale: 0.94, y: -6 }}
        transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'fixed', left: x, top: y, zIndex: 9999,
          width: MENU_W,
          background: 'rgba(22,22,26,0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '0.5px solid rgba(255,255,255,0.13)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
          padding: '5px 0',
          // NOTE: no overflow:hidden here — that would clip the expand animation
        }}
      >
        {/* filename / bulk header */}
        <div style={{ padding: '6px 14px 8px', borderBottom: '0.5px solid rgba(255,255,255,0.07)', marginBottom: 3 }}>
          {bulkCount > 1 ? (
            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>
              {bulkCount} images selected
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {image.filename}
              </div>
              {image.is_video && (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 1 }}>Video</div>
              )}
            </>
          )}
        </div>

        {/* Select (enter bulk mode) */}
        {onSelectMode && (
          <MenuItem icon={MousePointer2} label="Select" onMouseDown={(e) => { e.stopPropagation(); onSelectMode(); onClose() }} />
        )}

        {/* View */}
        <MenuItem icon={Eye} label="View" onMouseDown={(e) => { e.stopPropagation(); onView?.(); onClose() }} />

        {/* Set as cover */}
        {onSetCover && !image.is_video && (
          <MenuItem icon={ImagePlus} label="Set as cover" onMouseDown={(e) => { e.stopPropagation(); onSetCover?.(); onClose() }} />
        )}

        {/* Send to Multi-panel */}
        <MenuItem icon={LayoutTemplate} label="Send to Multi-panel" accent onMouseDown={(e) => { e.stopPropagation(); onSendToViewer?.(); onClose() }} />

        {/* Move / Copy to gallery — gated on their handlers so a caller that
            forgets to pass one doesn't render a menu item that does nothing. */}
        {onTransfer && (
          <MenuItem icon={FolderInput} label="Move to gallery" onMouseDown={(e) => { e.stopPropagation(); onTransfer(); onClose() }} />
        )}
        {onCopyTo && (
          <MenuItem icon={Copy} label="Copy to gallery" onMouseDown={(e) => { e.stopPropagation(); onCopyTo(); onClose() }} />
        )}

        {/* Assign creator to this file (expandable) */}
        {onAssignCreator && (
          <>
            <ExpandRow
              icon={UserPlus}
              label={bulkCount > 1 ? `Assign creator (${bulkCount})` : 'Assign creator'}
              open={assignOpen}
              onToggle={(e) => {
                e.stopPropagation()
                setAssignOpen(v => !v)
                setAvatarOpen(false)
                setBannerOpen(false)
                setAssignSearch('')
              }}
            />
            <AnimatePresence initial={false}>
              {assignOpen && (
                <motion.div
                  key="assign-list"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ padding: '4px 8px 2px' }}>
                    <input
                      autoFocus
                      value={assignSearch}
                      onChange={e => setAssignSearch(e.target.value)}
                      placeholder="Search creators…"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '5px 8px', borderRadius: 6, fontSize: 11,
                        background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
                        border: '0.5px solid rgba(255,255,255,0.12)', outline: 'none',
                      }}
                      onMouseDown={e => e.stopPropagation()}
                    />
                  </div>
                  <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                    {filteredAssign.map(c => (
                      <CreatorRow
                        key={c.id}
                        creator={c}
                        onMouseDown={(e) => { e.stopPropagation(); onAssignCreator(c.id); onClose() }}
                      />
                    ))}
                    {filteredAssign.length === 0 && (
                      <div style={{ padding: '6px 14px', fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>No creators found</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* Set as avatar (expandable) — videos open a frame-picker upstream */}
        {hasCreators && onSetAsAvatar && (
          <>
            <ExpandRow
              icon={UserCircle}
              label={image.is_video ? 'Set avatar from video' : 'Set as avatar'}
              open={avatarOpen}
              onToggle={(e) => { e.stopPropagation(); setAvatarOpen(v => !v); setBannerOpen(false) }}
            />
            <AnimatePresence initial={false}>
              {avatarOpen && (
                <motion.div
                  key="avatar-list"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  {creators.map(c => (
                    <CreatorRow
                      key={c.id}
                      creator={c}
                      onMouseDown={(e) => { e.stopPropagation(); onSetAsAvatar(c.id); onClose() }}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* Set as banner (expandable) — only when gallery has creators and image is not a video */}
        {canBanner && onSetAsBanner && (
          <>
            <ExpandRow
              icon={ImageIcon}
              label={image.is_video ? 'Set banner from video' : 'Set as banner'}
              open={bannerOpen}
              onToggle={(e) => { e.stopPropagation(); setBannerOpen(v => !v); setAvatarOpen(false) }}
            />
            <AnimatePresence initial={false}>
              {bannerOpen && (
                <motion.div
                  key="banner-list"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  {creators.map(c => (
                    <CreatorRow
                      key={c.id}
                      creator={c}
                      onMouseDown={(e) => { e.stopPropagation(); onSetAsBanner(c.id); onClose() }}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* Divider */}
        <div style={{ height: 1, margin: '4px 0', background: 'rgba(255,255,255,0.07)' }} />

        {/* Remove from vault */}
        <MenuItem icon={FolderMinus} label="Remove from vault" onMouseDown={(e) => { e.stopPropagation(); onDelete?.('vault'); onClose() }} />

        {/* Delete from disk */}
        <MenuItem icon={Trash2} label="Delete from disk" danger onMouseDown={(e) => { e.stopPropagation(); onDelete?.('disk'); onClose() }} />
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MenuItem({ icon: Icon, label, danger, accent, onMouseDown }) {
  const color  = danger ? '#F4C0D1' : accent ? '#A79FF0' : 'rgba(255,255,255,0.82)'
  const hoverBg = danger ? 'rgba(212,83,126,0.18)' : 'rgba(255,255,255,0.07)'
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      className="w-full text-left cursor-pointer flex items-center gap-2.5 select-none"
      style={{ padding: '7px 14px', fontSize: 13, color, background: 'transparent', transition: 'background 0.08s' }}
      onMouseEnter={e => { e.currentTarget.style.background = hoverBg }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <Icon size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
      {label}
    </button>
  )
}

function ExpandRow({ icon: Icon, label, open, onToggle }) {
  return (
    <button
      type="button"
      onMouseDown={onToggle}
      className="w-full text-left cursor-pointer flex items-center gap-2.5 select-none"
      style={{
        padding: '7px 14px',
        fontSize: 13,
        // Uses the theme accent CSS variable — respects all 6 palette choices
        color: 'var(--accent)',
        background: open ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
        transition: 'background 0.08s',
      }}
      onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
      onMouseLeave={e => { e.currentTarget.style.background = open ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent' }}
    >
      <Icon size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
      <span style={{ flex: 1 }}>{label}</span>
      {/* Framer Motion handles the chevron rotation so it inherits the spring easing */}
      <motion.span
        animate={{ rotate: open ? 90 : 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        style={{ display: 'flex', alignItems: 'center' }}
      >
        <ChevronRight size={11} style={{ opacity: 0.5 }} />
      </motion.span>
    </button>
  )
}

function CreatorRow({ creator, onMouseDown }) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      className="w-full text-left cursor-pointer flex items-center gap-2 select-none"
      style={{
        padding: '5px 14px 5px 32px',
        fontSize: 12,
        color: 'rgba(255,255,255,0.75)',
        background: 'transparent',
        transition: 'background 0.08s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 16%, transparent)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Avatar thumbnail — falls back to an accent-tinted circle if no avatar set */}
      {creator.avatar_path
        ? <img
            src={`/api/creators/${creator.id}/avatar`}
            style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            onError={e => { e.target.style.display = 'none' }}
          />
        : <div style={{
            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
            background: 'color-mix(in srgb, var(--accent) 28%, transparent)',
          }} />
      }
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {creator.name}
      </span>
    </button>
  )
}
