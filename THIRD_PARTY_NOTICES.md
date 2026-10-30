# Third-Party Notices

## MultiFunPlayer playback design

The native T-Code playback engine (`backend/services/serial_playback.py`) and the
page-side funscript motion core (`frontend/src/services/funscriptMotion.js`)
adapt the fixed-update serial output design, dirty-value comparison, duration
formatting, PCHIP interpolation, two-stage media clock, soft sync, speed limit,
auto-home and polled (keyframe) output behaviour from MultiFunPlayer,
copyright (c) 2020 Yoooi, licensed under MIT.
The license text is included in `licenses/MultiFunPlayer-MIT.txt`.

Reference source: https://github.com/Yoooi0/MultiFunPlayer
Relevant files: `OutputTarget/AbstractOutputTarget.cs`,
`OutputTarget/ViewModels/SerialOutputTarget.cs`, `OutputTarget/ViewModels/ButtplugOutputTarget.cs`,
`OutputTarget/IUpdateContext.cs`, `UI/Controls/ViewModels/ScriptViewModel.cs`,
`Common/DeviceAxis.cs`, and `Common/KeyframeCollection.cs`.

Native USB communication uses pySerial 3.5, copyright (c) 2001-2020 Chris Liechti,
licensed under BSD-3-Clause. Its license is included in `licenses/pyserial-BSD.txt`.
Source: https://github.com/pyserial/pyserial/tree/v3.5

## FFmpeg and FFprobe

The Windows package includes Gyan's FFmpeg 8.1.1 essentials build and FFprobe
7.1.1 full build as separate media tools. These static Windows builds use GPLv3;
the license text is included in `licenses/ffmpeg-GPL-3.0.txt`.

Build provider, configuration, and dependency information:
https://www.gyan.dev/ffmpeg/builds/
FFmpeg source for these releases:
https://github.com/FFmpeg/FFmpeg/tree/n8.1.1
https://github.com/FFmpeg/FFmpeg/tree/n7.1.1

Retain these notices and satisfy corresponding-source requirements for the
distributed builds and their included dependencies.

## VLC playback engine and python-vlc

The desktop viewer embeds VideoLAN's libVLC 3.0.21 through python-vlc 3.0.21203.
libVLC is licensed under LGPL 2.1 or later; python-vlc is LGPL 2.1 or later.
The LGPL text is included in `licenses/libvlc-python-vlc-LGPL-2.1.txt`.
The official VLC Windows runtime retains its original COPYING.txt,
AUTHORS, and plugin files in the packaged `vlc/` directory. Individual runtime
components retain their applicable licenses, including GPL components.

Official runtime and matching VLC source:
https://download.videolan.org/pub/videolan/vlc/3.0.21/
Python binding source and license:
https://github.com/oaubert/python-vlc

Release distributors must satisfy the corresponding-source requirements of
the components they distribute, in addition to retaining these notices.

## pokemon-cards-css

The TCG V2 cursor-reactive rarity finishes adapt visual techniques from
[`simeydotme/pokemon-cards-css`](https://github.com/simeydotme/pokemon-cards-css),
copyright Simon Goellner. The referenced project is licensed under the
[GNU General Public License v3.0](https://github.com/simeydotme/pokemon-cards-css/blob/main/LICENSE).

Referenced effect families: Cosmos Holo, Trainer Gallery Holo, VMAX, and V Full Art.

## Mr De Haviland

SPR generated signatures use Mr De Haviland by Sudtipos, distributed through
[Google Fonts](https://fonts.google.com/specimen/Mr+De+Haviland) under the SIL Open Font License 1.1.
The complete license is bundled beside the font file.
