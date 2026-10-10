/** Song files arrive by drag and drop anywhere on the page, or through the file picker. */
export function bindFiles(input: HTMLInputElement, onFile: (file: File) => void): void {
  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
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
