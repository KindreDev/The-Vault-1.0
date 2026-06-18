// True fullscreen for the photo/video viewer. Uses our own native Immersive
// plugin (android/app/.../ImmersivePlugin.java), which hides BOTH the top status
// bar (time/battery/notifications) and the bottom navigation bar. The old
// @capacitor/status-bar approach only hid the status bar and did so unreliably.
import { Capacitor, registerPlugin } from '@capacitor/core'

const Immersive = registerPlugin('Immersive')

export async function enterImmersive() {
  try {
    if (!Capacitor.isNativePlatform()) return
    await Immersive.enter()
  } catch (_) {}
}

export async function exitImmersive() {
  try {
    if (!Capacitor.isNativePlatform()) return
    await Immersive.exit()
  } catch (_) {}
}
