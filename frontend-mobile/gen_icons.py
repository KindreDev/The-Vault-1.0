"""Generate PWA icons for The Vault mobile (icon-192/512 + apple touch)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "public")
os.makedirs(OUT, exist_ok=True)

BG = (14, 14, 14)
ACCENT = (127, 119, 221)  # vault violet


def make(size, name, rounded=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.22)
    box = [0, 0, size - 1, size - 1]
    if rounded:
        d.rounded_rectangle(box, radius=r, fill=BG)
    else:
        d.rectangle(box, fill=BG)

    # Draw a bold "V" using a font, fall back to polygon if no font.
    txt = "V"
    fsize = int(size * 0.62)
    font = None
    for path in (
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ):
        if os.path.exists(path):
            font = ImageFont.truetype(path, fsize)
            break
    if font:
        bb = d.textbbox((0, 0), txt, font=font)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        d.text(((size - w) / 2 - bb[0], (size - h) / 2 - bb[1]), txt,
               font=font, fill=ACCENT)
    else:
        m = size * 0.28
        d.polygon([(m, m), (size / 2, size - m), (size - m, m),
                   (size - m * 1.3, m), (size / 2, size - m * 1.6),
                   (m * 1.3, m)], fill=ACCENT)

    img.save(os.path.join(OUT, name))
    print("wrote", name)


make(192, "icon-192.png")
make(512, "icon-512.png")
make(180, "apple-touch-icon.png")
print("done")
