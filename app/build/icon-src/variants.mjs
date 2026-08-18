/**
 * Icon artwork, as SVG strings.
 *
 * Original marks on purpose: Figma's logo is a trademark, so nothing here reproduces it.
 *
 * The mark is the panel itself — a terminal window with a prompt — drawn free-form on a
 * transparent canvas, the way macOS app icons sit rather than filling a tile. Two thirds of the
 * canvas, centred, leaves the margin the Dock expects.
 */
const canvas = (inner) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  ${inner}
</svg>`;

/**
 * The window: chrome bar with three lights, a prompt chevron, an input rule, and the blue
 * progress line that says "something is running".
 */
export const variantPanel = canvas(`
  <g>
    <rect x="176" y="256" width="672" height="512" rx="72" fill="#242428"/>
    <path d="M176 328a72 72 0 0 1 72-72h528a72 72 0 0 1 72 72v40H176z" fill="#33333A"/>
    <circle cx="248" cy="312" r="20" fill="#F24E1E"/>
    <circle cx="312" cy="312" r="20" fill="#FFCD29"/>
    <circle cx="376" cy="312" r="20" fill="#0ACF83"/>
    <g stroke="#D97757" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M264 468 L352 528 L264 588"/>
    </g>
    <rect x="408" y="506" width="248" height="44" rx="22" fill="#8C8C94"/>
    <rect x="264" y="664" width="496" height="32" rx="16" fill="#3C3C44"/>
    <rect x="264" y="664" width="184" height="32" rx="16" fill="#0D99FF"/>
  </g>
`);

/**
 * Same window for 16 and 32 px, where the details turn to mush: fewer elements, thicker
 * strokes, bigger lights. `.icns` carries one image per size, which is what makes it worth
 * drawing twice.
 */
export const variantPanelSmall = canvas(`
  <g>
    <rect x="144" y="240" width="736" height="544" rx="80" fill="#242428" stroke="#4A4A54" stroke-width="16"/>
    <path d="M144 320a80 80 0 0 1 80-80h576a80 80 0 0 1 80 80v56H144z" fill="#3A3A44"/>
    <circle cx="232" cy="304" r="30" fill="#F24E1E"/>
    <circle cx="326" cy="304" r="30" fill="#FFCD29"/>
    <circle cx="420" cy="304" r="30" fill="#0ACF83"/>
    <g stroke="#D97757" stroke-width="76" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M268 500 L392 588 L268 676"/>
    </g>
    <rect x="456" y="548" width="300" height="76" rx="38" fill="#9A9AA4"/>
  </g>
`);

export const VARIANTS = { panel: variantPanel, panelSmall: variantPanelSmall };
