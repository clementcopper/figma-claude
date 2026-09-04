/**
 * What `render` hands to `render-batch` when it auto-splits an outer flex wrapper.
 *
 * The split used to forward three flags and drop the rest — `--verify` vanished with no word.
 * Flags render-batch understands are forwarded; a flag that only makes sense for one frame
 * (`--parent`, `-x`, `-y`, `--no-smart-position`) keeps the wrapper instead, and the caller
 * prints why.
 *
 * @returns {{ args: string[] } | { keepWrapper: string }}
 */
export function autoSplitArgs(options, split) {
  const single = [];
  if (options.parent !== undefined) single.push('--parent');
  if (options.x !== undefined) single.push('-x');
  if (options.y !== undefined) single.push('-y');
  if (options.smartPosition === false) single.push('--no-smart-position');
  if (single.length) {
    return { keepWrapper: `${single.join(', ')} applies to one frame — rendering the wrapper as is` };
  }
  const args = ['render-batch', JSON.stringify(split.children), '--direction', split.direction];
  if (options.asComponent) args.push('--as-component');
  if (options.collection) args.push('--collection', options.collection);
  if (options.verify !== undefined && options.verify !== false) {
    args.push('--verify');
    if (options.verify !== true) args.push(String(options.verify));
  }
  if (options.autoStyle === false) args.push('--no-auto-style');
  return { args };
}
