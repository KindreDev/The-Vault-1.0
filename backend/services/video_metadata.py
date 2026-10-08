"""Bounded, cached inspection of original video headers; never decodes or copies media."""
import json
import math
import os
import shutil
import subprocess
import threading
from fractions import Fraction
from functools import lru_cache
from pathlib import Path

from services.scanner import _get_ffmpeg_exe

_slots = threading.BoundedSemaphore(2)


def _number(value):
    try:
        result = float(Fraction(str(value)))
        return result if math.isfinite(result) and result > 0 else None
    except (ValueError, ZeroDivisionError):
        return None


@lru_cache(maxsize=128)
def _probe(path, size, modified):
    ffmpeg = shutil.which(_get_ffmpeg_exe()) or _get_ffmpeg_exe()
    sibling = Path(ffmpeg).with_name('ffprobe.exe' if os.name == 'nt' else 'ffprobe')
    executable = str(sibling) if sibling.is_file() else shutil.which('ffprobe')
    if not executable:
        raise RuntimeError('Video information requires the bundled FFprobe tool.')
    if not _slots.acquire(blocking=False):
        raise RuntimeError('Video information is busy. Please try again.')
    try:
        result = subprocess.run(
            [executable, '-v', 'error', '-show_entries',
             'format=duration,bit_rate,format_name:stream=codec_type,codec_name,profile,width,height,avg_frame_rate,r_frame_rate,duration,pix_fmt,level:stream_disposition=attached_pic:stream_tags=rotate:stream_side_data=rotation',
             '-of', 'json', path], stdin=subprocess.DEVNULL, capture_output=True,
            text=True, timeout=15, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise RuntimeError('Could not read this video’s information.')
        data = json.loads(result.stdout)
        streams = data.get('streams', [])
        video = next((s for s in streams
                      if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')), {})
        audio = [s for s in streams if s.get('codec_type') == 'audio']
        video_streams = [s for s in streams
                         if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')]
        container = data.get('format', {})
        width, height = video.get('width'), video.get('height')
        rotation = next((s.get('rotation') for s in video.get('side_data_list', []) if 'rotation' in s),
                        video.get('tags', {}).get('rotate', 0))
        try:
            if abs(float(rotation)) % 180 == 90:
                width, height = height, width
        except (ValueError, TypeError):
            pass
        duration = _number(container.get('duration')) or _number(video.get('duration'))
        bitrate = _number(container.get('bit_rate'))
        audio_codec = audio[0].get('codec_name') if audio else None
        format_names = set((container.get('format_name') or '').split(','))
        browser_safe = (
            Path(path).suffix.lower() == '.mp4'
            and 'mp4' in format_names
            and len(video_streams) == 1
            and video.get('codec_name') == 'h264'
            and video.get('profile') in {'Baseline', 'Constrained Baseline', 'Main', 'High'}
            and video.get('pix_fmt') == 'yuv420p'
            and isinstance(video.get('level'), int)
            and 10 <= video['level'] <= 52
            and all(s.get('codec_type') in {'video', 'audio'} for s in streams)
            and (not audio or (len(audio) == 1 and audio_codec == 'aac'))
        )
        return dict(width=width, height=height, duration=duration,
                    fps=_number(video.get('avg_frame_rate')) or _number(video.get('r_frame_rate')),
                    format=Path(path).suffix.lstrip('.').upper() or container.get('format_name'),
                    codec=video.get('codec_name'), profile=video.get('profile'), audio_codec=audio_codec,
                    browser_safe=browser_safe, bit_rate=bitrate,
                    bit_rate_estimated=False)
    finally:
        _slots.release()


def video_metadata(path):
    stat = os.stat(path)
    return _probe(path, stat.st_size, stat.st_mtime_ns)
