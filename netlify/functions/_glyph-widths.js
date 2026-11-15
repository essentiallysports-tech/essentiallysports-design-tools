'use strict';
// Letter widths of FrameUp's post fonts, so the server can tell whether a line
// of copy fits a template box before it is ever drawn.
//
// Measured 2026-11-15 in the browser with the editor's own font declarations
// and canvas font strings (index.html):
//   post:      900 …px "Acumin Post"                (fonts/acumin-post-legacy.otf)
//   condensed: 700 …px "Acumin Pro Condensed Local" (fonts/acumin-pro-condensed-bold.otf)
// Widths are per 1000px of font size. Adding letters up (no kerning) came out
// −0.4% to +3.2% against the browser's real width for ten sample headlines, so
// the estimate errs slightly wide, the safe side for a "will it fit" check.
// Re-measure if the post fonts change.

const WIDTHS = {
  post: {"0":476,"1":289,"2":435,"3":456,"4":456,"5":460,"6":468,"7":385,"8":468,"9":466,"A":496,"B":508,"C":497,"D":525,"E":451,"F":436,"G":521,"H":530,"I":258,"J":305,"K":504,"L":427,"M":659,"N":536,"O":527,"P":494,"Q":527,"R":504,"S":480,"T":438,"U":529,"V":488,"W":702,"X":456,"Y":462,"Z":448,"a":466,"b":485,"c":442,"d":484,"e":460,"f":275,"g":485,"h":487,"i":244,"j":245,"k":456,"l":243,"m":717,"n":487,"o":470,"p":484,"q":485,"r":338,"s":425,"t":298,"u":485,"v":443,"w":669,"x":410,"y":441,"z":394," ":171,".":217,",":228,":":270,";":282,"!":281,"?":436,"'":185,"\"":339,"’":207,"‘":207,"“":353,"”":353,"-":283,"–":369,"—":661,"&":616,"%":716,"$":457,"#":481,"/":332,"(":319,")":319,"+":543,"@":746,"*":374},
  condensed: {"0":460,"1":275,"2":415,"3":435,"4":440,"5":446,"6":449,"7":364,"8":448,"9":447,"A":482,"B":500,"C":478,"D":513,"E":440,"F":427,"G":507,"H":524,"I":241,"J":290,"K":485,"L":414,"M":649,"N":534,"O":512,"P":480,"Q":512,"R":492,"S":466,"T":421,"U":524,"V":480,"W":710,"X":445,"Y":453,"Z":439,"a":446,"b":466,"c":417,"d":465,"e":438,"f":247,"g":468,"h":470,"i":226,"j":226,"k":426,"l":225,"m":700,"n":470,"o":448,"p":467,"q":467,"r":315,"s":403,"t":274,"u":466,"v":419,"w":644,"x":380,"y":421,"z":374," ":186,".":193,",":201,":":239,";":251,"!":257,"?":409,"'":176,"\"":320,"’":191,"‘":191,"“":330,"”":330,"-":281,"–":367,"—":648,"&":598,"%":718,"$":441,"#":469,"/":334,"(":310,")":310,"+":544,"@":730,"*":350},
};

// Letters outside the table (accents, symbols) count as a wide letter.
const UNKNOWN = 560;

// Width in px of `text` set in `font` ('post' | 'condensed') at `size` px.
function measure(text, font = 'post', size = 100, letterSpacing = 0) {
  const table = WIDTHS[font] || WIDTHS.post;
  let total = 0;
  for (const ch of String(text || '')) total += table[ch] ?? UNKNOWN;
  const chars = [...String(text || '')].length;
  return (total / 1000) * size + Math.max(0, chars - 1) * letterSpacing * size;
}

// Largest font size (≤ start) at which one line fits `maxWidth`.
function fitSize(text, { font = 'post', size, maxWidth, letterSpacing = 0 }) {
  const at100 = measure(text, font, 100, letterSpacing);
  if (!at100) return size;
  return Math.min(size, (maxWidth / at100) * 100);
}

// Greedy word wrap at a given size; returns the number of lines.
function wrapLines(text, { font = 'post', size, maxWidth, letterSpacing = 0 }) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let lines = 0;
  let current = '';
  words.forEach(word => {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next, font, size, letterSpacing) > maxWidth) {
      lines += 1;
      current = word;
    } else {
      current = next;
    }
  });
  return lines + (current ? 1 : 0);
}

// Largest size (between min and start, 1px steps) at which wrapped text fits
// the box height. Returns { size, fits } (fits=false: overflows even at min).
function fitWrapped(text, { font = 'post', size, minSize, maxWidth, maxHeight, lineHeight = 1, letterSpacing = 0 }) {
  for (let s = Math.floor(size); s >= Math.floor(minSize); s -= 1) {
    if (wrapLines(text, { font, size: s, maxWidth, letterSpacing }) * s * lineHeight <= maxHeight) return { size: s, fits: true };
  }
  return { size: minSize, fits: false };
}

module.exports = { WIDTHS, measure, fitSize, wrapLines, fitWrapped };
