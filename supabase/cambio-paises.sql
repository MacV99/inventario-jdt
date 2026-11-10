-- Cambio 2026-11-09: cada país con su moneda y sus precios. Para la base creada antes con inventario.sql
-- (se corre una vez y después inventario.sql completo). En una base nueva no hace falta: inventario.sql ya trae todo.
create table if not exists inventario.paises (
  nombre text primary key,
  moneda text not null check (moneda ~ '^[A-Z]{3}$'),
  tasa   numeric(14,6) not null default 1 check (tasa > 0),
  check (moneda <> 'COP' or tasa = 1)
);
insert into inventario.paises (nombre, moneda) values ('Colombia', 'COP') on conflict do nothing;

alter table inventario.productos drop column if exists precio_venta;
alter table inventario.pagos add column if not exists moneda text not null default 'COP';

alter table inventario.bodegas drop constraint if exists bodegas_check1;
alter table inventario.bodegas add constraint bodegas_check1 check (tipo = 'monitor' or ciudad <> '');
alter table inventario.bodegas alter column pais drop default;
alter table inventario.bodegas drop constraint if exists bodegas_pais_fkey;
alter table inventario.bodegas add constraint bodegas_pais_fkey foreign key (pais) references inventario.paises(nombre) on update cascade;

alter table inventario.movimientos drop constraint if exists movimientos_moneda_check;
alter table inventario.movimientos add constraint movimientos_moneda_check check (moneda ~ '^[A-Z]{3}$');
