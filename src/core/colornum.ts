/** "#rrggbb" (or a shorter piece of one) as the number the renderer wants. Black is 0, so only a colour that does not parse falls back to white. */
export function colorNum(c: string): number {
  if (!c.replace('#', '').trim()) return 0xffffff;
  const n = parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return Number.isNaN(n) ? 0xffffff : n;
}
