-- =====================================================================
-- Tests de la fase 0: RLS, revocaciones y resolución de rol.
-- Se corren con tests/sql/correr.sh sobre un Postgres local.
-- Cada chequeo imprime "ok · ..." o corta con "FALLA · ...".
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

\i tests/sql/_helpers.sql

-- Datos de prueba cargados como dueño (simula lo que harán las RPC)
insert into public.ventas (id, evento_id, canal, rrpp_id, tanda_id, titular_nombre, titular_dni,
                           cantidad, precio_unitario, total, comision_unitaria, medio, creada_por)
values ('00000000-0000-4000-8000-0000000000b1', :evento, 'rrpp', :lucia,  :anticip, 'Ana Pérez',  '30111222', 2, 20000, 40000, 750, 'efectivo',      :lucia),
       ('00000000-0000-4000-8000-0000000000b2', :evento, 'rrpp', :martin, :anticip, 'Juan Díaz',  '31222333', 1, 20000, 20000,   0, 'transferencia', :martin);
insert into public.entradas (evento_id, venta_id, nro, codigo) values
  (:evento, '00000000-0000-4000-8000-0000000000b1', 1, privado.nuevo_codigo()),
  (:evento, '00000000-0000-4000-8000-0000000000b1', 2, privado.nuevo_codigo()),
  (:evento, '00000000-0000-4000-8000-0000000000b2', 1, privado.nuevo_codigo());
insert into public.movimientos_rrpp (evento_id, rrpp_id, tipo, monto, registrado_por)
values (:evento, :lucia, 'entrega_efectivo', 20000, :admin),
       (:evento, :martin, 'entrega_efectivo', 5000, :admin);
insert into public.auditoria (evento_id, usuario_id, accion) values (:evento, :admin, 'prueba');
insert into public.intentos_link (link_hash, intentos) values ('abc', 1);

\echo
\echo '== Catálogo: RLS, privilegios y funciones'

select pruebas.ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'RLS activado en todas las tablas de public');

select pruebas.ok(
  not exists (
    select 1 from pg_tables t,
      unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where t.schemaname = 'public'
      and has_table_privilege('anon', format('public.%I', t.tablename), p)),
  'anon no tiene ningún privilegio sobre ninguna tabla');

select pruebas.ok(
  not exists (
    select 1 from pg_tables t,
      unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where t.schemaname = 'public'
      and has_table_privilege('authenticated', format('public.%I', t.tablename), p)),
  'authenticated no puede escribir ninguna tabla');

select pruebas.ok(
  not has_table_privilege('authenticated', 'public.secretos_evento', 'SELECT')
  and not has_table_privilege('authenticated', 'public.intentos_link', 'SELECT'),
  'secretos_evento e intentos_link no se leen ni con sesión');

select pruebas.ok(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','privado') and has_function_privilege('anon', p.oid, 'EXECUTE'))
  = array['evento_del_link','pasar_entrada','ver_entrada_pasada','ver_entradas'],
  'anon solo puede ejecutar las 4 funciones de la página del comprador');

select pruebas.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'privado'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.proname not in ('rol_actual','es_admin')),
  'authenticated no ejecuta helpers internos (salvo los de lectura de rol)');

select pruebas.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (not p.prosecdef or not coalesce(p.proconfig, '{}') @> array['search_path=public'])),
  'toda función RPC es SECURITY DEFINER con search_path = public');

select pruebas.ok(
  (select bool_and(c ~ '^[A-Z2-7]{26}$') and count(distinct c) = 1000
   from (select privado.nuevo_codigo() c from generate_series(1, 1000)) x),
  'códigos de 128 bits en base32 (26 caracteres), 1.000 distintos');

select pruebas.ok(privado.base32('\x666f6f626172'::bytea) = 'MZXW6YTBOI',
  'base32 coincide con RFC 4648 ("foobar" → MZXW6YTBOI)');

\echo
\echo '== anon (sin sesión)'
set role anon;
select pruebas.como(null);

do $$
declare t record; col text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' order by 1 loop
    select a.attname into col from pg_attribute a
    where a.attrelid = format('public.%I', t.tablename)::regclass and a.attnum = 1;
    perform pruebas.falla(format('select * from public.%I', t.tablename), '42501', format('anon no lee %s', t.tablename));
    perform pruebas.falla(format('insert into public.%I default values', t.tablename), '42501', format('anon no inserta en %s', t.tablename));
    perform pruebas.falla(format('update public.%I set %I = %I', t.tablename, col, col), '42501', format('anon no modifica %s', t.tablename));
    perform pruebas.falla(format('delete from public.%I', t.tablename), '42501', format('anon no borra %s', t.tablename));
  end loop;
end $$;

select pruebas.falla($$select public.anular_venta(gen_random_uuid(), 'x')$$, '42501', 'anon no puede llamar RPC de admin');
select pruebas.falla($$select public.emitir_venta(gen_random_uuid(), 'a', '12345678', null, 1, 'efectivo')$$, '42501', 'anon no puede emitir');
select pruebas.falla($$select public.mi_perfil()$$, '42501', 'anon no puede pedir perfil');
select pruebas.falla($$select privado.rol_actual()$$, '42501', 'anon no ve el schema privado');
select pruebas.ok(public.ver_entradas('x', '12345678') ->> 'ok' = 'false', 'anon sí llega a ver_entradas (y con un link inválido no ve nada)');
reset role;

\echo
\echo '== authenticated sin perfil'
set role authenticated;
select pruebas.como('00000000-0000-4000-8000-00000000ffff');
select pruebas.ok(pruebas.cuenta('select * from public.ventas') = 0, 'sin perfil no ve ventas');
select pruebas.ok(pruebas.cuenta('select * from public.eventos') = 0, 'sin perfil no ve eventos');
select pruebas.falla($$select public.mi_perfil()$$, 'P0001', 'sin perfil no tiene rol', 'usuario_inactivo');
select pruebas.como(null);
select pruebas.falla($$select public.mi_perfil()$$, 'P0001', 'sin sub en el token: pide ingresar', 'sin_sesion');
reset role;

\echo
\echo '== RRPP (Lucía)'
set role authenticated;
select pruebas.como(:lucia);
select pruebas.ok((select rol from public.mi_perfil()) = 'rrpp', 'el rol sale de perfiles por auth.uid()');
select pruebas.ok(pruebas.cuenta('select * from public.perfiles') = 1, 've solo su perfil');
select pruebas.ok(pruebas.cuenta('select * from public.ventas') = 1, 've solo sus ventas');
select pruebas.ok(pruebas.cuenta('select * from public.entradas') = 2, 've solo las entradas de sus ventas');
select pruebas.ok(pruebas.cuenta('select * from public.movimientos_rrpp') = 1, 've solo sus movimientos');
select pruebas.ok(pruebas.cuenta('select * from public.rrpp_evento') = 1, 've solo sus condiciones');
select pruebas.ok(pruebas.cuenta('select * from public.auditoria') = 0, 'no ve auditoría');
select pruebas.ok(pruebas.cuenta('select * from public.config_club') = 0, 'no lee config_club directo');
select pruebas.ok(pruebas.cuenta('select * from public.tandas') = 3, 've las tandas');
select pruebas.ok((select alias from public.datos_transferencia()) = 'CLUB.MITRE.PRUEBA', 've los datos de transferencia por RPC');
select pruebas.falla($$select * from public.secretos_evento$$, '42501', 'no lee la sal del evento');
select pruebas.falla($$update public.perfiles set rol = 'admin'$$, '42501', 'no puede cambiarse el rol');
select pruebas.falla($$update public.ventas set precio_unitario = 1$$, '42501', 'no puede tocar el precio');
select pruebas.falla($$update public.rrpp_evento set comision_por_entrada = 99999$$, '42501', 'no puede tocar su comisión');
select pruebas.falla($$insert into public.ventas (evento_id, canal, titular_nombre, cantidad, precio_unitario, total, medio)
                      values ('00000000-0000-4000-8000-0000000000e1', 'cortesia', 'x', 1, 0, 0, 'cortesia')$$, '42501', 'no puede insertar ventas directo');
select pruebas.falla($$select public.anular_venta('00000000-0000-4000-8000-0000000000b1', 'x')$$, 'P0001', 'no puede anular', 'sin_permiso');
select pruebas.falla($$select public.descargar_lista_puerta('00000000-0000-4000-8000-0000000000e1')$$, 'P0001', 'no puede bajar la lista de puerta', 'sin_permiso');
select pruebas.falla($$select public.emitir_venta(null, 'Ana', '30111222', null, 1, 'efectivo')$$, 'P0001', 'emitir_venta pasa el control de rol', 'datos');
-- Un rol inventado en el token no cambia nada
select set_config('request.jwt.claims', json_build_object('sub', :lucia, 'role', 'authenticated', 'user_role', 'admin', 'rol', 'admin')::text, false);
select pruebas.falla($$select public.anular_venta('00000000-0000-4000-8000-0000000000b1', 'x')$$, 'P0001', 'un rol "admin" mandado en el token se ignora', 'sin_permiso');
reset role;

\echo
\echo '== Puerta'
set role authenticated;
select pruebas.como(:puerta1);
select pruebas.ok(pruebas.cuenta('select * from public.ventas') = 0, 'puerta no lee ventas directo');
select pruebas.ok(pruebas.cuenta('select * from public.entradas') = 0, 'puerta no lee entradas directo');
select pruebas.falla($$select * from public.datos_transferencia()$$, 'P0001', 'puerta no ve datos de transferencia', 'sin_permiso');
select pruebas.falla($$select public.venta_puerta(gen_random_uuid(), 1, 'efectivo')$$, 'P0001', 'puerta no vende', 'sin_permiso');
select pruebas.ok(public.descargar_lista_puerta('00000000-0000-4000-8000-0000000000e1') ? 'entradas', 'puerta pasa el control de rol de la lista');
reset role;

\echo
\echo '== Caja'
set role authenticated;
select pruebas.como(:caja);
select pruebas.ok(pruebas.cuenta('select * from public.ventas') = 0, 'caja no lee ventas directo');
select pruebas.ok((select alias from public.datos_transferencia()) = 'CLUB.MITRE.PRUEBA', 'caja ve los datos de transferencia');
select pruebas.falla($$select public.registrar_ingresos('[]'::jsonb)$$, 'P0001', 'caja no registra ingresos', 'sin_permiso');
select pruebas.falla($$select public.venta_puerta(null, 1, 'efectivo')$$, 'P0001', 'caja pasa el control de rol', 'datos');
reset role;

\echo
\echo '== Admin'
set role authenticated;
select pruebas.como(:admin);
select pruebas.ok(pruebas.cuenta('select * from public.ventas') = 2, 'admin ve todas las ventas');
select pruebas.ok(pruebas.cuenta('select * from public.perfiles') = 7, 'admin ve todos los perfiles');
select pruebas.ok(pruebas.cuenta('select * from public.auditoria') = 1, 'admin ve la auditoría');
select pruebas.ok(pruebas.cuenta('select * from public.config_club') = 1, 'admin lee config_club');
select pruebas.falla($$select * from public.secretos_evento$$, '42501', 'ni el admin lee la sal directo');
select pruebas.falla($$update public.eventos set tope_entradas = 1$$, '42501', 'admin tampoco escribe directo (usa RPC)');
select pruebas.ok(public.anular_venta('00000000-0000-4000-8000-0000000000b1', 'x') ->> 'estado' = 'anulada', 'admin pasa el control de rol (y puede anular)');
reset role;

\echo
\echo '== Usuario desactivado'
update public.perfiles set activo = false where user_id = :martin;
set role authenticated;
select pruebas.como(:martin);
select pruebas.falla($$select public.mi_perfil()$$, 'P0001', 'desactivado: bloqueado al instante en RPC', 'usuario_inactivo');
select pruebas.ok(pruebas.cuenta('select * from public.ventas') = 0, 'desactivado: no ve ni sus ventas');
select pruebas.ok(pruebas.cuenta('select * from public.perfiles') = 0, 'desactivado: no ve su perfil');
reset role;
update public.perfiles set activo = true where user_id = :martin;

\echo
\echo '== Cambio de contraseña'
select pruebas.ok((select debe_cambiar_clave from public.perfiles where user_id = :sofia), 'usuario nuevo debe cambiar la clave');
update auth.users set encrypted_password = extensions.crypt('otraClave99', extensions.gen_salt('bf')) where id = :sofia;
select pruebas.ok(not (select debe_cambiar_clave from public.perfiles where user_id = :sofia), 'al cambiar la clave se apaga el aviso');

\echo
\echo 'Fase 0: todos los chequeos pasaron.'
