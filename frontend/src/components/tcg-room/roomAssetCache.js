export function createAssetReferenceTracker(schedule = callback => setTimeout(callback, 0), cancel = handle => clearTimeout(handle)) {
  const entries = new Map()

  return {
    retain(url) {
      const entry = entries.get(url) || { count: 0, pending: null, generation: 0 }
      if (entry.pending !== null) cancel(entry.pending)
      entry.pending = null
      entry.generation += 1
      entry.count += 1
      entries.set(url, entry)
    },
    release(url, cleanup) {
      const entry = entries.get(url)
      if (!entry) return
      entry.count = Math.max(0, entry.count - 1)
      if (entry.count) return
      if (entry.pending !== null) cancel(entry.pending)
      const generation = ++entry.generation
      entry.pending = schedule(() => {
        const current = entries.get(url)
        if (!current || current !== entry || current.count || current.generation !== generation) return
        entries.delete(url)
        cleanup()
      })
    },
    count(url) {
      return entries.get(url)?.count || 0
    },
  }
}

export const roomAssetReferences = createAssetReferenceTracker()
