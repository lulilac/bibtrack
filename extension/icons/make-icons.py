#!/usr/bin/env python3
"""Draw the add-on icons.

Everything is drawn once at 1024px and downscaled, which is what gives the small sizes clean
edges. Run it after changing anything here:

    python3 extension/icons/make-icons.py

The mark is the same lowercase "b" the web UI shows in its corner. The "-saved" variants carry a
green tick and are swapped in by background.js when the page you are on is already in the library.
"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).parent
SIZES = [16, 32, 48, 96, 128]
S = 1024                      # drawing canvas; every coordinate below is in these units

INDIGO = (66, 89, 224, 255)   # matches the app's accent blue
WHITE = (255, 255, 255, 255)
GREEN = (46, 160, 67, 255)


def rounded_square(d):
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=INDIGO)


def letter_b(d):
    """A geometric 'b': a stem, and a ring for the bowl."""
    stem = [300, 196, 372, 812]
    bowl_outer = [300, 452, 700, 812]
    bowl_inner = [372, 524, 628, 740]
    d.ellipse(bowl_outer, fill=WHITE)
    d.ellipse(bowl_inner, fill=INDIGO)
    d.rectangle(stem, fill=WHITE)


def tick(d):
    """A green disc with a tick, bottom-right, ringed so it stays readable on the blue."""
    cx, cy, r = 790, 790, 206
    d.ellipse([cx - r - 30, cy - r - 30, cx + r + 30, cy + r + 30], fill=INDIGO)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    d.line([(cx - 98, cy + 4), (cx - 28, cy + 76), (cx + 102, cy - 72)],
           fill=WHITE, width=54, joint='curve')
    # round off the stroke ends, which `line` leaves square
    for x, y in [(cx - 98, cy + 4), (cx + 102, cy - 72)]:
        d.ellipse([x - 27, y - 27, x + 27, y + 27], fill=WHITE)


def render(saved: bool):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rounded_square(d)
    letter_b(d)
    if saved:
        tick(d)
    return img


for saved in (False, True):
    master = render(saved)
    for size in SIZES:
        name = f'{size}-saved.png' if saved else f'{size}.png'
        master.resize((size, size), Image.LANCZOS).save(OUT / name)
        print('wrote', name)
