#!/usr/bin/env python3
"""Build-time icon regression checks for Pebble color and monochrome assets."""
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]
palette={(0,0,0),(255,255,255),(0,170,255)}
for n in (144,80,48):
    out=root/("resources/images" if n==48 else "branding")
    c=Image.open(out/f"WISP_color_{n}.png").convert("RGB")
    assert c.size==(n,n)
    assert set(c.getdata()).issubset(palette)
    assert len(set(c.getdata()))==3
    m=Image.open(out/f"WISP_mono_{n}.png")
    assert m.size==(n,n)
    assert set(m.convert("L").getdata())=={0,255}
menu=Image.open(root/"resources/images/WISP_menu_25.png").convert("RGBA")
assert menu.size==(25,25)
assert set(p[3] for p in menu.getdata())=={0,255}
print("PASS: 144/80/48 color + monochrome palettes, 25px menu icon")
