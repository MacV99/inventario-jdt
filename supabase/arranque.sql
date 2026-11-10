-- Primera vez: quién manda en el inventario (correr una sola vez, después de inventario.sql).
-- MacV = superadmin (su misma cuenta del call center). Leidy = admin (su mismo usuario «leidy» del call center).
-- German se crea desde la pantalla Usuarios (con la contraseña que elija el superadmin).
insert into inventario.perfiles (id, usuario, nombre, rol)
select id, email, 'MacV', 'superadmin' from auth.users where email = 'cuellarmigue@gmail.com'
on conflict (id) do nothing;

insert into inventario.perfiles (id, usuario, nombre, rol)
select id, 'leidy', 'Leidy', 'admin' from auth.users where email = 'leidy@jdt.local'
on conflict (id) do nothing;
