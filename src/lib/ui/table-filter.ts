// Filtro declarativo de tablas (cliente). Dentro de un contenedor `scope`:
//   filas        → <tr data-row data-text="…" data-<clave>="…">  (o cualquier elemento con data-row)
//   buscador     → <input data-filter-q>                 (busca en data-text)
//   selects      → <ds-select data-filter="<clave>">     (data-<clave> contiene el valor; admite varios
//                  valores separados por espacio, p. ej. data-view="main human"; "" = todos)
//   tarjetas     → <button data-filter-card="<clave>" data-value="…" aria-pressed>
//   grupos       → un <tbody data-group="<grupo>"> por grupo en <table class="table table-groups"> (un recuadro
//                  por grupo); se esconde si queda vacío. Al ordenar, table-sort junta las filas en un solo recuadro
//   vacío        → <div data-empty hidden>
//   ver más      → <button data-more hidden> con <span data-more-count> (solo con `page`)
// Todos los filtros se combinan (AND).
// Tras cada cambio llama a `onChange` (y emite "table-filter" en el scope) para que la página
// recalcule KPIs/contadores con lo visible. `set()` fija un filtro desde código (sincronizar pestañas).
// Si la página agrega/quita/reemplaza filas, llama a `rescan()` (al ordenar con table-sort se hace solo).
// Con `page` se muestran solo las primeras `page` filas que pasan los filtros; «Ver más» suma otra
// tanda. Buscador y filtros miran todas las filas y al cambiar vuelven a la primera tanda.

import type { DsSelect } from "./select";

export interface FilterState {
  /** Filas que pasan todos los filtros. */
  visible: HTMLElement[];
  active: Readonly<Record<string, string>>;
  query: string;
  /** Clave cambiada por el usuario ("q" = buscador); null si vino de `set()` o del arranque. */
  changed: string | null;
}

export function initTableFilter(scope: HTMLElement, onChange?: (state: FilterState) => void, page = 0) {
  let rows = [...scope.querySelectorAll<HTMLElement>("[data-row]")];
  const empty = scope.querySelector<HTMLElement>("[data-empty]");
  const more = scope.querySelector<HTMLButtonElement>("[data-more]");
  let limit = page;
  const active: Record<string, string> = {};
  let query = "";
  // Sin filas desde el inicio (p. ej. aún no hay datos): el vacío se ve sin esperar a filtrar
  if (empty && !rows.length) empty.hidden = false;

  /** ¿La fila pasa los filtros? `keys` limita a esas claves (sin buscador ni el resto). */
  const has = (r: HTMLElement, key: string, value: string) => {
    const v = r.dataset[key] ?? "";
    return v === value || v.split(" ").includes(value);
  };
  // Teléfono escrito con espacios o guiones («+51 955 801 449»): se comparan solo los dígitos (2026-10-27)
  const phoneQ = () => (/^[\d\s+().-]+$/.test(query) && query.replace(/\D/g, "").length >= 5 ? query.replace(/\D/g, "") : "");
  const digitsOf = (s: string) => s.replace(/(?<=\d)[\s+().-]+(?=\d)/g, "");
  const textHit = (r: HTMLElement) => {
    const t = r.dataset.text ?? "";
    const p = phoneQ();
    return t.includes(query) || (!!p && digitsOf(t).includes(p));
  };
  const matches = (r: HTMLElement, keys?: string[]) =>
    (keys ? true : !query || textHit(r)) &&
    Object.entries(active).every(([key, value]) => (keys && !keys.includes(key)) || !value || has(r, key, value));

  const apply = (changed: string | null = null) => {
    if (changed !== null) limit = page;
    const visible: HTMLElement[] = [];
    for (const r of rows) {
      const ok = matches(r);
      if (ok) visible.push(r);
      r.hidden = !ok || (page > 0 && visible.length > limit);
    }
    // Grupos: el recuadro se esconde si queda vacío; primera y última fila visibles marcan sus bordes
    for (const g of scope.querySelectorAll<HTMLElement>("tbody[data-group]")) {
      const shown = [...g.querySelectorAll<HTMLElement>("[data-row]")].filter((r) => !r.hidden);
      g.hidden = !shown.length;
      g.querySelectorAll("[data-row]").forEach((r) => {
        r.classList.toggle("group-first", r === shown[0]);
        r.classList.toggle("group-last", r === shown.at(-1));
      });
    }
    if (empty) empty.hidden = visible.length > 0;
    if (more) {
      const left = page ? visible.length - limit : 0;
      more.hidden = left <= 0;
      const count = more.querySelector("[data-more-count]");
      if (count) count.textContent = String(left);
    }
    const state: FilterState = { visible, active: { ...active }, query, changed };
    onChange?.(state);
    scope.dispatchEvent(new CustomEvent("table-filter", { detail: state }));
  };

  more?.addEventListener("click", () => {
    limit += page;
    apply();
  });

  scope.querySelector<HTMLInputElement>("[data-filter-q]")?.addEventListener("input", (e) => {
    query = (e.target as HTMLInputElement).value.trim().toLowerCase();
    apply("q");
  });

  scope.querySelectorAll<HTMLElement>("[data-filter]").forEach((el) =>
    el.addEventListener("change", (e) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return; // ignora "change" nativos de inputs internos
      active[el.dataset.filter!] = detail.value;
      apply(el.dataset.filter!);
    }),
  );

  const cards = [...scope.querySelectorAll<HTMLButtonElement>("[data-filter-card]")];
  const pressCard = (key: string, value: string) =>
    cards.filter((c) => c.dataset.filterCard === key).forEach((c) => c.setAttribute("aria-pressed", String((c.dataset.value ?? "") === value)));
  cards.forEach((card) =>
    card.addEventListener("click", () => {
      const key = card.dataset.filterCard!;
      active[key] = card.dataset.value ?? "";
      pressCard(key, active[key]);
      apply(key);
    }),
  );

  /** Fija un filtro sin disparar eventos del control (actualiza select/tarjetas y re-filtra). */
  const set = (key: string, value: string) => {
    if ((active[key] ?? "") === value) return;
    active[key] = value;
    limit = page;
    scope.querySelectorAll<HTMLElement>(`[data-filter="${key}"]`).forEach((el) => ((el as DsSelect).value = value));
    pressCard(key, value);
    apply();
  };

  /** Vuelve a leer las filas (tras re-renderizar la tabla) y re-filtra. */
  const rescan = () => {
    rows = [...scope.querySelectorAll<HTMLElement>("[data-row]")];
    apply();
  };

  // Ordenaron la tabla (table-sort): se relee el orden de las filas
  scope.addEventListener("table-sort", rescan);

  // Con tandas, desde el arranque se ve solo la primera
  if (page) apply();

  return {
    apply,
    set,
    matches,
    rescan,
    get rows() {
      return rows;
    },
  };
}
