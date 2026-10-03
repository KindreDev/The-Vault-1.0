"""Shared metadata gates for Scene publication and booster selection."""
from sqlalchemy import and_, func, or_
from models import Card, CardType, Creator, Gallery, Image


def _identity():
    return and_(func.length(func.trim(Creator.name)) > 0, Creator.creator_type.isnot(None))


def _gallery_identity():
    return or_(Gallery.creators.any(_identity()), Gallery.creator.has(_identity()))


def _image_metadata():
    return and_(
        Image.is_video.is_(False), Image.file_path.isnot(None),
        Image.width > 0, Image.height > 0,
        Image.gallery.has(and_(func.length(func.trim(Gallery.name)) > 0, Gallery.period_year > 0)),
    )


def scene_source_eligible():
    """New Scene definitions need a gallery identity the renderer can resolve."""
    return and_(_image_metadata(), Image.gallery.has(_gallery_identity()))


def renderable_scene_card():
    """Keep existing printings intact, but exclude incomplete Scenes from delivery."""
    return or_(Card.card_type != CardType.image, and_(
        Card.source_image.has(_image_metadata()),
        or_(Card.source_creator.has(_identity()),
            Card.source_image.has(Image.gallery.has(_gallery_identity()))),
    ))
