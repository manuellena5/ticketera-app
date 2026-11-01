-- =====================================================================
-- Fase 5 · Matriz de permisos: TODA función pública contra TODO rol.
-- Para cada combinación se llama la función (con argumentos nulos) y se
-- clasifica: "denegado" (sin permiso, sin sesión, usuario inactivo o sin
-- privilegio de ejecución) o "permitido" (pasó el control de rol, aunque
-- después falle por datos). Lo que pasa adentro se deshace siempre.
-- Si aparece una función nueva que no está en la tabla, el test falla:
-- obliga a decidir explícitamente quién puede usarla.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

\i tests/sql/_helpers.sql

update public.perfiles set activo = false where user_id = :martin;   -- usuario desactivado

create table pruebas.esperado (funcion text primary key, roles text[] not null);
insert into pruebas.esperado values
  ('mi_perfil',                    '{admin,rrpp,puerta,caja}'),
  ('datos_transferencia',          '{admin,rrpp,caja}'),
  ('emitir_venta',                 '{rrpp}'),
  ('inicio_rrpp',                  '{rrpp}'),
  ('marcar_enviada',               '{rrpp}'),
  ('reenviar_link',                '{rrpp,admin}'),
  ('detalle_venta',                '{rrpp,admin}'),
  ('ver_entradas',                 '{anon,admin,rrpp,puerta,caja,inactivo,sin_perfil}'),
  ('pasar_entrada',                '{anon,admin,rrpp,puerta,caja,inactivo,sin_perfil}'),
  ('ver_entrada_pasada',           '{anon,admin,rrpp,puerta,caja,inactivo,sin_perfil}'),
  ('evento_del_link',              '{anon,admin,rrpp,puerta,caja,inactivo,sin_perfil}'),
  ('ping',                         '{anon,admin,rrpp,puerta,caja,inactivo,sin_perfil}'),
  ('descargar_lista_puerta',       '{puerta}'),
  ('cambios_puerta',               '{puerta}'),
  ('registrar_ingresos',           '{puerta}'),
  ('deshacer_ingreso',             '{puerta,admin}'),
  ('venta_puerta',                 '{caja}'),
  ('caja_puerta',                  '{caja}'),
  ('contador_puerta',              '{puerta,caja,admin}'),
  ('tablero_admin',                '{admin}'),
  ('rendicion_admin',              '{admin}'),
  ('registrar_movimiento_rrpp',    '{admin}'),
  ('usuarios_admin',               '{admin}'),
  ('ajustar_rrpp',                 '{admin}'),
  ('activar_usuario',              '{admin}'),
  ('evento_admin',                 '{admin}'),
  ('ajustar_evento',               '{admin}'),
  ('ajustar_tanda',                '{admin}'),
  ('ajustar_config_club',          '{admin}'),
  ('ventas_admin',                 '{admin}'),
  ('anular_venta',                 '{admin}'),
  ('emitir_cortesia',              '{admin}'),
  ('confirmar_transferencias',     '{admin}'),
  ('auditoria_admin',              '{admin}'),
  ('exportar_admin',               '{admin}'),
  ('resumen_cierre',               '{admin}'),
  ('anonimizar_datos_personales',  '{admin}'),
  ('limpiar_intentos_link',        '{admin}'),
  ('admin_registrar_usuario',      '{}'),     -- solo service_role (Edge Function)
  ('admin_clave_temporal',         '{}');
grant usage on schema pruebas to anon, authenticated;
grant select on pruebas.esperado to anon, authenticated;

-- Llama una función con argumentos nulos y devuelve 'permitido' o 'denegado'.
create function pruebas.probar(p_oid oid) returns text
language plpgsql as $$
declare
  v_sql  text;
  v_hint text;
begin
  select format('select %s(%s)', p_oid::regproc,
                coalesce(string_agg('null::' || format_type(t, null), ', ' order by o), ''))
    into v_sql
  from pg_proc p left join lateral unnest(p.proargtypes) with ordinality as a(t, o) on true
  where p.oid = p_oid;
  begin
    execute v_sql;
    raise exception using errcode = 'PR001';          -- deshace lo que haya hecho
  exception
    when sqlstate 'PR001' then return 'permitido';
    when insufficient_privilege then return 'denegado';
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      return case when v_hint in ('sin_permiso', 'sin_sesion', 'usuario_inactivo') then 'denegado' else 'permitido' end;
  end;
end $$;
grant execute on all functions in schema pruebas to anon, authenticated;

create table pruebas.resultado (rol text, funcion text, obtenido text);
grant insert, select on pruebas.resultado to anon, authenticated;

create function pruebas.correr(p_rol text) returns void
language plpgsql as $$
declare f record;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    insert into pruebas.resultado values (p_rol, f.proname, pruebas.probar(f.oid));
  end loop;
end $$;
grant execute on all functions in schema pruebas to anon, authenticated;

\echo
\echo '== Corriendo la matriz'
set role anon;          select pruebas.como(null);                                   select pruebas.correr('anon');          reset role;
set role authenticated; select pruebas.como(:admin);                                 select pruebas.correr('admin');         reset role;
set role authenticated; select pruebas.como(:lucia);                                 select pruebas.correr('rrpp');          reset role;
set role authenticated; select pruebas.como(:puerta1);                               select pruebas.correr('puerta');        reset role;
set role authenticated; select pruebas.como(:caja);                                  select pruebas.correr('caja');          reset role;
set role authenticated; select pruebas.como(:martin);                                select pruebas.correr('inactivo');      reset role;
set role authenticated; select pruebas.como('00000000-0000-4000-8000-00000000ffff'); select pruebas.correr('sin_perfil');    reset role;

select pruebas.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname not in (select funcion from pruebas.esperado)),
  'toda función pública tiene sus roles declarados en la matriz');

do $$
declare r record; n int := 0; total int := 0;
begin
  for r in
    select x.rol, x.funcion, x.obtenido,
           case when x.rol = any (e.roles) then 'permitido' else 'denegado' end as esperado
    from pruebas.resultado x join pruebas.esperado e on e.funcion = x.funcion
    order by x.funcion, x.rol
  loop
    total := total + 1;
    if r.obtenido <> r.esperado then
      n := n + 1;
      raise notice 'FALLA · % como %: se esperaba %, dio %', r.funcion, r.rol, r.esperado, r.obtenido;
    end if;
  end loop;
  perform pruebas.ok(n = 0, format('matriz de permisos: %s combinaciones función × rol, todas como se esperaba', total));
end $$;

select pruebas.ok((select count(*) from pruebas.resultado where funcion like 'admin_%' and obtenido = 'permitido') = 0,
                  'las funciones de alta de usuarios no las ejecuta ningún cliente');
select pruebas.ok(not has_schema_privilege('authenticated', 'public', 'CREATE') and not has_schema_privilege('anon', 'public', 'CREATE'),
                  'los clientes no pueden crear objetos en public');
set role authenticated;
select pruebas.como(:lucia);
select pruebas.falla($$create table public.trucha (x int)$$, '42501', 'un usuario con sesión no puede crear tablas');
select pruebas.falla($$create function public.trucha() returns int language sql as 'select 1'$$, '42501', 'ni funciones');
reset role;

\echo
\echo 'Matriz de permisos: todos los chequeos pasaron.'
