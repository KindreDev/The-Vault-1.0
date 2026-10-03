import assert from 'node:assert/strict'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { refreshAfterMutation, createTaskRefreshTracker } from '../../shared/queryRefresh.mjs'

const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } } })
const watches = []
const observe = (key, read) => {
  const observer = new QueryObserver(client, { queryKey: key, queryFn: read })
  watches.push(observer.subscribe(() => {}))
  return observer
}
try {
  // Reproduce visiting a gallery, leaving it, assigning in the list, and
  // returning before the original detail's freshness window expires.
  let assigned = false
  const galleryKey = ['gallery', '42']
  const mediaKey = ['gallery-images', '42', 'date_added']
  await client.fetchQuery({ queryKey: galleryKey, queryFn: async () => ({ creators: assigned ? [7] : [] }) })
  await client.fetchQuery({ queryKey: mediaKey, queryFn: async () => [{ id: 12, creators: assigned ? [7] : [] }] })
  client.setQueryData(['gallery', 42], { creators: [] })
  assigned = true
  await refreshAfterMutation(client, { method: 'post', url: '/galleries/bulk-assign' }, { updated: 1 })
  assert.equal(client.getQueryState(galleryKey).isInvalidated, true)
  assert.equal(client.getQueryState(['gallery', 42]).isInvalidated, true)
  assert.equal(client.getQueryState(mediaKey).isInvalidated, true)
  const detail = observe(galleryKey, async () => ({ creators: assigned ? [7] : [] }))
  await detail.refetch()
  assert.deepEqual(detail.getCurrentResult().data.creators, [7])

  let releaseOldRead
  const oldRead = new Promise(resolve => { releaseOldRead = resolve })
  let readCount = 0
  const racing = observe(['gallery', 'newly-opened'], () => ++readCount === 1 ? oldRead : Promise.resolve({ creators: [7] }))
  await refreshAfterMutation(client, { method: 'post', url: '/galleries/bulk-assign' }, {})
  releaseOldRead({ creators: [] })
  await Promise.resolve()
  assert.deepEqual(racing.getCurrentResult().data.creators, [7], 'pre-write read must not replace the updated detail')

  // Mounted widgets actually refetch, while unmounted analytics are marked
  // stale for their next visit. No global freshness reduction is required.
  let sessions = []
  let credits = 1000
  const recent = observe(['recent-sessions'], async () => sessions)
  const totals = observe(['ses-stats', 180], async () => ({ sessions: sessions.length }))
  const wallet = observe(['profile'], async () => ({ vault_credits: credits }))
  await Promise.all([recent.refetch(), totals.refetch(), wallet.refetch()])
  client.setQueryData(['analytics', 'month', 'day', 'duration'], { sessions: 0 })
  client.setQueryData(['recent-sessions-profile'], [])
  sessions = [{ id: 1 }]
  await refreshAfterMutation(client, { method: 'post', url: '/sessions/' }, {})
  assert.equal(recent.getCurrentResult().data.length, 1)
  assert.equal(totals.getCurrentResult().data.sessions, 1)
  assert.equal(client.getQueryState(['recent-sessions-profile']).isInvalidated, true)
  assert.equal(client.getQueryState(['analytics', 'month', 'day', 'duration']).isInvalidated, true)

  // Rating must refresh an already-open quest panel as well as a cached one.
  let questProgress = 0
  const quests = observe(['quests'], async () => [{ key: 'rate_galleries', progress: questProgress }])
  await quests.refetch()
  client.setQueryData(['quests', 'daily'], [{ progress: 0 }])
  for (const method of ['post', 'patch', 'post']) {
    questProgress += 1
    await refreshAfterMutation(client, { method, url: method === 'post' ? '/galleries/42/rate' : '/galleries/42' }, {})
    assert.equal(quests.getCurrentResult().data[0].progress, questProgress)
  }
  assert.equal(client.getQueryState(['quests', 'daily']).isInvalidated, true)

  client.setQueryData(['creator', '7'], { cum_count: 0 })
  client.setQueryData(['images-list'], [{ cum_count: 0 }])
  await refreshAfterMutation(client, { method: 'post', url: '/images/12/cum' }, {})
  assert.equal(client.getQueryState(['creator', '7']).isInvalidated, true)
  assert.equal(client.getQueryState(['images-list']).isInvalidated, true)
  client.setQueryData(['creator-stats', 7], { edges: 0 })
  await refreshAfterMutation(client, { method: 'post', url: '/images/edge' }, {})
  assert.equal(client.getQueryState(['creator-stats', 7]).isInvalidated, true)

  credits = 820
  await refreshAfterMutation(client, { method: 'post', url: '/tcg-room/furniture/purchase' }, {})
  assert.equal(wallet.getCurrentResult().data.vault_credits, 820)
  credits = 700
  await refreshAfterMutation(client, { method: 'post', url: '/tcg-room/orders' }, {})
  assert.equal(wallet.getCurrentResult().data.vault_credits, 700)

  for (const key of ['creators-all', 'curation-creators', 'creators', 'favorites']) client.setQueryData([key], [])
  await refreshAfterMutation(client, { method: 'patch', url: '/creators/7' }, {})
  for (const key of ['creators-all', 'curation-creators', 'creators', 'favorites']) assert.equal(client.getQueryState([key]).isInvalidated, true, key)

  for (const key of ['tag-stats', 'cat-samples', 'tags', 'tags-all']) client.setQueryData([key], {})
  await refreshAfterMutation(client, { method: 'post', url: '/tags/merge' }, {})
  for (const key of ['tag-stats', 'cat-samples', 'tags', 'tags-all']) assert.equal(client.getQueryState([key]).isInvalidated, true, key)

  client.setQueryData(['image', '12'], { rating: 0 })
  client.setQueryData(['photo-view', '12'], [{ rating: 0 }])
  client.setQueryData(['gallery-images', 42], [{ rating: 0 }])
  await refreshAfterMutation(client, { method: 'PATCH', url: 'http://127.0.0.1:8000/api/images/12' }, {})
  for (const key of [['image', '12'], ['photo-view', '12'], ['gallery-images', 42]]) assert.equal(client.getQueryState(key).isInvalidated, true)

  client.setQueryData(['images-list'], [])
  await refreshAfterMutation(client, { method: 'get', url: '/images/' }, {})
  await refreshAfterMutation(client, { method: 'post', url: '/galleries/bulk-images' }, [])
  await refreshAfterMutation(client, { method: 'post', url: '/tcg-traders/grade/quote' }, {})
  assert.equal(client.getQueryState(['images-list']).isInvalidated, false, 'reads and quotes must not cause refresh loops')

  // A scan can finish between status polls; don't require seeing running=true.
  // Don't replay history on boot or refresh the same completed job twice.
  const track = createTaskRefreshTracker(client)
  const scan = { id: 'tiny-scan', type: 'scan', status: 'done', finished_at: 'now' }
  await track({ history: [] })
  client.setQueryData(['vault-stats'], { count: 0 })
  await track({ current: null, history: [scan] })
  assert.equal(client.getQueryState(['vault-stats']).isInvalidated, true)
  client.setQueryData(['vault-stats'], { count: 1 })
  await track({ history: [scan] })
  assert.equal(client.getQueryState(['vault-stats']).isInvalidated, false)
  const boot = createTaskRefreshTracker(client)
  await boot({ history: [scan] })
  assert.equal(client.getQueryState(['vault-stats']).isInvalidated, false)
  for (const type of ['ai_tag', 'video_duration', 'resolve_missing']) {
    client.setQueryData(['vault-stats'], {})
    await track({ history: [{ id: type, type, status: 'cancelled', finished_at: 'later' }, scan] })
    assert.equal(client.getQueryState(['vault-stats']).isInvalidated, true, `partial ${type} results`)
  }
  console.log('Query refresh regression checks passed: cached gallery navigation, live sessions/wallets, creator menus, tags, mobile media, read-only requests, and fast/partial background jobs.')
} finally {
  watches.forEach(unsubscribe => unsubscribe())
  client.clear()
}
