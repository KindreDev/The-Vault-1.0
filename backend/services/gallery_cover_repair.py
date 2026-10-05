"""Restore thumbnail URLs incorrectly stored as disk paths by gallery curation."""
from pathlib import Path

from models import Gallery


def repair_gallery_cover_urls(db, data_dir):
    root = (Path(data_dir) / 'thumbs').resolve()
    repaired = []
    rows = db.query(Gallery).filter(
        Gallery.cover_thumb.isnot(None), ~Gallery.cover_thumb.like('/thumbs/%'),
    ).all()
    for gallery in rows:
        original = gallery.cover_thumb
        path = Path(original)
        if not path.is_absolute():
            continue
        resolved = path.resolve()
        if resolved.parent != root or not resolved.is_file():
            continue
        corrected = f'/thumbs/{resolved.name}'
        gallery.cover_thumb = corrected
        repaired.append({'gallery_id': gallery.id, 'before': original, 'after': corrected})
    if repaired:
        db.commit()
    return repaired
