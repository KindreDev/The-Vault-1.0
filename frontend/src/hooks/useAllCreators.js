import { useQuery } from '@tanstack/react-query'
import { creatorsApi } from '../lib/api'

/**
 * Canonical creator-list query — the single source of truth for "give me all
 * creators" anywhere in the app (filter dropdowns, assignment menus, companion,
 * etc.).
 *
 * WHY THIS EXISTS:
 * Multiple components used to call useQuery with the SAME key `['creators-mini']`
 * but DIFFERENT limits (some 200, some 5000). React Query identifies a query by
 * its key alone and runs only ONE of the fetch functions, sharing that result
 * with every consumer. Whichever component fetched first won the race — so the
 * 200-limit fetchers would frequently cap the cache at 200 creators, truncating
 * the gallery sort dropdown (it stopped around the letter "M"). Reloading just
 * re-ran the race and sometimes the 5000 fetch won. Centralising the query here
 * makes the key, the limit and the data shape identical for everyone, so the
 * race can no longer produce a truncated list.
 *
 * The backend `/creators/` endpoint returns `List[CreatorOut]` (a plain array),
 * so `r.data` is always the array.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult} query result whose
 *          `.data` is the creator array (defaults to [] until loaded).
 */
export function useAllCreators() {
  const query = useQuery({
    queryKey: ['creators-all', 5000],
    queryFn: () => creatorsApi.list({ limit: 5000 }).then(r => r.data ?? []),
    staleTime: 60_000,
  })
  return { ...query, data: query.data ?? [] }
}
