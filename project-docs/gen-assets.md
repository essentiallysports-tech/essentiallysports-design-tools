# Generate asset service (gen-assets)

The images Generate's Creative composer builds designs from: AI backgrounds and concept art (never
real people), athlete cut-outs that keep the original photo's pixels, and several different ES photos per
story. Branch `feature/gen-assets`, 2026-11-19.

## Files
- `netlify/functions/_asset-service.js`: the service. The composer imports it on the server
  (`try { require('./_asset-service.js') } catch {}`).
- `netlify/functions/gen-assets.js` and `api/gen-assets.js`: `GET/POST /api/gen-assets` (signed-in ES staff only).
- `frameup-assets.js`: browser client (`window.FrameUpAssets`, UMD). Load it after `frameup-cutout.js`.
- `scripts/test-gen-assets.mjs`: tests, with mocked fetch.
- Small exports added: `remove-bg.js` `removeBackgroundMask()`, `es-image-search.js` `_internals`.

## Interface
Every call resolves to `{ ok, url | dataUrl, width, height, cost, cached, rights: { source, licence, aiGenerated } }`.
A failure resolves to `{ ok: false, reason, error, cost }`. Nothing throws.

| Call | Server (`_asset-service.js`) | HTTP `POST /api/gen-assets` | Browser |
|---|---|---|---|
| `generateBackground({ prompt, style: photo\|illustration\|texture\|abstract, palette: [hex], size, seed?, quality?, space?, sport?, avoid?, referenceUrl? })` | yes | `op: 'background'` | `FrameUpAssets.generateBackground` |
| `generateConceptArt({ concept, sport, palette, avoid, size?, seed?, quality?, space? })` | yes | `op: 'concept'` | `FrameUpAssets.generateConceptArt` |
| `cutout({ imageUrl })` → transparent PNG | mask only (see below) | `op: 'cutout'` (padded image → mask) | `FrameUpAssets.cutout` (full path) |
| `findPhotos({ person, team, sport, query, count, exclude })` | yes | `op: 'photos'` | `FrameUpAssets.findPhotos` |

Server functions take a second argument, `ctx`: `{ email, token, runId, gated, maxCostUsd, deps }`.
- `gated: true` skips the spend gate, when the caller (es-generate) already ran `aiSpendGate` for the request.
- `maxCostUsd` caps the cost of one image. A dearer model steps down to its economy model; otherwise the call
  is refused with reason `budget`.
- `runId` goes into the usage rows, so a Creative run's total cost can be summed.

Extra arguments beyond the contract (all optional):
- `quality: 'high'` asks for about 2 MP (crisp full-bleed at 1080 wide) instead of about 1 MP.
- `space: top|bottom|left|right|center|none` sets where the image stays calm for type.
- `sport` gives default scenes when the prompt sanitises to nothing.
- `avoid` lists the brief's names, which are stripped even when lower case.
- `findPhotos.exclude` takes photos already used in the set.

Sizes: `1080x1350` (default), `1080x1920`, `1080x1080`, `1920x1080`.

`reason` values and their HTTP status:

| Reason | Status | Meaning |
|---|---|---|
| `off` | 503 | No `AI_GATEWAY_API_KEY`, or `GENERATE_IMAGES=off`. |
| `feature-off` | 503 | Switched off with `AI_DISABLE`. |
| `budget` | 503 | Over the per-image cap, or the week's Gateway budget is used up. |
| `weekly-limit` / `team-limit` | 429 | The spend gate refused. |
| `limit` | 429 | The hourly cap was reached. |
| `unsafe` | 422 | The prompt could not be made safe, or the model refused it. |
| `guard` | 422 | The image showed people, text or a logo twice. |
| `reference` | 400 | Image-to-image from something that is not our own background. |
| `client` | 400 | A cut-out was asked for on the server without the padded image. |
| `bad-image` | 400 | The cut-out image was unreadable. |
| `empty` | 400 | Photos were asked for with nothing to search. |
| `too-large` | 413 | The cut-out image is over 6 MB. |
| `error` | 502 | Anything else. |

## Model choice (live Gateway list, `ai-gateway.vercel.sh/v1/models`, fetched 2026-11-17)

Prices are list prices per image. Override any style with `GEN_ASSETS_MODEL_<STYLE>`.
`GEN_ASSETS_ECONOMY=1` (or `AI_ECONOMY=1`) switches every style to its economy model.

| Style | Model | $/image | Economy / fallback | Why |
|---|---|---|---|---|
| photo | `bfl/flux-3-image` | 0.048 (~1 MP), 0.07 (`high`) | `bfl/flux-3-image-klein` 0.009 | See below. |
| illustration | `recraft/recraft-v4.1` | 0.035 | `recraft/recraft-v4.1-flash` 0.007 | See below. |
| texture | `bfl/flux-3-image-klein` | 0.009 | same | See below. |
| abstract | `recraft/recraft-v4.1-flash` | 0.007 | `bfl/flux-3-image-klein` | See below. |
| concept art | `google/gemini-nano-banana-2.1` | 0.0336 (1K), 0.0504 (`high`, 2K) | `bfl/flux-3-image-klein` | See below. |

Why each model:
- **photo:** BFL's flagship (released 2026-10). It gives the best photoreal light and detail on the list at
  a mid price, and takes exact sizes, so the composer's 4:5 and 9:16 canvases need no crop. Klein is about 5x
  cheaper but visibly softer, and full-bleed photo backgrounds are where that shows.
- **illustration:** Recraft is the design-native model (flat shapes, limited palettes, poster looks). v4.1
  costs about the same as Flux 3, and v4.1-pro costs 6x more for little gain behind type.
- **texture:** Textures have no focal point and are usually duotoned or darkened under type, so fidelity
  doesn't pay.
- **abstract:** "Quality close to v4.1" at 1/5 the price. Its gradients and glow are its strength, and
  abstract art is covered by type.
- **concept art:** Concept art needs composition reasoning (a trophy plus money plus spotlight in one idea).
  Gemini's reasoning image models are strongest there, and Nano Banana 2.1 (2026-10) costs half of
  `gemini-3.1-flash-image` ($0.067).

Models considered and rejected:
- `bytedance/seedream-5.0-lite` does web-connected retrieval. A model that can fetch real photos is the wrong
  tool when we must never depict real people.
- `openai/gpt-image-2` is token-billed (about $0.04–0.2 per image, hard to cap).
- `recraft/recraft-v4.1-pro` ($0.21) and `gemini-3-pro-image` ($0.13) are not worth it behind type.

A model that errors (not a policy refusal) is retried once on `bfl/flux-3-image-klein`.

Request shapes (from the docs):
- Image-only models: `POST /v1/images/generations` with `{model, prompt, n:1, size, response_format:'b64_json', providerOptions}`.
  BFL gets `providerOptions.blackForestLabs.outputFormat='jpeg'`.
  See https://vercel.com/docs/ai-gateway/modalities/image-generation/openai#image-only-models.
- Gemini: `POST /v1/chat/completions` with `{model, modalities:['text','image'], messages}`. The image is in
  `choices[0].message.images[0].image_url.url`.
  See https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/image-generation.
- Image-to-image: `POST /v1/images/edits` with JSON `{model, prompt, images:[{image_url}]}`.
  See https://vercel.com/docs/ai-gateway/modalities/image-generation/openai#reference-images-by-url.
- **Not documented, so sent best-effort:** a top-level `seed`, and Gemini's
  `providerOptions.google.imageConfig {aspectRatio, imageSize}` (the AI SDK's names). On a 400 the request is
  re-sent once without them. The prompt also states the frame ratio, and the composer crops backgrounds
  with cover anyway.
- **Needs one real call on a preview** before relying on it: Recraft's handling of `size` 1024x1280 and
  1024x1820 (both are in Recraft's own size list), and Gemini's aspect ratio.

## Never real people
1. **The prompt is sanitised** (`sanitizePrompt`):
   - Removed:
     - capitalised words (names, teams, leagues, brands), except common sentence-start words such as "Empty";
     - the caller's `avoid` names, even when lower case;
     - a list of leagues, events, teams and brands;
     - numbers and `$`;
     - person nouns and pronouns;
     - action verbs that imply a person ("blocks", "dunks");
     - render words (logo, jersey, text, sign, number…);
     - money amounts ("million").
   - Rephrased:
     - "crowd" becomes distant bokeh lights;
     - "money" becomes blank, unmarked banknotes.
   - If fewer than two real words are left, the sport's default scene is used. A subject that still
     fails `subjectIsClean` is refused (`unsafe`).
2. **Every template ends with a no-people clause and a no-marks clause:** no figures, faces, hands or
   silhouettes; no logos, jerseys, flags, text, numbers or signage.
3. **Every generated image is checked by vision before it is returned:**
   - The check uses Claude Haiku 5.5 with the image as base64, and costs about $0.0002.
   - If it flags people, text or a logo, the image is made once more with a firmer prompt. A second flag
     refuses the image (`guard`), and a flagged image is never uploaded.
   - If the check itself fails, the image is returned with `guard.checked: false`.
   - `GEN_ASSETS_GUARD_STRICT=1` refuses unchecked images instead. `GEN_ASSETS_GUARD=off` disables the check.
4. **Image-to-image (`referenceUrl`) is for backgrounds only**, and only from our own storage prefix or a data
   URL this server produced. An ES or athlete photo is refused (`reference`). Concept art never takes a
   reference.
5. **Real athletes come only from `findPhotos`** (the ES pool). Their cut-outs keep the original pixels.

## Cut-outs
The browser does the pixel work, because the server has no image decoder and the model's redrawn version of
a real person must never be shown. `FrameUpAssets.cutout({ imageUrl })` works like this:
1. It loads the photo through the ES proxy.
2. It pads the photo to the model's size, the same way as the editor's Remove background.
3. It posts the padded photo to `op: 'cutout'`. The server calls `remove-bg.js`'s `removeBackgroundMask`, with
   the same provider, model, quality and cost rules, and logs the call as feature `remove-bg`, task `gen-assets`.
4. It takes **only the mask's alpha** and applies it to the original pixels, after `frameup-cutout.js`'s checks
   (coverage, spill into the padding, colour agreement).
5. It returns a transparent PNG data URL.

If the mask is misaligned or redrawn, the free plain-backdrop flood fill is tried, and otherwise the cut-out is
refused. Without a cut-out key, only the flood fill is used.

Caching and cost:
- Masks are cached in server memory for 30 minutes, by the hash of the padded image. They are never uploaded.
- The result is cached in the browser for the page session.
- A cut-out costs about $0.005–0.011 (gpt-image-1-mini, low quality).

## ES photos: several different candidates
`findPhotos` searches by person, person + team, team and the free query. Each search uses three ES sources:
- the ES agency pool (ES MCP `search_images`, `type: agency`);
- ES article lead images (`esCoverage`);
- the ES WordPress media library.

Only ES hosts are kept (the proxy's own check). De-duplication then removes:
- the same file at other sizes or crops (`-1536x1024`, `-scaled`, `?w=`);
- burst frames (same caption and credit);
- photos the set already used (`exclude`).

**Ranking:** one vision call (Haiku, about $0.002–0.004 for up to 8 photos, cached 30 minutes) scores every
photo, which extends `pickPhoto`, which only names one. For each photo it returns:
- whether it shows the person;
- a score from 1 to 5;
- its kind (action, portrait, celebration, reaction, venue, object, group);
- whether it is a graphic or collage.

Graphics and photos of other people are dropped. A greedy pick then penalises repeated kinds and repeated
articles, so the top N differ.

Each photo carries:
- `url`, the proxied same-origin URL, safe for canvas;
- `sourceUrl`, `title`, `caption`, `credit`, `articleUrl` and `date`;
- `width` and `height`, when known;
- `source` (`es-agency`, `es-article` or `es-media`), `kind` and `score`;
- `rights` (`aiGenerated: false`).

The whole answer is cached for 15 minutes per warm server.

## Storage and caching
- **Memory:** 40 images for 6 hours per warm server, plus de-duplication of in-flight requests, so parallel
  identical asks share one model call.
- **Shared:** generated images go to the existing public bucket `frameup-links` (migration
  `20261103120000_frameup_image_links.sql`), under the prefix `gen-assets/<sha256 of the inputs>.<ext>`:
  - They are uploaded with the person's own session. The existing policy lets approved users insert; nobody
    can list, overwrite or delete.
  - They are sent with `cache-control: public, max-age=31536000, immutable` and `x-upsert: false`. A
    "duplicate" answer counts as success.
  - Before generating, a HEAD request on the deterministic URL finds an image anyone already made, so a
    repeat costs $0 on any server.
- **Fallback:** with `GEN_ASSETS_STORAGE=off`, or if an upload fails, a data URL comes back and only memory
  caching applies. A different bucket can be set with `GEN_ASSETS_BUCKET`.
- **Egress:** the response carries a URL rather than a data URL, so the image is downloaded once per viewer
  and then served from cache. Don't re-fetch it per render; the browser client also caches per session.

## Cost per Creative run (estimate)

| Item | Count | Cost |
|---|---|---|
| Concept art | 1–2 | $0.034–0.067 |
| Photo background | 0–1 | $0–0.048 |
| Cut-outs | 1–2 | $0.006–0.022 |
| Photo ranking | 1 | about $0.003 |
| Vision guards | | about $0.001 |

That comes to **about $0.05–0.14 for assets**, which leaves room for the director and vision QA inside the
$0.15–0.30 target. Repeat runs on the same story cost $0 (storage and memory caches).

Default caps:
- `GEN_ASSETS_MAX_USD_PER_IMAGE` is 0.12. A caller can ask for a lower cap, never a higher one.
- `GEN_ASSETS_HOURLY_LIMIT` is 40 paid calls per person per warm server, on top of the shared database hourly cap.
- The spend gate (`aiSpendGate`) applies to every call.

## Environment (all optional)

| Variable | What it does |
|---|---|
| `GEN_ASSETS_MODEL_PHOTO`, `_ILLUSTRATION`, `_TEXTURE`, `_ABSTRACT`, `_CONCEPT` | Override the model for a style. |
| `GEN_ASSETS_ECONOMY` | Use the economy model for every style. |
| `GEN_ASSETS_GUARD` | Set to `off` to disable the vision check. |
| `GEN_ASSETS_GUARD_STRICT` | Set to `1` to refuse images the check could not read. |
| `GEN_ASSETS_STORAGE` | Set to `off` to keep images in memory only. |
| `GEN_ASSETS_BUCKET` | The storage bucket (default `frameup-links`). |
| `GEN_ASSETS_MAX_USD_PER_IMAGE` | The per-image cost cap (default 0.12). |
| `GEN_ASSETS_HOURLY_LIMIT` | Paid calls per person per hour (default 40). |

Existing variables used: `AI_GATEWAY_API_KEY`, `GENERATE_IMAGES=off`, `AI_DISABLE` (`generate-asset`,
`generate-asset-background` and so on), `AI_ECONOMY`, and the `REMOVE_BG_*` / `OPENAI_API_KEY` settings for
cut-outs.

## Imagery v3 (feature/gen-imagery, 2026-11-20)

Every Creative design now gets several ranked ES photos of the people and teams in the brief, cut-outs of the
hero subject, headshots for grids, and team and league logos. The code is in `netlify/functions/_imagery.js`,
behind `_asset-service.js` `prepareImagery(read, ctx)` (cached 15 minutes per brief).

### Why the Bryson brief had no player photo (and the class of failure behind it)
1. **Cut-outs could never happen in Generate.**
   - The composer asked the server for cut-outs, and the server always refused (`reason: 'client'`), because it
     has no image decoder.
   - `generate.html` never loaded `frameup-assets.js` or `frameup-cutout.js`, so the browser path never ran either.
   - So every cut-out archetype (hero number, stat tower, trading card...) was unavailable on every brief.
2. **Subjects were polluted.** The composer searched every capitalised run as a person:
   - "World Tour", "Europe", "Sunday", "North." (from "AFC North."), "Las Vegas", "Players Championship";
   - ALL-CAPS fragments ("BRYSON TAKES", "CAITLIN CLARK BREAKS");
   - while a first name alone ("Bryson", "Ohtani", "LeBron") searched badly.

   Junk subjects used up the four search slots, and their photos (a golf course, a city) were offered as the brief's
   imagery. With no cut-out and no confident player photo, the director fell back to type-led archetypes plus the
   sport's concept art (`golf-ball`). That is the likely source of the murky golf-ball image; it can't be confirmed
   without the live run's plan.
3. **Ranking only ran with a vision key.** Without it, order was simply source order: article lead images
   (often logos, silhouettes, other people) came before the agency and media library.
4. **Sizes were unknown.** Article images report no size, and media items report the original size even when a
   1536 px version is used. So "sharp at 1080" could not be checked, and small crops won.

### What runs now
1. **Subjects** (`subjectsFor`):
   - Names are cleaned: possessives, trailing punctuation and verbs are dropped.
   - Each name is classified as person, team, league, event, venue or place. Places and events are never searched as people.
   - Short and ALL-CAPS names are resolved through ES WordPress tags (`/wp/v2/tags`, public, cached 24 h).
     "Bryson" becomes "Bryson DeChambeau"; "CAITLIN CLARK BREAKS" becomes "Caitlin Clark".
   - Up to 4 heroes are searched in full. Up to 9 more people are searched lightly for headshot grids.
   - Stories with no person use their team or league, and a named venue is its own subject.
2. **Gathering:** the same three ES sources (agency pool, article leads, media library), ES hosts only.
   - De-duplication now also matches agency frame ids across hosts (`USATSI_123` on S3 and on the CDN).
   - Each photo belongs to the first subject that found it, so no photo repeats within a set.
3. **Sizes:**
   - The first 64–256 KB of the 12 most promising files is read to get the JPEG, PNG or WebP header (no decoder).
   - A WordPress size such as `-1079x720` is swapped for its larger original when one exists.
   - All probes share a 5 s deadline, because the CDN is slow on cold files. Results are cached 24 h.
4. **Free signals:**
   - whether the subject is named (full name, or surname) in the title, caption or file name;
   - graphics (logo, collage, silhouette, screenshot...);
   - group shots ("X and Y", "-vs-", teammates);
   - kind (action, celebration, portrait, reaction, crowd, venue, object) from caption verbs;
   - recency (date, upload path or year).
5. **Vision, only where it pays:**
   - It runs only for people (wrong-person risk), behind `aiSpendGate`, and at most 4 calls per run.
   - Each call scores up to 8 photos the cache has not seen, using Haiku.
   - For each photo it returns: subject, alone, face visible, quality 1–5 (blurry or murky = 1), kind, graphic,
     cut-out-able, and focal x/y.
   - Verdicts are cached 24 h per person and photo, so a repeat brief, or the same player in a new brief, costs nothing.
6. **Score (0–1):**

   | Signal | Weight |
   |---|---|
   | Subject | 0.35 |
   | Resolution (1080+ short side = 1) | 0.2 |
   | Visibility (alone and face) | 0.15 |
   | Quality | 0.1 |
   | Kind | 0.1 |
   | Recency | 0.1 |

   - These are dropped: graphics, the wrong person, a short side under 400 px, and quality 1.
   - Without vision, a photo that never names the person is dropped once 3 photos do.
   - A greedy pick then varies kinds and articles.
7. **Output** (the shared contract):
   - `input.photos`: the other ranked candidates; `input.photo` leads.
   - `input.cutouts`
   - `input.headshots`: per person, the photo with the best visible face.
   - `input.logos`: team marks from the brief plus the sport's league mark, from `logo-library.js`.

### Cut-outs: made once, then free for everyone
1. The plan returns `imagery.cutoutPlan`. It holds the hero's best solo, cut-out-able photos (2 for the lead
   person, 1 for each other person, at most 3 per run).
2. `generate-creative.js` calls `FrameUpAssets.prepareCutouts`. This is the existing path: an AI mask, applied to
   the ORIGINAL pixels after the alignment checks. It runs in parallel, with a 25 s cap and a $0.05 cap per run.
3. It then rebuilds that person's designs with `input.cutout` and `input.cutouts`, through the same ES gate
   (`checkScene`).
4. The PNG is stored with `op: 'cutout-store'`:
   - It must be an ES photo, a PNG with an alpha channel, at most 4 MB and at most 4096 px.
   - The path is `frameup-links/gen-assets/cutouts/<sha of the photo>.png`.
   - It is uploaded with the person's own session, `x-upsert: false`, so the first write wins.
5. On every later run, on any server, `prepareImagery` finds it with a HEAD request, and the composer gets
   `input.cutouts` at $0, before the art director plans.

### Cost per run (Imagery v3)

| Item | First run | Repeat or same player |
|---|---|---|
| Subject tag lookups, size probes, ES searches | $0 (public ES endpoints) | $0 |
| Vision ranking (Haiku, ≤ 4 calls of ≤ 8 photos) | about $0.002–0.004 per person, ≤ $0.016 | $0 (24 h cache) |
| Cut-outs (gpt-image-1-mini low, ≤ 3) | about $0.005–0.011 each, ≤ $0.033 (cap $0.05) | $0 (shared store) |
| **Total** | **about $0.01–0.05** | **$0** |

The cost shows in `plan.cost.assets` (vision) and in `plan.imagery.cutoutCost`, which is added to the run total the
card summary shows.
