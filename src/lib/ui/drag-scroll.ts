// Tablas grandes que se mueven arrastrando (copiado del call center 2026-11-24, pedido del usuario para Cursos).
// <div class="table-wrap" data-drag>:
//   - con el clic oprimido se arrastra la tabla en los dos sentidos (lo que sobra hacia arriba/abajo mueve la página)
//   - el recuadro llega solo hasta el borde de abajo de la pantalla, así su barra de lado siempre se ve
// Solo con mouse: en el celular el dedo ya la mueve. Un arrastre no cuenta como clic (no abre enlaces).

const MIN_MOVE = 4; // px antes de tomarlo como arrastre y no como clic

function fit(wrap: HTMLElement) {
  if (!wrap.clientWidth) return; // escondida (pestaña cerrada): se mide al mostrarse
  const top = Math.round(wrap.getBoundingClientRect().top + window.scrollY);
  wrap.style.setProperty("--wrap-top", `${top}px`);
}

function bind(wrap: HTMLElement) {
  let start: { x: number; y: number; left: number; top: number } | null = null;
  let moved = false;

  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("a, button, input, textarea, select, label, [contenteditable]")) return;
    start = { x: e.clientX, y: e.clientY, left: wrap.scrollLeft, top: wrap.scrollTop };
    moved = false;
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved) {
      if (Math.abs(dx) < MIN_MOVE && Math.abs(dy) < MIN_MOVE) return;
      moved = true;
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add("is-dragging");
    }
    wrap.scrollLeft = start.left - dx;
    const before = wrap.scrollTop;
    wrap.scrollTop = start.top - dy;
    // El recuadro ya no baja más (o no tiene alto propio): mueve la página
    if (wrap.scrollTop === before) window.scrollBy(0, -e.movementY);
  });

  const end = () => {
    start = null;
    wrap.classList.remove("is-dragging");
  };
  wrap.addEventListener("pointerup", end);
  wrap.addEventListener("pointercancel", end);

  // Soltar tras arrastrar no abre lo que quedó debajo
  wrap.addEventListener(
    "click",
    (e) => {
      if (!moved) return;
      moved = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // Que el navegador no intente arrastrar enlaces o imágenes
  wrap.addEventListener("dragstart", (e) => e.preventDefault());

  fit(wrap);
  new ResizeObserver(() => fit(wrap)).observe(wrap);
}

export function initDragScroll() {
  document.querySelectorAll<HTMLElement>(".table-wrap[data-drag]").forEach(bind);
  window.addEventListener("resize", () => document.querySelectorAll<HTMLElement>(".table-wrap[data-drag]").forEach(fit));
}
