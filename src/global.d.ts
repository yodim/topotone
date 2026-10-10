export {};

declare global {
  interface Window {
    /** Seed and live stats. Handy in the console, and used by the end-to-end tests. */
    topotone?: {
      seed: number;
      stats: () => Record<string, number>;
      source: () => {
        kind: string;
        now: number;
        paused: boolean;
        song: string | null;
        /** World time up to which live features are final; Infinity without live input. */
        live: number;
      };
      /** Times of onsets stronger than `min` between from and to, in world time. */
      onsets: (from: number, to: number, min?: number) => number[];
    };
  }
}
