export {};

declare global {
  interface Window {
    /** Seed and live stats. Handy in the console, and used by the end-to-end tests. */
    topotone?: { seed: number; stats: () => Record<string, number> };
  }
}
