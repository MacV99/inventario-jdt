// Tooltip propio (global): cualquier elemento con `data-tip="texto"` lo muestra al pasar el mouse o enfocar con
// teclado, a la derecha del elemento (o arriba si `data-tip-side="top"`). `position: fixed` → no lo recorta el
// scroll del contenedor. `data-tip-when="nav-collapsed"` = solo con el menú lateral retraído.
const GAP = 8;

export function initTooltips() {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let current: HTMLElement | null = null;

  const show = (el: HTMLElement) => {
    if (el.dataset.tipWhen === "nav-collapsed" && document.documentElement.dataset.nav !== "collapsed") return;
    current = el;
    tip.textContent = el.dataset.tip ?? "";
    tip.hidden = false;
    const a = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const top = el.dataset.tipSide === "top";
    tip.style.left = `${Math.round(top ? a.left + a.width / 2 - t.width / 2 : a.right + GAP)}px`;
    tip.style.top = `${Math.round(top ? a.top - t.height - GAP : a.top + a.height / 2 - t.height / 2)}px`;
  };
  const hide = () => {
    current = null;
    tip.hidden = true;
  };
  const target = (e: Event) => (e.target as HTMLElement).closest?.<HTMLElement>("[data-tip]") ?? null;

  document.addEventListener("pointerover", (e) => {
    const el = target(e);
    if (el && el !== current) show(el);
    else if (!el && current) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = target(e);
    if (el && (el as HTMLElement).matches(":focus-visible")) show(el);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("click", hide);
  window.addEventListener("scroll", hide, true);
}
