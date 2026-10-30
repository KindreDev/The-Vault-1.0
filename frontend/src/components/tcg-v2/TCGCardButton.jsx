import TCGV2CardFace from './TCGV2CardFace'

// A clickable card face at a fixed width, for places outside the collection
// (creator showcase, creator stats) that show owned cards.
export default function TCGCardButton({ card, width = 168, onClick, title }) {
  return (
    <button type="button" onClick={onClick} title={title || card?.card_code || card?.display_name}
            className="block cursor-pointer rounded-[12px] transition-transform hover:-translate-y-0.5"
            style={{ width, padding: 0, border: 0, background: 'transparent' }}>
      <TCGV2CardFace card={card} width="100%" showEffects />
    </button>
  )
}
