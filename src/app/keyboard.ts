/** Single-key shortcuts. Keys are matched lowercased. Ignored while typing in a field. */
export function bindKeys(handlers: Record<string, () => void>): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      return;
    const handler = handlers[e.key.toLowerCase()];
    if (!handler) return;
    e.preventDefault();
    handler();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
