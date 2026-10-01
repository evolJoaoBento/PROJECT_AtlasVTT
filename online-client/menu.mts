// online-client/menu.mts
/**
 * The menu: a side panel, or a bottom sheet on narrow screens (`style.css`), opened by
 * the menu button and closed by its close button or Escape.
 */
export class Menu {
  constructor(private readonly button: HTMLButtonElement, private readonly panel: HTMLElement, close: HTMLButtonElement) {
    button.addEventListener('click', () => this.setOpen(panel.hidden));
    close.addEventListener('click', () => this.close());
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
  }

  private close(): void {
    this.setOpen(false);
    this.button.focus();
  }
}
