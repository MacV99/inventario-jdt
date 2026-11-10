// @ts-check
import { defineConfig } from "astro/config";

// Página estática: Vercel la publica gratis. Los datos se leen desde el navegador (Supabase, funciones public.inv_*).
export default defineConfig({
  output: "static",
  server: { port: 4322 },
  // Navegadores de los últimos años: permite cargar los datos antes de pintar (await al importar)
  vite: { build: { target: "es2022" } },
});
