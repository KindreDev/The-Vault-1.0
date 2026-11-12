import { forwardRef } from 'react'

// Stand-in for the desktop VaultVideo (which routes through the Windows VLC
// bridge). On phones a plain inline video is all the card faces need.
const VaultVideo = forwardRef(function VaultVideo({ preview, preloadKey, nextSrc, ...props }, ref) {
  return <video ref={ref} playsInline {...props} />
})

export default VaultVideo
