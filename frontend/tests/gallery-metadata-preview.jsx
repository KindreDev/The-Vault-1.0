import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import GalleryMetadataPanel from '../src/components/GalleryMetadataPanel'
import { galleriesApi, curationApi } from '../src/lib/api'
import '../src/index.css'
const queryClient = new QueryClient()
const originalSave = curationApi.save
let fail = false
curationApi.save = async payload => {
  await new Promise(resolve => setTimeout(resolve, 150))
  if (fail) throw Error('Isolated test: offline')
  return originalSave(payload)
}
function Preview() {
  const [visible, setVisible] = React.useState(true)
  const { data: gallery } = useQuery({ queryKey: ['gallery', '1'], queryFn: () => galleriesApi.get(1).then(r => r.data) })
  return <main style={{ padding: 24, color: 'var(--c-text)', minHeight: '100vh' }}>
    <div style={{ display: 'flex', gap: 20, marginBottom: 24 }}>
      <button onClick={() => { fail = !fail }}>Toggle save failure</button>
      <button onClick={() => setVisible(v => !v)}>Toggle panel</button>
    </div>
    <div className="gallery-details-body" style={{ padding: 14, border: '1px solid var(--c-border)', borderRadius: 10, background: 'var(--c-card)' }}>
      <div className="gallery-details-creators">Creator section — existing 70/30 split preserved</div>
      {visible && gallery && <GalleryMetadataPanel gallery={gallery} />}
    </div>
  </main>
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><Preview /></QueryClientProvider>)
