-- =====================================================================
-- 0009 · Registro de errores técnicos
-- Guarda los errores que la persona NO ve en detalle (la pantalla sigue
-- mostrando mensajes simples): fallas de la app, de la red con el
-- servidor, de las funciones y de la Edge Function. Los lee solo el admin.
--
-- Privacidad: la app limpia antes de mandar (sin el fragmento de la URL,
-- donde viaja el token, y sin códigos de 26 caracteres ni DNI); acá se
-- vuelve a limpiar por las dudas y se recortan los largos.
-- =====================================================================

create table if not exists public.errores_tecnicos (
  id           uuid primary key default gen_random_uuid(),
  creado_en    timestamptz not null default now(),
  usuario_id   uuid,                 -- null si fue en la página pública o sin sesión
  rol          text,
  origen       text not null,        -- app | comprador | rpc | funcion | edge | js
  pantalla     text,
  mensaje      text not null,
  detalle      jsonb not null default '{}'::jsonb,
  version_app  text,
  navegador    text,
  pagina       text,                 -- sin el fragmento (#t=…)
  revisado     boolean not null default false
);
create index if not exists errores_tecnicos_fecha on public.errores_tecnicos (creado_en desc);

alter table public.errores_tecnicos enable row level security;
revoke all on public.errores_tecnicos from public, anon, authenticated;
-- Sin políticas ni grants: se escribe por registrar_error y se lee por errores_admin.

-- Limpieza de datos sensibles en un texto.
create or replace function privado.limpiar_texto(p text, p_max int)
returns text language sql immutable set search_path = public
as $$
  select left(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p, ''), '#[^\s"'']*', '#…', 'g'),      -- fragmentos de URL (tokens)
        '\m[A-Z2-7]{26}\M', '[código]', 'g'),                             -- códigos y tokens
      '\m[0-9]{7,8}\M', '[número]', 'g'),                                 -- DNI
    p_max)
$$;

create or replace function privado.limpiar_json(p jsonb)
returns jsonb language plpgsql immutable set search_path = public
as $$
declare v text;
begin
  v := privado.limpiar_texto(coalesce(p, '{}'::jsonb)::text, 4000);
  begin
    return v::jsonb;
  exception when others then
    return jsonb_build_object('texto', v);
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- registrar_error: lo llama la app (con o sin sesión). No falla nunca:
-- si algo sale mal, simplemente no guarda.
-- Freno: como mucho 300 errores sin sesión cada 5 minutos (evita que la
-- página pública se use para llenar la tabla).
-- ---------------------------------------------------------------------
create or replace function public.registrar_error(p_datos jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rol text;
begin
  if v_uid is null and (select count(*) from public.errores_tecnicos
                        where usuario_id is null and creado_en > now() - interval '5 minutes') >= 300 then
    return;
  end if;
  if v_uid is not null then
    select rol into v_rol from public.perfiles where user_id = v_uid;
  end if;
  insert into public.errores_tecnicos (usuario_id, rol, origen, pantalla, mensaje, detalle, version_app, navegador, pagina)
  values (
    v_uid, v_rol,
    left(coalesce(nullif(p_datos ->> 'origen', ''), 'app'), 20),
    privado.limpiar_texto(p_datos ->> 'pantalla', 80),
    coalesce(nullif(privado.limpiar_texto(p_datos ->> 'mensaje', 500), ''), 'Sin mensaje'),
    privado.limpiar_json(case when jsonb_typeof(p_datos -> 'detalle') = 'object' then p_datos -> 'detalle' else '{}'::jsonb end),
    left(p_datos ->> 'version', 20),
    left(p_datos ->> 'navegador', 300),
    privado.limpiar_texto(p_datos ->> 'pagina', 300));
exception when others then
  return;   -- registrar un error nunca debe romper nada
end;
$$;

-- ---------------------------------------------------------------------
-- errores_admin: últimos errores para el panel.
-- ---------------------------------------------------------------------
create or replace function public.errores_admin(p_filtros jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'ref', e.id, 'cuando', e.creado_en, 'quien', p.nombre, 'rol', e.rol, 'origen', e.origen,
      'pantalla', e.pantalla, 'mensaje', e.mensaje, 'detalle', e.detalle, 'version', e.version_app,
      'navegador', e.navegador, 'pagina', e.pagina, 'revisado', e.revisado) order by e.creado_en desc)
    from (select * from public.errores_tecnicos x
          where (coalesce((p_filtros ->> 'pendientes')::boolean, false) = false or not x.revisado)
          order by x.creado_en desc limit least(coalesce((p_filtros ->> 'limite')::int, 300), 1000)) e
    left join public.perfiles p on p.user_id = e.usuario_id), '[]'::jsonb);
end;
$$;

-- Marcar revisados y borrar los viejos (más de 30 días).
create or replace function public.marcar_errores_revisados(p_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_n int;
begin
  perform privado.exigir_rol('admin');
  update public.errores_tecnicos set revisado = true where id = any (p_ids) and not revisado;
  get diagnostics v_n = row_count;
  return jsonb_build_object('marcados', v_n);
end;
$$;

create or replace function public.borrar_errores_viejos()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_n int;
begin
  perform privado.exigir_rol('admin');
  delete from public.errores_tecnicos where creado_en < now() - interval '30 days';
  get diagnostics v_n = row_count;
  perform privado.auditar((privado.evento_actual()).id, 'borrar_errores_viejos', jsonb_build_object('borrados', v_n));
  return jsonb_build_object('borrados', v_n);
end;
$$;

-- La Edge Function registra sus propios errores (con la service role).
create or replace function public.registrar_error_servidor(p_datos jsonb, p_usuario uuid default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.errores_tecnicos (usuario_id, rol, origen, pantalla, mensaje, detalle)
  values (p_usuario, (select rol from public.perfiles where user_id = p_usuario),
          left(coalesce(p_datos ->> 'origen', 'edge'), 20), privado.limpiar_texto(p_datos ->> 'pantalla', 80),
          coalesce(nullif(privado.limpiar_texto(p_datos ->> 'mensaje', 500), ''), 'Sin mensaje'),
          privado.limpiar_json(coalesce(p_datos -> 'detalle', '{}'::jsonb)));
exception when others then
  return;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol_actual() to authenticated;
grant execute on function privado.es_admin()   to authenticated;

revoke all on function public.registrar_error(jsonb) from public;
grant execute on function public.registrar_error(jsonb) to anon, authenticated;

revoke all on function public.errores_admin(jsonb) from public, anon;
revoke all on function public.marcar_errores_revisados(uuid[]) from public, anon;
revoke all on function public.borrar_errores_viejos() from public, anon;
grant execute on function public.errores_admin(jsonb) to authenticated;
grant execute on function public.marcar_errores_revisados(uuid[]) to authenticated;
grant execute on function public.borrar_errores_viejos() to authenticated;

revoke all on function public.registrar_error_servidor(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.registrar_error_servidor(jsonb, uuid) to service_role;
