// Indicadores de carga (DESIGN_SYSTEM § 7 · Carga). Tres piezas, de menor a mayor alcance:
//   busy(btn, tarea)      → el botón que disparó la acción muestra spinner y queda bloqueado (evita doble clic)
//   loading(zona, on)     → una zona (tabla, hilo, panel) se atenúa con spinner encima mientras recarga
//   barra superior        → automática: navegación entre páginas y cualquier fetch que tarde > 250 ms
//   esqueleto de página   → automático: si la página nueva tarda > 250 ms, el contenido se cambia por bloques grises
//                           (encabezado, tarjetas y filas) hasta que llega (2026-10-15, pedido del usuario)
// Las consultas periódicas (cada pocos segundos) usan quietFetch() para no mover la barra.

const SHOW_AFTER_MS = 250;

const spinnerEl = () => {
  const s = document.createElement("span");
  s.className = "spinner";
  s.setAttribute("aria-hidden", "true");
  return s;
};

/** Ejecuta `task` con el botón en estado ocupado (spinner en lugar del ícono, deshabilitado). */
export async function busy<T>(el: HTMLElement | null | undefined, task: () => Promise<T>): Promise<T> {
  if (!el || el.getAttribute("aria-busy") === "true") return task();
  const btn = el as HTMLButtonElement;
  const wasDisabled = btn.disabled;
  const icon = el.querySelector<HTMLElement>(":scope > i.bi");
  const spin = spinnerEl();
  el.setAttribute("aria-busy", "true");
  btn.disabled = true;
  if (icon) icon.replaceWith(spin);
  else el.prepend(spin);
  try {
    return await task();
  } finally {
    if (icon) spin.replaceWith(icon);
    else spin.remove();
    el.removeAttribute("aria-busy");
    btn.disabled = wasDisabled;
  }
}

/** Zona que recarga: se atenúa y muestra un spinner encima (sin saltos de alto). */
export function loading(el: HTMLElement | null | undefined, on: boolean) {
  if (!el) return;
  el.classList.toggle("is-loading", on);
  if (on) el.setAttribute("aria-busy", "true");
  else el.removeAttribute("aria-busy");
}

// ---------- Barra de progreso superior ----------
let bar: HTMLElement | undefined;
let pending = 0;
let showTimer: number | undefined;
let finishTimer: number | undefined;

const ensureBar = () => {
  if (bar) return bar;
  bar = document.createElement("div");
  bar.className = "top-progress";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Cargando");
  bar.setAttribute("aria-hidden", "true");
  document.body.append(bar);
  return bar;
};

export const progress = {
  start() {
    pending++;
    clearTimeout(finishTimer);
    if (pending > 1 || showTimer) return;
    showTimer = window.setTimeout(() => {
      showTimer = undefined;
      if (!pending) return;
      const b = ensureBar();
      b.classList.remove("done");
      b.classList.add("active");
    }, SHOW_AFTER_MS);
  },
  done() {
    pending = Math.max(0, pending - 1);
    if (pending) return;
    clearTimeout(showTimer);
    showTimer = undefined;
    if (!bar?.classList.contains("active")) return;
    bar.classList.add("done");
    finishTimer = window.setTimeout(() => bar?.classList.remove("active", "done"), 300);
  },
};

// ---------- Esqueleto de página ----------
// Al salir de la página (enlace, formulario, location.href, recargar) el <main> muestra un esqueleto en lugar del
// contenido viejo. Si la navegación no ocurre (p. ej. un enlace tel:), se quita solo a los 10 s.
let skeletonTimer: number | undefined;
let skeletonOff: number | undefined;

const bone = (cls: string) => `<span class="sk ${cls}"></span>`;
const skeletonHtml = () =>
  `<div class="page-skeleton" aria-hidden="true">
    <div class="sk-head">${bone("sk-title")}${bone("sk-sub")}</div>
    <div class="card sk-kpis">${Array.from({ length: 4 }, () => `<div class="sk-kpi">${bone("sk-label")}${bone("sk-value")}</div>`).join("")}</div>
    <div class="card sk-list">${bone("sk-bar")}${Array.from({ length: 7 }, () => `<div class="sk-row">${bone("sk-cell w-40")}${bone("sk-cell w-20")}${bone("sk-cell w-15")}${bone("sk-cell w-10")}</div>`).join("")}</div>
  </div>`;

function hideSkeleton() {
  clearTimeout(skeletonTimer);
  clearTimeout(skeletonOff);
  const main = document.querySelector("main");
  main?.classList.remove("is-navigating");
  main?.querySelector(":scope > .page-skeleton")?.remove();
}

function showSkeletonSoon() {
  clearTimeout(skeletonTimer);
  skeletonTimer = window.setTimeout(() => {
    const main = document.querySelector("main");
    if (!main || main.querySelector(":scope > .page-skeleton")) return;
    main.insertAdjacentHTML("beforeend", skeletonHtml());
    main.classList.add("is-navigating");
    main.setAttribute("aria-busy", "true");
    skeletonOff = window.setTimeout(hideSkeleton, 10_000);
  }, SHOW_AFTER_MS);
}

const QUIET = Symbol("quiet");

/** fetch que no mueve la barra de progreso (consultas periódicas en segundo plano). */
export const quietFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, [QUIET]: true } as RequestInit);

export function initProgress() {
  const native = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init && (init as Record<symbol, unknown>)[QUIET]) return native(input, init);
    progress.start();
    return native(input, init).finally(() => progress.done());
  };

  // Navegación: al hacer clic en un enlace interno la página nueva tarda (se arma en el servidor)
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
    if (a.pathname === location.pathname && a.search === location.search) return; // mismo lugar o #ancla
    progress.start();
  });
  document.addEventListener("submit", (e) => {
    const form = e.target as HTMLFormElement;
    if (!e.defaultPrevented && form.method !== "dialog") progress.start();
  });
  // Cualquier salida de la página (enlace, formulario, location.href, recargar): esqueleto si tarda
  window.addEventListener("beforeunload", showSkeletonSoon);
  // Volver con «atrás» desde la caché: no queda la barra ni el esqueleto colgados
  window.addEventListener("pageshow", () => {
    hideSkeleton();
    document.querySelector("main")?.removeAttribute("aria-busy");
    pending = 0;
    clearTimeout(showTimer);
    showTimer = undefined;
    bar?.classList.remove("active", "done");
  });
}
