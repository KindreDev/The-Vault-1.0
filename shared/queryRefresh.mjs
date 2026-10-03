// Both clients use the same dependency rules. Invalidate inactive queries too:
// navigation must not reuse a still-fresh detail fetched before a mutation.
const MEDIA = [
  'galleries', 'gallery', 'gallery-images', 'subgalleries', 'gallery-periods',
  'images-list', 'images', 'image', 'photo-view', 'image-periods', 'tag-images',
  'creator-galleries', 'creator-media', 'creator-top', 'creator-discovery',
  'playlist-detail', 'recent-galleries', 'recent', 'random-galleries',
  'random-images', 'random-videos', 'disc-galleries', 'disc-photos', 'disc-videos',
  'similar-galleries', 'room-poster-library',
]
const CREATORS = [
  'creator', 'creators', 'creators-all', 'curation-creators', 'creators-list-tagger',
  'favorites', 'random-creators', 'disc-creators', 'creator-stats', 'creator-dist',
  'creators-by-country', 'franchises', 'top-collections', 'collection-creators',
  'feed-profile', 'persona-creator',
]
const TAGS = ['tags', 'tags-all', 'tag-stats', 'cat-samples', 'tag-images',
  'trending-tags', 'top-tags', 'co-occurring-tags']
const STATS = ['vault-stats', 'stats', 'ses-stats', 'creator-stats', 'creator-dist',
  'analytics', 'analytics-top-n', 'analytics-comparison', 'recap', 'recap-availability']
const REWARDS = ['profile', 'economy-balance', 'quests', 'achievements', 'xp-history']
const RANKINGS = ['hof', 'gallery-hof', 'creator-hof', 'top-collections']
const CARDS = ['card-inventory', 'card-inventory-feed', 'card-rarity-dist', 'epic-cards-strip',
  'forge-materials', 'tcg-v2-setup', 'tcg-v2-summary', 'tcg-v2-catalog',
  'tcg-v2-catalog-filter-options', 'tcg-v2-card', 'tcg-room-card-detail', 'trader-card',
  'tcg-v2-packs', 'tcg-v2-binders', 'tcg-v2-binder', 'tcg-v2-workshop',
  'tcg-v2-checklist', 'tcg-room-copies', 'tcg-room-inventory', 'tcg-room-visible-cards',
  'tcg-room-bootstrap', 'showcase-eligible', 'creator-showcase']
const LIBRARY = [...MEDIA, ...CREATORS, ...TAGS, ...STATS, ...RANKINGS,
  'curation-debt', 'missing-galleries', 'dedup-stats', 'dedup-gallery-overlaps']

function requestPath(config) {
  const url = String(config?.url || '').split('?')[0]
  return url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '').replace(/\/$/, '')
}

export function mutationQueryRoots(config, data) {
  if (!['post', 'put', 'patch', 'delete'].includes(String(config?.method).toLowerCase())) return []
  const path = requestPath(config)
  const roots = new Set()
  const add = (...groups) => groups.flat().forEach(key => roots.add(key))

  // These POSTs only read/preview data or launch an OS picker.
  if (/\/(quote|offer|simulate|bulk-images|pick-folder|export-zip|suggest|plan)$/.test(path)) return []

  if (/^\/(images|galleries)\/[^/]+\/(view|duration)$/.test(path)) {
    // Frequent watch-time writes must not reshuffle/refetch entire media grids.
    add(STATS, RANKINGS, REWARDS, ['gallery', 'creator'])
  } else if (/^\/(images|galleries)(\/|$)/.test(path)) {
    add(MEDIA, STATS, RANKINGS, REWARDS, ['curation-debt'])
    if (/\/(cum|edge)$/.test(path)) add(CREATORS)
    if (/creator|bulk-assign|bulk-clear/.test(path)) add(CREATORS)
    if (/tags/.test(path)) add(TAGS)
    if (config.method?.toLowerCase() === 'delete' || /bulk-delete|extract|mix|merge/.test(path)) add(LIBRARY)
  } else if (/^\/creators(\/|$)/.test(path)) {
    add(CREATORS, MEDIA, STATS, RANKINGS, REWARDS, ['curation-debt'])
    if (/showcase/.test(path)) add(['creator-showcase', 'showcase-eligible', 'feed-dm'])
  } else if (/^\/sessions(\/|$)/.test(path)) {
    add(MEDIA, CREATORS, STATS, RANKINGS, REWARDS, ['all-sessions', 'recent-sessions', 'recent-sessions-profile'], CARDS)
  } else if (/^\/tags(\/|$)/.test(path)) {
    add(TAGS, MEDIA, STATS, ['curation-debt'])
  } else if (/^\/(curation|relocate)(\/|$)/.test(path)) {
    add(LIBRARY, REWARDS)
  } else if (/^\/gamification(\/|$)/.test(path)) {
    add(REWARDS, CARDS, STATS)
  } else if (/^\/(cards|tcg-v2)(\/|$)/.test(path)) {
    add(CARDS, REWARDS)
    if (/releases|bootstrap|foundation/.test(path)) add(['tcg-v2-releases', 'tcg-v2-release', 'tcg-v2-sets'])
  } else if (/^\/tcg-room(\/|$)/.test(path) && !path.startsWith('/tcg-room/module')) {
    add(['tcg-room-bootstrap', 'tcg-room-furniture', 'tcg-room-inventory'])
    if (/purchase|orders|\/open$/.test(path)) add(CARDS, REWARDS)
    if (/copies|assignment|\/return$/.test(path)) add(CARDS)
  } else if (/^\/tcg-traders(\/|$)/.test(path) && /accept|\/grade$/.test(path)) {
    add(CARDS, REWARDS, ['tcg-trader', 'tcg-trader-history', 'tcg-trader-barter-quote', 'tcg-trader-grade-quote'])
  } else if (/^\/scanner(\/|$)/.test(path)) {
    add(['library-roots', 'scan-status', 'scan-status-modal', 'task-queue', 'ai-tag-status'])
    if (/reconcile|resolve|relink|missing-galleries|match-funscripts/.test(path)) add(LIBRARY)
  } else if (/^\/tasks(\/|$)/.test(path)) {
    add(['task-queue', 'scan-status', 'ai-tag-status'])
  } else if (/^\/intake\/(commit|commit-folders)/.test(path)) {
    add(LIBRARY, REWARDS)
  }
  const xp = data?.xp || data?.xp_event || (data?.total_xp !== undefined ? data : null)
  if (xp || data?.xp_earned !== undefined || data?.credits_earned !== undefined) add(REWARDS)
  if (xp?.packs_awarded) add(CARDS)
  return [...roots]
}

export async function invalidateQueryRoots(client, roots) {
  const affected = new Set(roots)
  if (!affected.size) return
  const filters = { predicate: query => affected.has(query.queryKey[0]) }
  // Cancel even an initial read with no cached data. Otherwise an old request
  // can finish after the write and make the just-invalidated query fresh again.
  await client.cancelQueries(filters)
  return client.invalidateQueries(filters)
}

export function refreshAfterMutation(client, config, data) {
  return invalidateQueryRoots(client, mutationQueryRoots(config, data))
}

// Queue history catches tiny jobs that finish between polls, as well as partial
// changes left by a cancelled/failed/paused job. Baseline history is not replayed.
export function createTaskRefreshTracker(client) {
  let seen = null
  return state => {
    if (!state) return Promise.resolve()
    const history = state.history || []
    const identities = new Set(history.map(task => `${task.id}:${task.finished_at}:${task.status}`))
    const changed = seen === null ? [] : history.filter(task => !seen.has(`${task.id}:${task.finished_at}:${task.status}`))
    seen = identities
    const roots = new Set()
    for (const task of changed) {
      if (['scan', 'ai_tag', 'regen_thumbs', 'purge_thumbs', 'video_duration', 'resolve_missing'].includes(task.type)) {
        LIBRARY.forEach(key => roots.add(key))
        roots.add('video-duration-status')
        roots.add('scan-log')
      }
    }
    return invalidateQueryRoots(client, [...roots])
  }
}
