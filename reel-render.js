// Reels Studio renderer: turns a reel plan into a JSON timeline (EDL) and
// draws any frame of it. Pure functions, no DOM: the page passes a canvas
// context, images and a measure(text, font) function, so timing and layout
// are testable in Node (scripts/test-reel-render.mjs).
//
//   buildTimeline(plan, opts)        -> timeline (EDL, research §4.2)
//   frameAt(timeline, tMs)           -> what is on screen at t (shot mix,
//                                       graphic progress, caption card, music gain)
//   layoutGraphic(measure, g, tl)    -> text ops with boxes (safe-zone checks)
//   layoutCaption(measure, card, tl) -> caption ops
//   drawFrame(ctx, timeline, tMs, env)
//   captionCards / estimateWordTimes / duckPoints / musicGainDbAt / contrast
//
// Reuses video-ads-render.js for the photo framing (videoRect), the tint
// maths (tintLayers) and the animated team-colour background (drawGenerated).
//
// The look (research §1.3, §5.1): 1080×1920, text inside x 65–1015 and
// y 270–1580, heavy condensed type (Acumin Pro Condensed, the ES artwork
// face), ease-out motion, photo pushes of at most 10%, cross-fades of 220 ms,
// no spins or wipes, word-level captions with one highlighted word.
//
// Styles (reel-styles.js): 'classic' keeps the look above. The other styles
// ('explainer', 'series', 'countdown') run the styled engine further down: a
// paper or navy ground, chrome (eyebrow, ES badge, series tag, a persistent
// data strip, a 5-to-1 rail), a headline, one layout per beat kind (framed
// photo or clip with an optional cut-out player, stat hero, comparison bars,
// versus cards, a dot ranking, square chips, a step tracker, team tiles, role
// cards, a "?" card, the end card) and block captions. Every layout is ops
// with boxes, so the safe-zone test covers every style x every kind.
//
// Data formats (Phase 1, project-docs/reels-formats-contract.md §4): Game
// Swing, Moment Replay and Archive build a v2 timeline (canvas, data block,
// beat refs) and draw the play / wpline / moment / panel3 beats: scorebug,
// game-clock tab, WP band or chart with the swing marker and the attribution
// line, play card, year rail with stat rows and source chip, the 3-frame
// strip. Every number they draw comes from timeline.data through a ref
// (provenanceNumbers / unbackedNumbers back the lint). A 1080x1350 canvas
// (ReelReplay.buildSlides) draws as a carousel slide. News formats keep the
// v1 path byte-identical.
//
// ES house style (2026-11-21, the ES video team's reels system from Vinay):
// style 'es' (reel-styles.js, the default) runs reel-es.js: seven blocks
// (hook, statement, number, dots, compare, quote, endcard) on ES paper, the
// blue-then-ink slab wipe on every cut, one-line captions at y 1172, the ES
// mark on the hook and the end card only, the logotype on the end card. The
// shared brand layer applies to every style: the 80 px ES mark (right 60,
// top 330) on the hook and the end card, the 96 px logotype, no glow on
// text, no light leaks.
//
// Visuals: a shot's asset is a photo, an AI scene still, an uploaded image, a
// video clip (env.videos[assetId], the page keeps it at clipTimes()), or a
// team graphic tile. A shot with no asset draws the style's designed motion
// background, so no slot is ever empty.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(
    node ? require('./video-ads-render.js') : root.VideoAdsRender, node ? require('./reel-formats.js') : root.ReelFormats, node ? require('./reel-styles.js') : root.ReelStyles,
    // Data formats (Phase 1): the v2 schema and the replay helpers. Optional
    // in the browser (looked up again at call time), so a page that has not
    // loaded them still renders every news reel as before.
    node ? require('./reel-timeline.js') : root.ReelTimeline, node ? require('./reel-replay.js') : root.ReelReplay,
    node ? require('./reel-es.js') : root.ReelES,
  );
  if (node) module.exports = api;
  else root.ReelRender = api;
}(typeof self !== 'undefined' ? self : this, (VA, F, S, T0, RP0, ES0) => {
  'use strict';

  const W = 1080;
  const H = 1920;
  const FPS = 30;
  // v3 (one grid): the sides follow the ES safe frame (40 px); the older
  // top and bottom band stays for the retired styles and the data formats.
  const SAFE = { left: 40, right: 1040, top: 270, bottom: 1580 };
  const MARGIN = 84; // text column x 84–996, inside the safe zone
  const COL = W - 2 * MARGIN;
  const ZONE = { graphicTop: 360, graphicBottom: 1250, captionBaseline: 1500, captionTop: 1330 };
  // Captions stay clear of the like / comment / share rail (x > ~960 from
  // y ~1150 on Reels, TikTok and Shorts) and above the caption-and-handle
  // block (y > 1500): an 820 px measure, centred.
  const CAPTION_W = 820;
  const CONDENSED = (VA && VA.CONDENSED) || '"Acumin Pro Condensed Local", "Roboto Condensed", sans-serif';
  const BODY = 'Roboto, sans-serif';
  const font = (weight, size, family) => `${weight} ${Math.round(size * 10) / 10}px ${family}`;
  const CAP = 0.7; // cap height share (Acumin and Roboto are both close)
  const XFADE_MS = 220;
  const ES_BLUE = '#0A6FDE';
  const WHITE = '#FFFFFF';

  // ─── ES brand (the official vectors, never type in a box) ───────────────
  // Path data copied from the brand files (src), so the mark is the real
  // asset at any size and in any guideline colourway, with no image to load.
  // Video guide (VB-02, SM-02, BL-02..06; es-guidelines.js LOGO): the ES mark
  // top-right, fixed size and place on every frame, 50 px clear space, blue
  // (white type on #0A7DFA) or black when what is under it is ES blue; never
  // effects, never re-typeset. On 9:16 the top 270 px sit under the app's own
  // UI, so the mark is pinned at the top-right of the platform safe zone,
  // where the published ES reels carry it. End cards add the official
  // wordmark (417 px wide, the BL guide size); golf reels the Essentially
  // Golf wordmark.
  const BRAND = {
    mark: { src: "assets/brand-logos/essentiallysports-mark.svg", w: 122.332, h: 104.066, box: "#0A7DFA", d: "M54.1567 57.7938H31.2568V75.8168H57.1807L55.1537 89.8498H14.2188V14.2178H55.1977V28.4348H31.2568V43.6498H54.1567V57.7938Z M78.0299 67.9531C78.4659 74.1651 80.2329 78.4391 85.4259 78.4391C90.4709 78.4391 92.0879 75.0431 92.0879 70.7441C92.0879 65.5101 89.4569 62.4321 80.5609 57.8731C67.4239 51.0901 62.4629 45.3651 62.4629 34.2501C62.4629 21.3121 70.3689 12.8281 85.3519 12.8281C102.977 12.8281 108.02 23.8411 108.164 35.4551H91.4339C91.1449 30.1881 90.1819 25.6621 85.2459 25.6621C81.3809 25.6621 79.6519 28.1691 79.6519 32.3891C79.6519 36.7211 81.3409 38.9551 89.5659 43.0661C103.584 50.1251 109.535 56.0941 109.535 68.8101C109.535 81.3121 102.228 91.2741 85.2519 91.2741C66.8589 91.2741 61.2479 80.7941 60.8789 67.9541H78.0289L78.0299 67.9531Z M78.0299 67.9531C78.4679 74.1651 80.2349 78.4391 85.4259 78.4391C90.4729 78.4391 92.0899 75.0431 92.0899 70.7441C92.0899 65.5101 89.4589 62.4321 80.5629 57.8731C67.4239 51.0901 62.4629 45.3651 62.4629 34.2501C62.4629 21.3121 70.3689 12.8281 85.3539 12.8281C102.977 12.8281 108.019 23.8411 108.164 35.4551H91.4359C91.1449 30.1881 90.1819 25.6621 85.2479 25.6621C81.3809 25.6621 79.6519 28.1691 79.6519 32.3891C79.6519 36.7211 81.3409 38.9551 89.5659 43.0661C103.586 50.1251 109.537 56.0941 109.537 68.8101C109.537 81.3121 102.228 91.2741 85.2539 91.2741C66.8609 91.2741 61.2479 80.7941 60.8789 67.9541H78.0289L78.0299 67.9531Z" },
    wordmark: { src: "brand-logo-blue.svg", w: 258, h: 30.6864, box: "#0A7DFA", d: "M15.7625 16.9716H9.00991V22.2688H16.6542L16.0565 26.3933H3.98584V4.16406H16.0695V8.34263H9.00991V12.8145H15.7625V16.9716Z M22.7979 19.9598C22.9265 21.7856 23.4475 23.0418 24.9788 23.0418C26.4665 23.0418 26.9433 22.0436 26.9433 20.7801C26.9433 19.2418 26.1675 18.3371 23.5443 16.9971C19.6705 15.0035 18.2076 13.3209 18.2076 10.054C18.2076 6.25137 20.5389 3.75781 24.957 3.75781C30.1542 3.75781 31.6412 6.99468 31.6837 10.4082H26.7504C26.6652 8.86015 26.3812 7.5299 24.9257 7.5299C23.7861 7.5299 23.2762 8.26674 23.2762 9.50705C23.2762 10.7803 23.7743 11.4369 26.1996 12.6452C30.3332 14.7199 32.0879 16.4743 32.0879 20.2117C32.0879 23.8862 29.9333 26.8141 24.9275 26.8141C19.5039 26.8141 17.8493 23.7339 17.7405 19.9601H22.7976L22.7979 19.9598Z M38.5253 19.9598C38.6539 21.7856 39.1749 23.0418 40.7062 23.0418C42.1938 23.0418 42.6706 22.0436 42.6706 20.7801C42.6706 19.2418 41.8948 18.3371 39.2716 16.9971C35.3978 15.0035 33.935 13.3209 33.935 10.054C33.935 6.25137 36.2663 3.75781 40.6844 3.75781C45.8815 3.75781 47.3686 6.99468 47.411 10.4082H42.4778C42.3926 8.86015 42.1086 7.5299 40.6531 7.5299C39.5134 7.5299 39.0036 8.26674 39.0036 9.50705C39.0036 10.7803 39.5016 11.4369 41.927 12.6452C46.0605 14.7199 47.8153 16.4743 47.8153 20.2117C47.8153 23.8862 45.6607 26.8141 40.6549 26.8141C35.2312 26.8141 33.5767 23.7339 33.4679 19.9601H38.525L38.5253 19.9598Z M61.6666 16.9716H54.914V22.2688H62.5583L61.9606 26.3933H49.8896V4.16406H61.9735V8.34263H54.914V12.8145H61.6666V16.9716Z M64.4897 26.3933V4.16406H70.097C73.4875 14.6412 74.2748 17.16 74.5039 18.1752H74.595C74.3739 15.378 74.3043 11.7147 74.3043 8.24564V4.16406H78.8294V26.3936H73.3047C69.7824 14.8393 69.1207 12.5994 68.87 11.6386H68.7674C68.9438 14.3132 69.0369 18.4309 69.0369 22.0672V26.3936H64.49L64.4897 26.3933Z M84.8904 8.34263H80.4927V4.16406H94.3789V8.34263H90.0041V26.3936H84.8904V8.34263Z M101.146 4.16406V26.3936H96.0216V4.16406H101.146Z M108.565 21.6355L107.806 26.3936H102.68L107.08 4.16406H114.282L118.738 26.3936H113.416L112.634 21.6355H108.565ZM111.955 17.3396C111.449 14.0963 110.96 10.4782 110.678 8.43462H110.51C110.292 10.5664 109.747 14.0945 109.219 17.3396H111.955Z M120.36 4.16406H125.485V22.2444H132.561L132.084 26.3936H120.36V4.16406Z M134.134 4.16406H139.259V22.2444H146.335L145.858 26.3936H134.134V4.16406Z M149.185 26.3936V19.178C149.185 18.8568 149.153 18.5206 149.008 18.1552L143.777 4.16406H149.432C150.355 7.5182 151.382 11.3802 151.927 14.1116C152.544 11.5948 153.652 7.43444 154.477 4.16406H159.775L154.466 18.2093C154.388 18.4547 154.322 18.7063 154.322 19.0916V26.3936H149.185Z M165.334 19.9598C165.463 21.7856 165.984 23.0418 167.515 23.0418C169.003 23.0418 169.48 22.0436 169.48 20.7801C169.48 19.2418 168.704 18.3371 166.081 16.9971C162.207 15.0035 160.744 13.3209 160.744 10.054C160.744 6.25137 163.075 3.75781 167.494 3.75781C172.69 3.75781 174.177 6.99468 174.22 10.4082H169.287C169.201 8.86015 168.917 7.5299 167.462 7.5299C166.322 7.5299 165.812 8.26674 165.812 9.50705C165.812 10.7803 166.31 11.4369 168.736 12.6452C172.87 14.7199 174.625 16.4743 174.625 20.2117C174.625 23.8862 172.469 26.8141 167.464 26.8141C162.041 26.8141 160.385 23.7339 160.277 19.9601H165.334L165.334 19.9598Z M176.705 4.16406H184.023C187.894 4.16406 190.676 6.30023 190.676 10.9026C190.676 15.5467 188.181 17.7158 183.795 17.7158H181.795V26.3936H176.705V4.16406H176.705ZM181.795 13.8079H183.126C184.892 13.8079 185.563 12.9494 185.563 10.8597C185.563 8.79114 184.673 8.00022 183.232 8.00022H181.795V13.8082L181.795 13.8079Z M207.325 15.1396C207.325 23.2863 205.095 26.8141 199.552 26.8141C194.384 26.8141 192.09 23.2269 192.09 15.0276C192.09 7.15104 194.64 3.75781 199.761 3.75781C205.019 3.75781 207.325 7.40557 207.325 15.1396ZM197.442 15.0294C197.442 20.5168 197.939 22.7999 199.697 22.7999C201.553 22.7999 201.974 20.6758 201.974 15.0294C201.974 9.75277 201.532 7.79354 199.697 7.79354C197.93 7.79354 197.442 9.84799 197.442 15.0294Z M214.756 17.2973V26.3933H209.699V4.16406H217.23C221.533 4.16406 223.725 6.29376 223.725 10.3195C223.725 13.3971 222.207 14.8372 220.863 15.3677C222.608 16.1446 223.431 17.5733 223.431 20.7708V21.544C223.431 24.0156 223.529 25.4166 223.671 26.3936H218.699C218.438 25.5351 218.349 23.5574 218.349 21.3839V20.6185C218.349 17.9898 217.818 17.2973 215.859 17.2973H214.756ZM214.768 13.4726H215.955C217.871 13.4726 218.61 12.7819 218.61 10.6096C218.61 8.77791 217.962 7.977 216.28 7.977H214.768V13.4726Z M229.381 8.34263H224.983V4.16406H238.869V8.34263H234.494V26.3936H229.381V8.34263Z M244.729 19.9598C244.858 21.7856 245.379 23.0418 246.91 23.0418C248.398 23.0418 248.875 22.0436 248.875 20.7801C248.875 19.2418 248.099 18.3371 245.476 16.9971C241.602 15.0035 240.139 13.3209 240.139 10.054C240.139 6.25137 242.47 3.75781 246.889 3.75781C252.085 3.75781 253.572 6.99468 253.615 10.4082H248.682C248.596 8.86015 248.312 7.5299 246.858 7.5299C245.717 7.5299 245.207 8.26674 245.207 9.50705C245.207 10.7803 245.705 11.4369 248.131 12.6452C252.265 14.7199 254.02 16.4743 254.02 20.2117C254.02 23.8862 251.865 26.8141 246.859 26.8141C241.436 26.8141 239.781 23.7339 239.672 19.9601H244.729L244.729 19.9598Z" },
    golf: { src: "assets/brand-logos/essentially-golf-wordmark.svg", w: 1318.35, h: 177.884, box: "#008F00", d: "M92.7824 74.5834V98.1091H54.8456V127.933H97.7789L94.4479 151.088H26.7168V26.05H94.4479V49.5757H54.8456V74.5834H92.7824ZM106.646 114.781H134.959C135.7 125.155 138.476 132.193 147.173 132.193C155.501 132.193 158.091 126.637 158.091 119.412C158.091 110.891 153.836 105.704 139.031 98.1091C117.38 86.9946 109.236 77.5472 109.236 59.2084C109.236 37.7203 122.191 23.6418 146.988 23.6418C176.227 23.6418 184.555 41.9808 184.74 61.0607H157.166C156.612 52.3544 154.946 44.9448 146.803 44.9448C140.511 44.9448 137.551 49.0201 137.551 56.0593C137.551 63.2836 140.326 66.9885 154.02 73.6572C177.153 85.3275 186.961 95.3306 186.961 116.263C186.961 137.01 174.932 153.496 146.803 153.496C116.454 153.496 107.201 136.084 106.646 114.781ZM196.826 114.781H225.139C225.88 125.155 228.655 132.193 237.353 132.193C245.681 132.193 248.271 126.637 248.271 119.412C248.271 110.891 244.015 105.704 229.21 98.1091C207.558 86.9946 199.416 77.5472 199.416 59.2084C199.416 37.7203 212.37 23.6418 237.168 23.6418C266.407 23.6418 274.735 41.9808 274.919 61.0607H247.346C246.79 52.3544 245.125 44.9448 236.983 44.9448C230.691 44.9448 227.73 49.0201 227.73 56.0593C227.73 63.2836 230.506 66.9885 244.2 73.6572C267.332 85.3275 277.141 95.3306 277.141 116.263C277.141 137.01 265.112 153.496 236.983 153.496C206.633 153.496 197.38 136.084 196.826 114.781ZM356.815 74.5834V98.1091H318.878V127.933H361.811L358.48 151.088H290.749V26.05H358.48V49.5757H318.878V74.5834H356.815ZM399.78 151.088H374.242V26.05H405.702C424.763 84.957 429.019 99.2206 430.315 104.777H430.87C429.574 89.0323 429.204 68.4705 429.204 49.0201V26.05H454.557V151.088H423.652C403.851 86.0684 400.15 73.472 398.855 68.1H398.299C399.225 83.1046 399.78 106.26 399.78 126.637V151.088ZM489.755 151.088V49.5757H465.143V26.05H542.867V49.5757H518.439V151.088H489.755ZM554.059 26.05H582.742V151.088H554.059V26.05ZM648.959 124.229H626.196L621.94 151.088H593.256L617.869 26.05H658.212L683.195 151.088H653.4L648.959 124.229ZM629.898 100.147H645.258C642.296 81.8079 639.52 61.4313 638.04 49.9462H637.115C635.819 61.9869 632.859 81.8079 629.898 100.147ZM692.852 151.088V26.05H721.536V127.748H761.138L758.548 151.088H692.852ZM771.103 151.088V26.05H799.787V127.748H839.391L836.799 151.088H771.103ZM883.181 151.088H854.497V110.521C854.497 108.668 854.312 106.815 853.387 104.777L824.147 26.05H855.792C860.974 44.9448 866.711 66.618 869.857 81.9931C873.188 67.7294 879.479 44.389 884.106 26.05H913.715L884.106 104.963C883.551 106.445 883.181 107.742 883.181 109.964V151.088ZM1032.49 79.3997V151.088H1011.39C1010.84 147.754 1010.47 144.605 1010.28 141.271C1004.91 150.904 995.475 153.496 985.668 153.496C960.87 153.496 949.396 134.787 949.396 89.4028C949.396 39.7579 966.421 23.8271 993.81 23.8271C1028.97 23.8271 1031.93 51.7986 1032.12 61.4313H1003.43C1003.06 55.3182 1002.32 46.4266 992.885 46.4266C982.151 46.4266 979.561 60.5051 979.561 89.588C979.561 119.597 981.967 130.897 992.33 130.897C1001.03 130.897 1003.62 123.488 1003.62 109.964V101.999H991.404V79.3997H1032.49ZM1089.92 23.6418C1119.34 23.6418 1132.3 44.2037 1132.3 87.7356C1132.3 133.676 1119.9 153.496 1088.81 153.496C1059.75 153.496 1046.99 133.305 1046.99 87.1799C1046.99 42.7219 1061.24 23.6418 1089.92 23.6418ZM1089.55 46.4266C1079.74 46.4266 1076.97 57.9117 1076.97 87.1799C1076.97 117.93 1079.74 130.897 1089.55 130.897C1099.92 130.897 1102.32 118.856 1102.32 87.1799C1102.32 57.356 1099.92 46.4266 1089.55 46.4266ZM1147.91 151.088V26.05H1176.59V127.748H1216.19L1213.6 151.088H1147.91ZM1226.16 151.088V26.05H1293.89V49.3906H1254.65V76.4359H1291.3V99.5911H1254.65V151.088H1226.16Z" },
  };
  // The ES video system (reel-es.js): an 80 px blue square with the official
  // ES letters, right 60, top 330, clear space half its height; on the hook
  // and the end card only. The logotype (blue block, white ESSENTIALLY
  // SPORTS) at 96 px tall on the end card.
  const ES_MARK = { w: 80, h: 80, x: W - 60 - 80, y: 330, clear: 40 };
  const WORDMARK = { w: Math.round((96 * 258) / 30.6864), h: 96 };
  const getES = () => ES0 || (typeof self !== 'undefined' && self.ReelES) || null;
  // An ES house-style reel (v1 news timelines; data formats in the ES style
  // keep their data layouts and get the ES palette, captions and wipe).
  const isEs = timeline => Boolean(timeline && timeline.v !== 2 && S.get(timeline.style).engine === 'es' && getES());
  // The style a timeline draws in: the ES style wears the reel's look (the
  // data formats' palette and overlay tokens come from it; Paper is as before).
  const styleOf = timeline => (S.withLook ? S.withLook(S.get(timeline.style), timeline.look, timeline.team && Array.isArray(timeline.team.colors) ? timeline.team.colors[0] : '') : S.get(timeline.style));

  // ─── Easing ─────────────────────────────────────────────────────────────
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  const ease = {
    linear: t => clamp01(t),
    outCubic: t => 1 - (1 - clamp01(t)) ** 3,
    outQuint: t => 1 - (1 - clamp01(t)) ** 5,
    inOutSine: t => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t)),
    outBack: t => { const x = clamp01(t); const c = 1.2; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; },
    // Fast start, long soft landing: the kinetic-type curve (masked rises, pushes).
    outExpo: t => { const x = clamp01(t); return x >= 1 ? 1 : 1 - 2 ** (-10 * x); },
    inOutCubic: t => { const x = clamp01(t); return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2; },
    inOutQuart: t => { const x = clamp01(t); return x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2; },
  };
  const progress = (t, start, dur) => clamp01((t - start) / Math.max(1, dur));

  // ─── Colour ─────────────────────────────────────────────────────────────
  const HEX6 = /^#[0-9a-f]{6}$/i;
  function luminance(hex) {
    if (VA && VA.luminance) return VA.luminance(hex);
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 0;
    const lin = c => { const v = parseInt(c, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  }
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // The colour behind a highlighted word (white text on it). Team colours first,
  // when white reads on them at 4.5:1; else ES Blue 600 (4.8:1).
  function accessibleHighlight(colors = []) {
    const list = (Array.isArray(colors) ? colors : [colors]).filter(c => HEX6.test(String(c)));
    return list.find(c => contrast(WHITE, c) >= 4.5) || ES_BLUE;
  }

  // ─── Words, timing and captions ─────────────────────────────────────────
  // Word times for a VO line with no alignment: spread over the line by
  // character weight, with small pauses after punctuation.
  function estimateWordTimes(text, startMs, durMs) {
    const list = F.words(text);
    if (!list.length || !(durMs > 0)) return [];
    const weights = list.map(w => Math.max(2, w.replace(/[^\w%$]/g, '').length) + (/[,;:]$/.test(w) ? 2.5 : 0) + (/[.!?]$/.test(w) ? 4 : 0));
    const total = weights.reduce((a, b) => a + b, 0);
    let at = startMs;
    return list.map((w, i) => {
      const span = (weights[i] / total) * durMs;
      const pause = /[.!?]$/.test(w) ? span * 0.3 : (/[,;:]$/.test(w) ? span * 0.18 : 0);
      const word = { w, s: Math.round(at), e: Math.round(at + span - pause) };
      at += span;
      return word;
    });
  }

  // Caption cards: 1–3 words for hype ('highlight'), up to 6 on two short
  // lines for 'box'. A card ends at punctuation or a pause, never mid-beat.
  function captionCards(words, { style = 'highlight', maxWords, maxChars } = {}) {
    const mw = maxWords || (style === 'box' ? 6 : 3);
    const mc = maxChars || (style === 'box' ? 34 : 20);
    const cards = [];
    let card = null;
    words.forEach((word, index) => {
      const prev = words[index - 1];
      const gap = prev ? word.s - prev.e : 0;
      const breakHere = !card
        || card.words.length >= mw
        || card.chars + word.w.length + 1 > mc
        || gap > 350
        || (prev && prev.beat !== word.beat)
        || (prev && /[.!?;:]$/.test(prev.w) && card.words.length >= 1)
        || (prev && /,$/.test(prev.w) && card.words.length >= 2);
      if (breakHere) {
        // Never leave an orphan one-letter card ("a", "I") when it can join the last.
        card = { s: word.s, e: word.e, words: [index], chars: word.w.length, beat: word.beat };
        cards.push(card);
      } else {
        card.words.push(index);
        card.e = word.e;
        card.chars += word.w.length + 1;
      }
    });
    // Hold each card until the next one starts (no flicker in short gaps).
    cards.forEach((c, i) => {
      const next = cards[i + 1];
      c.e = next && next.beat === c.beat && next.s - c.e < 600 ? next.s : c.e + 220;
    });
    return cards.map(({ s, e, words: w, beat }) => ({ s, e, words: w, beat }));
  }

  // ─── Music ducking (VO-led, music 14 dB under speech) ──────────────────
  const MUSIC = { baseDb: -10, duckDb: -24, attackMs: 90, releaseMs: 320, fadeInMs: 250, fadeOutMs: 900, floorDb: -60 };
  function duckPoints(voClips, durationMs, opts = {}) {
    const o = { ...MUSIC, ...opts };
    const points = [{ t: 0, db: o.floorDb }, { t: o.fadeInMs, db: o.baseDb }];
    const spans = (voClips || [])
      .filter(c => c.durMs > 0)
      .map(c => [Math.max(0, c.inMs - o.attackMs), c.inMs, c.inMs + c.durMs, c.inMs + c.durMs + o.releaseMs])
      .sort((a, b) => a[0] - b[0]);
    // Merge spans that touch, so the music does not bob between beats.
    const merged = [];
    spans.forEach(span => {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[3]) { last[2] = Math.max(last[2], span[2]); last[3] = Math.max(last[3], span[3]); } else merged.push([...span]);
    });
    merged.forEach(([a, b, c, d]) => {
      points.push({ t: Math.max(a, o.fadeInMs), db: o.baseDb }, { t: Math.max(b, o.fadeInMs), db: o.duckDb }, { t: c, db: o.duckDb }, { t: d, db: o.baseDb });
    });
    const end = Math.max(0, durationMs - o.fadeOutMs);
    const kept = points.filter(p => p.t < end).sort((a, b) => a.t - b.t);
    kept.push({ t: end, db: musicGainDbAt(points.sort((a, b) => a.t - b.t), end) }, { t: durationMs, db: o.floorDb });
    return kept;
  }
  function musicGainDbAt(points, t) {
    if (!points || !points.length) return MUSIC.floorDb;
    if (t <= points[0].t) return points[0].db;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (t <= b.t) return b.t === a.t ? b.db : a.db + (b.db - a.db) * ((t - a.t) / (b.t - a.t));
    }
    return points[points.length - 1].db;
  }
  const dbToGain = db => (db <= -59 ? 0 : 10 ** (db / 20));

  // ─── Stat values (count-up) ─────────────────────────────────────────────
  function parseStatValue(raw) {
    const text = String(raw || '').trim();
    const m = text.match(/^([^\d-+]*)([-+]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(.*)$/);
    if (!m) return null;
    const num = Number(`${m[2] === '-' ? '-' : ''}${m[3].replace(/,/g, '')}${m[4] ? `.${m[4]}` : ''}`);
    if (!Number.isFinite(num)) return null;
    return { prefix: m[1] + (m[2] === '+' ? '+' : ''), num, decimals: m[4] ? m[4].length : 0, comma: m[3].includes(','), suffix: m[5] };
  }
  function formatStat(spec, value) {
    if (!spec) return '';
    const fixed = Math.abs(value).toFixed(spec.decimals);
    const [int, dec] = fixed.split('.');
    const grouped = spec.comma ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
    return `${spec.prefix}${value < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}${spec.suffix}`;
  }

  // ─── Timeline (EDL) ─────────────────────────────────────────────────────
  const TEMPLATE_FOR = { hook: 'hook', stat: 'stat', rank: 'rank', quote: 'quote', cta: 'cta', context: 'text', point: 'text', payoff: 'text' };
  const clean = (v, max = 400) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  // opts:
  //   voice:   { [beatId]: { durationMs, words: [{ w, s, e }] (ms from the clip start), asset } }
  //   photos:  { [beatId]: [assetId, …] }   (picks in order: photo, clip, scene, tile, upload)
  //            { ['<beatId>#v<i>']: [assetId] } (versus headshots), { ['<beatId>#t<i>']: [assetId] } (tile logos)
  //   assets:  { [assetId]: { kind, src, label, rights, durationMs?, clipIn? } }
  //   team:    { name, colors: [a, b], logo }  (the reel's team, optional)
  //   style:   'classic' | 'explainer' | 'series' | 'countdown'
  //   captionStyle: 'highlight' | 'box'; voiceMode: 'elevenlabs' | 'gateway' | 'off'
  //   music:   { asset, title } | null; sources: [{ type, title, url }]; corpus: string
  const cleanList = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  function componentData(raw, id, photos, assets) {
    const first = key => ((photos[key] || []).find(a => assets[a]) || '');
    const d = {};
    if (Array.isArray(raw.bars)) d.bars = cleanList(raw.bars, 4).map(b => ({ label: clean(b && b.label, 24), value: clean(b && b.value, 16), note: clean(b && b.note, 60) })).filter(b => b.label && b.value);
    if (Array.isArray(raw.versus)) d.versus = cleanList(raw.versus, 3).map((v, i) => ({ name: clean(v && v.name, 28), value: clean(v && v.value, 14), note: clean(v && v.note, 60), asset: first(`${id}#v${i}`) })).filter(v => v.name);
    if (raw.dotrank && raw.dotrank.total) d.dotrank = { total: clean(raw.dotrank.total, 8), rank: clean(raw.dotrank.rank, 8), label: clean(raw.dotrank.label, 32), note: clean(raw.dotrank.note, 60) };
    if (raw.chips && raw.chips.total) d.chips = { filled: clean(raw.chips.filled, 6), total: clean(raw.chips.total, 6), label: clean(raw.chips.label, 40) };
    if (raw.steps && raw.steps.total) d.steps = { current: clean(raw.steps.current, 2), total: clean(raw.steps.total, 2), label: clean(raw.steps.label, 32) };
    if (Array.isArray(raw.tiles)) d.tiles = cleanList(raw.tiles, 4).map((t, i) => ({ team: clean(t && (t.team || t.name), 32), label: clean(t && t.label, 36), chip: clean(t && t.chip, 18), colors: cleanList(t && t.colors, 2).filter(c => HEX6.test(String(c))), asset: first(`${id}#t${i}`) })).filter(t => t.team);
    // A cut-out player (from a photo) that stands over the beat's clip or photo.
    const cut = first(`${id}#cut`);
    if (cut) d.cutout = cut;
    if (Array.isArray(raw.roles)) d.roles = cleanList(raw.roles, 4).map(r => ({ role: clean(r && r.role, 8), value: clean(r && r.value, 10), note: clean(r && r.note, 40), tone: r && r.tone === 'good' ? 'good' : 'bad' })).filter(r => r.role && r.value);
    return d;
  }
  // ─── Data formats: build (Phase 1, contract §4) ─────────────────────────
  // Lazy lookups so the page's script order does not matter.
  const getT = () => T0 || (typeof self !== 'undefined' && self.ReelTimeline) || null;
  const getRP = () => RP0 || (typeof self !== 'undefined' && self.ReelReplay) || null;
  const DATA_TEMPLATES = new Set(['play', 'wpline', 'moment', 'panel3']);
  const DATA_OPS = new Set(['score', 'circle', 'wpchart', 'panel', 'backdrop', 'shade', 'placeholder']);
  // A data beat holds long enough for its own motion: the score count-up, the
  // line drawing in, three panels arriving one by one.
  const DATA_MIN_MS = { play: 3200, wpline: 3400, moment: 2800, panel3: 5600 };
  const REF_OK = /^(play|wp|src|stat|photo|frame):[A-Za-z0-9_.-]{1,40}$/;
  // Data mode: a data format, or a caller that passes a canvas or data.
  function dataMode(fmt, plan, opts) {
    const isData = (F.isDataFormat && F.isDataFormat(fmt)) || Boolean(opts.canvas || opts.data);
    if (!isData) return null;
    const p = plan || {};
    const src = opts.data || p.data || {};
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
    const data = { game: obj(src.game), athlete: obj(src.athlete), archive: obj(src.archive) };
    const replay = obj(opts.replay) || obj(p.replay);
    const c = opts.canvas || p.canvas || null;
    const canvas = c && Number(c.w) === 1080 && Number(c.h) === 1350 ? { w: 1080, h: 1350 } : { w: W, h: H };
    const fmtOutputs = (F.FORMATS[fmt] && F.FORMATS[fmt].outputs) || ['reel'];
    const want = Array.isArray(opts.outputs) ? opts.outputs : (Array.isArray(p.outputs) ? p.outputs : fmtOutputs);
    let outputs = want.filter(o => o === 'reel' || o === 'carousel');
    if (canvas.h !== H) outputs = outputs.filter(o => o !== 'reel');
    if (!outputs.length) outputs = canvas.h === H ? ['reel'] : ['carousel'];
    const slides = Array.isArray(opts.slides) ? opts.slides : (Array.isArray(p.slides) ? p.slides : []);
    return { data, replay, canvas, outputs, slides, ctx: { data, replay } };
  }
  function beatRefs(raw) {
    const list = Array.isArray(raw && raw.refs) ? raw.refs : [];
    return [...new Set(list.map(String).filter(r => REF_OK.test(r)))].slice(0, 8);
  }
  // A data kind stays only when its data resolves (the validator's rules);
  // otherwise it degrades to a story point, never to an empty box.
  function dataKind(raw, dm) {
    const kind = raw && raw.kind;
    if (F.KINDS.includes(kind)) return kind;
    if (!F.DATA_KINDS || !F.DATA_KINDS.includes(kind)) return 'point';
    const T = getT();
    if (!T) return 'point';
    const refs = beatRefs(raw);
    const ok = type => refs.some(r => r.startsWith(`${type}:`) && T.resolveRef(dm.ctx, r));
    const game = dm.data.game;
    const hasWp = Boolean(game && game.wp && Array.isArray(game.wp.points) && game.wp.points.length && String(game.attribution || '').trim());
    if (kind === 'play' && ok('play')) return 'play';
    if (kind === 'wpline' && hasWp) return 'wpline';
    if (kind === 'moment' && (ok('src') || ok('stat'))) return 'moment';
    if (kind === 'panel3' && ok('frame')) return 'panel3';
    return 'point';
  }
  // Panel captions a replay plan carries on its panel3 beat (frames[].caption, <= 6 words).
  function frameCaptions(raw) {
    const list = Array.isArray(raw && raw.frames) ? raw.frames : [];
    const caps = {};
    list.forEach(f => { if (f && ['setup', 'play', 'reaction'].includes(f.role) && f.caption) caps[f.role] = String(f.caption).replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' '); });
    return Object.keys(caps).length ? { captions: caps } : {};
  }
  function toV2(tl, dm, plan) {
    const clip = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const slides = dm.slides.slice(0, 20).map((sl, i) => ({ id: /^s\d{1,2}$/.test(String(sl && sl.id)) ? sl.id : `s${i + 1}`, kind: ['cover', 'panel', 'moment', 'data', 'cta'].includes(sl && sl.kind) ? sl.kind : 'panel', text: clip(sl && sl.text).slice(0, 140), ...(sl && sl.caption ? { caption: clip(sl.caption).slice(0, 80) } : {}), ...(sl && sl.asset ? { asset: clip(sl.asset).slice(0, 80) } : {}), ...(sl && sl.beat ? { beat: String(sl.beat) } : {}), refs: beatRefs(sl) }));
    const v2 = { ...tl, v: 2, canvas: { ...dm.canvas }, size: [dm.canvas.w, dm.canvas.h], outputs: dm.outputs, data: dm.data, replay: dm.replay, slides };
    void plan;
    const T = getT();
    return T ? T.normalizeTimeline(v2) : v2;
  }

  // *word* emphasis in a VO line (all styles strip the asterisks).
  function parseVoEmphasis(vo) {
    const E = getES();
    if (E) return E.parseEmphasis(vo);
    const text = String(vo || '').replace(/\*/g, '');
    return { text, words: F.words(text), flags: [] };
  }
  // The end card's source line from the reel's sources (sites only; a brief
  // or a script gives none, so the person types it).
  function sourceLineFrom(sources) {
    const hosts = [];
    (sources || []).forEach(s => {
      try { const h = new URL(String(s && s.url)).hostname.replace(/^www\./, ''); if (h && !hosts.includes(h)) hosts.push(h); } catch { /* no url */ }
    });
    return hosts.length ? `Source: ${hosts.slice(0, 3).join(', ')}` : '';
  }

  // The point a picture is framed on: its verified head, else the centre of
  // its focus box, else the upper third (the old fixed crop).
  function focusPoint(asset) {
    const a = asset || {};
    const hd = Array.isArray(a.head) ? { x: a.head[0], y: a.head[1] } : a.head;
    const ok = v => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1;
    if (hd && ok(hd.x) && ok(hd.y)) return [Number(hd.x), Number(hd.y)];
    const f = Array.isArray(a.focus) ? { x: a.focus[0], y: a.focus[1], w: a.focus[2], h: a.focus[3] } : a.focus;
    if (f && ok(f.x) && ok(f.y) && ok(f.w) && ok(f.h)) return [Number(f.x) + Number(f.w) / 2, Number(f.y) + Number(f.h) * 0.3];
    return [0.5, 0.32];
  }
  function buildTimeline(plan, opts = {}) {
    const fmt = F.FORMATS[plan && plan.format] ? plan.format : 'explainer';
    const style = S.get(opts.style || (plan && plan.style));
    // Reels Studio v3: the reel's style (Game Tape, Stat Card, Receipts, Hype
    // Cut). Passed as opts.style / opts.reelStyle, or read from the plan (an
    // old plan opens in the closest style).
    const E0 = style.engine === 'es' ? getES() : null;
    const v3Id = [opts.esStyle, opts.reelStyle, opts.style, plan && plan.esStyle, plan && plan.reelStyle, plan && plan.style].find(id => E0 && E0.isStyle && E0.isStyle(id)) || '';
    const reelStyle = E0 && E0.styleOf ? (v3Id || E0.styleOf(plan || {})) : '';
    const pacing = reelStyle && v3Id ? E0.getStyle(reelStyle).pacing : null;
    // Data formats (Game Swing, Moment Replay, Archive) build a v2 timeline:
    // the data block, beat refs and the data beat kinds. News formats take
    // the v1 path below unchanged (byte-identical output, contract §8).
    const dm = dataMode(fmt, plan, opts);
    const voice = opts.voice || {};
    const photos = opts.photos || {};
    const team = opts.team && opts.team.name ? { name: clean(opts.team.name, 80), colors: (opts.team.colors || []).filter(c => HEX6.test(String(c))).slice(0, 2), logo: opts.team.logo || '' } : null;
    const captionStyle = style.caption.mode === 'user' ? (opts.captionStyle === 'box' ? 'box' : 'highlight') : style.caption.mode;
    // ES house style (reel-es.js): blocks, one shot per scene with the
    // drift, the end card last for exactly 3 s and no voiceover on it.
    const ES = !dm && style.engine === 'es' ? getES() : null;
    // Data formats in the ES style: their story beats (hook, statement, end
    // card) are ES blocks; the data beats keep their data layouts.
    const esData = dm && style.engine === 'es' ? getES() : null;
    const size = ES && (opts.aspect === '4:5' || (plan && plan.aspect === '4:5')) ? [W, 1350] : [W, H];
    const voiceMode = ['elevenlabs', 'gateway'].includes(opts.voiceMode) ? opts.voiceMode : 'off';
    const assets = { ...(opts.assets || {}) };
    const beats = [];
    const video = [];
    const graphics = [];
    const audio = [];
    const words = [];
    let t = 0;
    const list = (plan && Array.isArray(plan.beats) ? plan.beats : []).slice(0, style.beats.max);
    // ES: the end card closes every reel; one is added when the plan has none.
    if (ES && list.length && !list.some(b => b && (b.kind === 'cta' || (b.block && b.block.type === 'endcard')))) list.push({ id: 'es-end', kind: 'cta', block: { type: 'endcard' }, text: '', vo: '' });
    // ES with no recorded voice: the person's VO length (if they gave one)
    // spreads over the beats in proportion to their words; else 2.6 words/s.
    const voScale = ES && plan && Number(plan.voLengthMs) > 0 && !Object.keys(voice).length
      ? Number(plan.voLengthMs) / Math.max(1, list.reduce((a, b) => a + F.estimateVoMs(ES.plainVo(clean(b && b.vo, 320))), 0)) : 1;
    let estimated = 0;
    list.forEach((raw, index) => {
      const id = clean(raw.id, 24) || `b${index + 1}`;
      const kind0 = dm ? dataKind(raw, dm) : (F.KINDS.includes(raw.kind) ? raw.kind : 'point');
      const block = ES ? ES.blockOf({ ...raw, kind: kind0 }) : null;
      const kind = block ? ES.KIND_FOR[block.type] : kind0;
      const isEnd = Boolean(block && block.type === 'endcard');
      const vo = isEnd ? '' : clean(raw.vo, 320);
      const emph = parseVoEmphasis(vo);
      const v = voice[id] || null;
      if (vo && !(v && v.durationMs > 0)) estimated += 1;
      const voMs = v && v.durationMs > 0 ? Math.round(v.durationMs) : Math.round(F.estimateVoMs(emph.text) * voScale);
      const lead = index === 0 ? F.PACE.voLeadMs : 120;
      const last = index === list.length - 1;
      // Data plans (reel-data.js) carry holdMs: the beat's designed hold.
      const hold = dm && Number(raw.holdMs) > 0 ? Math.max(1200, Math.min(7000, Math.round(Number(raw.holdMs)))) : 0;
      const min = Math.max(hold, (dm && DATA_MIN_MS[kind]) || 0, ES && kind === 'hook' ? (pacing ? pacing.hookMs : 3000) : 0, ES && pacing && kind !== 'hook' ? pacing.beatMinMs : 0) || F.PACE.beatMinMs[kind] || F.PACE.beatMinMs.default;
      // ES: the reel ends 3 s after the end card starts.
      const dur = isEnd ? ES.LIMITS.endcardMs : Math.max(min, voMs ? lead + voMs + (last ? F.PACE.endTailMs : (pacing ? pacing.tailMs : F.PACE.tailMs)) : min);
      const beat = {
        id, kind, inMs: t, outMs: t + dur,
        text: clean(raw.text, 120), vo, emphasis: clean(raw.emphasis, 40),
        label: F.KIND_LABELS[kind] || '',
        stat: raw.stat && raw.stat.value ? { value: clean(raw.stat.value, 16), label: clean(raw.stat.label, 24) } : null,
        rank: kind === 'rank' ? Math.max(1, Math.min(10, Number(raw.rank) || 0)) || null : null,
        name: clean(raw.name, 60), detail: clean(raw.detail, 120),
        quote: raw.quote && raw.quote.text ? { text: clean(raw.quote.text, 220), by: clean(raw.quote.by, 60) } : null,
        photo: clean(raw.photo, 80), visual: F.VISUALS.includes(raw.visual) ? raw.visual : '',
        ...componentData(raw, id, photos, assets),
      };
      if (dm) beat.refs = beatRefs(raw);
      beats.push(beat);

      // Shots: a beat longer than shotMaxMs gets a second (or third) shot, so
      // the picture changes every 1.5–3.2 s. A clip moves by itself: one shot
      // per clip, the clip plays from its trim point.
      // ES: media only on the blocks that take it (hook, statement); the
      // others sit on ES paper. One shot per scene, drifting 1 -> 1.1.
      const picks = (ES && !ES.BLOCKS[block.type].media ? [] : (photos[id] || [])).filter(a => assets[a] && !(ES && assets[a].kind === 'design'));
      const isClip = a => assets[a] && assets[a].kind === 'clip';
      const n = ES ? 1 : (picks.length && isClip(picks[0]) ? Math.min(2, picks.length) : Math.min(3, Math.max(1, Math.ceil(dur / F.PACE.shotMaxMs))));
      for (let k = 0; k < n; k += 1) {
        const inMs = t + Math.round((dur * k) / n);
        const outMs = t + Math.round((dur * (k + 1)) / n);
        const asset = picks.length ? picks[k % picks.length] : null;
        const sameAgain = picks.length && k >= picks.length;
        const odd = (index + k) % 2 === 1;
        video.push({
          id: `${id}s${k + 1}`, beat: id, asset, inMs, outMs,
          // clipIn / clipOut: the best segment the clip picker chose (else from 0.4 s to the end).
          clip: asset && isClip(asset) ? (() => {
            const a = assets[asset];
            const end = Math.max(0.5, (Number(a.durationMs) || 6000) / 1000);
            const inSec = Math.max(0, Math.min(end - 0.5, Number(a.clipIn) || 0));
            const out = Number(a.clipOut) > inSec + 0.5 ? Math.min(end, Number(a.clipOut)) : end;
            return { inSec, durSec: out };
          })() : null,
          // Push-ins only, at most +8% (rule: <= 10%); a repeated photo punches
          // in tighter on a different focus instead of repeating the move.
          // ES: the drift is centred on the face (photo-verify's head / focus box), not a fixed point.
          motion: ES ? { from: ES.MOTION.driftFrom, to: asset && isClip(asset) ? 1.03 : ES.MOTION.driftTo, focus: focusPoint(assets[asset]), drift: [0, 0] } : asset && isClip(asset) ? { from: 1.0, to: 1.03, focus: [0.5, 0.42], drift: [0, 0] } : sameAgain
            ? { from: 1.1, to: 1.16, focus: [odd ? 0.42 : 0.58, 0.34], drift: [odd ? 0.06 : -0.06, 0.02] }
            : { from: 1.0, to: 1.08, focus: [0.5, 0.36], drift: [odd ? -0.05 : 0.05, -0.03] },
        });
      }

      const layout = ES ? `es-${block.type}` : ((dm && DATA_TEMPLATES.has(kind) ? kind : style.layouts[kind]) || 'headline-visual');
      if (ES) { beat.block = block; if (!beat.text) beat.text = clean(ES.blockText(block), 120); }
      graphics.push({
        id: `${id}g`, beat: id, template: layout === 'legacy' ? (TEMPLATE_FOR[kind] || 'text') : layout, kind, inMs: t, outMs: t + dur, index,
        data: { text: beat.text, emphasis: beat.emphasis, label: beat.label, stat: beat.stat, rank: beat.rank, name: beat.name, detail: beat.detail, quote: beat.quote, visual: beat.visual, ...componentData(raw, id, photos, assets), ...(dm ? { refs: beat.refs, ...frameCaptions(raw) } : {}), ...(ES ? { block } : {}), ...(esData && String(layout).startsWith('es-') ? { block: esData.blockOf({ ...raw, kind, text: beat.text }) } : {}) },
        ...(ES && picks.length ? { media: true } : {}),
      });

      if (vo) {
        const start = t + lead;
        const span = voMs || F.estimateVoMs(emph.text);
        const timed = v && Array.isArray(v.words) && v.words.length
          ? v.words.map(word => ({ w: clean(word.w, 40).replace(/\*/g, ''), s: start + Math.round(word.s), e: start + Math.round(word.e) })).filter(word => word.w)
          : estimateWordTimes(emph.text, start, span);
        // *word* in the VO (and, in the ES style, the beat's highlight word)
        // shows in yellow in the captions.
        const hl = ES && !emph.flags.some(Boolean) && beat.emphasis ? beat.emphasis.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
        timed.forEach((word, k) => {
          const em = (timed.length === emph.flags.length && emph.flags[k]) || (hl && word.w.toLowerCase().replace(/[^a-z0-9]/g, '') === hl);
          words.push({ ...word, beat: id, ...(em ? { em: true } : {}) });
        });
        if (v && v.asset) audio.push({ id: `vo-${id}`, kind: 'vo', beat: id, asset: v.asset, inMs: start, durMs: span, gainDb: 0 });
      }
      t += dur;
    });

    const durationMs = t;
    // ES: the stamp lands when its word is spoken (else 40% into the hook).
    if (ES) {
      graphics.forEach(g => {
        const st = g.data.block && g.data.block.stamp;
        if (!st) return;
        const dur = g.outMs - g.inMs;
        const key = String(st.text).toLowerCase().replace(/[^a-z0-9]/g, '');
        const word = words.find(w => w.beat === g.beat && w.w.toLowerCase().replace(/[^a-z0-9]/g, '') === key);
        const at = st.at != null ? st.at * 1000 : (word ? word.s - g.inMs : dur * 0.4);
        g.stampAt = Math.round(Math.max(300, Math.min(dur - 400, at)));
      });
    }
    // Clip sound is MUTED by default (owner, 2026-11-18): the mix is voice
    // plus music. With opts.clipAudio on, each clip shot adds its own sound
    // from the shot's trim point, low (-12 dB) and ducked to -26 dB under the
    // voice. The page decodes it into buffers['clipaudio:<asset>'].
    if (opts.clipAudio) {
      const voClips = audio.filter(a => a.kind === 'vo');
      const envelope = duckPoints(voClips, durationMs, { baseDb: -12, duckDb: -26, fadeInMs: 0, fadeOutMs: 300 });
      // true, or the list of clip assets that have a sound track.
      const withSound = Array.isArray(opts.clipAudio) ? new Set(opts.clipAudio) : null;
      video.forEach(shot => {
        if (!shot.clip || !shot.asset || (withSound && !withSound.has(shot.asset))) return;
        const id = `clipaudio:${shot.asset}`;
        const src = assets[shot.asset];
        assets[id] = { kind: 'clip-audio', label: `Sound of ${src.label || 'a clip'}`, rights: src.rights ? { ...src.rights } : null };
        audio.push({ id: `ca-${shot.id}`, kind: 'clip', beat: shot.beat, asset: id, inMs: shot.inMs, durMs: shot.outMs - shot.inMs, offsetSec: shot.clip.inSec, loopEndSec: shot.clip.durSec, gainDb: -12, envelope });
      });
    }
    if (opts.music && opts.music.asset && assets[opts.music.asset]) {
      const voClips = audio.filter(a => a.kind === 'vo');
      audio.push({ id: 'music', kind: 'music', asset: opts.music.asset, inMs: 0, gainDb: MUSIC.baseDb, duck: true, envelope: duckPoints(voClips, durationMs) });
    }

    // Rights for what the renderer itself makes (research §3.3 step 4).
    if (video.some(shot => assets[shot.asset] && assets[shot.asset].kind === 'design')) {
      assets['bg:generated'] = { kind: 'graphic', label: style.engine === 'classic' ? 'Animated team-colour background' : `${style.label} designed background`, rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    }
    assets['graphics:es'] = { kind: 'graphic', label: 'Type, stat cards and captions', rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    assets['logo:es'] = { kind: 'logo', label: 'EssentiallySports mark', src: 'assets/brand-logos/essentiallysports-mark.svg', rights: { source: 'EssentiallySports', licence: 'ES brand mark', organic: true, paid: true } };
    if (team && team.logo) {
      assets['logo:team'] = { kind: 'logo', label: `${team.name} logo`, src: team.logo, rights: { source: 'Team mark (ESPN logo CDN)', licence: 'Editorial use of a team mark; not cleared for paid ads', organic: true, paid: false } };
    }

    const highlight = accessibleHighlight(team ? team.colors : []);
    const cards = captionCards(words, captionStyle === 'es' ? { style: 'highlight', maxWords: 3, maxChars: 22 } : { style: captionStyle === 'box' ? 'box' : 'highlight' });
    const sx = plan && plan.strip && plan.strip.value ? { label: clean(plan.strip.label, 32), value: clean(plan.strip.value, 14), of: clean(plan.strip.of, 14), note: clean(plan.strip.note, 48), tone: plan.strip.tone === 'good' ? 'good' : 'bad' } : null;
    const out = {
      v: 1, fps: FPS, size: [W, H], durationMs,
      format: fmt, tag: F.FORMATS[fmt].tag, sport: clean(plan && plan.sport, 12), title: clean(plan && plan.title, 140),
      style: style.id, limits: { maxSeconds: style.seconds.max, targetSeconds: style.seconds.target },
      // The ES look (reel-es-themes.js): the person's pick, the plan's, else Paper.
      // v3: a reel built in one of the four styles draws with that style's
      // look; an old reel keeps its look and opens in the closest style.
      ...(style.engine === 'es' && getES() ? { look: getES().themes.lookId(v3Id && !opts.look ? getES().themes.lookForReelStyle(reelStyle) : (opts.look || (plan && plan.look))) } : {}),
      ...(reelStyle ? { reelStyle, esStyle: reelStyle } : {}),
      eyebrow: clean(plan && plan.eyebrow, 48), series: plan && plan.series && plan.series.tag ? { tag: clean(plan.series.tag, 28) } : null,
      strip: style.chrome.strip ? sx : null,
      team, highlight, captionStyle, voice: { mode: voiceMode },
      beats,
      tracks: { video, graphics, captions: { style: captionStyle, words, cards }, audio },
      assets,
      sources: (opts.sources || []).slice(0, 20),
      corpus: String(opts.corpus || '').slice(0, 12000),
    };
    if (ES) {
      out.size = size;
      out.sourceLine = clean((plan && plan.sourceLine) || sourceLineFrom(opts.sources), 120);
      // Times are estimates (2.6 words a second) until the voice is recorded.
      out.timing = { estimate: estimated > 0, wordsPerSecond: F.PACE.wordsPerSecond, ...(voScale !== 1 ? { voLengthMs: Number(plan.voLengthMs) } : {}) };
      if (plan && plan.script && plan.script.locked) out.script = { locked: true };
    }
    if (esData) out.sourceLine = clean((plan && plan.sourceLine) || sourceLineFrom(opts.sources), 120);
    return dm ? toV2(out, dm, plan) : out;
  }

  // ─── What is on screen at t (pure; the timing tests read this) ─────────
  function findIndex(list, t) {
    for (let i = 0; i < list.length; i += 1) if (t >= list[i].inMs && t < list[i].outMs) return i;
    return t >= (list[list.length - 1] || {}).outMs ? list.length - 1 : 0;
  }
  function frameAt(timeline, tMs) {
    const t = Math.max(0, Math.min(timeline.durationMs - 1, tMs));
    const shots = timeline.tracks.video;
    const si = findIndex(shots, t);
    const shot = shots[si];
    const prev = si > 0 ? shots[si - 1] : null;
    const mix = prev && shot ? ease.inOutSine(progress(t, shot.inMs, XFADE_MS)) : 1;
    const gi = findIndex(timeline.tracks.graphics, t);
    const graphic = timeline.tracks.graphics[gi] || null;
    const gLocal = graphic ? t - graphic.inMs : 0;
    const gLeft = graphic ? graphic.outMs - t : 0;
    const isLast = gi === timeline.tracks.graphics.length - 1;
    const words = timeline.tracks.captions.words;
    const cards = timeline.tracks.captions.cards;
    const card = cards.find(c => t >= c.s && t < c.e) || null;
    let active = -1;
    if (card) {
      card.words.forEach(i => { if (t >= words[i].s) active = i; });
    }
    const music = timeline.tracks.audio.find(a => a.kind === 'music');
    // Styled engines move between beats with the style's transition (push,
    // wipe, lift); the outgoing beat is drawn whole until it has left, so it
    // does not fade first. Classic keeps its 180 ms fade and photo cross-fade.
    const st = styleOf(timeline);
    const pushes = st.engine !== 'classic' && ['slide', 'wipe', 'flip', 'slab'].includes(st.motion.transition);
    const trMs = st.motion.transitionMs || 0;
    let transition = null;
    if (pushes && graphic && gi > 0 && gLocal < trMs) {
      const from = timeline.tracks.graphics[gi - 1];
      const fromShots = shots.filter(s => s.beat === from.beat);
      const fromShot = fromShots[fromShots.length - 1] || null;
      transition = {
        kind: st.motion.transition, p: progress(gLocal, 0, trMs),
        from: { ...from, local: from.outMs - from.inMs + gLocal, exit: 0 },
        fromShot: fromShot ? { ...fromShot, local: fromShot.outMs - fromShot.inMs, p: 1 } : null,
      };
    }
    return {
      t,
      shot: shot ? { ...shot, local: t - shot.inMs, p: progress(t, shot.inMs, shot.outMs - shot.inMs) } : null,
      prev: prev && mix < 1 ? { ...prev, local: t - prev.inMs, p: progress(t, prev.inMs, prev.outMs - prev.inMs) } : null,
      mix,
      graphic: graphic ? { ...graphic, local: gLocal, exit: isLast || pushes ? 0 : 1 - clamp01(gLeft / 180) } : null,
      transition,
      beatIndex: gi,
      caption: card ? { ...card, active, local: t - card.s } : null,
      musicDb: music ? musicGainDbAt(music.envelope, t) : null,
    };
  }

  // ─── Layout (static positions; the draw step animates them) ───────────
  function wrap(measure, text, fontStr, maxWidth) {
    const list = String(text || '').split(/\s+/).filter(Boolean);
    const space = measure(' ', fontStr);
    const lines = [];
    let line = [];
    let width = 0;
    list.forEach(word => {
      const w = measure(word, fontStr);
      if (line.length && width + space + w > maxWidth) { lines.push({ words: line, width }); line = []; width = 0; }
      line.push({ text: word, x: line.length ? width + space : 0, w });
      width = line.length > 1 ? width + space + w : w;
    });
    if (line.length) lines.push({ words: line, width });
    return lines;
  }
  // The biggest size (from max down to min) that fits in maxLines.
  function fitText(measure, text, { family = CONDENSED, weight = 700, max, min, maxLines, width = COL, step = 0.94 }) {
    let size = max;
    let lines = wrap(measure, text, font(weight, size, family), width);
    while ((lines.length > maxLines || lines.some(l => l.width > width)) && size > min) {
      size = Math.max(min, size * step);
      lines = wrap(measure, text, font(weight, size, family), width);
    }
    return { size, lines, font: font(weight, size, family) };
  }
  const isEmph = (word, emphasis) => {
    if (!emphasis) return false;
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9%$]/g, '');
    const targets = String(emphasis).split(/\s+/).map(norm).filter(Boolean);
    return targets.includes(norm(word));
  };

  // A block of lines → ops, top at `top`, left-aligned at MARGIN.
  function linesOps(fit, top, { lineHeight = 0.96, color = WHITE, emphasis = '', role = 'text', upper = true, align = 'left', delayStep = 50, baseDelay = 0 }) {
    const ops = [];
    let y = top + fit.size * CAP;
    let n = 0;
    fit.lines.forEach(line => {
      const x0 = align === 'center' ? (W - line.width) / 2 : MARGIN;
      line.words.forEach(word => {
        const text = upper ? word.text.toUpperCase() : word.text;
        ops.push({ type: 'word', role, text, font: fit.font, size: fit.size, x: x0 + word.x, y, w: word.w, color, lit: isEmph(word.text, emphasis), delay: baseDelay + n * delayStep });
        n += 1;
      });
      y += fit.size * lineHeight;
    });
    const height = fit.size * CAP + (fit.lines.length - 1) * fit.size * lineHeight;
    return { ops, height, bottom: top + height };
  }
  const upperMeasure = measure => (text, f) => measure(String(text).toUpperCase(), f);
  const ES_TEMPLATES = new Set(['es-hook', 'es-statement', 'es-number', 'es-dots', 'es-compare', 'es-quote', 'es-endcard', 'es-photoCard', 'es-statTiles', 'es-dotGrid', 'es-streak', 'es-rankTile', 'es-tagPill', 'es-clipLabel']);

  // Ops for one graphic. Boxes: every op has x, y (baseline), w, size, so a
  // box is [x, y - size*CAP, w, size*CAP] (what the lint checks against SAFE).
  // An ES block scene always knows its block: a story beat inside a data
  // format (or an older saved timeline) gets it from the beat's own fields.
  function esGraphic(graphic) {
    if (graphic.data && graphic.data.block) return graphic;
    const kind = graphic.kind || { 'es-hook': 'hook', 'es-endcard': 'cta', 'es-number': 'stat', 'es-dots': 'dotrank', 'es-compare': 'bars', 'es-quote': 'quote' }[graphic.template] || 'point';
    return { ...graphic, data: { ...(graphic.data || {}), block: getES().blockOf({ ...(graphic.data || {}), kind }) } };
  }
  function layoutGraphic(measure, graphic, timeline = {}) {
    if (ES_TEMPLATES.has(graphic.template) && getES()) return getES().layoutBlock(measure, esGraphic(graphic), timeline);
    if (SLIDE_TEMPLATES.has(graphic.template)) return layoutSlide(measure, graphic, { style: 'classic', tracks: { video: [] }, beats: [], ...timeline });
    if (S.LAYOUTS.includes(graphic.template) && graphic.template !== 'legacy') return layoutStyled(measure, graphic, { style: 'classic', tracks: { video: [] }, beats: [], ...timeline });
    const d = graphic.data || {};
    const m = upperMeasure(measure);
    const ops = [];
    const bottom = ZONE.graphicBottom;
    const tag = timeline.tag || '';
    if (graphic.template === 'hook') {
      const fit = fitText(m, d.text, { max: 150, min: 92, maxLines: 4 });
      const block = fit.size * CAP + (fit.lines.length - 1) * fit.size * 0.94;
      const pillH = 58;
      const top = Math.max(ZONE.graphicTop + pillH + 28, bottom - block);
      if (tag) ops.push({ type: 'pill', role: 'tag', text: tag, font: font(700, 30, BODY), size: 30, x: MARGIN, y: top - 28 - pillH, h: pillH, w: measure(tag, font(700, 30, BODY)) + 44, delay: 0 });
      ops.push(...linesOps(fit, top, { lineHeight: 0.94, emphasis: d.emphasis, delayStep: 40 }).ops);
    } else if (graphic.template === 'stat') {
      const value = String(d.stat?.value || d.text || '');
      const numFit = fitText(measure, value, { max: 360, min: 160, maxLines: 1 });
      const label = String(d.stat?.label || '').toUpperCase();
      const labelFit = label ? fitText(m, label, { max: 86, min: 56, maxLines: 1 }) : null;
      const line = d.text && d.text !== value && !new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(d.text) ? fitText(measure, d.text, { family: BODY, weight: 600, max: 48, min: 38, maxLines: 2 }) : null;
      const gapBar = 34;
      const heights = [numFit.size * CAP, labelFit ? gapBar + 12 + gapBar + labelFit.size * CAP : 0, line ? 40 + line.size * CAP + (line.lines.length - 1) * line.size * 1.2 : 0];
      const total = heights.reduce((a, b) => a + b, 0);
      let y = Math.max(ZONE.graphicTop + 150, bottom - total);
      if (timeline.team && timeline.team.name) ops.push({ type: 'logo', role: 'team', x: MARGIN, y: y - 150, w: 112, h: 112, delay: 0 });
      ops.push({ type: 'count', role: 'number', text: value, spec: parseStatValue(value), font: numFit.font, size: numFit.size, x: MARGIN, y: y + numFit.size * CAP, w: numFit.lines[0] ? numFit.lines[0].width : 0, color: WHITE, delay: 80 });
      y += numFit.size * CAP;
      if (labelFit) {
        ops.push({ type: 'bar', role: 'bar', x: MARGIN, y: y + gapBar, w: 140, h: 12, delay: 260 });
        y += gapBar + 12 + gapBar;
        ops.push({ type: 'word', role: 'label', text: label, font: labelFit.font, size: labelFit.size, x: MARGIN, y: y + labelFit.size * CAP, w: labelFit.lines[0] ? labelFit.lines[0].width : 0, color: WHITE, delay: 300 });
        y += labelFit.size * CAP;
      }
      if (line) ops.push(...linesOps(line, y + 40, { lineHeight: 1.2, upper: false, role: 'line', color: 'rgba(255,255,255,0.88)', baseDelay: 420, delayStep: 0 }).ops);
    } else if (graphic.template === 'rank') {
      const rank = d.rank || 0;
      const name = d.name || d.text;
      const nameFit = fitText(m, name, { max: 120, min: 76, maxLines: 2 });
      const detail = d.detail || (d.name && d.text !== d.name ? d.text : '');
      const detailFit = detail ? fitText(measure, detail, { family: BODY, weight: 500, max: 46, min: 38, maxLines: 2 }) : null;
      const numSize = 300;
      const nameH = nameFit.size * CAP + (nameFit.lines.length - 1) * nameFit.size * 0.96;
      const detailH = detailFit ? 36 + detailFit.size * CAP + (detailFit.lines.length - 1) * detailFit.size * 1.22 : 0;
      const top = Math.max(ZONE.graphicTop + 90, bottom - (numSize * CAP + 40 + nameH + detailH));
      ops.push({ type: 'dots', role: 'countdown', rank, x: MARGIN, y: top - 70, w: 5 * 44, h: 28, delay: 0 });
      ops.push({ type: 'word', role: 'rank', text: `#${rank}`, font: font(700, numSize, CONDENSED), size: numSize, x: MARGIN - 6, y: top + numSize * CAP, w: measure(`#${rank}`, font(700, numSize, CONDENSED)), color: 'HIGHLIGHT', delay: 0, pop: true });
      const nameBlock = linesOps(nameFit, top + numSize * CAP + 40, { lineHeight: 0.96, delayStep: 45, baseDelay: 160 });
      ops.push(...nameBlock.ops);
      if (detailFit) ops.push(...linesOps(detailFit, nameBlock.bottom + 36, { lineHeight: 1.22, upper: false, role: 'line', color: 'rgba(255,255,255,0.86)', baseDelay: 380, delayStep: 0 }).ops);
    } else if (graphic.template === 'quote') {
      const q = d.quote?.text || d.text;
      const fit = fitText(measure, q, { max: 96, min: 62, maxLines: 6 });
      const by = d.quote?.by ? `— ${d.quote.by}` : '';
      const block = 150 + fit.size * CAP + (fit.lines.length - 1) * fit.size * 1.04 + (by ? 70 : 0);
      const top = Math.max(ZONE.graphicTop + 40, bottom - block);
      ops.push({ type: 'mark', role: 'quote-mark', x: MARGIN - 4, y: top + 120, size: 260, delay: 0 });
      const body = linesOps(fit, top + 150, { lineHeight: 1.04, upper: false, emphasis: d.emphasis, delayStep: 28, baseDelay: 120 });
      ops.push(...body.ops);
      if (by) ops.push({ type: 'word', role: 'byline', text: by.toUpperCase(), font: font(700, 38, BODY), size: 38, x: MARGIN, y: body.bottom + 70, w: measure(by.toUpperCase(), font(700, 38, BODY)), color: 'rgba(255,255,255,0.9)', delay: 500 });
    } else if (graphic.template === 'cta') {
      const fit = fitText(m, d.text, { max: 120, min: 80, maxLines: 3 });
      const block = fit.size * CAP + (fit.lines.length - 1) * fit.size * 0.96;
      const top = Math.round((ZONE.graphicTop + bottom) / 2 - block / 2 + 20);
      ops.push({ type: 'bar', role: 'rule', x: (W - 120) / 2, y: top - 72, w: 120, h: 10, delay: 0 });
      ops.push(...linesOps(fit, top, { lineHeight: 0.96, emphasis: d.emphasis, align: 'center', delayStep: 45, baseDelay: 140 }).ops);
      // The official wordmark (not type set to look like it).
      const wm = wordmarkFor(timeline);
      ops.push({ type: 'wordmark', role: 'wordmark', brand: wm.id, x: (W - wm.w) / 2, y: top + block + 72, w: wm.w, h: wm.h, delay: 420 });
    } else {
      const fit = fitText(m, d.text, { max: 116, min: 78, maxLines: 4 });
      const block = fit.size * CAP + (fit.lines.length - 1) * fit.size * 0.96;
      const top = Math.max(ZONE.graphicTop + 90, bottom - block);
      if (d.label) ops.push({ type: 'pill', role: 'label', outline: true, text: d.label, font: font(700, 28, BODY), size: 28, x: MARGIN, y: top - 34 - 54, h: 54, w: measure(d.label, font(700, 28, BODY)) + 40, delay: 0 });
      ops.push(...linesOps(fit, top, { lineHeight: 0.96, emphasis: d.emphasis, delayStep: 45, baseDelay: 80 }).ops);
    }
    return ops;
  }

  function layoutCaption(measure, card, timeline) {
    if (timeline.captionStyle === 'es' && getES()) return getES().layoutCaption(measure, card, timeline);
    if (timeline.captionStyle === 'block') return layoutBlockCaption(measure, card, timeline);
    const words = timeline.tracks.captions.words;
    const style = timeline.captionStyle;
    const list = card.words.map(i => ({ i, text: words[i].w.replace(/^[“"]|[”"]$/g, '') }));
    if (style === 'box') {
      const fit = fitText(measure, list.map(w => w.text).join(' '), { family: BODY, weight: 700, max: 56, min: 44, maxLines: 2, width: CAPTION_W - 60 });
      const lineH = fit.size * 1.18;
      const ops = [];
      let k = 0;
      const blockH = fit.size * CAP + (fit.lines.length - 1) * lineH;
      const top = ZONE.captionBaseline - blockH;
      fit.lines.forEach((line, li) => {
        const x0 = (W - line.width) / 2;
        line.words.forEach(word => { ops.push({ type: 'cword', i: list[k].i, text: word.text, font: fit.font, size: fit.size, x: x0 + word.x, y: top + fit.size * CAP + li * lineH, w: word.w }); k += 1; });
      });
      const widest = Math.max(...fit.lines.map(l => l.width));
      return { style, ops, box: { x: (W - widest) / 2 - 30, y: top - 26, w: widest + 60, h: blockH + 52 } };
    }
    const m = upperMeasure(measure);
    const fit = fitText(m, list.map(w => w.text).join(' '), { max: 96, min: 64, maxLines: 2, width: CAPTION_W });
    const ops = [];
    let k = 0;
    const lineH = fit.size * 1.0;
    const blockH = fit.size * CAP + (fit.lines.length - 1) * lineH;
    fit.lines.forEach((line, li) => {
      const x0 = (W - line.width) / 2;
      line.words.forEach(word => { ops.push({ type: 'cword', i: list[k].i, text: word.text.toUpperCase(), font: fit.font, size: fit.size, x: x0 + word.x, y: ZONE.captionBaseline - blockH + fit.size * CAP + li * lineH, w: word.w }); k += 1; });
    });
    return { style, ops, box: null };
  }

  // Boxes of every text op in the reel (for the safe-zone lint).
  function textBoxes(measure, timeline) {
    // ES: hug boxes, tilted stamps and one-line captions (reel-es.js).
    if (isEs(timeline)) return getES().textBoxes(measure, timeline, layoutGraphic);
    const boxes = [];
    timeline.tracks.graphics.forEach(g => layoutGraphic(measure, g, timeline).forEach(op => {
      if (op.type === 'word' || op.type === 'count' || op.type === 'pill' || op.type === 'text') {
        const top = op.type === 'pill' ? op.y : op.y - op.size * CAP;
        boxes.push({ beat: g.beat, role: op.role, text: op.text, x: op.x, y: top, w: op.w, h: op.type === 'pill' ? op.h : op.size * CAP });
      }
    }));
    timeline.tracks.captions.cards.forEach(card => {
      const cap = layoutCaption(measure, card, timeline);
      cap.ops.forEach(op => boxes.push({ beat: card.beat, role: 'caption', text: op.text, x: op.x, y: op.y - op.size * CAP, w: op.w, h: op.size * CAP }));
    });
    return boxes;
  }

  // Every drawn box (text, panels, visuals, chrome) of the reel: the tests
  // check all of them sit inside the safe zone in every style.
  function allBoxes(measure, timeline) {
    const out = [];
    const add = (beat, op) => {
      if (op.noBox || op.type === 'media') return;
      if (op.type === 'word' || op.type === 'count' || op.type === 'text') out.push({ beat, role: op.role, text: op.text, x: op.x, y: op.y - op.size * CAP, w: op.w, h: op.size * CAP });
      else if (op.type === 'dotring') out.push({ beat, role: op.role, x: op.cx - op.r1 - 3, y: op.cy - op.r1 - 3, w: op.r1 * 2 + 6, h: op.r1 * 2 + 6 });
      else if (op.w != null && op.h != null && op.type !== 'mark') out.push({ beat, role: op.role, x: op.x, y: op.y, w: op.w, h: op.h });
    };
    timeline.tracks.graphics.forEach((g, i) => {
      layoutGraphic(measure, g, timeline).forEach(op => add(g.beat, op));
      layoutChrome(measure, timeline, { beatIndex: i, graphic: g }).forEach(op => add(g.beat, op));
    });
    timeline.tracks.captions.cards.forEach(card => {
      const cap = layoutCaption(measure, card, timeline);
      if (cap.style === 'es' && cap.box) { out.push({ beat: card.beat, role: 'caption', text: cap.ops.map(o => o.text).join(' '), ...cap.box }); return; }
      cap.ops.forEach(op => out.push({ beat: card.beat, role: 'caption', text: op.text, x: op.box ? op.box.x : op.x, y: op.box ? op.box.y : op.y - op.size * CAP, w: op.box ? op.box.w : op.w, h: op.box ? op.box.h : op.size * CAP }));
    });
    return out;
  }

  // ─── Drawing ────────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    if (VA && VA.roundRect) return VA.roundRect(ctx, x, y, w, h, r);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    return undefined;
  }

  // ─── ES brand drawing ───────────────────────────────────────────────────
  const brandPaths = {};
  function brandPath(id) {
    if (typeof Path2D === 'undefined' || !BRAND[id]) return null;
    if (!brandPaths[id]) brandPaths[id] = new Path2D(BRAND[id].d);
    return brandPaths[id];
  }
  // Guideline colourways (BL-02): box colour, type colour.
  const MARK_COLOURS = { blue: ['#0A7DFA', '#FFFFFF'], black: ['#000000', '#FFFFFF'] };
  // Black when what sits under the mark is ES blue (or a blue close to it,
  // where the blue box would vanish); blue everywhere else.
  function markVariant(bg) {
    if (!HEX6.test(String(bg || ''))) return 'blue';
    return contrast(bg, '#0A7DFA') < 1.6 ? 'black' : 'blue';
  }
  // Draws an official brand vector (mark, wordmark, golf) in a box. Without
  // Path2D (Node tests) it falls back to the loaded image of the same file.
  function drawBrand(ctx, id, x, y, w, h, variant = 'blue', env = {}, alpha = 1) {
    const art = BRAND[id];
    if (!art) return false;
    const [box, type] = id === 'golf' ? [art.box, '#FFFFFF'] : (MARK_COLOURS[variant] || MARK_COLOURS.blue);
    const path = brandPath(id);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    if (path) {
      ctx.translate(x, y);
      ctx.scale(w / art.w, h / art.h);
      ctx.fillStyle = box;
      ctx.fillRect(0, 0, art.w, art.h);
      ctx.fillStyle = type;
      ctx.fill(path);
      ctx.restore();
      return true;
    }
    const img = env.images && env.images[id === 'mark' ? 'logo:es' : `logo:${id}`];
    const ok = Boolean(mediaSize(img));
    if (ok) ctx.drawImage(img, x, y, w, h);
    ctx.restore();
    return ok;
  }
  // The wordmark for the end card: Essentially Golf on golf reels, else ES.
  function wordmarkFor(timeline) {
    const id = timeline && timeline.sport === 'golf' ? 'golf' : 'wordmark';
    const art = BRAND[id];
    return { id, w: WORDMARK.w, h: Math.round((WORDMARK.w * art.h) / art.w) };
  }

  // ─── Visuals: photo, AI scene, upload, clip, team tile, designed bg ─────
  function mediaSize(m) {
    if (!m) return null;
    const w = m.videoWidth || m.naturalWidth || m.width;
    const h = m.videoHeight || m.naturalHeight || m.height;
    return w && h ? [w, h] : null;
  }
  // Cover-crop media into a rect with a zoom around a focus point.
  function drawCover(ctx, media, x, y, w, h, { zoom = 1, fx = 0.5, fy = 0.4 } = {}) {
    const size = mediaSize(media);
    if (!size) return false;
    const [sw, sh] = size;
    const scale = Math.max(w / sw, h / sh) * zoom;
    const cw = w / scale;
    const ch = h / scale;
    const cx = Math.max(0, Math.min(sw - cw, sw * fx - cw / 2));
    const cy = Math.max(0, Math.min(sh - ch, sh * fy - ch / 2));
    ctx.drawImage(media, cx, cy, cw, ch, x, y, w, h);
    return true;
  }
  // The clip time to show for a shot at its local time (looping a short clip).
  function clipTime(shot, localMs) {
    if (!shot || !shot.clip) return 0;
    const span = Math.max(0.5, shot.clip.durSec - shot.clip.inSec);
    return shot.clip.inSec + ((Math.max(0, localMs) / 1000) % span);
  }
  // Which clips must show which source time at t (the page seeks or syncs
  // its <video> elements to these before drawing; export awaits each seek).
  function clipTimes(timeline, tMs) {
    const f = frameAt(timeline, tMs);
    const out = [];
    [f.shot, f.prev].forEach(shot => { if (shot && shot.clip && shot.asset) out.push({ asset: shot.asset, time: clipTime(shot, shot.local) }); });
    return out;
  }
  // A team graphic: the logo on a team-colour field with a diagonal texture.
  function drawTile(ctx, asset, x, y, w, h, env, t) {
    const colors = (asset.colors || []).filter(c => HEX6.test(String(c)));
    const a = colors[0] || '#0A2342';
    const b = colors[1] || a;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, a);
    g.addColorStop(1, b === a ? '#000000' : b);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 6;
    const shift = ((t || 0) / 40) % 48;
    ctx.beginPath();
    for (let k = -h; k < w + h; k += 48) { ctx.moveTo(x + k + shift, y); ctx.lineTo(x + k + shift - h, y + h); }
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.stroke();
    ctx.restore();
    const logo = env.images && asset.logo ? env.images[asset.logo] : null;
    if (mediaSize(logo)) {
      const [lw, lh] = mediaSize(logo);
      const s = Math.min(w, h) * 0.5 * (1 + 0.03 * Math.sin((t || 0) / 900));
      const k = Math.min(s / lw, s / lh);
      ctx.drawImage(logo, x + (w - lw * k) / 2, y + (h - lh * k) / 2, lw * k, lh * k);
    }
  }
  // The style's designed motion background (fill-chain step 4, an explicit
  // choice: asset kind 'design').
  function drawDesigned(ctx, timeline, x, y, w, h, tMs, env) {
    const colors = timeline.team && timeline.team.colors.length ? timeline.team.colors : ['#0A2342', ES_BLUE];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    VA.drawGenerated(ctx, w, h, { colors, t: tMs / 1000, duration: 14, grain: env.grain || null });
    ctx.restore();
  }
  // Draws one visual into a rect. Nothing chosen yet: plain black (owner's
  // call), never a made-up background.
  function drawVisual(ctx, assetId, rect, timeline, env, { p = 0, local = 0, shot = null, motion = null, tMs = 0 } = {}) {
    const { x, y, w, h } = rect;
    const asset = assetId ? timeline.assets[assetId] : null;
    if (!asset) { ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h); return 'empty'; }
    if (asset.kind === 'design') { drawDesigned(ctx, timeline, x, y, w, h, tMs, env); return 'design'; }
    if (asset.kind === 'tile') { drawTile(ctx, asset, x, y, w, h, env, tMs); return 'tile'; }
    const m = motion || { from: 1, to: 1.06, focus: [0.5, 0.38], drift: [0, 0] };
    const e = ease.inOutSine(p);
    const zoom = (m.from || 1) + ((m.to || 1.06) - (m.from || 1)) * e;
    const fx = Math.max(0.05, Math.min(0.95, (m.focus || [0.5])[0] + ((m.drift || [0])[0] || 0) * e));
    const fy = Math.max(0.05, Math.min(0.95, (m.focus || [0.5, 0.38])[1] + ((m.drift || [0, 0])[1] || 0) * e));
    if (asset.kind === 'clip') {
      const vid = env.videos ? env.videos[assetId] : null;
      if (vid && (vid.readyState || 0) >= 2 && drawCover(ctx, vid, x, y, w, h, { zoom, fx, fy })) return 'clip';
      const poster = env.images ? env.images[assetId] : null;
      if (drawCover(ctx, poster, x, y, w, h, { zoom, fx, fy })) return 'clip';
      ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h);
      return 'clip-loading';
    }
    const img = env.images ? env.images[assetId] : null;
    if (drawCover(ctx, img, x, y, w, h, { zoom, fx, fy })) return asset.kind || 'photo';
    ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h);
    return 'loading';
  }

  function drawShot(ctx, shot, timeline, env, alpha) {
    if (!shot) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawVisual(ctx, shot.asset, { x: 0, y: 0, w: W, h: H }, timeline, env, { p: shot.p, local: shot.local, motion: shot.motion, tMs: shot.inMs + shot.local });
    ctx.restore();
  }

  function drawGrade(ctx, timeline) {
    // Team tint (light), top shade for the ES mark, deep bottom for type.
    const tint = timeline.team && timeline.team.colors[0] ? VA.tintLayers({ color: timeline.team.colors[0], amount: 0.18 }) : [];
    tint.forEach(layer => { ctx.save(); ctx.globalCompositeOperation = layer.mode; ctx.globalAlpha = layer.alpha; ctx.fillStyle = layer.color; ctx.fillRect(0, 0, W, H); ctx.restore(); });
    const top = ctx.createLinearGradient(0, 0, 0, 520);
    top.addColorStop(0, 'rgba(8,10,14,0.62)');
    top.addColorStop(1, 'rgba(8,10,14,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, 520);
    const bottom = ctx.createLinearGradient(0, 640, 0, H);
    bottom.addColorStop(0, 'rgba(8,10,14,0)');
    bottom.addColorStop(0.38, 'rgba(8,10,14,0.62)');
    bottom.addColorStop(1, 'rgba(8,10,14,0.92)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 640, W, H - 640);
  }

  // No glow on text (ES video system, banned): a soft blurred shadow read as
  // glow, so type is flat; the photo grade keeps it legible.
  function textShadow(ctx) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  function drawGraphic(ctx, frame, timeline, env) {
    const g = frame.graphic;
    if (!g) return;
    if (S.LAYOUTS.includes(g.template)) { const st = S.get('classic'); drawStyledGraphic(ctx, frame, timeline, env, st, st.palette); return; }
    const ops = env.layoutCache ? env.layoutCache(g) : layoutGraphic(env.measure, g, timeline);
    const hl = timeline.highlight || ES_BLUE;
    const exitA = 1 - ease.outCubic(g.exit);
    const exitY = -18 * ease.outCubic(g.exit);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ops.forEach(op => {
      const local = g.local - (op.delay || 0);
      const dur = g.template === 'hook' ? 300 : 380;
      const p = ease.outCubic(progress(local, 0, dur));
      // Frame 0 of the reel is never empty: the hook's first words and pill start visible.
      const floor = g.template === 'hook' && g.inMs === 0 && (op.delay || 0) <= 80 ? 0.55 : 0;
      // Headline words rise out of their own line box (a mask, out-expo):
      // the kinetic-type entrance. Labels, pills and lines keep the soft rise.
      const masked = op.type === 'word' && op.role === 'text' && !op.lit;
      const e = masked ? Math.max(floor, ease.outExpo(progress(local, 0, 560))) : 0;
      let a = Math.max(floor, p) * exitA;
      if (masked) a = (local >= 0 || floor ? 1 : 0) * exitA;
      if (a <= 0.001) return;
      const dy = masked ? (1 - e) * op.size * 1.05 + exitY : (1 - Math.max(floor, p)) * 34 + exitY;
      ctx.save();
      if (masked) { ctx.beginPath(); ctx.rect(op.x - op.size * 0.2, op.y - op.size * (CAP + 0.2) + exitY, op.w + op.size * 0.4, op.size * (CAP + 0.44)); ctx.clip(); }
      ctx.globalAlpha = a;
      if (op.type === 'pill') {
        ctx.font = op.font;
        if (op.outline) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 3;
          roundRect(ctx, op.x, op.y + dy, op.w, op.h, op.h / 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = hl;
          roundRect(ctx, op.x, op.y + dy, op.w, op.h, op.h / 2);
          ctx.fill();
        }
        ctx.fillStyle = WHITE;
        ctx.fillText(op.text, op.x + (op.w - env.measure(op.text, op.font)) / 2, op.y + dy + op.h / 2 + op.size * 0.36);
      } else if (op.type === 'word') {
        ctx.font = op.font;
        if (op.lit) {
          const padX = op.size * 0.1;
          const reveal = ease.outQuint(progress(local - 60, 0, 320));
          ctx.fillStyle = hl;
          roundRect(ctx, op.x - padX, op.y + dy - op.size * CAP - op.size * 0.12, (op.w + padX * 2) * reveal, op.size * (CAP + 0.24), op.size * 0.08);
          ctx.fill();
        }
        textShadow(ctx, !op.lit);
        ctx.fillStyle = op.color === 'HIGHLIGHT' ? hl : op.color;
        let scale = 1;
        if (op.pop) scale = 0.86 + 0.14 * ease.outBack(progress(local, 0, 420));
        if (scale !== 1) {
          ctx.translate(op.x, op.y + dy);
          ctx.scale(scale, scale);
          ctx.fillText(op.text, 0, 0);
          if (op.color === 'HIGHLIGHT') { textShadow(ctx, false); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(op.text, 0, 0); }
        } else {
          ctx.fillText(op.text, op.x, op.y + dy);
        }
      } else if (op.type === 'count') {
        ctx.font = op.font;
        textShadow(ctx, true);
        ctx.fillStyle = WHITE;
        const c = ease.outQuint(progress(local, 0, 900));
        const text = op.spec ? formatStat(op.spec, op.spec.num * c) : op.text;
        ctx.fillText(text, op.x, op.y + dy);
      } else if (op.type === 'bar') {
        ctx.fillStyle = hl;
        roundRect(ctx, op.x, op.y + dy, op.w * ease.outQuint(progress(local, 0, 420)), op.h, op.h / 2);
        ctx.fill();
      } else if (op.type === 'dots') {
        for (let n = 5; n >= 1; n -= 1) {
          const i = 5 - n;
          const on = n === op.rank;
          const done = n > op.rank;
          ctx.fillStyle = on ? hl : (done ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.28)');
          roundRect(ctx, op.x + i * 44, op.y + dy, on ? 36 : 28, op.h, op.h / 2);
          ctx.fill();
        }
      } else if (op.type === 'mark') {
        ctx.font = font(700, op.size, CONDENSED);
        ctx.fillStyle = WHITE;
        ctx.fillText('“', op.x, op.y + dy + op.size * 0.12);
      } else if (op.type === 'logo') {
        // The team's real logo (logo library) on a white disc, or nothing: never a made-up badge.
        const img = env.images && env.images['logo:team'];
        if (img && (img.naturalWidth || img.width)) {
          ctx.fillStyle = WHITE;
          ctx.beginPath();
          ctx.arc(op.x + op.w / 2, op.y + dy + op.h / 2, op.w / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.drawImage(img, op.x + 12, op.y + dy + 12, op.w - 24, op.h - 24);
        }
      } else if (op.type === 'wordmark') {
        // Fades and rises in; never scaled or skewed.
        drawBrand(ctx, op.brand || 'wordmark', op.x, op.y + dy, op.w, op.h, 'blue', env, a);
      }
      ctx.restore();
    });
    ctx.restore();
  }

  function drawCaption(ctx, frame, timeline, env) {
    const card = frame.caption;
    if (!card) return;
    const layout = env.captionCache ? env.captionCache(card) : layoutCaption(env.measure, card, timeline);
    const hl = timeline.highlight || ES_BLUE;
    const appear = ease.outCubic(progress(card.local, 0, 140));
    ctx.save();
    ctx.globalAlpha = appear;
    const dy = (1 - appear) * 14;
    ctx.textBaseline = 'alphabetic';
    if (layout.box) {
      ctx.fillStyle = 'rgba(16,17,20,0.8)';
      roundRect(ctx, layout.box.x, layout.box.y + dy, layout.box.w, layout.box.h, 22);
      ctx.fill();
    }
    layout.ops.forEach(op => {
      const on = op.i === card.active;
      const spoken = op.i <= card.active;
      ctx.font = op.font;
      if (layout.style === 'box') {
        ctx.fillStyle = on ? '#9DCBFD' : (spoken ? WHITE : 'rgba(255,255,255,0.72)');
        ctx.fillText(op.text, op.x, op.y + dy);
        return;
      }
      const word = timeline.tracks.captions.words[op.i];
      const pop = on ? 1 + 0.06 * (1 - ease.outCubic(progress(frame.t - word.s, 0, 160))) : 1;
      ctx.save();
      ctx.translate(op.x + op.w / 2, op.y + dy - op.size * CAP / 2);
      ctx.scale(pop, pop);
      ctx.translate(-(op.x + op.w / 2), -(op.y + dy - op.size * CAP / 2));
      if (on) {
        const padX = op.size * 0.12;
        ctx.fillStyle = hl;
        roundRect(ctx, op.x - padX, op.y + dy - op.size * CAP - op.size * 0.14, op.w + padX * 2, op.size * (CAP + 0.28), op.size * 0.1);
        ctx.fill();
      }
      ctx.lineJoin = 'round';
      ctx.lineWidth = op.size * 0.12;
      ctx.strokeStyle = on ? 'rgba(0,0,0,0)' : 'rgba(8,10,14,0.75)';
      if (!on) ctx.strokeText(op.text, op.x, op.y + dy);
      ctx.fillStyle = WHITE;
      ctx.fillText(op.text, op.x, op.y + dy);
      ctx.restore();
    });
    ctx.restore();
  }

  // ─── The ES mark: the same size and place on every frame, drawn last ───
  // What is under the mark decides its colourway: the style's paper on the
  // designed styles, the picture itself on Classic (read once per shot from
  // the canvas, so a blue jersey or a blue team tile turns it black).
  const hex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  function markBackground(ctx, frame, timeline, env) {
    const style = styleOf(timeline);
    if (style.engine !== 'classic') return style.palette.paper;
    if (typeof ctx.getImageData !== 'function' || env.probeMark === false) return '#101114';
    const key = `${frame.shot ? frame.shot.id : ''}|${frame.shot && frame.shot.local > 400 ? 1 : 0}`;
    const cache = env.markCache || (env.markCache = new Map());
    if (cache.has(key)) return cache.get(key);
    let bg = '#101114';
    try {
      const data = ctx.getImageData(ES_MARK.x, ES_MARK.y, ES_MARK.w, ES_MARK.h).data;
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let i = 0; i < data.length; i += 64) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1; }
      if (n) bg = `#${hex2(r / n)}${hex2(g / n)}${hex2(b / n)}`;
    } catch { /* a tainted canvas: keep the default */ }
    if (cache.size > 400) cache.clear();
    cache.set(key, bg);
    return bg;
  }
  // The ES mark: an 80 px blue square with the official ES letters
  // (reel-es.js drawMark), in the guideline colourway for what is under it.
  function drawSquareMark(ctx, x, y, size, variant, env) {
    const E = getES();
    if (variant === 'black' || !E) {
      ctx.save();
      ctx.fillStyle = variant === 'black' ? '#000000' : '#0A7DFA';
      ctx.fillRect(x, y, size, size);
      const h = (size * BRAND.mark.h) / BRAND.mark.w;
      drawBrand(ctx, 'mark', x, y + (size - h) / 2, size, h, variant, env);
      ctx.restore();
      return;
    }
    E.drawMark(ctx, x, y, size, { BRAND, drawBrand }, env);
  }
  function drawEsMark(ctx, frame, timeline, env) {
    if (frame.graphic && !showsMark(timeline, frame.graphic)) return '';
    // An ES block scene has already drawn its own mark (reel-es.js drawScene).
    if (frame.graphic && ES_TEMPLATES.has(frame.graphic.template) && getES() && styleOf(timeline).engine === 'es') return 'blue';
    const variant = markVariant(markBackground(ctx, frame, timeline, env));
    drawSquareMark(ctx, ES_MARK.x, ES_MARK.y, ES_MARK.w, variant, env);
    return variant;
  }
  const END_TEMPLATES = new Set(['cta', 'endcard', 'es-endcard', 'slide-cta']);
  // The ES video system: the mark on the hook (the first scene) and the end card only.
  function showsMark(timeline, g) {
    if (!g) return false;
    if (isEs(timeline)) return getES().showsMark ? getES().showsMark(g) : getES().MARK_BLOCKS.has((g.data && g.data.block && g.data.block.type) || '');
    const list = (timeline && timeline.tracks && timeline.tracks.graphics) || [];
    return END_TEMPLATES.has(g.template) || g.inMs === 0 || g === list[0] || (list[0] && g.id === list[0].id);
  }
  // Where the brand sits (the lint and the tests read this): one entry per
  // beat that shows the mark (slides: every slide).
  function logoPlacements(timeline) {
    if (timeline && timeline.canvas && Number(timeline.canvas.h) === 1350) {
      return (timeline.tracks.graphics || []).map(g => ({ beat: g.beat, kind: 'mark', x: SLIDE_MARK.x, y: SLIDE_MARK.y, w: SLIDE_MARK.w, h: SLIDE_MARK.h, clear: SLIDE_MARK.clear, endcard: g.template === 'slide-cta', slide: true }));
    }
    const mk = isEs(timeline) ? getES().markRect(timeline.size) : ES_MARK;
    return (timeline.tracks.graphics || []).filter(g => showsMark(timeline, g)).map(g => ({
      beat: g.beat, kind: 'mark', x: mk.x, y: mk.y, w: mk.w, h: mk.h, clear: mk.clear,
      endcard: END_TEMPLATES.has(g.template),
    }));
  }

  // ─── Styled engine (explainer, series, countdown; components in classic) ─
  // One grid (v3): the ES frame from reel-es.js. The retired styles keep
  // their own caption band (captionTop / captionBottom) inside it.
  const G = (() => { const E = getES(); const g = E && E.GRID ? E.GRID : { unit: 8, left: 60, right: 1020, top: 300, bottom: 1640 }; return { unit: g.unit, left: g.left, right: g.right, top: g.top, bottom: g.bottom, captionTop: 1336, captionBottom: 1512 }; })();
  const CW = G.right - G.left; // 904
  const snap = v => Math.round(v / G.unit) * G.unit;
  const CHART_LAYOUTS = new Set(['stat-hero', 'bars', 'versus', 'dotrank', 'chips', 'tiles', 'roles', 'mystery']);
  const paletteOf = timeline => styleOf(timeline).palette;
  // Colour tokens ('ink', 'accent', 'hi'…) resolve against the palette; a team
  // colour or any CSS colour passes through.
  const tone = (pal, c) => (c && pal[c]) || c || pal.ink;

  // track: letter spacing in px (labels and chips read better a little open);
  // widths include it, so boxes stay honest.
  const tracked = (measure, t, f, track) => measure(t, f) + (track ? track * Math.max(0, t.length - 1) : 0);
  function textOp(measure, text, family, weight, size, x, y, { color = 'ink', role = 'text', upper = true, delay = 0, anim, bg, align = 'left', width, track = 0, refs = null } = {}) {
    const t = upper ? String(text).toUpperCase() : String(text);
    const f = font(weight, size, family);
    const w = tracked(measure, t, f, track);
    const x0 = align === 'center' ? (width != null ? x + (width - w) / 2 : x - w / 2) : (align === 'right' ? x - w : x);
    const op = { type: 'text', role, text: t, font: f, size, x: x0, y, w, color, delay, anim, bg, track };
    if (refs) op.refs = refs; // data formats: the refs a number on screen comes from
    return op;
  }
  function chipOp(measure, text, x, y, { fill = 'chip', ink = 'chipInk', size = 24, h = 44, role = 'chip', delay = 0, anim } = {}) {
    const t = String(text).toUpperCase();
    const f = font(700, size, S.LABEL);
    const track = Math.round(size * 0.06 * 10) / 10;
    const tw = tracked(measure, t, f, track);
    const padX = Math.round(h * 0.36);
    const w = tw + padX * 2;
    return [
      { type: 'rect', role: `${role}-bg`, x, y, w, h, fill, r: 3, delay, anim },
      { type: 'text', role, text: t, font: f, size, x: x + padX, y: y + h / 2 + size * 0.36, w: tw, color: ink, delay, anim, track },
    ];
  }
  // The logo's clear space (50 px round the mark): text lines that start
  // above its bottom edge stop short of its left edge.
  const LOGO_CLEAR = { left: ES_MARK.x - ES_MARK.clear, bottom: ES_MARK.y + ES_MARK.h + ES_MARK.clear };
  function wrapVar(measure, text, fontStr, widthAt) {
    const list = String(text || '').split(/\s+/).filter(Boolean);
    const space = measure(' ', fontStr);
    const lines = [];
    let line = [];
    let width = 0;
    list.forEach(word => {
      const w = measure(word, fontStr);
      if (line.length && width + space + w > widthAt(lines.length)) { lines.push({ words: line, width }); line = []; width = 0; }
      line.push({ text: word, x: line.length ? width + space : 0, w });
      width = line.length > 1 ? width + space + w : w;
    });
    if (line.length) lines.push({ words: line, width });
    return lines;
  }
  // The headline: up to 3 lines, tight leading; the emphasis word on a yellow
  // highlight (explainer, countdown) or in red (series; text after a colon
  // turns red). Each word rises out of a mask, one after another.
  const HEAD_LH = 0.94;
  function headlineOps(measure, d, top, style, { width = CW, maxLines = 3, align = 'left' } = {}) {
    const m = upperMeasure(measure);
    const [max, min] = style.type.headline;
    let size = max;
    let lines;
    const build = () => {
      const f = font(700, size, style.type.display);
      const widthAt = i => {
        const lineTop = top + i * size * HEAD_LH - size * 0.14;
        return align === 'left' && lineTop < LOGO_CLEAR.bottom ? Math.min(width, LOGO_CLEAR.left - G.left - size * 0.12) : width;
      };
      lines = wrapVar(m, d.text || '', f, widthAt);
      return lines.length <= maxLines && lines.every((l, i) => l.width <= widthAt(i));
    };
    while (!build() && size > min) size = Math.max(min, size * 0.95);
    const fit = { size, lines, font: font(700, size, style.type.display) };
    const ops = [];
    const lh = fit.size * HEAD_LH;
    let y = top + fit.size * CAP;
    let n = 0;
    const colon = style.emphasis === 'color' ? String(d.text || '').indexOf(':') : -1;
    let seenChars = 0;
    let litOnce = false;
    fit.lines.forEach(line => {
      const x0 = align === 'center' ? G.left + (width - line.width) / 2 : G.left;
      line.words.forEach(word => {
        // One highlighted word: the first match only.
        const lit = !litOnce && isEmph(word.text, d.emphasis);
        if (lit) litOnce = true;
        const afterColon = colon >= 0 && seenChars > colon;
        seenChars += word.text.length + 1;
        const red = style.emphasis === 'color' && (lit || afterColon);
        ops.push({ type: 'text', role: 'headline', text: word.text.toUpperCase(), font: fit.font, size: fit.size, x: x0 + word.x, y, w: word.w, color: red ? 'bad' : 'ink', bg: lit && style.emphasis !== 'color' ? 'hi' : '', bgInk: 'hiInk', delay: n * style.motion.stagger, anim: 'mask' });
        n += 1;
      });
      y += lh;
    });
    const bottom = top + fit.size * CAP + (fit.lines.length - 1) * lh;
    return { ops, bottom };
  }
  // A framed visual (photo, clip, tile…) in the style's frame.
  function visualOps(style, rect, { slot = 'shot', role = 'visual', cutout = false, cutoutAsset = '', delay = 80, round = false, label = '' } = {}, measure) {
    const ops = [];
    const frame = style.visual === 'card' ? 24 : 0;
    ops.push({ type: 'visual', role, slot, x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: round ? Math.min(rect.w, rect.h) / 2 : frame, cutout, cutoutAsset, delay, anim: style.motion.enter === 'flip' ? 'flip' : (style.motion.enter === 'wipe' ? 'wipe' : 'rise'), stroke: style.id === 'series' ? 'ink' : (round ? 'accent' : ''), lw: round ? 6 : 4 });
    if (style.id === 'explainer' && !round) ops.push({ type: 'rect', role: 'rule', x: rect.x, y: rect.y + rect.h + 8, w: rect.w, h: 8, fill: 'rule', delay: delay + 120, anim: 'grow' });
    if (label && measure) ops.push(...chipOp(measure, label, rect.x + 16, rect.y + 16, { fill: 'chip', ink: 'chipInk', size: 22, h: 40, role: 'visual-label', delay: delay + 160 }));
    return ops;
  }
  // Content box for a beat (below the headline, above the strip or captions).
  function contentBox(timeline, top) {
    const style = styleOf(timeline);
    const bottom = style.engine === 'classic' ? ZONE.graphicBottom : (timeline.strip ? 1168 : 1280);
    return { x: G.left, y: snap(top), w: CW, h: Math.max(160, bottom - snap(top)), bottom };
  }
  // The number in a value like "-$12.3M", "2×", "+50%", "#31" (NaN if none).
  const num = v => { const m = String(v == null ? '' : v).replace(/[$,]/g, '').replace('−', '-').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
  // Ink that reads on a colour: white when it clears 3:1 (large type), else near-black.
  const inkOn = hex => (HEX6.test(String(hex)) && contrast('#FFFFFF', hex) < 3 ? '#111214' : '#FFFFFF');
  // The reel's team colour when a label names that team (content, never
  // chrome), and only when it stands off the paper.
  function teamColour(timeline, label, paper) {
    const team = timeline && timeline.team;
    if (!team || !team.colors || !team.colors.length || !label) return '';
    const norm = v => String(v).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    const want = norm(label);
    const names = norm(team.name);
    if (!want.length || !want.some(w => names.includes(w))) return '';
    return team.colors.find(c => HEX6.test(String(c)) && contrast(c, paper) >= 1.8) || '';
  }

  function layoutStyled(measure, graphic, timeline) {
    if (DATA_TEMPLATES.has(graphic.template)) return layoutData(measure, graphic, timeline);
    const style = styleOf(timeline);
    const d = graphic.data || {};
    const ops = [];
    const layout = graphic.template;
    const top0 = style.engine === 'classic' ? 380 : 376;
    const head = layout === 'endcard' ? null : headlineOps(measure, layout === 'rank-card' && d.name ? { ...d, text: d.text || d.name } : d, top0, style, { maxLines: layout === 'headline-visual' ? 3 : 2 });
    if (head) ops.push(...head.ops);
    const box = contentBox(timeline, head ? head.bottom + 40 : top0);
    const st = style.motion.stagger;
    const L = style.type.labelSize;
    const delay0 = 200;
    if (layout === 'headline-visual' || layout === 'steps') {
      let y = box.y;
      if (layout === 'steps' && d.steps) {
        const cur = Math.max(0, Math.min(9, Number(d.steps.current) || 0));
        const tot = Math.max(1, Math.min(9, Number(d.steps.total) || 1));
        const chip = chipOp(measure, `${d.steps.label || 'STEP'} · STEP ${cur}/${tot}`, G.left, y, { fill: 'ink', ink: 'paper', size: 24, h: 44, role: 'steps', delay: delay0 });
        ops.push(...chip);
        const x0 = chip[0].x + chip[0].w + 16;
        for (let i = 0; i < tot; i += 1) ops.push({ type: 'rect', role: 'step-square', x: x0 + i * 52, y: y + 4, w: 36, h: 36, fill: i < cur ? 'accent' : 'line', r: 4, delay: delay0 + 60 + i * st, anim: 'pop' });
        y += 72;
      }
      const h = Math.min(box.bottom - y - (d.detail ? 96 : 24), 680);
      const label = d.label && style.engine !== 'classic' ? d.label : '';
      ops.push(...visualOps(style, { x: G.left, y, w: CW, h }, { cutout: style.cutout && graphic.index === 0, cutoutAsset: d.cutout || '', label, delay: graphic.index === 0 ? 0 : delay0 }, measure));
      if (d.detail) {
        const fit = fitText(measure, d.detail, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 6, maxLines: 2, width: CW });
        ops.push(...linesOps(fit, y + h + 40, { lineHeight: 1.2, upper: false, role: 'detail', color: 'muted', baseDelay: delay0 + 200, delayStep: 0 }).ops);
      }
    } else if (layout === 'stat-hero') {
      const value = String(d.stat?.value || '');
      const hasVisual = d.visual !== 'chart';
      const numW = hasVisual ? 480 : CW;
      const nf = fitText(measure, value, { family: style.type.display, weight: 700, max: style.type.stat[0], min: style.type.stat[1], maxLines: 1, width: numW });
      let y = box.y + nf.size * CAP;
      ops.push({ type: 'count', role: 'number', text: value, spec: parseStatValue(value), font: nf.font, size: nf.size, x: G.left, y, w: nf.lines[0] ? nf.lines[0].width : 0, color: 'accent', delay: delay0 });
      y += 32;
      if (d.stat?.label) {
        const lf = fitText(upperMeasure(measure), d.stat.label, { family: S.LABEL, weight: 700, max: L + 8, min: L - 6, maxLines: 1, width: numW });
        ops.push({ type: 'text', role: 'label', text: d.stat.label.toUpperCase(), font: lf.font, size: lf.size, x: G.left, y: y + lf.size * CAP, w: lf.lines[0] ? lf.lines[0].width : 0, color: 'ink', delay: delay0 + 160, anim: 'rise' });
        y += lf.size * CAP + 24;
      }
      if (d.detail) {
        const df = fitText(measure, d.detail, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 6, maxLines: 3, width: numW });
        const block = linesOps(df, y + 8, { lineHeight: 1.2, upper: false, role: 'detail', color: 'muted', baseDelay: delay0 + 260, delayStep: 0 });
        ops.push(...block.ops);
        y = block.bottom + 24;
      }
      if (hasVisual) ops.push(...visualOps(style, { x: G.left + 512, y: box.y, w: CW - 512, h: Math.min(560, box.h - 24) }, { delay: delay0 + 80 }, measure));
      if (d.chips) ops.push(...chipsOps(measure, d.chips, { x: G.left, y: Math.max(y + 16, box.y + Math.min(560, box.h - 24) + 40), w: CW, bottom: box.bottom }, style, delay0 + 400, false));
    } else if (layout === 'rank-card') {
      const rank = d.rank || 0;
      const cardH = Math.min(style.id === 'countdown' ? 640 : 520, box.h - 260);
      ops.push(...visualOps(style, { x: G.left, y: box.y, w: CW, h: cardH }, { delay: delay0 }, measure));
      const rs = style.id === 'countdown' ? 260 : 200;
      const rf = font(700, rs, style.type.display);
      ops.push({ type: 'text', role: 'rank', text: `#${rank}`, font: rf, size: rs, x: G.left + 24, y: box.y + cardH + rs * CAP * 0.45, w: measure(`#${rank}`, rf), color: style.theme === 'dark' ? 'hi' : 'accent', stroke: style.theme === 'dark' ? 'bg' : 'paper', delay: delay0 + 120, anim: 'pop' });
      const nameTop = box.y + cardH + rs * CAP * 0.45 + 32;
      if (d.name && d.name !== d.text) {
        const nf = fitText(upperMeasure(measure), d.name, { family: style.type.display, weight: 700, max: 88, min: 60, maxLines: 1, width: CW });
        ops.push(...linesOps(nf, nameTop, { role: 'name', color: 'ink', baseDelay: delay0 + 200 }).ops);
      } else if (d.detail) {
        const df = fitText(measure, d.detail, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 6, maxLines: 2, width: CW });
        ops.push(...linesOps(df, nameTop, { lineHeight: 1.2, upper: false, role: 'detail', color: 'muted', baseDelay: delay0 + 260, delayStep: 0 }).ops);
      }
    } else if (layout === 'quote') {
      const q = d.quote?.text || d.text;
      ops.push({ type: 'text', role: 'quote-mark', text: '“', font: font(700, 220, style.type.display), size: 220, x: G.left - 8, y: box.y + 150, w: 100, color: 'accent', delay: delay0, anim: 'pop' });
      const fit = fitText(measure, q, { family: style.type.display, weight: 700, max: 76, min: 50, maxLines: 6, width: CW });
      const body = linesOps(fit, box.y + 120, { lineHeight: 1.06, upper: false, role: 'quote', color: 'ink', baseDelay: delay0 + 100, delayStep: 24 });
      ops.push(...body.ops);
      if (d.quote?.by) {
        const by = `— ${d.quote.by}`;
        ops.push(...visualOps(style, { x: G.left, y: body.bottom + 40, w: 120, h: 120 }, { round: true, delay: delay0 + 400 }, measure));
        ops.push(textOp(measure, by, S.LABEL, 700, L, G.left + 144, body.bottom + 40 + 60 + L * 0.36, { role: 'byline', color: 'ink', delay: delay0 + 460, anim: 'rise' }));
      }
    } else if (layout === 'bars') {
      const bars = (d.bars || []).slice(0, 4);
      let y = box.y;
      if (d.detail) { ops.push(...chipOp(measure, d.detail.slice(0, 40), G.left, y, { fill: 'ink', ink: 'paper', size: 22, h: 40, role: 'bars-head', delay: delay0 })); y += 64; }
      const vals = bars.map(b => num(b.value)).filter(Number.isFinite);
      const max = Math.max(...vals.map(Math.abs), 1);
      const rowH = 104;
      const valueW = 220;
      bars.forEach((b, i) => {
        const v = Math.abs(num(b.value));
        const wBar = Math.round(240 + (CW - valueW - 240 - 24) * (Number.isFinite(v) ? v / max : 0.5));
        // The reel's team keeps its own colour (content, not chrome).
        const team = teamColour(timeline, b.label, style.palette.paper);
        const fill = team || (i === 0 ? 'accent' : 'ink');
        ops.push({ type: 'rect', role: 'bar', x: G.left, y, w: wBar, h: rowH - 24, fill, r: 4, delay: delay0 + i * 160, anim: 'grow' });
        const lf = fitText(upperMeasure(measure), b.label, { family: S.LABEL, weight: 700, max: 36, min: 24, maxLines: 1, width: wBar - 40 });
        ops.push({ type: 'text', role: 'bar-label', text: b.label.toUpperCase(), font: lf.font, size: lf.size, x: G.left + 20, y: y + (rowH - 24) / 2 + lf.size * 0.36, w: lf.lines[0] ? lf.lines[0].width : 0, color: team ? inkOn(team) : (i === 0 ? '#FFFFFF' : 'paper'), delay: delay0 + i * 160 + 120, anim: 'fade', track: 1 });
        const vf = fitText(measure, b.value, { family: style.type.display, weight: 700, max: 80, min: 48, maxLines: 1, width: valueW });
        ops.push({ type: 'count', role: 'bar-value', text: b.value, spec: parseStatValue(b.value), font: vf.font, size: vf.size, x: G.left + wBar + 24, y: y + (rowH - 24) / 2 + vf.size * 0.36, w: vf.lines[0] ? vf.lines[0].width : 0, color: i === 0 ? 'accent' : 'ink', delay: delay0 + i * 160 + 120, anim: 'rise', countMs: 700 });
        y += rowH;
      });
      if (box.bottom - y > 300) ops.push(...visualOps(style, { x: G.left, y: y + 24, w: CW, h: Math.min(480, box.bottom - y - 48) }, { delay: delay0 + 500 }, measure));
    } else if (layout === 'versus') {
      const list = (d.versus || []).slice(0, 3);
      const n = Math.max(1, list.length);
      const gap = 24;
      const cw = Math.floor((CW - gap * (n - 1)) / n);
      const vh = Math.min(400, box.h - 260);
      list.forEach((v, i) => {
        const x = G.left + i * (cw + gap);
        const dl = delay0 + i * 140;
        if (v.name === '?') {
          ops.push({ type: 'rect', role: 'mystery', x, y: box.y, w: cw, h: vh, fill: 'mystery', r: style.visual === 'card' ? 24 : 4, delay: dl, anim: 'flip' });
          ops.push(textOp(measure, '?', style.type.display, 700, 200, x, box.y + vh / 2 + 70, { role: 'mystery-mark', color: 'muted', align: 'center', width: cw, delay: dl + 100, anim: 'pop' }));
          return;
        }
        ops.push({ type: 'visual', role: 'headshot', slot: v.asset || '', x, y: box.y, w: cw, h: vh, r: style.visual === 'card' ? 24 : 0, delay: dl, anim: style.motion.enter === 'flip' ? 'flip' : 'rise', stroke: style.id === 'series' ? 'ink' : '', lw: 4 });
        const team = teamColour(timeline, v.name, style.palette.paper);
        ops.push(...chipOp(measure, v.name, x + 12, box.y + vh - 56, { fill: team || 'ink', ink: team ? inkOn(team) : 'paper', size: 24, h: 44, role: 'versus-name', delay: dl + 120 }));
        if (v.value) {
          const vf = fitText(measure, v.value, { family: style.type.display, weight: 700, max: style.type.cardValue[0], min: style.type.cardValue[1] - 16, maxLines: 1, width: cw });
          ops.push({ type: 'count', role: 'versus-value', text: v.value, spec: parseStatValue(v.value), font: vf.font, size: vf.size, x, y: box.y + vh + 24 + vf.size * CAP, w: vf.lines[0] ? vf.lines[0].width : 0, color: i === 0 ? 'accent' : 'ink', delay: dl + 200, anim: 'rise', countMs: 700 });
          if (v.note) {
            const nf = fitText(measure, v.note, { family: style.type.body, weight: 500, max: 26, min: 22, maxLines: 2, width: cw });
            ops.push(...linesOps(nf, box.y + vh + 24 + vf.size * CAP + 24, { lineHeight: 1.2, upper: false, role: 'versus-note', color: 'muted', baseDelay: dl + 260, delayStep: 0 }).ops);
          }
        }
      });
    } else if (layout === 'dotrank') {
      const r = d.dotrank || {};
      const total = Math.max(1, Math.round(num(r.total)) || 1);
      const rank = Math.max(1, Math.min(total, Math.round(num(r.rank)) || 1));
      const R1 = Math.min(340, (box.h - 120) / 2);
      const cx = W / 2;
      const cy = box.y + R1 + 8;
      const rr = 104 + (R1 - 104) * Math.sqrt(total > 1 ? (rank - 1) / (total - 1) : 0);
      ops.push({ type: 'dotring', role: 'dots', cx, cy, r0: 104, r1: R1, rr, n: Math.min(total, 1200), total, rank, x: cx - R1, y: cy - R1, w: R1 * 2, h: R1 * 2, delay: delay0 });
      ops.push({ type: 'visual', role: 'avatar', slot: 'shot', x: cx - 88, y: cy - 88, w: 176, h: 176, r: 88, stroke: 'accent', lw: 6, delay: delay0 + 200, anim: 'pop' });
      const callout = `#${r.rank}${r.label ? ` ${r.label}` : ''}`;
      const cf = font(700, 28, S.LABEL);
      const cwid = Math.min(CW, measure(callout.toUpperCase(), cf) + 32);
      const cxL = Math.min(G.right - cwid, cx + 104);
      // A leader line from the rank's place on its ring to the callout.
      ops.push({ type: 'line', role: 'leader', x1: cx, y1: cy - rr, x2: cxL, y2: cy - R1 + 40, color: 'bad', lw: 3, delay: delay0 + 820, anim: 'draw' });
      ops.push({ type: 'rect', role: 'callout-bg', x: cxL, y: cy - R1 - 8, w: cwid, h: 48, fill: 'bad', r: 4, delay: delay0 + 900, anim: 'pop' });
      ops.push({ type: 'text', role: 'callout', text: callout.toUpperCase(), font: cf, size: 28, x: cxL + 16, y: cy - R1 - 8 + 34, w: cwid - 32, color: '#FFFFFF', delay: delay0 + 900, anim: 'fade' });
      if (r.note) {
        const nf = fitText(measure, r.note, { family: style.type.body, weight: 500, max: 28, min: 22, maxLines: 2, width: CW });
        ops.push(...linesOps(nf, cy + R1 + 40, { lineHeight: 1.2, upper: false, role: 'dots-note', color: 'muted', baseDelay: delay0 + 600, delayStep: 0 }).ops);
      }
    } else if (layout === 'chips') {
      ops.push(...chipsOps(measure, d.chips || {}, { x: G.left, y: box.y, w: CW, bottom: box.bottom }, style, delay0, true));
    } else if (layout === 'tiles') {
      const list = (d.tiles || []).slice(0, 4);
      const cols = list.length <= 1 ? 1 : 2;
      const rows = Math.ceil(list.length / cols) || 1;
      const gap = 24;
      const tw = Math.floor((CW - gap * (cols - 1)) / cols);
      const th = Math.min(320, Math.floor((box.h - gap * (rows - 1)) / rows));
      list.forEach((t, i) => {
        const x = G.left + (i % cols) * (tw + gap);
        const y = box.y + Math.floor(i / cols) * (th + gap);
        const dl = delay0 + i * 120;
        ops.push({ type: 'rect', role: 'tile', x, y, w: tw, h: th, fill: t.colors[0] || 'panel', r: style.visual === 'card' ? 24 : 4, delay: dl, anim: style.motion.enter === 'flip' ? 'flip' : 'wipe' });
        if (t.asset) ops.push({ type: 'logo', role: 'tile-logo', slot: t.asset, x: x + tw - 128, y: y + 24, w: 104, h: 104, delay: dl + 80, anim: 'pop' });
        const nf = fitText(upperMeasure(measure), t.team, { family: style.type.display, weight: 700, max: 64, min: 40, maxLines: 1, width: tw - 48 });
        // White on dark team colours, ink on light ones (Steelers gold).
        const tInk = t.colors[0] ? inkOn(t.colors[0]) : '#FFFFFF';
        ops.push({ type: 'text', role: 'tile-name', text: t.team.toUpperCase(), font: nf.font, size: nf.size, x: x + 24, y: y + th - 104, w: nf.lines[0] ? nf.lines[0].width : 0, color: tInk, delay: dl + 120, anim: 'rise' });
        if (t.label) {
          const lf = fitText(measure, t.label, { family: style.type.body, weight: 500, max: 24, min: 20, maxLines: 1, width: tw - 48 });
          ops.push({ type: 'text', role: 'tile-label', text: t.label, font: lf.font, size: lf.size, x: x + 24, y: y + th - 64, w: lf.lines[0] ? lf.lines[0].width : 0, color: tInk === '#FFFFFF' ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,20,0.82)', delay: dl + 160, anim: 'fade' });
        }
        if (t.chip) ops.push(...chipOp(measure, t.chip, x + 24, y + 24, { fill: 'hi', ink: 'hiInk', size: 22, h: 40, role: 'tile-chip', delay: dl + 200 }));
      });
    } else if (layout === 'roles') {
      const list = (d.roles || []).slice(0, 4);
      const cols = list.length <= 1 ? 1 : 2;
      const rows = Math.ceil(list.length / cols) || 1;
      const gap = 16;
      const tw = Math.floor((CW - gap * (cols - 1)) / cols);
      const th = Math.min(340, Math.floor((box.h - gap * (rows - 1)) / rows));
      list.forEach((r, i) => {
        const x = G.left + (i % cols) * (tw + gap);
        const y = box.y + Math.floor(i / cols) * (th + gap);
        const dl = delay0 + i * 120;
        ops.push({ type: 'rect', role: 'role-card', x, y, w: tw, h: th, fill: r.tone, r: 4, delay: dl, anim: style.motion.enter === 'flip' ? 'flip' : 'wipe' });
        ops.push(textOp(measure, r.role, S.LABEL, 700, 36, x + 24, y + 56, { role: 'role', color: '#FFFFFF', delay: dl + 80, anim: 'fade' }));
        const vf = fitText(measure, r.value, { family: style.type.display, weight: 700, max: 132, min: 72, maxLines: 1, width: tw - 48 });
        ops.push({ type: 'text', role: 'role-value', text: r.value, font: vf.font, size: vf.size, x: x + 24, y: y + 72 + vf.size * CAP, w: vf.lines[0] ? vf.lines[0].width : 0, color: '#FFFFFF', delay: dl + 140, anim: 'pop' });
        if (r.note) ops.push(...chipOp(measure, r.note.slice(0, 28), x + 24, y + th - 64, { fill: 'ink', ink: 'paper', size: 20, h: 40, role: 'role-note', delay: dl + 220 }));
      });
    } else if (layout === 'mystery') {
      const h = Math.min(560, box.h - (d.detail ? 120 : 24));
      ops.push({ type: 'rect', role: 'mystery', x: G.left, y: box.y, w: CW, h, fill: 'mystery', r: style.visual === 'card' ? 24 : 4, delay: delay0, anim: 'flip' });
      ops.push(textOp(measure, '?', style.type.display, 700, 320, G.left, box.y + h / 2 + 112, { role: 'mystery-mark', color: 'muted', align: 'center', width: CW, delay: delay0 + 160, anim: 'pop' }));
      if (d.detail) {
        const df = fitText(measure, d.detail, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 6, maxLines: 2, width: CW });
        ops.push(...linesOps(df, box.y + h + 40, { lineHeight: 1.2, upper: false, role: 'detail', color: 'muted', baseDelay: delay0 + 300, delayStep: 0 }).ops);
      }
    } else if (layout === 'endcard') {
      // The question, centred, then the official wordmark (the corner mark
      // stays where it is on every frame).
      const head2 = headlineOps(measure, d, 700, style, { align: 'center', maxLines: 3 });
      ops.push({ type: 'rect', role: 'rule', x: (W - 120) / 2, y: 620, w: 120, h: 10, fill: 'accent', r: 2, delay: 0, anim: 'grow' });
      ops.push(...head2.ops);
      const wm = wordmarkFor(timeline);
      ops.push({ type: 'wordmark', role: 'wordmark', brand: wm.id, x: (W - wm.w) / 2, y: snap(head2.bottom + 88), w: wm.w, h: wm.h, delay: 380, anim: 'rise' });
    }
    // Every op gets the style's entrance unless the layout chose one.
    ops.forEach(op => { if (!op.anim) op.anim = style.motion.enter; });
    return ops;
  }
  // "1 IN 5": the fraction as type, then one square per item (up to 12).
  function chipsOps(measure, c, rect, style, delay, withVisual) {
    const ops = [];
    const filled = Math.round(num(c.filled));
    const total = Math.round(num(c.total));
    if (!(total >= 1) || !(filled >= 0)) return ops;
    const big = `${c.filled} IN ${c.total}`;
    const bf = font(700, 120, style.type.display);
    ops.push({ type: 'text', role: 'chips-big', text: big, font: bf, size: 120, x: rect.x, y: rect.y + 120 * CAP, w: measure(big, bf), color: 'accent', delay, anim: 'rise' });
    let y = rect.y + 120 * CAP + 32;
    if (total <= 12) {
      const gap = 12;
      const side = Math.min(152, Math.floor((rect.w - gap * (total - 1)) / total));
      for (let i = 0; i < total; i += 1) ops.push({ type: 'rect', role: 'chip-square', x: rect.x + i * (side + gap), y, w: side, h: side, fill: i < filled ? 'accent' : 'mystery', r: 4, delay: delay + 120 + i * 60, anim: 'pop' });
      y += side + 24;
    }
    if (c.label) {
      const lf = fitText(upperMeasure(measure), c.label, { family: S.LABEL, weight: 700, max: 32, min: 24, maxLines: 1, width: rect.w });
      ops.push({ type: 'text', role: 'chips-label', text: c.label.toUpperCase(), font: lf.font, size: lf.size, x: rect.x, y: y + lf.size * CAP, w: lf.lines[0] ? lf.lines[0].width : 0, color: 'ink', delay: delay + 400, anim: 'fade' });
      y += lf.size * CAP + 32;
    }
    if (withVisual && rect.bottom - y > 280) ops.push(...visualOps(style, { x: rect.x, y, w: rect.w, h: Math.min(520, rect.bottom - y - 24) }, { delay: delay + 300 }, measure));
    return ops;
  }

  // Chrome drawn on every frame: eyebrow, ES badge, series tag, data strip, rail.
  function layoutChrome(measure, timeline, frame) {
    const style = styleOf(timeline);
    // The ES mark (drawn last by drawEsMark; listed here for the boxes), on
    // the hook and the end card only (ES video system).
    const g0 = frame && frame.graphic;
    const mk = isEs(timeline) ? getES().markRect(timeline.size) : ES_MARK;
    const ops = !g0 || showsMark(timeline, g0) ? [{ type: 'esmark', role: 'es-mark', x: mk.x, y: mk.y, w: mk.w, h: mk.h }] : [];
    if (style.engine === 'classic' || isEs(timeline)) return ops;
    // Data beats own the top of the frame (scorebug, panel header, year rail).
    if (frame && frame.graphic && DATA_TEMPLATES.has(frame.graphic.template)) return ops;
    const c = style.chrome;
    const beside = LOGO_CLEAR.left - G.left; // the width left of the logo's clear space
    if (c.seriesTag && timeline.series) ops.push(...chipOp(measure, timeline.series.tag, G.left, G.top + 10, { fill: 'chip', ink: 'chipInk', size: 24, h: 44, role: 'series-tag' }));
    else if (c.eyebrow && (timeline.eyebrow || timeline.title)) {
      const t = String(timeline.eyebrow || timeline.title).toUpperCase();
      const fit = fitText(measure, t, { family: S.LABEL, weight: 700, max: style.type.eyebrow, min: 20, maxLines: 1, width: beside - 48 });
      const track = 1.5;
      const w = (fit.lines[0] ? fit.lines[0].width : 0) + track * Math.max(0, t.length - 1);
      // A short accent tick before the eyebrow, like a lower-third.
      ops.push({ type: 'rect', role: 'eyebrow-tick', x: G.left, y: G.top + 22, w: 24, h: 6, fill: 'accent', r: 1 });
      ops.push({ type: 'text', role: 'eyebrow', text: t, font: fit.font, size: fit.size, x: G.left + 36, y: G.top + 34, w: Math.min(w, beside - 84), color: 'muted', track });
    }
    if (c.rail) {
      const ranks = timeline.beats.filter(b => b.kind === 'rank').map(b => b.rank).sort((a, b) => b - a);
      const cur = frame && frame.graphic ? (timeline.beats[frame.beatIndex] || {}).rank : null;
      ranks.slice(0, 10).forEach((r, i) => {
        const on = r === cur;
        const done = cur != null && r > cur;
        ops.push({ type: 'rect', role: 'rail', x: G.left + i * 68, y: G.top + 8, w: 56, h: 48, fill: on ? 'hi' : 'panel', stroke: done ? 'hi' : '', lw: 2, r: 6 });
        ops.push(textOp(measure, `#${r}`, style.type.display, 700, 30, G.left + i * 68, G.top + 8 + 35, { role: 'rail-text', color: on ? 'hiInk' : (done ? 'hi' : 'muted'), align: 'center', width: 56, upper: false }));
      });
    }
    if (c.strip && timeline.strip) {
      const sp = timeline.strip;
      const y = 1192;
      ops.push({ type: 'rect', role: 'strip', x: G.left, y, w: CW, h: 104, fill: 'panel', stroke: 'ink', lw: 3, r: 4 });
      ops.push(textOp(measure, sp.label || '', S.LABEL, 700, 22, G.left + 24, y + 32, { role: 'strip-label', color: 'muted', track: 1.2 }));
      const vf = font(700, 60, style.type.display);
      ops.push({ type: 'count', role: 'strip-value', text: sp.value, spec: parseStatValue(sp.value), font: vf, size: 60, x: G.left + 24, y: y + 86, w: measure(sp.value, vf), color: sp.tone, delay: 0, once: true });
      const ratio = sp.of && Number.isFinite(num(sp.value)) && num(sp.of) ? Math.max(0, Math.min(1, Math.abs(num(sp.value)) / Math.abs(num(sp.of)))) : null;
      if (sp.note) ops.push(textOp(measure, sp.note, S.LABEL, 700, 20, G.left + 520, y + 32, { role: 'strip-note', color: 'muted', track: 1 }));
      ops.push({ type: 'rect', role: 'strip-track', x: G.left + 520, y: y + 52, w: 360, h: 28, fill: 'mystery', r: 4 });
      if (ratio != null) ops.push({ type: 'rect', role: 'strip-fill', x: G.left + 520, y: y + 52, w: Math.max(8, 360 * ratio), h: 28, fill: sp.tone, r: 4, anim: 'grow', once: true });
    }
    return ops;
  }

  // Block captions: each word in a dark box, the spoken word in yellow.
  function layoutBlockCaption(measure, card, timeline) {
    const style = styleOf(timeline);
    const words = timeline.tracks.captions.words;
    const list = card.words.map(i => ({ i, text: words[i].w.replace(/^[“"]|[”"]$/g, '').toUpperCase() }));
    const [max, min] = style.type.caption;
    const pad = 12;
    const gap = 8;
    let size = max;
    let lines;
    const build = () => {
      const f = font(700, size, style.type.display);
      const out = [[]];
      let width = 0;
      list.forEach(w => {
        const ww = measure(w.text, f) + pad * 2;
        if (out[out.length - 1].length && width + gap + ww > CAPTION_W) { out.push([]); width = 0; }
        out[out.length - 1].push({ ...w, w: ww });
        width += (out[out.length - 1].length > 1 ? gap : 0) + ww;
      });
      return out;
    };
    lines = build();
    while (lines.length > 2 && size > min) { size = Math.max(min, size * 0.92); lines = build(); }
    const f = font(700, size, style.type.display);
    const boxH = size * CAP + 2 * pad + 4;
    const ops = [];
    const blockH = lines.length * boxH + (lines.length - 1) * gap;
    let y = (timeline.strip ? 1480 : 1500) - blockH;
    lines.forEach(line => {
      const lw = line.reduce((a, w) => a + w.w, 0) + gap * (line.length - 1);
      let x = (W - lw) / 2;
      line.forEach(w => {
        ops.push({ type: 'cword', i: w.i, text: w.text, font: f, size, x: x + pad, y: y + pad + 2 + size * CAP, w: w.w - pad * 2, box: { x, y, w: w.w, h: boxH } });
        x += w.w + gap;
      });
      y += boxH + gap;
    });
    return { style: 'block', ops, box: null };
  }

  // ─── Data formats: layout (Game Swing, Moment Replay, Archive) ──────────
  // Every element is ops with boxes, like the styled layouts, so the safe-zone
  // and logo tests cover them. Every number an op shows comes from the
  // timeline's data through a ref (op.refs); the lint re-derives the allowed
  // numbers from those refs (provenanceNumbers) and blocks anything else.
  // Nothing here reads the model's text for a number: score, clock, down and
  // distance, WP percentages, years and stat values are the digest's or
  // ESPN's own strings.
  const canvasOf = tl => (tl && tl.canvas && Number(tl.canvas.h) === 1350 ? { w: 1080, h: 1350 } : { w: W, h: H });
  // The ES mark on a 4:5 slide: top-right inside the 60 px margin, the same
  // size and clear space as on the reel.
  const SLIDE_MARK = { w: ES_MARK.w, h: ES_MARK.h, x: 1080 - 60 - ES_MARK.w, y: 60, clear: ES_MARK.clear };
  const SLIDE_SAFE = { left: 60, right: 1020, top: 60, bottom: 1290 };
  const SLIDE_TEMPLATES = new Set(['slide-cover', 'slide-panel', 'slide-moment', 'slide-data', 'slide-cta']);
  const pct = v => Math.round(Number(v) * 100);
  const NEUTRAL_TEAM = '#4A5260';
  const rgbOf = hex => { const m = String(hex).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return m ? m.slice(1).map(x => parseInt(x, 16)) : [0, 0, 0]; };
  const rgbDistance = (a, b) => { const x = rgbOf(a); const y = rgbOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  const INK_DARK = '#111214';
  function resolvedRefs(tl, refs) {
    const T = getT();
    const out = { play: [], wp: [], src: [], stat: [], photo: [], frame: [] };
    if (!T) return out;
    (refs || []).forEach(ref => {
      const r = T.parseRef(ref);
      const v = r ? T.resolveRef(tl, ref) : null;
      if (r && v) out[r.type].push({ ref, id: r.id, v });
    });
    return out;
  }
  const gameOf = tl => (tl && tl.data && tl.data.game && tl.data.game.teams ? tl.data.game : null);
  const wpPoints = game => (game && game.wp && Array.isArray(game.wp.points) ? game.wp.points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : []);
  const hasWp = tl => { const g = gameOf(tl); return Boolean(g && wpPoints(g).length && String(g.attribution || '').trim()); };
  // Q1-Q4, OT, 2OT (football); TOP 9 / BOT 9 (baseball).
  function periodLabel(game, play) {
    if (!play || !Number.isInteger(play.period)) return '';
    if ((game && game.sport === 'mlb') || play.half) return `${play.half === 'bottom' ? 'BOT' : 'TOP'} ${play.period}`;
    if (play.period <= 4) return `Q${play.period}`;
    return play.period === 5 ? 'OT' : `${play.period - 4}OT`;
  }
  // White or near-black, whichever reads better on a colour.
  const bestInk = c => (!HEX6.test(String(c)) ? WHITE : (contrast(WHITE, c) >= contrast(INK_DARK, c) ? WHITE : INK_DARK));
  const normName = v => String(v || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  // A team's colours: the digest's, else the reel's team when the names match.
  function teamColours(tl, side) {
    const game = gameOf(tl);
    const t = game && game.teams[side];
    const list = (t && Array.isArray(t.colors) ? t.colors : []).filter(c => HEX6.test(String(c)));
    if (!list.length && t && tl.team && tl.team.name && Array.isArray(tl.team.colors)) {
      const a = normName(t.name);
      if (normName(tl.team.name).some(w => a.includes(w))) list.push(...tl.team.colors.filter(c => HEX6.test(String(c))));
    }
    return list;
  }
  // A team colour as a block on `against` (it must stand off it, 1.6:1), and
  // never purple; else the fallback.
  const blockColour = (list, against, fallback) => list.find(c => !S.isPurple(c) && (!HEX6.test(String(against)) || contrast(c, against) >= 1.6)) || fallback;
  // A team colour as text on `against` (3:1, large type), else the ink.
  const textColour = (list, against, ink) => list.find(c => !S.isPurple(c) && HEX6.test(String(against)) && contrast(c, against) >= 3) || ink;
  function sideColours(tl, style, against) {
    const pal = style.palette;
    const home = blockColour(teamColours(tl, 'home'), against, pal.accent);
    // The away block must read as a different team: far enough from home in RGB.
    let away = blockColour(teamColours(tl, 'away').filter(c => !HEX6.test(home) || rgbDistance(c, home) >= 120), against, NEUTRAL_TEAM);
    if (away === home) away = NEUTRAL_TEAM;
    return { home, away };
  }

  // Score state on a beat: the last play the beat refs (score after it; a
  // scoring play counts up from the score before it), else the final.
  function scoreState(tl, refs) {
    const game = gameOf(tl);
    if (!game) return null;
    const plays = Array.isArray(game.plays) ? game.plays : [];
    const r = resolvedRefs(tl, refs);
    const play = r.play.length ? r.play.reduce((m, p) => (p.v.seq > m.v.seq ? p : m)).v : null;
    if (play) {
      const prev = plays.filter(p => p.seq < play.seq).pop() || null;
      const before = play.scoring ? (prev ? prev.score : { home: 0, away: 0 }) : play.score;
      return { mode: 'play', play, score: play.score, before, poss: play.team || null, down: play.down || '', period: periodLabel(game, play), clock: play.clock || '', refs: [`play:${play.id}`, ...(play.scoring && prev ? [`play:${prev.id}`] : [])] };
    }
    if (game.status && game.status.final) {
      const score = { home: game.teams.home.score, away: game.teams.away.score };
      return { mode: 'final', play: null, score, before: score, poss: null, down: '', period: '', clock: '', status: String(game.status.detail || 'Final').toUpperCase(), refs: ['game:final'] };
    }
    const last = plays[plays.length - 1];
    return last ? { mode: 'play', play: last, score: last.score, before: last.score, poss: last.team || null, down: last.down || '', period: periodLabel(game, last), clock: last.clock || '', refs: [`play:${last.id}`] } : null;
  }

  // Scorebug: [AWAY | score][HOME | score][down & distance or FINAL].
  function scorebugOps(measure, tl, style, cv, state, delay = 0) {
    const game = gameOf(tl);
    if (!game || !state) return [];
    const tk = S.elementTokens(style, 'scorebug');
    const b = S.elementBox('scorebug', cv);
    const slide = cv.h !== H;
    const chipW = slide ? 128 : 136;
    const scoreW = slide ? 100 : 104;
    const cols = sideColours(tl, style, tk.fill);
    const ops = [{ type: 'rect', role: 'scorebug', x: b.x, y: b.y, w: b.w, h: b.h, fill: tk.fill, stroke: style.id === 'explainer' ? style.palette.line : '', lw: 2, r: 4, delay, anim: 'wipe' }];
    ['away', 'home'].forEach((side, i) => {
      const t = game.teams[side];
      const x = b.x + i * (chipW + scoreW + 2);
      ops.push({ type: 'rect', role: 'team-chip', x, y: b.y, w: chipW, h: b.h, fill: cols[side], r: 0, delay: delay + 60 + i * 60, anim: 'wipe' });
      const abbr = String(t.abbr || '').toUpperCase();
      const af = fitText(measure, abbr, { family: style.type.display, weight: 700, max: slide ? 50 : 56, min: 30, maxLines: 1, width: chipW - 20 });
      const aw = af.lines[0] ? af.lines[0].width : 0;
      ops.push({ type: 'text', role: 'team-abbr', text: abbr, font: af.font, size: af.size, x: x + (chipW - aw) / 2, y: b.y + b.h / 2 + af.size * 0.36, w: aw, color: bestInk(cols[side]), delay: delay + 140 + i * 60, anim: 'rise' });
      const size = slide ? 68 : 76;
      const sf = font(700, size, style.type.display);
      const to = state.score[side];
      // Count up only across one score (a jump of more than 8 means plays
      // in between were not kept: show the score as it is).
      const from = state.before && Math.abs(to - state.before[side]) <= 8 ? state.before[side] : to;
      const sw = measure(String(to), sf);
      ops.push({ type: 'score', role: 'score', text: String(to), from, to, font: sf, size, x: x + chipW + (scoreW - sw) / 2, y: b.y + b.h / 2 + size * 0.36, w: sw, cellX: x + chipW, cellW: scoreW, color: tk.ink, countDelay: 380, countMs: 640, delay: delay + 200, anim: 'fade', refs: state.refs });
      // Possession: a short bar under the score.
      if (state.poss === side) ops.push({ type: 'rect', role: 'possession', x: x + chipW + scoreW / 2 - 22, y: b.y + b.h - 14, w: 44, h: 6, fill: style.palette.hi, r: 3, delay: delay + 320, anim: 'grow' });
    });
    const sx = b.x + 2 * (chipW + scoreW + 2) + 8;
    const sw = b.x + b.w - sx - 12;
    const status = state.mode === 'final' ? state.status : String(state.down || state.period || '').toUpperCase();
    if (status) {
      const stf = fitText(upperMeasure(measure), status, { family: style.type.display, weight: 700, max: slide ? 40 : 46, min: 24, maxLines: 1, width: sw });
      const w = stf.lines[0] ? stf.lines[0].width : 0;
      ops.push({ type: 'text', role: state.mode === 'final' ? 'status' : 'down', text: status, font: stf.font, size: stf.size, x: sx + (sw - w) / 2, y: b.y + b.h / 2 + stf.size * 0.36, w, color: tk.ink, delay: delay + 300, anim: 'rise', refs: state.refs });
    }
    return ops;
  }
  // The game clock: a tab under the bug's right end ("Q1  6:56").
  // No tab without a clock when the bug already shows the period: baseball
  // has no clock, so the tab would only repeat the bug's "TOP 2".
  const clockTab = state => Boolean(state && state.mode !== 'final' && (state.clock || (state.period && state.down)));
  function clockOps(measure, tl, style, cv, state, delay = 0) {
    if (!clockTab(state)) return [];
    const text = [state.period, state.clock].filter(Boolean).join('  ');
    if (!text) return [];
    const tk = S.elementTokens(style, 'clock');
    const b = S.elementBox('clock', cv);
    const f = fitText(upperMeasure(measure), text, { family: style.type.display, weight: 700, max: b.h * 0.7, min: 22, maxLines: 1, width: b.w - 56 });
    const w = f.lines[0] ? f.lines[0].width : 0;
    return [
      { type: 'rect', role: 'clock', x: b.x, y: b.y, w: b.w, h: b.h, fill: tk.fill, r: 4, delay, anim: 'wipe' },
      { type: 'circle', role: 'clock-dot', cx: b.x + 24, cy: b.y + b.h / 2, r: 6, fill: tk.ink, x: b.x + 18, y: b.y + b.h / 2 - 6, w: 12, h: 12, delay: delay + 80, anim: 'pop', pulse: true },
      { type: 'text', role: 'clock-text', text, font: f.font, size: f.size, x: b.x + 40 + (b.w - 56 - w) / 2, y: b.y + b.h / 2 + f.size * 0.36, w, color: tk.ink, delay: delay + 80, anim: 'rise', refs: state.refs },
    ];
  }

  // Win probability: geometry shared by the layout (labels) and the draw.
  function wpGeom(box, mode, pts, game) {
    const full = mode === 'full';
    const px = box.x + (full ? 96 : 84);
    const pw = box.w - (full ? 96 + 40 : 84 + 24);
    const py = box.y + (full ? 88 : 40);
    const ph = box.h - (full ? 88 + 64 : 40 + 16);
    const plays = game && Array.isArray(game.plays) ? game.plays : [];
    const s0 = Math.min(...pts.map(p => p[0]));
    const s1 = Math.max(...pts.map(p => p[0]), ...plays.map(p => p.seq), s0 + 1);
    const X = seq => px + ((seq - s0) / (s1 - s0)) * pw;
    const Y = wp => py + (1 - Math.max(0, Math.min(1, wp))) * ph;
    return { px, py, pw, ph, s0, s1, X, Y };
  }
  // The WP point at or before a seq (a play's own value when it has one).
  function wpAt(game, seq) {
    const pts = wpPoints(game);
    let hit = null;
    pts.forEach(p => { if (p[0] <= seq) hit = p; });
    return hit || pts[0] || null;
  }
  // The leader at a WP value and its whole-number chance ("SF 63%").
  function leaderLabel(game, wpHome) {
    const home = wpHome >= 0.5;
    const t = game.teams[home ? 'home' : 'away'];
    return { side: home ? 'home' : 'away', text: `${String(t.abbr || '').toUpperCase()} ${pct(home ? wpHome : 1 - wpHome)}%` };
  }
  // The chart (band under the bug on a play, full on a wpline beat) and its
  // labels as text ops (so the lint and the boxes see every number).
  function wpOps(measure, tl, style, box, { mode = 'full', upto = null, from = null, to = null, marker = null, delay = 0 } = {}) {
    const game = gameOf(tl);
    const pts = wpPoints(game);
    // Never a WP line without its attribution line.
    if (!game || !pts.length || !hasWp(tl)) return [];
    const tk = S.elementTokens(style, 'wpline');
    const pal = style.palette;
    const panel = HEX6.test(String(pal.panel)) ? pal.panel : pal.paper;
    const cols = sideColours(tl, style, panel);
    const geo = wpGeom(box, mode, pts, game);
    const drawMs = mode === 'full' ? 1600 : 900;
    const ops = [];
    const r = style.visual === 'card' ? 20 : 4;
    ops.push({ type: 'wpchart', role: mode === 'full' ? 'wp-chart' : 'wp-band', mode, x: box.x, y: box.y, w: box.w, h: box.h, r, points: pts.map(p => [p[0], p[1]]), geo: { px: geo.px, py: geo.py, pw: geo.pw, ph: geo.ph, s0: geo.s0, s1: geo.s1 }, upto, from, to, panel, stroke: style.id === 'series' ? pal.ink : '', colors: cols, line: tk.line, guide: tk.guide, hi: pal.hi, ink: pal.ink, drawMs, delay, anim: 'fade' });
    const L = S.LABEL;
    const labelSize = mode === 'full' ? 24 : 18;
    // Axis: the home team at the top, the away team at the bottom.
    [['home', geo.py + labelSize * 0.72], ['away', geo.py + geo.ph]].forEach(([side, y]) => {
      const t = game.teams[side];
      const text = String(t.abbr || '').toUpperCase();
      ops.push(textOp(measure, text, style.type.display, 700, mode === 'full' ? 34 : 24, geo.px - 16, y, { role: 'wp-axis', color: textColour([cols[side]], panel, pal.ink), align: 'right', upper: false, delay: delay + 120, anim: 'fade' }));
    });
    if (mode === 'full') {
      ops.push(textOp(measure, 'WIN PROBABILITY', L, 700, labelSize, box.x + 32, box.y + 48, { role: 'wp-title', color: 'muted', track: 1.5, delay, anim: 'fade' }));
      // Legend: a swatch and the abbreviation per team, right-aligned.
      let lx = box.x + box.w - 32;
      ['away', 'home'].forEach(side => {
        const text = String(game.teams[side].abbr || '').toUpperCase();
        const t = textOp(measure, text, L, 700, labelSize, lx, box.y + 48, { role: 'wp-legend', color: 'ink', align: 'right', upper: false, delay, anim: 'fade' });
        ops.push(t);
        ops.push({ type: 'rect', role: 'wp-swatch', x: t.x - 28, y: box.y + 48 - 16, w: 18, h: 18, fill: cols[side], r: 3, delay, anim: 'fade' });
        lx = t.x - 52;
      });
      ops.push(textOp(measure, 'KICKOFF', L, 700, 18, geo.px, geo.py + geo.ph + 36, { role: 'wp-axis-x', color: 'muted', track: 1.2, delay: delay + 120, anim: 'fade' }));
      if (game.sport === 'mlb') ops[ops.length - 1].text = 'FIRST PITCH';
      ops.push(textOp(measure, game.status && game.status.final ? 'FINAL' : 'NOW', L, 700, 18, geo.px + geo.pw, geo.py + geo.ph + 36, { role: 'wp-axis-x', color: 'muted', align: 'right', track: 1.2, delay: delay + 120, anim: 'fade' }));
    } else {
      ops.push(textOp(measure, 'WIN PROBABILITY', L, 700, 18, box.x + 20, box.y + 26, { role: 'wp-title', color: 'muted', track: 1.2, delay, anim: 'fade' }));
    }
    // The swing marker and its callout ("SF 63%").
    if (marker) {
      const mx = geo.X(marker.seq);
      const my = geo.Y(marker.wp);
      const lab = leaderLabel(game, marker.wp);
      const size = mode === 'full' ? 30 : 22;
      const h = mode === 'full' ? 52 : 38;
      const f = font(700, size, style.type.display);
      const tw = measure(lab.text, f);
      const w = tw + 28;
      const x = Math.max(box.x + 12, Math.min(box.x + box.w - 12 - w, mx - w / 2));
      const above = my - 22 - h > box.y + (mode === 'full' ? 64 : 4);
      const y = above ? my - 22 - h : my + 22;
      const at = delay + drawMs + 60;
      ops.push({ type: 'rect', role: 'wp-callout-bg', x, y, w, h, fill: pal.hi, r: 4, delay: at, anim: 'pop' });
      ops.push({ type: 'text', role: 'wp-callout', text: lab.text, font: f, size, x: x + 14, y: y + h / 2 + size * 0.36, w: tw, color: pal.hiInk, delay: at, anim: 'pop', refs: marker.refs });
      if (mode === 'full' && marker.fromWp != null && marker.fromSeq != null && marker.fromSeq !== marker.seq) {
        const fl = leaderLabel(game, marker.fromWp);
        const fx = geo.X(marker.fromSeq);
        const fy = geo.Y(marker.fromWp);
        const ff = font(700, 24, L);
        const fw = measure(fl.text, ff);
        const fbx = Math.max(box.x + 12, Math.min(box.x + box.w - 12 - fw - 24, fx - (fw + 24) / 2));
        const fby = fy - 18 - 40 > box.y + 64 ? fy - 18 - 40 : fy + 18;
        ops.push({ type: 'rect', role: 'wp-from-bg', x: fbx, y: fby, w: fw + 24, h: 40, fill: panel, stroke: pal.line && HEX6.test(pal.line) ? pal.line : pal.ink, lw: 2, r: 4, delay: delay + 200, anim: 'fade' });
        ops.push({ type: 'text', role: 'wp-from', text: fl.text, font: ff, size: 24, x: fbx + 12, y: fby + 20 + 24 * 0.36, w: fw, color: 'muted', delay: delay + 200, anim: 'fade', refs: marker.fromRefs });
      }
    }
    return ops;
  }
  // "Win probability: ESPN Analytics", exactly the digest's line.
  function attributionOps(measure, tl, style, x, y, delay = 0) {
    const game = gameOf(tl);
    if (!game || !String(game.attribution || '').trim()) return [];
    const text = String(game.attribution).trim();
    return [textOp(measure, text, S.LABEL, 700, 22, x, y, { role: 'attribution', color: 'muted', upper: false, track: 0.5, delay, anim: 'fade' })];
  }
  // The swing a beat points at: its wp refs (first -> last), or its play's
  // move from the WP point before it.
  function swingFor(tl, refs) {
    const game = gameOf(tl);
    const pts = wpPoints(game);
    if (!pts.length) return null;
    const r = resolvedRefs(tl, refs);
    const biggest = (lo, hi) => {
      let best = null;
      pts.forEach((p, i) => { if (i && p[0] > lo && p[0] <= hi && (!best || Math.abs(p[1] - pts[i - 1][1]) > Math.abs(best[1][1] - best[0][1]))) best = [pts[i - 1], p]; });
      return best;
    };
    if (r.wp.length) {
      const list = r.wp.map(x => x.v).sort((a, b) => a.seq - b.seq);
      const a = list[0];
      const b = list[list.length - 1];
      // Two refs spanning the whole game (reel-data.js: first and last point):
      // highlight the biggest single move inside the span, not the whole line.
      if (list.length >= 2 && a.seq === pts[0][0] && b.seq === pts[pts.length - 1][0] && pts.length > 3) {
        const m = biggest(a.seq, b.seq);
        if (m) return { fromSeq: m[0][0], fromWp: m[0][1], fromRefs: [`wp:${m[0][0]}`], seq: m[1][0], wp: m[1][1], refs: [`wp:${m[1][0]}`] };
      }
      return { fromSeq: a.seq, fromWp: a.wpHome, fromRefs: [`wp:${a.seq}`], seq: b.seq, wp: b.wpHome, refs: [`wp:${b.seq}`] };
    }
    const play = r.play.length ? r.play[r.play.length - 1].v : null;
    if (play) {
      const at = play.wpHome != null ? [play.seq, play.wpHome] : wpAt(game, play.seq);
      const before = pts.filter(p => p[0] < (at ? at[0] : play.seq)).pop() || null;
      const refsAt = play.wpHome != null ? [`play:${play.id}`] : [`wp:${at[0]}`];
      return { fromSeq: before ? before[0] : null, fromWp: before ? before[1] : null, fromRefs: before ? [`wp:${before[0]}`] : [], seq: at[0], wp: at[1], refs: refsAt, upto: Math.max(at[0], play.seq) };
    }
    // The biggest move in the game.
    let best = null;
    pts.forEach((p, i) => { if (i && (!best || Math.abs(p[1] - pts[i - 1][1]) > Math.abs(best[1][1] - best[0][1]))) best = [pts[i - 1], p]; });
    if (!best) best = [pts[0], pts[0]];
    return { fromSeq: best[0][0], fromWp: best[0][1], fromRefs: [`wp:${best[0][0]}`], seq: best[1][0], wp: best[1][1], refs: [`wp:${best[1][0]}`] };
  }

  // The play card: play type and yards chips, the beat's line, the play.
  function playcardOps(measure, tl, style, box, g, play, delay = 0, onImage = false) {
    const tk = S.elementTokens(style, 'playcard');
    const pal = style.palette;
    const ops = [];
    const pad = 28;
    const innerW = box.w - pad * 2;
    let y = box.y + pad;
    const chips = [];
    if (play.type) chips.push({ text: play.type, fill: play.scoring ? tk.hi : tk.ink, ink: play.scoring ? tk.hiInk : (HEX6.test(String(tk.fill)) ? tk.fill : pal.paper) });
    if (play.yards != null && Number.isFinite(Number(play.yards)) && Number(play.yards) !== 0) chips.push({ text: `${play.yards} YDS`, fill: tk.accent, ink: WHITE });
    let cx = box.x + pad;
    const chipOpsList = [];
    chips.forEach((c, i) => {
      const cs = chipOp(measure, c.text, cx, y, { fill: c.fill, ink: c.ink, size: 22, h: 40, role: 'play-chip', delay: delay + 100 + i * 60 });
      cs[1].refs = [`play:${play.id}`];
      chipOpsList.push(...cs);
      cx += cs[0].w + 12;
    });
    if (chipOpsList.length) y += 40 + 20;
    const head = String((g.data && g.data.text) || '').trim();
    let headOps = [];
    if (head) {
      const hf = fitText(upperMeasure(measure), head, { family: style.type.display, weight: 700, max: 68, min: 48, maxLines: 2, width: innerW });
      const blk = linesOps(hf, y, { lineHeight: 0.96, role: 'headline', color: tk.ink, emphasis: g.data.emphasis, baseDelay: delay + 160, delayStep: style.motion.stagger });
      headOps = blk.ops.map(o => ({ ...o, type: 'text', anim: 'mask', x: o.x - MARGIN + box.x + pad }));
      y = blk.bottom + 18;
    }
    // ESPN's play text without its scorer's noise (formation, jersey numbers,
    // tacklers, a cut-off tail): only removes words, so every number left is
    // the play's own.
    const T = getT();
    const line = (T && T.cleanPlayText ? T.cleanPlayText(play.text) : '') || play.text || '';
    const tf = fitText(measure, line, { family: style.type.body, weight: 500, max: 30, min: 24, maxLines: 2, width: innerW });
    const textBlk = linesOps(tf, y, { lineHeight: 1.22, upper: false, role: 'play-text', color: tk.muted, baseDelay: delay + 320, delayStep: 0 });
    const playText = textBlk.ops.map(o => ({ ...o, type: 'text', anim: 'fade', x: o.x - MARGIN + box.x + pad, refs: [`play:${play.id}`] }));
    const h = Math.round(textBlk.bottom - box.y + pad);
    ops.push({ type: 'rect', role: 'playcard', x: box.x, y: box.y, w: box.w, h, fill: onImage ? 'rgba(11,13,18,0.82)' : tk.fill, stroke: style.id === 'series' ? pal.ink : '', lw: 3, r: style.visual === 'card' ? 20 : 4, delay, anim: 'wipe' });
    ops.push({ type: 'rect', role: 'playcard-rule', x: box.x, y: box.y, w: 8, h, fill: play.scoring ? pal.hi : tk.accent, r: 0, delay: delay + 60, anim: 'fade' });
    ops.push(...chipOpsList, ...headOps, ...playText);
    return { ops, bottom: box.y + h };
  }

  function layoutPlay(measure, g, tl, style, cv) {
    const refs = (g.data && g.data.refs) || [];
    const state = scoreState(tl, refs);
    const ops = [];
    if (!state || !state.play) return ops;
    const classic = style.engine === 'classic';
    ops.push(...scorebugOps(measure, tl, style, cv, state, 0));
    ops.push(...clockOps(measure, tl, style, cv, state, 160));
    const top = clockTab(state) ? S.elementBox('clock', cv) : S.elementBox('scorebug', cv);
    let y = top.y + top.h + 24;
    const showWp = hasWp(tl);
    if (showWp) {
      const band = S.elementBox('wpline', cv);
      const sw = swingFor(tl, refs);
      ops.push(...wpOps(measure, tl, style, band, { mode: 'band', upto: sw ? sw.upto : null, from: sw ? sw.fromSeq : null, to: sw ? sw.seq : null, marker: sw, delay: 260 }));
      y = band.y + band.h + 24;
    }
    const card = S.elementBox('playcard', cv);
    // The card sits on the lower third, its bottom on a fixed line (room for
    // the attribution under it); the clip fills the space above it.
    const dry = playcardOps(measure, tl, style, { x: card.x, y: 0, w: card.w, h: card.h }, g, state.play, 200, classic);
    const bottomLine = showWp ? 1452 : 1500;
    const cardY = snap(Math.max(card.y, bottomLine - dry.bottom));
    if (!classic) {
      const vh = cardY - 24 - y;
      if (vh > 160) ops.push(...visualOps(style, { x: G.left, y, w: CW, h: vh }, { delay: 120 }, measure));
    }
    const pc = playcardOps(measure, tl, style, { x: card.x, y: cardY, w: card.w, h: card.h }, g, state.play, 200, classic);
    ops.push(...pc.ops);
    if (showWp) ops.push(...attributionOps(measure, tl, style, G.left, pc.bottom + 44, 400));
    return ops;
  }
  function layoutWpline(measure, g, tl, style, cv) {
    const refs = (g.data && g.data.refs) || [];
    const ops = [];
    // A wpline beat's play refs are marks on the line; the bug shows the final (or the latest play).
    const state = scoreState(tl, []);
    ops.push(...scorebugOps(measure, tl, style, cv, state, 0));
    ops.push(...clockOps(measure, tl, style, cv, state, 120));
    const head = headlineOps(measure, g.data || {}, 472, style, { maxLines: 2 });
    ops.push(...head.ops);
    const full = { ...S.ELEMENTS.wpline.full };
    full.y = Math.max(full.y, snap(head.bottom + 48));
    full.h = Math.min(720, 1420 - full.y);
    const sw = swingFor(tl, refs);
    ops.push(...wpOps(measure, tl, style, full, { mode: 'full', from: sw ? sw.fromSeq : null, to: sw ? sw.seq : null, marker: sw, delay: 220 }));
    ops.push(...attributionOps(measure, tl, style, G.left, full.y + full.h + 44, 300));
    return ops;
  }

  // Archive: what one moment beat shows (year, title, line, stat row, source).
  const STAT_PICKS = { passing: ['YDS', 'TD', 'INT'], rushing: ['YDS', 'TD', 'AVG'], receiving: ['REC', 'YDS', 'TD'], batting: ['AVG', 'HR', 'RBI'], hitting: ['AVG', 'HR', 'RBI'], pitching: ['ERA', 'W', 'K'], scoring: ['EVENTS', 'WINS', 'TOP10'] };
  function momentInfo(tl, refs) {
    const r = resolvedRefs(tl, refs);
    const arch = tl && tl.data && tl.data.archive;
    const moments = arch && Array.isArray(arch.moments) ? arch.moments : [];
    const m = moments.find(mm => Array.isArray(mm.cite) && mm.cite.some(c => refs.includes(c))) || null;
    const statRow = r.stat[0] || null;
    const src = r.src[0] || null;
    let year = null;
    let yearRefs = [];
    if (m && Number.isInteger(m.year)) { year = m.year; yearRefs = m.cite.filter(c => refs.includes(c)); }
    else if (statRow && Number.isInteger(statRow.v.year)) { year = statRow.v.year; yearRefs = [statRow.ref]; }
    else if (src && /^\d{4}/.test(String(src.v.date || ''))) { year = Number(String(src.v.date).slice(0, 4)); yearRefs = [src.ref]; }
    const athlete = tl && tl.data && tl.data.athlete;
    const stats = athlete && athlete.stats;
    let tiles = [];
    if (statRow && stats && Array.isArray(stats.labels)) {
      const values = statRow.v.stats || [];
      const want = STAT_PICKS[String(stats.category || '').toLowerCase()] || [];
      let idx = want.map(l => stats.labels.indexOf(l)).filter(i => i >= 0);
      if (idx.length < 3) idx = [...new Set([...idx, ...stats.labels.map((l, i) => i).filter(i => !/^GP$/i.test(stats.labels[i]))])];
      const human = i => String((Array.isArray(stats.names) && stats.names[i]) || stats.labels[i]).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^QB/, 'QB ').replace(/\s+/g, ' ').trim().toUpperCase();
      tiles = idx.filter(i => values[i] != null && String(values[i]).trim() && String(values[i]).trim() !== '-').slice(0, 3).map(i => ({ label: stats.labels[i], name: human(i), value: String(values[i]).trim(), refs: [statRow.ref] }));
    }
    return { year, yearRefs, title: m ? String(m.title || '') : '', line: m ? String(m.line || '') : '', lineRefs: m ? m.cite : [], statRow, src, photo: r.photo[0] || null, tiles, athlete, stats };
  }
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  // The source line: "ES · FEB 2017 · <headline>" or "ESPN · 2001 SEASON STATS".
  function sourceLine(info) {
    if (info.src) {
      const d = String(info.src.v.date || '');
      const m = /^(\d{4})-(\d{2})/.exec(d);
      const when = m ? `${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`.trim() : '';
      return { text: ['ES', when, String(info.src.v.title || '').slice(0, 48)].filter(Boolean).join(' · '), refs: [info.src.ref] };
    }
    if (info.statRow) {
      const name = (info.athlete && info.athlete.source && info.athlete.source.name) || 'ESPN';
      const label = info.statRow.v.id === 'totals' ? 'CAREER STATS' : `${info.statRow.v.year} SEASON STATS`;
      return { text: `${name} · ${label}`, refs: [info.statRow.ref] };
    }
    return null;
  }
  function statTilesOps(measure, style, tiles, rect, delay) {
    const ops = [];
    if (!tiles.length) return ops;
    const gap = 16;
    const n = tiles.length;
    const tw = Math.floor((rect.w - gap * (n - 1)) / n);
    tiles.forEach((t, i) => {
      const x = rect.x + i * (tw + gap);
      const dl = delay + i * 120;
      ops.push({ type: 'rect', role: 'stat-tile', x, y: rect.y, w: tw, h: rect.h, fill: 'panel', stroke: style.id === 'series' ? 'ink' : '', lw: 3, r: style.visual === 'card' ? 20 : 4, delay: dl, anim: style.motion.enter === 'flip' ? 'flip' : 'rise' });
      const vf = fitText(measure, t.value, { family: style.type.display, weight: 700, max: Math.min(104, rect.h * 0.56), min: 44, maxLines: 1, width: tw - 40 });
      ops.push({ type: 'count', role: 'stat-value', text: t.value, spec: parseStatValue(t.value), font: vf.font, size: vf.size, x: x + 20, y: rect.y + 24 + vf.size * CAP, w: vf.lines[0] ? vf.lines[0].width : 0, color: i === 0 ? (style.theme === 'dark' ? 'hi' : 'accent') : 'ink', delay: dl + 80, anim: 'rise', countMs: 800, refs: t.refs });
      ops.push(textOp(measure, t.label, S.LABEL, 700, 24, x + 20, rect.y + rect.h - 26, { role: 'stat-label', color: 'muted', track: 1.4, delay: dl + 160, anim: 'fade', refs: t.refs }));
    });
    return ops;
  }
  // Stat rows (no photo on the moment): one big value per row, its full name beside it.
  function statRowsOps(measure, style, tiles, rect, delay) {
    const ops = [];
    const gap = 16;
    const n = tiles.length;
    const rh = Math.min(184, Math.floor((rect.h - gap * (n - 1)) / Math.max(1, n)));
    tiles.forEach((t, i) => {
      const y = rect.y + i * (rh + gap);
      const dl = delay + i * 140;
      ops.push({ type: 'rect', role: 'stat-row', x: rect.x, y, w: rect.w, h: rh, fill: 'panel', stroke: style.id === 'series' ? 'ink' : '', lw: 3, r: style.visual === 'card' ? 20 : 4, delay: dl, anim: style.motion.enter === 'flip' ? 'flip' : 'rise' });
      ops.push({ type: 'rect', role: 'stat-row-rule', x: rect.x, y, w: 8, h: rh, fill: i === 0 ? 'hi' : 'accent', r: 0, delay: dl + 60, anim: 'fade' });
      const vf = fitText(measure, t.value, { family: style.type.display, weight: 700, max: Math.min(132, rh * 0.72), min: 56, maxLines: 1, width: rect.w * 0.48 });
      ops.push({ type: 'count', role: 'stat-value', text: t.value, spec: parseStatValue(t.value), font: vf.font, size: vf.size, x: rect.x + 40, y: y + rh / 2 + vf.size * CAP / 2, w: vf.lines[0] ? vf.lines[0].width : 0, color: i === 0 ? (style.theme === 'dark' ? 'hi' : 'accent') : 'ink', delay: dl + 80, anim: 'rise', countMs: 900, refs: t.refs });
      const lf = fitText(upperMeasure(measure), t.name || t.label, { family: S.LABEL, weight: 700, max: 34, min: 22, maxLines: 2, width: rect.w * 0.44 });
      const lx = rect.x + rect.w * 0.52;
      const blk = linesOps(lf, y + rh / 2 - (lf.size * CAP + (lf.lines.length - 1) * lf.size * 1.1) / 2, { lineHeight: 1.1, role: 'stat-label', color: 'muted', baseDelay: dl + 160, delayStep: 0 });
      ops.push(...blk.ops.map(o => ({ ...o, type: 'text', anim: 'fade', x: o.x - MARGIN + lx, refs: t.refs })));
    });
    return ops;
  }
  // The year rail: one node per moment beat; the current one lit.
  function railOps(measure, tl, style, g, rail) {
    const tk = S.elementTokens(style, 'timeline-node');
    const ops = [];
    const nodes = (tl.beats || []).filter(b => b.kind === 'moment').map(b => ({ id: b.id, info: momentInfo(tl, b.refs || []) })).filter(n => n.info.year != null);
    if (!nodes.length) return ops;
    const n = nodes.length;
    const spacing = n > 1 ? Math.min(360, (rail.h - 120) / (n - 1)) : 0;
    const top = rail.y + rail.h / 2 - (spacing * (n - 1)) / 2;
    const lx = rail.x + 24;
    const cur = nodes.findIndex(x => x.id === g.beat);
    ops.push({ type: 'rect', role: 'rail-line', x: lx - 2, y: top - 40, w: 4, h: spacing * (n - 1) + 80, fill: tk.line, r: 2, delay: 0, anim: 'fade' });
    if (cur > 0) ops.push({ type: 'rect', role: 'rail-progress', x: lx - 3, y: top, w: 6, h: spacing * cur, fill: tk.hi, r: 3, delay: 80, anim: 'fade' });
    nodes.forEach((node, i) => {
      const cy = top + i * spacing;
      const on = i === cur;
      const done = i < cur;
      ops.push({ type: 'circle', role: on ? 'rail-node-on' : 'rail-node', cx: lx, cy, r: on ? 16 : 9, fill: on || done ? (on ? tk.hi : tk.node) : style.palette.paper, stroke: on ? tk.ink : tk.node, lw: on ? 4 : 3, x: lx - 18, y: cy - 18, w: 36, h: 36, delay: on ? 200 : 60, anim: on ? 'pop' : 'fade' });
      const size = on ? 40 : 28;
      const f = on ? style.type.display : S.LABEL;
      ops.push(textOp(measure, String(node.info.year), f, 700, size, lx + 30, cy + size * 0.36, { role: 'rail-year', color: on ? 'ink' : 'muted', upper: false, delay: on ? 240 : 60, anim: 'fade', refs: node.info.yearRefs }));
    });
    return ops;
  }
  function layoutMoment(measure, g, tl, style, cv) {
    const refs = (g.data && g.data.refs) || [];
    const info = momentInfo(tl, refs);
    const ops = [];
    const slide = cv.h !== H;
    const rail = slide ? null : S.elementBox('timeline-node', cv);
    if (rail) ops.push(...railOps(measure, tl, style, g, rail));
    const x0 = slide ? 60 : rail.x + rail.w + 32;
    const w0 = (slide ? 960 : G.right - x0);
    let y = slide ? 60 : G.top;
    if (info.year != null) {
      // As big as it goes left of the ES mark's clear space.
      const text = String(info.year);
      const room = (slide ? SLIDE_MARK.x - SLIDE_MARK.clear : LOGO_CLEAR.left) - x0 - 8;
      const yfit = fitText(measure, text, { family: style.type.display, weight: 700, max: slide ? 220 : 280, min: 120, maxLines: 1, width: room });
      const ys = yfit.size;
      ops.push({ type: 'text', role: 'year', text, font: yfit.font, size: ys, x: x0, y: y + ys * CAP, w: yfit.lines[0] ? yfit.lines[0].width : 0, color: style.theme === 'dark' ? 'hi' : 'accent', delay: 80, anim: 'mask', refs: info.yearRefs });
      y += ys * CAP + 40;
    }
    const titleText = String((g.data && g.data.text) || info.title || '').trim();
    if (titleText) {
      const tf = fitText(upperMeasure(measure), titleText, { family: style.type.display, weight: 700, max: slide ? 80 : 84, min: 52, maxLines: 2, width: w0 });
      const blk = linesOps(tf, y, { lineHeight: 0.96, role: 'headline', color: 'ink', emphasis: g.data && g.data.emphasis, baseDelay: 200, delayStep: style.motion.stagger });
      ops.push(...blk.ops.map(o => ({ ...o, type: 'text', anim: 'mask', x: o.x - MARGIN + x0 })));
      y = blk.bottom + 36;
    }
    const photoKey = info.photo ? `photo:${info.photo.id}` : '';
    if (photoKey && tl.assets && tl.assets[photoKey]) {
      const ph = slide ? 400 : 440;
      ops.push(...visualOps(style, { x: x0, y, w: w0, h: ph }, { slot: photoKey, role: 'archive-photo', delay: 260 }, measure).map(o => (o.type === 'visual' ? { ...o, slot: photoKey } : o)));
      const credit = String(info.photo.v.credit || '').trim();
      if (credit) ops.push(textOp(measure, `PHOTO: ${credit}`.slice(0, 60), S.LABEL, 700, 18, x0 + w0 - 16, y + ph - 16, { role: 'photo-credit', color: '#FFFFFF', align: 'right', track: 1, delay: 400, anim: 'fade', refs: [info.photo.ref] }));
      y += ph + 32;
    }
    const srcTop = slide ? SLIDE_SAFE.bottom - 52 : S.elementBox('source-chip', cv).y;
    if (info.tiles.length && !(photoKey && tl.assets && tl.assets[photoKey])) {
      // No photo: the stat rows carry the moment and fill the column.
      const h = Math.min(info.tiles.length * 200, srcTop - 40 - y);
      ops.push(...statRowsOps(measure, style, info.tiles, { x: x0, y, w: w0, h }, 320));
      y += h + 32;
    } else if (info.tiles.length) {
      const th = slide ? 180 : 200;
      ops.push(...statTilesOps(measure, style, info.tiles, { x: x0, y, w: w0, h: th }, 320));
      y += th + 32;
    }
    if (info.line && info.line !== titleText && !info.tiles.length) {
      const lf = fitText(measure, info.line, { family: style.type.body, weight: 500, max: style.type.bodySize, min: style.type.bodySize - 8, maxLines: 2, width: w0 });
      const blk = linesOps(lf, y, { lineHeight: 1.2, upper: false, role: 'moment-line', color: 'muted', baseDelay: 460, delayStep: 0 });
      ops.push(...blk.ops.map(o => ({ ...o, type: 'text', anim: 'fade', x: o.x - MARGIN + x0, refs: info.lineRefs })));
    }
    const src = sourceLine(info);
    if (src) {
      const sb = S.elementBox('source-chip', cv);
      const sy = slide ? SLIDE_SAFE.bottom - 52 : sb.y;
      const cf = font(700, 24, S.LABEL);
      const text = src.text.toUpperCase();
      const tw = Math.min(w0 - 40, measure(text, cf) + 1.2 * Math.max(0, text.length - 1));
      ops.push({ type: 'rect', role: 'source-chip', x: x0, y: sy, w: tw + 40, h: 48, fill: 'panel', stroke: 'line', lw: 2, r: 4, delay: 520, anim: 'fade' });
      ops.push({ type: 'text', role: 'source', text, font: cf, size: 24, x: x0 + 20, y: sy + 24 + 24 * 0.36, w: tw, color: 'muted', track: 1.2, delay: 520, anim: 'fade', refs: src.refs });
    }
    return ops;
  }

  // Moment Replay: the 3-panel strip (setup / the play / reaction).
  function layoutPanel3(measure, g, tl, style, cv) {
    const RP = getRP();
    const refs = (g.data && g.data.refs) || [];
    const ops = [];
    if (!RP) return ops;
    const L = RP.panelLayout(style, cv);
    const tk = S.elementTokens(style, 'panel3');
    const r = resolvedRefs(tl, refs);
    const frames = {};
    r.frame.forEach(f => { frames[f.v.role] = f.v; });
    const clip = tl.replay ? (tl.replay.clipAsset || '') : '';
    const dur = Math.max(1, g.outMs - g.inMs);
    const step = Math.max(500, Math.min(1500, (dur - 1600) / 3));
    if (style.engine === 'classic') ops.push({ type: 'backdrop', role: 'backdrop', key: 'frame:play', clip, dim: 0.8, delay: 0, anim: 'fade' });
    // Header (left of the ES mark's clear space): the format tag and the line.
    const slide = cv.h !== H;
    const hx = L.box.x;
    const hy = slide ? 72 : 300;
    const tag = String(tl.tag || '').trim();
    let ty = hy;
    if (tag) { ops.push(...chipOp(measure, tag, hx, hy, { fill: tk.chip, ink: tk.chipInk, size: 22, h: 40, role: 'panel-tag', delay: 0 })); ty += 56; }
    const head = String((g.data && g.data.text) || tl.title || '').trim();
    if (head) {
      const hf = fitText(upperMeasure(measure), head, { family: style.type.display, weight: 700, max: 64, min: 40, maxLines: 1, width: (slide ? SLIDE_MARK.x - SLIDE_MARK.clear : LOGO_CLEAR.left) - hx - 12 });
      ops.push(...linesOps(hf, ty, { role: 'headline', color: 'ink', baseDelay: 80, delayStep: style.motion.stagger }).ops.map(o => ({ ...o, type: 'text', anim: 'mask', x: o.x - MARGIN + hx })));
    }
    L.panels.forEach((p, i) => {
      const f = frames[p.role];
      const delay = 160 + i * step;
      ops.push({ type: 'panel', role: 'panel', frame: p.role, key: f ? `frame:${p.role}` : '', clip: f ? clip : '', x: p.x, y: p.y, w: p.w, h: p.h, tilt: p.tilt, border: L.border, borderColor: tk.gutter, r: L.radius, empty: tk.fill, delay, anim: 'rise', kb: [1, 1.07], kbMs: Math.max(1800, dur - delay), refs: f ? [`frame:${p.role}`] : [] });
      ops.push(...chipOp(measure, p.label, p.chip.x, p.chip.y, { fill: tk.chip, ink: tk.chipInk, size: 28, h: 48, role: 'panel-chip', delay: delay + 140 }));
      const own = g.data && g.data.captions ? g.data.captions[p.role] : '';
      const cap = f ? String(own || f.caption || '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ') : '';
      if (cap) {
        const cf = fitText(upperMeasure(measure), cap, { family: style.type.display, weight: 700, max: 56, min: 36, maxLines: 1, width: p.w - 80 });
        const cw = cf.lines[0] ? cf.lines[0].width : 0;
        const bh = cf.size * CAP + 28;
        ops.push({ type: 'rect', role: 'panel-caption-bg', x: p.caption.x, y: p.caption.y - bh, w: cw + 32, h: bh, fill: style.caption.box || INK_DARK, r: 2, delay: delay + 260, anim: 'wipe' });
        ops.push({ type: 'text', role: 'panel-caption', text: cap.toUpperCase(), font: cf.font, size: cf.size, x: p.caption.x + 16, y: p.caption.y - 14, w: cw, color: WHITE, delay: delay + 300, anim: 'fade', refs: [`frame:${p.role}`] });
      }
    });
    return ops;
  }
  function layoutData(measure, g, tl) {
    const style = styleOf(tl);
    const cv = canvasOf(tl);
    let ops = [];
    if (g.template === 'play') ops = layoutPlay(measure, g, tl, style, cv);
    else if (g.template === 'wpline') ops = layoutWpline(measure, g, tl, style, cv);
    else if (g.template === 'moment') ops = layoutMoment(measure, g, tl, style, cv);
    else if (g.template === 'panel3') ops = layoutPanel3(measure, g, tl, style, cv);
    // Data missing at draw time (a project saved before its data loaded):
    // the Phase 0 placeholder, never an empty frame.
    if (!ops.length) ops.push({ type: 'placeholder', role: 'placeholder', element: { play: 'scorebug', wpline: 'wpline', moment: 'timeline-node', panel3: 'panel3' }[g.template], x: G.left, y: 472, w: CW, h: 160, delay: 0, anim: 'fade' });
    ops.forEach(op => { if (!op.anim) op.anim = 'fade'; });
    return ops;
  }

  // ─── Carousel slides (1080x1350) ───────────────────────────────────────
  // One slide per timeline (ReelReplay.buildSlides). The slide's own text is
  // the headline; every number on it comes through its refs, like the reel.
  function slideKey(tl, refs, sl) {
    const r = resolvedRefs(tl, refs);
    if (r.frame.length) return { key: `frame:${r.frame[0].v.role}`, clip: tl.replay ? tl.replay.clipAsset || '' : '' };
    if (r.photo.length && tl.assets && tl.assets[`photo:${r.photo[0].id}`]) return { key: `photo:${r.photo[0].id}`, clip: '' };
    if (sl && sl.asset && tl.assets && tl.assets[sl.asset]) return { key: sl.asset, clip: '' };
    return null;
  }
  function slideHeadline(measure, text, style, x, y, width, { color = 'ink', max = 104, min = 64, maxLines = 3, align = 'left', anchorBottom = null } = {}) {
    const fit = fitText(upperMeasure(measure), text, { family: style.type.display, weight: 700, max, min, maxLines, width });
    const lh = fit.size * 0.96;
    const height = fit.size * CAP + (fit.lines.length - 1) * lh;
    const top = anchorBottom != null ? anchorBottom - height : y;
    const ops = [];
    let n = 0;
    fit.lines.forEach((line, li) => {
      const x0 = align === 'center' ? x + (width - line.width) / 2 : x;
      line.words.forEach(word => {
        ops.push({ type: 'text', role: 'headline', text: word.text.toUpperCase(), font: fit.font, size: fit.size, x: x0 + word.x, y: top + fit.size * CAP + li * lh, w: word.w, color, delay: n * style.motion.stagger, anim: 'mask' });
        n += 1;
      });
    });
    return { ops, bottom: top + height, top };
  }
  function layoutSlide(measure, g, tl) {
    const style = styleOf(tl);
    const pal = style.palette;
    const kind = g.template.slice(6);
    const sl = tl.slide || {};
    const refs = (g.data && g.data.refs) || [];
    const cv = { w: 1080, h: 1350 };
    const M = 60;
    const CWS = 960;
    const ops = [];
    const text = String((g.data && g.data.text) || '').trim();
    const beside = SLIDE_MARK.x - SLIDE_MARK.clear - M; // header width left of the mark
    const tagOps = () => (tl.tag ? chipOp(measure, tl.tag, M, 72, { fill: 'chip', ink: 'chipInk', size: 22, h: 40, role: 'slide-tag', delay: 0 }) : []);
    if (kind === 'cover') {
      const key = slideKey(tl, refs, sl);
      if (key) {
        ops.push({ type: 'panel', role: 'bg', frame: '', key: key.key, clip: key.clip, x: 0, y: 0, w: 1080, h: 1350, tilt: 0, border: 0, r: 0, empty: pal.bg, delay: 0, anim: 'fade', kb: [1.04, 1.08], kbMs: 2400, noBox: true });
        ops.push({ type: 'shade', role: 'bg', y0: 520, y1: 1350, a1: 0.86, noBox: true, delay: 0, anim: 'fade' });
      }
      ops.push(...tagOps());
      const col = key ? WHITE : 'ink';
      if (text) ops.push(...slideHeadline(measure, text, style, M, 0, CWS, { color: col, max: 120, min: 72, maxLines: 3, anchorBottom: 1170 }).ops);
      const swipe = chipOp(measure, 'SWIPE  →', 0, 1212, { fill: 'hi', ink: 'hiInk', size: 26, h: 52, role: 'swipe', delay: 300 });
      const dx = SLIDE_SAFE.right - swipe[0].w;
      swipe.forEach(o => { o.x += dx; });
      ops.push(...swipe);
    } else if (kind === 'panel') {
      const r = resolvedRefs(tl, refs);
      const RP = getRP();
      if (r.frame.length >= 2 && RP) {
        const sub = layoutPanel3(measure, { ...g, data: { ...(g.data || {}), text } }, { ...tl, title: '' }, style, cv);
        ops.push(...sub.filter(o => o.type !== 'backdrop'));
      } else {
        const f = r.frame[0] ? r.frame[0].v : null;
        const key = slideKey(tl, refs, sl);
        const role = f ? f.role : '';
        const label = RP && role ? RP.ROLE_LABELS[role] : (text || '').toUpperCase();
        ops.push(...tagOps());
        const ih = 820;
        ops.push({ type: 'panel', role: 'panel', frame: role, key: key ? key.key : '', clip: key ? key.clip : '', x: M, y: 214, w: CWS, h: ih, tilt: style.id === 'classic' ? (sl.index % 2 ? 0.5 : -0.5) : 0, border: style.id === 'classic' ? 6 : (style.id === 'series' ? 4 : 0), borderColor: S.elementTokens(style, 'panel3').gutter, r: style.id === 'countdown' ? 20 : 0, empty: pal.panel, delay: 0, anim: 'rise', kb: [1.0, 1.04], kbMs: 2400, refs: f ? [`frame:${role}`] : [] });
        if (label) ops.push(...chipOp(measure, label, M + 24, 214 + 24, { fill: 'chip', ink: 'chipInk', size: 30, h: 52, role: 'panel-chip', delay: 120 }));
        const cap = String(sl.caption || (f && f.caption) || (text && text.toUpperCase() !== label ? text : '') || '').trim();
        if (cap) ops.push(...slideHeadline(measure, cap, style, M, 214 + ih + 40, CWS, { max: 76, min: 52, maxLines: 2 }).ops);
      }
    } else if (kind === 'moment') {
      ops.push(...layoutMoment(measure, { ...g, beat: '' }, tl, style, cv).map(o => ({ ...o })));
      // The year sits top-left: keep the slide tag off it.
    } else if (kind === 'data') {
      const game = gameOf(tl);
      if (game) {
        const state = scoreState(tl, refs);
        ops.push(...scorebugOps(measure, tl, style, cv, state, 0));
        ops.push(...clockOps(measure, tl, style, cv, state, 100));
        let y = 236;
        if (text) { const h2 = slideHeadline(measure, text, style, M, y, CWS, { max: 80, min: 56, maxLines: 2 }); ops.push(...h2.ops); y = h2.bottom + 40; }
        if (hasWp(tl)) {
          const full = { x: M, y: Math.max(380, snap(y)), w: CWS, h: 0 };
          full.h = Math.min(660, 1200 - full.y);
          const sw = swingFor(tl, refs);
          ops.push(...wpOps(measure, tl, style, full, { mode: 'full', from: sw ? sw.fromSeq : null, to: sw ? sw.seq : null, marker: sw, delay: 120 }));
          ops.push(...attributionOps(measure, tl, style, M, full.y + full.h + 40, 200));
        } else if (state && state.play) {
          ops.push(...playcardOps(measure, tl, style, { x: M, y: Math.max(400, y), w: CWS, h: 200 }, { data: { text: '' } }, state.play, 120).ops);
        }
      } else {
        const athlete = tl.data && tl.data.athlete;
        ops.push(...tagOps());
        let y = 236;
        if (text) { const h2 = slideHeadline(measure, text, style, M, y, CWS, { max: 88, min: 56, maxLines: 2 }); ops.push(...h2.ops); y = h2.bottom + 48; }
        if (athlete && athlete.stats && Array.isArray(athlete.stats.totals)) {
          const info = momentInfo(tl, ['stat:totals']);
          ops.push(...statTilesOps(measure, style, info.tiles, { x: M, y, w: CWS, h: 220 }, 120));
          const src = sourceLine(info);
          if (src) ops.push(textOp(measure, src.text, S.LABEL, 700, 22, M, y + 220 + 56, { role: 'source', color: 'muted', track: 1.2, delay: 300, anim: 'fade', refs: src.refs }));
        }
      }
    } else if (kind === 'cta') {
      ops.push({ type: 'rect', role: 'rule', x: (1080 - 120) / 2, y: 470, w: 120, h: 10, fill: 'accent', r: 2, delay: 0, anim: 'grow' });
      const h2 = slideHeadline(measure, text || 'What do you think?', style, M, 540, CWS, { max: 104, min: 64, maxLines: 3, align: 'center' });
      ops.push(...h2.ops);
      const wm = wordmarkFor(tl);
      ops.push({ type: 'wordmark', role: 'wordmark', brand: wm.id, x: (1080 - wm.w) / 2, y: snap(h2.bottom + 88), w: wm.w, h: wm.h, delay: 240, anim: 'rise' });
      ops.push(textOp(measure, 'TELL US IN THE COMMENTS', S.LABEL, 700, 26, 0, snap(h2.bottom + 88) + wm.h + 72, { role: 'cta-note', color: 'muted', align: 'center', width: 1080, track: 2, delay: 360, anim: 'fade' }));
    }
    ops.forEach(op => { if (!op.anim) op.anim = 'fade'; });
    void cv;
    return ops;
  }

  // ─── Data formats: drawing ──────────────────────────────────────────────
  // The new op types (score, circle, wpchart, panel, backdrop, shade,
  // placeholder). drawStyledOp hands them here, so no existing op changes.
  function frameImage(env, key, clip) {
    const img = key && env.images ? env.images[key] : null;
    if (mediaSize(img)) return img;
    const vid = clip && env.videos ? env.videos[clip] : null;
    if (vid && (vid.readyState || 0) >= 2 && mediaSize(vid)) return vid;
    const poster = clip && env.images ? env.images[clip] : null;
    return mediaSize(poster) ? poster : null;
  }
  function drawDataOp(ctx, op, st, timeline, env, frame, pal, style) {
    if (op.type === 'score') {
      // Counts from the score before a scoring play to the score after it,
      // then pulses once (120 ms up, 120 ms back: 1.0 -> 1.12 -> 1.0).
      const local = st.local == null ? 99999 : st.local;
      const c = ease.outCubic(progress(local, op.countDelay || 0, op.countMs || 600));
      const value = op.from === op.to ? op.to : Math.round(op.from + (op.to - op.from) * c);
      const text = String(value);
      ctx.font = op.font;
      const w = env.measure ? env.measure(text, op.font) : op.w;
      const x = op.cellX != null ? op.cellX + (op.cellW - w) / 2 : op.x;
      const landed = local - (op.countDelay || 0) - (op.countMs || 600);
      const k = op.from !== op.to && landed >= 0 && landed < 240 ? 1 + 0.12 * Math.sin(Math.PI * (landed / 240)) : 1;
      ctx.save();
      if (k !== 1) { const cx = x + w / 2; const cy = op.y - op.size * CAP / 2; ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy); }
      ctx.fillStyle = tone(pal, op.color);
      ctx.fillText(text, x, op.y);
      ctx.restore();
    } else if (op.type === 'circle') {
      const k = op.pulse ? 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(((frame.t || 0) / 1000) * Math.PI * 2)) : 1;
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r * k, 0, Math.PI * 2);
      if (op.fill) { ctx.fillStyle = tone(pal, op.fill); ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = tone(pal, op.stroke); ctx.lineWidth = op.lw || 3; ctx.stroke(); }
    } else if (op.type === 'wpchart') {
      drawWpChart(ctx, op, st, pal);
    } else if (op.type === 'panel') {
      drawPanel(ctx, op, st, timeline, env, frame, pal);
    } else if (op.type === 'backdrop') {
      const img = frameImage(env, op.key, op.clip);
      if (img) {
        ctx.save();
        drawCover(ctx, img, 0, 0, W, H, { zoom: 1.12, fx: 0.5, fy: 0.45 });
        ctx.fillStyle = `rgba(11,13,18,${op.dim || 0.8})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    } else if (op.type === 'shade') {
      if (typeof ctx.createLinearGradient === 'function') {
        const g = ctx.createLinearGradient(0, op.y0, 0, op.y1);
        g.addColorStop(0, 'rgba(8,10,14,0)');
        g.addColorStop(1, `rgba(8,10,14,${op.a1 || 0.85})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, op.y0, W, op.y1 - op.y0);
      }
    } else if (op.type === 'placeholder') {
      S.drawPlaceholder(ctx, op.element, { x: op.x, y: op.y, w: op.w, h: op.h }, style.id);
    }
  }
  // A frame panel: the still, a slow Ken Burns push, the border, a tilt
  // (Classic), or the empty state when no frame is picked yet.
  function drawPanel(ctx, op, st, timeline, env, frame, pal) {
    const img = frameImage(env, op.key, op.clip);
    ctx.save();
    if (op.tilt) { const cx = op.x + op.w / 2; const cy = op.y + op.h / 2; ctx.translate(cx, cy); ctx.rotate((op.tilt * Math.PI) / 180); ctx.translate(-cx, -cy); }
    ctx.beginPath();
    if (op.r) roundRect(ctx, op.x, op.y, op.w, op.h, op.r); else ctx.rect(op.x, op.y, op.w, op.h);
    ctx.save();
    ctx.clip();
    if (img) {
      const [z0, z1] = op.kb || [1, 1];
      const p = ease.inOutSine(progress(st.local == null ? 0 : st.local, 0, op.kbMs || 2400));
      drawCover(ctx, img, op.x, op.y, op.w, op.h, { zoom: z0 + (z1 - z0) * p, fx: 0.5, fy: 0.42 });
      if (op.h > 200 && typeof ctx.createLinearGradient === 'function' && op.role !== 'bg') {
        const g = ctx.createLinearGradient(0, op.y + op.h * 0.55, 0, op.y + op.h);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.42)');
        ctx.fillStyle = g;
        ctx.fillRect(op.x, op.y + op.h * 0.55, op.w, op.h * 0.45);
      }
    } else {
      ctx.fillStyle = tone(pal, op.empty || 'mystery');
      ctx.fillRect(op.x, op.y, op.w, op.h);
      if (op.role !== 'bg') {
        ctx.globalAlpha *= 0.7;
        ctx.fillStyle = tone(pal, 'muted');
        ctx.font = font(700, 26, S.LABEL);
        const msg = 'PICK A FRAME';
        const w = ctx.measureText ? (ctx.measureText(msg).width || 0) : 0;
        ctx.fillText(msg, op.x + (op.w - w) / 2, op.y + op.h / 2 + 9);
      }
    }
    ctx.restore();
    if (op.border) { ctx.strokeStyle = tone(pal, op.borderColor || 'ink'); ctx.lineWidth = op.border; ctx.stroke(); }
    ctx.restore();
  }
  // The WP chart: guides (0 / 50 / 100), team-coloured areas either side of
  // 50%, the line drawing on, the swing highlighted and its marker landing.
  function drawWpChart(ctx, op, st, pal) {
    const { px, py, pw, ph, s0, s1 } = op.geo;
    const X = seq => px + ((seq - s0) / (s1 - s0)) * pw;
    const Y = wp => py + (1 - Math.max(0, Math.min(1, wp))) * ph;
    const pts = (op.upto != null ? op.points.filter(p => p[0] <= op.upto) : op.points);
    if (!pts.length) return;
    const e = ease.inOutCubic(progress(st.local == null ? 99999 : st.local, 0, op.drawMs || 1200));
    const lastX = X(pts[pts.length - 1][0]);
    const revealX = px + (Math.max(px, lastX) - px) * e;
    // Panel.
    ctx.fillStyle = op.panel;
    fillRound(ctx, op.x, op.y, op.w, op.h, op.r || 0);
    if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = 3; roundRect(ctx, op.x, op.y, op.w, op.h, op.r || 0); ctx.stroke(); }
    // Guides.
    ctx.save();
    ctx.strokeStyle = tone(pal, op.guide);
    ctx.globalAlpha *= 0.9;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + pw, py); ctx.moveTo(px, py + ph); ctx.lineTo(px + pw, py + ph); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(px, Y(0.5)); ctx.lineTo(px + pw, Y(0.5)); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.restore();
    // The series as a path (steps between points read as a broadcast WP chart).
    const path = () => { ctx.beginPath(); pts.forEach((p, i) => { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); };
    ctx.save();
    ctx.beginPath(); ctx.rect(px - 8, op.y, revealX - px + 16, op.h); ctx.clip();
    // Areas: home colour above 50%, away colour below.
    [['home', py, Y(0.5) - py], ['away', Y(0.5), py + ph - Y(0.5)]].forEach(([side, y, h]) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(px, y, pw, h); ctx.clip();
      path();
      ctx.lineTo(X(pts[pts.length - 1][0]), Y(0.5));
      ctx.lineTo(X(pts[0][0]), Y(0.5));
      ctx.closePath();
      ctx.globalAlpha *= 0.26;
      ctx.fillStyle = op.colors[side];
      ctx.fill();
      ctx.restore();
    });
    // The swing: a highlighter stroke under the line.
    if (op.from != null && op.to != null && op.to !== op.from) {
      const seg = pts.filter(p => p[0] >= op.from && p[0] <= op.to);
      if (seg.length >= 2) {
        ctx.save();
        ctx.strokeStyle = op.hi;
        ctx.globalAlpha *= 0.9;
        ctx.lineWidth = op.mode === 'full' ? 18 : 12;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); seg.forEach((p, i) => { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.strokeStyle = tone(pal, op.line);
    ctx.lineWidth = op.mode === 'full' ? 6 : 4;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    path();
    ctx.stroke();
    ctx.restore();
    // The head of the line while it draws.
    if (e < 1) {
      let hy = Y(pts[0][1]);
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]; const b = pts[i];
        if (X(b[0]) >= revealX) { const k = (revealX - X(a[0])) / Math.max(1e-6, X(b[0]) - X(a[0])); hy = Y(a[1] + (b[1] - a[1]) * k); break; }
        hy = Y(b[1]);
      }
      ctx.fillStyle = tone(pal, op.line);
      ctx.beginPath(); ctx.arc(revealX, hy, op.mode === 'full' ? 9 : 7, 0, Math.PI * 2); ctx.fill();
    }
    // The marker lands once the line reaches it.
    const mk = op.to != null ? (op.points.find(p => p[0] === op.to) || null) : null;
    if (mk && revealX >= X(mk[0]) - 0.5) {
      const land = progress(st.local == null ? 99999 : st.local, op.drawMs || 1200, 300);
      const r = (op.mode === 'full' ? 14 : 10) * (0.6 + 0.4 * ease.outBack(land));
      ctx.fillStyle = op.hi;
      ctx.strokeStyle = op.ink;
      ctx.lineWidth = op.mode === 'full' ? 5 : 4;
      ctx.beginPath(); ctx.arc(X(mk[0]), Y(mk[1]), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  // A 1080x1350 carousel slide (ReelReplay.buildSlides): the style's ground,
  // the slide's ops, the ES mark top-right.
  function drawSlideFrame(ctx, timeline, tMs, env) {
    const style = styleOf(timeline);
    const pal = style.palette;
    const g = timeline.tracks && timeline.tracks.graphics ? timeline.tracks.graphics[0] : null;
    const t = Math.max(0, Math.min((timeline.durationMs || 2400) - 1, tMs));
    const frame = { t, shot: null, prev: null, mix: 1, graphic: g ? { ...g, local: t - g.inMs, exit: 0 } : null, transition: null, beatIndex: 0, caption: null };
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, 1080, 1350); ctx.clip();
    if (style.engine === 'classic') {
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, 1080, 1350);
      if (typeof ctx.createRadialGradient === 'function') {
        const glow = ctx.createRadialGradient(1080 * 0.25, 1350 * 0.1, 0, 1080 * 0.25, 1350 * 0.1, 1350);
        glow.addColorStop(0, 'rgba(10,111,222,0.18)');
        glow.addColorStop(1, 'rgba(10,111,222,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 1080, 1350);
      }
    } else drawBackground(ctx, timeline, frame, env, style, pal);
    drawStyledGraphic(ctx, frame, timeline, env, style, pal);
    if (typeof ctx.createRadialGradient === 'function') {
      const v = ctx.createRadialGradient(540, 640, 420, 540, 675, 1000);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, style.theme === 'dark' ? 'rgba(0,0,0,0.32)' : 'rgba(40,34,24,0.08)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, 1080, 1350);
    }
    // The mark's colourway: what is under it (a full-bleed cover frame is probed).
    let bg = style.engine === 'classic' ? pal.bg : pal.paper;
    if (g && g.template === 'slide-cover' && typeof ctx.getImageData === 'function' && env.probeMark !== false) {
      try {
        const data = ctx.getImageData(SLIDE_MARK.x, SLIDE_MARK.y, SLIDE_MARK.w, SLIDE_MARK.h).data;
        let r = 0; let gg = 0; let b = 0; let n = 0;
        for (let i = 0; i < data.length; i += 64) { r += data[i]; gg += data[i + 1]; b += data[i + 2]; n += 1; }
        if (n) bg = `#${hex2(r / n)}${hex2(gg / n)}${hex2(b / n)}`;
      } catch { /* tainted: keep the paper */ }
    }
    drawSquareMark(ctx, SLIDE_MARK.x, SLIDE_MARK.y, SLIDE_MARK.w, markVariant(bg), env);
    ctx.restore();
    return frame;
  }

  // ─── Data formats: provenance (the lint's "every number has a ref") ────
  // The numbers a set of refs may put on screen: every number in the
  // resolved data, a WP value as whole percentages for both teams, and the
  // overtime count ("2OT"). 'game:final' is the digest's final score.
  function provenanceNumbers(timeline, refs) {
    const T = getT();
    const set = new Set(['0']);
    const add = v => F.numbersIn(String(v == null ? '' : v)).forEach(n => set.add(n));
    const game = gameOf(timeline);
    (refs || []).forEach(ref => {
      if (ref === 'game:final') { if (game) { add(JSON.stringify(game.teams)); add(game.status && game.status.detail); } return; }
      const r = T && T.parseRef(ref);
      const v = r ? T.resolveRef(timeline, ref) : null;
      if (!v) return;
      add(JSON.stringify(v));
      const wp = r.type === 'wp' ? v.wpHome : (r.type === 'play' ? v.wpHome : null);
      if (wp != null && Number.isFinite(Number(wp))) { add(pct(wp)); add(pct(1 - wp)); }
      if (r.type === 'play' && Number.isInteger(v.period) && v.period > 4) add(v.period - 4);
    });
    return set;
  }
  // Every drawn op of a data beat or slide that shows a digit, with the
  // numbers its refs do not back. Headlines are the beat's own text (the
  // numbers rule checks those against the sources and the beat's refs).
  const DIGIT = /\d/;
  function unbackedNumbers(measure, timeline) {
    const out = [];
    const m = measure || ((text, f) => String(text).length * Number((String(f).match(/([\d.]+)px/) || [0, 40])[1]) * 0.55);
    (timeline.tracks.graphics || []).forEach(g => {
      if (!DATA_TEMPLATES.has(g.template) && !SLIDE_TEMPLATES.has(g.template)) return;
      layoutGraphic(m, g, timeline).forEach(op => {
        if (!(op.type === 'text' || op.type === 'count' || op.type === 'score' || op.type === 'word') || !DIGIT.test(String(op.text || ''))) return;
        if (op.role === 'headline') return;
        const allowed = provenanceNumbers(timeline, op.refs || []);
        const bad = F.numbersIn(op.text).filter(n => !allowed.has(n));
        if (!op.refs || !op.refs.length || bad.length) out.push({ beat: g.beat, role: op.role, text: op.text, numbers: bad.length ? bad : F.numbersIn(op.text), refs: op.refs || [] });
      });
    });
    return out;
  }
  // Is the WP line or a WP number on a beat, and is the attribution drawn?
  function wpOnScreen(measure, timeline) {
    const m = measure || ((text, f) => String(text).length * Number((String(f).match(/([\d.]+)px/) || [0, 40])[1]) * 0.55);
    return (timeline.tracks.graphics || []).filter(g => DATA_TEMPLATES.has(g.template) || SLIDE_TEMPLATES.has(g.template)).map(g => {
      const ops = layoutGraphic(m, g, timeline);
      const wp = ops.some(op => op.type === 'wpchart' || (op.refs || []).some(r => String(r).startsWith('wp:')) || op.role === 'wp-callout');
      const attribution = ops.filter(op => op.role === 'attribution').map(op => op.text);
      return { beat: g.beat, wp, attribution };
    });
  }

  // ─── Styled drawing ─────────────────────────────────────────────────────
  // Entrances: rise (32 px, out-cubic), mask (a word slides up out of its own
  // line box, out-expo, the kinetic-type look), pop, flip, wipe, grow, draw.
  const MASK_MS = 620;
  function animState(op, local, style, exitP) {
    const l = local - (op.delay || 0);
    const exitE = ease.outCubic(exitP);
    const exitA = 1 - exitE;
    if (op.anim === 'mask') {
      const e = ease.outExpo(progress(l, 0, MASK_MS));
      return { p: e, a: l >= 0 ? exitA : 0, dy: (1 - e) * (op.size || 40) * 1.05 - 16 * exitE, local: l };
    }
    const p = ease.outCubic(progress(l, 0, style.motion.durMs));
    const dy = op.anim === 'rise' ? (1 - p) * 36 - 16 * exitE : -16 * exitE;
    return { p, a: p * exitA, dy, local: l };
  }
  function withAnim(ctx, op, st, fn) {
    if (st.a <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= st.a;
    const cx = op.x + (op.w || 0) / 2;
    const cy = (op.type === 'text' || op.type === 'count') ? op.y - op.size * CAP / 2 : op.y + (op.h || 0) / 2;
    if (op.anim === 'mask' && (op.type === 'text' || op.type === 'count')) {
      ctx.beginPath();
      ctx.rect(op.x - op.size * 0.2, op.y - op.size * (CAP + 0.2), op.w + op.size * 0.4, op.size * (CAP + 0.44));
      ctx.clip();
    } else if (op.anim === 'flip') { ctx.translate(cx, 0); ctx.scale(Math.max(0.02, st.p), 1); ctx.translate(-cx, 0); } else if (op.anim === 'pop') {
      const k = 0.86 + 0.14 * ease.outBack(st.p);
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
    } else if (op.anim === 'wipe' && (op.type === 'rect' || op.type === 'visual')) {
      ctx.beginPath(); ctx.rect(op.x - 8, op.y - 8, ((op.w || 0) + 16) * st.p, (op.h || 0) + 16); ctx.clip();
    }
    ctx.translate(0, st.dy);
    fn();
    ctx.restore();
  }
  function fillRound(ctx, x, y, w, h, r) {
    if (r > 0) { roundRect(ctx, x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h);
  }
  const setTrack = (ctx, px) => { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px || 0}px`; };
  function drawStyledOp(ctx, op, st, timeline, env, frame, pal, style) {
    if (op.type === 'rect') {
      ctx.fillStyle = tone(pal, op.fill);
      const w = op.anim === 'grow' ? op.w * ease.outQuint(st.p) : op.w;
      fillRound(ctx, op.x, op.y, w, op.h, op.r || 0);
      if (op.stroke) { ctx.strokeStyle = tone(pal, op.stroke); ctx.lineWidth = op.lw || 2; roundRect(ctx, op.x, op.y, op.w, op.h, op.r || 0); ctx.stroke(); }
    } else if (op.type === 'text' || op.type === 'word') {
      ctx.font = op.font;
      if (op.bg) {
        // The highlight box sweeps in from the left once the word has landed.
        const padX = op.size * 0.1;
        const reveal = ease.outQuint(progress(st.local == null ? st.p * 400 : st.local - 180, 0, 380));
        ctx.fillStyle = tone(pal, op.bg);
        fillRound(ctx, op.x - padX, op.y - op.size * CAP - op.size * 0.12, (op.w + padX * 2) * reveal, op.size * (CAP + 0.24), op.size * 0.04);
      }
      if (op.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = op.size * 0.05; ctx.strokeStyle = tone(pal, op.stroke); ctx.strokeText(op.text, op.x, op.y); }
      const lit = op.bg && progress(st.local == null ? 999 : st.local - 180, 0, 380) > 0.35;
      ctx.fillStyle = lit ? tone(pal, op.bgInk || 'ink') : tone(pal, op.color);
      if (style.theme === 'dark' && !op.bg) textShadow(ctx, true);
      if (op.track) setTrack(ctx, op.track);
      ctx.fillText(op.text, op.x, op.y);
      if (op.track) setTrack(ctx, 0);
    } else if (op.type === 'count') {
      ctx.font = op.font;
      ctx.fillStyle = tone(pal, op.color);
      if (style.theme === 'dark') textShadow(ctx, true);
      const c = op.once ? ease.outQuint(progress(frame.t, 200, 900)) : ease.outQuint(progress(st.local == null ? 900 : st.local, 0, op.countMs || 900));
      ctx.fillText(op.spec ? formatStat(op.spec, op.spec.num * c) : op.text, op.x, op.y);
    } else if (op.type === 'line') {
      const e = op.anim === 'draw' ? ease.outCubic(st.p) : 1;
      ctx.strokeStyle = tone(pal, op.color);
      ctx.lineWidth = op.lw || 3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x1 + (op.x2 - op.x1) * e, op.y1 + (op.y2 - op.y1) * e); ctx.stroke();
    } else if (op.type === 'wordmark') {
      drawBrand(ctx, op.brand || 'wordmark', op.x, op.y, op.w, op.h, 'blue', env, ctx.globalAlpha);
    } else if (op.type === 'visual' || op.type === 'logo') {
      const slot = op.slot === 'shot' ? (frame.shot && frame.shot.asset) || '' : op.slot;
      ctx.save();
      ctx.beginPath();
      if (op.r) roundRect(ctx, op.x, op.y, op.w, op.h, op.r); else ctx.rect(op.x, op.y, op.w, op.h);
      if (op.type === 'logo') {
        const img = env.images && env.images[slot];
        const size = mediaSize(img);
        if (size) { const k = Math.min(op.w / size[0], op.h / size[1]); ctx.drawImage(img, op.x + (op.w - size[0] * k) / 2, op.y + (op.h - size[1] * k) / 2, size[0] * k, size[1] * k); }
        ctx.restore();
        return;
      }
      ctx.clip();
      // With a cut-out: the frame shows the beat's clip (or its second
      // picture, or the same one darker) and the player stands over it.
      const cutId = op.cutout && env.cutouts ? (op.cutoutAsset && env.cutouts[op.cutoutAsset] ? op.cutoutAsset : (slot && env.cutouts[slot] ? slot : '')) : '';
      const cut = cutId ? env.cutouts[cutId] : null;
      const inset = cut && cutId === slot ? ((frame.shot && timeline.tracks.video.find(s => s.beat === frame.shot.beat && s.asset && s.asset !== slot)) || {}).asset || slot : slot;
      drawVisual(ctx, inset, op, timeline, env, { p: frame.shot ? frame.shot.p : 0, motion: frame.shot ? frame.shot.motion : null, tMs: frame.t });
      if (cut && inset === slot) { ctx.fillStyle = 'rgba(10,12,16,0.45)'; ctx.fillRect(op.x, op.y, op.w, op.h); }
      // A soft inner shade at the bottom so chips and names on the picture read.
      if (op.h > 200 && typeof ctx.createLinearGradient === 'function') {
        const sh = ctx.createLinearGradient(0, op.y + op.h * 0.6, 0, op.y + op.h);
        sh.addColorStop(0, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,0,0,0.28)');
        ctx.fillStyle = sh;
        ctx.fillRect(op.x, op.y + op.h * 0.6, op.w, op.h * 0.4);
      }
      ctx.restore();
      if (op.stroke) { ctx.strokeStyle = tone(pal, op.stroke); ctx.lineWidth = op.lw || 4; ctx.beginPath(); if (op.r) roundRect(ctx, op.x, op.y, op.w, op.h, op.r); else ctx.rect(op.x, op.y, op.w, op.h); ctx.stroke(); }
      if (cut) {
        const size = mediaSize(cut);
        if (size) {
          const h = op.h * 1.32;
          const w = (size[0] / size[1]) * h;
          // The player rises out of the frame, then breathes in slowly.
          const lift = (1 - st.p) * 40;
          const k = 1 + 0.025 * ease.inOutSine(progress(frame.t - (frame.graphic ? frame.graphic.inMs : 0), 0, 4000));
          ctx.drawImage(cut, op.x + op.w * 0.62 - (w * k) / 2, op.y + op.h - h * k + lift, w * k, h * k);
        }
      }
    } else if (op.type === 'dotring') {
      // Phyllotaxis: n dots from r0 to r1, rank 1 nearest the centre; dots
      // bloom outwards, then the rank's ring sweeps round and its dot lands.
      const shown = Math.floor(op.n * ease.outCubic(st.p));
      const ga = Math.PI * (3 - Math.sqrt(5));
      ctx.fillStyle = tone(pal, 'muted');
      ctx.globalAlpha = 0.5 * st.a;
      for (let i = 0; i < shown; i += 1) {
        const f = op.n > 1 ? i / (op.n - 1) : 0;
        const rr = op.r0 + (op.r1 - op.r0) * Math.sqrt(f);
        const a = i * ga;
        ctx.fillRect(op.cx + Math.cos(a) * rr - 2.5, op.cy + Math.sin(a) * rr - 2.5, 5, 5);
      }
      ctx.globalAlpha = st.a;
      const rr = op.rr != null ? op.rr : op.r0 + (op.r1 - op.r0) * Math.sqrt(op.total > 1 ? (op.rank - 1) / (op.total - 1) : 0);
      const sweep = ease.inOutCubic(progress(st.local == null ? 1200 : st.local, 300, 700));
      ctx.strokeStyle = tone(pal, 'accent');
      ctx.lineWidth = 4;
      if (ctx.setLineDash) ctx.setLineDash([14, 10]);
      ctx.beginPath(); ctx.arc(op.cx, op.cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep); ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      if (sweep > 0.98) {
        const pop = 1 + 0.4 * (1 - ease.outBack(progress(st.local, 1000, 300)));
        ctx.fillStyle = tone(pal, 'bad');
        ctx.beginPath(); ctx.arc(op.cx, op.cy - rr, 11 * pop, 0, Math.PI * 2); ctx.fill();
      }
    } else if (DATA_OPS.has(op.type)) {
      drawDataOp(ctx, op, st, timeline, env, frame, pal, style);
    }
  }
  function drawBackground(ctx, timeline, frame, env, style, pal) {
    const layout = frame.graphic ? frame.graphic.template : '';
    const shot = frame.shot;
    const clipBehind = shot && shot.asset && timeline.assets[shot.asset] && timeline.assets[shot.asset].kind === 'clip' && CHART_LAYOUTS.has(layout);
    ctx.fillStyle = pal.paper;
    ctx.fillRect(0, 0, W, H);
    if (clipBehind) {
      // Data beats sit over the clip, tinted to the paper so the chart reads.
      ctx.save();
      drawVisual(ctx, shot.asset, { x: 0, y: 0, w: W, h: H }, timeline, env, { p: shot.p, motion: shot.motion, tMs: frame.t });
      ctx.globalAlpha = style.theme === 'light' ? 0.86 : 0.8;
      ctx.fillStyle = pal.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // Depth: light papers catch a soft light from the top-left; the navy gets
    // a low accent glow behind the content.
    // (The ES style is flat: no glow behind its data layouts, in any look.)
    if (style.engine !== 'es' && typeof ctx.createRadialGradient === 'function') {
      const glow = ctx.createRadialGradient(W * 0.2, H * 0.12, 0, W * 0.2, H * 0.12, H * 0.9);
      glow.addColorStop(0, style.theme === 'light' ? 'rgba(255,255,255,0.55)' : 'rgba(47,128,237,0.16)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
    // Texture: dots (explainer), a grid (series), diagonal lines (countdown).
    ctx.save();
    ctx.globalAlpha = style.theme === 'light' ? 0.07 : 0.06;
    ctx.fillStyle = pal.ink;
    ctx.strokeStyle = pal.ink;
    if (pal.texture === 'dots') { for (let y = 16; y < H; y += 40) for (let x = 16; x < W; x += 40) ctx.fillRect(x, y, 3, 3); } else if (pal.texture === 'grid') {
      ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= W; x += 72) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 0; y <= H; y += 72) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    } else if (pal.texture === 'lines') {
      ctx.lineWidth = 2; ctx.beginPath();
      for (let k = -H; k < W; k += 56) { ctx.moveTo(k, H); ctx.lineTo(k + H * 0.6, 0); }
      ctx.stroke();
    }
    ctx.restore();
  }
  // Styles with a push transition hold their entrances 300 ms ahead, so the
  // incoming beat arrives already composed and then settles.
  const leadFor = style => (style.engine !== 'classic' && ['slide', 'wipe', 'flip'].includes(style.motion.transition) ? 300 : 0);
  function drawStyledGraphic(ctx, frame, timeline, env, style, pal) {
    const g = frame.graphic;
    if (!g) return;
    // A story beat of a data format in the ES style is an ES block scene:
    // the ES engine draws it (the look's ground, boxed words, its own mark).
    if (style.engine === 'es' && ES_TEMPLATES.has(g.template) && getES()) {
      const E = getES();
      const eg = esGraphic(g);
      E.drawScene(ctx, eg, timeline, frame, env, { drawVisual, drawBrand, BRAND }, E.sceneTimes(eg, g.local), layoutGraphic);
      return;
    }
    const ops = env.layoutCache ? env.layoutCache(g) : layoutGraphic(env.measure, g, timeline);
    const lead = g.inMs === 0 ? 0 : leadFor(style);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ops.forEach(op => {
      // Frame 0 is the cover in every feed: the hook's headline is already
      // set (its highlight swept), the rest of the beat still builds in.
      const cover = g.inMs === 0 ? (op.role === 'headline' ? 1200 : ((op.delay || 0) <= 80 ? 200 : 0)) : 0;
      const st = animState(op, g.local + lead + cover, style, g.exit);
      withAnim(ctx, op, st, () => drawStyledOp(ctx, op, st, timeline, env, frame, pal, style));
    });
    ctx.restore();
  }
  function drawChrome(ctx, frame, timeline, env, style, pal) {
    const ops = layoutChrome(env.measure, timeline, frame).filter(op => op.type !== 'esmark');
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ops.forEach(op => drawStyledOp(ctx, op, { p: 1, a: 1, dy: 0, local: frame.t }, timeline, env, frame, pal, style));
    ctx.restore();
  }
  // Block captions: each word in a dark box; the spoken word turns yellow
  // with a small pop; the card rises in.
  function drawBlockCaption(ctx, frame, timeline, env, style, pal) {
    const card = frame.caption;
    if (!card) return;
    const layout = env.captionCache ? env.captionCache(card) : layoutCaption(env.measure, card, timeline);
    const appear = ease.outCubic(progress(card.local, 0, 120));
    const words = timeline.tracks.captions.words;
    ctx.save();
    ctx.globalAlpha = appear;
    const dy = (1 - appear) * 14;
    layout.ops.forEach(op => {
      const on = op.i === card.active;
      const k = on ? 1 + 0.07 * (1 - ease.outCubic(progress(frame.t - words[op.i].s, 0, 180))) : 1;
      ctx.save();
      const cx = op.box.x + op.box.w / 2;
      const cy = op.box.y + dy + op.box.h / 2;
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      ctx.fillStyle = style.caption.box || '#111214';
      ctx.fillRect(op.box.x, op.box.y + dy, op.box.w, op.box.h);
      ctx.font = op.font;
      ctx.fillStyle = on ? (style.caption.active || '#FFD23F') : (style.caption.ink || '#FFFFFF');
      ctx.fillText(op.text, op.x, op.y + dy);
      ctx.restore();
    });
    ctx.restore();
    void pal;
  }

  // ─── Finish: vignette, grain (pros' last pass) ─────────────────────────
  // Under the ES mark, never over it (no effects on the logo). The light leak
  // was removed (2026-11-21): lens flares are banned in the ES video system.
  function drawFinish(ctx, frame, timeline, env) {
    const style = styleOf(timeline);
    const dark = style.theme === 'dark';
    ctx.save();
    if (typeof ctx.createRadialGradient === 'function') {
      const v = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.3, W / 2, H * 0.5, H * 0.82);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, dark ? 'rgba(0,0,0,0.38)' : 'rgba(40,34,24,0.10)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
      // No light leaks (lens flares are banned in the ES video system).
    }
    if (env.grain && typeof ctx.createPattern === 'function') {
      const pattern = ctx.createPattern(env.grain, 'repeat');
      if (pattern) {
        const n = Math.floor((frame.t || 0) / 42);
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = dark ? 0.08 : 0.05;
        ctx.translate((n * 37) % 128, (n * 61) % 128);
        ctx.fillStyle = pattern;
        ctx.fillRect(-128, -128, W + 256, H + 256);
      }
    }
    ctx.restore();
  }

  // Beat to beat: push (explainer), wipe with an ink bar (series), lift and
  // flip (countdown). The outgoing beat is drawn whole; chrome stays put.
  function drawStyledGraphics(ctx, frame, timeline, env, style, pal) {
    const tr = frame.transition;
    if (!tr) { drawStyledGraphic(ctx, frame, timeline, env, style, pal); return; }
    const e = ease.inOutQuart(tr.p);
    const out = { ...frame, graphic: tr.from, shot: tr.fromShot || frame.shot };
    if (tr.kind === 'slab' && getES()) {
      // ES slab wipe (data formats in the ES style): the cut under the ink.
      if (tr.p < 0.5) drawStyledGraphic(ctx, out, timeline, env, style, pal);
      else { drawBackground(ctx, timeline, frame, env, style, pal); drawStyledGraphic(ctx, frame, timeline, env, style, pal); }
      getES().drawSlab(ctx, tr.p, getES().geometry(timeline.size), getES().themeOf(timeline));
      return;
    }
    if (tr.kind === 'slide') {
      ctx.save(); ctx.translate(-W * e, 0); drawStyledGraphic(ctx, out, timeline, env, style, pal); ctx.restore();
      ctx.save(); ctx.translate(W * (1 - e), 0); drawStyledGraphic(ctx, frame, timeline, env, style, pal); ctx.restore();
    } else if (tr.kind === 'wipe') {
      drawStyledGraphic(ctx, out, timeline, env, style, pal);
      const x = W * e;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, x, H); ctx.clip();
      drawBackground(ctx, timeline, frame, env, style, pal);
      drawStyledGraphic(ctx, frame, timeline, env, style, pal);
      ctx.restore();
      if (e > 0 && e < 1) { ctx.fillStyle = tone(pal, 'ink'); ctx.fillRect(x - 18, 0, 18, H); ctx.fillStyle = tone(pal, 'hi'); ctx.fillRect(x - 24, 0, 6, H); }
    } else {
      // Lift: the outgoing card clears in the first 40% before the next flips in.
      const gone = ease.outCubic(progress(tr.p, 0, 0.4));
      if (gone < 1) { ctx.save(); ctx.globalAlpha = 1 - gone; ctx.translate(0, -90 * gone); drawStyledGraphic(ctx, out, timeline, env, style, pal); ctx.restore(); }
      ctx.save(); ctx.translate(0, 70 * (1 - e)); drawStyledGraphic(ctx, frame, timeline, env, style, pal); ctx.restore();
    }
  }
  function drawStyledFrame(ctx, timeline, frame, env) {
    const style = styleOf(timeline);
    const pal = style.palette;
    drawBackground(ctx, timeline, frame, env, style, pal);
    drawStyledGraphics(ctx, frame, timeline, env, style, pal);
    drawChrome(ctx, frame, timeline, env, style, pal);
    if (timeline.captionStyle === 'es' && getES()) getES().drawCaption(ctx, frame, timeline, env);
    else if (timeline.captionStyle === 'block') drawBlockCaption(ctx, frame, timeline, env, style, pal);
    else drawCaption(ctx, frame, timeline, env);
  }

  // env: { measure(text, font), images: { assetId: Image }, grain }
  function drawFrame(ctx, timeline, tMs, env = {}) {
    // A 4:5 carousel slide (canvas 1080x1350) draws as a slide.
    if (timeline && timeline.canvas && Number(timeline.canvas.h) === 1350) return drawSlideFrame(ctx, timeline, tMs, env);
    const frame = frameAt(timeline, tMs);
    // ES house style: paper, blocks, slab wipes, one-line captions and its
    // own marks (no vignette or finish pass: flat 2D).
    if (isEs(timeline)) {
      ctx.save();
      getES().drawFrame(ctx, timeline, frame, env, { drawVisual, drawBrand, BRAND }, layoutGraphic);
      ctx.restore();
      return frame;
    }
    ctx.save();
    if (styleOf(timeline).engine !== 'classic') {
      drawStyledFrame(ctx, timeline, frame, env);
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);
      if (frame.prev) drawShot(ctx, frame.prev, timeline, env, 1);
      drawShot(ctx, frame.shot, timeline, env, frame.prev ? frame.mix : 1);
      drawGrade(ctx, timeline);
      drawGraphic(ctx, frame, timeline, env);
      drawCaption(ctx, frame, timeline, env);
    }
    // The ES style is flat 2D: no vignette or moving grain, on data formats too.
    if (styleOf(timeline).engine !== 'es') drawFinish(ctx, frame, timeline, env);
    drawEsMark(ctx, frame, timeline, env);
    ctx.restore();
    return frame;
  }

  return {
    W, H, FPS, SAFE, ZONE, MARGIN, COL, CONDENSED, BODY, CAP, XFADE_MS, MUSIC, ES_BLUE,
    ease, contrast, luminance, accessibleHighlight,
    estimateWordTimes, captionCards, duckPoints, musicGainDbAt, dbToGain, parseStatValue, formatStat,
    buildTimeline, frameAt, wrap, fitText, layoutGraphic, layoutCaption, layoutChrome, textBoxes, drawFrame,
    clipTimes, clipTime, drawVisual, allBoxes, CHART_LAYOUTS,
    BRAND, ES_MARK, WORDMARK, CAPTION_W, LOGO_CLEAR, markVariant, drawBrand, logoPlacements, wordmarkFor, drawFinish,
    isEs, styleOf, styleRetired: timeline => Boolean(timeline && S.isLegacy && S.isLegacy(timeline.style)), showsMark, drawSquareMark, ES_TEMPLATES, sourceLineFrom, parseVoEmphasis,
    // Data formats (Phase 1)
    DATA_TEMPLATES, SLIDE_TEMPLATES, SLIDE_MARK, SLIDE_SAFE, DATA_MIN_MS, canvasOf, scoreState, swingFor, momentInfo, periodLabel, teamColours, bestInk,
    provenanceNumbers, unbackedNumbers, wpOnScreen, drawSlideFrame,
    // Slides wear the reel's look (the ES style only; reel-es-themes.js).
    buildSlides: (timeline, opts) => { const RP = getRP(); return RP ? RP.buildSlides(timeline, opts).map(sl => (timeline && timeline.look && S.get(sl.style).engine === 'es' ? { ...sl, look: timeline.look } : sl)) : []; },
  };
}));
