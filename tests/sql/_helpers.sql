-- Helpers comunes de los tests SQL (se incluyen con \i).
-- ---------------------------------------------------------------------
-- Helpers de test (solo existen en la base de pruebas)
-- ---------------------------------------------------------------------
create schema pruebas;
grant usage on schema pruebas to anon, authenticated;

create function pruebas.ok(p_cond boolean, p_desc text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FALLA · %', p_desc;
  end if;
  raise notice 'ok · %', p_desc;
end $$;

-- Ejecuta SQL y exige que falle con ese SQLSTATE (y, si se da, ese HINT).
create function pruebas.falla(p_sql text, p_estado text, p_desc text, p_hint text default null)
returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if sqlstate = p_estado and (p_hint is null or v_hint = p_hint) then
      raise notice 'ok · %', p_desc;
      return;
    end if;
    raise exception 'FALLA · % → error inesperado: % % (hint %)', p_desc, sqlstate, sqlerrm, v_hint;
  end;
  raise exception 'FALLA · % → se ejecutó y no tenía que poder', p_desc;
end $$;

create function pruebas.cuenta(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) x', p_sql) into n;
  return n;
end $$;

create function pruebas.como(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
                    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end,
                    false);
$$;

grant execute on all functions in schema pruebas to anon, authenticated;

-- IDs de la semilla (internos)
\set admin   '''00000000-0000-4000-8000-000000000001'''
\set lucia   '''00000000-0000-4000-8000-000000000011'''
\set martin  '''00000000-0000-4000-8000-000000000012'''
\set sofia   '''00000000-0000-4000-8000-000000000013'''
\set puerta1 '''00000000-0000-4000-8000-000000000021'''
\set caja    '''00000000-0000-4000-8000-000000000031'''
\set evento  '''00000000-0000-4000-8000-0000000000e1'''
\set anticip '''00000000-0000-4000-8000-0000000000a1'''

