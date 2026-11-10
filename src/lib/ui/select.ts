// <ds-select> — select propio del design system (docs: apps/panel/DESIGN_SYSTEM.md § contratos).
// Uso: <ds-select name="pais" placeholder="Todos los países" searchable>
//        <option value="co" data-hint="texto secundario">Colombia</option> …
//      </ds-select>
// Emite "change" (bubbles) con detail { value, label, created }. Incluye <input type="hidden" name> para formularios.
// Búsqueda sin tildes ni mayúsculas, también por `data-keywords` (alias, separados por coma) y con parecidos
// por tipeo ("Medelin" → Medellín). `creatable`: si lo escrito no existe, ofrece "＋ Crear «…»" al final
// (catálogos: ciudades, sedes…); si ya hay uno igual, no ofrece crear. Texto con `create-label="Crear ciudad"`.
// `action-label="Vincular un número nuevo"` (+ `action-icon`): opción fija al final de la lista, aunque no haya
// resultados; no cambia el valor, emite "select-action" (2026-10-20: crear un número desde la ciudad).

import { placePopover, closeOnViewportChange } from "./position";

type Opt = { value: string; label: string; hint: string; disabled: boolean; keywords: string; created?: boolean; searchOnly?: boolean };

/** Normaliza para comparar: minúsculas, sin tildes, espacios simples. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Distancia de edición acotada (para sugerir parecidos y evitar duplicados por errores de tipeo). */
function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const CREATE = -2;
const ACTION = -3;

/** Mayúscula inicial por palabra al crear ("santa cruz de la sierra" → "Santa Cruz de la Sierra"); respeta lo que ya trae mayúsculas. */
const SMALL = new Set(["de", "del", "la", "las", "los", "el", "y"]);
const smartCase = (s: string) =>
  s
    .split(" ")
    .map((w, i) => (w !== w.toLowerCase() || (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

let uid = 0;

export class DsSelect extends HTMLElement {
  #options: Opt[] = [];
  #value = "";
  #active = -1;
  #built = false;
  #trigger!: HTMLButtonElement;
  #valueEl!: HTMLSpanElement;
  #popover!: HTMLDivElement;
  #list!: HTMLDivElement;
  #search?: HTMLInputElement;
  #hidden?: HTMLInputElement;
  #typeahead = "";
  #typeaheadTimer = 0;
  #id = `ds-select-${++uid}`;
  #unwatch?: () => void;

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;
    this.#options = [...this.querySelectorAll("option")].map((o) => ({
      value: o.value,
      label: o.textContent?.trim() ?? "",
      hint: o.dataset.hint ?? "",
      disabled: o.disabled,
      keywords: o.dataset.keywords ?? "",
      searchOnly: "searchOnly" in o.dataset,
    }));
    const selected = this.querySelector("option[selected]") as HTMLOptionElement | null;
    this.#value = this.getAttribute("value") ?? selected?.value ?? "";
    this.replaceChildren();
    this.#build();
    this.#render();
    document.addEventListener("pointerdown", this.#onOutside);
    this.#unwatch = closeOnViewportChange(() => this.#isOpen, () => this.#close(), this.#popover);
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

  /** Reemplaza las opciones (p. ej. al cargar datos). */
  setOptions(options: { value: string; label: string; hint?: string; disabled?: boolean; keywords?: string; searchOnly?: boolean }[]) {
    this.#options = options.map((o) => ({ ...o, hint: o.hint ?? "", disabled: !!o.disabled, keywords: o.keywords ?? "" }));
    this.#render();
  }

  set disabled(v: boolean) {
    this.toggleAttribute("disabled", v);
    if (this.#trigger) this.#trigger.disabled = v;
  }

  get disabled() {
    return this.hasAttribute("disabled");
  }

  /** Etiqueta de la opción elegida (útil cuando el valor es un id). */
  get label() {
    return this.#options.find((o) => o.value === this.#value)?.label ?? "";
  }

  get #creatable() {
    return this.hasAttribute("creatable");
  }

  get #isOpen() {
    return !this.#popover.hidden;
  }

  #build() {
    const label = this.getAttribute("aria-label") ?? this.getAttribute("placeholder") ?? "";

    this.#trigger = document.createElement("button");
    this.#trigger.type = "button";
    this.#trigger.className = "select-trigger";
    this.#trigger.setAttribute("aria-haspopup", "listbox");
    this.#trigger.setAttribute("aria-expanded", "false");
    this.#trigger.setAttribute("aria-controls", `${this.#id}-list`);
    if (label) this.#trigger.setAttribute("aria-label", label);
    if (this.hasAttribute("disabled")) this.#trigger.disabled = true;

    this.#valueEl = document.createElement("span");
    this.#valueEl.className = "value";
    const chevron = document.createElement("i");
    chevron.className = "bi bi-chevron-down";
    chevron.setAttribute("aria-hidden", "true");
    this.#trigger.append(this.#valueEl, chevron);

    this.#popover = document.createElement("div");
    this.#popover.className = "popover";
    this.#popover.hidden = true;

    if (this.hasAttribute("searchable") || this.#creatable) {
      this.#search = document.createElement("input");
      this.#search.className = "select-search";
      this.#search.type = "search";
      this.#search.placeholder = this.#creatable ? "Buscar o escribir uno nuevo…" : "Buscar…";
      this.#search.setAttribute("aria-controls", `${this.#id}-list`);
      this.#search.addEventListener("input", () => {
        const all = this.#visible();
        const v = all.filter((i) => !this.#options[i].disabled);
        // Si solo coinciden opciones que no se pueden elegir, Enter no hace nada (no salta a la acción del final)
        this.#active = v[0] ?? (this.#createText() ? CREATE : this.#actionLabel && !all.length ? ACTION : -1);
        this.#renderList();
      });
      this.#search.addEventListener("keydown", this.#onListKey);
      // El "change" nativo del buscador no debe confundirse con el "change" del select.
      this.#search.addEventListener("change", (e) => e.stopPropagation());
      this.#popover.append(this.#search);
    }

    this.#list = document.createElement("div");
    this.#list.id = `${this.#id}-list`;
    this.#list.setAttribute("role", "listbox");
    this.#popover.append(this.#list);

    const name = this.getAttribute("name");
    if (name) {
      this.#hidden = document.createElement("input");
      this.#hidden.type = "hidden";
      this.#hidden.name = name;
      this.append(this.#hidden);
    }

    this.#trigger.addEventListener("click", () => (this.#isOpen ? this.#close() : this.#open()));
    this.#trigger.addEventListener("keydown", this.#onTriggerKey);
    this.#list.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
      if (el) this.#choose(Number(el.dataset.index));
    });
    this.#list.addEventListener("pointermove", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
      if (el) this.#setActive(Number(el.dataset.index));
    });

    this.append(this.#trigger, this.#popover);
  }

  /** Índices visibles: coincidencias (sin tildes, alias) y después parecidos por tipeo. `searchOnly`: solo al buscar. */
  #visible(): number[] {
    const q = norm(this.#search?.value ?? "");
    if (!q) return this.#options.flatMap((o, i) => (o.searchOnly ? [] : [i]));
    const hits: number[] = [];
    const near: number[] = [];
    this.#options.forEach((o, i) => {
      if (norm(`${o.label} ${o.hint} ${o.keywords}`).includes(q)) hits.push(i);
      else if (q.length >= 4 && [o.label, ...o.keywords.split(",")].some((w) => w.trim() && distance(norm(w), q) <= 2)) near.push(i);
    });
    return [...hits, ...near];
  }

  /** Texto a crear, o "" si no aplica (vacío o ya existe uno igual por nombre o alias). */
  #createText() {
    if (!this.#creatable || !this.#search) return "";
    const raw = this.#search.value.trim().replace(/\s+/g, " ");
    const q = norm(raw);
    if (!q) return "";
    const exists = this.#options.some((o) => !o.created && (norm(o.label) === q || o.keywords.split(",").some((k) => norm(k) === q)));
    return exists ? "" : raw;
  }

  #render() {
    const current = this.#options.find((o) => o.value === this.#value);
    const placeholder = this.getAttribute("placeholder") ?? "Seleccionar";
    this.#valueEl.textContent = current?.label ?? placeholder;
    if (current?.hint) {
      const hint = document.createElement("span");
      hint.className = "hint-text";
      hint.textContent = ` · ${current.hint}`;
      this.#valueEl.append(hint);
    }
    this.#valueEl.classList.toggle("placeholder", !current);
    if (this.#hidden) this.#hidden.value = this.#value;
    this.#renderList();
  }

  #renderList() {
    const visible = this.#visible();
    this.#list.replaceChildren(
      ...visible.map((i) => {
        const o = this.#options[i];
        const el = document.createElement("div");
        el.className = "option";
        el.id = `${this.#id}-opt-${i}`;
        el.dataset.index = String(i);
        el.setAttribute("role", "option");
        el.setAttribute("aria-selected", String(o.value === this.#value));
        if (o.disabled) el.setAttribute("aria-disabled", "true");
        if (i === this.#active) el.dataset.active = "true";
        const text = document.createElement("span");
        text.textContent = o.label;
        if (o.hint) {
          const hint = document.createElement("span");
          hint.className = "hint-text";
          hint.textContent = o.hint;
          text.append(hint);
        }
        const mark = document.createElement("i");
        mark.className = "bi bi-check2 check-mark";
        mark.setAttribute("aria-hidden", "true");
        el.append(text, mark);
        return el;
      }),
    );
    const create = this.#createText();
    if (create) {
      if (visible.length) {
        const note = document.createElement("p");
        note.className = "option-note";
        note.textContent = "¿Es alguna de estas? Elegirla evita duplicados.";
        this.#list.prepend(note);
      }
      const el = document.createElement("div");
      el.className = "option option-create";
      el.id = `${this.#id}-opt-create`;
      el.dataset.index = String(CREATE);
      el.setAttribute("role", "option");
      if (this.#active === CREATE) el.dataset.active = "true";
      const icon = document.createElement("i");
      icon.className = "bi bi-plus-lg";
      icon.setAttribute("aria-hidden", "true");
      el.append(icon, `${this.getAttribute("create-label") ?? "Crear"} «${create}»`);
      this.#list.append(el);
    } else if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "muted option";
      empty.textContent = "Sin resultados";
      this.#list.append(empty);
    }
    if (this.#actionLabel) {
      const el = document.createElement("div");
      el.className = "option option-create option-action";
      el.id = `${this.#id}-opt-action`;
      el.dataset.index = String(ACTION);
      el.setAttribute("role", "option");
      if (this.#active === ACTION) el.dataset.active = "true";
      const icon = document.createElement("i");
      icon.className = `bi ${this.getAttribute("action-icon") ?? "bi-plus-lg"}`;
      icon.setAttribute("aria-hidden", "true");
      el.append(icon, this.#actionLabel);
      this.#list.append(el);
    }
  }

  get #actionLabel() {
    return this.getAttribute("action-label") ?? "";
  }

  #open() {
    this.#popover.hidden = false;
    this.#trigger.setAttribute("aria-expanded", "true");
    this.#active = Math.max(0, this.#options.findIndex((o) => o.value === this.#value));
    this.#renderList();
    if (this.#search) {
      this.#search.value = "";
      this.#renderList();
    }
    placePopover(this.#trigger, this.#popover, "start", true);
    this.#scrollToActive();
    this.#search?.focus({ preventScroll: true });
  }

  #close(focusTrigger = false) {
    if (!this.#isOpen) return;
    this.#popover.hidden = true;
    this.#trigger.setAttribute("aria-expanded", "false");
    this.#trigger.removeAttribute("aria-activedescendant");
    if (focusTrigger) this.#trigger.focus({ preventScroll: true });
  }

  #choose(index: number) {
    if (index === ACTION) {
      this.#close(true);
      this.dispatchEvent(new CustomEvent("select-action", { bubbles: true }));
      return;
    }
    if (index === CREATE) {
      const typed = this.#createText();
      if (!typed) return;
      const label = smartCase(typed);
      // La opción nueva queda en la lista con valor "new:<texto>" hasta que se guarde
      const created: Opt = { value: `new:${label}`, label, hint: "nueva", disabled: false, keywords: "", created: true };
      this.#options = [...this.#options.filter((o) => !o.created), created];
      this.#value = created.value;
      this.#render();
      this.#close(true);
      this.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: created.value, label, created: true } }));
      return;
    }
    const o = this.#options[index];
    if (!o || o.disabled) return;
    const changed = o.value !== this.#value;
    this.#value = o.value;
    this.#render();
    this.#close(true);
    if (changed) {
      this.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: o.value, label: o.label, created: !!o.created } }));
    }
  }

  #setActive(index: number) {
    this.#active = index;
    this.#list.querySelectorAll<HTMLElement>("[data-index]").forEach((el) => {
      el.dataset.active = String(Number(el.dataset.index) === index);
    });
    this.#trigger.setAttribute("aria-activedescendant", `${this.#id}-opt-${index === CREATE ? "create" : index === ACTION ? "action" : index}`);
  }

  #scrollToActive() {
    // Solo desplaza la lista (scrollIntoView movería también la página y cerraría el popover)
    const el = this.#list.querySelector<HTMLElement>(`[data-index="${this.#active}"]`);
    if (!el) return;
    const list = this.#list;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight;
  }

  #move(delta: number) {
    const visible = this.#visible().filter((i) => !this.#options[i].disabled);
    if (this.#createText()) visible.push(CREATE);
    if (this.#actionLabel) visible.push(ACTION);
    if (!visible.length) return;
    const pos = visible.indexOf(this.#active);
    const next = visible[Math.min(visible.length - 1, Math.max(0, pos + delta))] ?? visible[0];
    this.#setActive(next);
    this.#scrollToActive();
  }

  #onTriggerKey = (e: KeyboardEvent) => {
    if (!this.#isOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        this.#open();
      }
      return;
    }
    this.#onListKey(e);
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.#typeaheadFind(e.key);
  };

  #onListKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.#move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        this.#move(-1);
        break;
      case "Home":
        e.preventDefault();
        this.#move(-Infinity);
        break;
      case "End":
        e.preventDefault();
        this.#move(Infinity);
        break;
      case "Enter":
        e.preventDefault();
        if (this.#active >= 0 || this.#active === CREATE || this.#active === ACTION) this.#choose(this.#active);
        break;
      case "Escape":
        e.preventDefault();
        this.#close(true);
        break;
      case "Tab":
        this.#close();
        break;
    }
  };

  #typeaheadFind(char: string) {
    clearTimeout(this.#typeaheadTimer);
    this.#typeahead += char.toLowerCase();
    this.#typeaheadTimer = window.setTimeout(() => (this.#typeahead = ""), 500);
    const i = this.#options.findIndex((o) => o.label.toLowerCase().startsWith(this.#typeahead));
    if (i >= 0) {
      this.#setActive(i);
      this.#scrollToActive();
    }
  }

  #onOutside = (e: PointerEvent) => {
    if (!this.contains(e.target as Node)) this.#close();
  };
}
