const FILMSTRIP_VISIBILITY_KEY = 'vault.viewer.filmstrip.visible'

export function readFilmstripVisibility() {
  try {
    const saved = window.localStorage.getItem(FILMSTRIP_VISIBILITY_KEY)
    if (saved === 'false') return false
  } catch {}
  return true
}

export function saveFilmstripVisibility(visible) {
  try {
    window.localStorage.setItem(FILMSTRIP_VISIBILITY_KEY, visible ? 'true' : 'false')
  } catch {}
}
