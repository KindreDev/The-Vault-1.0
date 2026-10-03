import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { hasNativeVideoBridge, isNativeVideoSource, NativeMedia } from '../lib/nativeVideo'
import NativeVideoControls from './NativeVideoControls'

const events = {
  loadstart: 'onLoadStart', loadedmetadata: 'onLoadedMetadata', loadeddata: 'onLoadedData',
  canplay: 'onCanPlay', play: 'onPlay', playing: 'onPlaying', pause: 'onPause',
  ended: 'onEnded', error: 'onError', timeupdate: 'onTimeUpdate', seeking: 'onSeeking', seeked: 'onSeeked',
  volumechange: 'onVolumeChange',
}

// Keep all layout and interaction owned by the existing caller. Plain browser
// and mobile sessions continue to use the browser player.
const VaultVideo = forwardRef(function VaultVideo(props, ref) {
  const { src, autoPlay, loop, muted, controls, style, className, ...rest } = props
  const canvas = useRef(null)
  const htmlVideo = useRef(null)
  const media = useRef(null)
  const container = useRef(null)
  const [dimensions, setDimensions] = useState(null)
  const [fit, setFit] = useState(null)
  const [controlledPlayer, setControlledPlayer] = useState(null)
  const handlers = useRef(props)
  handlers.current = props
  const [native, setNative] = useState(() => hasNativeVideoBridge() && (!src || isNativeVideoSource(src)))
  useImperativeHandle(ref, () => native ? media.current : htmlVideo.current, [native])

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
    }
  }

  useEffect(() => {
    if (src && !isNativeVideoSource(src)) return
    const ready = () => { if (hasNativeVideoBridge()) setNative(true) }
    window.addEventListener('pywebviewready', ready)
    ready()
    return () => window.removeEventListener('pywebviewready', ready)
  }, [src, controls])

  useEffect(() => {
    if (!native) return
    let cancelled = false
    const player = media.current
    window.pywebview.api.native_video_capabilities().then(capabilities => {
      if (cancelled) return
      if (!capabilities.available) { player.fail(capabilities.reason); return }
      if (src !== undefined) { player.wantsPlay = !!autoPlay; player._src = src || ''; player.load() }
    }).catch(error => player.fail(error))
    return () => { cancelled = true; player.release() }
  }, [native, src])
  useEffect(() => { if (native && media.current) media.current.loop = !!loop }, [native, loop])
  useEffect(() => { if (native && media.current) media.current.muted = !!muted }, [native, muted])
  useEffect(() => () => { media.current?.dispose() }, [])

  useEffect(() => {
    const box = container.current
    const parent = box?.parentElement
    if (!native || !controls || !dimensions || !parent) return
    const resize = () => {
      const parentStyle = getComputedStyle(parent)
      const boxStyle = getComputedStyle(box)
      const availableWidth = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight)
      const availableHeight = parent.clientHeight - parseFloat(parentStyle.paddingTop) - parseFloat(parentStyle.paddingBottom)
      const limit = (value, available) => value.endsWith('%') ? available * parseFloat(value) / 100 : parseFloat(value) || available
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

  if (!native) return <video ref={htmlVideo} {...props} />
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
