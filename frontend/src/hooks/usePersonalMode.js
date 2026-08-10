import { useQuery } from '@tanstack/react-query'
import { systemApi } from '../lib/api'

/**
 * Whether the personal-mode gate is currently unlocked.
 *
 * Renders `false` on the very first paint so nothing gated ever flashes on
 * screen before the real answer arrives.
 *
 * `initialDataUpdatedAt: 0` backdates that placeholder so React Query treats it
 * as already stale and refetches on mount. Without it the placeholder inherits
 * the global 30s staleTime, counts as fresh, and no request is ever made — the
 * value would then only correct itself if something invalidated the key, so
 * reloading the page while unlocked left the gated features hidden.
 */
export function usePersonalMode() {
  const { data } = useQuery({
    queryKey: ['personal-mode'],
    queryFn:  () => systemApi.getPersonalMode().then(r => r.data.enabled),
    initialData: false,
    initialDataUpdatedAt: 0,
  })
  return data
}

export default usePersonalMode
