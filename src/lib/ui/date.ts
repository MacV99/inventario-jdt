// <ds-date> — selector de fecha propio del design system (el calendario nativo no se puede estilizar).
// Se escribe a mano (dd/mm/aaaa) o se elige en el calendario del ícono: los dos sirven.
// Uso: <ds-date name="day1" value="2026-11-07" min="2026-09-26" span="2" placeholder="Elige la fecha">
//   value/min en ISO (AAAA-MM-DD) · span="2" resalta también el día siguiente (curso de 2 días).
// Emite "input" y "change" (bubbles) con detail { value }. Incluye <input type="hidden" name> para formularios.

import { placePopover, closeOnViewportChange } from "./position";

const TZ_NOON = "T12:00:00Z";
const monthFmt = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const toDate = (iso: string) => new Date(`${iso}${TZ_NOON}`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};
/** Hoy en Bogotá (ADR-029). */
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
/** ISO → "07/11/2026". */
const toText = (iso: string) => (iso ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
/** "7/11/2026", "07-11-26" o "07112026" → ISO; "" si no es una fecha real. */
const parseText = (text: string) => {
  const t = text.trim();
  const parts = /^\d{8}$/.test(t) ? [t.slice(0, 2), t.slice(2, 4), t.slice(4)] : t.split(/[\/\-. ]+/);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return "";
  const [d, m] = parts.map(Number);
  const y = parts[2].length === 2 ? 2000 + Number(parts[2]) : Number(parts[2]);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return "";
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return toIso(toDate(iso)) === iso ? iso : "";
};
/** Mientras escribe solo números, pone las barras: "0711" → "07/11". */
const maskText = (text: string) => {
  if (/[^\d]/.test(text)) return text;
  const d = text.slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
};

export class DsDate extends HTMLElement {
  #value = "";
  #view = ""; // primer día del mes visible (ISO)
  #focus = "";
  #built = false;
  #field!: HTMLDivElement;
  #input!: HTMLInputElement;
  #trigger!: HTMLButtonElement;
  #popover!: HTMLDivElement;
  #grid!: HTMLDivElement;
  #title!: HTMLSpanElement;
  #hidden?: HTMLInputElement;
  #unwatch?: () => void;

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;
    this.#value = this.getAttribute("value") ?? "";
    this.#build();
    this.#render();
    document.addEventListener("pointerdown", this.#onOutside);
    this.#unwatch = closeOnViewportChange(() => !this.#popover.hidden, () => this.#close(), this.#popover);
  }

  disconnectedCallback() {
    document.removeEventListener("pointerdown", this.#onOutside);
    this.#unwatch?.();
  }

  get value() {
    return this.#value;
  }

  set value(v: string) {
    this.#value = v;
    this.#render();
  }

  get min() {
    return this.getAttribute("min") ?? "";
  }

  set min(v: string) {
    this.setAttribute("min", v);
  }

  get #span() {
    return Math.max(1, Number(this.getAttribute("span") ?? 1));
  }

  #build() {
    this.#field = document.createElement("div");
    this.#field.className = "date-field";
    this.#input = document.createElement("input");
    this.#input.type = "text";
    this.#input.className = "input date-input";
    this.#input.inputMode = "numeric";
    this.#input.autocomplete = "off";
    this.#input.maxLength = 10;
    this.#input.placeholder = "día/mes/año";
    const label = this.getAttribute("aria-label");
    if (label) this.#input.setAttribute("aria-label", `${label} (día/mes/año)`);
    this.#trigger = document.createElement("button");
    this.#trigger.type = "button";
    this.#trigger.className = "btn btn-subtle btn-icon btn-sm date-open";
    this.#trigger.setAttribute("aria-haspopup", "dialog");
    this.#trigger.setAttribute("aria-expanded", "false");
    this.#trigger.setAttribute("aria-label", "Abrir calendario");
    this.#trigger.innerHTML = `<i class="bi bi-calendar3" aria-hidden="true"></i>`;
    this.#field.append(this.#input, this.#trigger);

    this.#popover = document.createElement("div");
    this.#popover.className = "popover date-popover";
    this.#popover.setAttribute("role", "dialog");
    this.#popover.hidden = true;
    this.#popover.innerHTML = `
      <div class="date-head">
        <button type="button" class="btn btn-subtle btn-icon btn-sm" data-nav="-1" aria-label="Mes anterior"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
        <span class="date-title"></span>
        <button type="button" class="btn btn-subtle btn-icon btn-sm" data-nav="1" aria-label="Mes siguiente"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
      </div>
      <div class="date-week">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="date-grid" role="grid"></div>
      <div class="date-foot">
        <button type="button" class="btn btn-subtle btn-sm" data-clear>Borrar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-today>Hoy</button>
      </div>`;
    this.#title = this.#popover.querySelector(".date-title")!;
    this.#grid = this.#popover.querySelector(".date-grid")!;

    const name = this.getAttribute("name");
    if (name) {
      this.#hidden = document.createElement("input");
      this.#hidden.type = "hidden";
      this.#hidden.name = name;
      this.append(this.#hidden);
    }

    this.#trigger.addEventListener("click", () => (this.#popover.hidden ? this.#open() : this.#close()));
    // Los eventos propios del campo no salen: afuera solo llega el "input"/"change" de la fecha ya válida.
    this.#input.addEventListener("change", (e) => e.stopPropagation());
    this.#input.addEventListener("input", (e) => {
      e.stopPropagation();
      const masked = maskText(this.#input.value);
      if (masked !== this.#input.value) this.#input.value = masked;
      this.#input.removeAttribute("aria-invalid");
    });
    this.#input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.#commitText();
      } else if (e.key === "ArrowDown" && this.#popover.hidden) {
        e.preventDefault();
        this.#open();
      }
    });
    this.#input.addEventListener("blur", () => this.#commitText());
    this.#popover.addEventListener("mousedown", (e) => e.preventDefault());
    this.#popover.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const nav = t.closest<HTMLElement>("[data-nav]");
      if (nav) return this.#shift(Number(nav.dataset.nav));
      const day = t.closest<HTMLButtonElement>("[data-day]");
      if (day && !day.disabled) return this.#choose(day.dataset.day!);
      if (t.closest("[data-today]")) return this.#choose(todayIso());
      if (t.closest("[data-clear]")) return this.#choose("");
    });
    this.#popover.addEventListener("keydown", this.#onKey);
    this.append(this.#field, this.#popover);
  }

  #render() {
    this.#input.value = toText(this.#value);
    this.#input.removeAttribute("aria-invalid");
    this.#input.title = this.#value ? longFmt.format(toDate(this.#value)).replace(/\./g, "") : "";
    if (this.#hidden) this.#hidden.value = this.#value;
    if (!this.#popover.hidden) this.#renderGrid();
  }

  #renderGrid() {
    const first = toDate(this.#view);
    const m = monthFmt.format(first);
    this.#title.textContent = m.charAt(0).toUpperCase() + m.slice(1);
    const offset = (first.getUTCDay() + 6) % 7; // lunes = 0
    const start = addDays(this.#view, -offset);
    const month = this.#view.slice(0, 7);
    const min = this.min;
    const today = todayIso();
    const spanEnd = this.#value ? addDays(this.#value, this.#span - 1) : "";
    const cells: string[] = [];
    for (let i = 0; i < 42; i++) {
      const iso = addDays(start, i);
      const cls = [
        "date-day",
        iso.slice(0, 7) !== month && "out",
        iso === today && "today",
        iso === this.#value && "selected",
        this.#span > 1 && this.#value && iso > this.#value && iso <= spanEnd && "in-span",
      ]
        .filter(Boolean)
        .join(" ");
      const disabled = !!min && iso < min;
      cells.push(
        `<button type="button" class="${cls}" data-day="${iso}" tabindex="${iso === this.#focus ? 0 : -1}" aria-selected="${iso === this.#value}" ${disabled ? "disabled" : ""} aria-label="${longFmt.format(toDate(iso))}">${Number(iso.slice(8))}</button>`,
      );
    }
    this.#grid.innerHTML = cells.join("");
    const todayBtn = this.#popover.querySelector<HTMLButtonElement>("[data-today]")!;
    todayBtn.disabled = !!min && today < min;
  }

  #open() {
    const base = this.#value || (this.min && this.min > todayIso() ? this.min : todayIso());
    this.#view = `${base.slice(0, 7)}-01`;
    this.#focus = base;
    this.#popover.hidden = false;
    this.#trigger.setAttribute("aria-expanded", "true");
    this.#renderGrid();
    placePopover(this.#field, this.#popover, "start");
    this.#grid.querySelector<HTMLButtonElement>(`[data-day="${this.#focus}"]`)?.focus({ preventScroll: true });
  }

  #close(focusTrigger = false) {
    if (this.#popover.hidden) return;
    this.#popover.hidden = true;
    this.#trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) this.#input.focus({ preventScroll: true });
  }

  /** Lo escrito a mano: si es fecha válida la toma; si no, marca el campo en rojo. */
  #commitText() {
    const text = this.#input.value.trim();
    if (text === toText(this.#value)) return;
    if (!text) return this.#choose("", false);
    const iso = parseText(text);
    if (!iso || (this.min && iso < this.min)) {
      this.#input.setAttribute("aria-invalid", "true");
      this.#input.title = !iso ? "Escribe la fecha así: día/mes/año (07/11/2026)" : `No puede ser antes del ${toText(this.min)}`;
      return;
    }
    this.#choose(iso, false);
  }

  #shift(months: number) {
    const d = toDate(this.#view);
    d.setUTCMonth(d.getUTCMonth() + months);
    this.#view = toIso(d);
    this.#renderGrid();
  }

  #choose(iso: string, focusInput = true) {
    const changed = iso !== this.#value;
    this.#value = iso;
    this.#render();
    this.#close();
    if (focusInput) this.#input.focus({ preventScroll: true });
    if (!changed) return;
    this.dispatchEvent(new CustomEvent("input", { bubbles: true, detail: { value: iso } }));
    this.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: iso } }));
  }

  #onKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key === "Escape") {
      e.preventDefault();
      return this.#close(true);
    }
    const day = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-day]");
    if (!day) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!day.disabled) this.#choose(day.dataset.day!);
      return;
    }
    if (!(e.key in moves) && e.key !== "PageUp" && e.key !== "PageDown") return;
    e.preventDefault();
    this.#focus = e.key === "PageUp" ? addDays(day.dataset.day!, -28) : e.key === "PageDown" ? addDays(day.dataset.day!, 28) : addDays(day.dataset.day!, moves[e.key]);
    if (this.#focus.slice(0, 7) !== this.#view.slice(0, 7)) this.#view = `${this.#focus.slice(0, 7)}-01`;
    this.#renderGrid();
    this.#grid.querySelector<HTMLButtonElement>(`[data-day="${this.#focus}"]`)?.focus({ preventScroll: true });
  };

  #onOutside = (e: PointerEvent) => {
    if (!this.contains(e.target as Node)) this.#close();
  };
}
