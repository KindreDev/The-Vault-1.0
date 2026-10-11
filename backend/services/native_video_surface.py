"""Normal Windows VLC output beneath the transparent WebView controls.

Only small control/clock messages cross the bridge; decoded pixels stay native.
Source authorization belongs to NativeVideoBridge, before a window is created.
"""
from pathlib import Path
import threading
import time
import uuid
from services.native_video import display_dimensions, load_vlc


class NativeSurfaceHost:
    def __init__(self, get_window):
        self.get_window = get_window
        self.sessions = {}
        self.prepared = {}
        self.guard = threading.RLock()
        self.vlc = load_vlc()
        self.instance = self.vlc.Instance('--no-video-title-show', '--no-osd', '--quiet',
                                          '--avcodec-hw=any', '--vout=direct3d11')
        self.closing = False
        self.stopped = threading.Event()
        self.monitor = threading.Thread(target=self._monitor, name='vault-native-video', daemon=True)
        self.monitor.start()

    @property
    def window(self):
        return self.get_window()

    def _monitor(self):
        # Initialization, looping and pending seeks must work while JS is hidden.
        while not self.stopped.wait(.05):
            with self.guard:
                for session_id in list(self.sessions):
                    try:
                        self.status(session_id)
                    except Exception as exc:
                        self.sessions[session_id]['error'] = str(exc)

    def _ui(self, action):
        from System import Action
        self.window.native.Invoke(Action(action))

    def open(self, session_id, path, options):
        with self.guard:
            if self.closing:
                raise RuntimeError('The Vault window is closing')
            if session_id in self.sessions:
                raise ValueError('Invalid or excessive player sessions')
            owner = options.get('preloadKey')
            warmed_id = self.prepared.get(owner)
            warmed = self.sessions.get(warmed_id)
            if warmed and warmed['path'] == path:
                self.prepared.pop(owner)
                self.sessions.pop(warmed_id)
                self.sessions[session_id] = warmed
                warmed.update(wants_play=bool(options.get('autoPlay', True)),
                    volume=float(options.get('volume', 1)), muted=bool(options.get('muted', False)),
                    loop=bool(options.get('loop')), rate=float(options.get('rate', 1)))
                warmed['player'].audio_set_volume(round(warmed['volume'] * 100))
                warmed['player'].set_rate(warmed['rate'])
                return {'session': session_id, 'name': Path(path).name, 'prepared': True}
            if len(self.sessions) >= 12:
                raise ValueError('Excessive player sessions')
            from System.Drawing import Color, Point, Size
            from System.Windows.Forms import Panel
            panels = {}
            def create():
                form = self.window.native
                clip = Panel()
                clip.BackColor = Color.Black
                clip.Location = Point(0, 0)
                clip.Size = Size(1, 1)
                clip.Visible = False
                surface = Panel()
                surface.BackColor = Color.Black
                surface.Size = Size(1, 1)
                clip.Controls.Add(surface)
                form.Controls.Add(clip)
                clip.SendToBack()
                form.browser.webview.DefaultBackgroundColor = Color.Transparent
                form.browser.webview.BringToFront()
                panels.update(clip=clip, surface=surface, hwnd=surface.Handle.ToInt64())
            self._ui(create)
            media = self.instance.media_new_path(path)
            # VLC 3 needs a brief silent decode pass to create its output.
            # Rewind and hold its opening frame before declaring it ready.
            player = self.instance.media_player_new()
            player.set_media(media)
            player.set_hwnd(panels['hwnd'])
            player.video_set_mouse_input(False)
            player.video_set_key_input(False)
            player.audio_set_volume(round(float(options.get('volume', 1)) * 100))
            player.audio_set_mute(True)
            session = dict(player=player, media=media, panels=panels, token=path, path=path,
                created=time.monotonic(), first_frame=None, loop=bool(options.get('loop')),
                wants_play=bool(options.get('autoPlay', True)), ready=False, presented=False, visible=False,
                volume=float(options.get('volume', 1)), muted=bool(options.get('muted', False)), pending_seek=None,
                rate=float(options.get('rate', 1)), last_stats=None, layout=None)
            self.sessions[session_id] = session
            if player.play() == -1:
                self.close(session_id)
                raise RuntimeError('VLC could not open this video')
            return {'session': session_id, 'name': Path(path).name}

    def prepare(self, owner, path):
        with self.guard:
            old = self.sessions.get(self.prepared.get(owner))
            if old and old['path'] == path:
                return
            self.clear_prepared(owner)
            # Bounded: one upcoming file per viewer, at most three overall.
            if len(self.prepared) >= 3:
                self.clear_prepared(next(iter(self.prepared)))
            session_id = f'prepared-{uuid.uuid4()}'
            self.open(session_id, path, {'autoPlay': False, 'muted': True})
            self.prepared[owner] = session_id
            try:
                # A tiny native surface lets VLC prepare its output without
                # opening WebView background holes or covering the current video.
                self.layout(session_id, {'viewportWidth': self.window.native.ClientSize.Width,
                    'stage': {'x': 0, 'y': 0, 'width': 2, 'height': 2}, 'visible': True})
            except Exception:
                self.clear_prepared(owner)
                raise

    def clear_prepared(self, owner):
        with self.guard:
            session_id = self.prepared.pop(owner, None)
            if session_id:
                self.close(session_id)

    def layout(self, session_id, layout):
        with self.guard:
            session = self.sessions.get(session_id)
            if not session:
                return None
            from System.Drawing import Point, Size
            def position():
                form = self.window.native
                ratio = form.ClientSize.Width / max(1, float(layout['viewportWidth']))
                stage = layout['stage']
                clip, surface = session['panels']['clip'], session['panels']['surface']
                x, y = round(stage['x'] * ratio), round(stage['y'] * ratio)
                w, h = max(1, round(stage['width'] * ratio)), max(1, round(stage['height'] * ratio))
                bounds = layout.get('clip', stage)
                cx, cy = round(bounds['x'] * ratio), round(bounds['y'] * ratio)
                cw, ch = max(1, round(bounds['width'] * ratio)), max(1, round(bounds['height'] * ratio))
                clip.Location, clip.Size = Point(cx, cy), Size(cw, ch)
                video_w, video_h = session.get('dimensions') or session['player'].video_get_size(0)
                video_w, video_h = video_w or w, video_h or h
                fit = (max if layout.get('fit') == 'cover' else min)(w / video_w, h / video_h)
                zoom = max(1, min(8, float(layout.get('zoom', 1))))
                draw_w, draw_h = max(1, round(video_w * fit * zoom)), max(1, round(video_h * fit * zoom))
                left = round((w - draw_w) / 2 + float(layout.get('panX', 0)) * ratio)
                top = round((h - draw_h) / 2 + float(layout.get('panY', 0)) * ratio)
                surface.Location, surface.Size = Point(left + x - cx, top + y - cy), Size(draw_w, draw_h)
                clip.Visible = bool(layout.get('visible', True))
                session['visible'] = clip.Visible
                session['layout'] = {'stage': [x, y, w, h], 'video': [left, top, draw_w, draw_h],
                                     'zoom': zoom, 'pan': [layout.get('panX', 0), layout.get('panY', 0)]}
            self._ui(position)
            return session['layout']

    def command(self, session_id, command, value=None):
        with self.guard:
            session = self.sessions.get(session_id)
            if not session:
                return
            player = session['player']
            if command == 'present':
                if not session['ready'] or not session['visible']:
                    return False
                session['presented'] = True
                player.audio_set_mute(session['muted'])
                player.set_pause(0 if session['wants_play'] else 1)
                return True
            elif command == 'play':
                session['wants_play'] = True
                if not session['presented']:
                    return
                if player.get_state() == self.vlc.State.Ended:
                    player.stop()
                    player.play()
                else:
                    player.set_pause(0)
            elif command == 'pause':
                session['wants_play'] = False
                if session['presented']:
                    player.set_pause(1)
            elif command == 'seek':
                session['pending_seek'] = max(0, float(value))
                if player.get_state() == self.vlc.State.Ended:
                    player.stop()
                    player.play()
                elif session['ready']:
                    player.set_time(round(session['pending_seek'] * 1000))
                    session['pending_seek'] = None
            elif command == 'volume':
                session['volume'] = max(0, min(1, float(value)))
                player.audio_set_volume(round(session['volume'] * 100))
            elif command == 'muted':
                session['muted'] = bool(value)
                player.audio_set_mute(session['muted'] or not session['presented'])
            elif command == 'rate':
                session['rate'] = max(.25, min(4, float(value)))
                player.set_rate(session['rate'])
            elif command == 'loop':
                session['loop'] = bool(value)
            else:
                raise ValueError('Unknown video command')

    def status(self, session_id):
        with self.guard:
            session = self.sessions.get(session_id)
            if not session:
                return None
            player = session['player']
            state = player.get_state()
            now = time.monotonic()
            stats = self.vlc.MediaStats()
            available = session['media'].get_stats(stats)
            displayed = stats.displayed_pictures if available else 0
            width, height = player.video_get_size(0)
            if displayed and not session['ready'] and not session.get('primed'):
                session['primed'] = True
                player.set_pause(1)
                player.set_time(0)
            if (displayed and not session['ready'] and session.get('primed')
                    and state == self.vlc.State.Paused and 0 <= player.get_time() <= 40):
                session['dimensions'] = display_dimensions(self.vlc, session['media']) or (width, height)
                session['ready'] = True
                session['first_frame'] = round((now - session['created']) * 1000)
                player.set_rate(session['rate'])
                player.audio_set_volume(round(session['volume'] * 100))
                player.audio_set_mute(session['muted'] or not session['presented'])
                player.set_pause(1)
            if session['pending_seek'] is not None and session['ready']:
                player.set_time(round(session['pending_seek'] * 1000))
                session['pending_seek'] = None
            if session.get('dimensions'):
                width, height = session['dimensions']
            ended = state == self.vlc.State.Ended
            if ended and session['loop'] and session['wants_play']:
                player.stop()
                player.play()
                player.set_rate(session['rate'])
                session['last_stats'] = None
                ended = False
            fps = None
            previous = session['last_stats']
            if previous and now - previous[0] >= .5:
                fps = max(0, displayed - previous[1]) / (now - previous[0])
                session['fps'] = round(fps, 1)
                session['last_stats'] = (now, displayed)
            elif not previous:
                session['last_stats'] = (now, displayed)
            error = session.get('error') or ('VLC could not open or decode this video.' if state == self.vlc.State.Error else None)
            if not session['ready'] and now - session['created'] > 20:
                error = error or 'No video frame appeared within 20 seconds. Retry or choose another file.'
            return dict(token=session['token'], ready=session['ready'], presented=session['presented'],
                playing=state == self.vlc.State.Playing and session['wants_play'] and session['presented'],
                ended=ended, time=max(0, player.get_time()) / 1000 if session['presented'] else 0,
                duration=max(0, player.get_length()) / 1000,
                width=width, height=height, fps=session.get('fps'), source_fps=round(player.get_fps(), 2),
                displayed=displayed, lost=stats.lost_pictures if available else None,
                first_frame_ms=session['first_frame'], error=error, layout=session['layout'])

    def close(self, session_id):
        with self.guard:
            session = self.sessions.pop(session_id, None)
            if not session:
                return
            for owner, prepared_id in list(self.prepared.items()):
                if prepared_id == session_id:
                    self.prepared.pop(owner)
            session['player'].stop()
            session['player'].release()
            session['media'].release()
            def dispose():
                self.window.native.Controls.Remove(session['panels']['clip'])
                session['panels']['clip'].Dispose()
            self._ui(dispose)

    def media_clock(self, session_id):
        with self.guard:
            session = self.sessions.get(session_id)
            if not session:
                return None
            player = session['player']
            return {'time': max(0, player.get_time()) / 1000 if session['presented'] else 0,
                    'duration': max(0, player.get_length()) / 1000,
                    'rate': session['rate'],
                    'playing': session['ready'] and session['presented'] and session['wants_play']
                        and player.get_state() == self.vlc.State.Playing
                        and session['pending_seek'] is None and not session.get('error')}

    def close_all(self):
        with self.guard:
            for session_id in list(self.sessions):
                self.close(session_id)

    def shutdown(self):
        with self.guard:
            self.closing = True
            self.stopped.set()
            self.close_all()
            if self.instance:
                self.instance.release()
                self.instance = None
        self.monitor.join(timeout=2)
