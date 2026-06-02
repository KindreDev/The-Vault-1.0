import { useEffect, useRef, useState } from 'react'

/**
 * Reveals an element when it scrolls into the viewport.
 * Returns [ref, isVisible].
 *
 * Usage:
 *   const [ref, visible] = useScrollReveal()
 *   <div ref={ref} style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(16px)', transition: 'opacity 0.4s ease, transform 0.4s ease' }}>
 *
 * @param {number} threshold  - 0–1, how much of the element must be visible (default 0.12)
 * @param {string} rootMargin - IntersectionObserver root margin (default '0px 0px -40px 0px')
 */
export function useScrollReveal(threshold = 0.12, rootMargin = '0px 0px -40px 0px') {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect() // fire once — elements don't un-reveal
        }
      },
      { threshold, rootMargin }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold, rootMargin])

  return [ref, visible]
}
