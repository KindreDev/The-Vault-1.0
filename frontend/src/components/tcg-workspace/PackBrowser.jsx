import { useEffect, useMemo, useState } from 'react'
import { LockKeyhole, PackageOpen, ShieldCheck } from 'lucide-react'
import './PackBrowser.css'

const RARITY_LABELS = { C: 'Common', R: 'Rare', SR: 'Super Rare', UR: 'Ultra Rare', SPR: 'Special Rare' }
const RARITY_ORDER = { C: 0, R: 1, SR: 2, UR: 3, SPR: 4 }
const GUARANTEE_RARITIES = ['SPR', 'UR', 'SR', 'R', 'C']
const WRAPPER_ASSETS = {
  permanent: '/tcg-booster-permanent-cutout.png',
  release_standard: '/tcg-booster-standard-cutout.png',
  release_premium: '/tcg-booster-premium-cutout.png',
  limited: '/tcg-booster-limited-cutout.png',
  weekly_protection: '/tcg-booster-limited-cutout.png',
}

function OddsDisclosure({ pack }) {
  const weighted = pack.odds?.weighted_slots || pack.odds || {}
  const odds = Object.entries(weighted).filter(([, value]) => Number.isFinite(Number(value)))
  const total = odds.reduce((sum, [, value]) => sum + Number(value), 0) || 1
  return (
    <details className="tcgws-pack-integrity">
      <summary><ShieldCheck size={17} /> Probabilities</summary>
      <div className="tcgws-odds-panel">
        <section>
          <h3>Chance per random slot</h3>
          <div className="tcgws-odds-list">
            {odds.map(([rarity, value]) => {
              const percent = (Number(value) / total) * 100
              return <div key={rarity} className="tcgws-odds-row" data-rarity={rarity}>
                <span><b>{rarity}</b>{RARITY_LABELS[rarity] || rarity}</span>
                <i><em style={{ width: `${Math.max(1, percent)}%` }} /></i>
                <strong>{percent < 1 ? percent.toFixed(2) : percent.toFixed(1)}%</strong>
              </div>
            })}
          </div>
        </section>
      </div>
    </details>
  )
}

function guaranteedLine(pack) {
  const slots = Array.isArray(pack.guaranteed_slots) ? pack.guaranteed_slots : []
  const rarity = slots
    .map(slot => {
      const normalized = String(slot).toUpperCase()
      return GUARANTEE_RARITIES.find(value => normalized === value || normalized.startsWith(`${value}_`))
    })
    .filter(Boolean)
    .sort((left, right) => RARITY_ORDER[right] - RARITY_ORDER[left])
  if (rarity.length) {
    const highest = rarity[0]
    const count = rarity.filter(value => value === highest).length
    return `${count} ${highest} guaranteed`
  }
  if (pack.rarity_floor) return `1 ${pack.rarity_floor} guaranteed`
  return 'Published odds'
}

function legacyPoolSummary(pack) {
  const releaseName = pack.release_name || pack.release?.name
  const setCount = pack.set_count ?? pack.release_set_count
  if (releaseName && setCount) return `${releaseName} · ${setCount} sets`
  if (releaseName) return `From ${releaseName}`
  const scope = pack.eligible_pool?.scope || pack.eligible_pool?.status
  if (scope) return String(scope).replaceAll('_', ' ')
  if (pack.product_kind === 'permanent') return 'Permanent Vault pool'
  if (pack.product_kind === 'weekly_protection') return 'Your selected release'
  return 'Published Vault pool'
}

function poolSummary(pack) {
  if (pack.pool_summary) return pack.pool_summary
  const releaseName = pack.release_name || pack.release?.name
  const setCount = pack.set_count ?? pack.release_set_count
  if (releaseName && setCount) return `${releaseName} - ${setCount} sets`
  if (releaseName) return `From ${releaseName}`
  const scope = pack.eligible_pool?.scope || pack.eligible_pool?.status
  if (scope) return String(scope).replaceAll('_', ' ')
  if (pack.product_kind === 'permanent') return 'Permanent Vault pool'
  if (pack.product_kind === 'weekly_protection') return 'Your selected release'
  return 'Published Vault pool'
}

function formatRemaining(milliseconds) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.ceil(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

function availabilityMessage(pack, now) {
  if (pack.product_kind === 'weekly_protection') return 'Earned by completing the weekly quest'
  const availableFrom = pack.available_from ? Date.parse(pack.available_from) : NaN
  const availableUntil = pack.available_until ? Date.parse(pack.available_until) : NaN
  if (!pack.active && Number.isFinite(availableFrom) && availableFrom > now) {
    return `Available in ${formatRemaining(availableFrom - now)}`
  }
  if (pack.active && Number.isFinite(availableUntil) && availableUntil > now) {
    return `Available for ${formatRemaining(availableUntil - now)}`
  }
  if (!pack.active) return 'Not currently scheduled'
  return null
}

function stablePackSeed(value) {
  return [...String(value ?? '')].reduce((hash, character) => ((hash * 31) + character.codePointAt(0)) >>> 0, 7)
}

function frozenPackArt(pack = {}) {
  const urls = Array.isArray(pack.snapshot_art_urls) ? pack.snapshot_art_urls.filter(Boolean) : []
  if (urls.length) return urls
  if (pack.snapshot_art_url) return [pack.snapshot_art_url]
  if (pack.snapshot_art_image_id) return [`/api/images/${Number(pack.snapshot_art_image_id)}/file`]
  return []
}

export function BoosterEnvelope({ pack, images }) {
  const frozenArt = useMemo(() => frozenPackArt(pack), [pack])
  const art = frozenArt.length ? frozenArt : images
  const slots = useMemo(() => {
    const source = art || []
    const size = Math.max(1, source.length)
    const seed = stablePackSeed(pack.id ?? pack.code ?? pack.name)
    return Array.from({ length: 3 }, (_, index) => source[(seed + index) % size])
  }, [pack.id, pack.code, pack.name, art])
  return <div className={`tcgws-booster tcgws-booster--${pack.product_kind}`}>
    <div className="tcgws-booster-crimp top" />
    <div className="tcgws-booster-collage">{slots.map((image, index) => image && <img key={`${image}-${index}`} src={image} style={{ '--slot': index }} />)}</div>
    <div className="tcgws-booster-foil" />
    <div className="tcgws-booster-copy"><span>THE VAULT</span><strong>{pack.name}</strong><small>{pack.card_count} CARD BOOSTER</small></div>
    <div className="tcgws-booster-crimp bottom" />
  </div>
}

export default function PackBrowser({ packs, inventory, releases, onOpenPack, pending = false, pendingPackId = null, orderMode = false }) {
  const [selectedReleases, setSelectedReleases] = useState({})
  const [now, setNow] = useState(() => Date.now())
  const images = (inventory || []).map(card => card.thumb_url || card.image_url).filter(Boolean).slice(0, 30)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return <section className="tcgws-packs">
    <header><span>Booster ecosystem</span><h1>Published Products</h1></header>
    <div className="tcgws-pack-grid">{packs.map(pack => {
      const schedule = availabilityMessage(pack, now)
      const wrapperSrc = WRAPPER_ASSETS[pack.product_kind] || WRAPPER_ASSETS.permanent
      const openingProduct = {
        ...pack,
        wrapper_src: pack.wrapper_src || wrapperSrc,
        wrapper_identity: { code: pack.code, name: pack.name, product_kind: pack.product_kind },
        collage_images: images,
      }
      const isWeekly = pack.product_kind === 'weekly_protection'
      const canOpen = pack.active && (pack.purchasable || pack.tokens > 0)
      return <article key={pack.id}>
      <BoosterEnvelope pack={pack} images={images} />
      <section><span>{pack.product_kind.replaceAll('_', ' ')}</span><h2>{pack.name}</h2>
        <div className="tcgws-pack-facts"><p><PackageOpen size={16} />{pack.card_count} Cards</p><p><ShieldCheck size={16} />{guaranteedLine(pack)}</p><span>{poolSummary(pack)}</span></div>
        <OddsDisclosure pack={pack} />
        {isWeekly && pack.tokens > 0 && <label className="tcgws-pack-release"><span>Choose release</span><select value={selectedReleases[pack.id] || ''} onChange={event => setSelectedReleases(current => ({ ...current, [pack.id]: Number(event.target.value) }))}><option value="">Select a frozen release</option>{releases.filter(release => release.status === 'published').map(release => <option key={release.id} value={release.id}>{release.name}</option>)}</select></label>}
        {canOpen ? <button className="tcgws-primary" disabled={pending || (isWeekly && !selectedReleases[pack.id])} onClick={() => onOpenPack(openingProduct, selectedReleases[pack.id] || null)}>{pending && pendingPackId === pack.id ? <><PackageOpen size={16} className="tcgws-pack-button-spin" /> {orderMode ? 'Ordering...' : 'Preparing...'}</> : orderMode && !isWeekly ? `Order online - ${pack.price.toLocaleString()} Credits` : isWeekly ? 'Weekly quest reward' : pack.tokens > 0 ? `Open token (${pack.tokens})` : `${pack.price.toLocaleString()} Credits`}</button> : <button disabled><LockKeyhole size={16} />{isWeekly ? 'Weekly quest reward' : schedule || (pack.purchasable ? 'Not currently scheduled' : 'Coming soon')}</button>}
      </section>
    </article>
    })}</div>
  </section>
}
