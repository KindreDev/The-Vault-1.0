import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { hasNativeVideoBridge, isNativeVideoSource, NativeMedia } from '../lib/nativeVideo'
import NativeVideoControls from './NativeVideoControls'
import { registerVideoPreview } from '../lib/videoPreview'
import './native-video.css'

const events = {
  loadstart: 'onLoadStart', loadedmetadata: 'onLoadedMetadata', loadeddata: 'onLoadedData',
  canplay: 'onCanPlay', play: 'onPlay', playing: 'onPlaying', pause: 'onPause',
  ended: 'onEnded', error: 'onError', timeupdate: 'onTimeUpdate', seeking: 'onSeeking', seeked: 'onSeeked',
  volumechange: 'onVolumeChange',
}

// The Windows shell uses normal VLC output for every indexed video. Browser
// clients keep their HTML video element and compatible-stream behavior.
const VaultVideo = forwardRef(function VaultVideo(props, ref) {
  const { src, autoPlay, loop, muted, controls, preview = false, preloadKey, nextSrc, style, className, ...rest } = props
  const previewCleanup = useRef(null)
  const canvas = useRef(null)
  const htmlVideo = useRef(null)
  const browserSnapshot = useRef(null)
  const media = useRef(null)
  const container = useRef(null)
  const nativeFallbackTimer = useRef(null)
  const activeSource = useRef(src)
  activeSource.current = src
  const [dimensions, setDimensions] = useState(null)
  const [fit, setFit] = useState(null)
  const [controlledPlayer, setControlledPlayer] = useState(null)
  const handlers = useRef(props)
  handlers.current = props
  const [bridgeReady, setBridgeReady] = useState(() => hasNativeVideoBridge())
  const native = bridgeReady && (!src || isNativeVideoSource(src))
  const engine = native ? 'libVLC' : 'webview'
  useImperativeHandle(ref, () => native ? media.current : htmlVideo.current, [native])

  const attachHtmlVideo = useCallback(element => {
    previewCleanup.current?.()
    previewCleanup.current = null
    if (!element && htmlVideo.current) {
      const previous = htmlVideo.current
      const url = new URL(previous.currentSrc || previous.src || '/', window.location.href)
      browserSnapshot.current = { src: url.pathname + url.search, playing: !previous.paused }
    }
    htmlVideo.current = element
    if (element && preview) previewCleanup.current = registerVideoPreview(element)
    if (element && controls) setControlledPlayer(current => current === element ? current : element)
  }, [controls, preview])

  useEffect(() => {
    const ready = () => setBridgeReady(hasNativeVideoBridge())
    window.addEventListener('pywebviewready', ready)
    ready()
    return () => window.removeEventListener('pywebviewready', ready)
  }, [])

  useEffect(() => {
    clearTimeout(nativeFallbackTimer.current)
    return () => clearTimeout(nativeFallbackTimer.current)
  }, [src])

  useEffect(() => () => clearTimeout(nativeFallbackTimer.current), [native])

  const handleBrowserError = event => {
    const failedSource = src
    if (hasNativeVideoBridge() && isNativeVideoSource(failedSource)) {
      clearTimeout(nativeFallbackTimer.current)
      // Give the owning player a chance to request its compatible cached copy
      // before opening the original in VLC.
      nativeFallbackTimer.current = setTimeout(() => {
        if (activeSource.current === failedSource) setBridgeReady(hasNativeVideoBridge())
      }, 650)
    }
    handlers.current.onError?.(event)
  }

  const handleBrowserReady = event => {
    clearTimeout(nativeFallbackTimer.current)
    handlers.current[events[event.type]]?.(event)
  }

  const handleBrowserMetadata = event => {
    if (controls && event.currentTarget.videoWidth && event.currentTarget.videoHeight) {
      setDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })
    }
    handlers.current.onLoadedMetadata?.(event)
  }

  // ref callback installs the media facade before the parent's effects run.
  const attachCanvas = element => {
    canvas.current = element
    if (element && !media.current) {
      media.current = new NativeMedia(element, (type, event) => {
        if (type === 'loadedmetadata') setDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })
        handlers.current[events[type]]?.(event)
      })
      media.current.preview = preview
      media.current.preloadKey = preloadKey
      media.current.nextSrc = nextSrc
      if (preview) {
        previewCleanup.current?.()
        previewCleanup.current = registerVideoPreview(media.current)
      }
      media.current.wantsPlay = !!autoPlay
      media.current._loop = !!loop
      media.current._muted = !!muted
      if (src === undefined && isNativeVideoSource(browserSnapshot.current?.src)) {
        media.current._src = browserSnapshot.current.src
        media.current.wantsPlay = browserSnapshot.current.playing
      }
      if (controls) setControlledPlayer(media.current)
    } else if (element && media.current?.canvas !== element) {
      media.current.setCanvas(element)
      if (controls) setControlledPlayer(media.current)
    }
  }

  useEffect(() => {
    if (!native || engine !== 'libVLC') return
    let cancelled = false
    const player = media.current
    window.pywebview.api.native_video_capabilities().then(capabilities => {
      if (cancelled) return
      if (!capabilities.available) { player.fail(capabilities.reason); return }
      if (src !== undefined) {
        player._src = src || ''
        player.load()
      } else if (player.src && !player.session) player.load()
    }).catch(error => player.fail(error))
    return () => { cancelled = true; player.release() }
  }, [native, engine, src])
  useEffect(() => {
    if (!native || engine !== 'libVLC' || !media.current) return
    if (autoPlay) media.current.play().catch(() => {})
    else media.current.pause()
  }, [native, engine, autoPlay])
  useEffect(() => { if (native && media.current) media.current.loop = !!loop }, [native, loop])
  useEffect(() => { if (native && media.current) media.current.muted = !!muted }, [native, muted])
  useEffect(() => {
    if (native && media.current) {
      media.current.preloadKey = preloadKey
      media.current.nextSrc = nextSrc
    }
  }, [native, preloadKey, nextSrc])
  useEffect(() => () => { previewCleanup.current?.(); previewCleanup.current = null }, [])

  useEffect(() => {
    const player = native ? media.current : null
    return () => {
      player?.dispose().catch(() => {})
      if (media.current === player) media.current = null
    }
  }, [native])

  useEffect(() => {
    const box = container.current
    const parent = box?.parentElement
    if (!controls || !dimensions || !parent) return
    const resize = () => {
      const parentStyle = getComputedStyle(parent)
      const boxStyle = getComputedStyle(box)
      const availableWidth = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight)
      const availableHeight = parent.clientHeight - parseFloat(parentStyle.paddingTop) - parseFloat(parentStyle.paddingBottom)
      const limit = (value, available) => {
        if (!value || value === 'none') return available
        if (value.endsWith('%')) return available * parseFloat(value) / 100
        if (value.endsWith('vw')) return window.innerWidth * parseFloat(value) / 100
        if (value.endsWith('vh')) return window.innerHeight * parseFloat(value) / 100
        return parseFloat(value) || available
      }
      const scale = Math.min(1, limit(boxStyle.maxWidth, availableWidth) / dimensions.width,
        limit(boxStyle.maxHeight, availableHeight) / dimensions.height, availableWidth / dimensions.width, availableHeight / dimensions.height)
      const next = { width: Math.max(1, dimensions.width * scale), height: Math.max(1, dimensions.height * scale) }
      setFit(previous => previous?.width === next.width && previous?.height === next.height ? previous : next)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(parent)
    resize()
    return () => observer.disconnect()
  }, [native, controls, dimensions])

  if (!native) {
    const video = <video ref={attachHtmlVideo} {...rest} src={src} autoPlay={autoPlay} loop={loop} muted={muted} controls={controls ? false : controls}
                         onError={handleBrowserError} onLoadedMetadata={handleBrowserMetadata}
                         onLoadedData={handleBrowserReady} onCanPlay={handleBrowserReady}
                         onPlaying={handleBrowserReady}
                         className={controls ? undefined : className}
                         style={controls ? { ...style, gridArea: 'video', width: '100%', height: '100%', objectFit: 'contain', minWidth: 0, minHeight: 0 } : style} />
    if (!controls) return video
    return <div ref={container} className={className} onClick={props.onClick}
                style={{ display: 'grid', gridTemplate: '"video" minmax(0, 1fr) / minmax(0, 1fr)', minWidth: 0, minHeight: 0,
                  ...style, ...fit, aspectRatio: dimensions ? `${dimensions.width} / ${dimensions.height}` : undefined }}>
      {video}
      <NativeVideoControls player={controlledPlayer} container={container} />
    </div>
  }
  const canvasProps = Object.fromEntries(Object.entries(rest).filter(([key]) => !Object.values(events).includes(key) && !['playsInline', 'preload', 'poster'].includes(key)))
  if (!controls) return <div ref={attachCanvas} {...canvasProps} className={className} style={style} data-vault-video="native-window" />
  return <div ref={container} className={className} onClick={props.onClick}
              style={{ display: 'grid', gridTemplate: '"video" minmax(0, 1fr) / minmax(0, 1fr)', minWidth: 0, minHeight: 0,
                ...style, ...fit, aspectRatio: dimensions ? `${dimensions.width} / ${dimensions.height}` : undefined }}>
    <div ref={attachCanvas} {...canvasProps} style={{ ...style, gridArea: 'video', width: '100%', height: '100%', objectFit: 'contain', minWidth: 0, minHeight: 0 }} data-vault-video="native-window" />
    <NativeVideoControls player={controlledPlayer} container={container} />
  </div>
})

export default VaultVideo
