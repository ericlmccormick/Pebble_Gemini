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

# Agent logos must be genuinely transparent rather than RGB on opaque squares.
for name in ('wisp','gemini','openai','claude','grok','muse','openrouter','deepseek'):
    for mode in ('color','mono'):
        path=root/'resources/images'/f'agent_{name}_{mode}.png'
        img=Image.open(path).convert('RGBA')
        assert img.size==(40,40),path
        alpha=[px[3] for px in img.getdata()]
        assert min(alpha)==0 and max(alpha)==255,(path,'missing alpha')
        assert img.getpixel((0,0))[3]==0,(path,'opaque corner')
        assert sum(a>0 for a in alpha)>15,(path,'empty artwork')
print('PASS: all 16 agent assets have transparent backgrounds and visible artwork')
