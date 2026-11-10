// Mostrar/ocultar contraseña en todo <div class="input-password"> (components/ui/PasswordInput.astro).
export function initPasswordToggles() {
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-password-toggle]");
    if (!btn) return;
    const input = btn.parentElement!.querySelector<HTMLInputElement>("input")!;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    btn.querySelector("i")!.className = `bi ${show ? "bi-eye-slash" : "bi-eye"}`;
  });
}
