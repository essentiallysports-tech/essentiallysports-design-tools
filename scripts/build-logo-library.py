#!/usr/bin/env python3
"""Build FrameUp's team logo library (logo-library-data.js + assets/logos/).

Run from the repo root:  python3 scripts/build-logo-library.py [--no-images]

What it does
- Reads public team lists from ESPN's site API (names, abbreviations, colours,
  logo URLs) for the leagues in LEAGUES below.
- For "vendored" leagues it downloads each logo through ESPN's resizing
  combiner at 256px, trims nothing, and saves an optimised WebP into
  assets/logos/<league>/<key>.webp (plus <key>-dark.webp when ESPN ships a
  different dark-background variant). Same-origin files never taint the
  export canvas.
- Other leagues (college basketball) keep ESPN CDN URLs. ESPN's logo CDN sends
  `Access-Control-Allow-Origin: *`, so they load with crossOrigin="anonymous"
  and stay export-safe; a school that is also FBS reuses the vendored file.
- Hand-made entries (F1 constructors, tours, league marks) live in
  logo-library.js, not here.

The output is deterministic (sorted), so re-running only changes what ESPN
changed. Re-run when a team rebrands or a league expands, then run
scripts/test-logo-library.mjs.
"""
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JS = os.path.join(ROOT, 'logo-library-data.js')
OUT_DIR = os.path.join(ROOT, 'assets', 'logos')
SITE = 'https://site.api.espn.com/apis/site/v2/sports/'
CORE = 'https://sports.core.api.espn.com/v2/sports/'
UA = {'User-Agent': 'FrameUp logo library builder'}
SIZE = 256

# id, ESPN path, how keys are made, vendored?, dark variants?
LEAGUES = [
    ('nfl', 'football/nfl', 'abbr', True, True),
    ('nba', 'basketball/nba', 'abbr', True, True),
    ('wnba', 'basketball/wnba', 'abbr', True, True),
    ('mlb', 'baseball/mlb', 'abbr', True, True),
    ('nhl', 'hockey/nhl', 'abbr', True, True),
    ('mls', 'soccer/usa.1', 'id', True, False),
    ('epl', 'soccer/eng.1', 'id', True, False),
    ('laliga', 'soccer/esp.1', 'id', True, False),
    ('bundesliga', 'soccer/ger.1', 'id', True, False),
    ('seriea', 'soccer/ita.1', 'id', True, False),
    ('ligue1', 'soccer/fra.1', 'id', True, False),
    ('cfb', 'football/college-football', 'id', True, False),
    ('cbb', 'basketball/mens-college-basketball', 'id', False, False),
]
# Division filters from ESPN's core API: FBS (group 80) and D-I hoops (50).
GROUP_FILTER = {
    'cfb': 'football/leagues/college-football/seasons/2026/types/2/groups/80/teams?limit=400',
    'cbb': 'basketball/leagues/mens-college-basketball/seasons/2027/types/2/groups/50/teams?limit=500',
}


def get_json(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as res:
                return json.load(res)
        except Exception:  # noqa: BLE001 - retry then raise
            if attempt == 2:
                raise
            time.sleep(1.5)


def get_bytes(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as res:
                return res.read()
        except urllib.error.HTTPError as error:
            if error.code in (403, 404):
                return None  # no such logo (common for dark variants)
            if attempt == 2:
                return None
            time.sleep(1.5)
        except Exception:  # noqa: BLE001
            if attempt == 2:
                return None
            time.sleep(1.5)


def group_ids(league):
    path = GROUP_FILTER.get(league)
    if not path:
        return None
    data = get_json(CORE + path)
    ids = set()
    for item in data.get('items', []):
        ref = item.get('$ref', '')
        ids.add(ref.split('/teams/')[1].split('?')[0])
    return ids


def to_webp(raw):
    from PIL import Image  # local import so --no-images works without Pillow
    image = Image.open(io.BytesIO(raw)).convert('RGBA')
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    image.thumbnail((SIZE, SIZE), Image.LANCZOS)
    # Centre on a square transparent tile so every logo shares one aspect.
    side = max(image.size)
    tile = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    tile.paste(image, ((side - image.size[0]) // 2, (side - image.size[1]) // 2))
    out = io.BytesIO()
    tile.save(out, 'WEBP', quality=82, method=6)
    return out.getvalue()


def combiner(href):
    path = href.split('a.espncdn.com', 1)[1]
    return f'https://a.espncdn.com/combiner/i?img={path}&w={SIZE * 2}&h={SIZE * 2}'


def logo_href(team, rel):
    for logo in team.get('logos') or []:
        if rel in (logo.get('rel') or []):
            return logo.get('href', '')
    return ''


def fetch_logo(job):
    """Download one logo (and its dark variant) into assets/logos/."""
    target, href, dtarget, dark_href = job
    if not os.path.exists(target):
        raw = get_bytes(combiner(href))
        if not raw:
            return
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as fh:
            fh.write(to_webp(raw))
    if dark_href and dtarget and not os.path.exists(dtarget) and not os.path.exists(dtarget + '.same'):
        raw_dark = get_bytes(combiner(dark_href))
        if raw_dark:
            webp_dark = to_webp(raw_dark)
            with open(target, 'rb') as fh:
                same = fh.read() == webp_dark
            if not same:
                with open(dtarget, 'wb') as fh:
                    fh.write(webp_dark)


def main():
    from concurrent.futures import ThreadPoolExecutor
    want_images = '--no-images' not in sys.argv
    plan = []
    for league, path, key_mode, vendored, dark in LEAGUES:
        data = get_json(SITE + path + '/teams?limit=1000')
        teams = [row['team'] for row in data['sports'][0]['leagues'][0]['teams']]
        allowed = group_ids(league)
        for team in sorted(teams, key=lambda t: t.get('displayName', '')):
            if team.get('isActive') is False or team.get('isAllStar'):
                continue
            if allowed is not None and str(team['id']) not in allowed:
                continue
            key = (team.get('abbreviation') if key_mode == 'abbr' else str(team['id'])).lower()
            default = logo_href(team, 'default')
            if default:
                plan.append((league, key, vendored, dark, team, default))
    jobs = []
    for league, key, vendored, dark, team, default in plan:
        if vendored:
            dark_href = logo_href(team, 'dark') if dark else ''
            jobs.append((os.path.join(OUT_DIR, f'{league}/{key}.webp'), default,
                         os.path.join(OUT_DIR, f'{league}/{key}-dark.webp') if dark_href else '', dark_href))
    if want_images:
        with ThreadPoolExecutor(max_workers=12) as pool:
            for done, _ in enumerate(pool.map(fetch_logo, jobs), 1):
                if done % 50 == 0:
                    print(f'{done}/{len(jobs)} logos', file=sys.stderr)

    entries = []
    cfb_files = {}
    counts = {}
    for league, key, vendored, dark, team, default in plan:
        entry = {
            'id': f'{league}-{key}',
            'l': league,
            'n': team.get('displayName', ''),
            's': team.get('shortDisplayName') or team.get('name') or '',
            'm': team.get('name') or '',
            'a': team.get('abbreviation', ''),
            'c': [('#' + (team.get('color') or '101114')).upper(), ('#' + (team.get('alternateColor') or 'FFFFFF')).upper()],
            'e': str(team['id']),
        }
        rel = f'{league}/{key}.webp'
        if vendored and os.path.exists(os.path.join(OUT_DIR, rel)):
            entry['f'] = rel
            if league == 'cfb':
                cfb_files[entry['e']] = rel
            drel = f'{league}/{key}-dark.webp'
            if os.path.exists(os.path.join(OUT_DIR, drel)):
                entry['d'] = drel
        elif league == 'cbb' and entry['e'] in cfb_files:
            entry['f'] = cfb_files[entry['e']]
        else:
            entry['u'] = default.replace('http://', 'https://')
        entries.append(entry)
        counts[league] = counts.get(league, 0) + 1
    print(counts, file=sys.stderr)

    lines = ',\n'.join('    ' + json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in entries)
    js = (
        '// GENERATED by scripts/build-logo-library.py from ESPN\'s public team API.\n'
        '// Do not edit by hand: re-run the script. Hand-made entries (F1, tours,\n'
        '// league marks, aliases) live in logo-library.js.\n'
        '// Keys: id, l league, n name, s short name, m nickname, a abbreviation,\n'
        '// c [primary, secondary] colours, e ESPN id, f file under assets/logos/,\n'
        '// d dark-background file, u remote URL (ESPN CDN, CORS-enabled).\n'
        '(function (root, data) {\n'
        "  if (typeof module === 'object' && module.exports) module.exports = data;\n"
        '  else root.FrameUpLogoData = data;\n'
        "}(typeof self !== 'undefined' ? self : this, [\n"
        f'{lines}\n'
        ']));\n'
    )
    with open(OUT_JS, 'w', encoding='utf-8') as fh:
        fh.write(js)
    print(f'wrote {len(entries)} entries', file=sys.stderr)


if __name__ == '__main__':
    main()
