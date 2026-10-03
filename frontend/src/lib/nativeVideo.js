// libVLC renders into shared WebView2 memory; this facade supplies the media
// clock/control contract used by the existing viewer and funscript scheduler.
const players = new Map()
let listening = false

export const isNativeVideoSource = src => /^\/api\/(images|intake\/items)\/\d+\/file(?:\?|$)/.test(src || '')
export const hasNativeVideoBridge = () => !!(window.pywebview?.api?.native_video_open && window.chrome?.webview)

function listenForFrames() {
  if (listening) return
  listening = true
  window.chrome.webview.addEventListener('sharedbufferreceived', event => {
    const data = event.additionalData
    if (data?.kind !== 'vault-vlc') return
    const buffer = event.getBuffer()
    const player = players.get(data.session)
    if (player) player.attachBuffer(buffer, data)
    else window.chrome.webview.releaseBuffer(buffer)
  })
}

export class NativeMedia extends EventTarget {
  constructor(canvas, emit) {
    super()
    this.canvas = canvas
    this.style = canvas.style
    this.emitCallback = emit
    this.engine = 'libVLC'
    this._src = ''
    this._time = 0
    this._duration = NaN
    this._volume = 1
    this._muted = false
    this._rate = 1
    this._loop = false
    this.paused = true
    this.ended = false
    this.readyState = 0
    this.videoWidth = 0
    this.videoHeight = 0
    this.error = null
    this.session = null
    this.generation = 0
    this.queue = Promise.resolve()
    this.lastTick = 0
    this.sequence = 0
    this.disposed = false
  }

  emit(type) {
    const event = new Event(type)
    this.dispatchEvent(event)
    this.emitCallback(type, { target: this, currentTarget: this, nativeEvent: event })
  }

  get src() { return this._src }
  set src(value) { if (value !== this._src) { this._src = value || ''; this.load() } }
  get currentSrc() { return this._src }
  get currentTime() { return this._time }
  set currentTime(value) {
    if (this.ended) { this.wantsPlay = false; this.command('pause') }
    this._time = Math.max(0, Number(value) || 0)
    this.ended = false
    this.emit('seeking')
    const request = (this.seekRequest || 0) + 1
    this.seekRequest = request
    this.pendingSeek = this.command('seek', this._time).then(() => {
      if (request !== this.seekRequest) return
      this.pendingSeek = null
      this.emit('seeked')
      this.emit('timeupdate')
    })
  }
  get duration() { return this._duration }
  get volume() { return this._volume }
  set volume(value) { this._volume = Math.max(0, Math.min(1, Number(value))); this.command('volume', this._volume); this.emit('volumechange') }
  get muted() { return this._muted }
  set muted(value) { this._muted = !!value; this.command('muted', this._muted); this.emit('volumechange') }
  get playbackRate() { return this._rate }
  set playbackRate(value) { this._rate = Math.max(.25, Math.min(4, Number(value))); this.command('rate', this._rate) }
  get loop() { return this._loop }
  set loop(value) { this._loop = !!value; this.command('loop', this._loop) }

  command(command, value = null) {
    const session = this.session
    if (!session) return Promise.resolve()
    const result = this.queue.then(() => {
      if (this.session === session) return window.pywebview.api.native_video_command(session, command, value)
    })
    this.queue = result.catch(error => { if (this.session === session) this.fail(error) })
    return result
  }

  async play() {
    this.wantsPlay = true
    await this.command('play')
  }
  pause() {
    this.wantsPlay = false
    if (!this.paused) { this.paused = true; this.emit('pause') }
    this.command('pause')
  }
  removeAttribute(name) { if (name === 'src') this._src = '' }
  getAttribute(name) { return name === 'src' ? this._src : null }

  load() {
    this.release()
    if (!this._src || this.disposed) return
    if (!isNativeVideoSource(this._src)) { this.fail('Unsupported native video source'); return }
    listenForFrames()
    this.error = null
    this.readyState = 0
    this.paused = true
    this.ended = false
    this._time = 0
    this._duration = NaN
    this.sequence = 0
    const session = `video-${crypto.randomUUID()}`
    this.session = session
    players.set(session, this)
    this.emit('loadstart')
    this.queue = window.pywebview.api.native_video_open(session, this._src, {
      autoPlay: !!this.wantsPlay, loop: this.loop, volume: this.volume, muted: this.muted, rate: this.playbackRate,
    }).then(() => {
      if (this.session !== session) return window.pywebview.api.native_video_close(session)
    })
    this.queue.catch(error => { if (this.session === session) this.fail(error) })
    // Detect decode/open failures even before a shared frame buffer exists.
    this.healthTimer = setInterval(async () => {
      if (this.session !== session) return
      try {
        const status = await window.pywebview.api.native_video_status(session)
        if (status?.error && this.session === session) this.fail(status.error)
      } catch (error) { this.fail(error) }
    }, 1000)
  }

  attachBuffer(buffer, data) {
    this.releaseBuffer()
    this.buffer = buffer
    this.header = new DataView(buffer, 0, data.headerBytes)
    this.videoWidth = data.width
    this.videoHeight = data.height
    this.canvas.width = data.width
    this.canvas.height = data.height
    this.slots = Array.from({ length: data.slots }, (_, i) =>
      new Uint8ClampedArray(buffer, data.headerBytes + i * data.width * data.height * 4, data.width * data.height * 4))
    this.context = this.canvas.getContext('2d', { alpha: false })
    this.image = this.context.createImageData(data.width, data.height)
    this.sequence = 0
    cancelAnimationFrame(this.animation)
    this.animation = requestAnimationFrame(now => this.tick(now))
  }

  tick(now) {
    if (!this.header || this.disposed) return
    const header = this.header
    const seq = header.getUint32(0, true)
    const slot = header.getInt32(4, true)
    if (seq && seq !== this.sequence && slot >= 0 && slot < this.slots.length) {
      header.setInt32(8, slot, true)
      // The writer excludes this slot until the canvas has copied its pixels.
      if (header.getInt32(4, true) === slot) {
        this.image.data.set(this.slots[slot])
        this.context.putImageData(this.image, 0, 0)
        this.sequence = seq
      }
      header.setInt32(8, -1, true)
    }
    const duration = header.getFloat64(24, true)
    if (duration > 0) this._duration = duration
    if (!this.pendingSeek) this._time = header.getFloat64(16, true)
    if (!this.readyState && this.sequence && duration > 0) {
      this.readyState = 4
      this.emit('loadedmetadata')
      this.emit('loadeddata')
      this.emit('canplay')
    }
    const flags = header.getUint32(12, true)
    const playing = !!(flags & 1) && this.wantsPlay
    if (playing && this.paused) { this.paused = false; this.ended = false; this.emit('play'); this.emit('playing') }
    else if (!playing && !this.paused) { this.paused = true; this.emit('pause') }
    if ((flags & 2) && !this.ended) { this.ended = true; this.emit('ended') }
    if (flags & 4) this.fail('VLC could not decode this video')
    if (now - this.lastTick >= 40) { this.lastTick = now; this.emit('timeupdate') }
    this.animation = requestAnimationFrame(next => this.tick(next))
  }

  fail(error) {
    if (this.error || this.disposed) return
    this.error = { code: 3, message: String(error?.message || error) }
    this.pause()
    this.emit('error')
  }
  releaseBuffer() {
    cancelAnimationFrame(this.animation)
    if (this.buffer) window.chrome.webview.releaseBuffer(this.buffer)
    this.buffer = null
    this.header = null
  }
  release() {
    clearInterval(this.healthTimer)
    this.releaseBuffer()
    if (this.session) {
      const session = this.session
      players.delete(session)
      this.queue.finally(() => window.pywebview.api.native_video_close(session)).catch(() => {})
    }
    this.session = null
  }
  dispose() { this.disposed = true; this.release() }
}
