-- Pruebas de inventario.sql. Correr en una base de PRUEBA (nunca en la real): crean y borran datos.
-- Necesita lo mínimo de Supabase (auth.users, auth.uid(), roles anon/authenticated) y arranque.sql.
\set ON_ERROR_STOP 1
\set QUIET 1

-- Ayudantes: actuar como alguien y esperar un error
create or replace function public.t_espera_error(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALLA: se esperaba el error «%» y no hubo error', p_msg;
exception when others then
  if sqlerrm not like '%' || p_msg || '%' then raise exception 'FALLA: se esperaba «%», llegó «%»', p_msg, sqlerrm; end if;
end $$;
grant execute on function public.t_espera_error(text, text) to anon, authenticated;
create or replace function public.t_ok(p boolean, p_que text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLA: %', p_que; end if;
  raise notice 'OK  %', p_que;
end $$;
grant execute on function public.t_ok(boolean, text) to anon, authenticated;


-- Solo para estas pruebas: dejar leer las tablas para buscar ids (se quita en la prueba 15)
grant usage on schema inventario to authenticated;
grant select on all tables in schema inventario to authenticated;
alter role authenticated bypassrls;

-- 1. Sin sesión no entra nadie
set role anon;
select t_espera_error('select public.inv_datos()', 'permission denied');
reset role;
select t_ok(true, 'anónimo no puede leer');

-- 2. Usuario del call center sin acceso al inventario
insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-00000000000c', 'jheiner@jdt.local', '{}');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
select t_espera_error('select public.inv_datos()', 'No tienes acceso');
reset role;
select t_ok(true, 'usuario del call center sin acceso no entra');

-- 3. Superadmin arma lo básico
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select t_ok((public.inv_datos()->'yo'->>'rol') = 'superadmin', 'MacV es superadmin');
select t_ok(jsonb_array_length(public.inv_datos()->'metodos_pago') = 6, 'trae 6 métodos de pago');
select t_espera_error($q$select public.inv_guardar('bodegas', '{"nombre":"Bodega Lima","ciudad":"Lima","pais":"Perú"}')$q$, 'no está en Países');
select t_espera_error($q$select public.inv_guardar('paises', '{"nombre":"Perú","moneda":"PEN"}')$q$, 'cuántos pesos');
select public.inv_guardar('paises', '{"nombre":"Perú","moneda":"PEN","tasa":1100}');
select t_espera_error($q$select public.inv_guardar('paises', '{"nombre":"perú","moneda":"PEN","tasa":1}')$q$, 'Ya existe ese país');
select public.inv_guardar('bodegas', '[{"nombre":"Bodega Bogotá","ciudad":"Bogotá","pais":"Colombia"},{"nombre":"Bodega Lima","ciudad":"Lima","pais":"Perú"}]');
select public.inv_guardar('productos', '[{"codigo":"LIB-001","nombre":"Libro","precios":{"Colombia":60000,"Perú":60}},{"codigo":"KIT-001","nombre":"Kit","precios":{"Colombia":120000}}]');
select t_ok((select p->'precios' = '{"Colombia": 60000, "Perú": 60}'::jsonb from jsonb_array_elements(public.inv_datos()->'productos') p where p->>'codigo' = 'LIB-001'), 'cada país con su precio');
select t_espera_error($q$select public.inv_guardar('productos', '{"codigo":"KIT-001","nombre":"Kit","precios":{"Chile":5}}')$q$, 'no está en Países');
select t_espera_error(format($q$select public.inv_guardar('productos', '{"id":"%s","codigo":"lib-001","nombre":"Kit"}')$q$, (select id from inventario.productos where codigo = 'KIT-001')), 'Ya hay un producto');
-- mismo código sin id = actualiza (carga desde Excel)
select public.inv_guardar('productos', '{"codigo":"LIB-001","nombre":"Libro Método JDT"}');
reset role;
select t_ok((select count(*) = 2 from inventario.productos), 'el código repetido actualiza, no duplica');
select t_ok((select nombre = 'Libro Método JDT' from inventario.productos where codigo = 'LIB-001'), 'nombre actualizado');

-- 4. Compras: costo promedio (una en USD)
set role authenticated;
select public.inv_registrar(jsonb_build_object('tipo','compra','destino_id',(select id from inventario.bodegas where nombre='Bodega Bogotá'),
  'proveedor_nuevo','Editorial Andina','items',jsonb_build_array(jsonb_build_object('producto_id',(select id from inventario.productos where codigo='LIB-001'),'cantidad',10,'valor_unitario',20000))));
select public.inv_registrar(jsonb_build_object('tipo','compra','destino_id',(select id from inventario.bodegas where nombre='Bodega Bogotá'),
  'proveedor_nuevo','editorial andina','moneda','USD','tasa',4000,'items',jsonb_build_array(jsonb_build_object('producto_id',(select id from inventario.productos where codigo='LIB-001'),'cantidad',10,'valor_unitario',7.5))));
reset role;
select t_ok((select count(*) = 1 from inventario.proveedores), 'proveedor nuevo no se duplica');
select t_ok((select costo_promedio = 25000 from inventario.producto_costos c join inventario.productos p on p.id = c.producto_id where p.codigo='LIB-001'), 'costo promedio 25.000 (20.000 y 30.000)');
select t_ok((select cantidad = 20 from inventario.stock), 'stock 20 en Bogotá');

-- 5. Crear usuarios
set role authenticated;
select public.inv_usuario_crear('{"usuario":"carlos","nombre":"Carlos Rojas","password":"clave-segura","rol":"monitor","ciudad":"Bogotá","pais":"Colombia"}');
-- jheiner ya existe en el call center: se vincula sin contraseña nueva
select t_espera_error($q$select public.inv_usuario_crear('{"usuario":"jheiner","nombre":"Jheiner P","rol":"monitor"}')$q$, 'país de su maleta');
select t_ok((public.inv_usuario_crear('{"usuario":"jheiner","nombre":"Jheiner P","rol":"monitor","ciudad":"Lima","pais":"Perú"}')->>'existente')::boolean, 'usuario del call center se vincula (misma contraseña)');
select t_espera_error($q$select public.inv_usuario_crear('{"usuario":"leidy","nombre":"Leidy","rol":"admin"}')$q$, 'ya está en el inventario');
select t_espera_error($q$select public.inv_usuario_crear('{"usuario":"Ana María","nombre":"Ana María","password":"12345678","rol":"monitor","pais":"Colombia"}')$q$, 'sin espacios');
select t_espera_error($q$select public.inv_usuario_crear('{"usuario":"ana","nombre":"Ana Díaz","password":"123","rol":"monitor","pais":"Colombia"}')$q$, 'al menos 8');
reset role;
select t_ok(exists (select 1 from public.profiles where email = 'jheiner@jdt.local'), 'el perfil de jheiner en el call center sigue igual');
select t_ok((select raw_app_meta_data->>'sistema' = 'inventario' from auth.users where email = 'carlos@jdt.local'), 'carlos queda marcado como del inventario');
select t_ok(not exists (select 1 from public.profiles where email = 'carlos@jdt.local'), 'carlos NO tiene perfil en el call center');
select t_ok(exists (select 1 from public.profiles where email = 'leidy@jdt.local'), 'el perfil de leidy en el call center sigue igual');
select t_ok((select count(*) = 1 from inventario.bodegas where tipo = 'monitor' and nombre = 'Maleta Carlos Rojas'), 'carlos tiene su maleta');

-- 6. Admin (leidy) no crea admins ni toca a otros admins
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select t_espera_error($q$select public.inv_usuario_crear('{"usuario":"german","nombre":"German X","password":"12345678","rol":"admin"}')$q$, 'Solo el superadmin');
select t_espera_error($q$select public.inv_usuario_cambiar(jsonb_build_object('id','00000000-0000-0000-0000-00000000000a','activo',false))$q$, 'no se cambia aquí');
select t_espera_error($q$select public.inv_usuario_cambiar(jsonb_build_object('id','00000000-0000-0000-0000-00000000000b','password','otra-clave-1'))$q$, 'no se cambia aquí');
-- 7. Entrega a la maleta de carlos
select public.inv_registrar(jsonb_build_object('tipo','entrega','origen_id',(select id from inventario.bodegas where nombre='Bodega Bogotá'),
  'destino_id',(select id from inventario.bodegas where nombre='Maleta Carlos Rojas'),'items',jsonb_build_array(jsonb_build_object('producto_id',(select id from inventario.productos where codigo='LIB-001'),'cantidad',5))));
reset role;
select t_ok((select cantidad = 15 from inventario.stock s join inventario.bodegas b on b.id = s.bodega_id where b.nombre = 'Bodega Bogotá'), 'Bogotá queda con 15');

-- 8. Monitor vende de su maleta
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'carlos@jdt.local'), false);
set role authenticated;
select t_ok(public.inv_datos()->'costos' = '{}'::jsonb, 'monitor no ve costos');
select t_ok((select bool_and((i->>'costo_unitario')::numeric = 0) from jsonb_array_elements(public.inv_datos()->'movimientos') m, jsonb_array_elements(m->'items') i), 'monitor no ve costo en los movimientos');
select t_ok(jsonb_array_length(public.inv_datos()->'bodegas') = 1, 'monitor solo ve su maleta');
select t_ok(jsonb_array_length(public.inv_datos()->'proveedores') = 0, 'monitor no ve proveedores');
select t_espera_error(format($q$select public.inv_registrar('{"tipo":"venta","origen_id":"%s","curso":"Bogotá","items":[{"producto_id":"%s","cantidad":2,"valor_unitario":60000}]}')$q$,
  (select id from inventario.bodegas where nombre='Maleta Carlos Rojas'), (select id from inventario.productos where codigo='LIB-001')), 'cómo pagó');
select t_espera_error(format($q$select public.inv_registrar('{"tipo":"venta","origen_id":"%s","metodo_pago_id":1,"items":[{"producto_id":"%s","cantidad":6,"valor_unitario":60000}]}')$q$,
  (select id from inventario.bodegas where nombre='Maleta Carlos Rojas'), (select id from inventario.productos where codigo='LIB-001')), 'No hay suficiente');
select t_espera_error(format($q$select public.inv_registrar('{"tipo":"venta","origen_id":"%s","metodo_pago_id":1,"items":[{"producto_id":"%s","cantidad":1,"valor_unitario":60000}]}')$q$,
  (select id from inventario.bodegas where nombre='Bodega Bogotá'), (select id from inventario.productos where codigo='LIB-001')), 'ventas de tu maleta');
select public.inv_registrar(format('{"tipo":"venta","origen_id":"%s","metodo_pago_id":2,"curso":"Bogotá 7-8 nov","items":[{"producto_id":"%s","cantidad":5,"valor_unitario":60000}]}',
  (select id from inventario.bodegas where nombre='Maleta Carlos Rojas'), (select id from inventario.productos where codigo='LIB-001'))::jsonb);
select t_espera_error('select public.inv_anular(1001)', 'No tienes permiso');
reset role;
select t_ok(not exists (select 1 from inventario.stock s join inventario.bodegas b on b.id = s.bodega_id where b.tipo = 'monitor'), 'maleta vacía: la fila en 0 se borró');
select t_ok((select costo_unitario = 25000 from inventario.movimiento_items i join inventario.movimientos m on m.id = i.movimiento_id where m.tipo='venta'), 'la venta guarda el costo del momento');
select t_ok((select moneda = 'COP' and tasa = 1 from inventario.movimientos where tipo='venta'), 'venta en Colombia va en pesos');

-- 9. Venta en oficina (desde bodega, por un admin)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select public.inv_registrar(format('{"tipo":"venta","origen_id":"%s","metodo_pago_id":5,"items":[{"producto_id":"%s","cantidad":1,"valor_unitario":60000}]}',
  (select id from inventario.bodegas where nombre='Bodega Bogotá'), (select id from inventario.productos where codigo='LIB-001'))::jsonb);
-- 10. Anular: la entrega ya se vendió → no deja; la venta sí
select t_espera_error(format('select public.inv_anular(%s)', (select id from inventario.movimientos where tipo='entrega')), 'ya salió');
select public.inv_anular((select id from inventario.movimientos where tipo='venta' and origen_id = (select id from inventario.bodegas where nombre='Maleta Carlos Rojas')));
select t_espera_error(format('select public.inv_anular(%s)', (select id from inventario.movimientos where tipo='venta' and anulado)), 'ya está anulado');
reset role;
select t_ok((select cantidad = 5 from inventario.stock s join inventario.bodegas b on b.id = s.bodega_id where b.tipo = 'monitor'), 'al anular la venta vuelven 5 a la maleta');

-- 11. Varios movimientos juntos: si uno falla, no queda ninguno
set role authenticated;
select t_espera_error(format($q$select public.inv_registrar('[{"tipo":"ajuste_entrada","destino_id":"%1$s","items":[{"producto_id":"%2$s","cantidad":3}]},{"tipo":"ajuste_salida","origen_id":"%1$s","items":[{"producto_id":"%2$s","cantidad":999}]}]')$q$,
  (select id from inventario.bodegas where nombre='Bodega Lima'), (select id from inventario.productos where codigo='LIB-001')), 'No hay suficiente');
reset role;
select t_ok(not exists (select 1 from inventario.stock s join inventario.bodegas b on b.id = s.bodega_id where b.nombre = 'Bodega Lima'), 'todo o nada: el ajuste no quedó');

-- 12. Anular compra devuelve el costo anterior
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.inv_registrar(jsonb_build_object('tipo','compra','destino_id',(select id from inventario.bodegas where nombre='Bodega Lima'),
  'proveedor_id',(select id from inventario.proveedores limit 1),'items',jsonb_build_array(jsonb_build_object('producto_id',(select id from inventario.productos where codigo='LIB-001'),'cantidad',20,'valor_unitario',40000))));
select public.inv_anular((select max(id) from inventario.movimientos));
reset role;
select t_ok((select round(costo_promedio) = 25000 from inventario.producto_costos c join inventario.productos p on p.id = c.producto_id where p.codigo='LIB-001'), 'anular la compra deja el costo en 25.000');

-- 13. Bodega con mercancía no se desactiva
set role authenticated;
select t_espera_error(format($q$select public.inv_guardar('bodegas', '{"id":"%s","activa":false}')$q$, (select id from inventario.bodegas where nombre='Bodega Bogotá')), 'todavía tiene mercancía');
-- 14. Contraseñas y acceso
select public.inv_usuario_cambiar(jsonb_build_object('id',(select id from inventario.perfiles where usuario='carlos'),'password','nueva-clave-9'));
select t_espera_error($q$select public.inv_usuario_cambiar(jsonb_build_object('id','00000000-0000-0000-0000-00000000000b','password','nueva-clave-9'))$q$, 'call center');
select public.inv_usuario_cambiar(jsonb_build_object('id',(select id from inventario.perfiles where usuario='carlos'),'activo',false));
reset role;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'carlos@jdt.local'), false);
set role authenticated;
select t_espera_error('select public.inv_datos()', 'No tienes acceso');
reset role;
select t_ok(true, 'monitor desactivado ya no entra');

-- 17. Venta en otro país: va en su moneda y con su tasa; el dinero del monitor también
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.inv_registrar(jsonb_build_object('tipo','ajuste_entrada','destino_id',(select id from inventario.bodegas where nombre='Bodega Lima'),
  'items',jsonb_build_array(jsonb_build_object('producto_id',(select id from inventario.productos where codigo='LIB-001'),'cantidad',4))));
-- aunque la página mande otra moneda, la venta va en la del país
select public.inv_registrar(jsonb_build_object('tipo','venta','origen_id',(select id from inventario.bodegas where nombre='Bodega Lima'),'metodo_pago_id',1,
  'moneda','COP','tasa',1,'items',jsonb_build_array(jsonb_build_object('producto_id',(select id from inventario.productos where codigo='LIB-001'),'cantidad',2,'valor_unitario',60))));
select public.inv_pago(jsonb_build_object('bodega_id',(select id from inventario.bodegas where nombre='Maleta Jheiner P'),'valor',120));
select public.inv_guardar('paises', '{"id":"Perú","nombre":"Peru","moneda":"PEN","tasa":1150}');
select t_espera_error($q$select public.inv_guardar('paises', '{"id":"Colombia","nombre":"Colombia","moneda":"COP","tasa":5}')$q$, 'tasa');
reset role;
select t_ok((select moneda = 'PEN' and tasa = 1100 from inventario.movimientos where tipo='venta' and origen_id = (select id from inventario.bodegas where nombre='Bodega Lima')), 'venta en Perú va en soles con su tasa');
select t_ok((select moneda = 'PEN' from inventario.pagos), 'el dinero del monitor de Perú va en soles');
select t_ok((select count(*) = 2 from inventario.bodegas where pais = 'Peru') and exists (select 1 from inventario.precios where pais = 'Peru'), 'renombrar el país cambia bodegas y precios');
select t_ok((select tasa = 1 from inventario.paises where nombre = 'Colombia'), 'el peso siempre vale 1');

-- 15. Nadie entra a las tablas directo
revoke select on all tables in schema inventario from authenticated;
alter role authenticated nobypassrls;
set role authenticated;
select t_espera_error('select * from inventario.productos', 'permission denied');
select t_espera_error('select inventario.yo()', 'permission denied');
reset role;
select t_ok(true, 'las tablas y funciones internas están cerradas');

-- 16. Métodos de pago editables
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.inv_guardar('metodos_pago', '{"nombre":"Tarjeta Visa"}');
select t_espera_error($q$select public.inv_guardar('metodos_pago', '{"nombre":"tarjeta visa"}')$q$, 'Ya existe');
reset role;
select t_ok((select count(*) = 7 from inventario.metodos_pago), 'método de pago agregado');
-- 16b. Métodos de pago por país (2026-11-11): el mismo nombre puede estar en dos países; la venta solo acepta los de su país
select public.inv_guardar('metodos_pago', '{"nombre":"Yape","pais":"Colombia"}');
select t_espera_error($q$select public.inv_guardar('metodos_pago', '{"nombre":"yape","pais":"Colombia"}')$q$, 'Ya existe');
select public.inv_guardar('metodos_pago', '{"nombre":"Yape"}');
select t_ok((select count(*) = 2 from inventario.metodos_pago where nombre = 'Yape'), 'mismo nombre en dos países');
select t_ok((select bool_and(m ? 'pais') from jsonb_array_elements(public.inv_datos()->'metodos_pago') m), 'los métodos traen su país');
select public.inv_guardar('metodos_pago', '{"nombre":"Plin","pais":"Peru"}');
select t_espera_error(format($q$select public.inv_registrar('{"tipo":"venta","origen_id":"%s","metodo_pago_id":%s,"items":[{"producto_id":"%s","cantidad":1,"valor_unitario":60000}]}')$q$,
  (select id from inventario.bodegas where nombre='Bodega Bogotá'), (select id from inventario.metodos_pago where nombre='Plin'), (select id from inventario.productos where codigo='LIB-001')), 'cómo pagó');
select t_ok(true, 'en Colombia no se puede vender con un método de Perú');

-- 16c. Compra sin costo (2026-11-11): entra la mercancía y el costo promedio no cambia
create temp table t_costo as select costo_promedio from inventario.producto_costos c join inventario.productos p on p.id = c.producto_id where p.codigo='LIB-001';
select public.inv_registrar(jsonb_build_object('tipo','compra','destino_id',(select id from inventario.bodegas where nombre='Bodega Bogotá'),
  'proveedor_nuevo','Sin proveedor','items',jsonb_build_array(jsonb_build_object('producto_id',(select id from inventario.productos where codigo='LIB-001'),'cantidad',4,'valor_unitario',0))));
select t_ok((select c.costo_promedio = (select costo_promedio from t_costo) from inventario.producto_costos c join inventario.productos p on p.id = c.producto_id where p.codigo='LIB-001'), 'compra sin costo no cambia el costo promedio');
select public.inv_anular((select max(id) from inventario.movimientos where tipo = 'compra'));
select t_ok((select c.costo_promedio = (select costo_promedio from t_costo) from inventario.producto_costos c join inventario.productos p on p.id = c.producto_id where p.codigo='LIB-001'), 'anular la compra sin costo tampoco lo cambia');

\echo TODAS LAS PRUEBAS PASARON
