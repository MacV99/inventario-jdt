// Modales estándar del design system, sobre <dialog> nativo (foco atrapado, Esc, backdrop).
// Regla de uso (DESIGN_SYSTEM.md § feedback):
//   toast   → confirmación leve que no requiere acción ("Guardado")
//   alert   → error o aviso que el usuario debe leer
//   confirm → acción que hay que confirmar; tone "danger" para destructivas
//   confirmTyped → irreversibles: exige escribir un texto exacto (p. ej. cerrar ciudad como "error")

export type Tone = "info" | "success" | "warning" | "danger";

const ICONS: Record<Tone, string> = {
  info: "bi-info-circle",
  success: "bi-check2-circle",
  warning: "bi-exclamation-triangle",
  danger: "bi-exclamation-octagon",
};

interface BaseOptions {
  title: string;
  message?: string;
  details?: string[];
  tone?: Tone;
}

interface ConfirmOptions extends BaseOptions {
  confirmText?: string;
  cancelText?: string;
}

interface TypedOptions extends ConfirmOptions {
  expected: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

let uid = 0;

function build(opts: BaseOptions, withCancel: boolean, confirmText: string, cancelText: string) {
  const tone = opts.tone ?? "info";
  const id = `ds-modal-${++uid}`;
  const dialog = el("dialog", "modal");
  dialog.setAttribute("aria-labelledby", `${id}-title`);

  const header = el("div", "modal-header");
  const icon = el("span", `modal-icon flex-row ${tone}`);
  const glyph = el("i", `bi ${ICONS[tone]}`);
  glyph.setAttribute("aria-hidden", "true");
  icon.append(glyph);
  const title = el("h2", undefined, opts.title);
  title.id = `${id}-title`;
  header.append(icon, title);

  const body = el("div", "modal-body");
  if (opts.message) body.append(el("p", undefined, opts.message));
  if (opts.details?.length) {
    const ul = el("ul");
    opts.details.forEach((d) => ul.append(el("li", "muted", `• ${d}`)));
    body.append(ul);
  }

  const footer = el("div", "modal-footer");
  const cancel = el("button", "btn btn-ghost", cancelText);
  cancel.type = "button";
  cancel.value = "cancel";
  const ok = el("button", `btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`, confirmText);
  ok.type = "button";
  ok.value = "ok";
  if (withCancel) footer.append(cancel);
  footer.append(ok);

  dialog.append(header, body, footer);
  document.body.append(dialog);
  return { dialog, body, ok, cancel };
}

function run(dialog: HTMLDialogElement, ok: HTMLButtonElement, cancel: HTMLButtonElement, focus: HTMLElement) {
  return new Promise<boolean>((resolve) => {
    const finish = (result: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    ok.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(false);
    });
    dialog.showModal();
    focus.focus();
  });
}

export function alert(opts: BaseOptions & { confirmText?: string }) {
  const { dialog, ok, cancel } = build(opts, false, opts.confirmText ?? "Entendido", "");
  return run(dialog, ok, cancel, ok).then(() => undefined);
}

export function confirm(opts: ConfirmOptions) {
  const { dialog, ok, cancel } = build(opts, true, opts.confirmText ?? "Confirmar", opts.cancelText ?? "Cancelar");
  // En acciones peligrosas el foco inicial va a "Cancelar" para que Enter no destruya nada.
  return run(dialog, ok, cancel, opts.tone === "danger" ? cancel : ok);
}

export function confirmTyped(opts: TypedOptions) {
  const { dialog, body, ok, cancel } = build(
    { tone: "danger", ...opts },
    true,
    opts.confirmText ?? "Eliminar",
    opts.cancelText ?? "Cancelar",
  );
  const field = el("div", "field");
  const label = el("label");
  label.append("Escribe ", el("strong", undefined, opts.expected), " para confirmar");
  const input = el("input", "input");
  input.autocomplete = "off";
  input.id = label.htmlFor = `ds-typed-${++uid}`;
  field.append(label, input);
  body.append(field);
  ok.disabled = true;
  input.addEventListener("input", () => (ok.disabled = input.value.trim() !== opts.expected));
  return run(dialog, ok, cancel, input);
}

/** Abre/cierra un <Modal id="…"> de contenido propio (formularios, detalles). */
export function openModal(id: string) {
  (document.getElementById(id) as HTMLDialogElement | null)?.showModal();
}

export function closeModal(id: string) {
  (document.getElementById(id) as HTMLDialogElement | null)?.close();
}
