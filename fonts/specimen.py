#!/usr/bin/env python3
"""Render the shipped font artwork to docs/typefaces.png using only stdlib."""
import argparse
import json
import pathlib
import struct
import zlib

from build import parse
from webfont import ORDER

ROOT = pathlib.Path(__file__).resolve().parent.parent
WIDTH, ROW_HEIGHT, SCALE = 1200, 118, 6
faces = {meta['id']: (meta, {c: (advance, rows) for c, advance, rows in glyphs})
         for meta, glyphs in (parse(ROOT / 'fonts' / f'{name}.face') for name in ORDER)}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--faces', nargs='+', choices=[name for name in ORDER if name != 'emoji'],
                    default=[name for name in ORDER if name != 'emoji'])
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'docs' / 'typefaces.png')
args = parser.parse_args()
pickable = [faces[name] for name in args.faces]
HEIGHT = 90 + ROW_HEIGHT * len(pickable)
pixels = bytearray(bytes.fromhex('11151e') * WIDTH * HEIGHT)


def rect(x, y, w, h, color):
    rgb = bytes.fromhex(color)
    for py in range(max(0, y), min(HEIGHT, y + h)):
        start, end = max(0, x), min(WIDTH, x + w)
        if start < end:
            at = (py * WIDTH + start) * 3
            pixels[at:at + (end - start) * 3] = rgb * (end - start)


def text(face, value, x, y, scale, color, grid=False):
    meta, glyphs = face
    jitter = json.loads(meta.get('jitter', '[]'))
    end = x + sum(glyphs[char][0] for char in value) * scale
    for i, char in enumerate(value):
        advance, rows = glyphs[char]
        ink = [py for py, row in enumerate(rows) if '#' in row]
        dy = jitter[i % len(jitter)] if jitter else 0
        if ink:
            dy = max(-min(ink), min(10 - max(ink), dy))
        if grid:
            for py in range(11):
                for px in range(advance):
                    rect(x + px * scale, y + py * scale, scale - 1, scale - 1, '293445')
        for py, row in enumerate(rows):
            for px, bit in enumerate(row):
                if bit == '#' and x + px * scale < end:
                    rect(x + px * scale, y + (py + dy) * scale,
                         (max(1, scale - 1) if grid else scale), (max(1, scale - 1) if grid else scale), color)
        x += advance * scale


text(faces['sans'], 'BlinkenBadge Pixel Typefaces', 24, 12, 3, 'edf2fb')
text(faces['sans'], f'{len(pickable)} faces / 11 rows / Latin + Cyrillic', 24, 48, 2, 'a5b2c7')
for i, face in enumerate(pickable):
    y = 90 + i * ROW_HEIGHT
    text(faces['sans'], face[0]['name'], 24, y + 16, 2, 'a9c7ff')
    text(face, 'Badge Magic!', 200, y, SCALE, 'ff686f', grid=True)


def chunk(kind, value):
    return struct.pack('!I', len(value)) + kind + value + struct.pack('!I', zlib.crc32(kind + value))


raw = b''.join(b'\0' + pixels[y * WIDTH * 3:(y + 1) * WIDTH * 3] for y in range(HEIGHT))
out = args.output
out.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', WIDTH, HEIGHT, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
print(out)
