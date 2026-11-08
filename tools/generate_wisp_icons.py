#!/usr/bin/env python3
"""Generate WISP app icons from its approved 144x144 flat-color source.
No gradients or tiny text. Pebble color palette: black, white and #00AAFF.
For monochrome displays, the blue accents become white.
"""
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "branding" / "WISP_source_144.png"
RESOURCES = ROOT / "resources" / "images"
BRANDING = ROOT / "branding"
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
BLUE = (0, 170, 255)
PALETTE = (BLACK, WHITE, BLUE)


def quantize(source, size):
    source = source.resize((size, size), Image.Resampling.LANCZOS).convert("RGB")
    values = []
    for r, g, b in source.getdata():
        index = min(range(3), key=lambda i:
            (r - PALETTE[i][0]) ** 2 +
            (g - PALETTE[i][1]) ** 2 +
            (b - PALETTE[i][2]) ** 2)
        values.append(index)
    return values


def save_rgb(indices, size, filename):
    image = Image.new("RGB", (size, size))
    image.putdata([PALETTE[i] for i in indices])
    image.save(filename, optimize=True)


def save_mono(indices, size, filename):
    image = Image.new("1", (size, size))
    image.putdata([0 if i == 0 else 255 for i in indices])
    image.save(filename, optimize=True)


def main():
    image = Image.open(SOURCE).convert("RGB")
    assert image.size == (144, 144), image.size
    RESOURCES.mkdir(parents=True, exist_ok=True)
    BRANDING.mkdir(parents=True, exist_ok=True)
    for n in (144, 80, 48):
        labels = quantize(image, n)
        out = BRANDING if n != 48 else RESOURCES
        save_rgb(labels, n, out / f"WISP_color_{n}.png")
        save_mono(labels, n, out / f"WISP_mono_{n}.png")

    # 25px high-contrast white glyph with transparent black background,
    # suitable for monochrome Pebble launcher menus.
    labels = quantize(image, 25)
    menu = Image.new("RGBA", (25, 25))
    menu.putdata([(255, 255, 255, 0 if idx == 0 else 255) for idx in labels])
    menu.save(RESOURCES / "WISP_menu_25.png", optimize=True)
    print("Created WISP 144/80/48 color and monochrome logos plus 25px menu icon")


if __name__ == "__main__":
    main()
