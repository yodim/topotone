/** True on touch screens, where messages say "tap" and never name keys. */
export function isTouch(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
