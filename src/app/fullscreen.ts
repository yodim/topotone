/**
 * Fullscreen, with the prefixed calls older Safari needs. Safari on the iPhone has no
 * fullscreen for pages at all, so the button is hidden there.
 */

export function canFullscreen(): boolean {
  return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
}

/** Enters or leaves fullscreen. Resolves to false when the browser refused. */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else document.webkitExitFullscreen?.();
      return true;
    }
    const root = document.documentElement;
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    else return false;
    return true;
  } catch (err) {
    console.warn(err);
    return false;
  }
}

export function onFullscreenChange(listener: () => void): void {
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
}
