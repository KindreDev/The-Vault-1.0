import React from 'react'

const PLACEHOLDER = '/tcg-v2-pack-placeholder.svg'

function PackTile({ title, subtitle, bullets, active = false, credits = 0, pending = false, onOpen }) {
  const canAfford = credits >= 400
  return (
    <section style={{
      width: 360, padding: 18, borderRadius: 18,
      background: active ? 'color-mix(in srgb, var(--c-accent) 7%, #11111a)' : 'rgba(255,255,255,0.025)',
      border: active ? '1px solid color-mix(in srgb, var(--c-accent) 35%, transparent)' : '1px solid rgba(255,255,255,0.09)',
      opacity: active ? 1 : 0.7,
    }}>
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '3 / 4' }}>
        <img src={PLACEHOLDER} alt="Temporary booster artwork" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 'auto 0 0', padding: 20, background: 'linear-gradient(transparent, rgba(0,0,0,.9))' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{title}</div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,.72)', marginTop: 4 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ padding: '18px 4px 2px' }}>
        {bullets.map((line) => <div key={line} style={{ fontSize: 16, color: 'rgba(255,255,255,.7)', marginBottom: 8 }}>• {line}</div>)}
        {active ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            {[1, 5, 10].map(quantity => {
              const affordable = credits >= 400 * quantity
              return <button key={quantity} disabled={pending || !affordable}
                onClick={() => onOpen(quantity)} style={{
                  flex: 1, minHeight: 52, borderRadius: 10, fontSize: 16, fontWeight: 800,
                  cursor: pending || !affordable ? 'not-allowed' : 'pointer',
                  background: affordable ? 'color-mix(in srgb, var(--c-accent) 35%, #171724)' : 'rgba(255,255,255,.04)',
                  color: affordable ? '#fff' : 'rgba(255,255,255,.25)',
                  border: '1px solid color-mix(in srgb, var(--c-accent) 45%, transparent)',
                }}>{quantity}×<br/><span style={{ fontSize: 16, fontWeight: 600 }}>{(400 * quantity).toLocaleString()} CR</span></button>
            })}
          </div>
        ) : <div style={{ marginTop: 18, minHeight: 52, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 16,
          border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.45)' }}>Not currently available</div>}
      </div>
    </section>
  )
}

export default function ShopTab({ credits, openPackMutation, openFromInventoryMutation, standardPacks = 0, premiumPacks = 0 }) {
  const rewardPacks = standardPacks + premiumPacks
  return (
    <div style={{ padding: '8px 0 40px' }}>
      {rewardPacks > 0 && <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, padding: 18, borderRadius: 14,
        background: 'color-mix(in srgb, var(--c-green) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--c-green) 30%, transparent)',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{rewardPacks} earned booster{rewardPacks === 1 ? '' : 's'}</div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,.55)', marginTop: 4 }}>Old reward tokens now open the current Permanent Vault Booster.</div>
        </div>
        <button disabled={openFromInventoryMutation?.isPending}
          onClick={() => openFromInventoryMutation?.mutate({ pack_type: premiumPacks > 0 ? 'premium' : 'standard', quantity: 1 })}
          style={{ minHeight: 48, padding: '0 20px', borderRadius: 10, fontSize: 16, fontWeight: 800, cursor: 'pointer',
            color: '#fff', background: 'color-mix(in srgb, var(--c-green) 30%, #171724)', border: '1px solid color-mix(in srgb, var(--c-green) 50%, transparent)' }}>
          Open free booster
        </button>
      </div>}

      <div style={{ fontSize: 18, color: 'rgba(255,255,255,.6)', marginBottom: 18 }}>
        Published packs contain only stable TCG V2 cards. Unpublished releases cannot fall back to legacy cards.
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <PackTile active title="Permanent Vault Booster" subtitle="10 cards · 400 credits"
          credits={credits} pending={openPackMutation.isPending}
          bullets={['One guaranteed SR or better', 'Low chance at UR', 'Slim chance at an SPR parallel', 'Drawn from your finite Foundation catalogue']}
          onOpen={(quantity) => openPackMutation.mutate({ pack_type: 'vault', quantity })} />
        <PackTile title="Standard Release Booster" subtitle="6 cards"
          bullets={['One guaranteed SR or better', 'Only cards from the current monthly release', 'Available when the first release is published']} />
        <PackTile title="Premium Release Booster" subtitle="4 cards"
          bullets={['SR rarity floor', 'One guaranteed UR', 'Decent SPR chance', 'Available when the first release is published']} />
        <PackTile title="Limited All-Releases Booster" subtitle="Monthly limited event"
          bullets={['SR rarity floor', 'One guaranteed UR', 'Draws across published releases', 'Purchase quantity will be limited']} />
        <PackTile title="Weekly Protection Booster" subtitle="Quest reward only"
          bullets={['Three UR cards', 'One guaranteed SPR', 'Earned once through weekly quests', 'Not sold for credits']} />
      </div>
    </div>
  )
}
