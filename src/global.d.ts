export {};

declare global {
  /** Prefixed fullscreen calls, for older Safari. */
  interface Document {
    webkitFullscreenEnabled?: boolean;
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => void;
  }
  interface HTMLElement {
    webkitRequestFullscreen?: () => void;
  }
  /** Safari's audio session (16.4 and later). */
  interface Navigator {
    audioSession?: { type: string };
  }

  interface Window {
    /** Seed and live stats. Handy in the console, and used by the end-to-end tests. */
    topotone?: {
      seed: number;
      /** Id of the style on screen. */
      style: () => string;
      stats: () => Record<string, number>;
      source: () => {
        kind: string;
        now: number;
        paused: boolean;
        song: string | null;
        /** World time up to which live features are final; Infinity without live input. */
        live: number;
      };
      /** Renders the panorama E would export (without saving it), for the tests. */
      panorama: (options?: {
        height?: number;
        caption?: boolean;
        from?: number;
        to?: number;
      }) => Promise<{
        canvas: HTMLCanvasElement;
        layout: { width: number; height: number; pxPerSecond: number; t0: number; squeeze: number };
      }>;
      /** Times of onsets stronger than `min` between from and to, in world time. */
      onsets: (from: number, to: number, min?: number) => number[];
    };
  }
}
