import { useEffect, useRef, useState } from 'react'

/**
 * Animates a number from 0 to `target` over `duration` ms.
 * Returns the current animated value.
 *
 * @param {number|null|undefined} target  - The final value to count to
 * @param {number}                duration - Animation duration in ms (default 1100)
 * @param {boolean}               enabled  - Set false to skip animation and return target immediately
 */
export function useCountUp(target, duration = 1100, enabled = true) {
  const [value, setValue] = useState(0)
  const rafRef = useRef(null)
  const prevTarget = useRef(null)

  useEffect(() => {
    const to = Number(target) || 0

    // Skip animation if disabled or value hasn't changed
    if (!enabled || prevTarget.current === to) {
      setValue(to)
      return
    }
    prevTarget.current = to

    const start = performance.now()
    const from  = 0

    function tick(now) {
      const elapsed  = now - start
      const progress = Math.min(elapsed / duration, 1)
      // Ease-out cubic — fast start, gentle landing
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(from + (to - from) * eased))
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration, enabled])

  return value
}
