/**
 * The export panel: E (or the Export button) opens it, Export renders the panorama and
 * saves it as a PNG. It shows the latest song in full, or the latest mic session, or
 * failing both the last stretch of the landscape's own music. Progress shows in the status
 * line; the live view keeps running meanwhile.
 */
import type { SourceManager } from '../audio/sources/manager';
import { renderPanorama, type Panorama } from '../render/export';
import type { Style } from '../styles/types';
import { World } from '../world/generator';
import type { Status } from './status';

/** Longest stretch exported from a mic session or free time, in seconds. Songs are whole. */
export const MAX_SESSION_SECONDS = 600;
/** Shortest stretch exported from free time, in seconds. */
const MIN_FREE_SECONDS = 20;

export interface ExportRange {
  from: number;
  to: number;
  /** Live input: rebuild the world as it was built live, with windows that look back only. */
  causal: boolean;
  /** What it is, for the panel and the default title. */
  title: string;
  label: string;
}

/** What E would export now. */
export function exportRange(manager: SourceManager): ExportRange {
  const session = manager.latestSession();
  if (session?.kind === 'file') {
    return {
      from: session.start,
      to: session.end,
      causal: false,
      title: session.name ?? 'Topotone',
      label: `The song “${session.name ?? 'untitled'}”, ${duration(session.end - session.start)}.`,
    };
  }
  if (session?.kind === 'mic') {
    const from = Math.max(session.start, session.end - MAX_SESSION_SECONDS);
    return {
      from,
      to: session.end,
      causal: true,
      title: 'Heard on the microphone',
      label:
        from > session.start
          ? `The last ${duration(session.end - from)} heard on the microphone.`
          : `What the microphone heard, ${duration(session.end - from)}.`,
    };
  }
  const to = manager.now();
  const from = to - Math.min(MAX_SESSION_SECONDS, Math.max(MIN_FREE_SECONDS, to));
  return {
    from,
    to,
    causal: false,
    title: 'Topotone',
    label: `The last ${duration(to - from)} of the landscape.`,
  };
}

function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface ExporterDeps {
  manager: SourceManager;
  seed: () => number;
  style: () => Style;
  status: Status;
}

export class Exporter {
  private working = false;
  private readonly what: HTMLElement;
  private readonly height: HTMLSelectElement;
  private readonly caption: HTMLInputElement;
  private readonly title: HTMLInputElement;

  constructor(
    private readonly panel: HTMLFormElement,
    private readonly deps: ExporterDeps,
  ) {
    const find = <T extends HTMLElement>(selector: string) => {
      const el = panel.querySelector<T>(selector);
      if (!el) throw new Error(`Missing ${selector} in the export panel`);
      return el;
    };
    this.what = find('#export-what');
    this.height = find('#export-height');
    this.caption = find('#export-caption');
    this.title = find('#export-title');
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.run();
    });
    find<HTMLButtonElement>('#export-cancel').addEventListener('click', () => this.close());
    this.caption.addEventListener('change', () => this.syncCaption());
    // The page's keys are off while typing in a field, so Escape is handled here too.
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  /** True while a panorama is being made. */
  get busy(): boolean {
    return this.working;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (this.working) return;
    const range = exportRange(this.deps.manager);
    this.what.textContent = range.label;
    this.title.value = range.title;
    this.syncCaption();
    this.panel.hidden = false;
  }

  close(): void {
    this.panel.hidden = true;
    // Give focus back to the page, so the keys work again.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  /** Renders the panorama for the current range, without saving it. Used by the tests too. */
  async render(
    options: { height?: number; caption?: boolean; from?: number; to?: number } = {},
  ): Promise<Panorama> {
    const { manager, style } = this.deps;
    const seed = this.deps.seed();
    const range = exportRange(manager);
    const from = options.from ?? range.from;
    const to = options.to ?? range.to;
    const world = new World(seed, manager, () => (range.causal ? to : Infinity));
    world.reset(range.causal);
    const s = style();
    const date = new Date().toISOString().slice(0, 10);
    return renderPanorama({
      world,
      style: s,
      from,
      to,
      height: options.height ?? 1080,
      caption: options.caption
        ? {
            title: this.title.value.trim() || range.title,
            details: `seed ${seed} · ${s.name} · ${date}`,
          }
        : null,
      onProgress: (done) =>
        this.deps.status.show(`Exporting… ${Math.round(done * 100)}%`, { stay: true }),
    });
  }

  private syncCaption(): void {
    this.title.disabled = !this.caption.checked;
  }

  private async run(): Promise<void> {
    if (this.working) return;
    this.working = true;
    this.close();
    const { status } = this.deps;
    try {
      const height = Number(this.height.value) || 1080;
      const { canvas, layout } = await this.render({ height, caption: this.caption.checked });
      status.show('Saving the image…', { stay: true });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser could not encode the image');
      const name = `${slug(this.title.value || 'topotone')}-${this.deps.style().id}.png`;
      download(blob, name);
      const squeezed =
        layout.squeeze < 0.995
          ? ` It was squeezed to ${Math.round(layout.squeeze * 100)}% of its width to fit.`
          : '';
      status.show(`Saved ${name}, ${layout.width} × ${canvas.height} px.${squeezed}`, {
        stay: squeezed !== '',
      });
    } catch (err) {
      console.error(err);
      status.show('The panorama could not be made. The image may be too large for this device.', {
        error: true,
      });
    } finally {
      this.working = false;
    }
  }
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'topotone'
  );
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Let the browser start the download before the address goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
