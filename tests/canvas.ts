/**
 * A stand-in for a 2D canvas context in unit tests: it accepts every call and records each
 * one (method or property, with its arguments), so drawings can be counted and compared.
 */
export interface RecordingContext {
  ctx: CanvasRenderingContext2D;
  /** One line per call or property set, numbers rounded to 1e-6. */
  log: string[];
}

function show(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6);
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(show).join(',')}]`;
  return typeof value;
}

export function recordingContext(): RecordingContext {
  const log: string[] = [];
  const gradient = { addColorStop: (...args: unknown[]) => log.push(`stop ${args.map(show)}`) };
  const ctx = new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]) => {
          log.push(`${prop}(${args.map(show).join(', ')})`);
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return gradient;
          if (prop === 'measureText') return { width: 0 };
          return undefined;
        };
      },
      set(_, prop, value) {
        log.push(`${String(prop)} = ${show(value)}`);
        return true;
      },
    },
  );
  return { ctx: ctx as CanvasRenderingContext2D, log };
}
