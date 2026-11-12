// Actualiza un StatCard con `dataKey` desde JS: [data-kpi="clave"] y [data-kpi-delta="clave"].
import { contar } from "./motion";

export function setKpi(root: ParentNode, key: string, value: string | number, delta?: string, trend?: "up" | "down" | "flat") {
  const v = root.querySelector(`[data-kpi="${key}"]`);
  if (v) contar(v, String(value));
  const d = root.querySelector(`[data-kpi-delta="${key}"]`);
  if (!d) return;
  if (delta !== undefined) d.textContent = delta;
  if (trend) ["up", "down", "flat"].forEach((t) => d.classList.toggle(t, t === trend));
}
