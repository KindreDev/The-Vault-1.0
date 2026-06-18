import { abs } from './server.js'

// Gallery cover thumbnails arrive as a ready-to-use '/thumbs/xxx.jpg' path.
export function coverUrl(gallery) {
  return gallery?.cover_thumb ? abs(gallery.cover_thumb) : null
}

// Image thumbnails: thumb_path may be an absolute disk path or a '/thumbs/..'
// fragment. Normalise to the served '/thumbs/<filename>' form, falling back to
// the full-resolution file route when no thumbnail exists.
export function imageThumbUrl(img) {
  if (!img) return null
  if (img.thumb_path) {
    const norm = img.thumb_path.replace(/\\/g, '/')
    const name = norm.includes('/thumbs/') ? norm.split('/thumbs/').pop() : norm.split('/').pop()
    return abs(`/thumbs/${name}`)
  }
  return abs(`/api/images/${img.id}/file`)
}

// Full-resolution image or video stream.
export function imageFileUrl(img) {
  return abs(`/api/images/${img.id}/file`)
}

export function creatorAvatarUrl(id, size = 480) {
  return abs(`/api/creators/${id}/avatar-thumb?size=${size}`)
}

export function creatorBannerUrl(id) {
  return abs(`/api/creators/${id}/banner`)
}
