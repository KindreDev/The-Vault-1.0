// Keep polling across the installer handoff; a fresh process must report the
// requested version before the browser reloads its old JavaScript bundle.
export function createUpdatePoll({ api, targetVersion, onStatus, onComplete, onError,
  now = Date.now, restartTimeout = 180000 }) {
  let pending = false
  let finished = false
  let restartingAt = null
  return async () => {
    if (pending || finished) return
    pending = true
    try {
      const { data: state } = await api.updateStatus()
      if (state.status === 'error') {
        finished = true
        onError(state.error)
        return
      }
      if (state.status === 'installing' || state.status === 'idle') {
        if (restartingAt === null) restartingAt = now()
        const { data: version } = await api.getVersion()
        if (version.version === targetVersion) {
          finished = true
          onComplete()
          return
        }
      }
      onStatus(state)
    } catch {
      // The backend disappears while the installer replaces the app.
      if (restartingAt === null) restartingAt = now()
    } finally {
      pending = false
      if (!finished && restartingAt !== null && now() - restartingAt > restartTimeout) {
        finished = true
        onError('The app has not restarted with the new version. Check the installer window, then reopen The Vault.')
      }
    }
  }
}
