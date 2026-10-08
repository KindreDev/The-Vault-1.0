import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { hasNativeVideoBridge, isForcedTranscodeSource, isNativeVideoSource, NativeMedia } from '../lib/nativeVideo'
import NativeVideoControls from './NativeVideoControls'

const events = {
  loadstart: 'onLoadStart', loadedmetadata: 'onLoadedMetadata', loadeddata: 'onLoadedData',
  canplay: 'onCanPlay', play: 'onPlay', playing: 'onPlaying', pause: 'onPause',
  ended: 'onEnded', error: 'onError', timeupdate: 'onTimeUpdate', seeking: 'onSeeking', seeked: 'onSeeked',
  volumechange: 'onVolumeChange',
}

// Keep all layout and interaction owned by the existing caller. WebView2 gets
// only conservatively probed H.264 MP4s; libVLC remains the normal renderer for
// everything else and the fallback if WebView2 cannot decode a safe match.
const VaultVideo = forwardRef(function VaultVideo(props, ref) {
  const { src, autoPlay, loop, muted, controls, style, className, ...rest } = props
  const canvas = useRef(null)
  const htmlVideo = useRef(null)
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
  const [nativeFallbackSrc, setNativeFallbackSrc] = useState(null)
  const [rendererDecision, setRendererDecision] = useState({ src: null, engine: null })
  const [bridgeReady, setBridgeReady] = useState(() => hasNativeVideoBridge())
  const desktopSource = bridgeReady && !!src && isNativeVideoSource(src)
  const forcedTranscode = isForcedTranscodeSource(src)
  const engine = nativeFallbackSrc === src ? 'libVLC'
    : desktopSource && !forcedTranscode
      ? (rendererDecision.src === src ? rendererDecision.engine : 'checking')
      : 'webview'
  const native = desktopSource && engine !== 'webview'
  useImperativeHandle(ref, () => native ? media.current : htmlVideo.current, [native])

  const attachHtmlVideo = useCallback(element => {
    htmlVideo.current = element
    if (element && controls) setControlledPlayer(current => current === element ? current : element)
  }, [controls])

  useEffect(() => {
    const ready = () => setBridgeReady(hasNativeVideoBridge())
    window.addEventListener('pywebviewready', ready)
    ready()
    return () => window.removeEventListener('pywebviewready', ready)
  }, [])

  useEffect(() => {
    clearTimeout(nativeFallbackTimer.current)
    setNativeFallbackSrc(current => current === src ? current : null)
    return () => clearTimeout(nativeFallbackTimer.current)
  }, [src])

  useEffect(() => () => clearTimeout(nativeFallbackTimer.current), [native])

  useEffect(() => {
    if (!desktopSource || forcedTranscode || rendererDecision.src === src) return
    let cancelled = false
    window.pywebview.api.native_video_renderer_recommendation(src).then(result => {
      if (cancelled) return
      if (controls && result?.width > 0 && result?.height > 0) {
        setDimensions({ width: result.width, height: result.height })
      }
      setRendererDecision({ src, engine: result?.renderer === 'webview' ? 'webview' : 'libVLC' })
    }).catch(() => {
      if (!cancelled) setRendererDecision({ src, engine: 'libVLC' })
    })
    return () => { cancelled = true }
  }, [desktopSource, forcedTranscode, src, rendererDecision.src])

  const handleBrowserError = event => {
    const failedSource = src
    if (hasNativeVideoBridge() && isNativeVideoSource(failedSource)) {
      clearTimeout(nativeFallbackTimer.current)
      // Give the owning player a chance to request its compatible cached copy
      // before opening the original in VLC.
      nativeFallbackTimer.current = setTimeout(() => {
        if (activeSource.current === failedSource) setNativeFallbackSrc(failedSource)
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
      media.current.wantsPlay = !!autoPlay
      media.current._loop = !!loop
      media.current._muted = !!muted
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
        const rect = canvas.current?.getBoundingClientRect()
        const parentRect = canvas.current?.parentElement?.getBoundingClientRect()
        const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
        const visibleWidth = rect?.width > 0 ? rect.width : parentRect?.width > 0 ? parentRect.width : window.innerWidth
        const visibleHeight = rect?.height > 0 ? rect.height : parentRect?.height > 0 ? parentRect.height : window.innerHeight
        player.maxWidth = visibleWidth > 0 ? Math.ceil(visibleWidth * pixelRatio) : 0
        player.maxHeight = visibleHeight > 0 ? Math.ceil(visibleHeight * pixelRatio) : 0
        player._src = src || ''
        player.load()
      }
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
  useEffect(() => () => { media.current?.dispose() }, [])

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
    const video = <video ref={attachHtmlVideo} {...props} controls={controls ? false : controls}
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
  if (!controls) return <canvas ref={attachCanvas} {...canvasProps} className={className} style={style} data-vault-video="libVLC" />
  return <div ref={container} className={className} onClick={props.onClick}
              style={{ display: 'grid', gridTemplate: '"video" minmax(0, 1fr) / minmax(0, 1fr)', minWidth: 0, minHeight: 0,
                ...style, ...fit, aspectRatio: dimensions ? `${dimensions.width} / ${dimensions.height}` : undefined }}>
    <canvas ref={attachCanvas} {...canvasProps} style={{ ...style, gridArea: 'video', width: '100%', height: '100%', objectFit: 'contain', minWidth: 0, minHeight: 0 }} data-vault-video="libVLC" />
    <NativeVideoControls player={controlledPlayer} container={container} />
  </div>
})

export default VaultVideo
