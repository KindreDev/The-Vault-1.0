# Native playback test

Double-click **Start Native Video Test.bat**. A separate desktop window opens
with The Vault's actual `InlineVideoPlayer` controls. Use **Open your video…**
to test an original file; playback never modifies it. Close this window before
starting another instance.

- Scrollwheel zoom uses the viewer's 1.15× steps and 1×–8× range.
- Hold the left mouse button over the video and drag to pan. Controls do not
  start a drag. Pointer capture keeps the drag active outside the stage.
- Zooming back to 1× resets the pan. **Reset zoom** does the same.
- **Show test waveform**, **Two players**, and **Fullscreen** exercise overlays,
  independent native video areas, and resizing.

The browser UI sits above normal libVLC Direct3D11 Windows output. No decoded
pixels pass through JavaScript and no playback conversion runs. This test now
uses the production renderer and native output host. Its Vite configuration
rejects all `/api/` requests. The Python
runner imports neither Vault configuration nor its database and exposes only
an explicitly bounded test bridge. Native panels handle clipping and zoom/pan.

Generated samples and the separate browser profile live in
`%TEMP%\vault-native-video-test`. The samples include 1080p/60, 4K/60, MOV, MKV,
10-bit HEVC MOV, and rotated MOV. Allow time for sample generation on the first launch.

Run the automated integration checks from the repository root:

```powershell
backend\venv\Scripts\python.exe scripts\video_player\run_native_video_test.py --self-test
```

Use `--viewer-only` for the actual Videos/Photos full-screen viewer over a
disposable library grid. This regression checks visible native video pixels,
scrollwheel zoom, held mouse dragging, and library restoration after closing.
It uses the real viewer component with blocked HTTP APIs and fixture media.
It also holds loading to verify a paused, silent opening, then measures actual
automatic transitions to prepared videos in order and with shuffle. Closing
the viewer must release both visible playback and prepared file handles.

Optionally add `--file "D:\path\video.mov"` (repeatable) to test specific files,
or `--output "D:\test-results"` for a separate artifact/profile directory.
`report.json` records first-frame times, VLC counters, first-load/reopen checks,
pause/seek/resume, two players, fullscreen, and native bounds throughout an
automated wheel/held-pointer-drag/release sequence. Screenshots capture the
actual Windows host and overlays, including a held-drag state.

VLC's output counters can include repeated presentations and are **not monitor
FPS measurements**. Generated samples do not establish smoothness or codec
support for every original video. Test the difficult originals and manually
check physical scrollwheel/drag behavior with difficult original files.
Device output is intentionally disabled; the waveform is a synthetic overlay.
