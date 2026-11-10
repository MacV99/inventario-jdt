// Tablas como tarjetas en el celular (2026-10-26, pedido del usuario). Declarativo:
//   <table class="table table-cards">  → bajo 600 px cada fila es una tarjeta (global.css «TABLA EN TARJETAS»)
//   <th data-card-title>              → esa columna va como título de la tarjeta (si no: la primera con texto)
// Copia el título de cada columna a sus celdas (data-label) y marca el título y las acciones. Vigila la tabla:
// las filas que se pintan después (filtros, «Ver más», consultas) también se marcan.

function labelOf(th: HTMLTableCellElement) {
  const copy = th.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".sr-only").forEach((x) => x.remove());
  return copy.textContent?.trim() ?? "";
}

function mark(table: HTMLTableElement) {
  const heads = [...(table.tHead?.rows[0]?.cells ?? [])] as HTMLTableCellElement[];
  if (!heads.length) return;
  const labels = heads.map(labelOf);
  const chosen = heads.findIndex((th) => th.hasAttribute("data-card-title"));
  const title = chosen >= 0 ? chosen : labels.findIndex((l, i) => l && !heads[i]!.classList.contains("icon-col"));
  const last = heads.length - 1;
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      if (row.cells.length === 1) continue; // fila de aviso o «Ver más» (colspan)
      let col = 0;
      for (const cell of row.cells) {
        const label = labels[col] ?? "";
        if (label && cell.dataset.label !== label) cell.dataset.label = label;
        cell.classList.toggle("card-title", col === title);
        cell.classList.toggle("card-actions", col === last && !label);
        col += cell.colSpan;
      }
    }
  }
}

export function initTableCards() {
  const watch = (table: HTMLTableElement) => {
    mark(table);
    // Una sola pasada por cuadro aunque lleguen muchas filas juntas
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        mark(table);
      });
    }).observe(table, { childList: true, subtree: true });
  };
  document.querySelectorAll<HTMLTableElement>("table.table-cards").forEach(watch);
}
