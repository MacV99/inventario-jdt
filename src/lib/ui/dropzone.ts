// Arrastrar y soltar archivos en todo el panel (delegado en document, sin tocar cada pantalla):
// - Cualquier <label> que contenga <input type="file"> acepta archivos soltados encima.
// - Zonas grandes: data-drop-target="<selector de inputs>" (p. ej. la conversación → el adjunto del composer).
//   Si hay varios inputs, se usa el primero cuyo `accept` admita el archivo (imagen → uno, audio → otro).
// - data-drop-text en un <textarea>: el archivo de texto (.txt, .csv) se lee y se agrega al campo.
// Al soltar se asigna el archivo al input y se emite su "change" normal, así cada pantalla no cambia nada.
// Soltar fuera de una zona no hace nada (evita que el navegador abra el archivo y se pierda lo escrito).

type Zone = { el: HTMLElement; inputs: HTMLInputElement[]; text?: HTMLTextAreaElement };

const OVER = "drop-over";
let current: HTMLElement | null = null;

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

function zoneOf(target: EventTarget | null): Zone | null {
  const el = target instanceof Element ? target : null;
  if (!el) return null;
  const text = el.closest<HTMLTextAreaElement>("textarea[data-drop-text]");
  if (text && !text.disabled) return { el: text, inputs: [], text };
  const label = el.closest<HTMLElement>("label");
  const own = label?.querySelector<HTMLInputElement>('input[type="file"]');
  if (label && own && !own.disabled) return { el: label, inputs: [own] };
  const area = el.closest<HTMLElement>("[data-drop-target]");
  if (!area || area.closest("[hidden]")) return null;
  const inputs = [...area.querySelectorAll<HTMLInputElement>(area.dataset.dropTarget!)].filter((i) => i.type === "file" && !i.disabled);
  return inputs.length ? { el: area, inputs } : null;
}

/** ¿El archivo cumple el `accept` del input? ("image/*", "audio/*", ".pdf"…) */
function accepts(input: HTMLInputElement, file: File) {
  const rules = (input.accept || "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return rules.some((r) => (r.startsWith(".") ? name.endsWith(r) : r.endsWith("/*") ? type.startsWith(r.slice(0, -1)) : type === r));
}

function setOver(el: HTMLElement | null) {
  if (current === el) return;
  current?.classList.remove(OVER);
  current = el;
  current?.classList.add(OVER);
}

export function initDropzones() {
  document.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // necesario para permitir soltar
    const zone = zoneOf(e.target);
    e.dataTransfer!.dropEffect = zone ? "copy" : "none";
    setOver(zone?.el ?? null);
  });

  document.addEventListener("dragleave", (e) => {
    // Solo al salir de la ventana (relatedTarget null); moverse entre hijos no cuenta
    if (!(e as DragEvent).relatedTarget) setOver(null);
  });

  document.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const zone = zoneOf(e.target);
    setOver(null);
    const file = e.dataTransfer!.files[0];
    if (!zone || !file) return;

    if (zone.text) {
      if (!/^text\/|\.(txt|csv)$/i.test(file.type || file.name)) return window.ui.toast("Aquí se admiten archivos de texto (.txt o .csv)", { tone: "warning" });
      const content = await file.text();
      zone.text.value = zone.text.value.trim() ? `${zone.text.value.trim()}\n${content.trim()}` : content.trim();
      zone.text.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    const input = zone.inputs.find((i) => accepts(i, file));
    if (!input) return window.ui.toast("Este tipo de archivo no se admite aquí", { tone: "warning" });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (e.dataTransfer!.files.length > 1) window.ui.toast("Se tomó solo el primer archivo", { tone: "info" });
  });
}
