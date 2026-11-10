// Ordenar tablas con clic en el título (2026-10-15, pedido del usuario). Declarativo, sin inicializar nada:
//   título → <th data-sort="text|num"> (clic: ascendente → descendente → ascendente…; aria-sort indica el estado)
//   valor  → la celda de esa columna: su `data-sort-value` si lo tiene (fechas ISO, números con formato), si no el texto
// Reordena las filas de cada <tbody> (grupos: todas juntas en un recuadro; ascendente → descendente → sin orden) y emite "table-sort" (bubbles) para que el filtro de la tabla (table-filter) relea
// el orden nuevo (tandas de «Ver más» incluidas).

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

function valueOf(row: HTMLTableRowElement, col: number) {
  const cell = row.cells[col];
  return cell?.dataset.sortValue ?? cell?.textContent?.trim() ?? "";
}

// Grupos (table-groups, 2026-10-27): al ordenar, todas las filas pasan a un solo recuadro; el tercer clic quita el
// orden y cada fila vuelve a su grupo, en su lugar de antes
const home = new WeakMap<HTMLTableRowElement, [HTMLTableSectionElement, number]>();

function sortBy(th: HTMLTableCellElement) {
  const table = th.closest("table");
  if (!table?.tBodies.length) return;
  const col = th.cellIndex;
  const num = th.dataset.sort === "num";
  const groups = table.classList.contains("table-groups");
  const prev = th.getAttribute("aria-sort");
  table.querySelectorAll("th[aria-sort]").forEach((x) => x.removeAttribute("aria-sort"));
  if (groups && prev === "descending") {
    const rows = [...table.querySelectorAll<HTMLTableRowElement>("tbody[data-sort-flat] > tr")].filter((r) => home.has(r));
    rows.sort((a, b) => home.get(a)![1] - home.get(b)![1]).forEach((r) => home.get(r)![0].append(r));
    table.querySelector("tbody[data-sort-flat]")?.remove();
    table.dispatchEvent(new CustomEvent("table-sort", { bubbles: true }));
    return;
  }
  const dir = prev === "ascending" ? -1 : 1;
  th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
  const compare = (a: HTMLTableRowElement, b: HTMLTableRowElement) => {
    const x = valueOf(a, col);
    const y = valueOf(b, col);
    // Vacíos siempre al final
    if (!x || !y) return !x && !y ? 0 : !x ? 1 : -1;
    return dir * (num ? Number(x.replace(/[^\d.-]/g, "")) - Number(y.replace(/[^\d.-]/g, "")) : collator.compare(x, y));
  };
  if (groups) {
    let flat = table.querySelector<HTMLTableSectionElement>("tbody[data-sort-flat]");
    if (!flat) {
      let k = 0;
      [...table.tBodies].forEach((body) => [...body.rows].filter((r) => !r.hasAttribute("data-fold-head")).forEach((r) => home.set(r, [body, k++])));
      flat = document.createElement("tbody");
      flat.dataset.sortFlat = "";
      flat.dataset.group = "";
      table.tBodies[0].before(flat);
    }
    // Encabezado de un recuadro plegable (data-fold-head) queda en su recuadro, que se esconde vacío
    const rows = [...table.querySelectorAll<HTMLTableRowElement>("tbody > tr:not([data-fold-head])")];
    flat.append(...rows.sort(compare));
  } else {
    for (const body of table.tBodies) body.append(...[...body.rows].sort(compare));
  }
  table.dispatchEvent(new CustomEvent("table-sort", { bubbles: true }));
}

export function initTableSort() {
  document.addEventListener("click", (e) => {
    const th = (e.target as HTMLElement).closest<HTMLTableCellElement>("th[data-sort]");
    if (th) sortBy(th);
  });
  document.addEventListener("keydown", (e) => {
    const th = (e.target as HTMLElement).closest?.<HTMLTableCellElement>("th[data-sort]");
    if (th && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      sortBy(th);
    }
  });
  // Enfocables con teclado
  const mark = () => document.querySelectorAll<HTMLElement>("th[data-sort]:not([tabindex])").forEach((th) => (th.tabIndex = 0));
  mark();
  document.addEventListener("DOMContentLoaded", mark);
}
