// Serialize writes and journal edits before sending them, including empty notes.
export function createMetadataAutosave({ save, storage, key, onSaved, retryMs = 2000 }) {
  let draft = {}
  let storageError = null
  try { draft = JSON.parse(storage?.getItem(key) || '{}') } catch { /* unavailable storage */ }
  let running = false
  let retry = null
  let snapshot = { draft, saving: false, error: null }
  const listeners = new Set()
  const publish = (saving, error = null) => {
    snapshot = { draft: { ...draft }, saving, error: error || storageError }
    listeners.forEach(listener => listener())
  }
  const persist = () => {
    try {
      if (Object.keys(draft).length) storage?.setItem(key, JSON.stringify(draft))
      else storage?.removeItem(key)
      storageError = null
    } catch (error) { storageError = error }
  }
  const flush = async () => {
    if (running || !Object.keys(draft).length) return
    if (retry) { clearTimeout(retry); retry = null }
    running = true
    publish(true)
    while (Object.keys(draft).length) {
      const payload = { ...draft }
      try {
        await save(payload)
        // Update the receiving query before dropping the draft overlay.
        onSaved(payload)
        for (const field of Object.keys(payload)) {
          if (JSON.stringify(draft[field]) === JSON.stringify(payload[field])) delete draft[field]
        }
        persist()
        publish(Object.keys(draft).length > 0)
      } catch (error) {
        running = false
        publish(false, error)
        retry = setTimeout(() => { retry = null; void flush() }, retryMs)
        return
      }
    }
    running = false
    publish(false)
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    edit(payload) {
      draft = { ...draft, ...payload }
      persist()
      publish(true)
      void flush()
    },
    flush,
  }
}
