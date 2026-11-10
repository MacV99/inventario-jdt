"""Letra e íconos propios, recortados a lo que se usa (rendimiento: sin pedir nada a Google ni a jsdelivr).

Crea:
  public/fonts/montserrat.woff2  → Montserrat (pesos 400–800) solo con letras del español y signos comunes
  public/fonts/bi.woff2          → Bootstrap Icons solo con los íconos que aparecen en src/
  src/styles/icons.css           → @font-face de ambas + clases .bi-* usadas

Correr de nuevo al usar un ícono nuevo:  npm run fuentes
Necesita: pip install fonttools brotli  ·  npm i (bootstrap-icons y @fontsource-variable/montserrat)
"""

import json
import sys
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "public" / "fonts"
NM = ROOT / "node_modules"
OUT.mkdir(parents=True, exist_ok=True)


def recortar(origen: Path, destino: Path, unicodes: list[int], pesos: tuple[int, int] | None = None):
    font = TTFont(origen)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "calt", "tnum", "lnum"]
    opts.name_IDs = []
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(unicodes=unicodes)
    s.subset(font)
    # Variable: solo el rango de pesos que usa el panel (después de recortar letras)
    if pesos:
        font = instancer.instantiateVariableFont(font, {"wght": pesos})
    font.flavor = "woff2"
    font.save(destino)
    return destino.stat().st_size


# ── Íconos: solo los bi-* escritos en el código ──
usados = set()
for f in SRC.rglob("*"):
    if f.suffix in {".astro", ".ts"}:
        usados |= set(re.findall(r"\bbi-[a-z0-9]+(?:-[a-z0-9]+)*", f.read_text(encoding="utf-8")))
mapa = json.loads((NM / "bootstrap-icons/font/bootstrap-icons.json").read_text(encoding="utf-8"))
iconos = sorted(n for n in usados if n[3:] in mapa)
faltan = sorted(n for n in usados if n[3:] not in mapa)
if faltan:
    print("Ojo, no existen en Bootstrap Icons:", ", ".join(faltan))
peso_bi = recortar(NM / "bootstrap-icons/font/fonts/bootstrap-icons.woff2", OUT / "bi.woff2", [mapa[n[3:]] for n in iconos])

# ── Montserrat: latín básico + acentos/ñ + signos que se usan (– — · « » … ’ “ ” • € ₱) ──
letras = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2212, 0x20AC]
peso_m = recortar(NM / "@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2", OUT / "montserrat.woff2", letras, (400, 800))

css = [
    "/* Generado por scripts/fuentes.py (npm run fuentes). No editar a mano. */",
    "",
    "@font-face {",
    '  font-family: "Montserrat";',
    "  font-style: normal;",
    "  font-weight: 400 800;",
    "  font-display: swap;",
    '  src: url("/fonts/montserrat.woff2") format("woff2");',
    "}",
    "",
    "@font-face {",
    '  font-family: "bootstrap-icons";',
    "  font-display: block;",
    '  src: url("/fonts/bi.woff2") format("woff2");',
    "}",
    "",
    ".bi::before,",
    '[class^="bi-"]::before,',
    '[class*=" bi-"]::before {',
    "  display: inline-block;",
    "  font-family: bootstrap-icons !important;",
    "  font-style: normal;",
    "  font-weight: normal !important;",
    "  font-variant: normal;",
    "  text-transform: none;",
    "  line-height: 1;",
    "  vertical-align: -0.125em;",
    "  -webkit-font-smoothing: antialiased;",
    "  -moz-osx-font-smoothing: grayscale;",
    "}",
    "",
]
css += [f'.{n}::before {{ content: "\\{mapa[n[3:]]:x}"; }}' for n in iconos]
(SRC / "styles" / "icons.css").write_text("\n".join(css) + "\n", encoding="utf-8")

print(f"{len(iconos)} íconos → bi.woff2 {peso_bi / 1024:.1f} KB · montserrat.woff2 {peso_m / 1024:.1f} KB")
