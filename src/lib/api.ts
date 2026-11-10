// Conexión con Supabase sin librerías (más liviano): entrar, salir y llamar a las funciones public.inv_*.
// La sesión se guarda en este navegador y se renueva sola antes de vencer.

const URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
const SESION = "jdt-inv-sesion";

interface Sesion {
  access_token: string;
  refresh_token: string;
  expires_at: number; // segundos
  user_id: string;
}

/** Hay base configurada (en la prueba local sin .env se usan datos de ejemplo). */
export const conBase = !!(URL && KEY);

/** Igual que el call center: el usuario «juan» se guarda como «juan@jdt.local» (nunca se le envía nada). */
export const toLogin = (user: string) => {
  const u = user.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@jdt.local`;
};

const leer = (): Sesion | null => {
  try {
    return JSON.parse(localStorage.getItem(SESION) ?? "null");
  } catch {
    return null;
  }
};
const guardar = (s: Sesion | null) => {
  try {
    if (s) localStorage.setItem(SESION, JSON.stringify(s));
    else localStorage.removeItem(SESION);
  } catch {}
};

export const haySesion = () => !!leer();
export const sesionId = () => leer()?.user_id ?? "";

async function auth(path: string, body: unknown) {
  const res = await fetch(`${URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: KEY!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error_description || data.msg || data.message || "No se pudo entrar."), { status: res.status });
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    user_id: data.user?.id ?? "",
  } as Sesion;
}

/** Entra con usuario (o correo) y contraseña. */
export async function entrar(usuario: string, password: string) {
  try {
    guardar(await auth("token?grant_type=password", { email: toLogin(usuario), password }));
  } catch (e) {
    const s = (e as { status?: number }).status;
    throw new Error(s === 400 || s === 401 ? "Usuario o contraseña incorrectos." : "No hay conexión. Intenta de nuevo.");
  }
}

/** Cierra la sesión aquí y en el servidor. */
export async function salir() {
  const s = leer();
  guardar(null);
  if (s && URL)
    await fetch(`${URL}/auth/v1/logout`, { method: "POST", headers: { apikey: KEY!, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
}

let renovando: Promise<Sesion | null> | null = null;
/** Token vigente (lo renueva si le falta menos de 1 minuto). */
async function token() {
  const s = leer();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  renovando ??= auth("token?grant_type=refresh_token", { refresh_token: s.refresh_token })
    .then((n) => (guardar(n), n))
    .catch(() => (guardar(null), null))
    .finally(() => (renovando = null));
  return (await renovando)?.access_token ?? null;
}

/** La sesión venció o la cerraron: a entrar de nuevo. Devuelve una espera que no termina (la página se va). */
export function aEntrar(): Promise<never> {
  guardar(null);
  location.replace(`/login?volver=${encodeURIComponent(location.pathname + location.search)}`);
  return new Promise<never>(() => {});
}

/** Llama a una función public.inv_* y devuelve su respuesta. Si falla, lanza Error con el motivo en palabras. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const t = await token();
  if (!t) return aEntrar();
  let res: Response;
  try {
    res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: KEY!, Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error("No hay conexión. Revisa el internet e intenta de nuevo.");
  }
  if (res.status === 401) return aEntrar();
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || "Algo falló. Intenta de nuevo.");
  return data as T;
}
