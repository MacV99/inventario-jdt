// Posiciona un popover con position: fixed junto a su ancla. Fixed evita que lo recorten
// contenedores con overflow (tablas con scroll horizontal, modales).
const GAP = 6;

export function placePopover(anchor: HTMLElement, popover: HTMLElement, align: "start" | "end" = "start", matchWidth = false) {
  const a = anchor.getBoundingClientRect();
  if (matchWidth) popover.style.minWidth = `${a.width}px`;
  const p = popover.getBoundingClientRect();
  const below = window.innerHeight - a.bottom;
  const top = below < p.height + GAP && a.top > below ? a.top - p.height - GAP : a.bottom + GAP;
  let left = align === "end" ? a.right - p.width : a.left;
  left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));
  popover.style.top = `${Math.max(8, top)}px`;
  popover.style.left = `${left}px`;
}

/** Cierra el popover si la página hace scroll o cambia de tamaño (evita que quede flotando). */
export function closeOnViewportChange(isOpen: () => boolean, close: () => void, own: HTMLElement) {
  const onScroll = (e: Event) => {
    if (isOpen() && !own.contains(e.target as Node)) close();
  };
  const onResize = () => isOpen() && close();
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
  return () => {
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
  };
}
