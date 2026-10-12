/**
 * The on-screen buttons. Along the bottom: play a song, the mic, pause, the style, a new world
 * and the export. In the top left corner: fullscreen and About. They are the only way in on
 * a phone, where there is no keyboard and no drag and drop.
 *
 * When nothing moves for a few seconds the buttons dim, and in fullscreen they disappear with
 * the cursor. Any touch, click or key brings them back.
 */
const IDLE_MS = 3000;

export interface ControlActions {
  song(): void;
  mic(): void;
  pause(): void;
  style(): void;
  world(): void;
  export(): void;
  fullscreen(): void;
  about(): void;
}

export interface Controls {
  /** Shows whether the mic is on. Cheap to call every frame. */
  setMicOn(on: boolean): void;
  /** Shows the Pause button while a song is loaded, as Pause or Play. Null hides it. */
  setSongPlaying(playing: boolean | null): void;
  /** The style on screen, shown on the Style button. */
  setStyleName(name: string): void;
  /** Called when fullscreen starts or ends. */
  setFullscreen(on: boolean): void;
}

export function bindControls(
  bar: HTMLElement,
  corner: HTMLElement,
  actions: ControlActions,
  options: { fullscreen: boolean },
): Controls {
  const find = (root: HTMLElement, id: string) => {
    const el = root.querySelector<HTMLButtonElement>(`#${id}`);
    if (!el) throw new Error(`Missing #${id}`);
    return el;
  };
  const mic = find(bar, 'mic-button');
  const pause = find(bar, 'pause-button');
  const style = find(bar, 'style-button');
  const fullscreen = find(corner, 'fullscreen-button');
  const styleLabel = style.querySelector('.label');
  const pauseLabel = pause.querySelector('.label');

  const press = (button: HTMLButtonElement, action: () => void) =>
    button.addEventListener('click', () => {
      action();
      // Give focus back to the page, so Space pauses instead of pressing the button again.
      button.blur();
    });
  press(find(bar, 'song-button'), actions.song);
  press(mic, actions.mic);
  press(pause, actions.pause);
  press(style, actions.style);
  press(find(bar, 'world-button'), actions.world);
  press(find(bar, 'export-button'), actions.export);
  press(fullscreen, actions.fullscreen);
  press(find(corner, 'about-button'), actions.about);
  fullscreen.hidden = !options.fullscreen;

  const body = document.body;
  let timer = 0;
  const wake = () => {
    body.classList.remove('idle');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => body.classList.add('idle'), IDLE_MS);
  };
  for (const type of ['pointermove', 'pointerdown', 'keydown'] as const) {
    window.addEventListener(type, wake, { passive: true });
  }
  wake();

  let micOn = false;
  let songPlaying: boolean | null = null;
  return {
    setMicOn(on) {
      if (on === micOn) return;
      micOn = on;
      mic.setAttribute('aria-pressed', String(on));
      mic.title = on ? 'Stop listening (M)' : 'Listen to the microphone (M)';
    },
    setSongPlaying(playing) {
      if (playing === songPlaying) return;
      songPlaying = playing;
      pause.hidden = playing === null;
      pause.classList.toggle('paused', playing === false);
      if (pauseLabel) pauseLabel.textContent = playing === false ? 'Play' : 'Pause';
      pause.title = playing === false ? 'Play (Space)' : 'Pause (Space)';
    },
    setStyleName(name) {
      if (styleLabel) styleLabel.textContent = name;
    },
    setFullscreen(on) {
      body.classList.toggle('fullscreen', on);
      fullscreen.setAttribute('aria-pressed', String(on));
      fullscreen.title = on ? 'Leave fullscreen (F)' : 'Fullscreen (F)';
      wake();
    },
  };
}
