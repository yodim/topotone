/** The About panel: what Topotone is, the keys, privacy, the seed, credits and the repo link. */
export class About {
  private readonly seedEl: HTMLElement | null;

  constructor(
    private readonly dialog: HTMLDialogElement,
    /** The seed as written in the address bar. */
    private readonly seed: () => string,
  ) {
    this.seedEl = dialog.querySelector('#about-seed');
    // A click on the dimmed page around the panel closes it.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) this.close();
    });
    // Give focus back to the page, so Space pauses instead of pressing a button again.
    dialog.addEventListener('close', () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
  }

  get open(): boolean {
    return this.dialog.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    if (this.seedEl) this.seedEl.textContent = this.seed();
    this.dialog.showModal();
  }

  close(): void {
    if (this.open) this.dialog.close();
  }
}
