/**
 * Which palette the window uses.
 *
 * One tiny crossing of two inputs — the user's setting and what macOS currently is — but it is
 * the only place they meet, and it decides what every surface looks like. Pure so the three
 * cases can be asserted rather than clicked through.
 */

export type ThemeSetting = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export function resolveTheme({
  setting,
  systemPrefersDark
}: {
  setting: ThemeSetting | undefined;
  systemPrefersDark: boolean;
}): Theme {
  if (setting === 'light') return 'light';
  if (setting === 'dark') return 'dark';
  // 'system' and anything unrecognised: follow macOS, which is what a Mac app is expected to do.
  return systemPrefersDark ? 'dark' : 'light';
}
