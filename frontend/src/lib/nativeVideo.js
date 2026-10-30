// VLC paints directly into its native window. Only commands and clock data
// cross this bridge; the existing controls and device scheduler keep their API.
import { startNativeLayout, nativeLayout, scheduleNativeLayout } from './nativeVideoLayout'
import { canPlayVideoPreview } from './videoPreview'
import { getSavedVideoLoop } from './videoLoop'
const players = new Map()
const preparations = new Map()
let preparationSuspended = false
export function clearPreparedVideo(owner) {
  const pending = preparations.get(owner)
  preparations.delete(owner)
  return Promise.resolve(pending?.promise).catch(() => {}).then(() => window.pywebview?.api?.native_video_clear_prepared?.(owner))
}
export function prepareVideo(owner, src) {
  if (preparationSuspended || !owner || !window.pywebview?.api?.native_video_prepare) return
  if (!src) return preparations.has(owner) ? clearPreparedVideo(owner) : undefined
  if (preparations.get(owner)?.src === src) return
  const promise = window.pywebview.api.native_video_prepare(owner, src, getSavedVideoLoop())
  const entry = { src, promise }
  preparations.set(owner, entry)
  // Preloading is optional: failure must not interrupt the current video.
  promise.catch(() => { entry.failed = true })
}
export const getActiveNativeMedia = () => [...players.values()]
export const isNativeVideoSource = src => /^\/api\/(images|intake\/items)\/\d+\/file(?:\?|$)/.test(src || '')
export const isForcedTranscodeSource = src => {
  try { return new URL(src, window.location.href).searchParams.get('transcode') === '1' }
  catch { return false }
}
export const hasNativeVideoBridge = () => !!window.pywebview?.api?.native_video_layout

// Preserve awaited handle release and selective paused restoration for disk changes.
export async function releaseNativeMediaBeforeDiskMutation() {
  preparationSuspended = true
  try {
    await Promise.all([...preparations.keys()].map(clearPreparedVideo))
    const snapshots = getActiveNativeMedia().map(player => ({ player, src: player.src, time: player.currentTime }))
    const restore = (shouldRestore = () => true) => snapshots.forEach(({ player, src, time }) => {
      if (!shouldRestore(src) || player.disposed || player.session || player.src) return
      player.addEventListener('loadedmetadata', () => { if (player.src === src) player.currentTime = time }, { once: true })
      player.src = src
    })
    const outcomes = await Promise.allSettled(snapshots.map(async ({ player }) => {
      player.pause()
      player._src = ''
      await player.release()
    }))
    const failure = outcomes.find(result => result.status === 'rejected')
    if (failure) { restore(); throw failure.reason }
    return restore
  } finally { preparationSuspended = false }
}
export class NativeMedia extends EventTarget {
  constructor(element, callback) {
    super()
    this.canvas = element
    this.element = element
    this.style = element.style
    this.callback = callback
    this.layout = () => {
      const layout = nativeLayout(this.element)
      if (this.preview && !canPlayVideoPreview()) layout.visible = false
      return layout
    }
    this.engine = 'libVLC'
    this._src = ''
    this._time = 0
    this._duration = NaN
    this._volume = 1
    this._muted = false
    this._loop = false
    this._rate = 1
    this.paused = true
    this.ended = false
    this.readyState = 0
    this.presented = false
    this.error = null
    this.wantsPlay = false
    this.queue = Promise.resolve()
    this.generation = 0
    this.disposed = false
  }
  emit(type) {
    this.dispatchEvent(new Event(type))
    this.callback(type, { currentTarget: this, target: this, nativeEvent: new Event(type) })
  }
  get src() { return this._src }
  set src(value) { if (this._src !== (value || '')) { this._src = value || ''; this.load() } }
  setCanvas(element) { this.element = element; this.canvas = element; this.style = element.style; scheduleNativeLayout() }
  getAttribute(name) { return name === 'src' ? this.src : null }
  get currentSrc() { return this._src }
  get currentTime() { return this._time }
  set currentTime(value) {
    this._time = Math.max(0, Number(value) || 0)
    this.ended = false
    this.clock = null  // the last observation is pre-seek; wait for a fresh one
    this.seekTarget = this._time
    this.emit('seeking')
    if (this.seeking) return
    this.seeking = true
    const generation = this.generation
    const send = async () => {
      while (this.seekTarget != null && this.generation === generation) {
        const target = this.seekTarget
        this.seekTarget = null
        await this.command('seek', target)
      }
      this.seeking = false
      if (generation === this.generation) this.emit('seeked')
    }
    send().catch(error => { this.seeking = false; this.fail(error) })
  }
  get duration() { return this._duration }
  get volume() { return this._volume }
  set volume(value) { this._volume = Math.max(0, Math.min(1, Number(value))); this.command('volume', this._volume); this.emit('volumechange') }
  get muted() { return this._muted }
  set muted(value) { this._muted = !!value; this.command('muted', this._muted); this.emit('volumechange') }
  get loop() { return this._loop }
  set loop(value) { this._loop = !!value; this.command('loop', this._loop) }
  get playbackRate() { return this._rate }
  set playbackRate(value) { this._rate = Math.max(.25, Math.min(4, Number(value) || 1)); this.command('rate', this._rate); this.emit('ratechange') }
  removeAttribute(name) { if (name === 'src') this._src = '' }
  command(command, value = null) {
    const session = this.session
    if (!session) return Promise.resolve()
    const result = this.queue.then(() => {
      if (session === this.session) return window.pywebview.api.native_video_command(session, command, value)
    })
    this.queue = result.catch(error => { if (this.session === session) this.fail(error) })
    return result
  }
  async play() { if (this.preview && !canPlayVideoPreview()) return; this.wantsPlay = true; await this.command('play') }
  pause() { this.wantsPlay = false; this.command('pause'); if (!this.paused) { this.paused = true; this.emit('pause') } }
  load() {
    const previous = this.release()
    if (!this._src || this.disposed || (this.preview && !canPlayVideoPreview())) return
    if (!isNativeVideoSource(this._src)) { this.fail('Unsupported native video source'); return }
    const generation = this.generation
    this.error = null
    this.readyState = 0
    this.paused = true
    this.ended = false
    this._time = 0
    this._duration = NaN
    this.clock = null
    const session = `native-window-${crypto.randomUUID()}`
    this.session = session
    players.set(session, this)
    this.stopLayout = startNativeLayout(this)
    this.emit('loadstart')
    const source = this._src
    this.queue = previous.then(() => {
      if (generation !== this.generation) return
      return window.pywebview.api.native_video_open(session, source, {
      autoPlay: this.wantsPlay, volume: this.volume, muted: this.muted, loop: this.loop, rate: this.playbackRate,
      preloadKey: this.preloadKey,
      })
    }).then(async () => {
      if (generation !== this.generation) return
      await window.pywebview.api.native_video_layout(session, this.layout())
      this.poll(generation)
    }).catch(error => { if (generation === this.generation) this.fail(error) })
  }
  async poll(generation) {
    if (generation !== this.generation || !this.session) return
    try {
      const askedAt = performance.now()
      const status = await window.pywebview.api.native_video_status(this.session)
      if (generation !== this.generation || !status) return
      this.stats = status
      if (status.clock) {
        // Device output smooths this clock. Anchor it on when VLC was sampled:
        // the backend's age plus half the bridge round trip.
        const receivedAt = performance.now()
        this.clock = { ...status.clock,
          observedAt: receivedAt - status.clock.age * 1000 - (receivedAt - askedAt) / 2 }
      }
      if (status.error) { this.fail(status.error); return }
      this._duration = status.duration
      const resized = this.videoWidth !== status.width || this.videoHeight !== status.height
      this.videoWidth = status.width
      this.videoHeight = status.height
      if (this.readyState && resized) this.updateLayout()
      if (status.ready && !this.readyState) {
        this.readyState = 4
        await window.pywebview.api.native_video_layout(this.session, this.layout())
        if (generation !== this.generation) return
        this.emit('loadedmetadata'); this.emit('loadeddata'); this.emit('canplay')
        scheduleNativeLayout()  // open the background hole for this video now
      }
      if (this.readyState && !this.presented && this.layout().visible) {
        // Let React remove the loading cover and let the layout/background
        // holes paint before audio and the native playback clock can advance.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        if (generation !== this.generation) return
        await window.pywebview.api.native_video_layout(this.session, this.layout())
        if (generation !== this.generation) return
        const presented = await this.command('present')
        if (generation !== this.generation) return
        this.presented = presented === true
      }
      if (status.playing && this.paused) { this.paused = false; this.ended = false; this.emit('play'); this.emit('playing') }
      else if (!status.playing && !this.paused) { this.paused = true; this.emit('pause') }
      if (!this.seeking && this._time !== status.time) { this._time = status.time; this.emit('timeupdate') }
      if (status.ended && !this.ended) { this.ended = true; this.emit('ended') }
      if (this.presented && status.playing && status.time >= .3 && this.nextSrc !== this.src) prepareVideo(this.preloadKey, this.nextSrc)
    } catch (error) { if (generation === this.generation) this.fail(error) }
    if (generation === this.generation) this.timer = setTimeout(() => this.poll(generation), this.presented ? 100 : 40)
  }
  updateLayout() {
    this.layoutDirty = true
    if (this.layoutPending) return
    this.layoutPending = true
    const session = this.session
    const update = async () => {
      try {
        while (this.layoutDirty && this.session === session) {
          this.layoutDirty = false
          await this.queue
          if (this.session === session) await window.pywebview.api.native_video_layout(session, this.layout())
        }
      } catch (error) { this.fail(error) }
      finally { this.layoutPending = false; if (this.layoutDirty && this.session && this.session !== session) this.updateLayout() }
    }
    update()
  }
  fail(error) { if (this.error || this.disposed) return; this.error = { code: 3, message: String(error?.message || error) }; this.pause(); this.emit('error') }
  release() {
    ++this.generation
    clearTimeout(this.timer)
    this.seekTarget = null
    this.seeking = false
    this.stopLayout?.()
    this.stopLayout = null
    const session = this.session
    // Hide immediately instead of waiting behind an in-flight open or command.
    if (session && this.preview) window.pywebview.api.native_video_layout(session, { ...this.layout(), visible: false }).catch(() => {})
    players.delete(session)
    this.session = null
    this.readyState = 0
    this.presented = false
    const closed = this.queue.catch(() => {}).then(() => session && window.pywebview.api.native_video_close(session))
    this.queue = closed
    return closed
  }
  dispose() { this.disposed = true; return this.release() }
}
