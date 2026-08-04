/**
 * GIF helpers.
 *
 * Animated GIFs carry their frame delays inside the file and expose nothing to
 * the DOM — no `duration`, no events. So to hold a slide for one full loop we
 * have to read the delays ourselves by walking the GIF block structure.
 *
 * Durations are cached per URL: a slideshow revisits the same images constantly
 * and the bytes are already in the HTTP cache, but the parse isn't free.
 */

const _durationCache = new Map()   // url -> seconds (0 = static / unknown)
const _inflight      = new Map()   // url -> Promise

export function isGif(nameOrPath) {
  return /\.gif$/i.test(String(nameOrPath || ''))
}

/**
 * Watchdog for a video slide.
 *
 * During a slideshow videos carry no timer — they advance from `onEnded`, so
 * they play out in full instead of being cut off. But a file that can't play at
 * all (a corrupt clip, a macOS `._` stub) never fires `onEnded`, which would
 * park the slideshow on it forever. This watches the element and moves on only
 * when it is genuinely stuck: an error, or playback that hasn't progressed for
 * `graceSecs`. A healthy video never trips it.
 *
 * Returns a cancel function.
 */
export function armVideoWatchdog({ onFire, graceSecs = 12 }) {
  let cancelled = false
  let lastTime  = -1
  let stalled   = 0

  // The viewer can leave an empty <video> mounted while an image is on screen,
  // so picking the first one in the document would poll the wrong element and
  // "rescue" a perfectly healthy clip. Only consider elements that actually
  // point at a file, preferring the largest visible one.
  const pickVideo = () => {
    const withSrc = [...document.querySelectorAll('video')]
      .filter(el => el.currentSrc || el.getAttribute('src'))
    if (!withSrc.length) return null
    return withSrc.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      return (rb.width * rb.height) - (ra.width * ra.height)
    })[0]
  }

  const iv = setInterval(() => {
    if (cancelled) return
    const v = pickVideo()
    if (!v) return

    // Hard failure — the browser has given up on the file
    if (v.error || v.networkState === 3 /* NETWORK_NO_SOURCE */) {
      clearInterval(iv); onFire(); return
    }

    const hasData = v.readyState >= 2 /* HAVE_CURRENT_DATA */
    if (!hasData) {
      // Never managed to load a frame. A corrupt file sits here forever, paused
      // and error-free, which is exactly the case that used to hang a slideshow.
      stalled++
    } else if (v.paused) {
      // Loaded and deliberately paused by the viewer — leave it alone.
      stalled = 0
    } else {
      // Playing: only a frozen clock counts as stuck.
      stalled = v.currentTime === lastTime ? stalled + 1 : 0
    }
    lastTime = v.currentTime

    if (stalled >= graceSecs) { clearInterval(iv); onFire() }
  }, 1000)

  return () => { cancelled = true; clearInterval(iv) }
}

/** Duration if it has already been parsed, else undefined. Never fetches. */
export function gifDurationCached(url) {
  return _durationCache.get(url)
}

/**
 * Arm a slideshow timer that accounts for animated GIFs.
 *
 * The timer starts at `baseSecs` immediately — waiting on the GIF parse before
 * arming would add the whole download to the slide's on-screen time. If the
 * parse then reports a longer loop, the timer is extended by the difference.
 *
 * Returns a cancel function.
 */
export function armSlideTimer({ url, animated, baseSecs, onFire }) {
  let cancelled = false
  let timer = null
  const startedAt = Date.now()

  const fire = () => { if (!cancelled) onFire() }
  const set = (secs) => { timer = setTimeout(fire, Math.max(0.2, secs) * 1000) }

  if (!animated) {
    set(baseSecs)
    return () => { cancelled = true; clearTimeout(timer) }
  }

  const known = gifDurationCached(url)
  if (known !== undefined) {
    set(known > 0 ? Math.max(baseSecs, known) : baseSecs)
  } else {
    set(baseSecs)
    gifDuration(url).then(d => {
      if (cancelled || !d) return
      const needMs    = Math.max(baseSecs, d) * 1000
      const elapsedMs = Date.now() - startedAt
      if (needMs > elapsedMs) {
        clearTimeout(timer)
        timer = setTimeout(fire, needMs - elapsedMs)
      }
    }).catch(() => {})
  }

  return () => { cancelled = true; clearTimeout(timer) }
}

/**
 * Total play time of one loop, in seconds. Returns 0 for anything that isn't a
 * parseable animated GIF, so callers can just fall back to their normal timing.
 */
export function gifDuration(url) {
  if (_durationCache.has(url)) return Promise.resolve(_durationCache.get(url))
  if (_inflight.has(url))      return _inflight.get(url)

  const p = fetch(url)
    .then(r => (r.ok ? r.arrayBuffer() : null))
    .then(buf => {
      const secs = buf ? _parseDelays(new Uint8Array(buf)) : 0
      _durationCache.set(url, secs)
      _inflight.delete(url)
      return secs
    })
    .catch(() => {
      _durationCache.set(url, 0)
      _inflight.delete(url)
      return 0
    })

  _inflight.set(url, p)
  return p
}

/**
 * Walk the GIF blocks summing Graphic Control Extension delays.
 * Layout: header, logical screen descriptor, optional global colour table,
 * then a stream of blocks terminated by 0x3B.
 */
function _parseDelays(b) {
  if (b.length < 13) return 0
  // "GIF87a" / "GIF89a"
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return 0

  let p = 10
  const packed = b[p]
  p = 13
  if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1))   // global colour table

  let total = 0      // in 1/100 s
  let frames = 0

  while (p < b.length) {
    const marker = b[p]

    if (marker === 0x3B) break                     // trailer

    if (marker === 0x21) {                         // extension
      const label = b[p + 1]
      p += 2
      if (label === 0xF9) {                        // graphic control
        // blockSize(1) packed(1) delay(2, little-endian) transparent(1)
        const delay = b[p + 2] | (b[p + 3] << 8)
        // Browsers clamp 0 and 1 to ~10cs, matching how these actually play
        total += delay <= 1 ? 10 : delay
        frames++
      }
      p = _skipSubBlocks(b, p)
      continue
    }

    if (marker === 0x2C) {                         // image descriptor
      // 0x2C, then left/top/width/height (2 bytes each), then the packed field
      const lp = b[p + 9]
      p += 10
      if (lp & 0x80) p += 3 * (1 << ((lp & 0x07) + 1))   // local colour table
      p += 1                                       // LZW minimum code size
      p = _skipSubBlocks(b, p)
      continue
    }

    // Anything else means the walk has lost sync with the block structure.
    // Scanning on from here would read arbitrary bytes as frame delays and
    // invent a duration, so stop and keep only what was read cleanly.
    break
  }

  // A single frame isn't an animation; treat it as static so callers use their
  // normal slide timing instead of holding on one still frame.
  if (frames < 2) return 0
  return total / 100
}

/** Sub-blocks are length-prefixed chunks ending with a zero-length block. */
function _skipSubBlocks(b, p) {
  while (p < b.length) {
    const size = b[p]
    if (!size) return p + 1
    p += size + 1
  }
  return p
}
