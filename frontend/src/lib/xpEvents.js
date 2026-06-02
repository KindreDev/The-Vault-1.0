/**
 * Tiny synchronous pub/sub for XP notifications.
 * No imports — safe to import from api.js without circular deps.
 */
const listeners = new Set()

export const xpEvents = {
  subscribe: (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)   // returns unsubscribe
  },
  emit: (payload) => {
    listeners.forEach(fn => { try { fn(payload) } catch (_) {} })
  },
}
