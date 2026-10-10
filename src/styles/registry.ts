/**
 * Finds every style in src/styles/<id>/index.ts. Folders starting with an underscore
 * (like _template) are skipped. Adding a style never needs an edit here.
 */
import type { Style } from './types';

export const DEFAULT_STYLE = 'debug';

const modules = import.meta.glob<{ default: Style }>('./*/index.ts', { eager: true });

function discover(): Map<string, Style> {
  const styles = new Map<string, Style>();
  for (const [path, mod] of Object.entries(modules)) {
    const folder = path.split('/')[1] ?? '';
    if (folder.startsWith('_')) continue;
    const style = mod.default;
    if (style.id !== folder) {
      throw new Error(
        `Style in ${path} has id "${style.id}", expected the folder name "${folder}"`,
      );
    }
    styles.set(folder, style);
  }
  return styles;
}

export const STYLES: ReadonlyMap<string, Style> = discover();

/** The style with this id, or the default style when it does not exist. */
export function resolveStyle(id: string | null): Style {
  const style = (id && STYLES.get(id)) || STYLES.get(DEFAULT_STYLE);
  if (!style) throw new Error('No styles found');
  return style;
}
