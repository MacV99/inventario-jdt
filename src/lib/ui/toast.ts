import type { Tone } from "./dialogs";

const ICONS: Record<Tone, string> = {
  info: "bi-info-circle",
  success: "bi-check2-circle",
  warning: "bi-exclamation-triangle",
  danger: "bi-exclamation-octagon",
};

function region() {
  let r = document.querySelector<HTMLElement>(".toast-region");
  if (!r) {
    r = document.createElement("div");
    r.className = "toast-region";
    r.setAttribute("role", "status");
    r.setAttribute("aria-live", "polite");
    // Top layer: si no, un <dialog> abierto con showModal() tapa el aviso (z-index no alcanza)
    r.popover = "manual";
    document.body.append(r);
  }
  // Re-abrir lo pone encima del último modal abierto
  if (r.matches(":popover-open")) r.hidePopover();
  r.showPopover();
  return r;
}

function removeToast(t: HTMLElement) {
  const r = t.parentElement;
  t.remove();
  if (r && !r.childElementCount && r.matches(":popover-open")) r.hidePopover();
}

/** Aviso breve no bloqueante. Para errores que requieren lectura, usar alert(). */
export function toast(message: string, { tone = "info", timeout = 3500 }: { tone?: Tone; timeout?: number } = {}) {
  const t = document.createElement("div");
  t.className = `toast ${tone}`;
  const icon = document.createElement("i");
  icon.className = `bi ${ICONS[tone]}`;
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = message;
  t.append(icon, text);
  region().append(t);
  window.setTimeout(() => {
    t.classList.add("leaving");
    t.addEventListener("transitionend", () => removeToast(t), { once: true });
    window.setTimeout(() => removeToast(t), 400);
  }, timeout);
}

/** Aviso que se queda hasta que lo usan o lo cierran, con un botón de acción. Si ya hay uno con el mismo `id`, no se repite. */
export function toastAction(message: string, action: string, onAction: () => void, { id, tone = "info" }: { id?: string; tone?: Tone } = {}) {
  if (id && document.querySelector(`.toast[data-toast-id="${id}"]`)) return;
  const t = document.createElement("div");
  t.className = `toast ${tone}`;
  if (id) t.dataset.toastId = id;
  const icon = document.createElement("i");
  icon.className = `bi ${ICONS[tone]}`;
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary btn-sm";
  btn.textContent = action;
  btn.addEventListener("click", () => {
    removeToast(t);
    onAction();
  });
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn-ghost btn-sm btn-icon";
  close.setAttribute("aria-label", "Cerrar aviso");
  close.innerHTML = '<i class="bi bi-x" aria-hidden="true"></i>';
  close.addEventListener("click", () => removeToast(t));
  t.append(icon, text, btn, close);
  region().append(t);
}

const FLASH_KEY = "jdt-flash";

/** Toast que se muestra en la siguiente página (p. ej. "Ciudad creada" y luego redirigir). */
export function flash(message: string, tone: Tone = "success") {
  try {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, tone }));
  } catch {
    toast(message, { tone });
  }
}

export function showFlash() {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return;
    sessionStorage.removeItem(FLASH_KEY);
    const { message, tone } = JSON.parse(raw) as { message: string; tone: Tone };
    toast(message, { tone });
  } catch {}
}
