// Punto de entrada del runtime de UI. Se importa una vez en AppLayout.
// Registra los custom elements y expone `window.ui` para islas React y scripts sueltos.
import { DsSelect } from "./select";
import { DsMenu } from "./menu";
import { DsDate } from "./date";
import { alert, confirm, confirmTyped, openModal, closeModal } from "./dialogs";
import { toast, toastAction, flash, showFlash } from "./toast";
import { initTabs } from "./tabs";
import { initDropzones } from "./dropzone";
import { initPasswordToggles } from "./password";
import { initTooltips } from "./tooltip";
import { initTableSort } from "./table-sort";
import { initTableCards } from "./table-cards";
import { initTableHeads } from "./table-head";
import { initNumericInputs } from "./numeric";
import { busy, loading, progress, quietFetch, initProgress } from "./busy";

if (!customElements.get("ds-select")) customElements.define("ds-select", DsSelect);
if (!customElements.get("ds-menu")) customElements.define("ds-menu", DsMenu);
if (!customElements.get("ds-date")) customElements.define("ds-date", DsDate);
initDropzones();
initPasswordToggles();
initTooltips();
initTableSort();
initTableCards();
initTableHeads();
initProgress();
initTabs();
initNumericInputs();

// Abrir/cerrar modales declarativamente: <button data-modal-open="id"> / <button data-modal-close>
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const opener = target.closest<HTMLElement>("[data-modal-open]");
  if (opener) openModal(opener.dataset.modalOpen!);
  const closer = target.closest<HTMLElement>("[data-modal-close]");
  if (closer) closer.closest("dialog")?.close();
});

// Audios grabados (webm) no traen duración: saltar al final la obliga a calcularse
document.addEventListener(
  "loadedmetadata",
  (e) => {
    const a = e.target;
    if (!(a instanceof HTMLAudioElement) || Number.isFinite(a.duration)) return;
    a.addEventListener("durationchange", () => (a.currentTime = 0), { once: true });
    a.currentTime = 1e7;
  },
  true,
);

export const ui = { alert, confirm, confirmTyped, toast, toastAction, flash, openModal, closeModal, busy, loading, progress, quietFetch };

declare global {
  interface Window {
    ui: typeof ui;
  }
}

window.ui = ui;
showFlash();
