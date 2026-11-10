// Ayudantes para pintar en el navegador (tablas, menús, formatos). Mismo HTML que los componentes .astro.

const moneyFmt = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const dayFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" });
const dayYearFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const money = (n: number) => moneyFmt.format(Math.round(n));
export const num = (n: number) => numFmt.format(n);
export const day = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00Z`)).replace(".", "").replace(" de ", " ");
export const dayYear = (iso: string) => dayYearFmt.format(new Date(`${iso}T12:00:00Z`)).replace(".", "").replaceAll(" de ", " ");
export const today = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-DD en la hora local
/** "2026-11" → "Noviembre 2026" */
export const monthLabel = (ym: string) => {
  const s = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-15T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1).replace(" de ", " ");
};

export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Texto para el buscador de tablas (sin tildes no hace falta: el filtro compara tal cual, en minúsculas). */
export const searchText = (...xs: unknown[]) => xs.filter(Boolean).join(" ").toLowerCase();

export interface MenuItem {
  value?: string;
  label?: string;
  icon?: string;
  danger?: boolean;
  separator?: boolean;
}

/** Igual a components/ui/Menu.astro. */
export const menu = (items: MenuItem[], label = "Más acciones") => `
  <ds-menu>
    <button type="button" class="btn btn-subtle btn-icon btn-sm" data-trigger aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}">
      <i class="bi bi-three-dots" aria-hidden="true"></i>
    </button>
    <div class="popover" role="menu" data-align="end" hidden>
      ${items
        .map((i) =>
          i.separator
            ? `<div class="option-sep" role="separator"></div>`
            : `<button type="button" role="menuitem" class="option${i.danger ? " danger" : ""}" data-value="${esc(i.value)}">${i.icon ? `<i class="bi ${i.icon}" aria-hidden="true"></i>` : ""}${esc(i.label)}</button>`,
        )
        .join("")}
    </div>
  </ds-menu>`;

/** Igual a components/ui/Avatar.astro. */
export const avatar = (name: string, size: "sm" | "md" | "lg" = "sm") =>
  `<span class="avatar ${size}" aria-hidden="true">${esc(
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join(""),
  )}</span>`;

/** Opciones únicas y ordenadas para un Select. */
export const uniqueOptions = (xs: string[]) =>
  [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")).map((x) => ({ value: x, label: x }));

type DsSelectEl = HTMLElement & { value: string; label: string; setOptions(o: { value: string; label: string; hint?: string; disabled?: boolean; keywords?: string }[]): void };
export const dsSelect = (root: ParentNode, selector: string) => root.querySelector<DsSelectEl>(selector)!;
export type { DsSelectEl };

/** Lee un número escrito con puntos de miles o coma decimal ("1.250.000" o "3,9"). */
export const parseNum = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return 0;
  // Si tiene coma, la coma es decimal y los puntos son miles
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  // Solo puntos: si hay más de uno o el grupo final tiene 3 dígitos, son miles
  const parts = t.split(".");
  if (parts.length > 2 || (parts.length === 2 && parts[1]!.length === 3)) return Number(t.replace(/\./g, ""));
  return Number(t);
};

/** Error de un formulario dentro de un modal: un callout en [data-form-error]. */
export function formError(root: ParentNode, msg: string) {
  const box = root.querySelector<HTMLElement>("[data-form-error]");
  if (!box) return window.ui.toast(msg, { tone: "danger" });
  box.querySelector("[data-form-error-text]")!.textContent = msg;
  box.hidden = !msg;
}

/**
 * Ejecuta un cambio: si falla, muestra el motivo; si sale bien, avisa. Devuelve true si salió bien.
 * Mientras espera a la base, el botón «Guardar» del modal (o `btn`) muestra que está trabajando y no deja repetir.
 */
export async function intentar(root: ParentNode | null, fn: () => unknown, ok?: string, btn?: HTMLElement | null) {
  const boton = btn ?? (root instanceof Element ? root.closest("dialog")?.querySelector<HTMLElement>("[data-save]") : null);
  try {
    await window.ui.busy(boton, async () => {
      await fn();
    });
    if (root) formError(root, "");
    if (ok) window.ui.toast(ok, { tone: "success" });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (root) formError(root, msg);
    else window.ui.alert({ tone: "danger", title: "No se pudo", message: msg });
    return false;
  }
}

/** Valor de un Select creable: "new:Cali" → "Cali" (lo nuevo se guarda con su nombre). */
export const sinNuevo = (v: string) => (v.startsWith("new:") ? v.slice(4) : v);

/** Opciones de bodegas y maletas para un Select (con ciudad o «Maleta» en gris). */
export const opcionesLugar = (bs: { id: string; nombre: string; tipo: string; ciudad: string; pais: string }[], conPais = false) =>
  bs.map((b) => ({ value: b.id, label: b.nombre, hint: b.tipo === "monitor" ? "Maleta" : conPais ? `${b.ciudad} · ${b.pais}` : b.ciudad }));

/** Descarga filas como .csv con «;» (Excel lo abre directo, con tildes). */
export function descargarCsv(nombre: string, filas: (string | number)[][]) {
  const csv = filas.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: nombre }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pone en la dirección un filtro (?clave=valor) sin recargar. */
export const urlParam = (k: string) => new URLSearchParams(location.search).get(k) ?? "";

/** Ilumina una fila recién guardada y la trae a la vista. */
export function flashRow(row: Element | null | undefined) {
  if (!row) return;
  row.classList.remove("row-flash");
  void (row as HTMLElement).offsetWidth;
  row.classList.add("row-flash");
  row.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** Campos de plata (data-money): al salir del campo se muestran con puntos de miles ("60.000"). */
export function initMoneyInputs() {
  const fmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
  document.addEventListener(
    "focusout",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || !("money" in el.dataset) || !el.value.trim()) return;
      const n = parseNum(el.value);
      if (Number.isFinite(n)) el.value = fmt.format(n);
    },
    true,
  );
}
