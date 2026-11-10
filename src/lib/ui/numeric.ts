// Campos de números (2026-10-20, pedido del usuario): sin flechitas (CSS en global.css) y solo dejan escribir números.
//   <input type="number">                         → bloquea e, +, - (y punto o coma si el paso es entero)
//   <input type="text" inputmode="numeric">       → borra todo lo que no sea dígito
export function initNumericInputs() {
  document.addEventListener(
    "input",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type !== "text" || el.inputMode !== "numeric") return;
      const clean = el.value.replace(/\D/g, "");
      if (clean !== el.value) el.value = clean;
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== "number" || e.ctrlKey || e.metaKey) return;
    const decimals = !!el.step && el.step !== "any" && !Number.isInteger(Number(el.step));
    if (["e", "E", "+", "-"].includes(e.key) || (!decimals && [".", ","].includes(e.key))) e.preventDefault();
  });
}
