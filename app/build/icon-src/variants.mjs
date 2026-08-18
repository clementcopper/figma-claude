/**
 * Icon artwork, as SVG strings.
 *
 * Original marks on purpose: Figma's logo is a trademark, so nothing here reproduces it.
 * What the icon has to say is "terminal, next to Figma" — a prompt glyph plus a small palette.
 */
export const BG = '#1E1E1E';

const rounded = (inner) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2B2B2B"/>
      <stop offset="1" stop-color="#141414"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#bg)"/>
  ${inner}
</svg>`;

/** A: prompt chevron in Claude's terracotta, over a row of Figma-ish colour chips. */
export const variantA = rounded(`
  <g stroke="#D97757" stroke-width="72" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M300 360 L470 512 L300 664"/>
  </g>
  <rect x="536" y="628" width="200" height="40" rx="20" fill="#9B9B9B"/>
  <g>
    <circle cx="330" cy="800" r="34" fill="#F24E1E"/>
    <circle cx="430" cy="800" r="34" fill="#FF7262"/>
    <circle cx="530" cy="800" r="34" fill="#A259FF"/>
    <circle cx="630" cy="800" r="34" fill="#1ABCFE"/>
    <circle cx="730" cy="800" r="34" fill="#0ACF83"/>
  </g>
`);

/** B: the panel itself — a window with a bar, a prompt line and a canvas frame beside it. */
export const variantB = rounded(`
  <rect x="176" y="216" width="672" height="592" rx="56" fill="#252525" stroke="#3A3A3A" stroke-width="8"/>
  <rect x="176" y="216" width="672" height="96" rx="56" fill="#2F2F2F"/>
  <rect x="176" y="264" width="672" height="48" fill="#2F2F2F"/>
  <circle cx="240" cy="264" r="18" fill="#F24E1E"/>
  <circle cx="300" cy="264" r="18" fill="#FFCD29"/>
  <circle cx="360" cy="264" r="18" fill="#0ACF83"/>
  <g stroke="#D97757" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M264 432 L344 496 L264 560"/>
  </g>
  <rect x="392" y="476" width="240" height="40" rx="20" fill="#8A8A8A"/>
  <rect x="264" y="640" width="496" height="28" rx="14" fill="#3D3D3D"/>
  <rect x="264" y="640" width="180" height="28" rx="14" fill="#0D99FF"/>
`);

/** C: two overlapping shapes — the CLI's caret and a Figma-style frame, sharing one corner. */
export const variantC = rounded(`
  <rect x="524" y="236" width="264" height="264" rx="40" fill="none" stroke="#0D99FF" stroke-width="36"/>
  <rect x="236" y="524" width="264" height="264" rx="132" fill="none" stroke="#A259FF" stroke-width="36"/>
  <g stroke="#D97757" stroke-width="56" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M268 300 L372 368 L268 436"/>
  </g>
  <rect x="556" y="640" width="232" height="40" rx="20" fill="#0ACF83"/>
`);

/**
 * B again, for 16 and 32 px. At that size the window's contents turn to mush, so the small
 * cut keeps only what still reads: the frame, the three lights, one thick prompt.
 * `.icns` carries a separate image per size, which is what makes this worth drawing.
 */
export const variantBsmall = rounded(`
  <rect x="152" y="200" width="720" height="624" rx="72" fill="#252525" stroke="#4A4A4A" stroke-width="16"/>
  <rect x="152" y="200" width="720" height="140" rx="72" fill="#333333"/>
  <rect x="152" y="272" width="720" height="68" fill="#333333"/>
  <circle cx="232" cy="272" r="30" fill="#F24E1E"/>
  <circle cx="322" cy="272" r="30" fill="#FFCD29"/>
  <circle cx="412" cy="272" r="30" fill="#0ACF83"/>
  <g stroke="#D97757" stroke-width="72" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M280 470 L400 570 L280 670"/>
  </g>
  <rect x="470" y="530" width="300" height="72" rx="36" fill="#9A9A9A"/>
`);

export const VARIANTS = { A: variantA, B: variantB, C: variantC, Bsmall: variantBsmall };
