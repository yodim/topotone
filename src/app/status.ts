/** A short line of text at the bottom of the page: progress, hints and friendly errors. */
export class Status {
  private timer = 0;

  constructor(private readonly el: HTMLElement) {}

  /** Shows a message. Without `stay`, it fades out after a few seconds. */
  show(text: string, opts: { stay?: boolean; error?: boolean } = {}): void {
    window.clearTimeout(this.timer);
    this.el.textContent = text;
    this.el.classList.toggle('error', opts.error ?? false);
    this.el.classList.add('visible');
    if (!opts.stay) this.timer = window.setTimeout(() => this.hide(), opts.error ? 6000 : 3000);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el.classList.remove('visible');
  }
}
