/**
 * Warning about the one case where `items=` on a column provably does nothing.
 *
 * `generateChildrenCode` sets `layoutSizingHorizontal = 'FILL'` on any `<Text>` that sits in a
 * column and carries no width of its own — deliberately, so Safe Mode wraps it. The side effect
 * is invisible and total: a FILLed child spans the column, so the column's
 * `counterAxisAlignItems` has nothing left to move. `items="end"` reports MAX on the frame and
 * the text still stands left, which is exactly what was reported from the panel after two
 * rebuilds of the same status bar.
 *
 * The fix the reporter eventually found is `align="right"` on the `<Text>` itself — a real prop
 * that the JSX reference never showed. So this warns rather than changing the layout: FILL is
 * load-bearing for wrapping, and the reader needs the name of the prop that works.
 *
 * Pure: it takes an already-parsed tree and returns findings. Printing lives in the command.
 */

/** Cross-axis values that FILL makes meaningless. `start` is excluded — FILLed text reads left
 *  anyway, so warning there would be noise on the common case. */
const DEFEATED = new Set(['end', 'center']);

const isCol = (flex) => flex === undefined || flex === 'col' || flex === 'column';

/**
 * @param {object} frameProps props of the root `<Frame>` (from `parseProps`)
 * @param {Array<object>} children the parsed child elements (from `parseChildren`)
 * @returns {Array<{frame: string, items: string, text: string, suggest: string}>}
 */
export function autoFillDefeatsAlign(frameProps, children) {
  const found = [];

  const visit = (props, kids) => {
    if (!Array.isArray(kids)) return;

    const items = props && props.items;
    // The generator only FILLs when the column itself is sized (its runtime guard checks
    // counterAxisSizingMode/primaryAxisSizingMode). A hugging column is as wide as its text, so
    // alignment is moot there and a warning would be noise.
    const sized = props && (props.w !== undefined || props.width !== undefined ||
                            props.h !== undefined || props.height !== undefined || props.stretch);
    // Only an explicit cross-axis wish can be defeated; the default was never a promise.
    if (isCol(props && props.flex) && DEFEATED.has(items) && sized) {
      for (const kid of kids) {
        if (!kid || kid._type !== 'text') continue;
        if (kid.align) continue;                       // already says where it wants to sit
        if (kid.w !== undefined || kid.width !== undefined) continue;  // fill/number: not auto
        found.push({
          frame: props.name || 'this column',
          items,
          text: String(kid.content || '').slice(0, 24),
          suggest: items === 'center' ? 'center' : 'right'
        });
      }
    }

    for (const kid of kids) {
      if (kid && Array.isArray(kid._children)) visit(kid, kid._children);
    }
  };

  visit(frameProps || {}, children);
  return found;
}
