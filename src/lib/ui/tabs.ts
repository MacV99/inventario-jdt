// Pestañas (.tabs [data-tab] ↔ [data-panel]). La pestaña abierta queda en la dirección (#reservations): al recargar
// o volver a la página se abre la misma, no la primera.

function select(tab: HTMLElement) {
  const list = tab.closest("[role='tablist']")!;
  list.querySelectorAll<HTMLElement>("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
  const names = [...list.querySelectorAll<HTMLElement>("[data-tab]")].map((t) => t.dataset.tab);
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => {
    if (names.includes(p.dataset.panel)) p.hidden = p.dataset.panel !== tab.dataset.tab;
  });
}

export function initTabs() {
  document.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[role='tablist'] [data-tab]");
    if (!tab) return;
    select(tab);
    history.replaceState(history.state, "", `#${tab.dataset.tab}`);
  });
  const fromUrl = location.hash.slice(1);
  const tab = fromUrl && document.querySelector<HTMLElement>(`[role='tablist'] [data-tab="${CSS.escape(fromUrl)}"]`);
  if (tab) select(tab);
}
