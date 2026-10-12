/**
 * Song files arrive by drag and drop anywhere on the page, or through the file picker. While
 * a file is dragged over the page, a veil says where it will go.
 */

/** Browsers keep sending dragover while a file hovers; the veil goes once they stop. */
const VEIL_MS = 400;

export function bindFiles(
  input: HTMLInputElement,
  veil: HTMLElement,
  onFile: (file: File) => void,
): void {
  let timer = 0;
  const hideVeil = () => {
    window.clearTimeout(timer);
    veil.hidden = true;
  };
  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    veil.hidden = false;
    window.clearTimeout(timer);
    timer = window.setTimeout(hideVeil, VEIL_MS);
  });
  window.addEventListener('dragleave', (e) => {
    // Leaving the window, not just moving from one element to another.
    if (e.relatedTarget === null) hideVeil();
  });
  window.addEventListener('drop', (e) => {
    hideVeil();
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    e.preventDefault();
    onFile(file);
  });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
    input.value = '';
  });
}
