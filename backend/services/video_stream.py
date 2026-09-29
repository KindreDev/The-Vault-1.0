"""Open streamed videos without preventing Windows file and folder moves."""

import os


def open_video_readonly(path: str, flags: int) -> int:
    """Return a read-only descriptor for ``open(..., opener=...)``.

    Python's normal Windows file open does not share delete access. A browser
    can keep a video stream alive after a hover preview disappears, and that
    handle otherwise blocks gallery relocation and folder renaming. The stream
    may finish reading its existing handle after the file is renamed.
    """
    if os.name != "nt":
        return os.open(path, flags)

    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
        wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
    ]
    create_file.restype = wintypes.HANDLE
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL

    generic_read = 0x80000000
    share_read_write_delete = 0x00000001 | 0x00000002 | 0x00000004
    open_existing = 3
    handle = create_file(path, generic_read, share_read_write_delete,
                         None, open_existing, 0, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        # open_osfhandle owns the handle after this succeeds; closing the
        # Python file also closes the Windows handle.
        return msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    except Exception:
        close_handle(handle)
        raise


def read_video_chunk(path: str, offset: int, length: int) -> bytes:
    """Read one chunk and close the file before HTTP sends it to the browser.

    A paused or abandoned browser response can wait indefinitely between
    chunks. Keeping a handle across that wait blocks renaming its parent folder
    on Windows, even when the handle shares delete access.
    """
    with open(path, "rb", opener=open_video_readonly) as video:
        video.seek(offset)
        return video.read(length)
