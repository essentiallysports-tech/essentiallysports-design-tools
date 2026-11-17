# FrameUp Reels Studio: research and build plan for an AI sports-reel maker

Written 2026-11-17. Research only: no product code, git, env or config was changed.
Owner: Suhail. Sports in scope: NFL, CFB, MLB, Golf.

**How to read this.**
- Every price has a date and a source link (see the Source list at the end). Prices marked **(est.)** are my own calculations or third-party figures I could not confirm on the vendor's page.
- Many Vercel AI Gateway model pages show prices only in the dashboard (they render client-side, and WebFetch saw "N/A"). Where that happened, I used the provider's own list price. The Gateway charges provider list price with no markup ([Vercel AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing), updated 2026-09-08). **Before budgeting, check each video/voice model's price in the Gateway dashboard.**
- I could not read real usage rows (`frameup_ai_usage` is admin-only). All costs are modelled.

---

## 0. Executive summary (one page)

**Recommendation.** Build **Reels Studio**: a trend-first, template-driven reel maker in FrameUp. It writes, assembles and renders 20–45 second vertical reels from **assets ES has the rights to use**: the ES image pool, team logos, stat cards, ES-article facts, an AI voiceover, licensed music, and (later) licensed footage. AI generated b-roll is used only where it adds something.
- **Use AI for judgment, not pixels.** The AI writes the script, picks the angle and the photos, times the edit and QA-checks the result. The look comes from ES's own deterministic templates, rendered by a shared timeline renderer (the same pattern as `video-ads-render.js`). That is what makes it look natural and on-brand, every time, at a cost of cents.
- **Footage is the real constraint, not AI.** Downloading league or broadcast clips from X (what Video Ads does today) and re-posting them, and above all using them in paid Meta ads, is the single biggest legal risk in this plan. The compliant path:
  1. Launch on formats that need no game footage (explainers, stat and record alerts, top-5s, quotes, debates).
  2. Embed official posts on ES web pages.
  3. Negotiate a footage licence in parallel. Bleacher Report's 2025 NFL deal is the model.

**MVP (about 2 weeks, est.):**
- **Workspace:** a new `reel-maker.html` workspace.
- **Flow:** Trend → angle and script (creative director) → assets (ES image pool, logos, stat cards) → voiceover (Gemini 3.8 Flash TTS by default, ElevenLabs Flash as the premium voice) → word-level captions (ElevenLabs Scribe v2 on the Gateway) → music from a small pre-cleared ES library → JSON timeline → preview → browser export (WebCodecs + Mediabunny, with the existing MediaRecorder as fallback) → lint and vision QA → learning events.
- **Formats:** three at launch: **Explained in 30s**, **Stat / Record alert** and **Top-5 countdown**.
- **AI video generation:** none in the MVP (admin-only flag at most).

**Cost per 30-second reel (est., 2026-11 list prices):**

| Tier | What's in it | Cost per reel |
|---|---|---|
| **Economy** | Haiku script, stills, Gemini TTS, Scribe captions, browser render | **≈ $0.02** |
| **Standard** | Sonnet director, web fact-check, ElevenLabs Flash VO, Gemini clip and QA vision, one 5-second generated b-roll shot | **≈ $0.35** (≈ $0.10 without the b-roll) |
| **Premium** | ElevenLabs v3 VO, three generated shots (Veo 3.1 Fast 1080p), server render | **≈ $2.45** |

| Monthly AI cost (30 days) | 20 reels/day | 50 reels/day | 100 reels/day |
|---|---|---|---|
| Economy | $12 | $30 | $60 |
| Standard | $210 | $525 | $1,050 |
| Premium | $1,470 | $3,675 | $7,350 |
| **Recommended mix** (60% standard-lite, 30% standard, 10% premium ≈ $0.41/reel) | **$246** | **$615** | **$1,230** |

Fixed costs come on top of these, and the footage licence is the big unknown:
- a music library: about $20–$100 a month self-serve, or enterprise by quote;
- a render licence or service only from v2 (Remotion company licence or Shotstack, from about $39–$100 a month);
- a footage licence: negotiated, no public prices.

**Top risks:**
1. **Footage copyright.** Downloaded X/broadcast clips, especially in paid ads.
2. **Music claims.** Leagues and teams have paid six-figure settlements; "trending audio" is not licensed for brands.
3. **Platform originality penalties** for low-effort, templated or reposted reels: Instagram (2024–2026), Facebook (July 2025) and YouTube (July 2025).
4. **Likeness and NIL.** Never generate realistic athletes or clone their voices; Veo blocks prominent people by default.
5. **Video-generation cost runaway** under the current $20/week per-person cap.
6. **Factual errors** in stat reels.

**Decisions for Suhail:** listed in §9.6. In short: the budget and a separate Gateway key for reels; the footage licence route; whether to stop using downloaded X clips for paid ads; the ES image pool licence scope; the house voice; the music library; the AI-video policy; human approval before publishing.

---

## 1. Audience demand: what sports reels work now

### 1.1 What the data says

| Finding | Source and date |
|---|---|
| NFL rights holders' 9:16 output rose **125.7%** in 2025/26. Vertical is "the lead format for fan engagement", made natively, not cropped from broadcast. Game action content grew 44%. "Micro-moments" (a signature throw, a breakaway run) drive engagement. Automation was 69.9% of the 158,463 clips | [WSC Sports, 2026-01-27](https://wsc-sports.com/blog/reports/vertical-is-the-new-baseline-2025-26-nfl-regular-season-content-trends/) |
| Most-clipped NFL players in 2025/26: Josh Allen, Drake Maye, Matthew Stafford, Jalen Hurts, Patrick Mahomes, Bo Nix, Caleb Williams… | same |
| MLB: 2025 was its most-viewed season on social (17.8B+ views, +20%). TikTok and YouTube are growing fastest for teams. Jomboy Media (breakdowns and commentary, partly MLB-owned) had 2B+ postseason views | [summary via DesignRush / MLB release, 2026](https://news.designrush.com/mlb-tiktok-global-content-partnership-2026), [Blinkfire 2025 MLB report](https://www.blinkfire.com/d/view_upload/2025-mlb-report) |
| Golf: creators (Bryson DeChambeau, Good Good, Grant Horvat, Bryan Bros) are now among golf's biggest names. The PGA TOUR set up a Creator Council and creator events. Tour players may post highlights of themselves natively. The Tour's "Rapid Rounds" show every shot of a round in minutes | [Front Office Sports](https://frontofficesports.com/pga-tour-liv-golf-capitalized-youtube-influencers/), [FOS on player rights](https://frontofficesports.com/pga-tour-golfers-improve-social-presence/), [Golf.com](https://golf.com/news/golf-social-media-arms-race-pga-tour-usga/?amp=1) |
| CFB: the 12 playoff teams' social impressions were up 68% YoY (James Madison +158%). Ohio State is #1 in season-long social pulse | [Learfield, 2026-01](https://www.learfield.com/2026/01/data-digital-highlights-around-the-2026-college-football-playoff-teams/), [USC Social Pulse 2025](https://www.sc.edu/study/colleges_schools/cic/initiatives/social_media_insights_lab/reports/2025/ohio_state_reclaims_no1.php) |
| House of Highlights: creator- and player-centric content beats game-specific reels. Instagram is still its largest platform | [Digiday](https://digiday.com/future-of-tv/house-of-highlights-creator-led-content-triples-revenue) |
| Instagram Reels led sports-video engagement (53%) against TikTok. TikTok engagement is front-loaded (first 48 h); Reels keeps gaining impressions over time | [ListenFirst, 2025-02-26](https://www.listenfirstmedia.com/diving-in-tiktok-vs-reels-sports/) |
| Median length is TikTok 16 s, Reels 18 s, Shorts 19 s, Facebook 22 s; about two-thirds are under 30 s. Within an account, Reels show no length effect, and Shorts over 1 minute get 0.81× the views. Posting twice as often gives about 2.4× monthly views at about the same views per post | [viral.app, 3.3M videos, updated 2026-10-01](https://viral.app/blog/insights/short-form-video-trends) |
| Reels reach against the account's own baseline: 30–59 s +2.7%, 60–89 s +1.6%, 90–179 s +7.4%, under 15 s −1.5%, **180 s and over −49%** (not recommended to non-followers) | [Buffer, 3.78M Reels, 2026-11-12](https://buffer.com/resources/instagram-reels-length) |
| Instagram stops recommending accounts that mostly repost content they didn't make or "meaningfully transform", now platform-wide (2026-04). Voiceover and commentary count as transforming | [PetaPixel, 2026-04-30](https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/), [Tubefilter](https://tubefilter.com/2026/04/30/instagram-removes-algorithm-recommendations-repost-content-aggregator) |
| Facebook: repeated reuse of others' videos costs monetization **and reduces distribution on everything the account posts**. Reaction, commentary and voiceover are fine | [TechCrunch, 2025-07-14](https://techcrunch.com/2025/07/14/following-youtube-meta-announces-crackdown-on-unoriginal-facebook-content) |
| YouTube: realistic altered or synthetic content must be disclosed; Shorts get an on-video label. YouTube now auto-labels AI video that isn't disclosed. The label itself doesn't reduce reach | [YouTube blog, 2026-05](https://blog.youtube/news-and-events/improving-ai-labels-viewers-creators/) |

**What this means for ES.**
1. ES is a publisher, not a rights holder. Its edge is **analysis, speed and voice**, not raw highlights.
2. The platforms now *reward* exactly that kind of transformation (voiceover, commentary, original graphics) and *punish* reposting.
3. So the reel engine should make **original explainers on top of the news**, with footage as an ingredient where licensed, never as the product.

### 1.2 Formats ranked for ES

**Demand** is from the evidence above, plus my judgement (marked). **Footage need** decides what is buildable now.

| # | Format | Why fans watch | Footage need | Fit for ES now | Phase |
|---|---|---|---|---|---|
| 1 | **Explained in 30s** (news, trade, injury or contract explainer, VO over stills, stat cards and captions) | Answers "what happened and why it matters". Transformative by design (VO) | None | **Excellent**: trend feed + ES articles | **MVP** |
| 2 | **Stat / Record alert** ("first QB since 1998 to…") with kinetic numbers | Surprise plus shareable fact; FrameUp already has `stats-*` templates | None | **Excellent** | **MVP** |
| 3 | **Top-5 countdown** (power rankings, MVP/Heisman race, longest drives, majors) | Completion bait: viewers stay for #1. Reuses Listicle data | None | **Excellent** | **MVP** |
| 4 | **Quote reel** (press conference quote as kinetic type + photo + context VO) | Emotion and controversy. Never clone the speaker's voice | None (licensed audio optional) | Very good | v1.1 |
| 5 | **Debate / "Who you got?"** (two players, side-by-side stats, poll CTA) | Drives comments, which drive distribution (est.) | None | Very good | v1.1 |
| 6 | "What to watch this week" (betting-free preview: matchups, storylines, tee times) | Weekly habit; golf tournament previews | None | Good | v2 |
| 7 | Player story / "from walk-on to…" | Character content beats game content on HoH | Stills; archive helps | Good | v2 |
| 8 | Highlight + caption ("micro-moments") | Biggest raw demand ([WSC](https://wsc-sports.com/blog/reports/vertical-is-the-new-baseline-2025-26-nfl-regular-season-content-trends/)) | **Licensed footage required** | Blocked until licence | v2 (licence) |
| 9 | Golf swing / shot breakdown (slow-mo, telestrator lines) | Golf's YouTube/creator audience loves instruction | Licensed or creator-supplied footage | Blocked until licence or partner | v2–v3 |
| 10 | Reaction / hot take (on-camera ES talent) | Personality-led content outperforms (HoH, Jomboy) | ES-filmed | Needs talent, not AI | v3 |

**Top 5 to build first:** Explained-in-30s, Stat/Record alert, Top-5 countdown, Quote reel, Debate. All five work for NFL, CFB, MLB and Golf without game footage.

### 1.3 Craft norms: hook, length, pacing, captions, sound, cadence

These are drawn from the sources above. Where no rigorous study exists I give industry convention, marked (conv.).

- **Hook (0–1.5 s):**
  - The first frame already carries the claim: a big number, a face, or a question in 5–7 words. No logo sting, no title card, no fade in from black.
  - VO starts on frame 0–6.
  - Motion in the first 300 ms (a punch-in on the photo, the number counting up). (conv.)
  - Hook data is weak and mostly vendor blogs ([Kapwing roundup](https://www.kapwing.com/resources/short-form-video-statistics-tiktok-reels-and-shorts-by-the-numbers-in-2026/)), so **A/B test three hook variants per reel** (v2).
- **Length:**
  - Default 20–45 s; Top-5 up to 60 s; never over 90 s at launch.
  - Reels up to 3 min are allowed but past 180 s lose recommendations ([Buffer](https://buffer.com/resources/instagram-reels-length)).
  - Shorts over 60 s underperform within the same channel ([viral.app](https://viral.app/blog/insights/short-form-video-trends)).
- **Pacing:**
  - A visual change every 1.5–3 s (cut, push, new card); one idea per beat.
  - End on a loop-friendly last frame, or a question that invites comments. (conv.)
- **Captions:**
  - Burned in, word-level.
  - 1–3 words per card for hype; 4–7 words per line for explainers.
  - Heavy condensed type (ES uses Acumin Pro Condensed / Roboto, per `video-ads-render.js`).
  - Highlight the key word in ES blue or the team colour; never more than 2 lines. (conv.)
- **Safe zones (1080×1920):** keep text inside about **x 65–1015, y 270–1580**.
  - Top about 220–270 px is covered by the username and audio line.
  - Bottom about 340 px by the caption and buttons.
  - Right about 120 px by the action rail.
  - The figures vary by source; the most conservative ones are used here ([Hopper HQ](https://www.hopperhq.com/blog/instagram-reel-size/), [adkit Meta safe zones](https://adkit.so/tools/safe-zones/meta)).
- **Sound:**
  - VO-led, music under it, ducked 12–18 dB under speech.
  - Integrated loudness about −14 LUFS, true peak −1 dBTP. (conv.)
  - Brand accounts must not use "trending" commercial songs (§3.4).
- **Cadence:**
  - More posts means more total views at about the same views per post ([viral.app](https://viral.app/blog/insights/short-form-video-trends)).
  - Realistic ES target: 3–5 reels a day per sport in season, plus breaking-news reels within 60 minutes of a trend peaking. (est.)
- **"Natural and polished"** means:
  - It looks made by an ES editor, not by a template farm.
  - Varied openings; real photos of the actual people; numbers that are right; one consistent house voice that doesn't sound robotic; restrained motion (ease-out, no spinning transitions).
  - No AI-looking faces, no fake crowd shots, no stock-footage clichés.

### 1.4 From trends to reel topics

Use the existing trends feed (`trend-design.js`: Google News + Google Trends, 48 h, ranked by recency × momentum × ES relevance) as the topic source. Add a **format router**:

| Trend signal (from title, related items and ES articles) | Format |
|---|---|
| A number or record word ("first", "most", "record", "since") | Stat/Record |
| A ranking or list ("top", "best", "power rankings", award race) | Top-5 |
| A quote verb ("said", "slams", "responds") | Quote reel |
| "vs", a comparison, or a rivalry week | Debate |
| Trade, injury, contract, firing or suspension | Explained in 30s |
| Golf tournament week (Mon–Wed) | What to watch |

The router is code-first (regexes, as in `generate.html`'s "Found in your brief" pills), with the creative director as tiebreaker.

---

## 2. Vercel AI Gateway models for video (catalogue checked 2026-11-17)

Catalogue: [vercel.com/ai-gateway/models](https://vercel.com/ai-gateway/models).
- Video generation needs **AI SDK 6+ `experimental_generateVideo`**. It is beta, for Pro/Enterprise and paid-credit teams.
- An **async job API** (`experimental_startVideo` / `experimental_getVideoStatus` / webhooks) fits our 60 s serverless functions.
- See the [video generation docs](https://vercel.com/docs/ai-gateway/modalities/video-generation), updated 2026-09-08.

### 2.1 Text / LLMs (scripting, director, QA reasoning)

These are already wired up in `_ai-gateway.js`. Prices are from `PRICES` (2026-11).

| Job | Model | $ per 1M in/out | Notes |
|---|---|---|---|
| Script writer, format router, caption cleanup | `anthropic/claude-haiku-5.5` | 0.10 / 0.50 | Prompt caching. Same family as Generate |
| Creative director (angle, beats, hook variants) | `anthropic/claude-sonnet-5.5` (premium) or Haiku (economy) | 2 / 10 | Reuse `_creative-director.js` patterns (concepts, `validateConcepts`). The strategy doc's B1 (Haiku first, escalate to Sonnet) applies here too |
| Fact research | Haiku + `web_search` | + $0.01 per search | Existing `aiWebResearch` with cost cap |
| Cheap classification (format router fallback, hashtags) | `openai/gpt-oss-20b` | 0.03 / 0.14 | `light` tier |
| Second-opinion QA | `openai/gpt-6-luna` | 0.10 / 0.50 | `review` tier; a different family from the writer |

### 2.2 Vision (picking frames, judging clips)

| Job | Model | Price | Notes |
|---|---|---|---|
| Pick the best ES photo per beat (2–6 images) | Haiku 5.5 vision | ≈ $0.001 a call | Same as `pickPhoto` in `es-generate.js` |
| **Watch a clip**: find the best 3–8 s moment, scene changes, where the subject is, whether it's a throwback or watermarked | `google/gemini-3.8-flash` | $0.75 / $3.75 per 1M ([Gateway page](https://vercel.com/ai-gateway/models/gemini-3.8-flash)). Google's own list price doubles to $1.50 input from 2027-01-01 ([Google pricing](https://aistudio.google.com/docs/pricing)) | Gemini 3 video ≈ 70 tokens per frame at low/medium resolution + 25 tokens/s audio ([media resolution docs](https://ai.google.dev/gemini-api/docs/media-resolution)) ≈ **95 tokens/s at 1 fps → a 60 s clip ≈ 5.7k tokens ≈ $0.004** (est.). Gateway video-input support isn't listed on the model page: **verify** |
| Final-render QA (frames + audio) | Gemini 3.8 Flash | ≈ $0.006 per 30 s reel (est.) | Checks the safe zones, caption legibility, logo, black frames and an awkward first frame |

### 2.3 Speech / TTS (voiceover)

Listed on the Gateway as `speech` models; units per the catalogue, 2026-11-17.

| Model | Gateway price | ≈ Cost for a 30 s VO (≈450 chars / 750 audio tokens) | Sound | Use |
|---|---|---|---|---|
| `google/gemini-3.8-flash-tts` | $0.50 in / $9 per 1M out (Google says $18 out from 2027-01-01) | **≈ $0.007** | Natural, steerable style by prompt (est.) | **Economy default** |
| `google/gemini-3.8-flash-lite-tts` | $0.50 / $6 | ≈ $0.005 | Lighter | Drafts and previews |
| `elevenlabs/eleven-flash-v2.5`, `eleven-v4-turbo` | $40 per 1M chars | **≈ $0.018** | Very natural, fast | **Standard house voice** |
| `elevenlabs/eleven-v3` / `eleven-v4` | $80 per 1M chars ([model page](https://vercel.com/ai-gateway/models/eleven-v3): billed per character, audio tags, 5,000 chars per request) | ≈ $0.036 | The most expressive (audio tags like [excited]) | **Premium / hype** |
| `openai/tts-1-hd`, `microsoft/mai-voice-2.1`, `fish-audio/s2.1-pro`, `spacexai/grok-tts`, `mistral/voxtral-mini-tts-3` | $15–$30 per 1M | $0.007–0.014 | Varies | Benchmark candidates |

**Voice choice.**
- Pick **one ES house voice** (male and female options) and lock it in `brand-kit`-style config, so reels sound like one brand.
- My recommendation: ElevenLabs Flash v2.5 for standard and v3 for hype, with Gemini 3.8 Flash TTS as the cheap fallback. Have Suhail blind-test 5 voices on 3 scripts. (Subjective; I could not listen to samples.)
- **Never clone or imitate an athlete's or coach's voice.**

### 2.4 Transcription (word-level captions and alignment)

| Model | Price | Word timestamps | Use |
|---|---|---|---|
| `elevenlabs/scribe-v2` (Gateway) | billed per second of audio, $0.000061/s ≈ **$0.0037/min** ([model page](https://vercel.com/ai-gateway/models/scribe-v2)) | **Yes**, plus diarization, 90+ languages | **Default**: align the TTS VO to word timings; caption uploaded clips |
| `google/gemini-3.5-transcribe` | ≈ $0.005/min ([Google pricing](https://aistudio.google.com/docs/pricing)) | Not confirmed | Backup |
| `openai/gpt-4o-transcribe` / `-mini` | $2.50 / $1.25 per 1M in | Segment-level | What Reels uses today (direct OpenAI key, **not logged**) |
| Groq Whisper (not Gateway) | free tier | Yes | Existing free fallback |
| Deepgram Nova-3 (not Gateway) | ≈ $0.0043/min batch ([Deepgram](https://deepgram.com/pricing), via secondary sources) | Yes | Only if Scribe quality disappoints |

**Move Reels' transcription onto the Gateway (Scribe v2)** so it is logged in `frameup_ai_usage` and counted against the caps.

### 2.5 Image generation

Already used: `bfl/flux-3-image-klein` at about $0.011 an image (`IMAGE_PRICES`).

For reels, use images only for **non-person** backgrounds: stadium atmosphere, abstract textures, "breaking" plates, golf course flyovers as stills. Also on the Gateway: Seedream 5.0, Recraft v4.1 (good for vector stat-graphic elements), GPT Image 2.x, MAI Image 2.6, Flux 3.

### 2.6 Video generation

All on the Gateway, beta.

| Model (Gateway id) | Price (2026) | Length / res / ratio | Audio | Best for | Notes |
|---|---|---|---|---|---|
| `google/veo-3.1-lite-generate-001` | **$0.05/s 720p, $0.08/s 1080p** ([benchlm snapshot of Google pricing, 2026-10-13](https://benchlm.ai/md/media-pricing/veo.md)) | 4/6/8 s; 720p/1080p; **9:16 supported** ([Gateway page](https://vercel.com/ai-gateway/models/veo-3.1-lite-generate-001)) | Native | **Cheapest decent b-roll**; i2v from an ES still | Released 2026-04-02 |
| `google/veo-3.1-fast-generate-001` | $0.10/s 720p, $0.12/s 1080p, $0.30/s 4K | 4/6/8 s; 9:16 | Native | Premium b-roll | |
| `google/veo-3.1-generate-001` | $0.40/s (4K $0.60) | 4/6/8 s | Native | Hero shots only | 8 s 1080p = $3.20 |
| `klingai/kling-v3.0-i2v` / `-t2v` | from **$0.17/s** ([Gateway Kling index](https://vercel.com/ai-gateway/models/labs/klingai)); third parties list $0.17–0.35/s with audio ([Krea docs](https://docs.krea.ai/api-reference/video/kling-30.md)) | 3–15 s; 720p/1080p (Pro); **9:16** | Native in v3 | Longer single shots, good motion | |
| `klingai/kling-v2.6-i2v` / `v2.5-turbo` | from **$0.04/s** (Gateway index) | | | Cheap motion on stills ("Ken Burns+") | |
| `klingai/kling-v3.0-motion-control` | from $0.13/s | | | Transfer motion onto a character image | **Do not use with real athletes** |
| `bytedance/seedance-2.5` / `-2.5-flash` / `-2.0-mini` | Seedance 2.5 ≈ $0.23/s at 720p (token-billed; Replicate/CometAPI) ([MindStudio](https://www.mindstudio.ai/blog/seedance-2-5-review-pricing/)); Flash is cheaper (not published) | Flash: 4–30 s, 480p/720p, 24 fps, editing + extension + first/last frame ([Gateway page](https://vercel.com/ai-gateway/models/seedance-2.5-flash)) | Joint audio-video | Longer generated sequences; extending a shot | |
| `alibaba/wan-v2.6-i2v(-flash)`, `wan-v3.0-video(-prime)` | not shown | | | Cheap alternative; accepts video references | |
| `minimax/minimax-h3`, `-h3-max` | 50% off on the Gateway at time of writing ([changelog link on docs page](https://vercel.com/docs/ai-gateway/modalities/video-generation)) | | | Benchmark candidate | |
| `spacexai/grok-imagine-video-1.5(-lite)`, `bfl/flux-3-video`, `heygen/heygen-video-1` (avatars) | not shown | | | HeyGen = presenter avatars, a possible future "ES anchor" | Avatar = synthetic person; **must be disclosed** |
| `topaz/starlight-precise-2.6`, `topaz/proteus` | not shown | | | **Upscale / restore** low-res licensed clips to 1080p | Useful once footage is licensed |
| OpenAI Sora | **shut down** (OpenAI date 2026-09-24, per [benchlm](https://benchlm.ai/md/media-pricing/veo.md)) | | | | A reminder that vendors churn; keep models swappable |

**Lip-sync:** no dedicated lip-sync model is on the Gateway catalogue (HeyGen video and Seedance audio-video come closest). It isn't needed: ES should not lip-sync real people.

**Rules for generated video in ES reels:**
1. Never a realistic real athlete, coach or fan. Veo's "Celebrity" filter rejects photorealistic prominent people by default ([Google responsible-AI guidelines](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/responsible-ai-and-usage-guidelines)), and right-of-publicity and NIL risk applies even where a model allows it.
2. Use it for atmosphere, transitions, objects (ball, tee, field, scoreboard abstractions) and gentle image-to-video motion on *non-person* parts of a frame.
3. Disclose it: YouTube's "altered or synthetic" toggle; Meta's AI info.
4. Async only, through `startVideo` + webhook. Copy hosted results into Supabase Storage before `expiresAt`.
5. Hosted input image URLs only (the persisted start request is capped at **300 KiB**).

### 2.7 Music and SFX

On the Gateway: `elevenlabs/music-v2`, `music-v2.5` (billed per second of generated audio; price not shown), `sound-effects-v2`.
- At launch, ElevenLabs said Eleven Music output is cleared for broad commercial use, with Merlin and Kobalt deals ([ElevenLabs release via BusinessWire, 2025-08-05](https://www.businesswire.com/news/home/20250805333301/en)).
- A later secondary source says self-serve excludes film/TV/games ([invideo comparison](https://invideo.io/blog/ai-music-copyright-comparison/)).
- **Check elevenlabs.io/music-terms for social and paid-ad use before relying on it.**

### 2.8 What's not on the Gateway, and the best alternative

| Need | On the Gateway? | Best alternative |
|---|---|---|
| Licensed library music | No | Epidemic Sound (Business/Enterprise; partner API by contract) ([pricing summary](https://spendhound.com/marketplace/epidemic-sound-pricing)), Soundstripe, Artlist, or TikTok CML / Meta Sound Collection in-app (platform-only licences) |
| Rendering / compositing | No | Browser: WebCodecs + [Mediabunny](https://mediabunny.dev/guide/introduction). Server: Remotion Lambda, Shotstack, Creatomate, FFmpeg in Vercel Sandbox (§4.3) |
| Scene detection, subject tracking | No (Gemini covers part) | MediaPipe object/pose detection in the browser (free); PySceneDetect / FFmpeg `scdet` on a server |
| Beat detection | No | Web Audio onset detection or Essentia.js (free, in browser); or pre-tag beats when adding tracks to the ES library |
| Streaming STT | Partly (scribe-v2-realtime) | Not needed |
| Footage | No | §3 |

---

## 3. Footage sourcing, legally

*Not legal advice. ES should confirm with counsel before licensing or launch.*

### 3.1 The risk in plain terms

- **Game footage is copyrighted** by the league or broadcaster. Clips posted on X are licensed to X by the poster; nobody licenses them onward to ES.
- **Downloading** `video.twimg.com` MP4s and re-uploading them as ES reels or ads is copying plus redistribution.
  - **Organic posts** risk DMCA takedowns, platform strikes and account loss. The NFL has used DMCA takedowns against unlicensed clips ([Fortune, 2015](https://fortune.com/2015/10/13/deadspin-nfl-twitter)), and Vox/SB Nation's policy is to use footage only with a licence or clear fair use (same source).
  - **Paid Meta ads** are commercial use, where fair use is weakest.
- **Fair use is hard to win for whole clips.** In April 2026 the Second Circuit revived a suit over a publisher's reuse of a Michael Jordan video: the whole clip could substitute for the original, and fair use was not decided early ([Law360, 2026-04-23](https://law360.com/articles/2469258)).
- **Embedding is different, but only on the web.** Embedding an official post on an ES article doesn't copy the file. In the Ninth Circuit the "server test" protects embedding ([McGucken v. Valnet, 9th Cir. 2024-12-19; cert denied](https://www.nixonpeabody.com/insights/alerts/2025/07/09/supreme-court-declines-to-resolve-looming-split-on-embedded-content-rights)). SDNY courts have rejected the server test ([NatLawReview](https://natlawreview.com/article/sdny-again-rejects-server-test-display-embedded-content)). Embeds also can't go into a reel file.
- **Music:** the music industry has sent DMCA notices to NFL and NBA teams, including a reported six-figure settlement by the Cardinals ([FOS](https://frontofficesports.com/article/sound-clash/)). Brand and business accounts should use only libraries cleared for commercial use. On TikTok, business accounts are limited to the Commercial Music Library, and that licence covers TikTok only ([Soundstripe guide](https://www.soundstripe.com/blogs/tiktok-music-library-explained)).
- **Likeness:** athletes' names, images and likeness (CFB NIL especially) carry right-of-publicity limits in *commercial* contexts such as ads. Editorial use of licensed photos is normal. **AI-generated realistic athletes and cloned voices are out.**
- **Logos and marks:** editorial use of team logos in news is common. Using them in paid ads for ES's own product (newsletters) is riskier; it can imply endorsement. Video Ads already does this, so flag it to counsel.
- **ES image pool:** confirm that the agency licence (Getty, Imagn/USA TODAY, AP and others) covers (a) social video and animated stills, and (b) paid promotion. Editorial licences often exclude advertising. **I couldn't see the contract.**
- **Trends page images** come partly from Wikipedia (`wikiImage` in `trend-design.js`). Those carry CC licences that need attribution and sometimes share-alike. Don't use them in reels without attribution handling.

### 3.2 Footage options

| Source | Rights for ES reels | Realistic cost | Notes |
|---|---|---|---|
| **ES image pool / ES Storage** (`es-image-search.js`) | Likely editorial; **check social video and paid use** | Already paid | The backbone of MVP formats |
| **ES-generated graphics** (stat cards, logos, kinetic type) | ES owns them | $0 | The core of "natural, on-brand" |
| **AI b-roll** (non-person) | Owned per provider terms; disclose | $0.05–0.40/s | Use sparingly |
| **User-uploaded ES-owned footage** (pressers ES filmed, ES talent) | Owned | Staff time | Feeds Reel Captions and Quote reels |
| **Official posts embedded on ES pages** | Embed only (web) | $0 | Not for reels |
| **League footage licence** (NFL, MLB, PGA TOUR, conferences) | Licensed per contract | Negotiated; not public | B/R's multi-year NFL deal includes silent game footage for original social content and the right to sell sponsors around it ([Axios, 2025-01-16](https://www.axios.com/2025/01/16/bleacher-report-nfl-deal)). This is the gold standard |
| **Licensing intermediaries / libraries:** STN Video (NFL clip syndication) ([Sportcal](https://www.sportcal.com/media/nfl-extends-partnership-with-stn-video/)), Minute Media (licensed video library; also owns Magnifi), IMG Replay via Reuters Imagen (40+ federations; credit-based clip licensing) ([Imagen case study](https://www.casestudies.com/company/imagen/case-study/img-replay-enjoy-stronger-revenues-after-implementing-imagen-to-manage-their-world-leading-sports-content)), Getty / AP / Reuters video | Usually web player and syndication. **Ask specifically for social re-edit rights** | By quote | Often player-embed rights, not re-edit rights |
| **Athlete / creator partnerships** (Greenfly-style distribution; PGA TOUR players can post their own highlights) ([FOS](https://frontofficesports.com/pga-tour-golfers-improve-social-presence/)) | Per agreement | Revenue share or fee | A good fit for golf creators |
| Downloading X / broadcast clips | **None** | "Free" plus legal risk | **Stop for paid ads now; phase out for organic** |

### 3.3 Recommended compliant path

1. **Now:**
   - Reels Studio launches with no-footage formats (§1.2 #1–5).
   - Video Ads should not use downloaded league clips in paid Meta ads without a licence: switch those to stills + motion, or ES-owned clips.
   - Keep downloaded clips for internal reference and preview only, if at all.
2. **Within 30 days:** get the ES image pool licence scope in writing (social video, paid).
3. **In parallel (Suhail and business team):** RFPs to (a) the NFL (B/R-style original-content deal), (b) STN / Minute Media / Imagen-IMG Replay / Getty video, (c) the PGA TOUR media team and golf creators.
4. **A rights ledger in FrameUp from day 1** (§6.3): every asset carries `rights` (source, licence, allowed uses: organic and/or paid, expiry, attribution). Export is blocked when an asset's rights don't cover the target.

### 3.4 Music path

- **MVP:** a curated ES library of about 40–80 tracks, bought under a licence that covers social, paid and multi-platform use (Epidemic Sound Business/Enterprise, Soundstripe or Artlist). Store them in Supabase Storage with tags (bpm, mood, sport, beat grid).
- **Option:** ElevenLabs Music for custom stings, once its terms are confirmed.
- **Never** add trending commercial songs inside FrameUp. Editors can add in-app platform sounds at posting time on personal-style accounts, where the platform licence applies.

---

## 4. Editing pipeline

### 4.1 AI rough-cut stages (who does what)

| Stage | MVP | v2 | Tool |
|---|---|---|---|
| Angle and beats | Creative director → 5–8 beats (hook, context, 2–4 facts, payoff, CTA) | 3 hook variants | Haiku/Sonnet (`_creative-director.js` patterns) |
| Script and VO text | Writer, 60–110 words per 30 s (≈ 2.6 words/s) (conv.) | Tone presets (hype / calm / analyst) | Haiku |
| Fact grounding | ES articles (MCP `query_articles`) + trend item; every number must appear in sources (`_lint-spec.js` number check) | + capped web search | Code + Haiku |
| Asset picking | ES photos per beat (person + team), team logos (`league-logos.js`, `video-ads-teams.js` colours) | Licensed clips | Haiku vision |
| Scene detection / best moment | | Gemini Flash over the clip → `{start, end, score, reason, subjectBox}` | Gemini 3.8 Flash |
| Auto-reframe to 9:16 | Stills: smart crop on face/subject (vision returns a box) + slow push | Video: per-shot subject box from Gemini at 1–2 fps, smoothed (critically damped spring) in the renderer; MediaPipe in-browser fallback | Gemini / MediaPipe |
| Beat-synced cuts | Cuts snap to the nearest beat of the chosen track (beat grids pre-tagged in the library) | Onset detection on any track | Code |
| VO | TTS → audio file | Expressive tags (v3) | Gateway TTS |
| Captions | Scribe v2 aligns VO → word timestamps → caption cards (reuse `reels.js` word chunking) | Style presets (Single Word, Karaoke, Highlight) | Gateway STT |
| Stat overlays | Template cards from `stats-*` / Listicle specs | Animated charts | Renderer |
| Brand kit | ES logo bug, newsletter wordmarks (`video-ads-brands.js`), team colours | Per-newsletter kits | Code |
| Music | Library pick by mood and bpm; auto-duck under VO | Beat-matched endings | Code |
| B-roll | | i2v / t2v (Veo Lite, Kling 2.6) on request | Gateway video |
| QA | Lint (timeline rules) + Gemini frame/audio check | Auto-fix loop | §5 |

### 4.2 The timeline (EDL) format

Use one JSON timeline as the contract between AI, preview, render and storage. Its shape:

```json
{
  "v": 1, "fps": 30, "size": [1080, 1920], "durationMs": 31200,
  "format": "stat-record", "sport": "nfl", "brand": "es", "voice": "es-house-m1",
  "tracks": {
    "video": [ { "id": "s1", "asset": "img_123", "inMs": 0, "outMs": 2400,
                 "fit": "fill", "motion": { "type": "push", "from": 1.0, "to": 1.08, "focus": [0.52, 0.31] } } ],
    "graphics": [ { "id": "g1", "template": "stat-big-number", "inMs": 300, "outMs": 2400,
                    "data": { "value": "5,477", "label": "PASS YDS", "team": "BUF" } } ],
    "captions": { "style": "highlight", "words": [ { "w": "Josh", "s": 0, "e": 220 } ] },
    "audio": [ { "asset": "vo_9", "inMs": 0, "gainDb": 0 },
               { "asset": "mus_41", "inMs": 0, "gainDb": -16, "duck": true } ]
  },
  "rights": { "organic": true, "paid": false },
  "sources": [ { "type": "es-article", "url": "…" } ]
}
```

**Why JSON:**
- AI writes small structured edits ("swap beat 3 photo", "shorten to 25 s").
- `_reel-lint.js` can check it.
- The same pure renderer (like `video-ads-render.js`) draws it in the browser and, later, headless on a server.

### 4.3 Rendering: browser vs server

| Option | Cost | Speed for a 30 s reel | Quality | Fit with Vercel |
|---|---|---|---|---|
| **Browser canvas + MediaRecorder** (today: Video Ads, Reels) | $0 | Real time (≥ 30 s) and can drop frames; MP4 only where supported (Safari/Chrome vary) | OK | No server bytes, so no 4.5 MB limit |
| **Browser canvas + WebCodecs + Mediabunny** (recommended MVP) | $0 | Faster than real time on most laptops (hardware encode); frame-exact, offline | **Good**: deterministic, constant frame rate, real MP4 (H.264/AAC) | Same; falls back to MediaRecorder |
| Remotion Lambda | ≈ $0.02 per minute of 1080p video on AWS ([Remotion cost example](https://remotion.dev/docs/lambda/cost-example)) + **company licence for 4+ person companies** (Automators about $100/mo min, about $0.01 per render, per third-party summaries) ([licence](https://www.remotion.dev/docs/license)) | 10–30 s, parallel chunks | Excellent | Needs AWS. The composition is React, so it would duplicate our canvas renderer |
| Shotstack | about $0.20–0.30 per rendered minute (subscription vs PAYG) ([pricing](https://www.shotstack.io/pricing)) | about 20–60 s | Good; JSON timeline API | Easy REST; our JSON maps to theirs |
| Creatomate | ≈ 37 credits per 1080p30 minute; plans from about $41–54/mo ([wireflow summary](https://www.wireflow.ai/blog/creatomate-pricing)) | Similar | Good templates | Easy REST |
| **Vercel Sandbox + headless Chromium (our renderer) or FFmpeg** | ≈ $0.128 per vCPU-hour + $0.0212 per GB-hour (secondary source) → **under $0.01 a render** (est.) | about 30–90 s | Same as browser (same code) | Pro: up to 24 h sessions ([changelog](https://vercel.com/changelog/vercel-sandbox-can-now-run-for-up-to-24-hours)) |

**Vercel limits that shape the design** ([Functions limits, updated 2026-08-24](https://vercel.com/docs/functions/limitations)):
- Request and response bodies cap at **4.5 MB**. Never send video through a function: the browser uploads to Supabase Storage with signed upload URLs, and functions pass URLs.
- Max duration is 300 s by default and 800 s max on Pro. Our `vercel.json` sets 60 s for AI functions. **Video generation must be async** (start + webhook + status), never awaited in a request.
- The Gateway's async start request is capped at 300 KiB, so pass hosted image URLs.

**Recommendation:**
- **MVP:** browser render with WebCodecs + Mediabunny, MediaRecorder as fallback.
- **v2:** headless render of *the same* renderer in Vercel Sandbox, for batch and scheduled reels and long encodes.
- Shotstack is a fallback if Sandbox proves awkward. Skip Remotion unless we move to React (licence + duplicate renderer).

---

## 5. The "natural and polished" quality bar

### 5.1 Craft checklist (what the lint checks)

| Area | Rule (default) | Check |
|---|---|---|
| Hook | Claim or number visible at t ≤ 0.5 s; VO starts ≤ 0.2 s; no logo intro | lint |
| Length | 15–60 s (Top-5 ≤ 75 s); warn above 90 s | lint |
| Pacing | Visual change every 1.2–3.5 s; no still held over 4 s without motion | lint |
| Safe zones | All text and logos inside x 65–1015, y 270–1580 | lint + vision |
| Typography | ES fonts only; min cap height about 48 px for captions and 64 px for numbers; ≤ 2 caption lines; ≤ 7 words per line; contrast ≥ 4.5:1 on a scrim | lint (glyph widths from `_glyph-widths.js`) |
| Captions | Word-timed; drift ≤ 80 ms from the VO; no orphan single-letter cards; key word highlighted at most once per card | lint |
| Motion | Ease-out curves; push ≤ 10% per shot; no spins or wipes; transitions ≤ 250 ms | lint |
| Colour | Team colours from `video-ads-teams.js`; tint ≤ 70% (as Video Ads); no off-brand purple in chrome | lint |
| Audio | VO about −14 LUFS integrated (conv.); music ducked ≥ 12 dB under VO; no clipping; 0.3 s music tail | audio analysis in the browser (Web Audio) |
| Facts | Every number and name in VO, captions and cards appears in the sources (`_lint-spec.js` number and team checks) | lint (**blocking**) |
| Faces | Photo subject = named player (vision); no AI-generated people | vision |
| Rights | Every asset's `rights` covers the target (organic/paid) | lint (**blocking**) |
| Ending | Loopable last frame or a CTA question; ES bug visible in the last 2 s | lint |
| Disclosure | Any generated video segment sets `aiDisclosure: true` in the export metadata | lint |

### 5.2 How to enforce it automatically

1. **`_reel-lint.js`** (new, modelled on `_lint-spec.js`) returns `errors / warnings / patch` on the timeline:
   - **errors** go back for one targeted AI repair (as in Generate);
   - **patches** are safe auto-fixes (move a card into the safe zone, shorten a caption, snap a cut to the beat).
2. **Vision QA (Gemini 3.8 Flash)** on the rendered preview: frames at 2 fps + audio.
   - Returns a 1–5 score on hook strength, legibility, "looks templated or AI", brand fit, a black or awkward first frame, and the photo matching the named player.
   - Score under 3.5 means one auto-revise pass. If it still scores low, the editor sees why.
   - This is the role `_ad-rating.js` played for Video Ads (that UI was removed in v2). Reuse its prompt structure.
3. **Golden set:** 30 reels hand-rated by the ES design team. Run `npm run eval:reels` before changing any model or prompt (as `eval:generate` does).
4. **Variety guard:** no two reels in a row from the same template with the same opening move (counters "mass-produced" penalties).

---

## 6. Architecture inside FrameUp

### 6.1 The flow

```
Trends (trend-design.js, 48h, per sport) ─┐
ES articles (ES MCP query_articles) ──────┼─► Format router (code) ─► Creative director (_reel-director.js)
Saved trend / manual brief ───────────────┘        │                      beats, hook variants, facts+sources
                                                   ▼
                     Asset gatherer: ES image pool (es-image-search), team logos/colours,
                     stat cards (frameup-templates), music library, [v2] licensed clips + Gemini moments,
                     [v2] generated b-roll (async job)
                                                   ▼
                     Writer → VO text → TTS (Gateway) → Scribe alignment → caption words
                                                   ▼
                     Timeline JSON (EDL) → _reel-lint (fix/repair) → Preview (reel-render.js, canvas)
                                                   ▼
                     Export (WebCodecs+Mediabunny | MediaRecorder | [v2] Sandbox) → Supabase Storage
                                                   ▼
                     Vision QA → export events → [v3] posted + performance → lessons → director
```

### 6.2 Reuse map

| Existing | Reuse for |
|---|---|
| `_ai-gateway.js` (`aiText`, `aiWebResearch`, `aiImage`, `logUsage`, the caps) | Every AI call. **Add** `aiSpeech`, `aiTranscribe`, `aiVideoStart` / `aiVideoStatus` with per-second cost logging |
| `_creative-director.js` (`runDirector`, `validateConcepts`, `HOOKS`/`EMOTIONS`) | Clone it as `_reel-director.js` with beats in place of templates |
| `_lint-spec.js`, `_glyph-widths.js`, `frameup-rules.js`, `brand-kit.js` | Fact, team and number checks; text fitting; banned words |
| `trend-design.js` (`getTrends`, `enrich`) and the Trends→Video Ads hand-off (`frameup.videoAdMoment.v1`) | Topic source; add a "Make reel" card action (`frameup.reelMoment.v1`) |
| `es-image-search.js` / `_es-mcp.js` | Photos and article facts |
| `video-ads-render.js` (pure layout + `drawFrame`, Frame/Tint maths) | The base of `reel-render.js` (timeline renderer) |
| `video-ads.js` export (`MediaRecorder`, Web Audio mix) and `reels.js` (word chunking, caption styles, lower-thirds, `createCaptionedExportStream`) | Fallback export; caption logic |
| `es-video-intelligence.js` | Transcription fallback chain (Groq/OpenAI/MCP) |
| `_ad-learning.js` + `frameup_video_ad_events` + `frameup_video_ad_lessons()` | Pattern for `frameup_reel_events` and lessons |
| `_ad-rating.js` | Vision QA prompt and score schema |
| `video-ads-teams.js`, `league-logos.js`, `video-ads-brands.js` | Team colours, logos, newsletter wordmarks |
| `dashboard.html` AI usage panel | Add reel features to `AI_FEATURE_LABELS`; video seconds |

### 6.3 New Supabase tables (proposed; one migration)

| Table | Key columns | RLS |
|---|---|---|
| `frameup_reel_projects` | id, user_id, user_email, sport (nfl/cfb/mlb/golf), format, trend_id, title, status (draft/rendered/exported/posted), timeline jsonb (≤ 200 KB), cost_usd, created_at, updated_at | Owners read and write their own; admins read all |
| `frameup_reel_assets` | id, project_id (nullable for library), kind (image/clip/vo/music/broll/graphic), source (es_pool/licensed/generated/upload/library), storage_path or url, **rights jsonb** {licence, organic, paid, expires_at, attribution, licensor}, meta jsonb (faces, boxes, bpm, beats, duration) | Team read; insert own |
| `frameup_reel_renders` | id, project_id, version, storage_path, duration_ms, bytes, renderer (browser/sandbox), qa_score, qa_report jsonb | Owner |
| `frameup_reel_events` | append-only like `frameup_video_ad_events`: script_generated, beat_edited, asset_swapped, rendered, qa_scored, exported, posted, metrics (views, avg watch, shares; v3) | Insert own; read own; admins all |
| `frameup_video_jobs` | gateway_job_id, project_id, model, seconds, est_cost, status, token_hash, signing_secret (encrypted or service-only), expires_at, storage_path | **Service role only** (the webhook writes it) |
| `frameup_music_library` | id, title, storage_path, bpm, beats jsonb, mood, sports[], licence, allowed (organic/paid/platforms) | Team read; admin write |
| `frameup_ai_usage` (alter) | add `audio_seconds`, `video_seconds` | unchanged |
| `frameup_ai_cache` | already proposed in `ai-strategy-and-costs.md` (D2) | reuse |

**Storage:** a private `frameup-reels` bucket with per-user folders and signed URLs (renders, VO, generated clips). Keep a 30-day lifecycle for drafts.

**Caching:**
- Director output per `(trend_id, format)` for 45 min (like trend enrichment).
- TTS per hash of `(voice, text)` for good, so re-renders don't re-bill.
- Scribe alignment per VO hash.
- Gemini clip analysis per clip URL hash.
- Generated b-roll per prompt + seed in the asset library (reused across reels).

### 6.4 New files (proposed)

- **Pages:**
  - `reel-maker.html`, `reel-maker.css`, `reel-maker.js`: the Reels Studio UI. 3 steps: Topic & format → Edit (beat list, swap photo, retime, voice, music) → Export.
  - `reel-render.js`: a pure timeline renderer, testable in Node like `video-ads-render.js`.
- **Functions:**
  - `netlify/functions/reel-maker.js` + `api/reel-maker.js`. POST modes: `plan` (router + director + script), `assets`, `voice` (TTS + align), `revise` (natural-language edit → timeline patch), `qa`, `music`.
  - `netlify/functions/_reel-director.js`, `_reel-lint.js`.
  - v2: `netlify/functions/video-job.js` (start and status) and `video-webhook.js` (signed Gateway webhook → Storage).
- **Migration:** `supabase/migrations/2026112xxxxxxx_frameup_reels.sql`.
- **Tests:** `scripts/test-reel-render.mjs`, `test-reel-lint.mjs`, `test-reel-director.mjs`, and an `eval:reels` golden set.
- **`vercel.json`:** add `api/reel-maker.js` at 60 s. v2: the webhook at 15 s.

---

## 7. Costs and guardrails

### 7.1 Cost per 30-second reel (est., Gateway/provider list prices 2026-11)

| Step | Economy | Standard | Premium |
|---|---|---|---|
| Director | Haiku ≈ $0.0012 | Sonnet ≈ $0.017 | Sonnet ≈ $0.02 |
| Writer + repair | Haiku ≈ $0.001 | Haiku ≈ $0.002 | Sonnet ≈ $0.02 |
| Fact research | ES articles / MCP (free) | 2 web searches ≈ $0.025 | 4 searches ≈ $0.05 |
| Photo / clip picking | Haiku vision ≈ $0.001 | Gemini Flash, 3 × 60 s clips ≈ $0.016 | ≈ $0.03 |
| Voiceover | Gemini 3.8 Flash TTS ≈ $0.007 | ElevenLabs Flash v2.5 ≈ $0.018 | ElevenLabs v3 ≈ $0.036 |
| Caption alignment | Scribe v2 ≈ $0.002 | ≈ $0.002 | ≈ $0.002 |
| Generated b-roll | none | 1 × 5 s Veo 3.1 Lite 720p ≈ $0.25 | 3 × 6 s Veo 3.1 Fast 1080p ≈ $2.16 |
| Music | library ($0 marginal) | library | library or ElevenLabs Music (price unconfirmed; assume ≈ $0.05) |
| Vision QA | 1 pass ≈ $0.006 | 2 passes ≈ $0.012 | 3 passes ≈ $0.02 |
| Render | browser $0 | browser $0 | Sandbox ≈ $0.01 / Shotstack ≈ $0.10 |
| **Total** | **≈ $0.02** | **≈ $0.35** (≈ $0.10 with no b-roll = "standard-lite") | **≈ $2.45** |

### 7.2 Monthly (30 days)

| Reels/day | Economy | Standard-lite ($0.10) | Standard ($0.35) | Premium ($2.45) | **Recommended mix ($0.41)** |
|---|---|---|---|---|---|
| 20 (600/mo) | $12 | $60 | $210 | $1,470 | **$246** |
| 50 (1,500/mo) | $30 | $150 | $525 | $3,675 | **$615** |
| 100 (3,000/mo) | $60 | $300 | $1,050 | $7,350 | **$1,230** |

**Add fixed costs:**
- music library: about $20–100/mo self-serve; enterprise average reported about $29k/yr ([Spendhound](https://spendhound.com/marketplace/epidemic-sound-pricing));
- render service only if used (Shotstack from about $39/mo, or the Remotion licence);
- Vercel Pro (already in use);
- **footage licences** (not public; likely the largest line).

Compared with the current FrameUp AI bill (about $19–97/month at 10–50 users, per `ai-strategy-and-costs.md`), the recommended reels mix at 50/day is roughly **6–30× today's AI spend**. Nearly all of it is video generation, which is optional per reel.

### 7.3 Fitting the caps

- The current **$20 per person per week** cap covers about 1,000 economy reels, about 57 standard reels or about 8 premium reels a week per person. Text-and-stills reels fit easily. **Video generation does not.**
- **Proposal:**
  1. A **separate Gateway API key** for Reels with its own **Gateway budget**. Vercel supports budgets per team, project, API key or member ([pricing docs](https://vercel.com/docs/ai-gateway/pricing)). Reel spend can't starve Generate, and vice versa.
  2. Keep the per-person $20/week for all text, voice and vision.
  3. Add a **per-person weekly video-generation allowance in seconds** (e.g. 60 s/week ≈ $3–7) and a **team weekly video-gen cap** (e.g. $150). Premium (over $1 per reel) needs an admin click or the "premium" role.
  4. Show the estimated cost *before* a b-roll generation ("≈ $0.25, 5 s").
  5. **Fail closed for video generation** (unlike text): if spend can't be read, don't start a job.
  6. Log every job in `frameup_ai_usage` with `video_seconds`; add reel features to the Dashboard labels; Slack alert per the strategy doc's B2.
  7. Idempotency key on every video start (the Gateway supports it) so retries never double-bill.

---

## 8. Competitive scan

Pricing and feature claims are mostly from vendor or affiliate pages; dated 2026.

| Tool | Best at | Copy / beat for ES |
|---|---|---|
| **OpusClip** | Long→short clipping, "virality score", natural-language clip search, auto-reframe ([Opus blog](https://www.opus.pro/blog/best-ai-video-editors)) | Copy: the score (our vision QA score) and "find the moment" (Gemini). Beat: ES grounding + rights ledger |
| **Submagic** | Caption design polish | Copy: 6–8 caption presets with word highlight and emoji-free sports style |
| **Captions (Mirage)** | Chat-to-edit on mobile, AI presenters | Copy: the `revise` mode ("make it punchier, 25 s"). Skip avatars |
| **Vizard** | Clipping + speaker reframe + 32-language captions ([2026 roundup](https://reap.video/blog/state-of-ai-video-clipping-2026)) | Copy: multi-language later (v3) |
| **Veed / Kapwing** | Browser editors, collaboration, subtitles | Copy: the simple timeline editor; templates shared across the team |
| **Descript** | Edit video by editing text | Copy: edit the script → VO and timeline re-render (our beats list) |
| **CapCut** | Templates, trend effects, auto captions | Copy: speed of templating. Beat: commercial-safe music and brand control (CapCut template music isn't cleared for brands) |
| **Runway / Pika / Luma** | Generative video and effects | Use via the Gateway equivalents (Veo/Kling/Seedance) only for b-roll |
| **WSC Sports** | Rights holders' automated highlights at scale (about 70% of NFL rights-holder clips) ([WSC](https://wsc-sports.com/blog/reports/vertical-is-the-new-baseline-2025-26-nfl-regular-season-content-trends/)) | Not a competitor for non-rights holders; **a possible partner** if ES licenses footage |
| **Magnifi (VideoVerse, owned by Minute Media)** | Real-time key-moment detection, AutoFlip reframing ([SVG](https://www.sportsvideo.org/2024/04/04/magnifi-embraces-generative-ai-to-drive-sports-highlights-content-creation-in-new-ways/)) | Minute Media is also a **competing publisher** with a licensed video library. Watch its pricing; possible licensor |
| **House of Highlights / B/R** | Licensed NFL footage + creator-led franchises | The benchmark: licence + personality |

**ES's moat:** trend-to-reel in minutes, grounded in ES's own reporting and brand system, with rights tracked per asset and a learning loop from what editors actually export and post. Generic clippers have none of this.

---

## 9. Phased roadmap

### 9.1 MVP (about 2 weeks, est.): "Reels Studio, no-footage formats"

**Scope:**
- **Formats:** Explained in 30s, Stat/Record alert, Top-5 countdown. NFL, CFB, MLB, Golf.
- **Topic in:** Trends card "Make reel" + manual brief.
- **AI:** router (code) → director (Haiku default, Sonnet on low concept quality) → writer → fact lint → photo picks (Haiku vision) → TTS (Gemini 3.8 Flash; ElevenLabs Flash as a voice option) → Scribe v2 alignment → captions (2 styles).
- **Edit:** beat list (reorder, edit text, swap photo from ES pool, change voice or music, "make it shorter/punchier" revise).
- **Render:** `reel-render.js` canvas; export with WebCodecs + Mediabunny, MediaRecorder fallback; 1080×1920 MP4.
- **QA:** `_reel-lint.js` blocking rules (facts, rights, safe zones) + one Gemini QA pass with the score shown.
- **Data:** the migration (projects, assets, renders, events, music library); a private Storage bucket; usage logged.
- **Music:** about 40 pre-cleared tracks uploaded by an admin.
- **No video generation**, except an admin-only flag.

**Files:** see §6.4 (no edits to `index.html` WIP). Small additions to `generate.html` (Trends card action), `dashboard.html` (labels) and `vercel.json`.

**Acceptance criteria:**
1. A non-designer goes from trend to exported 30 s MP4 in **≤ 5 minutes**, with ≤ 3 manual edits.
2. Every number and name in the reel traces to a source; lint blocks invented ones (tests).
3. All text sits within safe zones at 1080×1920; captions drift ≤ 80 ms (tests on the renderer).
4. Export works in Chrome and Edge (WebCodecs) and falls back in Safari; the file plays on IG, TikTok and YouTube upload.
5. Average AI cost ≤ $0.03 per economy reel and ≤ $0.12 standard-lite, visible in the Dashboard.
6. The 7 baseline test failures are unchanged; new tests pass; `eval:reels` golden set ≥ 3.8/5 average from the ES team.

### 9.2 v2 (weeks 3–6): licensed footage, b-roll, more formats

- Quote reel and Debate formats; golf "What to watch".
- **Licensed footage ingest** (once a licence exists): uploads or partner API into the asset library with `rights`; Gemini moment finding; scene detection; auto-reframe with smoothed subject tracking; beat-synced cuts; Topaz upscale if needed.
- **Generated b-roll:** async `video-job.js` + `video-webhook.js`; Veo 3.1 Lite / Kling 2.6 default, Veo Fast / Kling 3 premium; cost shown first; disclosure flag.
- ElevenLabs v3 hype voice with audio tags; 6 caption presets; 3 hook variants per reel.
- Server render in Vercel Sandbox (same renderer) for batch; Shotstack as fallback.
- Video Ads: rights gate on clips (no paid export without `paid: true`).
- **Acceptance:** b-roll jobs never block a request; a webhook-to-Storage copy happens before expiry; zero double-billed jobs (idempotency); premium spend stays inside the team cap.

### 9.3 v3 (weeks 7–12): autopilot + learning

- **Daily slate:** a scheduled job proposes N reels per sport from the morning trends for editors to approve (human-in-the-loop).
- **Publishing** (with approval): Instagram Content Publishing API, YouTube Data API upload, TikTok Content Posting API, with platform AI-disclosure fields set.
- **Performance import** (IG insights, YouTube Analytics) → `frameup_reel_events.metrics` → lessons for the director (hooks, lengths and formats that win per sport).
- Per-team personalisation, Spanish versions, an "ES anchor" avatar experiment (disclosed) only if Suhail approves.

### 9.4 Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Copyright claim on footage | High if downloading continues | Account strikes, ad account bans, damages | No-footage MVP; rights ledger; licence RFPs; stop downloaded clips in paid ads |
| Music claims | Medium | Muted videos, strikes | Library-only music with recorded licences |
| Platform originality / "mass-produced" penalties | Medium | Reach collapse across the account (Facebook) | VO + original analysis on every reel; variety guard; no reposts |
| Likeness / NIL / fake-person backlash | Low (with policy) | Legal and brand | No realistic people in generation; no voice clones; disclosure |
| Wrong stats | Medium | Credibility | Blocking fact lint; sources in the timeline; human approve |
| Video-gen cost runaway | Medium | Budget | Separate key and budget, seconds allowance, fail-closed, idempotency |
| Gateway video is beta; vendor churn (Sora shut down) | Medium | Feature breaks | Model ids in env; two providers per tier; output copied to our storage |
| Browser export differences (Safari) | Medium | Support load | Feature-detect; MediaRecorder fallback; v2 server render |
| Prices change (Gemini input and TTS double from 2027-01-01) | High | Budget drift | `PRICES` table in code, monthly review |

### 9.5 Rough build effort (est.)

MVP is about 10 working days for one experienced builder agent plus review: director and writer 2 days, renderer and export 3, UI 3, lint/QA/tests 1.5, migration and wiring 0.5. v2 is about 15 days; v3 about 20 days, plus platform app reviews.

### 9.6 Decisions Suhail needs to make

1. **Budget:** a monthly ceiling for Reels AI (suggest a $300/month start for about 20–30 reels/day mix), a **separate Gateway key with its own budget**, and the video-gen seconds allowance per person.
2. **Footage licence route:** NFL direct (B/R-style), intermediaries (STN, Minute Media, Imagen/IMG Replay, Getty/AP/Reuters video), PGA TOUR / golf creators, or no footage for now. Who owns the outreach?
3. **Video Ads clip policy:** stop using downloaded X/league clips in **paid** ads now? (Recommended: yes.)
4. **ES image pool scope:** get written confirmation that the agency licences cover social video and paid ads.
5. **House voice:** ElevenLabs (recommended) vs Gemini TTS; one male, one female; blind test.
6. **Music library:** Epidemic Sound vs Soundstripe vs Artlist (or ElevenLabs Music once its terms are checked); a licence tier covering paid and multi-platform use.
7. **AI video policy:** allowed for b-roll only? Always disclosed? Premium needs admin approval?
8. **Human approval before publishing** (recommended: always, at least until v3 metrics prove quality).
9. **Render path for v2:** Vercel Sandbox (recommended) vs Shotstack vs Remotion (licence).
10. **MVP format order:** confirm Explainer, Stat/Record and Top-5 first, then Quote and Debate.

---

## Source list (accessed 2026-11-17)

**Vercel / AI Gateway**
- AI Gateway models catalogue: https://vercel.com/ai-gateway/models
- Video generation docs (async, webhooks, 300 KiB limit), updated 2026-09-08: https://vercel.com/docs/ai-gateway/modalities/video-generation
- Video quickstart: https://vercel.com/docs/ai-gateway/getting-started/video
- AI Gateway pricing (no markup, budgets, BYOK), updated 2026-09-08: https://vercel.com/docs/ai-gateway/pricing
- Kling models index: https://vercel.com/ai-gateway/models/labs/klingai
- Veo 3.1 Lite page: https://vercel.com/ai-gateway/models/veo-3.1-lite-generate-001
- Veo 3.1 Fast page: https://vercel.com/ai-gateway/models/veo-3.1-fast-generate-001
- Seedance 2.5 Flash page: https://vercel.com/ai-gateway/models/seedance-2.5-flash
- Kling 3.0 i2v page: https://vercel.com/ai-gateway/models/kling-v3.0-i2v
- Eleven v3 page: https://vercel.com/ai-gateway/models/eleven-v3
- Scribe v2 page: https://vercel.com/ai-gateway/models/scribe-v2
- Music v2.5 page: https://vercel.com/ai-gateway/models/music-v2.5
- Gemini 3.8 Flash page: https://vercel.com/ai-gateway/models/gemini-3.8-flash
- Functions limits, updated 2026-08-24: https://vercel.com/docs/functions/limitations
- Sandbox 24 h sessions: https://vercel.com/changelog/vercel-sandbox-can-now-run-for-up-to-24-hours
- Sandbox pricing: https://vercel.com/docs/sandbox/pricing

**Model pricing (providers / third parties)**
- Google AI Studio pricing (TTS, transcribe, Flash): https://aistudio.google.com/docs/pricing
- Gemini media resolution (video tokens): https://ai.google.dev/gemini-api/docs/media-resolution
- Veo pricing snapshot 2026-10-13: https://benchlm.ai/md/media-pricing/veo.md
- Kling 3.0 API prices (Krea): https://docs.krea.ai/api-reference/video/kling-30.md
- Seedance 2.5 pricing (MindStudio): https://www.mindstudio.ai/blog/seedance-2-5-review-pricing/
- Deepgram pricing: https://deepgram.com/pricing
- Veo responsible AI (celebrity filter): https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/responsible-ai-and-usage-guidelines

**Rendering**
- Remotion licence: https://www.remotion.dev/docs/license
- Remotion Lambda cost example: https://remotion.dev/docs/lambda/cost-example
- Shotstack pricing: https://www.shotstack.io/pricing
- Creatomate pricing summary: https://www.wireflow.ai/blog/creatomate-pricing
- Mediabunny: https://mediabunny.dev/guide/introduction

**Audience and platforms**
- WSC Sports NFL 2025/26 trends, 2026-01-27: https://wsc-sports.com/blog/reports/vertical-is-the-new-baseline-2025-26-nfl-regular-season-content-trends/
- ListenFirst TikTok vs Reels: Sports, 2025-02-26: https://www.listenfirstmedia.com/diving-in-tiktok-vs-reels-sports/
- viral.app, 3.3M videos, updated 2026-10-01: https://viral.app/blog/insights/short-form-video-trends
- Buffer Reels length, 2026-11-12: https://buffer.com/resources/instagram-reels-length
- Kapwing short-form statistics 2026: https://www.kapwing.com/resources/short-form-video-statistics-tiktok-reels-and-shorts-by-the-numbers-in-2026/
- Instagram reposts policy (PetaPixel, 2026-04-30): https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/
- Tubefilter on Instagram aggregators, 2026-04-30: https://tubefilter.com/2026/04/30/instagram-removes-algorithm-recommendations-repost-content-aggregator
- Meta unoriginal content (TechCrunch, 2025-07-14): https://techcrunch.com/2025/07/14/following-youtube-meta-announces-crackdown-on-unoriginal-facebook-content
- YouTube AI labels, 2026-05: https://blog.youtube/news-and-events/improving-ai-labels-viewers-creators/
- MLB 2025 social (DesignRush): https://news.designrush.com/mlb-tiktok-global-content-partnership-2026
- Blinkfire 2025 MLB report: https://www.blinkfire.com/d/view_upload/2025-mlb-report
- Learfield CFP digital, 2026-01: https://www.learfield.com/2026/01/data-digital-highlights-around-the-2026-college-football-playoff-teams/
- Front Office Sports on golf creators: https://frontofficesports.com/pga-tour-liv-golf-capitalized-youtube-influencers/
- Front Office Sports on Tour player social rights: https://frontofficesports.com/pga-tour-golfers-improve-social-presence/
- Golf.com social arms race: https://golf.com/news/golf-social-media-arms-race-pga-tour-usga/?amp=1
- Digiday on House of Highlights: https://digiday.com/future-of-tv/house-of-highlights-creator-led-content-triples-revenue
- Instagram Reels safe zone (Hopper HQ): https://www.hopperhq.com/blog/instagram-reel-size/
- Meta safe zones (adkit): https://adkit.so/tools/safe-zones/meta

**Rights and legal**
- B/R NFL deal (Axios, 2025-01-16): https://www.axios.com/2025/01/16/bleacher-report-nfl-deal
- NFL and STN Video: https://www.sportcal.com/media/nfl-extends-partnership-with-stn-video/
- NFL DMCA / Vox policy (Fortune, 2015): https://fortune.com/2015/10/13/deadspin-nfl-twitter
- 2nd Cir. Jordan video fair use (Law360, 2026-04-23): https://law360.com/articles/2469258
- Server test, cert denied (Nixon Peabody, 2025-07-09): https://www.nixonpeabody.com/insights/alerts/2025/07/09/supreme-court-declines-to-resolve-looming-split-on-embedded-content-rights
- SDNY rejects server test: https://natlawreview.com/article/sdny-again-rejects-server-test-display-embedded-content
- Music vs NFL teams (FOS): https://frontofficesports.com/article/sound-clash/
- TikTok Commercial Music Library (Soundstripe): https://www.soundstripe.com/blogs/tiktok-music-library-explained
- Eleven Music launch (BusinessWire, 2025-08-05): https://www.businesswire.com/news/home/20250805333301/en
- AI music copyright comparison (invideo): https://invideo.io/blog/ai-music-copyright-comparison/
- Epidemic Sound pricing (Spendhound): https://spendhound.com/marketplace/epidemic-sound-pricing
- IMG Replay / Imagen case study: https://www.casestudies.com/company/imagen/case-study/img-replay-enjoy-stronger-revenues-after-implementing-imagen-to-manage-their-world-leading-sports-content

**Competitors**
- OpusClip on AI editors: https://www.opus.pro/blog/best-ai-video-editors
- Reap clipping audit, 2026-04: https://reap.video/blog/state-of-ai-video-clipping-2026
- Magnifi and generative AI (SVG, 2024): https://www.sportsvideo.org/2024/04/04/magnifi-embraces-generative-ai-to-drive-sports-highlights-content-creation-in-new-ways/

**Internal (repo)**
- `project-docs/ai-strategy-and-costs.md`
- `project-docs/generate-creative-brain-research.md`
- `project-docs/reels-handoff.md`
- `netlify/functions/_ai-gateway.js`
- `video-ads.js`
- `netlify/functions/video-ads.js`
- `video-ads-render.js`
- `reels.js`
- `netlify/functions/es-video-intelligence.js`
- `netlify/functions/trend-design.js`
- `netlify/functions/_creative-director.js`
- `netlify/functions/_lint-spec.js`
- `supabase/migrations/20261117120000_video_ad_learning.sql`

**Couldn't verify:** Gateway dashboard prices for most video, music and some voice models (the pages render prices client-side); whether Gemini on the Gateway accepts video input; official ElevenLabs music terms for paid social; Seedance 2.5 Flash price; any public price for league footage licences; whether the ES image agency licences cover social video or paid use.
