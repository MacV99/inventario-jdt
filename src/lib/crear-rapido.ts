// Crear sin salir del formulario: en un selector creable, «＋ Crear …» da de alta lo escrito y lo deja elegido.
//   · País y bodega piden más datos: abren una ventanita (poner <CrearRapido /> en la página).
//   · Producto y método de pago se crean directo con lo escrito (producto: código siguiente y unidad «und»).
// El selector necesita `creatable` (y `searchable`) en su etiqueta; aquí solo se maneja lo que pasa al crear.
// `refrescar` vuelve a llenar las opciones del selector en la página (para que aparezca lo nuevo).

import { guardarPais, guardarBodega, guardarProducto, guardarMetodoPago, siguienteCodigo, paises, todasBodegas, paisActual, llave, MONEDA } from "./store";
import { dsSelect, intentar, parseNum, uniqueOptions, sinNuevo, type DsSelectEl } from "./view";

type Cambio = CustomEvent<{ value: string; label: string; created: boolean } | undefined>;

/** Deja elegido lo recién creado y avisa a la página como si lo hubieran elegido. */
function elegir(sel: DsSelectEl, value: string, label: string) {
  sel.value = value;
  sel.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value, label, created: false } }));
}

/** Cuando en `sel` eligen «Crear …»: crea con `crear(texto)` (devuelve el valor nuevo o null) y lo deja elegido. */
function alCrear(sel: DsSelectEl, crear: (texto: string) => Promise<string | null>, refrescar: () => void) {
  sel.addEventListener("change", async (e) => {
    const d = (e as Cambio).detail;
    if (!d?.created) return;
    const nuevo = await crear(d.label);
    refrescar();
    if (nuevo) elegir(sel, nuevo, d.label);
    else sel.value = "";
  });
}

/** Abre una ventana de crear y espera: el valor creado, o null si la cierran sin crear. */
function ventana(id: string, preparar: (form: HTMLFormElement) => void, crear: (form: HTMLFormElement) => Promise<string>) {
  const dlg = document.getElementById(id) as HTMLDialogElement | null;
  if (!dlg) return Promise.resolve(null);
  const form = dlg.querySelector<HTMLFormElement>("[data-form]")!;
  const save = dlg.querySelector<HTMLElement>("[data-save]")!;
  return new Promise<string | null>((resolve) => {
    let hecho: string | null = null;
    const onSave = async () => {
      if (await intentar(form, async () => void (hecho = await crear(form)))) dlg.close();
    };
    const onClose = () => {
      save.removeEventListener("click", onSave);
      dlg.removeEventListener("close", onClose);
      resolve(hecho);
    };
    save.addEventListener("click", onSave);
    dlg.addEventListener("close", onClose);
    intentar(form, () => {});
    preparar(form);
    // Después de la tecla que eligió «Crear» (si no, ese Enter cae en un botón de la ventana y la cierra)
    setTimeout(() => {
      dlg.showModal();
      form.querySelector<HTMLInputElement>("input.input")?.focus();
    });
  });
}

const opcionesPais = () => paises().map((x) => ({ value: x.nombre, label: x.nombre, hint: x.moneda }));

// ── País ─────────────────────────────────────────────────────────────
let paisListo = false;
function nuevoPais(nombre: string) {
  return ventana(
    "rapido-pais",
    (form) => {
      const moneda = dsSelect(form, "ds-select[name=moneda]");
      const sync = () => {
        form.querySelector<HTMLElement>("[data-tasa]")!.hidden = !moneda.value || moneda.value === MONEDA;
        form.querySelector("[data-tasa-label]")!.textContent = `¿Cuántos pesos vale 1 ${moneda.value}?`;
      };
      if (!paisListo) moneda.addEventListener("change", sync);
      paisListo = true;
      form.querySelector<HTMLInputElement>("[name=nombre]")!.value = nombre;
      form.querySelector<HTMLInputElement>("[name=tasa]")!.value = "";
      moneda.value = "";
      sync();
    },
    (form) =>
      guardarPais({
        nombre: form.querySelector<HTMLInputElement>("[name=nombre]")!.value,
        moneda: dsSelect(form, "ds-select[name=moneda]").value,
        tasa: parseNum(form.querySelector<HTMLInputElement>("[name=tasa]")!.value),
      }),
  );
}

/** Selector de país: «Crear país» abre la ventanita (moneda y tasa). */
export const conCrearPais = (sel: DsSelectEl, refrescar: () => void) => alCrear(sel, nuevoPais, refrescar);

// ── Bodega ───────────────────────────────────────────────────────────
let bodegaLista = false;
function nuevaBodega(texto: string, pais = "") {
  return ventana(
    "rapido-bodega",
    (form) => {
      const p = dsSelect(form, "ds-select[name=pais]");
      const ciudad = dsSelect(form, "ds-select[name=ciudad]");
      const nombre = form.querySelector<HTMLInputElement>("[name=nombre]")!;
      const ciudades = () => ciudad.setOptions(uniqueOptions(todasBodegas().filter((b) => !p.value || b.pais === p.value).map((b) => b.ciudad)));
      if (!bodegaLista) {
        p.addEventListener("change", ciudades);
        conCrearPais(p, () => p.setOptions(opcionesPais()));
        ciudad.addEventListener("change", () => ciudad.value && (nombre.value = `Bodega ${sinNuevo(ciudad.value)}`));
      }
      bodegaLista = true;
      // Lo escrito puede ser el nombre («Bodega Cali») o la ciudad («Cali»)
      const t = texto.trim();
      const enCiudad = t.replace(/^bodega\s+/i, "");
      p.setOptions(opcionesPais());
      p.value = pais;
      ciudades();
      ciudad.value = todasBodegas().find((b) => llave(b.ciudad) === llave(enCiudad))?.ciudad ?? "";
      nombre.value = /^bodega\b/i.test(t) ? t : `Bodega ${t}`;
    },
    (form) =>
      guardarBodega({
        nuevo: true,
        nombre: form.querySelector<HTMLInputElement>("[name=nombre]")!.value.trim(),
        ciudad: sinNuevo(dsSelect(form, "ds-select[name=ciudad]").value),
        pais: dsSelect(form, "ds-select[name=pais]").value,
      }),
  );
}

/** Selector de bodega: «Crear bodega» abre la ventanita (país y ciudad). `pais`: el que se propone. */
export const conCrearBodega = (sel: DsSelectEl, refrescar: () => void, pais = () => paisActual()) =>
  alCrear(sel, (t) => nuevaBodega(t, pais()), refrescar);

// ── Producto y método de pago (directo) ──────────────────────────────
/** Selector de producto: crea el producto con lo escrito (código siguiente, unidad «und»). Se completa en Productos. */
export const conCrearProducto = (sel: DsSelectEl, refrescar: () => void) =>
  alCrear(
    sel,
    async (nombre) => {
      const codigo = siguienteCodigo();
      let id = "";
      const ok = await intentar(null, async () => void (id = await guardarProducto({ nombre, codigo, unidad: "und", stock_minimo: 0, nuevo: true })), `Producto creado: ${codigo}`);
      return ok ? id : null;
    },
    refrescar,
  );

/** Selector de cómo pagó: crea el método para el país de `pais()`. */
export const conCrearMetodo = (sel: DsSelectEl, pais: () => string | null | undefined, refrescar: () => void) =>
  alCrear(
    sel,
    async (nombre) => {
      let id = 0;
      const ok = await intentar(null, async () => void (id = await guardarMetodoPago({ nombre, pais: pais() ?? "" })), `Método de pago creado: ${nombre}`);
      return ok ? String(id) : null;
    },
    refrescar,
  );
