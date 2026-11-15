from PIL import Image, ImageDraw, ImageFilter
GLYPH = ["XXXXXX.",
         "XX...XX",
         "XX...XX",
         "XX..XX.",
         "XXXXX..",
         "XX..XX.",
         "XX...XX",
         "XX...XX",
         "XXXXXX."]
import sys
S = 1024
# The app icon: an 11 by 11 grid, the height of the badge, the B nearly
# filling it. ADAPTIVE is Android's foreground layer, which a launcher crops to
# about the middle two-thirds, so there the B is smaller in a 15 by 15 grid.
ADAPTIVE = "--adaptive" in sys.argv
N = 15 if ADAPTIVE else 11
PITCH = S * 30 / 432 if ADAPTIVE else 80
R = PITCH * 29 / 80
OFF = (S - (N - 1) * PITCH) / 2
TOP, LEFT = (N - len(GLYPH)) // 2, (N - len(GLYPH[0])) // 2
lit = {(r + TOP, c + LEFT) for r, row in enumerate(GLYPH) for c, ch in enumerate(row) if ch == "X"}
BG_TOP, BG_BOT = (0x16, 0x20, 0x2e), (0x08, 0x0e, 0x17)
OFFC, ONC = (0x26, 0x33, 0x44), (0xff, 0xc9, 0x63)

def centre(r, c): return OFF + c * PITCH, OFF + r * PITCH

def render(scale=4):
    s = S * scale
    img = Image.new("RGB", (s, s))
    px = img.load()
    g = ImageDraw.Draw(img)
    for y in range(s):
        t = y / (s - 1)
        g.line([(0, y), (s, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT)))
    glow = Image.new("RGB", (s, s), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for (r, c) in lit:
        x, y = centre(r, c)
        gd.ellipse([(x - R * 1.6) * scale, (y - R * 1.6) * scale, (x + R * 1.6) * scale, (y + R * 1.6) * scale], fill=(0x7a, 0x52, 0x14))
    glow = glow.filter(ImageFilter.GaussianBlur(26 * scale * PITCH / 80))
    img = Image.composite(img, img, Image.new("L", (s, s), 255))
    from PIL import ImageChops
    img = ImageChops.add(img, glow)
    d = ImageDraw.Draw(img)
    for r in range(N):
        for c in range(N):
            x, y = centre(r, c)
            d.ellipse([(x - R) * scale, (y - R) * scale, (x + R) * scale, (y + R) * scale],
                      fill=ONC if (r, c) in lit else OFFC)
    return img.resize((S, S), Image.LANCZOS)

im = render()
if ADAPTIVE:
    im.save("blinkenbadge-adaptive-foreground-1024.png", optimize=True)
    sys.exit()
im.save("blinkenbadge-icon-1024.png", optimize=True)
im.resize((512, 512), Image.LANCZOS).save("blinkenbadge-icon-512.png", optimize=True)
im.resize((256, 256), Image.LANCZOS).save("blinkenbadge-icon-256.png", optimize=True)
im.resize((64, 64), Image.LANCZOS).save("blinkenbadge-icon-64.png")

# SVG source, same geometry
dots = []
for r in range(N):
    for c in range(N):
        x, y = centre(r, c)
        on = (r, c) in lit
        dots.append(f'<circle cx="{x:g}" cy="{y:g}" r="{R}" fill="{"#ffc963" if on else "#263344"}"/>')
glows = "".join(f'<circle cx="{centre(r,c)[0]:g}" cy="{centre(r,c)[1]:g}" r="{R*1.6:g}"/>' for (r, c) in sorted(lit))
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16202e"/><stop offset="1" stop-color="#080e17"/></linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter></defs>
<rect width="{S}" height="{S}" fill="url(#bg)"/>
<g fill="#7a5214" filter="url(#glow)" style="mix-blend-mode:screen">{glows}</g>
{"".join(dots)}
</svg>
'''
open("blinkenbadge-icon.svg", "w").write(svg)
