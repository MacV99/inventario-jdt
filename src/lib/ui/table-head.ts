// Nombres de columnas siempre arriba al bajar (2026-11-04, pedido del usuario). Automático en toda .table-wrap:
//   la tabla cabe            → data-head="page": el encabezado se queda arriba de la ventana
//   más ancha que la pantalla → data-head="self": baja dentro de su recuadro (deslizar de lado impide usar la ventana)
// Se vuelve a medir si cambian la ventana o las filas. Las ventanas modales tienen su propia regla en global.css.

function measure(wrap: HTMLElement, table: HTMLElement) {
  if (!wrap.clientWidth) return; // escondida (pestaña o sección cerrada): se mide al mostrarse
  const head = table.getBoundingClientRect().width > wrap.clientWidth + 1 ? "self" : "page";
  if (wrap.dataset.head !== head) wrap.dataset.head = head;
}

export function initTableHeads() {
  document.querySelectorAll<HTMLElement>(".table-wrap").forEach((wrap) => {
    const table = wrap.querySelector<HTMLElement>(":scope > table");
    if (!table || wrap.closest("dialog")) return;
    measure(wrap, table);
    new ResizeObserver(() => measure(wrap, table)).observe(wrap);
    new ResizeObserver(() => measure(wrap, table)).observe(table);
  });
}
