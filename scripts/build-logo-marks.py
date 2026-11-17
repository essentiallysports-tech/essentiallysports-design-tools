#!/usr/bin/env python3
"""Vendor league marks and draw F1 constructor name badges for the logo library.

Run from the repo root:  python3 scripts/build-logo-marks.py

- League marks come from ESPN's public league-logo CDN (the same source the
  team logos use) and are saved as 256px WebP in assets/logos/leagues/.
- F1 constructors have no public CORS-safe logo source, so FrameUp draws a
  plain name badge per team (team colour tile, Acumin Pro Condensed Bold from
  fonts/). Badges are clearly not the official marks; the picker labels them
  "Name badge" and people can upload the real mark.
- ATP and WTA have no public mark either: same name-badge treatment.
The entries that point at these files are hand-written in logo-library.js.
"""
import io
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'logos')
UA = {'User-Agent': 'FrameUp logo library builder'}
ESPN = 'https://a.espncdn.com'

MARKS = {
    'nba': '/i/teamlogos/leagues/500/nba.png',
    'wnba': '/i/teamlogos/leagues/500/wnba.png',
    'nhl': '/i/teamlogos/leagues/500/nhl.png',
    'mls': '/i/leaguelogos/soccer/500/19.png',
    'epl': '/i/leaguelogos/soccer/500/23.png',
    'laliga': '/i/leaguelogos/soccer/500/15.png',
    'bundesliga': '/i/leaguelogos/soccer/500/10.png',
    'seriea': '/i/leaguelogos/soccer/500/12.png',
    'ligue1': '/i/leaguelogos/soccer/500/9.png',
    'ucl': '/i/leaguelogos/soccer/500/2.png',
    'f1': '/i/teamlogos/leagues/500/f1.png',
    'ufc': '/i/teamlogos/leagues/500/ufc.png',
    'pga-tour': '/i/teamlogos/leagues/500/pgatour.png',
    'lpga': '/i/teamlogos/leagues/500/lpga.png',
    'liv-golf': '/i/teamlogos/leagues/500/livgolf.png',
}

# id, label on the badge, tile colour, text colour
BADGES = {
    'f1': [
        ('mclaren', 'McLAREN', '#FF8000', '#000000'),
        ('ferrari', 'FERRARI', '#DC0000', '#FFFFFF'),
        ('red-bull', 'RED BULL', '#1E41FF', '#FFFFFF'),
        ('mercedes', 'MERCEDES', '#00A19C', '#FFFFFF'),
        ('aston-martin', 'ASTON MARTIN', '#00594F', '#FFFFFF'),
        ('alpine', 'ALPINE', '#0078C1', '#FFFFFF'),
        ('williams', 'WILLIAMS', '#00A0DE', '#FFFFFF'),
        ('racing-bulls', 'RACING BULLS', '#1634CC', '#FFFFFF'),
        ('haas', 'HAAS', '#B6BABD', '#000000'),
        ('audi', 'AUDI', '#1A1A1A', '#FFFFFF'),
        ('cadillac', 'CADILLAC', '#000000', '#FFFFFF'),
    ],
    'leagues': [
        ('atp', 'ATP', '#002865', '#FFFFFF'),
        ('wta', 'WTA', '#5B2C83', '#FFFFFF'),
    ],
}
FONT = os.path.join(ROOT, 'fonts', 'acumin-pro-condensed-bold.otf')
SIZE = 256


def fetch(path):
    url = f'{ESPN}/combiner/i?img={path}&w=512&h=512'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as res:
        return res.read()


def save_webp(image, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    image.save(target, 'WEBP', quality=82, method=6)


def square(image):
    image = image.convert('RGBA')
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    image.thumbnail((SIZE, SIZE), Image.LANCZOS)
    side = max(image.size)
    tile = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    tile.paste(image, ((side - image.size[0]) // 2, (side - image.size[1]) // 2))
    return tile


def badge(label, bg, fg):
    scale = 2
    side = SIZE * scale
    image = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, side - 1, side - 1), radius=56 * scale // 2, fill=bg)
    words = label.split(' ')
    lines = words if len(words) > 1 else [label]
    size = 150 * scale
    while size > 20:
        font = ImageFont.truetype(FONT, size)
        widths = [draw.textbbox((0, 0), line, font=font)[2] for line in lines]
        height = size * len(lines) * 0.92
        if max(widths) <= side * 0.8 and height <= side * 0.7:
            break
        size -= 4
    font = ImageFont.truetype(FONT, size)
    y = (side - size * len(lines) * 0.92) / 2
    for line in lines:
        box = draw.textbbox((0, 0), line, font=font)
        draw.text(((side - (box[2] - box[0])) / 2 - box[0], y - box[1] + size * 0.04), line, font=font, fill=fg)
        y += size * 0.92
    return image.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    for key, path in MARKS.items():
        target = os.path.join(OUT, 'leagues', f'{key}.webp')
        if os.path.exists(target):
            continue
        save_webp(square(Image.open(io.BytesIO(fetch(path)))), target)
        print('mark', key)
    for folder, items in BADGES.items():
        for key, label, bg, fg in items:
            target = os.path.join(OUT, folder, f'{key}.webp')
            save_webp(badge(label, bg, fg), target)
            print('badge', folder, key)


if __name__ == '__main__':
    main()
