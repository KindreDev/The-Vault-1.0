/**
 * React-facing wrapper around lib/session.js.
 *
 * The real logic lives there so the global hotkey dispatcher — which isn't a
 * component — runs the identical path. Pages get `sessionActive` reactively
 * from the store.
 */
import { useVaultStore } from '../store/vault'
import { startSessionNow, finishSessionNow } from '../lib/session'

export function useSession() {
  const sessionActive = useVaultStore(s => s.sessionActive)
  return {
    sessionActive,
    startSession:  startSessionNow,
    finishSession: finishSessionNow,
  }
}
