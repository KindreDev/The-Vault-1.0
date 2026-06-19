import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ExternalLink, Pencil, FolderSymlink,
  Star, StarOff, GitMerge, Trash2, Archive, LayoutTemplate, MousePointer2, CheckSquare,
} from 'lucide-react'

const DIVIDER = '---'

/**
 * Windows 11–style context menu for gallery cards.
 *
 * Props
 *   gallery     – the gallery object being right-clicked
 *   position    – { x, y } cursor coords
 *   onClose     – close without action
 *   onOpen      – navigate into gallery
 *   onRename    – rename display name
 *   onRenameFolder – rename folder on disk
 *   onToggleFav – toggle favourite
 *   onMerge       – open merge modal
 *   onExportZip   – export gallery as a zip archive
 *   onSendToPanel – add to multi-panel viewer queue and navigate there
 *   onDelete      – open delete modal
 */
export default function GalleryContextMenu({
  gallery, position, onClose, bulkCount,
  onOpen, onRename, onRenameFolder,
  onToggleFav, onMerge, onExportZip, onSendToPanel, onDelete,
  onSelectMode, onOpenSelect,
}) {
  const menuRef = useRef(null)

  // Close on Escape or click outside
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // Adjust so the menu never clips outside the viewport
  const MENU_W = 220
  const MENU_H = 300   // generous estimate
  const x = Math.min(position.x, window.innerWidth  - MENU_W - 8)
  const y = Math.min(position.y, window.innerHeight - MENU_H - 8)

  const isFav = gallery.is_favorite

  const items = [
    ...(onSelectMode   ? [{ icon: MousePointer2, label: 'Select',        action: onSelectMode,  style: 'normal' }] : []),
    ...(onOpenSelect   ? [{ icon: CheckSquare,   label: 'Select images', action: onOpenSelect,  style: 'normal' }] : []),
    { icon: ExternalLink, label: 'Open',               action: onOpen,         style: 'normal' },
    DIVIDER,
    { icon: Pencil,        label: 'Rename',             action: onRename,       style: 'normal' },
    { icon: FolderSymlink, label: 'Rename folder',      action: onRenameFolder, style: 'normal' },
    DIVIDER,
    { icon: isFav ? StarOff : Star,
                           label: isFav ? 'Unfavorite' : 'Favorite',
                                                        action: onToggleFav,    style: isFav ? 'normal' : 'amber' },
    { icon: GitMerge,      label: 'Merge into…',        action: onMerge,        style: 'normal' },
    { icon: Archive,       label: 'Export as zip…',     action: onExportZip,    style: 'normal' },
    { icon: LayoutTemplate, label: 'Send to Multi-panel', action: onSendToPanel, style: 'accent' },
    DIVIDER,
    { icon: Trash2,        label: 'Remove from vault',  action: () => onDelete('vault'), style: 'normal' },
    { icon: Trash2,        label: 'Delete from disk',   action: () => onDelete('disk'),  style: 'danger' },
  ]

  const COLOR = {
    normal: 'rgba(255,255,255,0.82)',
    amber:  '#FAC775',
    accent: '#A79FF0',
    danger: '#F4C0D1',
  }

  const wrap = (fn) => (e) => {
    e.stopPropagation()
    fn?.()
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        key="ctx"
        initial={{ opacity: 0, scale: 0.94, y: -6 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{    opacity: 0, scale: 0.94, y: -6 }}
        transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'fixed',
          left: x,
          top: y,
          zIndex: 9999,
          width: MENU_W,
          background: 'rgba(28,28,30,0.96)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '0.5px solid rgba(255,255,255,0.13)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)',
          padding: '5px 0',
          overflow: 'hidden',
        }}
      >
        {/* Gallery name / bulk selection header */}
        <div style={{
          padding: '6px 14px 8px',
          borderBottom: '0.5px solid rgba(255,255,255,0.07)',
          marginBottom: 3,
        }}>
          {bulkCount > 1 ? (
            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>
              {bulkCount} galleries selected
            </div>
          ) : (
            <div style={{
              fontSize: 11, color: 'rgba(255,255,255,0.35)',
              textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap',
            }}>
              {gallery.name}
            </div>
          )}
        </div>

        {items.map((item, i) => {
          if (item === DIVIDER) {
            return (
              <div key={`div-${i}`} style={{
                height: 1, margin: '4px 0',
                background: 'rgba(255,255,255,0.07)',
              }} />
            )
          }
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              onMouseDown={wrap(item.action)}
              className="w-full text-left cursor-pointer flex items-center gap-2.5 select-none"
              style={{
                padding: '7px 14px',
                fontSize: 13,
                color: COLOR[item.style],
                background: 'transparent',
                transition: 'background 0.08s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = item.style === 'danger'
                  ? 'rgba(212,83,126,0.18)'
                  : 'rgba(255,255,255,0.07)'
              }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <Icon size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
              {item.label}
            </button>
          )
        })}
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
