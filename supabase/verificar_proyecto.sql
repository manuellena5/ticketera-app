-- =====================================================================
-- VERIFICACIÓN DEL PROYECTO (solo lectura: no cambia nada).
-- Correr en el SQL Editor después de las migraciones y de
-- configuracion_inicial.sql. Cada fila tiene que decir ✅.
-- =====================================================================
with funciones as (
  select p.proname, p.prosecdef, coalesce(p.proconfig, '{}') as conf, p.oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
), chequeos(orden, chequeo, ok, detalle) as (
  select 1, 'Migraciones: las 40 funciones de la app',
         (select count(*) from funciones) >= 40,
         (select count(*) from funciones)::text || ' funciones en public'
  union all
  select 2, 'RLS activado en todas las tablas',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
         coalesce((select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'todas con RLS')
  union all
  select 3, 'anon no tiene permisos sobre ninguna tabla',
         not exists (select 1 from pg_tables t, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr
                     where t.schemaname = 'public' and has_table_privilege('anon', format('public.%I', t.tablename), pr)),
         'select/insert/update/delete/truncate'
  union all
  select 4, 'Los usuarios con sesión no escriben tablas (todo por funciones)',
         not exists (select 1 from pg_tables t, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) pr
                     where t.schemaname = 'public' and has_table_privilege('authenticated', format('public.%I', t.tablename), pr)),
         'insert/update/delete/truncate'
  union all
  select 5, 'anon solo ejecuta las funciones del comprador y ping',
         (select coalesce(array_agg(proname::text order by proname), '{}') from funciones where has_function_privilege('anon', oid, 'EXECUTE'))
           = array['evento_del_link','pasar_entrada','ping','ver_entrada_pasada','ver_entradas'],
         (select string_agg(proname, ', ' order by proname) from funciones where has_function_privilege('anon', oid, 'EXECUTE'))
  union all
  select 6, 'Toda función es SECURITY DEFINER con search_path fijo',
         not exists (select 1 from funciones where not prosecdef or not conf @> array['search_path=public']),
         coalesce((select string_agg(proname, ', ') from funciones where not prosecdef or not conf @> array['search_path=public']), 'todas')
  union all
  select 7, 'Alta de usuarios solo para la service role',
         not has_function_privilege('authenticated', 'public.admin_registrar_usuario(uuid, uuid, text, text, text, text, text)', 'EXECUTE')
         and has_function_privilege('service_role', 'public.admin_registrar_usuario(uuid, uuid, text, text, text, text, text)', 'EXECUTE'),
         'admin_registrar_usuario / admin_clave_temporal'
  union all
  select 8, 'Los clientes no pueden crear objetos en public',
         not has_schema_privilege('anon', 'public', 'CREATE') and not has_schema_privilege('authenticated', 'public', 'CREATE'),
         'migración 0008'
  union all
  select 9, 'Aviso de cambio de contraseña (trigger en auth.users)',
         exists (select 1 from pg_trigger where tgname = 'perfiles_clave_cambiada' and tgrelid = 'auth.users'::regclass),
         'perfiles_clave_cambiada'
  union all
  select 10, 'Hash del código guardado e indexado (puerta)',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entradas' and column_name = 'codigo_hash'),
         'entradas.codigo_hash'
  union all
  select 11, 'Primer admin activo',
         exists (select 1 from public.perfiles p join auth.users u on u.id = p.user_id where p.rol = 'admin' and p.activo),
         coalesce((select string_agg(p.usuario, ', ') from public.perfiles p where p.rol = 'admin'), 'no hay admin: correr configuracion_inicial.sql')
  union all
  select 12, 'Evento cargado',
         (select count(*) from public.eventos) >= 1,
         coalesce((select e.nombre || ' · ' || e.estado || ' · tope ' || e.tope_entradas from public.eventos e order by e.creado_en limit 1), 'sin evento')
  union all
  select 13, 'Tandas del evento',
         (select count(*) from public.tandas) >= 1,
         coalesce((select string_agg(t.nombre || ' ' || t.canal || ' $' || t.precio::int, ' · ' order by t.orden) from public.tandas t), 'sin tandas')
  union all
  select 14, 'Sal del evento (búsqueda por DNI en la puerta)',
         not exists (select 1 from public.eventos e where not exists (select 1 from public.secretos_evento s where s.evento_id = e.id)),
         'secretos_evento'
  union all
  select 15, 'Configuración del club',
         exists (select 1 from public.config_club where id = 1),
         coalesce((select case when transf_alias is null then 'falta cargar los datos para transferir (desde el panel)' else 'alias ' || transf_alias end
                   from public.config_club where id = 1), 'sin fila')
  union all
  select 16, 'Sin datos de prueba (seed.sql no se corrió)',
         not exists (select 1 from public.perfiles where usuario in ('lucia', 'martin', 'sofia', 'puerta1', 'puerta2', 'caja')
                     and user_id::text like '00000000-0000-4000-8000-%'),
         'usuarios de prueba'
)
select case when ok then '✅' else '❌' end as estado, chequeo, detalle
from chequeos order by orden;
