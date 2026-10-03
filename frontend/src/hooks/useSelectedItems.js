import { useRef } from 'react'

// Keep selected records when pagination replaces the visible rows.
export default function useSelectedItems(items, selected) {
  const cache = useRef(new Map())
  const keys = new Set([...selected].map(String))
  for (const key of cache.current.keys()) if (!keys.has(key)) cache.current.delete(key)
  for (const item of items || []) if (keys.has(String(item.id))) cache.current.set(String(item.id), item)
  return [...selected].map(id => cache.current.get(String(id))).filter(Boolean)
}
