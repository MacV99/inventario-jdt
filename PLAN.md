# INVENTARIO JDT — Plan

Estado (2026-11-09): **publicado** en https://jdt-inventario.vercel.app con la base real (esquema `inventario` en el proyecto Supabase del call center). Falta cargar datos y crear usuarios.

---

## 1. Qué hace el sistema

- **Bodegas** separadas por ciudad y país. Cada una sabe qué tiene.
- **Monitores**: cada monitor tiene su "maleta". Lo que se le entrega sale de la bodega y queda en su maleta. Lo que vende sale de su maleta. Lo que sobra lo devuelve a una bodega.
- **Admins** (German y Leidy): ven y manejan todo.
- **Costos**: cada producto tiene un costo promedio que se actualiza solo con cada compra. Con eso se sabe cuánto vale el inventario y cuánto se gana en cada venta.

## 2. Quién puede hacer qué

| Acción | Admin | Monitor |
|---|---|---|
| Crear bodegas, productos, proveedores | Sí | No |
| Registrar compras | Sí | No |
| Pasar mercancía entre bodegas | Sí | No |
| Entregar mercancía a un monitor | Sí | No |
| Recibir devolución de un monitor | Sí | No |
| Registrar una venta | Sí | Sí, solo de su maleta |
| Ver costos y ganancias | Sí | No |
| Ver inventario | Todo | Solo su maleta |
| Aprobar usuarios nuevos y darles rol | Sí | No |

Usuario nuevo entra como "pendiente" hasta que un admin lo aprueba. El primero que se registre queda como admin.

## 3. Tipos de movimiento

| Movimiento | De dónde | A dónde |
|---|---|---|
| Compra | Proveedor | Bodega |
| Traslado | Bodega | Otra bodega |
| Entrega | Bodega | Maleta de monitor |
| Devolución | Maleta de monitor | Bodega |
| Venta | Maleta (o bodega) | Cliente |
| Ajuste de entrada | — | Bodega (sobrante, regalo) |
| Ajuste de salida | Bodega | — (daño, pérdida) |

Reglas:
- No se puede sacar más de lo que hay.
- Nada se borra. Si hay un error, el admin **anula** el movimiento y queda el registro.
- Cada movimiento tiene número, fecha, quién lo hizo y nota.

## 4. Cómo se calculan los costos

**Costo promedio**: cuando entra una compra, el costo del producto se mezcla con lo que ya había.

Ejemplo: hay 10 libros a $20.000. Llegan 10 más a $30.000. Nuevo costo: 20 libros a $25.000.

- Traslados, entregas y devoluciones **no** cambian el costo.
- Cada venta guarda el costo de ese momento → ganancia = precio cobrado − costo.
- Compras en otra moneda: se anota la tasa de cambio y el sistema lo pasa a la moneda principal.

## 5. Pantallas

**Admins**
1. Entrar (correo y contraseña)
2. Resumen: valor del inventario por bodega, productos por agotarse
3. Inventario: qué hay en cada bodega y maleta (filtro por país y ciudad)
4. Movimientos: lista + registrar nuevo
5. Productos: crear, editar, ver costo promedio
6. Bodegas: crear (nombre, ciudad, país)
7. Monitores: qué tiene cada uno, qué vendió, cuánto dinero debe entregar
8. Usuarios: aprobar y dar rol
9. Reportes: ventas y ganancias por fecha, monitor, curso, país. Descargar a Excel

**Monitores** (pensado para celular)
1. Mi maleta
2. Registrar venta (curso, producto, cantidad, precio)
3. Mis ventas

## 6. Costo de mantenerlo

| Parte | Servicio | Costo |
|---|---|---|
| Página web | Vercel gratis | $0 |
| Datos y usuarios | Supabase del call center (ya pago) | $0 extra |
| Nombre propio (opcional) | ej. inventariojdt.com | ~USD 12/año |


## 7. Fases

1. **Base**: login, bodegas, productos, compras, traslados, inventario.
2. **Monitores**: maletas, entregas, ventas, devoluciones, cuadre.
3. **Costos y reportes**: ganancias, valor del inventario, Excel.
4. **Publicar** gratis y cargar datos iniciales.

## 8. Ya decidido (2026-11-09)

1. **Datos**: en el mismo proyecto Supabase del call center, en un espacio aparte que no toca nada del call center. Antes de conectar: copia de seguridad.
2. **Publicación**: Vercel (cuenta de JDT) + GitHub del usuario.
3. **Monedas**: pesos y dólares, las dos importan.
4. **Precio de venta**: cada país tiene sus precios y su moneda (respuesta de German, 2026-11-09). Pantalla «Países y monedas»: cada país con su moneda y cuántos pesos vale (tasa, la pone el admin). Las ventas van en la moneda del país de donde salen; los totales se suman en pesos.
5. **Ventas**: las registra el monitor.
8. **Dinero de los monitores**: sí se lleva la cuenta (cuánto vendió, cuánto entregó y cuánto debe), en la moneda de su país.
6. **Usuarios sin correo**, igual que el call center: se entra con usuario y contraseña (`usuario@jdt.local`). El usuario (MacV) es el superadmin y crea a los demás. German y Leidy entran con usuario, no con correo.
7. **Para que Claude pruebe**: selector «Ver como» solo en local, igual que el call center (ver cada rol sin contraseña).

## 9. Pendiente para preguntarle a German y Leidy

1. ~~¿Llevamos cuenta del dinero que entrega cada monitor?~~ Sí (hecho).
2. ¿En qué moneda se compra? ¿La tasa es fija o la del día? (Por ahora: el admin pone la tasa de cada país y la cambia cuando quiera.)
3. ~~¿Precio igual en todos los países?~~ No: cada país con sus precios y su moneda (hecho).
4. Lista inicial: países con su moneda, bodegas (ciudad-país), productos con costo y precio por país, monitores. Un Excel sirve.

## 10. Pedidos de Leidy (2026-11-09) — hechos

1. **Ventas en oficina**: además de las de los monitores, registrar ventas hechas en la oficina (salen de una bodega).
2. **Métodos de pago** configurables: efectivo, tarjeta (y cuál tarjeta), Nequi, etc. Cada venta dice cómo se pagó. El admin puede agregar o quitar métodos.

## 11. Usuarios al conectar

- Los crea el superadmin (MacV) desde la pantalla Usuarios, con usuario y contraseña, igual que Equipo en el call center. Claude no pone contraseñas.
- **Leidy**: ya existe (`leidy`, lectora en el call center). Mismo usuario y contraseña; en el inventario se le da rol admin.
- **German**: crear `german`, admin.

---

## Anexo técnico

**Obligatorio: Astro + Supabase.**

**Diseño: igual al panel de jdt-call-center** (`IA-CALL_CENTER/apps/panel`). Se copian tal cual sus estilos (`project.css`, `global.css`), menú lateral, tema claro/oscuro, login, tablas, selectores, fechas, modales, avisos y tarjetas de cifras. Fuente de reglas: su `DESIGN_SYSTEM.md`. Así todo lo de JDT se ve y se usa igual.

Diferencia: el call-center corre en un servidor pago (Render). El inventario se arma como página estática en Astro para que Vercel lo publique gratis.

```
INVENTARIO/
├── PLAN.md                  ← este archivo
├── supabase/
│   └── schema.sql           ← estructura de datos completa, lista para correr
└── src/                     ← (se crea al arrancar)
    ├── styles/              ← copiados de jdt-call-center (project.css, global.css)
    ├── layouts/             ← AppLayout, AuthLayout (copiados)
    ├── components/app/      ← BaseHead, Sidebar, ThemeSwitch (copiados)
    ├── components/ui/       ← Select, DatePicker, Modal, Menu, StatCard, PageHeader… (copiados)
    ├── lib/ui/              ← avisos, diálogos, filtros de tabla (copiados)
    ├── lib/supabase.ts, db.ts
    └── pages/
        ├── login.astro
        ├── index.astro         ← resumen
        ├── inventario.astro
        ├── movimientos.astro
        ├── productos.astro
        ├── bodegas.astro
        ├── monitores.astro
        ├── usuarios.astro
        ├── reportes.astro
        └── mi-maleta.astro     ← vista monitor
```

Datos (`supabase/schema.sql`):
- `perfiles` (rol: pendiente / monitor / admin), `bodegas` (tipo bodega o maleta), `productos`, `producto_costos` (solo admins), `proveedores`, `movimientos` + `movimiento_items`, `config`.
- Todo movimiento entra por `registrar_movimiento()`: valida permisos y stock, y actualiza costo promedio en un solo paso. `anular_movimiento()` para corregir.
- Vistas: `v_stock`, `v_stock_valorizado`, `v_ventas`, `v_cuadre_monitores`.
