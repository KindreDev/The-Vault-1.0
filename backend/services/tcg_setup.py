"""Safe, one-time transition from the shipped card collection to TCG V2."""
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Card, CardInventory, TCGSetupState


def _owned_card_query(db: Session):
    return db.query(Card).join(CardInventory, CardInventory.card_id == Card.id)


def setup_status(db: Session) -> dict:
    state = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
    enabled = bool(state and state.v2_enabled)

    legacy_card_count = (
        _owned_card_query(db)
        .filter(Card.is_legacy.is_(True))
        .distinct()
        .count()
    )
    legacy_copy_count = int(
        db.query(func.coalesce(func.sum(CardInventory.quantity), 0))
        .join(Card, CardInventory.card_id == Card.id)
        .filter(Card.is_legacy.is_(True))
        .scalar() or 0
    )
    owned_before_setup = 0
    if not enabled:
        owned_before_setup = _owned_card_query(db).distinct().count()

    from services.foundation_catalog import foundation_status
    return {
        "enabled": enabled,
        "enabled_at": state.enabled_at.isoformat() if state and state.enabled_at else None,
        "legacy_card_count": legacy_card_count,
        "legacy_copy_count": legacy_copy_count,
        "has_legacy_cards": legacy_card_count > 0,
        "owned_cards_waiting": owned_before_setup,
        "foundation": foundation_status(db),
    }


def enable_tcg_v2(db: Session) -> dict:
    """Mark the cards owned right now as Legacy, exactly once.

    The inventory join is intentional: unowned pool records are not somebody's
    old collection and must remain eligible to be minted as current cards.
    """
    state = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
    if state and state.v2_enabled:
        return setup_status(db)

    if not state:
        state = TCGSetupState(id=1)
        db.add(state)
        db.flush()

    owned_ids = [row[0] for row in db.query(CardInventory.card_id).distinct().all()]
    if owned_ids:
        (
            db.query(Card)
            .filter(Card.id.in_(owned_ids))
            .update({Card.is_legacy: True}, synchronize_session=False)
        )

    state.v2_enabled = True
    state.enabled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    state.legacy_card_count = len(owned_ids)
    db.commit()
    return setup_status(db)


def require_tcg_v2(db: Session) -> None:
    state = db.query(TCGSetupState).filter(TCGSetupState.id == 1).first()
    if not state or not state.v2_enabled:
        raise ValueError("Start the new TCG before minting cards")
