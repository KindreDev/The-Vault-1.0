import { createPortal } from 'react-dom'
import { useScrollLock } from '../hooks/useScrollLock'

// Every modal, dialog and full-screen viewer renders through this layer.
//
// - It portals to <body>, outside the animated page container. Inside that
//   container (and inside themed panels with backdrop/blur effects) a
//   `position: fixed` overlay is positioned relative to the container instead
//   of the window, so it scrolled with the page and covered only part of it.
// - It locks scrolling of the page behind it (body and the app's scroll
//   container) for as long as it is mounted. Locks are reference-counted, so
//   stacked modals work.
//
// Render it around the overlay element: <ModalLayer><div className="fixed
// inset-0 ...">…</div></ModalLayer>. React events still bubble to the
// component that rendered it. The `vault-modal-root` wrapper (display:
// contents, so it adds no box) lets theme-pack styles that apply inside the
// app also apply inside modals.
export default function ModalLayer({ children }) {
  useScrollLock(true)
  if (typeof document === 'undefined') return children
  return createPortal(<div className="vault-modal-root" style={{ display: 'contents' }}>{children}</div>, document.body)
}
