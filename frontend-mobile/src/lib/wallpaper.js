// Save an image to the phone, or set it as the wallpaper.
//
// On the Android app this talks to our native Wallpaper plugin
// (android/app/.../WallpaperPlugin.java): it writes the picture straight into
// the phone's gallery, or hands it to the system as the home / lock screen.
//
// On the web build (iPhone PWA, desktop browser) there is NO way for any app to
// change the wallpaper — Apple and the browsers simply don't allow it. The best
// we can offer there is the normal "share / save image" sheet.
import { Capacitor, registerPlugin } from '@capacitor/core'

const Wallpaper = registerPlugin('Wallpaper')

export function isAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

// Only the Android app can set the wallpaper. Hide those buttons everywhere else.
export function canSetWallpaper() {
  return isAndroidApp()
}

// target: 'home' | 'lock' | 'both'
export async function setWallpaper(url, target = 'both') {
  await Wallpaper.setWallpaper({ url, target })
}

// Returns how it was saved: 'saved' (into the gallery), 'shared' (share sheet),
// or 'downloaded' (browser download).
export async function saveImage(url, filename = 'vault-image.jpg') {
  if (isAndroidApp()) {
    await Wallpaper.save({ url })
    return 'saved'
  }
  // Web / iPhone: fetch the picture, then offer the OS share sheet (which has a
  // "Save Image" option), falling back to a plain download.
  const res = await fetch(url)
  const blob = await res.blob()
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] })
    return 'shared'
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  return 'downloaded'
}
