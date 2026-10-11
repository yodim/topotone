/**
 * Buttons in the corner: play a song, turn the mic on or off, and export the panorama. They
 * are the only way in on a phone, where there is no keyboard and no drag and drop. They dim when nothing moves for
 * a few seconds and come back on any touch, click or key.
 */
const IDLE_MS = 3000;

export interface Controls {
  /** Shows whether the mic is on. Cheap to call every frame. */
  setMicOn(on: boolean): void;
}

export function bindControls(
  root: HTMLElement,
  actions: { song: () => void; mic: () => void; export: () => void },
): Controls {
  const song = root.querySelector<HTMLButtonElement>('#song-button');
  const mic = root.querySelector<HTMLButtonElement>('#mic-button');
  const exporter = root.querySelector<HTMLButtonElement>('#export-button');
  if (!song || !mic || !exporter) throw new Error('Missing control buttons');

  const press = (button: HTMLButtonElement, action: () => void) =>
    button.addEventListener('click', () => {
      action();
      // Give focus back to the page, so Space pauses instead of pressing the button again.
      button.blur();
    });
  press(song, actions.song);
  press(mic, actions.mic);
  press(exporter, actions.export);

  let timer = 0;
  const wake = () => {
    root.classList.remove('idle');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => root.classList.add('idle'), IDLE_MS);
  };
  for (const type of ['pointermove', 'pointerdown', 'keydown'] as const) {
    window.addEventListener(type, wake, { passive: true });
  }
  wake();

  let micOn = false;
  return {
    setMicOn(on) {
      if (on === micOn) return;
      micOn = on;
      mic.setAttribute('aria-pressed', String(on));
      mic.title = on ? 'Stop listening (M)' : 'Listen to the microphone (M)';
    },
  };
}
