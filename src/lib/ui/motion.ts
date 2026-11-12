// Movimiento sutil y barato: solo opacidad (lo dibuja la tarjeta de video, no recalcula la página).
// Respeta «reducir movimiento» del sistema. Recién cargada la página no anima: ya lo hace el cambio de página.

const EASE = "cubic-bezier(0.2, 0, 0, 1)";
// Pestaña escondida: el navegador congela las animaciones, así que se pone el valor final de una vez
const calmo = () => document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches;
const recienCargada = () => performance.now() < 900;

/** Funde suave un bloque que acaba de cambiar (filas tras un filtro). `leve` = al escribir en el buscador. */
export function suavizar(el: Element, leve = false) {
  if (calmo() || recienCargada() || !el.isConnected) return;
  if (el.getAnimations().some((a) => a.id === "suave" && a.playState === "running")) return;
  const a = el.animate([{ opacity: leve ? 0.6 : 0.25 }, { opacity: 1 }], { duration: leve ? 140 : 220, easing: EASE });
  a.id = "suave";
}

// Cifra en formato es-CO (punto de miles), sin decimales: «9.730», «$ 1.054.000», «PEN 240»
const CIFRA = /\d[\d.]*(?:,\d+)?/;
const fmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const ultimo = new WeakMap<Element, string>(); // último texto pedido para cada cifra

/** Pone el texto de una cifra; si cambió de valor, cuenta rápido del número viejo al nuevo. */
export function contar(el: Element, texto: string) {
  const antes = el.textContent ?? "";
  ultimo.set(el, texto);
  const a = antes.match(CIFRA)?.[0];
  const b = texto.match(CIFRA)?.[0];
  const plantilla = b ? texto.replace(b, "#") : "";
  if (calmo() || recienCargada() || !a || !b || a.includes(",") || b.includes(",") || antes.replace(a, "#") !== plantilla) {
    el.textContent = texto;
    return;
  }
  const de = Number(a.replace(/\./g, ""));
  const hasta = Number(b.replace(/\./g, ""));
  if (de === hasta) {
    el.textContent = texto;
    return;
  }
  const t0 = performance.now();
  const paso = (t: number) => {
    if (ultimo.get(el) !== texto) return; // llegó un valor más nuevo: este conteo se detiene
    const p = Math.min(1, (t - t0) / 320);
    el.textContent = p < 1 ? plantilla.replace("#", fmt.format(Math.round(de + (hasta - de) * (1 - (1 - p) ** 3)))) : texto;
    if (p < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
  // Respaldo: si el navegador no dibuja (ventana tapada), igual queda el valor correcto
  setTimeout(() => ultimo.get(el) === texto && (el.textContent = texto), 450);
}
