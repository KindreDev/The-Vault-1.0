import { LocalizedText, useT } from '../../i18n'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Coins, Gem } from 'lucide-react'
import { apiErrorMessage, imagesApi, tcgRoomApi } from '../../lib/api'

export const ASSET_PRESENTATION = {
  card_display_stand_white: 'Stands',
  card_display_stand_black: 'Stands',
  graded_card_stand_white: 'Stands',
  graded_card_stand_black: 'Stands',
  glass_display_case: 'Cabinets',
  glass_display_cabinet: 'Cabinets',
  floating_glass_cabinet: 'Cabinets',
  poster_frame: 'Wall decor',
}

export function getFurnitureDefinitions(catalog = []) {
  const seen = new Set()
  return catalog.filter(item => {
    if (!item.asset_id || !['floor', 'wall'].includes(item.placement_kind) || !ASSET_PRESENTATION[item.asset_id] || seen.has(item.asset_id)) return false
    seen.add(item.asset_id)
    return true
  })
}

function furnitureDescription(definition) {
  const assetId = definition.asset_id
  if (assetId === 'poster_frame') return 'A framed print of a photo from your Vault.'
  if (assetId?.includes('graded_card_stand')) return 'Holds 9 cards, 3 per row. Sits on a table or shelf.'
  if (assetId?.includes('card_display_stand')) return 'Holds 1 card. Sits on a table or shelf.'
  if (assetId === 'glass_display_case' || assetId === 'glass_display_cabinet') return 'Free-standing shelf. Card stands can sit inside its shelf levels.'
  if (assetId === 'floating_glass_cabinet') return 'Wall-mounted shelf. Card stands can sit inside its shelf levels.'
  return definition.placement_kind === 'wall' ? 'Mounts on a room wall.' : 'Furniture for the Collection Room.'
}

function vaultThumb(img) {
  if (!img) return ''
  if (img.thumb_url) return img.thumb_url
  if (img.thumb_path) return `/thumbs/${String(img.thumb_path).split(/[\\/]/).pop()}`
  return img.id ? `/api/images/${img.id}/file` : ''
}

function ProductVisual({ definition }) {
  const preview = `/tcg-room/shop/${definition.asset_id}.png`
  const { data: photos = [] } = useQuery({
    queryKey: ['room-poster-preview-photos'],
    queryFn: () => imagesApi.list({ is_video: false, sort_by: 'random', limit: 4 }).then(r => {
      const payload = r.data
      return payload?.images ?? (Array.isArray(payload) ? payload : [])
    }),
    enabled: definition.asset_id === 'poster_frame',
    staleTime: 60_000,
  })
  if (definition.asset_id === 'poster_frame') {
    const shots = photos.filter(img => vaultThumb(img)).slice(0, 3)
    return <div className="furniture-store__visual furniture-store__visual--poster_frame">
      <span><LocalizedText text={"Your photos"} /></span>
      <div className="furniture-store__poster-stack">
        {(shots.length ? shots : [null, null, null]).map((img, index) => (
          <figure key={img?.id || index} className="furniture-store__poster" style={{ transform: `rotate(${(index - 1) * 6}deg)` }}>
            {img ? <img src={vaultThumb(img)} alt="" /> : <i />}
          </figure>
        ))}
      </div>
      <small><LocalizedText text={"Vault photo poster"} /></small>
    </div>
  }
  return <div className={`furniture-store__visual furniture-store__visual--${definition.asset_id}`}>
    <img src={preview} alt={definition.name} className="furniture-store__photo" />
  </div>
}

export default function RoomFixtureShop({ bootstrap, query = '', category = 'all', sort = 'featured' }) {
  const t = useT()
  const queryClient = useQueryClient()
  const [variantByDefinition, setVariantByDefinition] = useState({})
  const definitions = useMemo(() => getFurnitureDefinitions(bootstrap?.catalog || []), [bootstrap?.catalog])
  const definitionAsset = useMemo(() => new Map((bootstrap?.catalog || []).map(item => [item.id, item.asset_id])), [bootstrap?.catalog])
  const ownedCounts = useMemo(() => (bootstrap?.owned_instances || []).reduce((counts, item) => {
    const assetId = definitionAsset.get(item.definition_id)
    if (!assetId) return counts
    return { ...counts, [assetId]: (counts[assetId] || 0) + 1 }
  }, {}), [bootstrap?.owned_instances, definitionAsset])
  const products = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = definitions.filter(item => {
      const room = ASSET_PRESENTATION[item.asset_id] || 'Furniture'
      return (category === 'all' || room === category) && (!needle || `${item.name} ${item.asset_id} ${room}`.toLowerCase().includes(needle))
    })
    if (sort === 'price-low') return [...filtered].sort((a, b) => a.unit_cost - b.unit_cost)
    if (sort === 'price-high') return [...filtered].sort((a, b) => b.unit_cost - a.unit_cost)
    if (sort === 'name') return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    return filtered
  }, [category, definitions, query, sort])
  const purchase = useMutation({
    mutationFn: ({ definition, requestKey }) => tcgRoomApi.purchaseFurniture({ definition_id: definition.id, variant_key: variantByDefinition[definition.id] || definition.variants?.[0] || 'default', request_key: requestKey }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }); queryClient.invalidateQueries({ queryKey: ['tcg-room-furniture'] }); queryClient.invalidateQueries({ queryKey: ['tcg-v2-summary'] }); toast.success(t("Added to Furniture Inventory")) },
    onError: error => toast.error(apiErrorMessage(error, t("Could not purchase that furniture"))),
  })
  return <section className="furniture-store furniture-store--embedded">
    {products.length > 0 && <h2 className="furniture-store__section-title"><LocalizedText text={"Furniture"} /><span>{products.length}</span></h2>}
    <div className="furniture-store__grid">{products.map(definition => <article key={definition.id}>
      <ProductVisual definition={definition} />
      <div className="furniture-store__body"><h3>{definition.name}</h3><p>{furnitureDescription(definition)}</p><div className="furniture-store__owned">{ownedCounts[definition.asset_id] ? `${ownedCounts[definition.asset_id]} owned` : <LocalizedText text={"Not owned"} />}</div></div>
      <footer><div><span><LocalizedText text={"Price"} /></span><strong>{definition.currency === 'credits' ? <Coins size={19} /> : <Gem size={19} />} {Number(definition.unit_cost || 0).toLocaleString()} <LocalizedText text={definition.currency === 'credits' ? "Credits" : "Shards"} before={" "} /></strong></div><button disabled={purchase.isPending} onClick={() => purchase.mutate({ definition, requestKey: crypto.randomUUID() })}>{purchase.isPending && purchase.variables?.definition.id === definition.id ? 'Adding…' : 'Add to inventory'}</button></footer>
    </article>)}</div>
  </section>
}
