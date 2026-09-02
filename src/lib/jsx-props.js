/**
 * Which props each JSX tag accepts, and the wrong names people reach for instead.
 *
 * This lived inside `validateJsxProps` as a local constant: the truth about what exists, and
 * unreachable to anything that wanted to check that truth. The panel reported `align=` missing
 * from REFERENCE.md while it had worked in the parser for months, and the same silence had
 * already cost a session an `eval` for `counterAxisSpacing` — a real prop written down nowhere.
 * `tests/docs-coverage.test.js` holds this list against the documentation, so a prop that exists
 * but is described nowhere fails a test rather than a working day.
 *
 * Same split as `src/lib/text-styles.js` and `src/lib/connect-plan.js`: the data is testable on
 * its own, the I/O stays in the caller.
 */

const layout = ['name', 'flex', 'gap', 'rowGap', 'wrapGap', 'counterAxisSpacing', 'wrap',
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'padding',
  'justify', 'items', 'align', 'grow', 'stretch', 'hug',
  'w', 'h', 'width', 'height', 'minW', 'maxW', 'minH', 'maxH',
  'position', 'x', 'y', 'top', 'right', 'bottom', 'left', 'centerOffsetX', 'centerOffsetY'];
const paint = ['bg', 'fill', 'stroke', 'strokeWidth', 'strokeAlign', 'opacity', 'blendMode',
  'image', 'imageScale', 'visible', 'locked', 'clip', 'overflow', 'rotate'];
const corners = ['rounded', 'radius', 'roundedTL', 'roundedTR', 'roundedBL', 'roundedBR', 'cornerSmoothing'];
const effects = ['shadow', 'innerShadow', 'blur', 'bgBlur',
  'noise', 'noiseDensity', 'noiseSize', 'noiseColor', 'noiseColor2', 'noiseOpacity',
  'texture', 'textureSize', 'textureRadius', 'textureClip',
  'progressiveBlur', 'progressiveBlurDir', 'progressiveBlurStart',
  'glass', 'glassRefraction', 'glassDepth', 'glassRadius', 'glassDispersion', 'glassLight', 'glassLightAngle'];

const known = {
  Frame: [...layout, ...paint, ...corners, ...effects],
  Text: ['name', 'size', 'weight', 'color', 'font', 'italic', 'align', 'w', 'h', 'width', 'height',
    'grow', 'opacity', 'x', 'y', 'position', 'lineHeight', 'letterSpacing', 'truncate', 'maxLines',
    'textStyle'],
  Icon: ['name', 'size', 's', 'color', 'c', 'x', 'y', 'position'],
  Rect: ['name', 'w', 'h', 'width', 'height', 'bg', 'fill', 'rounded', 'radius', 'opacity', 'x', 'y', 'position'],
  Rectangle: null, // alias of Rect, filled below
  Ellipse: ['name', 'w', 'h', 'width', 'height', 'bg', 'fill', 'stroke', 'strokeWidth', 'strokeAlign',
    'arc', 'arcStart', 'innerRadius', 'opacity', 'x', 'y', 'position'],
  Circle: null,    // alias of Ellipse, filled below
  Image: ['name', 'w', 'h', 'width', 'height', 'bg', 'fill', 'rounded', 'radius', 'opacity', 'x', 'y', 'position'],
  Slot: ['name', 'flex', 'gap', 'p', 'px', 'py', 'padding', 'w', 'h', 'width', 'height', 'bg', 'fill'],
  Instance: ['name', 'component', 'id', 'w', 'h', 'width', 'height'],
};
known.Rectangle = known.Rect;
known.Circle = known.Ellipse;

// Common wrong names -> the prop that actually works
const aliases = {
  layout: 'flex', direction: 'flex', flexDirection: 'flex',
  cornerRadius: 'rounded', borderRadius: 'rounded',
  background: 'bg', backgroundColor: 'bg',
  border: 'stroke', borderColor: 'stroke', borderWidth: 'strokeWidth',
  fontSize: 'size', fontWeight: 'weight', fontFamily: 'font', textAlign: 'align',
  style: 'textStyle', typography: 'textStyle', textstyle: 'textStyle',
  spacing: 'gap', itemSpacing: 'gap',
  alignItems: 'items', justifyContent: 'justify',
  visibility: 'visible',
};

/** Props valid on a given tag, by tag name. */
export const KNOWN_PROPS = known;

/** Every prop name the parser accepts anywhere, deduplicated and sorted. */
export const ALL_PROPS = [...new Set(Object.values(known).flat().filter(Boolean))].sort();

/** Common wrong names -> the prop that actually works. */
export const PROP_ALIASES = aliases;
