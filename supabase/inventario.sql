-- INVENTARIO JDT — base de datos (2026-11-09)
-- Vive en el MISMO proyecto Supabase del call center (jdt-call-center), en su propio esquema «inventario».
-- No toca nada del call center: sus tablas no se leen ni se cambian. Lo único compartido son los usuarios (auth).
--
-- Seguridad: las tablas no se pueden leer ni escribir desde la página. Todo pasa por las funciones public.inv_*,
-- que revisan quién es y qué puede hacer. El esquema «inventario» no se publica en la API.
--
-- Rendimiento y limpieza:
--   · El stock se guarda ya sumado (inventario.stock); no se recalcula con todo el historial.
--   · Las filas de stock en 0 se borran solas: la tabla solo tiene lo que existe.
--   · Cada acción devuelve los datos nuevos en la misma respuesta (un solo viaje a la base).
--   · Movimientos y pagos nunca se borran: si hay un error se anulan y queda el registro.
--
-- Se puede correr varias veces: no borra datos.

create schema if not exists inventario;
revoke all on schema inventario from public, anon, authenticated;

-- ── Tablas ───────────────────────────────────────────────────────────
create table if not exists inventario.config (
  clave text primary key,
  valor text not null
);
insert into inventario.config (clave, valor) values ('moneda_base', 'COP') on conflict do nothing;

-- Quién entra al inventario. Los usuarios son los mismos de auth (los del call center pueden entrar con su misma
-- contraseña si se les da acceso aquí).
create table if not exists inventario.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  usuario    text not null,
  nombre     text not null,
  rol        text not null check (rol in ('superadmin','admin','monitor')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists perfiles_un_superadmin on inventario.perfiles ((true)) where rol = 'superadmin';

-- Países: cada uno vende en su moneda y con sus precios (German, 2026-11-09).
-- tasa = cuántos pesos vale 1 unidad de su moneda (para sumar todo en pesos). La pone el admin y la cambia cuando quiera.
create table if not exists inventario.paises (
  nombre text primary key,
  moneda text not null check (moneda ~ '^[A-Z]{3}$'),
  tasa   numeric(14,6) not null default 1 check (tasa > 0),
  check (moneda <> 'COP' or tasa = 1)
);
create unique index if not exists paises_nombre on inventario.paises (lower(nombre));
insert into inventario.paises (nombre, moneda) values ('Colombia', 'COP') on conflict do nothing;

-- Bodegas (tipo 'monitor' = maleta de un monitor). Toda bodega y maleta es de un país: de ahí sale la moneda de sus ventas.
create table if not exists inventario.bodegas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  ciudad     text not null default '',
  pais       text not null references inventario.paises(nombre) on update cascade,
  tipo       text not null default 'bodega' check (tipo in ('bodega','monitor')),
  monitor_id uuid unique references inventario.perfiles(id) on delete restrict,
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  check ((tipo = 'monitor') = (monitor_id is not null)),
  check (tipo = 'monitor' or ciudad <> '')
);

create table if not exists inventario.productos (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null,
  nombre       text not null,
  unidad       text not null default 'und',
  stock_minimo numeric(14,2) not null default 0 check (stock_minimo >= 0),
  activo       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists productos_codigo on inventario.productos (lower(codigo));

-- Precio de venta de cada producto en cada país (en la moneda del país). Sin fila = sin precio ahí.
create table if not exists inventario.precios (
  producto_id uuid not null references inventario.productos(id) on delete cascade,
  pais        text not null references inventario.paises(nombre) on update cascade on delete cascade,
  precio      numeric(14,2) not null check (precio > 0),
  primary key (producto_id, pais)
);

-- Costo promedio aparte: los monitores nunca lo reciben
create table if not exists inventario.producto_costos (
  producto_id    uuid primary key references inventario.productos(id) on delete cascade,
  costo_promedio numeric(14,4) not null default 0,
  updated_at     timestamptz not null default now()
);

create table if not exists inventario.proveedores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  contacto   text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists proveedores_nombre on inventario.proveedores (lower(nombre));

-- Cómo pagó el cliente (pedido de Leidy, 2026-11-09). El admin agrega, renombra o desactiva.
create table if not exists inventario.metodos_pago (
  id     smallint generated always as identity primary key,
  nombre text not null,
  activo boolean not null default true,
  orden  smallint not null default 0
);
-- Cada país tiene sus métodos (2026-11-11). Sin país = sirve en todos (p. ej. Efectivo).
alter table inventario.metodos_pago add column if not exists pais text references inventario.paises(nombre) on update cascade on delete cascade;
drop index if exists inventario.metodos_pago_nombre;
create unique index if not exists metodos_pago_nombre_pais on inventario.metodos_pago (lower(nombre), coalesce(pais, ''));
insert into inventario.metodos_pago (nombre, orden)
select x.nombre, x.orden
from (values ('Efectivo', 1), ('Nequi', 2), ('Daviplata', 3), ('Transferencia', 4), ('Tarjeta débito', 5), ('Tarjeta crédito', 6)) x(nombre, orden)
where not exists (select 1 from inventario.metodos_pago);

create table if not exists inventario.movimientos (
  id             bigint generated always as identity (start with 1001) primary key,
  tipo           text not null check (tipo in
                   ('compra','traslado','entrega','devolucion','entre_maletas','venta','ajuste_entrada','ajuste_salida')),
  fecha          date not null default current_date,
  origen_id      uuid references inventario.bodegas(id),
  destino_id     uuid references inventario.bodegas(id),
  proveedor_id   uuid references inventario.proveedores(id),
  metodo_pago_id smallint references inventario.metodos_pago(id),
  curso          text,
  moneda         text not null check (moneda ~ '^[A-Z]{3}$'),
  tasa           numeric(14,6) not null default 1 check (tasa > 0),  -- 1 unidad de «moneda» = tasa pesos
  nota           text,
  anulado        boolean not null default false,
  anulado_por    uuid references inventario.perfiles(id),
  anulado_en     timestamptz,
  creado_por     uuid not null references inventario.perfiles(id),
  created_at     timestamptz not null default now(),
  check (origen_id is distinct from destino_id)
);
-- De maleta a maleta (2026-11-11): la lista de tipos se pone al día también en una base ya creada
alter table inventario.movimientos drop constraint if exists movimientos_tipo_check;
alter table inventario.movimientos add constraint movimientos_tipo_check check (tipo in
  ('compra','traslado','entrega','devolucion','entre_maletas','venta','ajuste_entrada','ajuste_salida'));
create index if not exists movimientos_origen  on inventario.movimientos (origen_id);
create index if not exists movimientos_destino on inventario.movimientos (destino_id);

create table if not exists inventario.movimiento_items (
  id             bigint generated always as identity primary key,
  movimiento_id  bigint not null references inventario.movimientos(id),
  producto_id    uuid not null references inventario.productos(id),
  cantidad       numeric(14,2) not null check (cantidad > 0),
  valor_unitario numeric(14,2) not null default 0,  -- compra: costo pagado / venta: precio cobrado (en «moneda»)
  costo_unitario numeric(14,4) not null default 0   -- costo en pesos al momento (lo pone el sistema)
);
create index if not exists items_movimiento on inventario.movimiento_items (movimiento_id);
create index if not exists items_producto   on inventario.movimiento_items (producto_id);

-- Lo que hay ahora en cada bodega o maleta. Solo filas con cantidad > 0 (las que llegan a 0 se borran).
create table if not exists inventario.stock (
  bodega_id   uuid not null references inventario.bodegas(id),
  producto_id uuid not null references inventario.productos(id),
  cantidad    numeric(14,2) not null check (cantidad > 0),
  primary key (bodega_id, producto_id)
);
create index if not exists stock_producto on inventario.stock (producto_id);

-- Dinero que un monitor entrega de sus ventas (en la moneda de su país)
create table if not exists inventario.pagos (
  id             bigint generated always as identity primary key,
  bodega_id      uuid not null references inventario.bodegas(id),
  fecha          date not null default current_date,
  valor          numeric(14,2) not null check (valor > 0),
  moneda         text not null default 'COP',
  metodo_pago_id smallint references inventario.metodos_pago(id),
  nota           text,
  creado_por     uuid not null references inventario.perfiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists pagos_bodega on inventario.pagos (bodega_id);
-- Un pago mal escrito se anula (queda el registro), igual que los movimientos
alter table inventario.pagos
  add column if not exists anulado     boolean not null default false,
  add column if not exists anulado_por uuid references inventario.perfiles(id),
  add column if not exists anulado_en  timestamptz;

-- Nadie entra a las tablas directo (solo las funciones de abajo)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'inventario' loop
    execute format('alter table inventario.%I enable row level security', t);
    execute format('revoke all on inventario.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ── Ayudantes internos ───────────────────────────────────────────────
-- Hoy en Colombia. La base trabaja en hora mundial: después de las 7 pm ya marca el día siguiente.
create or replace function inventario.hoy()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Bogota')::date;
$$;

-- Perfil de quien llama (null si no tiene acceso o está desactivado)
create or replace function inventario.yo()
returns inventario.perfiles language sql stable security definer set search_path = '' as $$
  select p from inventario.perfiles p where p.id = auth.uid() and p.activo;
$$;

create or replace function inventario.exigir(p_roles text[])
returns inventario.perfiles language plpgsql stable security definer set search_path = '' as $$
declare v inventario.perfiles := inventario.yo();
begin
  if v.id is null then raise exception 'No tienes acceso al inventario.'; end if;
  if not v.rol = any (p_roles) then raise exception 'No tienes permiso para esto.'; end if;
  return v;
end $$;

-- Suma o resta del stock. Al restar valida que alcance; las filas en 0 se borran.
create or replace function inventario.mover_stock(p_bodega uuid, p_producto uuid, p_cantidad numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hay numeric;
begin
  if p_cantidad > 0 then
    insert into inventario.stock as s (bodega_id, producto_id, cantidad) values (p_bodega, p_producto, p_cantidad)
    on conflict (bodega_id, producto_id) do update set cantidad = s.cantidad + excluded.cantidad;
    return;
  end if;
  select cantidad into v_hay from inventario.stock where bodega_id = p_bodega and producto_id = p_producto for update;
  v_hay := coalesce(v_hay, 0);
  if v_hay + p_cantidad < 0 then
    raise exception 'No hay suficiente «%» en %: hay %, pediste %.',
      (select nombre from inventario.productos where id = p_producto),
      (select nombre from inventario.bodegas where id = p_bodega),
      trim(to_char(v_hay, 'FM999999990.##'), '.'), trim(to_char(-p_cantidad, 'FM999999990.##'), '.');
  end if;
  if v_hay + p_cantidad = 0 then
    delete from inventario.stock where bodega_id = p_bodega and producto_id = p_producto;
  else
    update inventario.stock set cantidad = v_hay + p_cantidad where bodega_id = p_bodega and producto_id = p_producto;
  end if;
end $$;

-- Registra UN movimiento (lo llama inv_registrar). p: {tipo, origen_id, destino_id, items:[{producto_id, cantidad,
-- valor_unitario}], fecha, proveedor_id, proveedor_nuevo, metodo_pago_id, curso, moneda, tasa, nota}
-- Moneda: la compra dice en cuál se pagó; la venta va en la moneda del país de donde sale (y con su tasa del día).
create or replace function inventario.registrar(p jsonb, v_yo inventario.perfiles)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_tipo   text := p->>'tipo';
  v_origen uuid := nullif(p->>'origen_id', '')::uuid;
  v_dest   uuid := nullif(p->>'destino_id', '')::uuid;
  v_prov   uuid := nullif(p->>'proveedor_id', '')::uuid;
  v_metodo smallint := nullif(p->>'metodo_pago_id', '')::smallint;
  v_moneda text := upper(coalesce(nullif(trim(p->>'moneda'), ''), 'COP'));
  v_tasa   numeric := nullif(p->>'tasa', '')::numeric;
  v_o      inventario.bodegas;
  v_d      inventario.bodegas;
  v_id     bigint;
  v_it     jsonb;
  v_prod   uuid;
  v_cant   numeric;
  v_valor  numeric;
  v_avg    numeric;
  v_total  numeric;
  v_costo  numeric;
begin
  if v_origen is not null then
    select * into v_o from inventario.bodegas where id = v_origen and activa;
    if v_o.id is null then raise exception 'El lugar de origen no existe o está desactivado.'; end if;
  end if;
  if v_dest is not null then
    select * into v_d from inventario.bodegas where id = v_dest and activa;
    if v_d.id is null then raise exception 'El lugar de destino no existe o está desactivado.'; end if;
  end if;

  if v_yo.rol = 'monitor' and (v_tipo <> 'venta' or v_o.monitor_id is distinct from v_yo.id) then
    raise exception 'Solo puedes registrar ventas de tu maleta.';
  end if;

  if not coalesce(case v_tipo
    when 'compra'         then v_o.id is null and v_d.tipo = 'bodega'
    when 'ajuste_entrada' then v_o.id is null and v_d.id is not null
    when 'ajuste_salida'  then v_d.id is null and v_o.id is not null
    when 'venta'          then v_d.id is null and v_o.id is not null
    when 'traslado'       then v_o.tipo = 'bodega' and v_d.tipo = 'bodega'
    when 'entrega'        then v_o.tipo = 'bodega' and v_d.tipo = 'monitor'
    when 'devolucion'     then v_o.tipo = 'monitor' and v_d.tipo = 'bodega'
    when 'entre_maletas'  then v_o.tipo = 'monitor' and v_d.tipo = 'monitor' and v_o.id <> v_d.id
    else false
  end, false) then
    raise exception 'El origen o el destino no corresponden a este tipo de movimiento.';
  end if;

  if v_tipo = 'venta' then
    select moneda, tasa into v_moneda, v_tasa from inventario.paises where nombre = v_o.pais;
  elsif v_tipo <> 'compra' then
    v_moneda := 'COP';
  end if;
  if v_moneda = 'COP' then v_tasa := 1; end if;
  if v_moneda !~ '^[A-Z]{3}$' then raise exception 'Moneda no válida.'; end if;
  if v_tasa is null or v_tasa <= 0 then raise exception 'Escribe la tasa de cambio.'; end if;

  if v_tipo = 'compra' then
    if v_prov is null and nullif(trim(p->>'proveedor_nuevo'), '') is not null then
      select id into v_prov from inventario.proveedores where lower(nombre) = lower(trim(p->>'proveedor_nuevo'));
      if v_prov is null then
        insert into inventario.proveedores (nombre) values (trim(p->>'proveedor_nuevo')) returning id into v_prov;
      end if;
    end if;
    if v_prov is null or not exists (select 1 from inventario.proveedores where id = v_prov) then
      raise exception 'Elige el proveedor.';
    end if;
  else
    v_prov := null;
  end if;

  if v_tipo = 'venta' then
    if v_metodo is null or not exists (select 1 from inventario.metodos_pago where id = v_metodo and activo and (pais is null or pais = v_o.pais)) then
      raise exception 'Elige cómo pagó el cliente.';
    end if;
  else
    v_metodo := null;
  end if;

  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Agrega al menos un producto con cantidad.';
  end if;

  insert into inventario.movimientos
    (tipo, fecha, origen_id, destino_id, proveedor_id, metodo_pago_id, curso, moneda, tasa, nota, creado_por)
  values
    (v_tipo, coalesce(nullif(p->>'fecha', '')::date, inventario.hoy()), v_o.id, v_d.id, v_prov, v_metodo,
     case when v_tipo = 'venta' then nullif(trim(p->>'curso'), '') end,
     v_moneda, v_tasa, nullif(trim(p->>'nota'), ''), v_yo.id)
  returning id into v_id;

  for v_it in select * from jsonb_array_elements(p->'items') loop
    v_prod  := nullif(v_it->>'producto_id', '')::uuid;
    v_cant  := nullif(v_it->>'cantidad', '')::numeric;
    v_valor := coalesce(nullif(v_it->>'valor_unitario', '')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad no válida.'; end if;
    -- Las compras ya no llevan costo (2026-11-11): solo la venta pide precio
    if v_tipo = 'venta' and v_valor <= 0 then raise exception 'Escribe el precio de cada producto.'; end if;
    if v_valor < 0 then raise exception 'Valor no válido.'; end if;

    -- bloquea el costo del producto mientras se calcula (dos compras a la vez no se pisan)
    select costo_promedio into v_avg from inventario.producto_costos where producto_id = v_prod for update;
    if not found then raise exception 'Ese producto no existe.'; end if;

    if v_tipo = 'compra' and v_valor > 0 then
      v_costo := v_valor * v_tasa;
      select coalesce(sum(cantidad), 0) into v_total from inventario.stock where producto_id = v_prod;
      update inventario.producto_costos
         set costo_promedio = (v_total * v_avg + v_cant * v_costo) / (v_total + v_cant), updated_at = now()
       where producto_id = v_prod;
    else
      v_costo := v_avg;
    end if;

    if v_o.id is not null then perform inventario.mover_stock(v_o.id, v_prod, -v_cant); end if;
    if v_d.id is not null then perform inventario.mover_stock(v_d.id, v_prod, v_cant); end if;

    insert into inventario.movimiento_items (movimiento_id, producto_id, cantidad, valor_unitario, costo_unitario)
    values (v_id, v_prod, v_cant, v_valor, v_costo);
  end loop;

  return v_id;
end $$;

-- Todo lo que ve quien llama, en un solo JSON (lo pinta la página). El monitor recibe solo lo suyo y sin costos.
-- Los productos van todos (también los desactivados): un monitor puede tener uno en la maleta o haberlo vendido.
create or replace function inventario.datos(v_yo inventario.perfiles)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin  boolean := v_yo.rol in ('superadmin','admin');
  v_maleta uuid := (select id from inventario.bodegas where monitor_id = v_yo.id);
begin
  return jsonb_build_object(
    'yo', jsonb_build_object('id', v_yo.id, 'nombre', v_yo.nombre, 'usuario', v_yo.usuario, 'rol', v_yo.rol),
    'moneda', (select valor from inventario.config where clave = 'moneda_base'),
    'paises', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', x.nombre, 'moneda', x.moneda, 'tasa', x.tasa) order by x.nombre)
      from inventario.paises x), '[]'),
    'perfiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'usuario', p.usuario, 'rol', p.rol,
               'activo', p.activo, 'creado', (p.created_at at time zone 'America/Bogota')::date,
               'propio', coalesce(u.raw_app_meta_data->>'sistema', '') = 'inventario') order by p.nombre)
      from inventario.perfiles p join auth.users u on u.id = p.id
      where v_admin or p.id = v_yo.id), '[]'),
    'bodegas', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'nombre', b.nombre, 'ciudad', b.ciudad, 'pais', b.pais,
               'tipo', b.tipo, 'monitor_id', b.monitor_id, 'activa', b.activa) order by b.tipo, b.nombre)
      from inventario.bodegas b where v_admin or b.id = v_maleta), '[]'),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'codigo', x.codigo, 'nombre', x.nombre, 'unidad', x.unidad,
               'stock_minimo', x.stock_minimo, 'activo', x.activo,
               'precios', coalesce((select jsonb_object_agg(r.pais, r.precio) from inventario.precios r where r.producto_id = x.id), '{}'))
             order by x.nombre)
      from inventario.productos x), '[]'),
    'proveedores', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'nombre', v.nombre, 'contacto', v.contacto) order by v.nombre)
      from inventario.proveedores v), '[]') else '[]' end,
    'metodos_pago', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'pais', m.pais, 'activo', m.activo) order by m.orden, m.nombre)
      from inventario.metodos_pago m where v_admin or m.activo), '[]'),
    'movimientos', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'fecha', m.fecha, 'origen_id', m.origen_id,
               'destino_id', m.destino_id, 'proveedor_id', m.proveedor_id, 'metodo_pago_id', m.metodo_pago_id,
               'curso', m.curso, 'moneda', m.moneda, 'tasa', m.tasa, 'nota', m.nota, 'anulado', m.anulado,
               'creado_por', coalesce(c.nombre, ''),
               'items', (select jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'cantidad', i.cantidad,
                           'valor_unitario', i.valor_unitario,
                           'costo_unitario', case when v_admin then i.costo_unitario else 0 end) order by i.id)
                         from inventario.movimiento_items i where i.movimiento_id = m.id)) order by m.id)
      from inventario.movimientos m left join inventario.perfiles c on c.id = m.creado_por
      where v_admin or m.origen_id = v_maleta or m.destino_id = v_maleta), '[]'),
    'pagos', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'bodega_id', g.bodega_id, 'fecha', g.fecha, 'valor', g.valor, 'moneda', g.moneda,
               'metodo_pago_id', g.metodo_pago_id, 'nota', g.nota, 'anulado', g.anulado, 'creado_por', coalesce(c.nombre, '')) order by g.id)
      from inventario.pagos g left join inventario.perfiles c on c.id = g.creado_por
      where v_admin or g.bodega_id = v_maleta), '[]'),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_array(s.bodega_id, s.producto_id, s.cantidad))
      from inventario.stock s where v_admin or s.bodega_id = v_maleta), '[]'),
    'costos', case when v_admin then coalesce((
      select jsonb_object_agg(c.producto_id, c.costo_promedio) from inventario.producto_costos c), '{}') else '{}' end
  );
end $$;

-- ── Funciones que usa la página (public.inv_*) ───────────────────────
-- Datos para pintar
create or replace function public.inv_datos()
returns jsonb language sql stable security definer set search_path = '' as $$
  select inventario.datos(inventario.exigir(array['superadmin','admin','monitor']));
$$;

-- Registra uno o varios movimientos en una sola operación (todo o nada). p: [{...}, {...}]
create or replace function public.inv_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_yo  inventario.perfiles := inventario.exigir(array['superadmin','admin','monitor']);
  v_ids bigint[] := '{}';
  v_m   jsonb;
begin
  if jsonb_typeof(p) = 'object' then p := jsonb_build_array(p); end if;
  if v_yo.rol = 'monitor' and jsonb_array_length(p) > 1 then raise exception 'No tienes permiso para esto.'; end if;
  for v_m in select * from jsonb_array_elements(p) loop
    v_ids := v_ids || inventario.registrar(v_m, v_yo);
  end loop;
  return jsonb_build_object('ids', to_jsonb(v_ids), 'datos', inventario.datos(v_yo));
end $$;

-- Anula un movimiento (solo admin). Las cantidades vuelven; el registro queda.
create or replace function public.inv_anular(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_yo  inventario.perfiles := inventario.exigir(array['superadmin','admin']);
  v_mov inventario.movimientos;
  v_it  inventario.movimiento_items;
  v_avg numeric;
  v_tot numeric;
begin
  select * into v_mov from inventario.movimientos where id = p_id for update;
  if v_mov.id is null or v_mov.anulado then raise exception 'Ese movimiento no existe o ya está anulado.'; end if;

  for v_it in select * from inventario.movimiento_items where movimiento_id = p_id order by id loop
    -- compra: deshace su efecto en el costo promedio
    if v_mov.tipo = 'compra' and v_it.valor_unitario > 0 then
      select costo_promedio into v_avg from inventario.producto_costos where producto_id = v_it.producto_id for update;
      select coalesce(sum(cantidad), 0) into v_tot from inventario.stock where producto_id = v_it.producto_id;
      if v_tot - v_it.cantidad > 0 then
        update inventario.producto_costos
           set costo_promedio = greatest((v_tot * v_avg - v_it.cantidad * v_it.costo_unitario) / (v_tot - v_it.cantidad), 0),
               updated_at = now()
         where producto_id = v_it.producto_id;
      end if;
    end if;
    if v_mov.destino_id is not null then
      begin
        perform inventario.mover_stock(v_mov.destino_id, v_it.producto_id, -v_it.cantidad);
      exception when others then
        raise exception 'No se puede anular: esa mercancía ya salió de %. Anula primero lo que se hizo después.',
          (select nombre from inventario.bodegas where id = v_mov.destino_id);
      end;
    end if;
    if v_mov.origen_id is not null then perform inventario.mover_stock(v_mov.origen_id, v_it.producto_id, v_it.cantidad); end if;
  end loop;

  update inventario.movimientos set anulado = true, anulado_por = v_yo.id, anulado_en = now() where id = p_id;
  return jsonb_build_object('datos', inventario.datos(v_yo));
end $$;

-- Pone o quita el precio de un producto en un país (0 o vacío = sin precio ahí)
create or replace function inventario.poner_precio(p_producto uuid, p_pais text, p_precio numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pais text := (select nombre from inventario.paises where lower(nombre) = lower(trim(p_pais)));
begin
  if v_pais is null then raise exception 'El país «%» no está en Países y monedas.', trim(p_pais); end if;
  if coalesce(p_precio, 0) < 0 then raise exception 'Precio no válido.'; end if;
  if coalesce(p_precio, 0) = 0 then
    delete from inventario.precios where producto_id = p_producto and pais = v_pais;
  else
    insert into inventario.precios as r (producto_id, pais, precio) values (p_producto, v_pais, p_precio)
    on conflict (producto_id, pais) do update set precio = excluded.precio;
  end if;
end $$;

-- Crea o edita productos, bodegas, proveedores, métodos de pago, países y precios (solo admin). p: un objeto o una lista.
-- Con «id» edita; sin «id» crea (productos y bodegas: si ya existe el mismo código / nombre, lo actualiza;
-- con «nuevo»: true —el formulario de crear— avisa en vez de pisar el que ya existe).
-- productos: {.., precios: {"Colombia": 60000, "Perú": 60}} · precios (carga de Excel): {codigo, pais, precio}
-- paises: {id = nombre actual (al editar), nombre, moneda, tasa}
create or replace function public.inv_guardar(p_tabla text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_yo inventario.perfiles := inventario.exigir(array['superadmin','admin']);
  v_x  jsonb;
  v_id text;
  v_ids text[] := '{}';
  v_k  text;
  v_v  jsonb;
  v_mon text;
  v_tasa numeric;
begin
  if jsonb_typeof(p) = 'object' then p := jsonb_build_array(p); end if;
  for v_x in select * from jsonb_array_elements(p) loop
    v_id := nullif(v_x->>'id', '');

    if p_tabla = 'productos' then
      if nullif(trim(v_x->>'nombre'), '') is null then raise exception 'Escribe el nombre del producto.'; end if;
      if nullif(trim(v_x->>'codigo'), '') is null then raise exception 'Escribe el código del producto.'; end if;
      if v_id is null then
        select id::text into v_id from inventario.productos where lower(codigo) = lower(trim(v_x->>'codigo'));
        if v_id is not null and coalesce((v_x->>'nuevo')::boolean, false) then raise exception 'Ya hay un producto con el código %.', trim(v_x->>'codigo'); end if;
      end if;
      if exists (select 1 from inventario.productos where lower(codigo) = lower(trim(v_x->>'codigo')) and id::text is distinct from v_id) then
        raise exception 'Ya hay un producto con el código %.', trim(v_x->>'codigo');
      end if;
      if v_id is null then
        insert into inventario.productos (codigo, nombre, unidad, stock_minimo)
        values (trim(v_x->>'codigo'), trim(v_x->>'nombre'), coalesce(nullif(trim(v_x->>'unidad'), ''), 'und'),
                coalesce((v_x->>'stock_minimo')::numeric, 0))
        returning id::text into v_id;
        insert into inventario.producto_costos (producto_id) values (v_id::uuid);
      else
        update inventario.productos set
          codigo = trim(v_x->>'codigo'), nombre = trim(v_x->>'nombre'),
          unidad = coalesce(nullif(trim(v_x->>'unidad'), ''), unidad),
          stock_minimo = coalesce((v_x->>'stock_minimo')::numeric, stock_minimo),
          activo = coalesce((v_x->>'activo')::boolean, activo)
        where id = v_id::uuid;
      end if;
      if jsonb_typeof(v_x->'precios') = 'object' then
        for v_k, v_v in select * from jsonb_each(v_x->'precios') loop
          perform inventario.poner_precio(v_id::uuid, v_k, nullif(v_v #>> '{}', '')::numeric);
        end loop;
      end if;

    elsif p_tabla = 'precios' then
      select id::text into v_id from inventario.productos where lower(codigo) = lower(trim(v_x->>'codigo'));
      if v_id is null then raise exception 'No existe el código %.', trim(v_x->>'codigo'); end if;
      perform inventario.poner_precio(v_id::uuid, v_x->>'pais', nullif(v_x->>'precio', '')::numeric);

    elsif p_tabla = 'paises' then
      v_mon := upper(trim(coalesce(v_x->>'moneda', '')));
      v_tasa := case when v_mon = 'COP' then 1 else nullif(v_x->>'tasa', '')::numeric end;
      if nullif(trim(v_x->>'nombre'), '') is null then raise exception 'Escribe el nombre del país.'; end if;
      if v_mon !~ '^[A-Z]{3}$' then raise exception 'Elige la moneda.'; end if;
      if v_tasa is null or v_tasa <= 0 then raise exception 'Escribe cuántos pesos vale 1 %.', v_mon; end if;
      if exists (select 1 from inventario.paises where lower(nombre) = lower(trim(v_x->>'nombre')) and nombre is distinct from v_id) then
        raise exception 'Ya existe ese país.';
      end if;
      if v_id is null then
        insert into inventario.paises (nombre, moneda, tasa) values (trim(v_x->>'nombre'), v_mon, v_tasa);
      else
        update inventario.paises set nombre = trim(v_x->>'nombre'), moneda = v_mon, tasa = v_tasa where nombre = v_id;
        if not found then raise exception 'Ese país no existe.'; end if;
      end if;
      v_id := trim(v_x->>'nombre');

    elsif p_tabla = 'bodegas' then
      if nullif(trim(v_x->>'pais'), '') is not null and not exists (select 1 from inventario.paises where nombre = trim(v_x->>'pais')) then
        raise exception 'El país «%» no está en Países y monedas.', trim(v_x->>'pais');
      end if;
      if v_id is null then
        if nullif(trim(v_x->>'nombre'), '') is null then raise exception 'Escribe el nombre de la bodega.'; end if;
        select id::text into v_id from inventario.bodegas where tipo = 'bodega' and lower(nombre) = lower(trim(v_x->>'nombre'));
        if v_id is not null and coalesce((v_x->>'nuevo')::boolean, false) then raise exception 'Ya existe una bodega con ese nombre.'; end if;
      elsif nullif(trim(v_x->>'nombre'), '') is not null and exists (select 1 from inventario.bodegas
              where tipo = 'bodega' and lower(nombre) = lower(trim(v_x->>'nombre')) and id::text <> v_id) then
        raise exception 'Ya existe una bodega con ese nombre.';
      end if;
      if v_x ? 'activa' and not (v_x->>'activa')::boolean and exists (select 1 from inventario.stock where bodega_id = v_id::uuid) then
        raise exception '% todavía tiene mercancía. Trasládala antes de desactivarla.', (select nombre from inventario.bodegas where id = v_id::uuid);
      end if;
      if v_id is null then
        if nullif(trim(v_x->>'ciudad'), '') is null or nullif(trim(v_x->>'pais'), '') is null then raise exception 'Elige la ciudad y el país.'; end if;
        insert into inventario.bodegas (nombre, ciudad, pais) values (trim(v_x->>'nombre'), trim(v_x->>'ciudad'), trim(v_x->>'pais'))
        returning id::text into v_id;
      else
        update inventario.bodegas set
          nombre = coalesce(nullif(trim(v_x->>'nombre'), ''), nombre),
          ciudad = coalesce(nullif(trim(v_x->>'ciudad'), ''), ciudad),
          pais   = coalesce(nullif(trim(v_x->>'pais'), ''), pais),
          activa = coalesce((v_x->>'activa')::boolean, activa)
        where id = v_id::uuid;
      end if;

    elsif p_tabla = 'proveedores' then
      if nullif(trim(v_x->>'nombre'), '') is null then raise exception 'Escribe el nombre del proveedor.'; end if;
      if exists (select 1 from inventario.proveedores where lower(nombre) = lower(trim(v_x->>'nombre')) and id::text is distinct from v_id) then
        raise exception 'Ya existe ese proveedor.';
      end if;
      if v_id is null then
        insert into inventario.proveedores (nombre, contacto) values (trim(v_x->>'nombre'), coalesce(trim(v_x->>'contacto'), ''))
        returning id::text into v_id;
      else
        update inventario.proveedores set nombre = trim(v_x->>'nombre'), contacto = coalesce(trim(v_x->>'contacto'), contacto)
        where id = v_id::uuid;
      end if;

    elsif p_tabla = 'metodos_pago' then
      if v_id is null then
        if nullif(trim(v_x->>'nombre'), '') is null then raise exception 'Escribe el nombre del método de pago.'; end if;
        if exists (select 1 from inventario.metodos_pago where lower(nombre) = lower(trim(v_x->>'nombre'))
                     and coalesce(pais, '') = coalesce(nullif(trim(v_x->>'pais'), ''), '')) then raise exception 'Ya existe ese método de pago.'; end if;
        insert into inventario.metodos_pago (nombre, pais, orden)
        values (trim(v_x->>'nombre'), nullif(trim(v_x->>'pais'), ''), (select coalesce(max(orden), 0) + 1 from inventario.metodos_pago))
        returning id::text into v_id;
      else
        if exists (select 1 from inventario.metodos_pago m, inventario.metodos_pago y
                    where y.id::text = v_id and m.id <> y.id
                      and lower(m.nombre) = lower(coalesce(nullif(trim(v_x->>'nombre'), ''), y.nombre))
                      and coalesce(m.pais, '') = coalesce(case when v_x ? 'pais' then nullif(trim(v_x->>'pais'), '') else y.pais end, '')) then
          raise exception 'Ya existe ese método de pago.';
        end if;
        update inventario.metodos_pago set
          nombre = coalesce(nullif(trim(v_x->>'nombre'), ''), nombre),
          pais   = case when v_x ? 'pais' then nullif(trim(v_x->>'pais'), '') else pais end,
          activo = coalesce((v_x->>'activo')::boolean, activo)
        where id = v_id::smallint;
      end if;

    else
      raise exception 'Tabla no válida.';
    end if;

    v_ids := v_ids || v_id;
  end loop;
  return jsonb_build_object('ids', to_jsonb(v_ids), 'datos', inventario.datos(v_yo));
end $$;

-- Dinero que entrega un monitor (solo admin). Va en la moneda del país de su maleta.
create or replace function public.inv_pago(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_yo inventario.perfiles := inventario.exigir(array['superadmin','admin']);
  v_mon text := (select x.moneda from inventario.bodegas b join inventario.paises x on x.nombre = b.pais
                 where b.id = nullif(p->>'bodega_id', '')::uuid and b.tipo = 'monitor');
begin
  if v_mon is null then raise exception 'Elige el monitor.'; end if;
  if coalesce(nullif(p->>'valor', '')::numeric, 0) <= 0 then raise exception 'Escribe el valor recibido.'; end if;
  insert into inventario.pagos (bodega_id, fecha, valor, moneda, metodo_pago_id, nota, creado_por)
  values ((p->>'bodega_id')::uuid, coalesce(nullif(p->>'fecha', '')::date, inventario.hoy()), (p->>'valor')::numeric, v_mon,
          nullif(p->>'metodo_pago_id', '')::smallint, nullif(trim(p->>'nota'), ''), v_yo.id);
  return jsonb_build_object('datos', inventario.datos(v_yo));
end $$;

-- Anula un pago mal registrado (solo admin). Deja de contar; el registro queda.
create or replace function public.inv_pago_anular(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_yo inventario.perfiles := inventario.exigir(array['superadmin','admin']);
begin
  update inventario.pagos set anulado = true, anulado_por = v_yo.id, anulado_en = now() where id = p_id and not anulado;
  if not found then raise exception 'Ese pago no existe o ya está anulado.'; end if;
  return jsonb_build_object('datos', inventario.datos(v_yo));
end $$;

-- ── Usuarios ─────────────────────────────────────────────────────────
-- Sin correos, igual que el call center: el usuario «german» entra como german@jdt.local.
-- Si el usuario ya existe (p. ej. alguien del call center), se le da acceso y entra con su misma contraseña.
-- superadmin crea admins y monitores; admin crea monitores.
-- p: {usuario, nombre, password, rol, ciudad, pais}
create or replace function public.inv_usuario_crear(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_yo   inventario.perfiles := inventario.exigir(array['superadmin','admin']);
  v_user text := lower(trim(coalesce(p->>'usuario', '')));
  v_nom  text := regexp_replace(trim(coalesce(p->>'nombre', '')), '\s+', ' ', 'g');
  v_rol  text := p->>'rol';
  v_pass text := coalesce(p->>'password', '');
  v_mail text;
  v_uid  uuid;
  v_ya   boolean := false;
begin
  if v_rol not in ('admin','monitor') then raise exception 'Rol no válido.'; end if;
  if v_yo.rol = 'admin' and v_rol <> 'monitor' then raise exception 'Solo el superadmin crea admins.'; end if;
  if v_user !~ '^[a-z0-9._-]{3,30}$' then raise exception 'Usuario: de 3 a 30 letras o números, sin espacios ni tildes.'; end if;
  if length(v_nom) < 3 then raise exception 'Escribe nombre y apellido.'; end if;
  if v_rol = 'monitor' and not exists (select 1 from inventario.paises where nombre = trim(coalesce(p->>'pais', ''))) then
    raise exception 'Elige el país de su maleta.';
  end if;
  v_mail := v_user || '@jdt.local';

  select id into v_uid from auth.users where email = v_mail;
  if v_uid is not null then
    if exists (select 1 from inventario.perfiles where id = v_uid) then raise exception 'Ese usuario ya está en el inventario.'; end if;
    v_ya := true;
  else
    if length(v_pass) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres.'; end if;
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_mail,
            extensions.crypt(v_pass, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"],"sistema":"inventario"}', jsonb_build_object('name', v_nom), now(), now(),
            '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', v_mail, 'email_verified', true, 'phone_verified', false), 'email', now(), now());
    -- El call center le crea un perfil a todo usuario nuevo: se quita para que NO pueda entrar allá.
    if to_regclass('public.profiles') is not null then
      execute 'delete from public.profiles where id = $1' using v_uid;
    end if;
  end if;

  insert into inventario.perfiles (id, usuario, nombre, rol) values (v_uid, v_user, v_nom, v_rol);
  if v_rol = 'monitor' then
    insert into inventario.bodegas (nombre, ciudad, pais, tipo, monitor_id)
    values ('Maleta ' || v_nom, coalesce(trim(p->>'ciudad'), ''), trim(p->>'pais'), 'monitor', v_uid);
  end if;
  return jsonb_build_object('existente', v_ya, 'datos', inventario.datos(v_yo));
end $$;

-- Cambia rol, nombre, contraseña o acceso. p: {id, rol?, nombre?, password?, activo?, ciudad?, pais?}
-- La contraseña solo se cambia aquí si el usuario se creó en el inventario (la de alguien del call center se cambia allá).
create or replace function public.inv_usuario_cambiar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_yo  inventario.perfiles := inventario.exigir(array['superadmin','admin']);
  v_per inventario.perfiles;
  v_rol text := nullif(p->>'rol', '');
begin
  select * into v_per from inventario.perfiles where id = nullif(p->>'id', '')::uuid;
  if v_per.id is null then raise exception 'Ese usuario no existe.'; end if;
  if v_per.rol = 'superadmin' or v_per.id = v_yo.id then raise exception 'Ese usuario no se cambia aquí.'; end if;
  if v_yo.rol = 'admin' and (v_per.rol <> 'monitor' or coalesce(v_rol, 'monitor') <> 'monitor') then
    raise exception 'Solo el superadmin cambia a los admins.';
  end if;
  if v_rol is not null and v_rol not in ('admin','monitor') then raise exception 'Rol no válido.'; end if;

  if nullif(p->>'password', '') is not null then
    if length(p->>'password') < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres.'; end if;
    if not exists (select 1 from auth.users where id = v_per.id and raw_app_meta_data->>'sistema' = 'inventario') then
      raise exception 'Este usuario también entra al call center: su contraseña se cambia allá.';
    end if;
    update auth.users set encrypted_password = extensions.crypt(p->>'password', extensions.gen_salt('bf')), updated_at = now()
    where id = v_per.id;
  end if;

  update inventario.perfiles set
    rol    = coalesce(v_rol, rol),
    nombre = coalesce(nullif(regexp_replace(trim(p->>'nombre'), '\s+', ' ', 'g'), ''), nombre),
    activo = coalesce((p->>'activo')::boolean, activo)
  where id = v_per.id
  returning * into v_per;

  if nullif(trim(p->>'pais'), '') is not null and not exists (select 1 from inventario.paises where nombre = trim(p->>'pais')) then
    raise exception 'El país «%» no está en Países y monedas.', trim(p->>'pais');
  end if;
  if v_per.rol = 'monitor' and not exists (select 1 from inventario.bodegas where monitor_id = v_per.id) then
    if nullif(trim(p->>'pais'), '') is null then raise exception 'Elige el país de su maleta.'; end if;
    insert into inventario.bodegas (nombre, ciudad, pais, tipo, monitor_id)
    values ('Maleta ' || v_per.nombre, coalesce(trim(p->>'ciudad'), ''), trim(p->>'pais'), 'monitor', v_per.id);
  else
    -- cambia la ciudad o el país de su maleta (sus ventas nuevas van en la moneda del país nuevo)
    update inventario.bodegas set
      ciudad = coalesce(nullif(trim(p->>'ciudad'), ''), ciudad),
      pais   = coalesce(nullif(trim(p->>'pais'), ''), pais)
    where monitor_id = v_per.id and (nullif(trim(p->>'ciudad'), '') is not null or nullif(trim(p->>'pais'), '') is not null);
  end if;
  -- desactivado: sus sesiones abiertas se cierran
  -- (solo si es solo del inventario: a alguien del call center no se le cierra allá)
  if not v_per.activo and exists (select 1 from auth.users u where u.id = v_per.id and u.raw_app_meta_data->>'sistema' = 'inventario') then
    delete from auth.sessions where user_id = v_per.id;
  end if;
  return jsonb_build_object('datos', inventario.datos(v_yo));
end $$;

-- ── Permisos ─────────────────────────────────────────────────────────
revoke all on all functions in schema inventario from public, anon, authenticated;
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\_%' loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
