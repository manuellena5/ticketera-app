-- =====================================================================
-- Registro de errores técnicos.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

\i tests/sql/_helpers.sql

\echo
\echo '== Registrar errores'
set role anon;
select pruebas.como(null);
select public.registrar_error(jsonb_build_object(
  'origen', 'comprador', 'pantalla', 'entradas', 'mensaje', 'TypeError: x is undefined en ABCDEFGHIJKLMNOPQRSTUVWXYZ dni 30111222',
  'pagina', 'https://x.github.io/ticketera-app/entrada.html#t=ABCDEFGHIJKLMNOPQRSTUV2345',
  'detalle', jsonb_build_object('stack', 'at entrada.js:10 token MZXW6YTBOIMZXW6YTBOIMZXW6Y'), 'version', '1'));
select public.registrar_error(('{"mensaje": "' || repeat('x', 3000) || '"}')::jsonb);
select public.registrar_error('null');           -- datos raros: no rompe
select public.registrar_error('{"detalle": "no es objeto"}');
select pruebas.falla($$select * from public.errores_tecnicos$$, '42501', 'anon no lee la tabla de errores');
select pruebas.falla($$select public.errores_admin()$$, '42501', 'anon no ve los errores');
reset role;
select pruebas.ok((select count(*) from errores_tecnicos) = 4, 'se guardan aunque vengan datos raros, sin romper');
select pruebas.ok((select bool_and(usuario_id is null) from errores_tecnicos), 'sin sesión: sin usuario');
select pruebas.ok(not exists (select 1 from errores_tecnicos e
                              where e.mensaje ~ '[A-Z2-7]{26}' or e.mensaje ~ '30111222' or e.pagina ~ '#t=' or e.detalle::text ~ '[A-Z2-7]{26}'),
                  'no guarda tokens, códigos, DNI ni el fragmento de la URL');
select pruebas.ok((select max(length(mensaje)) from errores_tecnicos) <= 500, 'recorta los mensajes largos');

set role authenticated;
select pruebas.como(:lucia);
select public.registrar_error('{"origen": "rpc", "pantalla": "nueva entrada", "mensaje": "PGRST301 JWT expired"}');
select pruebas.falla($$select public.errores_admin()$$, 'P0001', 'un RRPP no ve los errores', 'sin_permiso');
select pruebas.como(:admin);
select public.errores_admin() as er \gset
select pruebas.ok(jsonb_array_length(:'er'::jsonb) = 5, 'el admin ve todos los errores');
select pruebas.ok(exists (select 1 from jsonb_array_elements(:'er'::jsonb) x where x ->> 'quien' = 'Lucía Fernández' and x ->> 'rol' = 'rrpp'),
                  'con sesión: quién y con qué rol');
select pruebas.ok((public.marcar_errores_revisados(array[(:'er'::jsonb #>> '{0,ref}')::uuid]) ->> 'marcados')::int = 1, 'marcar como revisado');
select pruebas.ok(jsonb_array_length(public.errores_admin('{"pendientes": true}')) = 4, 'filtrar los pendientes');
reset role;
update errores_tecnicos set creado_en = now() - interval '40 days' where pantalla = 'entradas';
set role authenticated;
select pruebas.como(:admin);
select pruebas.ok((public.borrar_errores_viejos() ->> 'borrados')::int = 1, 'borrar los de más de 30 días');
reset role;

\echo
\echo '== Freno de errores sin sesión'
insert into errores_tecnicos (origen, mensaje) select 'app', 'relleno' from generate_series(1, 300);
set role anon;
select pruebas.como(null);
select public.registrar_error('{"mensaje": "uno más"}');
reset role;
select pruebas.ok(not exists (select 1 from errores_tecnicos where mensaje = 'uno más'), 'con 300 errores sin sesión en 5 minutos, no se guardan más');

\echo
\echo '== Edge Function'
set role service_role;
select public.registrar_error_servidor('{"origen": "edge", "mensaje": "createUser: fallo"}', '00000000-0000-4000-8000-000000000001');
reset role;
select pruebas.ok(exists (select 1 from errores_tecnicos where origen = 'edge' and rol = 'admin'), 'la Edge Function registra sus errores');

\echo
\echo 'Errores técnicos: todos los chequeos pasaron.'
