// Datos del inventario. Dos modos:
//   · Real: Supabase (funciones public.inv_* de supabase/inventario.sql). Lo que llega ya viene filtrado por rol.
//   · Ejemplo: solo en la prueba local sin sesión (npm run dev). Datos de ejemplo guardados en este navegador, con las
//     mismas reglas de la base. Sirve para revisar pantallas como admin o monitor sin contraseñas («Ver como»).
//
// Las pantallas leen todo de forma inmediata (sin esperar): este módulo carga los datos ANTES de que corran
// (await al importarlo). Abrir una pantalla pinta al instante con lo último guardado en el navegador y revisa la base
// por detrás; si algo cambió, se repinta. Cada cambio devuelve los datos nuevos en la misma respuesta.

import { conBase, haySesion, sesionId, rpc, aEntrar, irA } from "./api";

export type Rol = "superadmin" | "admin" | "monitor";
export type TipoMov = "compra" | "traslado" | "entrega" | "devolucion" | "venta" | "ajuste_entrada" | "ajuste_salida";
export type TipoBodega = "bodega" | "monitor";

/** propio = se creó en el inventario (su contraseña se cambia aquí; la de alguien del call center se cambia allá). */
export interface Perfil { id: string; nombre: string; usuario: string; rol: Rol; activo: boolean; creado: string; propio: boolean }
export interface Bodega { id: string; nombre: string; ciudad: string; pais: string; tipo: TipoBodega; monitor_id?: string | null; activa: boolean }
/** precios: país → precio de venta en la moneda de ese país (sin precio = no está). */
export interface Producto { id: string; codigo: string; nombre: string; unidad: string; precios: Record<string, number>; stock_minimo: number; activo: boolean }
/** Cada país vende en su moneda. tasa = cuántos pesos vale 1 unidad (para sumar todo en pesos). */
export interface Pais { nombre: string; moneda: string; tasa: number }
export interface Proveedor { id: string; nombre: string; contacto: string }
export interface MetodoPago { id: number; nombre: string; activo: boolean }
export interface Item { producto_id: string; cantidad: number; valor_unitario: number; costo_unitario: number }
export interface Movimiento {
  id: number;
  tipo: TipoMov;
  fecha: string;
  origen_id?: string | null;
  destino_id?: string | null;
  proveedor_id?: string | null;
  metodo_pago_id?: number | null;
  curso?: string | null;
  moneda: string;
  tasa: number;
  nota?: string | null;
  anulado: boolean;
  creado_por: string;
  items: Item[];
}
/** Dinero que un monitor entrega de sus ventas. */
export interface Pago { id: number; bodega_id: string; fecha: string; valor: number; moneda: string; metodo_pago_id?: number | null; nota?: string | null; creado_por: string }
export interface Yo { id: string; nombre: string; usuario: string; rol: Rol }

interface State {
  version: number;
  yo: Yo;
  paises: Pais[];
  perfiles: Perfil[];
  bodegas: Bodega[];
  productos: Producto[];
  proveedores: Proveedor[];
  metodos_pago: MetodoPago[];
  movimientos: Movimiento[];
  pagos: Pago[];
  /** Solo en modo real: stock y costo promedio ya calculados por la base. */
  stock?: [string, string, number][];
  costos?: Record<string, number>;
}

export const MONEDA = "COP";
/** Monedas para elegir en Países y en las compras. */
export const MONEDAS = [
  ["COP", "Peso colombiano"],
  ["USD", "Dólar"],
  ["EUR", "Euro"],
  ["PEN", "Sol peruano"],
  ["MXN", "Peso mexicano"],
  ["CLP", "Peso chileno"],
  ["ARS", "Peso argentino"],
  ["BRL", "Real brasileño"],
  ["BOB", "Boliviano"],
  ["CRC", "Colón costarricense"],
  ["DOP", "Peso dominicano"],
  ["GTQ", "Quetzal"],
  ["HNL", "Lempira"],
  ["NIO", "Córdoba"],
  ["PAB", "Balboa"],
  ["PYG", "Guaraní"],
  ["UYU", "Peso uruguayo"],
  ["VES", "Bolívar"],
].map(([value, nombre]) => ({ value: value!, label: `${value} · ${nombre}` }));

export const TIPO_MOV: Record<TipoMov, { label: string; icon: string; desde: string; hacia: string }> = {
  compra: { label: "Compra", icon: "bi-bag-plus", desde: "Proveedor", hacia: "Bodega" },
  traslado: { label: "Traslado", icon: "bi-arrow-left-right", desde: "Bodega", hacia: "Otra bodega" },
  entrega: { label: "Entrega", icon: "bi-box-arrow-right", desde: "Bodega", hacia: "Maleta" },
  devolucion: { label: "Devolución", icon: "bi-box-arrow-in-left", desde: "Maleta", hacia: "Bodega" },
  venta: { label: "Venta", icon: "bi-cash-coin", desde: "Maleta u oficina", hacia: "Cliente" },
  ajuste_entrada: { label: "Ajuste de entrada", icon: "bi-plus-circle", desde: "Sobrante", hacia: "Bodega o maleta" },
  ajuste_salida: { label: "Ajuste de salida", icon: "bi-dash-circle", desde: "Bodega o maleta", hacia: "Daño o pérdida" },
};

/** Qué lugares acepta cada tipo (null = no lleva). */
export const REGLAS: Record<TipoMov, { origen: TipoBodega[] | null; destino: TipoBodega[] | null }> = {
  compra: { origen: null, destino: ["bodega"] },
  traslado: { origen: ["bodega"], destino: ["bodega"] },
  entrega: { origen: ["bodega"], destino: ["monitor"] },
  devolucion: { origen: ["monitor"], destino: ["bodega"] },
  venta: { origen: ["bodega", "monitor"], destino: null },
  ajuste_entrada: { origen: null, destino: ["bodega", "monitor"] },
  ajuste_salida: { origen: ["bodega", "monitor"], destino: null },
};

export const ROL: Record<Rol, { label: string }> = {
  superadmin: { label: "Superadmin" },
  admin: { label: "Admin" },
  monitor: { label: "Monitor" },
};

const KEY_DEMO = "jdt-inventario-demo";
const KEY_CACHE = "jdt-inv-datos";
const KEY_VER = "jdt-inv-ver-como";
const VERSION = 4;
const hoy = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-DD en la hora local

/** Prueba local sin sesión: datos de ejemplo (también en una copia armada con PUBLIC_DEMO=1). En la página publicada nunca. */
export const DEMO = (import.meta.env.DEV || import.meta.env.PUBLIC_DEMO === "1") && typeof document !== "undefined" && !(conBase && haySesion());

// ── Cargar ───────────────────────────────────────────────────────────
let cache: State;

// Cálculos derivados (stock, costos, filas): se hacen una vez por cambio y se reutilizan en toda la página.
let memo: { stock?: Map<string, number>; costos?: Map<string, number>; filas?: ReturnType<typeof calcFilas> } = {};
const cambio = () => (memo = {});

const leerJson = <T>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null");
  } catch {
    return null;
  }
};
const guardarJson = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

/** Datos nuevos de la base: se guardan para abrir la próxima pantalla al instante. */
function usar(datos: Omit<State, "version">) {
  cache = { version: VERSION, ...datos };
  cambio();
  guardarJson(KEY_CACHE, cache);
}

async function iniciar() {
  const pagina = document.body.dataset.rol as "admin" | "monitor" | undefined;

  if (DEMO) {
    const saved = leerJson<State>(KEY_DEMO);
    cache = saved?.version === VERSION ? saved : seed();
    const ver = (localStorage.getItem(KEY_VER) as "admin" | "monitor" | null) ?? pagina ?? "admin";
    const p = cache.perfiles.find((x) => (ver === "monitor" ? x.id === "u3" : x.id === "u1"))!;
    cache.yo = { id: p.id, nombre: p.nombre, usuario: p.usuario, rol: p.rol };
  } else {
    if (!haySesion()) return aEntrar();
    const guardado = leerJson<State>(KEY_CACHE);
    const fresco = rpc<Omit<State, "version">>("inv_datos").catch((e: Error) => e);
    if (guardado?.version === VERSION && guardado.yo?.id === sesionId()) {
      cache = guardado;
      // Revisa por detrás: si alguien más cambió algo, se repinta con lo nuevo
      fresco.then((d) => {
        if (d instanceof Error) return;
        if (JSON.stringify({ version: VERSION, ...d }) === JSON.stringify(guardado)) return;
        usar(d);
        irA();
      });
    } else {
      const d = await fresco;
      if (d instanceof Error) {
        // Sin acceso al inventario (o desactivado): fuera
        if (/acceso/.test(d.message)) {
          sessionStorage.setItem("jdt-inv-motivo", d.message);
          return aEntrar();
        }
        throw d;
      }
      usar(d);
    }
  }

  // Cada quien en sus pantallas
  const esAdmin = cache.yo.rol !== "monitor";
  if (pagina === "admin" && !esAdmin) irA("/mi-maleta");
  if (pagina === "monitor" && esAdmin && !DEMO) irA("/");
}

// Solo en el navegador (al armar la página en el servidor no hay datos que cargar)
if (typeof document !== "undefined" && document.body?.dataset.rol) await iniciar();

/** Borra los datos guardados en este navegador (al cerrar sesión). */
export const olvidar = () => {
  try {
    localStorage.removeItem(KEY_CACHE);
  } catch {}
};

/** Prueba local: cambiar entre admin y monitor. */
export function verComo(rol: "admin" | "monitor") {
  try {
    localStorage.setItem(KEY_VER, rol);
  } catch {}
}

const load = () => cache;

function saveDemo() {
  cambio();
  guardarJson(KEY_DEMO, cache);
}

/** Vuelve a los datos de ejemplo del principio (solo prueba local). */
export function reiniciar() {
  const yo = cache.yo;
  cache = seed();
  cache.yo = yo;
  saveDemo();
}

// ── País elegido ─────────────────────────────────────────────────────
// El admin trabaja un país a la vez (se elige arriba en el menú y se recuerda en este navegador).
// Con un país elegido, bodegas, maletas, movimientos, pagos y stock muestran solo los de ese país.
// Vacío = global (todos los países). Los monitores no eligen: ya ven solo lo suyo.
const KEY_PAIS = "jdt-inv-pais";
let paisElegido: string | undefined;
export const paisActual = () => {
  if (paisElegido !== undefined) return paisElegido;
  let p = "";
  try {
    p = localStorage.getItem(KEY_PAIS) ?? "";
  } catch {}
  paisElegido = load().yo.rol !== "monitor" && load().paises.some((x) => x.nombre === p) ? p : "";
  return paisElegido;
};
export function elegirPais(p: string) {
  try {
    localStorage.setItem(KEY_PAIS, p);
  } catch {}
  paisElegido = undefined;
  cambio();
}
/** ¿El lugar es del país elegido? (global = todos) */
const delPais = (id?: string | null) => !!id && (!paisActual() || load().bodegas.find((b) => b.id === id)?.pais === paisActual());

// ── Lecturas ─────────────────────────────────────────────────────────
export const yo = () => load().yo;
export const esAdmin = () => load().yo.rol !== "monitor";
export const perfiles = () => load().perfiles;
/** Bodegas y maletas del país elegido. */
export const bodegas = () => (paisActual() ? load().bodegas.filter((b) => b.pais === paisActual()) : load().bodegas);
/** Todas, sin importar el país elegido. */
export const todasBodegas = () => load().bodegas;
export const productos = () => load().productos;
export const proveedores = () => load().proveedores;
export const metodosPago = () => load().metodos_pago;
export const paises = () => load().paises;
export const pais = (nombre?: string | null) => load().paises.find((p) => p.nombre === nombre);
/** Moneda y tasa de un lugar (las de su país). Sin país conocido: pesos. */
export const monedaDe = (b?: { pais: string } | null) => {
  const p = pais(b?.pais);
  return { moneda: p?.moneda ?? MONEDA, tasa: p?.tasa ?? 1 };
};
/** Precio de venta de un producto en un país (0 = sin precio ahí). */
export const precioEn = (productoId: string, paisNombre?: string | null) => (paisNombre && producto(productoId)?.precios[paisNombre]) || 0;
/** Del más nuevo al más viejo (se agregan en orden, así que basta invertir). */
export const movimientos = () => load().movimientos.filter((m) => !paisActual() || delPais(m.origen_id) || delPais(m.destino_id)).reverse();
export const pagos = () => load().pagos.filter((p) => delPais(p.bodega_id)).sort((a, b) => b.id - a.id);
export const bodega = (id?: string | null) => load().bodegas.find((b) => b.id === id);
export const producto = (id: string) => load().productos.find((p) => p.id === id);
export const proveedor = (id?: string | null) => load().proveedores.find((p) => p.id === id);
export const metodoPago = (id?: number | null) => load().metodos_pago.find((m) => m.id === id);
export const maletaDe = (perfilId: string) => load().bodegas.find((b) => b.monitor_id === perfilId);
/** Venta hecha en la oficina (sale de una bodega, no de una maleta). */
export const esVentaOficina = (m: Movimiento) => m.tipo === "venta" && bodega(m.origen_id)?.tipo === "bodega";

/** Stock actual: "bodega|producto" → cantidad. */
export function stock(state = load()) {
  if (state === cache && memo.stock) return memo.stock;
  const m = new Map<string, number>();
  if (state.stock) {
    for (const [b, p, n] of state.stock) m.set(`${b}|${p}`, Number(n));
  } else {
    const add = (b: string | null | undefined, p: string, n: number) => {
      if (!b) return;
      const k = `${b}|${p}`;
      m.set(k, (m.get(k) ?? 0) + n);
    };
    for (const mov of state.movimientos) {
      if (mov.anulado) continue;
      for (const i of mov.items) {
        add(mov.origen_id, i.producto_id, -i.cantidad);
        add(mov.destino_id, i.producto_id, i.cantidad);
      }
    }
  }
  if (state === cache) memo.stock = m;
  return m;
}

/** Filas de stock con cantidad > 0. */
export const stockFilas = () => (memo.filas ??= calcFilas().filter((f) => delPais(f.bodega_id)));

function calcFilas() {
  const costos = costoPromedio();
  return [...stock()]
    .filter(([, n]) => n > 0)
    .map(([k, cantidad]) => {
      const [bodega_id, producto_id] = k.split("|") as [string, string];
      const costo = costos.get(producto_id) ?? 0;
      return { bodega_id, producto_id, cantidad, costo, valor: cantidad * costo };
    });
}

export const cantidadEn = (bodegaId: string, productoId: string) => stock().get(`${bodegaId}|${productoId}`) ?? 0;

/** Costo promedio por producto (pesos): se mezcla con cada compra; las salidas no lo cambian. */
export function costoPromedio(state = load()) {
  if (state === cache && memo.costos) return memo.costos;
  let c = new Map<string, number>();
  if (state.costos) c = new Map(Object.entries(state.costos).map(([k, v]) => [k, Number(v)]));
  else {
    const q = new Map<string, number>();
    for (const mov of state.movimientos) {
      if (mov.anulado) continue;
      for (const i of mov.items) {
        const qty = q.get(i.producto_id) ?? 0;
        const avg = c.get(i.producto_id) ?? 0;
        if (mov.tipo === "compra") {
          const unit = i.valor_unitario * mov.tasa;
          c.set(i.producto_id, qty + i.cantidad > 0 ? (qty * avg + i.cantidad * unit) / (qty + i.cantidad) : unit);
          q.set(i.producto_id, qty + i.cantidad);
        } else if (mov.tipo === "ajuste_entrada") q.set(i.producto_id, qty + i.cantidad);
        else if (mov.tipo === "venta" || mov.tipo === "ajuste_salida") q.set(i.producto_id, qty - i.cantidad);
      }
    }
  }
  if (state === cache) memo.costos = c;
  return c;
}

/**
 * Historial de un producto (kárdex): cada movimiento vigente con lo que entra, sale y el saldo después.
 * Con `bodegaId` mira solo ese lugar; sin él, el total de la empresa (traslados internos no cambian el saldo).
 * También el costo promedio después de cada movimiento.
 */
export function kardex(productoId: string, bodegaId = "") {
  let saldo = 0;
  let total = 0;
  let avg = 0;
  const filas: { mov: Movimiento; entra: number; sale: number; mueve: number; saldo: number; costo: number }[] = [];
  for (const mov of load().movimientos) {
    if (mov.anulado) continue;
    const it = mov.items.filter((i) => i.producto_id === productoId);
    const q = it.reduce((a, i) => a + i.cantidad, 0);
    if (!q) continue;
    if (mov.tipo === "compra") {
      const valor = it.reduce((a, i) => a + i.cantidad * i.valor_unitario * mov.tasa, 0);
      avg = total + q > 0 ? (total * avg + valor) / (total + q) : avg;
    }
    const entraEmpresa = mov.tipo === "compra" || mov.tipo === "ajuste_entrada";
    const saleEmpresa = mov.tipo === "venta" || mov.tipo === "ajuste_salida";
    total += entraEmpresa ? q : saleEmpresa ? -q : 0;
    let entra = 0;
    let sale = 0;
    let mueve = 0;
    if (bodegaId) {
      if (mov.destino_id === bodegaId) entra = q;
      if (mov.origen_id === bodegaId) sale = q;
      if (!entra && !sale) continue;
      saldo += entra - sale;
    } else {
      entra = entraEmpresa ? q : 0;
      sale = saleEmpresa ? q : 0;
      mueve = entra || sale ? 0 : q;
      saldo = total;
    }
    filas.push({ mov, entra, sale, mueve, saldo, costo: avg });
  }
  return filas.reverse();
}

/** De dónde sale y a dónde va un movimiento, en palabras. */
export function rutaMov(m: Movimiento) {
  const de = m.tipo === "compra" ? proveedor(m.proveedor_id)?.nombre ?? "Proveedor" : m.origen_id ? bodega(m.origen_id)?.nombre ?? "—" : "Ajuste";
  const a = m.tipo === "venta" ? "Cliente" : m.destino_id ? bodega(m.destino_id)?.nombre ?? "—" : "Salida";
  return { de, a };
}

/** Valor del movimiento: compras y ventas a lo pagado/cobrado; lo demás al costo. */
export const totalMov = (m: Movimiento) =>
  m.items.reduce((a, i) => a + i.cantidad * (m.tipo === "venta" || m.tipo === "compra" ? i.valor_unitario * m.tasa : i.costo_unitario), 0);
export const unidadesMov = (m: Movimiento) => m.items.reduce((a, i) => a + i.cantidad, 0);
/** Valor cobrado o pagado en la moneda del movimiento (ventas y compras). */
export const totalLocal = (m: Movimiento) => m.items.reduce((a, i) => a + i.cantidad * i.valor_unitario, 0);
export const gananciaMov = (m: Movimiento) => m.items.reduce((a, i) => a + i.cantidad * (i.valor_unitario * m.tasa - i.costo_unitario), 0);
export const ventas = () => movimientos().filter((m) => m.tipo === "venta" && !m.anulado);

/** Pesos que vale 1 unidad de una moneda (la tasa del primer país que la usa). */
export const tasaDe = (moneda: string) => (moneda === MONEDA ? 1 : load().paises.find((x) => x.moneda === moneda)?.tasa ?? 0);

/**
 * Cuadre por monitor: lo que tiene, lo vendido y el dinero por entregar, en la moneda de su país
 * (vendido, entregado, debe). Para sumar monitores de varios países: vendidoBase y debeBase en pesos.
 */
export function cuadre() {
  const filas = stockFilas();
  const vs = ventas();
  return bodegas()
    .filter((b) => b.tipo === "monitor")
    .map((b) => {
      const { moneda, tasa } = monedaDe(b);
      const s = filas.filter((f) => f.bodega_id === b.id);
      const mias = vs.filter((v) => v.origen_id === b.id);
      // Si algo quedó en otra moneda (le cambiaron el país), se pasa a la de ahora
      const vendido = mias.reduce((a, v) => a + (v.moneda === moneda ? totalLocal(v) : totalMov(v) / tasa), 0);
      const entregado = load()
        .pagos.filter((p) => p.bodega_id === b.id)
        .reduce((a, p) => a + (p.moneda === moneda ? p.valor : (p.valor * (tasaDe(p.moneda) || 1)) / tasa), 0);
      const debe = vendido - entregado;
      return {
        bodega: b,
        moneda,
        unidades: s.reduce((a, x) => a + x.cantidad, 0),
        valor: s.reduce((a, x) => a + x.valor, 0),
        vendidas: mias.reduce((a, v) => a + unidadesMov(v), 0),
        vendido,
        entregado,
        debe,
        vendidoBase: mias.reduce((a, v) => a + totalMov(v), 0),
        debeBase: debe * tasa,
      };
    });
}

// ── Escrituras ───────────────────────────────────────────────────────
// En modo real van a la base (que valida todo otra vez) y traen los datos nuevos. En el ejemplo, se hacen aquí.
export interface NuevoMovimiento {
  tipo: TipoMov;
  fecha?: string;
  origen_id?: string;
  destino_id?: string;
  proveedor_id?: string;
  /** Proveedor que no existe todavía: se crea en la misma operación. */
  proveedor_nuevo?: string;
  metodo_pago_id?: number;
  curso?: string;
  moneda?: string;
  tasa?: number;
  nota?: string;
  items: { producto_id: string; cantidad: number; valor_unitario?: number }[];
}

type Respuesta = { datos: Omit<State, "version">; ids?: (string | number)[]; existente?: boolean };
async function llamar(fn: string, args: Record<string, unknown>) {
  const r = await rpc<Respuesta>(fn, args);
  usar(r.datos);
  return r;
}

/** Registra uno o varios movimientos (todo o nada). Lanza Error con el motivo si algo no cuadra. */
export async function registrarMovimientos(input: NuevoMovimiento[]): Promise<Movimiento[]> {
  if (!DEMO) {
    const r = await llamar("inv_registrar", { p: input });
    return (r.ids ?? []).map((id) => load().movimientos.find((m) => m.id === Number(id))!);
  }
  const copia = structuredClone(cache);
  try {
    const hechos = input.map((m) => registrarLocal(m, cache));
    saveDemo();
    return hechos;
  } catch (e) {
    cache = copia;
    cambio();
    throw e;
  }
}
export const registrarMovimiento = async (input: NuevoMovimiento) => (await registrarMovimientos([input]))[0]!;

function registrarLocal(input: NuevoMovimiento, state: State): Movimiento {
  const r = REGLAS[input.tipo];
  const o = state.bodegas.find((b) => b.id === input.origen_id);
  const d = state.bodegas.find((b) => b.id === input.destino_id);
  if (state.yo?.rol === "monitor" && (input.tipo !== "venta" || o?.monitor_id !== state.yo.id)) throw new Error("Solo puedes registrar ventas de tu maleta.");
  if (r.origen && !o) throw new Error("Elige de dónde sale.");
  if (r.destino && !d) throw new Error("Elige a dónde entra.");
  if (r.origen && !r.origen.includes(o!.tipo)) throw new Error(`El origen debe ser ${r.origen.includes("bodega") ? "una bodega" : "una maleta"}.`);
  if (r.destino && !r.destino.includes(d!.tipo)) throw new Error(`El destino debe ser ${r.destino.includes("bodega") ? "una bodega" : "una maleta"}.`);
  if (o && d && o.id === d.id) throw new Error("El origen y el destino no pueden ser el mismo.");
  let proveedorId = input.proveedor_id;
  if (input.tipo === "compra" && !proveedorId && input.proveedor_nuevo?.trim()) {
    const nombre = input.proveedor_nuevo.trim();
    proveedorId = state.proveedores.find((p) => llave(p.nombre) === llave(nombre))?.id;
    if (!proveedorId) {
      proveedorId = nuevoId("v", state.proveedores);
      state.proveedores.push({ id: proveedorId, nombre, contacto: "" });
    }
  }
  if (input.tipo === "compra" && !proveedorId) throw new Error("Elige el proveedor.");
  if (input.tipo === "venta" && !state.metodos_pago.some((m) => m.id === input.metodo_pago_id && m.activo)) throw new Error("Elige cómo pagó el cliente.");
  // La venta va en la moneda del país de donde sale; la compra en la que se pagó; lo demás no lleva plata
  const enPais = state.paises.find((x) => x.nombre === o?.pais);
  const moneda = input.tipo === "venta" ? enPais?.moneda ?? MONEDA : input.tipo === "compra" ? input.moneda || MONEDA : MONEDA;
  const tasa = moneda === MONEDA ? 1 : input.tipo === "venta" ? enPais?.tasa ?? 0 : Number(input.tasa);
  if (!(tasa > 0)) throw new Error("Escribe la tasa de cambio.");

  const items = input.items.filter((i) => i.producto_id && i.cantidad > 0);
  if (!items.length) throw new Error("Agrega al menos un producto con cantidad.");
  if ((input.tipo === "compra" || input.tipo === "venta") && items.some((i) => !(Number(i.valor_unitario) > 0)))
    throw new Error(input.tipo === "compra" ? "Escribe el costo de cada producto." : "Escribe el precio de cada producto.");

  // No se puede sacar más de lo que hay (sumando el mismo producto repetido)
  if (o) {
    const s = stock(state);
    const pedido = new Map<string, number>();
    items.forEach((i) => pedido.set(i.producto_id, (pedido.get(i.producto_id) ?? 0) + i.cantidad));
    for (const [pid, n] of pedido) {
      const hay = s.get(`${o.id}|${pid}`) ?? 0;
      if (n > hay) throw new Error(`No hay suficiente «${state.productos.find((p) => p.id === pid)?.nombre}» en ${o.nombre}: hay ${hay}, pediste ${n}.`);
    }
  }

  const costos = costoPromedio(state);
  const mov: Movimiento = {
    id: Math.max(1000, ...state.movimientos.map((m) => m.id)) + 1,
    tipo: input.tipo,
    fecha: input.fecha || hoy(),
    origen_id: r.origen ? o!.id : undefined,
    destino_id: r.destino ? d!.id : undefined,
    proveedor_id: input.tipo === "compra" ? proveedorId : undefined,
    metodo_pago_id: input.tipo === "venta" ? input.metodo_pago_id : undefined,
    curso: input.tipo === "venta" ? input.curso?.trim() || undefined : undefined,
    moneda,
    tasa,
    nota: input.nota?.trim() || undefined,
    anulado: false,
    creado_por: state.yo?.nombre ?? "German",
    items: items.map((i) => ({
      producto_id: i.producto_id,
      cantidad: i.cantidad,
      valor_unitario: Number(i.valor_unitario) || 0,
      costo_unitario: input.tipo === "compra" ? (Number(i.valor_unitario) || 0) * tasa : Math.round(costos.get(i.producto_id) ?? 0),
    })),
  };
  state.movimientos.push(mov);
  if (state === cache) cambio();
  return mov;
}

/** Anula un movimiento: las cantidades vuelven, el registro queda. */
export async function anularMovimiento(id: number) {
  if (!DEMO) return void (await llamar("inv_anular", { p_id: id }));
  anularLocal(id, cache);
  saveDemo();
}

function anularLocal(id: number, state: State) {
  const mov = state.movimientos.find((m) => m.id === id);
  if (!mov || mov.anulado) throw new Error("Ese movimiento no existe o ya está anulado.");
  mov.anulado = true;
  if (state === cache) cambio();
  const neg = [...stock(state)].find(([, n]) => n < 0);
  if (neg) {
    mov.anulado = false;
    if (state === cache) cambio();
    const [b] = neg[0].split("|");
    throw new Error(`No se puede anular: esa mercancía ya salió de ${state.bodegas.find((x) => x.id === b)?.nombre}. Anula primero lo que se hizo después.`);
  }
}

/**
 * Conteo físico: se compara lo contado con lo que dice el sistema y las diferencias quedan como ajustes
 * (uno de entrada por lo que sobra, uno de salida por lo que falta). Devuelve los movimientos creados.
 */
export async function guardarConteo(bodegaId: string, conteo: { producto_id: string; contado: number }[], nota = "") {
  const s = stock();
  const dif = conteo.map((c) => ({ ...c, d: c.contado - (s.get(`${bodegaId}|${c.producto_id}`) ?? 0) })).filter((c) => c.d !== 0);
  if (!dif.length) throw new Error("Todo coincide: no hay nada que ajustar.");
  const texto = ["Conteo físico", nota.trim()].filter(Boolean).join(" · ");
  const movs: NuevoMovimiento[] = [];
  const sobra = dif.filter((c) => c.d > 0);
  const falta = dif.filter((c) => c.d < 0);
  if (sobra.length) movs.push({ tipo: "ajuste_entrada", destino_id: bodegaId, nota: texto, items: sobra.map((c) => ({ producto_id: c.producto_id, cantidad: c.d })) });
  if (falta.length) movs.push({ tipo: "ajuste_salida", origen_id: bodegaId, nota: texto, items: falta.map((c) => ({ producto_id: c.producto_id, cantidad: -c.d })) });
  return registrarMovimientos(movs);
}

const nuevoId = (prefijo: string, xs: { id: string }[]) => `${prefijo}${Math.max(0, ...xs.map((x) => Number(x.id.slice(prefijo.length)) || 0)) + 1}`;

type TablaGuardable = "productos" | "bodegas" | "proveedores" | "metodos_pago" | "paises" | "precios";
/** Crea o edita en la base (uno o varios). Devuelve los ids. */
const guardarBase = async (tabla: TablaGuardable, p: unknown) => (await llamar("inv_guardar", { p_tabla: tabla, p })).ids!.map(String);

/** precios: solo los países que cambian (0 = quitar el precio). */
type ProductoIn = Omit<Producto, "id" | "activo" | "precios"> & { id?: string; precios?: Record<string, number> };
function preciosLocal(old: Record<string, number>, nuevos: Record<string, number> = {}) {
  const r = { ...old };
  for (const [p, v] of Object.entries(nuevos)) {
    const real = load().paises.find((x) => llave(x.nombre) === llave(p))?.nombre;
    if (!real) throw new Error(`El país «${p}» no está en Países y monedas.`);
    if (v > 0) r[real] = v;
    else delete r[real];
  }
  return r;
}
function productoLocal(p: ProductoIn) {
  const s = load();
  if (!p.nombre.trim()) throw new Error("Escribe el nombre del producto.");
  if (!p.codigo.trim()) throw new Error("Escribe el código del producto.");
  const old = s.productos.find((x) => x.id === p.id) ?? (p.id ? undefined : s.productos.find((x) => llave(x.codigo) === llave(p.codigo)));
  if (s.productos.some((x) => llave(x.codigo) === llave(p.codigo) && x.id !== old?.id)) throw new Error(`Ya hay un producto con el código ${p.codigo.trim()}.`);
  const id = old?.id ?? nuevoId("p", s.productos);
  const precios = preciosLocal(old?.precios ?? {}, p.precios);
  if (old) Object.assign(old, { ...p, id, nombre: p.nombre.trim(), codigo: p.codigo.trim(), precios });
  else s.productos.push({ ...p, id, nombre: p.nombre.trim(), codigo: p.codigo.trim(), precios, activo: true });
  return id;
}

export async function guardarProducto(p: ProductoIn) {
  if (!DEMO) return (await guardarBase("productos", p))[0]!;
  const id = productoLocal(p);
  saveDemo();
  return id;
}

type BodegaIn = { id?: string; nombre: string; ciudad: string; pais: string };
function bodegaLocal(b: BodegaIn) {
  const s = load();
  if (!b.nombre.trim()) throw new Error("Escribe el nombre de la bodega.");
  const old = s.bodegas.find((x) => x.id === b.id) ?? (b.id ? undefined : s.bodegas.find((x) => x.tipo === "bodega" && llave(x.nombre) === llave(b.nombre)));
  if (!old && (!b.ciudad.trim() || !b.pais.trim())) throw new Error("Elige la ciudad y el país.");
  if (b.pais.trim() && !pais(b.pais.trim())) throw new Error(`El país «${b.pais.trim()}» no está en Países y monedas.`);
  const id = old?.id ?? nuevoId("b", s.bodegas.filter((x) => x.tipo === "bodega"));
  if (old) Object.assign(old, { nombre: b.nombre.trim(), ciudad: b.ciudad.trim() || old.ciudad, pais: b.pais.trim() || old.pais });
  else s.bodegas.push({ id, nombre: b.nombre.trim(), ciudad: b.ciudad.trim(), pais: b.pais.trim(), tipo: "bodega", activa: true });
  return id;
}

export async function guardarBodega(b: BodegaIn) {
  if (!DEMO) return (await guardarBase("bodegas", b))[0]!;
  const id = bodegaLocal(b);
  saveDemo();
  return id;
}

export async function guardarProveedor(p: { id?: string; nombre: string; contacto: string }) {
  if (!DEMO) {
    const [id] = await guardarBase("proveedores", p);
    return proveedor(id)!;
  }
  const s = load();
  const nombre = p.nombre.trim();
  if (!nombre) throw new Error("Escribe el nombre del proveedor.");
  if (s.proveedores.some((x) => llave(x.nombre) === llave(nombre) && x.id !== p.id)) throw new Error("Ya existe ese proveedor.");
  let old = s.proveedores.find((x) => x.id === p.id);
  if (old) Object.assign(old, { nombre, contacto: p.contacto.trim() });
  else s.proveedores.push((old = { id: nuevoId("v", s.proveedores), nombre, contacto: p.contacto.trim() }));
  saveDemo();
  return old;
}

/** Países: crear o editar (nombre, moneda y cuántos pesos vale 1 unidad). `antes` = nombre actual al editar. */
export async function guardarPais(x: { antes?: string; nombre: string; moneda: string; tasa: number }) {
  const nombre = x.nombre.trim();
  const tasa = x.moneda === MONEDA ? 1 : x.tasa;
  if (!DEMO) return (await guardarBase("paises", { id: x.antes, nombre, moneda: x.moneda, tasa }))[0]!;
  const s = load();
  if (!nombre) throw new Error("Escribe el nombre del país.");
  if (!x.moneda) throw new Error("Elige la moneda.");
  if (!(tasa > 0)) throw new Error(`Escribe cuántos pesos vale 1 ${x.moneda}.`);
  if (s.paises.some((p) => llave(p.nombre) === llave(nombre) && p.nombre !== x.antes)) throw new Error("Ya existe ese país.");
  const old = s.paises.find((p) => p.nombre === x.antes);
  if (old) {
    // El nombre nuevo pasa a sus bodegas, maletas y precios
    if (old.nombre !== nombre) {
      s.bodegas.forEach((b) => b.pais === old.nombre && (b.pais = nombre));
      s.productos.forEach((p) => {
        if (old.nombre in p.precios) {
          p.precios[nombre] = p.precios[old.nombre]!;
          delete p.precios[old.nombre];
        }
      });
    }
    Object.assign(old, { nombre, moneda: x.moneda, tasa });
  } else s.paises.push({ nombre, moneda: x.moneda, tasa });
  s.paises.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  saveDemo();
  return nombre;
}

/** Métodos de pago: crear, renombrar o activar/desactivar. */
export async function guardarMetodoPago(m: { id?: number; nombre?: string; activo?: boolean }) {
  if (!DEMO) return Number((await guardarBase("metodos_pago", m))[0]);
  const s = load();
  const nombre = m.nombre?.trim();
  if (nombre !== undefined) {
    if (!nombre) throw new Error("Escribe el nombre del método de pago.");
    if (s.metodos_pago.some((x) => llave(x.nombre) === llave(nombre) && x.id !== m.id)) throw new Error("Ya existe ese método de pago.");
  }
  let old = s.metodos_pago.find((x) => x.id === m.id);
  if (old) Object.assign(old, { nombre: nombre ?? old.nombre, activo: m.activo ?? old.activo });
  else s.metodos_pago.push((old = { id: Math.max(0, ...s.metodos_pago.map((x) => x.id)) + 1, nombre: nombre!, activo: true }));
  saveDemo();
  return old.id;
}

export async function setActivo(tipo: "producto" | "bodega", id: string, activo: boolean) {
  if (!DEMO) return void (await guardarBase(tipo === "producto" ? "productos" : "bodegas", tipo === "producto" ? { ...producto(id), activo } : { id, activa: activo }));
  const s = load();
  if (tipo === "producto") s.productos.find((x) => x.id === id)!.activo = activo;
  else {
    const b = s.bodegas.find((x) => x.id === id)!;
    if (!activo && [...stock()].some(([k, n]) => k.startsWith(`${id}|`) && n > 0)) throw new Error(`${b.nombre} todavía tiene mercancía. Trasládala antes de desactivarla.`);
    b.activa = activo;
  }
  saveDemo();
}

// ── Usuarios ─────────────────────────────────────────────────────────
export interface NuevoUsuario { usuario: string; nombre: string; password: string; rol: "admin" | "monitor"; ciudad?: string; pais?: string }

/** Crea un usuario (sin correo). Si ya existe en el call center, se le da acceso y entra con su misma contraseña. */
export async function crearUsuario(u: NuevoUsuario): Promise<{ existente: boolean }> {
  if (!DEMO) return { existente: !!(await llamar("inv_usuario_crear", { p: u })).existente };
  const s = load();
  const usuario = u.usuario.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error("Usuario: de 3 a 30 letras o números, sin espacios ni tildes.");
  if (u.nombre.trim().length < 3) throw new Error("Escribe nombre y apellido.");
  if (s.perfiles.some((p) => p.usuario === usuario)) throw new Error("Ese usuario ya está en el inventario.");
  if (u.password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
  if (yo().rol === "admin" && u.rol !== "monitor") throw new Error("Solo el superadmin crea admins.");
  if (u.rol === "monitor" && !pais(u.pais)) throw new Error("Elige el país de su maleta.");
  const p: Perfil = { id: nuevoId("u", s.perfiles), nombre: u.nombre.trim(), usuario, rol: u.rol, activo: true, creado: hoy(), propio: true };
  s.perfiles.push(p);
  if (u.rol === "monitor") s.bodegas.push({ id: nuevoId("m", s.bodegas.filter((x) => x.tipo === "monitor")), nombre: `Maleta ${p.nombre}`, ciudad: u.ciudad ?? "", pais: u.pais ?? "", tipo: "monitor", monitor_id: p.id, activa: true });
  saveDemo();
  return { existente: false };
}

/** Cambia rol, nombre, contraseña o acceso de un usuario. */
export async function cambiarUsuario(c: { id: string; rol?: "admin" | "monitor"; nombre?: string; password?: string; activo?: boolean; ciudad?: string; pais?: string }) {
  if (!DEMO) return void (await llamar("inv_usuario_cambiar", { p: c }));
  const s = load();
  const p = s.perfiles.find((x) => x.id === c.id)!;
  if (p.rol === "superadmin" || p.id === yo().id) throw new Error("Ese usuario no se cambia aquí.");
  if (yo().rol === "admin" && (p.rol !== "monitor" || (c.rol ?? "monitor") !== "monitor")) throw new Error("Solo el superadmin cambia a los admins.");
  if (c.password !== undefined) {
    if (c.password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
    if (!p.propio) throw new Error("Este usuario también entra al call center: su contraseña se cambia allá.");
  }
  if (c.rol) p.rol = c.rol;
  if (c.nombre?.trim()) p.nombre = c.nombre.trim();
  if (c.activo !== undefined) p.activo = c.activo;
  if (c.pais && !pais(c.pais)) throw new Error(`El país «${c.pais}» no está en Países y monedas.`);
  const maleta = s.bodegas.find((b) => b.monitor_id === p.id);
  if (maleta) Object.assign(maleta, { ciudad: c.ciudad || maleta.ciudad, pais: c.pais || maleta.pais });
  else if (p.rol === "monitor") {
    if (!c.pais) throw new Error("Elige el país de su maleta.");
    s.bodegas.push({ id: nuevoId("m", s.bodegas.filter((x) => x.tipo === "monitor")), nombre: `Maleta ${p.nombre}`, ciudad: c.ciudad ?? "", pais: c.pais, tipo: "monitor", monitor_id: p.id, activa: true });
  }
  saveDemo();
}

export async function registrarPago(bodegaId: string, valor: number, nota: string, metodo_pago_id?: number) {
  if (!(valor > 0)) throw new Error("Escribe el valor recibido.");
  if (!DEMO) return void (await llamar("inv_pago", { p: { bodega_id: bodegaId, valor, nota, metodo_pago_id } }));
  const s = load();
  s.pagos.push({ id: Math.max(0, ...s.pagos.map((p) => p.id)) + 1, bodega_id: bodegaId, fecha: hoy(), valor, moneda: monedaDe(bodega(bodegaId)).moneda, metodo_pago_id, nota: nota.trim() || undefined, creado_por: yo().nombre });
  saveDemo();
}

// ── Carga desde Excel ────────────────────────────────────────────────
// Cada función revisa las filas y devuelve qué pasaría con cada una. Con `guardar`, aplica todo en una sola operación.
export type Revision = { fila: number; ok: boolean; estado: string; datos: string[] };
/** Texto para comparar sin mayúsculas ni tildes ("Bogotá" = "bogota"). */
export const llave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export async function cargarProductos(filas: string[][], num: (s: string) => number, guardar = false): Promise<Revision[]> {
  const vistos = new Set<string>();
  const lote: ProductoIn[] = [];
  const revisadas = filas.map((f, i) => {
    const [codigo = "", nombre = "", minimo = "", unidad = ""] = f.map((x) => x.trim());
    const r = { fila: i + 1, datos: [codigo, nombre, minimo, unidad || "und"] };
    if (!nombre) return { ...r, ok: false, estado: "Falta el nombre" };
    if (!codigo) return { ...r, ok: false, estado: "Falta el código" };
    if (vistos.has(llave(codigo))) return { ...r, ok: false, estado: "Código repetido en la lista" };
    vistos.add(llave(codigo));
    if (minimo && !(num(minimo) >= 0)) return { ...r, ok: false, estado: "Mínimo no válido" };
    const old = load().productos.find((p) => llave(p.codigo) === llave(codigo));
    lote.push({ id: old?.id, codigo, nombre, unidad: unidad || old?.unidad || "und", stock_minimo: minimo ? num(minimo) : old?.stock_minimo ?? 0 });
    return { ...r, ok: true, estado: old ? "Actualiza" : "Nuevo" };
  });
  if (guardar && lote.length) {
    if (!DEMO) await guardarBase("productos", lote);
    else {
      lote.forEach(productoLocal);
      saveDemo();
    }
  }
  return revisadas;
}

/** Precios por país: País, Código, Precio (en la moneda del país). */
export async function cargarPrecios(filas: string[][], num: (s: string) => number, guardar = false): Promise<Revision[]> {
  const s = load();
  const vistos = new Set<string>();
  const lote: { codigo: string; pais: string; precio: number }[] = [];
  const revisadas = filas.map((f, i) => {
    const [paisTxt = "", codigo = "", precio = ""] = f.map((x) => x.trim());
    const r = { fila: i + 1, datos: [paisTxt, codigo, precio] };
    const p = s.paises.find((x) => llave(x.nombre) === llave(paisTxt));
    const prod = s.productos.find((x) => llave(x.codigo) === llave(codigo));
    if (!p) return { ...r, ok: false, estado: "Ese país no está en Países y monedas" };
    if (!prod) return { ...r, ok: false, estado: "No existe ese código" };
    const v = num(precio);
    if (!(v > 0)) return { ...r, ok: false, estado: "Precio no válido" };
    if (vistos.has(`${p.nombre}|${prod.id}`)) return { ...r, ok: false, estado: "Repetido en la lista" };
    vistos.add(`${p.nombre}|${prod.id}`);
    lote.push({ codigo: prod.codigo, pais: p.nombre, precio: v });
    return { ...r, ok: true, estado: prod.precios[p.nombre] ? `Cambia (${p.moneda})` : `Nuevo (${p.moneda})` };
  });
  if (guardar && lote.length) {
    if (!DEMO) await guardarBase("precios", lote);
    else {
      for (const x of lote) {
        const prod = s.productos.find((p) => p.codigo === x.codigo)!;
        prod.precios = preciosLocal(prod.precios, { [x.pais]: x.precio });
      }
      saveDemo();
    }
  }
  return revisadas;
}

export async function cargarBodegas(filas: string[][], guardar = false): Promise<Revision[]> {
  const vistos = new Set<string>();
  const lote: BodegaIn[] = [];
  // Ciudad y país escritos como ya existen (sin duplicar "Bogota" / "Bogotá")
  const bs = load().bodegas;
  const igual = (v: string, xs: string[]) => xs.find((x) => llave(x) === llave(v)) ?? v;
  const revisadas = filas.map((f, i) => {
    const [nombre = "", ciudad = "", pais = ""] = f.map((x) => x.trim());
    const r = { fila: i + 1, datos: [nombre, ciudad, pais] };
    if (!nombre || !ciudad || !pais) return { ...r, ok: false, estado: "Faltan datos (nombre, ciudad y país)" };
    if (vistos.has(llave(nombre))) return { ...r, ok: false, estado: "Nombre repetido en la lista" };
    vistos.add(llave(nombre));
    const old = bs.find((b) => b.tipo === "bodega" && llave(b.nombre) === llave(nombre));
    lote.push({ id: old?.id, nombre, ciudad: igual(ciudad, bs.map((b) => b.ciudad)), pais: igual(pais, bs.map((b) => b.pais)) });
    return { ...r, ok: true, estado: old ? "Actualiza" : "Nueva" };
  });
  if (guardar && lote.length) {
    if (!DEMO) await guardarBase("bodegas", lote);
    else {
      lote.forEach(bodegaLocal);
      saveDemo();
    }
  }
  return revisadas;
}

/** Saldo inicial: entra como compra al proveedor «Saldo inicial» (así fija el costo promedio). Una por bodega. */
export async function cargarSaldoInicial(filas: string[][], num: (s: string) => number, guardar = false): Promise<Revision[]> {
  const s = load();
  const revisadas = filas.map((f, i) => {
    const [bod = "", codigo = "", cantidad = "", costo = ""] = f.map((x) => x.trim());
    const r = { fila: i + 1, datos: [bod, codigo, cantidad, costo] };
    const b = s.bodegas.find((x) => x.tipo === "bodega" && llave(x.nombre) === llave(bod));
    const p = s.productos.find((x) => llave(x.codigo) === llave(codigo));
    if (!b) return { ...r, ok: false, estado: "No existe esa bodega", b, p, q: 0, c: 0 };
    if (!p) return { ...r, ok: false, estado: "No existe ese código", b, p, q: 0, c: 0 };
    const q = num(cantidad);
    const c = num(costo);
    if (!(q > 0)) return { ...r, ok: false, estado: "Cantidad no válida", b, p, q, c };
    if (!(c > 0)) return { ...r, ok: false, estado: "Falta el costo", b, p, q, c };
    return { ...r, ok: true, estado: `Entra a ${b.nombre}`, b, p, q, c };
  });
  if (guardar) {
    const prov = s.proveedores.find((p) => llave(p.nombre) === "saldo inicial");
    const porBodega = new Map<string, typeof revisadas>();
    revisadas.filter((r) => r.ok).forEach((r) => porBodega.set(r.b!.id, [...(porBodega.get(r.b!.id) ?? []), r]));
    const movs: NuevoMovimiento[] = [...porBodega].map(([bodegaId, rs]) => ({
      tipo: "compra",
      destino_id: bodegaId,
      proveedor_id: prov?.id,
      proveedor_nuevo: prov ? undefined : "Saldo inicial",
      nota: "Saldo inicial (cargado desde Excel)",
      items: rs.map((r) => ({ producto_id: r.p!.id, cantidad: r.q, valor_unitario: r.c })),
    }));
    if (movs.length) await registrarMovimientos(movs);
  }
  return revisadas.map(({ fila, ok, estado, datos }) => ({ fila, ok, estado, datos }));
}

// ── Datos de ejemplo (solo prueba local) ─────────────────────────────
// Datos de ejemplo con los países y productos reales de JDT (2026-11-11). Cantidades y costos inventados.
function seed(): State {
  // (dentro de la función: el módulo carga los datos antes de llegar al final del archivo)
  const NOMBRES = [
    "MEMORIAS R1", "MEMORIAS R2", "LIBROS", "RESINA 1KG", "RESINA 3KG", "PIGMENTOS", "MEZCLADORES", "ESPATULAS", "HARAGAN",
    "ZAPATOS", "RODILLO", "LETRAS", "PORTAVASOSX2", "PORTAVASOS CON BASE", "PISTOLA CALOR", "AGENDA", "SEMI DISEÑAR",
    "94 PIEZAS", "IMÁGENES", "TABLAS", "BOLIGRAFOS", "BANDEJA", "POURING", "RELOJ", "DOMINO", "PINZAS", "SEPARADORES",
    "SEPARADORES IND", "AJEDREZ COMPLETO", "TABLA AJEDREZ", "MOLDE PLACA", "DULCERA", "TALADRO ACCESORIOS", "ARETES",
    "MOLDE PEINE", "MOLDE MASCOTAS",
  ];
  const s: State = {
    version: VERSION,
    yo: { id: "u1", nombre: "German", usuario: "german", rol: "admin" },
    paises: [
      { nombre: "Bolivia", moneda: "BOB", tasa: 580 },
      { nombre: "Colombia", moneda: "COP", tasa: 1 },
      { nombre: "Ecuador", moneda: "USD", tasa: 4000 },
      { nombre: "Perú", moneda: "PEN", tasa: 1100 },
      { nombre: "Puerto Rico", moneda: "USD", tasa: 4000 },
      { nombre: "República Dominicana", moneda: "DOP", tasa: 65 },
      { nombre: "Salvador", moneda: "USD", tasa: 4000 },
      { nombre: "Venezuela", moneda: "USD", tasa: 4000 },
    ],
    perfiles: [
      { id: "u0", nombre: "MacV", usuario: "macv", rol: "superadmin", activo: true, creado: "2026-10-01", propio: false },
      { id: "u1", nombre: "German", usuario: "german", rol: "admin", activo: true, creado: "2026-10-01", propio: true },
      { id: "u2", nombre: "Leidy", usuario: "leidy", rol: "admin", activo: true, creado: "2026-10-01", propio: false },
      { id: "u3", nombre: "Carlos Rojas", usuario: "carlos", rol: "monitor", activo: true, creado: "2026-10-03", propio: true },
      { id: "u4", nombre: "Andrea Gómez", usuario: "andrea", rol: "monitor", activo: true, creado: "2026-10-04", propio: true },
      { id: "u5", nombre: "Luis Pérez", usuario: "luis", rol: "monitor", activo: true, creado: "2026-10-06", propio: true },
    ],
    bodegas: [
      { id: "b1", nombre: "Bodega Bogotá", ciudad: "Bogotá", pais: "Colombia", tipo: "bodega", activa: true },
      { id: "b2", nombre: "Bodega Medellín", ciudad: "Medellín", pais: "Colombia", tipo: "bodega", activa: true },
      { id: "b3", nombre: "Bodega Lima", ciudad: "Lima", pais: "Perú", tipo: "bodega", activa: true },
      { id: "b4", nombre: "Bodega Santa Cruz", ciudad: "Santa Cruz", pais: "Bolivia", tipo: "bodega", activa: true },
      { id: "b5", nombre: "Bodega Quito", ciudad: "Quito", pais: "Ecuador", tipo: "bodega", activa: true },
      { id: "b6", nombre: "Bodega San Juan", ciudad: "San Juan", pais: "Puerto Rico", tipo: "bodega", activa: true },
      { id: "b7", nombre: "Bodega Santo Domingo", ciudad: "Santo Domingo", pais: "República Dominicana", tipo: "bodega", activa: true },
      { id: "b8", nombre: "Bodega San Salvador", ciudad: "San Salvador", pais: "Salvador", tipo: "bodega", activa: true },
      { id: "b9", nombre: "Bodega Caracas", ciudad: "Caracas", pais: "Venezuela", tipo: "bodega", activa: true },
      { id: "m1", nombre: "Maleta Carlos Rojas", ciudad: "Bogotá", pais: "Colombia", tipo: "monitor", monitor_id: "u3", activa: true },
      { id: "m2", nombre: "Maleta Andrea Gómez", ciudad: "Lima", pais: "Perú", tipo: "monitor", monitor_id: "u4", activa: true },
      { id: "m3", nombre: "Maleta Luis Pérez", ciudad: "Medellín", pais: "Colombia", tipo: "monitor", monitor_id: "u5", activa: true },
    ],
    // Sin precios por ahora
    productos: NOMBRES.map((nombre, i) => ({
      id: `p${i + 1}`,
      codigo: `P${String(i + 1).padStart(2, "0")}`,
      nombre,
      unidad: "und",
      precios: {},
      stock_minimo: 10,
      activo: true,
    })),
    proveedores: [
      { id: "v1", nombre: "Proveedor principal", contacto: "310 555 1234" },
      { id: "v2", nombre: "Importadora", contacto: "320 555 8899" },
    ],
    metodos_pago: [
      { id: 1, nombre: "Efectivo", activo: true },
      { id: 2, nombre: "Nequi", activo: true },
      { id: 3, nombre: "Daviplata", activo: true },
      { id: 4, nombre: "Transferencia", activo: true },
      { id: 5, nombre: "Tarjeta débito", activo: true },
      { id: 6, nombre: "Tarjeta crédito", activo: true },
    ],
    movimientos: [],
    pagos: [],
  };
  const it = (producto_id: string, cantidad: number, valor_unitario = 0) => ({ producto_id, cantidad, valor_unitario });
  const reg = (m: NuevoMovimiento & { por?: string }) => {
    s.yo.nombre = m.por ?? "German";
    return registrarLocal(m, s);
  };
  // Una compra inicial por bodega con todos los productos (cantidades y costos inventados pero fijos)
  const cant = (b: number, p: number) => ((b * 7 + p * 13) % 40) + 5;
  const costo = (p: number) => 5000 + ((p * 3700) % 60000);
  ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9"].forEach((b, bi) =>
    reg({
      tipo: "compra",
      fecha: "2026-10-05",
      destino_id: b,
      proveedor_id: bi % 2 ? "v2" : "v1",
      nota: "Inventario inicial",
      items: NOMBRES.map((_, pi) => it(`p${pi + 1}`, cant(bi + 1, pi + 1) * (b === "b1" ? 3 : 1), costo(pi + 1))),
    }),
  );
  reg({ tipo: "traslado", fecha: "2026-10-15", origen_id: "b1", destino_id: "b2", por: "Leidy", items: [it("p3", 20), it("p4", 10), it("p6", 15)] });
  reg({ tipo: "entrega", fecha: "2026-10-22", origen_id: "b2", destino_id: "m3", por: "Leidy", items: [it("p3", 10), it("p4", 6), it("p6", 8)] });
  reg({ tipo: "venta", fecha: "2026-10-26", origen_id: "m3", metodo_pago_id: 1, curso: "Medellín · 25–26 oct", por: "Luis Pérez", items: [it("p3", 4, 60000), it("p4", 2, 90000)] });
  reg({ tipo: "ajuste_salida", fecha: "2026-11-01", origen_id: "b2", nota: "Resina dañada", items: [it("p4", 2)] });
  reg({ tipo: "entrega", fecha: "2026-11-06", origen_id: "b1", destino_id: "m1", items: [it("p1", 10), it("p3", 10), it("p5", 4)] });
  reg({ tipo: "entrega", fecha: "2026-11-06", origen_id: "b3", destino_id: "m2", por: "Leidy", items: [it("p3", 8), it("p6", 6)] });
  s.yo = { id: "u3", nombre: "Carlos Rojas", usuario: "carlos", rol: "monitor" };
  registrarLocal({ tipo: "venta", fecha: "2026-11-07", origen_id: "m1", metodo_pago_id: 2, curso: "Bogotá · 7–8 nov", items: [it("p1", 3, 50000), it("p3", 2, 60000)] }, s);
  s.yo = { id: "u4", nombre: "Andrea Gómez", usuario: "andrea", rol: "monitor" };
  registrarLocal({ tipo: "venta", fecha: "2026-11-07", origen_id: "m2", metodo_pago_id: 1, curso: "Lima · 7–8 nov", items: [it("p3", 4, 60)] }, s);
  s.yo = { id: "u1", nombre: "German", usuario: "german", rol: "admin" };
  s.pagos.push({ id: 1, bodega_id: "m3", fecha: "2026-10-27", valor: 300000, moneda: "COP", metodo_pago_id: 4, nota: "Transferencia", creado_por: "Leidy" });
  s.pagos.push({ id: 2, bodega_id: "m2", fecha: "2026-11-08", valor: 150, moneda: "PEN", metodo_pago_id: 1, creado_por: "Leidy" });
  return s;
}
