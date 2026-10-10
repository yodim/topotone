/**
 * The tuning panel, opened with ?tune. One slider per mapping constant, grouped like MAPPING.
 * Changes rebuild the land (with the usual fade) and are remembered in this browser, so a
 * tuning session survives reloads. "Copy JSON" gives only the values that differ from the
 * defaults, ready to paste into an issue or a message.
 */
import { MAPPING, MAPPING_DEFAULTS } from '../world/mapping';

type Section = Record<string, number>;
type Values = Record<string, Section>;

const STORAGE_KEY = 'topotone.tune';
/** Structural values: changing them would break the grid the world is built on. */
const FIXED = new Set(['margin', 'context.grid', 'crescendo.grid', 'sky.grid', 'water.cell']);

function sections(): [string, Section][] {
  const out: [string, Section][] = [];
  const top: Section = {};
  for (const [key, value] of Object.entries(MAPPING)) {
    if (typeof value === 'number') {
      if (!FIXED.has(key)) top[key] = value;
    } else out.push([key, value as Section]);
  }
  if (Object.keys(top).length > 0) out.unshift(['general', top]);
  return out;
}

function target(section: string): Section {
  return (section === 'general' ? MAPPING : MAPPING[section as keyof typeof MAPPING]) as Section;
}

function defaultOf(section: string, key: string): number {
  const source = (
    section === 'general' ? MAPPING_DEFAULTS : MAPPING_DEFAULTS[section as keyof typeof MAPPING]
  ) as Section;
  return source[key] ?? 0;
}

/** Only the values that differ from the defaults. */
export function changedValues(): Values {
  const out: Values = {};
  for (const [section, values] of sections()) {
    for (const [key, value] of Object.entries(values)) {
      if (value === defaultOf(section, key)) continue;
      (out[section] ??= {})[key] = value;
    }
  }
  return out;
}

/** Applies known numeric values; anything else is ignored. Returns how many were applied. */
export function applyValues(values: unknown): number {
  if (!values || typeof values !== 'object') return 0;
  let applied = 0;
  for (const [section, entries] of Object.entries(values as Record<string, unknown>)) {
    if (!entries || typeof entries !== 'object') continue;
    const into = target(section);
    if (!into || typeof into !== 'object') continue;
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      const path = section === 'general' ? key : `${section}.${key}`;
      if (FIXED.has(path) || typeof into[key] !== 'number') continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      into[key] = value;
      applied++;
    }
  }
  return applied;
}

export function resetValues(): void {
  for (const [section, values] of sections()) {
    for (const key of Object.keys(values)) target(section)[key] = defaultOf(section, key);
  }
}

function range(value: number): { max: number; step: number } {
  const max = value === 0 ? 1 : value <= 1 ? 1 : value * 3;
  return { max, step: max / 200 };
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changedValues()));
  } catch {
    // Private mode or full storage: tuning still works, it just is not remembered.
  }
}

/** Loads the values remembered from an earlier tuning session. */
export function restoreTuning(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) applyValues(JSON.parse(saved));
  } catch {
    // Ignore unreadable storage.
  }
}

export interface TunePanel {
  toggle(): void;
}

export function createTunePanel(onChange: () => void): TunePanel {
  const panel = document.createElement('aside');
  panel.id = 'tune';
  panel.setAttribute('aria-label', 'Tuning');
  document.body.append(panel);

  let timer = 0;
  const changed = () => {
    save();
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 200);
  };

  const inputs: {
    section: string;
    key: string;
    input: HTMLInputElement;
    out: HTMLOutputElement;
  }[] = [];
  const refresh = () => {
    for (const { section, key, input, out } of inputs) {
      const value = target(section)[key] ?? 0;
      input.value = String(value);
      out.value = formatValue(value);
      input.parentElement?.classList.toggle('changed', value !== defaultOf(section, key));
    }
  };

  const head = document.createElement('div');
  head.className = 'tune-head';
  const title = document.createElement('strong');
  title.textContent = 'Tuning';
  head.append(title);
  const button = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      action();
      b.blur();
    });
    head.append(b);
  };
  button('Copy JSON', () => {
    const text = JSON.stringify(changedValues(), null, 2);
    navigator.clipboard
      ?.writeText(text)
      .catch(() => window.prompt('Copy the tuning values:', text));
    if (!navigator.clipboard) window.prompt('Copy the tuning values:', text);
  });
  button('Paste', () => {
    const text = window.prompt('Paste tuning values (JSON):');
    if (!text) return;
    try {
      applyValues(JSON.parse(text));
    } catch {
      window.alert('That is not valid JSON.');
      return;
    }
    refresh();
    changed();
  });
  button('Reset', () => {
    resetValues();
    refresh();
    changed();
  });
  panel.append(head);

  const hint = document.createElement('p');
  hint.textContent = 'T hides this panel. Changed values are highlighted and kept in this browser.';
  panel.append(hint);

  for (const [section, values] of sections()) {
    const group = document.createElement('details');
    group.open = section === 'far' || section === 'mid' || section === 'hills';
    const summary = document.createElement('summary');
    summary.textContent = section;
    group.append(summary);
    for (const [key, value] of Object.entries(values)) {
      if (FIXED.has(`${section}.${key}`)) continue;
      const row = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = key;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      const { max, step } = range(defaultOf(section, key) || value);
      input.max = String(max);
      input.step = String(step);
      const out = document.createElement('output');
      input.addEventListener('input', () => {
        target(section)[key] = Number(input.value);
        out.value = formatValue(Number(input.value));
        row.classList.toggle('changed', Number(input.value) !== defaultOf(section, key));
        changed();
      });
      row.append(name, input, out);
      group.append(row);
      inputs.push({ section, key, input, out });
    }
    panel.append(group);
  }
  refresh();

  return {
    toggle() {
      panel.hidden = !panel.hidden;
    },
  };
}

function formatValue(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
}
