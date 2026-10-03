// Open /tests/cache-refresh.html on the desktop dev server. Visit detail first,
// then list, Select the mock gallery, Assign its creator, and return to detail.
// The creator must appear without reload. The probe also checks session counts
// and preserving a dirty note through a metadata refresh.
// Interactive regression fixture. The production API client's adapter is
// replaced before mounting: every read/write below stays in memory.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import api, { sessionsApi } from '../src/lib/api'
import queryClient from '../src/lib/queryClient'
import GalleryList from '../src/pages/GalleryList'
import GalleryView from '../src/pages/GalleryView'
import { useViewerDataSync } from '../src/hooks/useViewerDataSync'
import '../src/index.css'

const creator = { id: -9003, name: 'Regression Creator', creator_type: 'custom', rating: 0, gallery_count: 1 }
const gallery = { id: -9001, name: 'Refresh regression gallery', folder_path: '__manual__cache-regression',
  image_count: 0, video_count: 0, cum_count: 0, view_count: 0, rating: 0, creators: [], tags: [] }
const image = { id: -9002, rating: 2, cum_count: 0, notes: 'saved note', tags: [], creators: [] }
const calls = []
api.defaults.adapter = async config => {
  const path = config.url.replace(/\/$/, '')
  const method = config.method.toLowerCase()
  calls.push(`${method} ${path}`)
  let data
  if (method === 'get') {
    if (path === '/galleries/-9001') data = gallery
    else if (path === '/galleries') data = [gallery]
    else if (path === '/creators') data = [creator]
    else if (path === '/images/-9002') data = image
    else if (path === '/gamification/profile') data = { total_xp: 0, vault_credits: 1000, level: 1 }
    else if (path.endsWith('/periods')) data = { periods: [] }
    else data = []
  } else if (path === '/galleries/bulk-assign') {
    gallery.creators = [creator]
    gallery.creator_id = creator.id
    data = { updated: 1 }
  } else if (path === '/sessions') {
    image.cum_count++
    data = { id: 1, orgasm: { images_credited: 1 } }
  } else if (path === '/images/-9002' && method === 'patch') {
    Object.assign(image, JSON.parse(config.data))
    data = image
  } else if (path.endsWith('/view')) data = { view_count: 1 }
  else throw new Error(`Unexpected fixture write: ${method} ${path}`)
  return { data: structuredClone(data), status: 200, statusText: 'OK', headers: { 'x-total-count': '1' }, config }
}
queryClient.clear()

function ViewerProbe() {
  const { data } = useQuery({ queryKey: ['image', '-9002'], queryFn: () => api.get('/images/-9002').then(r => r.data) })
  const [rating, setRating] = useState(2)
  const [isFavorite, setIsFavorite] = useState(false)
  const [cumCount, setCumCount] = useState(0)
  const [localTags, setLocalTags] = useState([])
  const [localCreators, setLocalCreators] = useState([])
  const [hasImageCreators, setHasImageCreators] = useState(false)
  const [fileCreatorIds, setFileCreatorIds] = useState([])
  const [notes, setNotes] = useState('saved note')
  useViewerDataSync(data, { setRating, setIsFavorite, setCumCount, setLocalTags,
    setLocalCreators, setHasImageCreators, setFileCreatorIds, setNotes })
  return <section style={{ padding: 12, border: '1px solid #aaa' }}>
    <h2>Open viewer synchronization probe</h2>
    <output data-testid="viewer-counter">Counter: {cumCount}</output>
    <output data-testid="viewer-rating"> · Rating: {rating}</output>
    <textarea aria-label="Viewer draft" style={{ color: '#eee', background: '#222', margin: '0 16px', padding: 8, width: 320 }} value={notes} onChange={event => setNotes(event.target.value)} />
    <button style={{ marginRight: 16 }} onClick={() => sessionsApi.log({ count_orgasm: true })}>Finish fixture session</button>
    <button onClick={() => api.patch('/images/-9002', { rating: 8, notes: 'updated server note' })}>Edit fixture metadata</button>
  </section>
}
function Fixture() {
  const navigate = useNavigate()
  return <>
    <header style={{ padding: 16, position: 'sticky', top: 0, zIndex: 999, background: '#20202d', display: 'flex', gap: 24 }}>
      <strong>ISOLATED MOCK DATA — no live collection writes</strong>
      <button onClick={() => navigate('/galleries')}>Fixture gallery list</button>
      <button onClick={() => navigate('/galleries/-9001')}>Fixture gallery detail</button>
    </header>
    <ViewerProbe />
    <main><Routes>
      <Route path="/galleries" element={<GalleryList />} />
      <Route path="/galleries/:id" element={<GalleryView />} />
    </Routes></main>
  </>
}
const root = createRoot(document.getElementById('root'))
root.render(
  <QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/galleries/-9001']}><Fixture /></MemoryRouter></QueryClientProvider>
)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
