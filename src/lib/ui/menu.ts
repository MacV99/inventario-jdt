// <ds-menu> — menú desplegable de acciones ("⋯"). El markup lo genera Menu.astro;
// este elemento solo aporta el comportamiento (abrir/cerrar, teclado, click fuera).
// Emite "menu-select" (bubbles) con detail { value } al elegir un ítem.

import { placePopover, closeOnViewportChange } from "./position";

export class DsMenu extends HTMLElement {
  #trigger!: HTMLElement;
  #popover!: HTMLElement;
  #unwatch?: () => void;

  connectedCallback() {
    this.#trigger = this.querySelector("[data-trigger]")!;
    this.#popover = this.querySelector("[role='menu']")!;
    if (!this.#trigger || !this.#popover) return;

    this.#trigger.addEventListener("click", () => (this.#popover.hidden ? this.#open() : this.#close()));
    this.#trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.#open();
      }
    });
    this.#popover.addEventListener("keydown", this.#onKey);
    // Sin esto, el foco al presionar desplaza el contenedor de la tabla → "scroll" cierra el menú
    // antes del click y la opción elegida no hace nada.
    this.#popover.addEventListener("mousedown", (e) => e.preventDefault());
    this.#popover.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[role='menuitem']");
      if (!item) return;
      this.#close(true);
      this.dispatchEvent(new CustomEvent("menu-select", { bubbles: true, detail: { value: item.dataset.value } }));
    });
  }

  // Los avisos de la página (click fuera, scroll, resize) se escuchan solo con el menú abierto:
  // una tabla con cientos de filas tendría cientos de oyentes corriendo en cada scroll.
  disconnectedCallback() {
    this.#unlisten();
  }

  #unlisten() {
    document.removeEventListener("pointerdown", this.#onOutside);
    this.#unwatch?.();
    this.#unwatch = undefined;
  }

  get #items() {
    return [...this.#popover.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])")];
  }

  #open() {
    this.#popover.hidden = false;
    this.#trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", this.#onOutside);
    this.#unwatch ??= closeOnViewportChange(() => !this.#popover.hidden, () => this.#close(), this.#popover);
    placePopover(this.#trigger, this.#popover, this.#popover.dataset.align === "end" ? "end" : "start");
    this.#items[0]?.focus({ preventScroll: true });
  }

  #close(focusTrigger = false) {
    if (this.#popover.hidden) return;
    this.#popover.hidden = true;
    this.#trigger.setAttribute("aria-expanded", "false");
    this.#unlisten();
    if (focusTrigger) this.#trigger.focus({ preventScroll: true });
  }

  #onKey = (e: KeyboardEvent) => {
    const items = this.#items;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus({ preventScroll: true });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus({ preventScroll: true });
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.#close(true);
    } else if (e.key === "Tab") {
      this.#close();
    }
  };

  #onOutside = (e: PointerEvent) => {
    if (!this.contains(e.target as Node)) this.#close();
  };
}
