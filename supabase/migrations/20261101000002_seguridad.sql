-- =====================================================================
-- 0002 · Seguridad: helpers de rol, RLS, revocaciones y políticas
-- Principio: las reglas viven en la base. Los clientes NO escriben tablas:
-- toda escritura pasa por funciones RPC SECURITY DEFINER.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers internos (schema privado). El rol SIEMPRE sale de perfiles
-- con auth.uid(); nunca de algo que mande el cliente.
-- ---------------------------------------------------------------------

-- Perfil del usuario actual, solo si está activo. NULL si no hay sesión
-- o si el usuario fue desactivado.
create or replace function privado.perfil_actual()
returns public.perfiles
language sql stable security definer
set search_path = public
as $$
  select p.* from public.perfiles p
  where p.user_id = auth.uid() and p.activo
$$;

create or replace function privado.rol_actual()
returns text
language sql stable security definer
set search_path = public
as $$
  select p.rol from public.perfiles p
  where p.user_id = auth.uid() and p.activo
$$;

create or replace function privado.es_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(privado.rol_actual() = 'admin', false)
$$;

-- Error con mensaje para la persona (va a pantalla tal cual) y un código
-- corto en HINT para que la app decida qué hacer. Nunca datos internos.
create or replace function privado.error(p_codigo text, p_mensaje text)
returns void
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = 'P0001', message = p_mensaje, hint = p_codigo;
end;
$$;

-- Exige que el usuario actual esté activo y tenga uno de los roles.
-- Devuelve su perfil.
create or replace function privado.exigir_rol(variadic p_roles text[])
returns public.perfiles
language plpgsql stable security definer
set search_path = public
as $$
declare
  v public.perfiles;
begin
  if auth.uid() is null then
    perform privado.error('sin_sesion', 'Tenés que ingresar de nuevo.');
  end if;
  select * into v from public.perfiles where user_id = auth.uid();
  if not found or not v.activo then
    perform privado.error('usuario_inactivo', 'Tu usuario está desactivado. Hablá con el club.');
  end if;
  if not (v.rol = any (p_roles)) then
    perform privado.error('sin_permiso', 'No tenés permiso para hacer esto.');
  end if;
  return v;
end;
$$;

-- Evento en curso (v1: uno solo). El de estado 'venta' más próximo;
-- si no hay, el último no cerrado.
create or replace function privado.evento_actual()
returns public.eventos
language sql stable security definer
set search_path = public
as $$
  select e.* from public.eventos e
  where e.estado <> 'cerrado'
  order by (e.estado = 'venta') desc, e.fecha asc
  limit 1
$$;

create or replace function privado.auditar(p_evento uuid, p_accion text, p_detalle jsonb default '{}'::jsonb)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.auditoria (evento_id, usuario_id, accion, detalle)
  values (p_evento, auth.uid(), p_accion, coalesce(p_detalle, '{}'::jsonb))
$$;

-- Generadores de códigos: 128 bits aleatorios en base32 (RFC 4648, sin relleno).
create or replace function privado.base32(p_bytes bytea)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  alfabeto constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  salida text := '';
  buffer bigint := 0;
  bits int := 0;
  i int;
begin
  for i in 0 .. length(p_bytes) - 1 loop
    buffer := ((buffer << 8) | get_byte(p_bytes, i)) & 65535;
    bits := bits + 8;
    while bits >= 5 loop
      salida := salida || substr(alfabeto, ((buffer >> (bits - 5)) & 31)::int + 1, 1);
      bits := bits - 5;
    end loop;
  end loop;
  if bits > 0 then
    salida := salida || substr(alfabeto, ((buffer << (5 - bits)) & 31)::int + 1, 1);
  end if;
  return salida;
end;
$$;

create or replace function privado.nuevo_codigo()
returns text
language sql volatile
set search_path = public
as $$
  select privado.base32(extensions.gen_random_bytes(16))
$$;

create or replace function privado.sha256_hex(p_texto text)
returns text
language sql immutable
set search_path = public
as $$
  select encode(extensions.digest(convert_to(p_texto, 'UTF8'), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------------
-- Cambio de contraseña: cuando el usuario cambia su clave en Auth, se
-- apaga debe_cambiar_clave. (Al restablecerla, la Edge Function del
-- admin vuelve a poner debe_cambiar_clave = true DESPUÉS del cambio.)
-- ---------------------------------------------------------------------
create or replace function privado.al_cambiar_clave()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.perfiles set debe_cambiar_clave = false where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists perfiles_clave_cambiada on auth.users;
create trigger perfiles_clave_cambiada
  after update of encrypted_password on auth.users
  for each row execute function privado.al_cambiar_clave();

-- ---------------------------------------------------------------------
-- Permisos del schema privado: solo lo justo para que las políticas RLS
-- puedan llamar a los helpers de lectura de rol.
-- ---------------------------------------------------------------------
revoke all on schema privado from public, anon, authenticated;
revoke all on all functions in schema privado from public, anon, authenticated;
alter default privileges in schema privado revoke execute on functions from public, anon, authenticated;

grant usage on schema privado to authenticated;
grant execute on function privado.rol_actual() to authenticated;
grant execute on function privado.es_admin()   to authenticated;

-- ---------------------------------------------------------------------
-- RLS en TODAS las tablas de public.
-- (Sin FORCE: las funciones SECURITY DEFINER, dueñas de las tablas,
-- aplican sus propias reglas y no quedan filtradas por las políticas.)
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Revocaciones: anon y authenticated no tienen nada sobre las tablas.
-- (Supabase da ALL por defecto; acá se saca todo.)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all     on tables    from public, anon, authenticated;
alter default privileges in schema public revoke all     on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Lecturas permitidas a usuarios con sesión (filtradas por RLS).
-- Ninguna escritura directa. anon: nada.
-- secretos_evento e intentos_link: sin grant ni política (solo RPC).
-- ---------------------------------------------------------------------
grant select on public.eventos, public.tandas, public.config_club, public.perfiles,
               public.rrpp_evento, public.ventas, public.entradas,
               public.movimientos_rrpp, public.auditoria
  to authenticated;

-- Eventos y tandas: cualquier usuario activo (no tienen datos sensibles).
create policy eventos_leer on public.eventos
  for select to authenticated
  using (privado.rol_actual() is not null);

create policy tandas_leer on public.tandas
  for select to authenticated
  using (privado.rol_actual() is not null);

-- Configuración del club: solo admin (RRPP y caja la leen por RPC).
create policy config_club_leer on public.config_club
  for select to authenticated
  using (privado.es_admin());

-- Perfiles: el propio, o todos si es admin.
create policy perfiles_leer on public.perfiles
  for select to authenticated
  using ((user_id = auth.uid() and privado.rol_actual() is not null) or privado.es_admin());

-- Condiciones del RRPP: las propias, o todas si es admin.
create policy rrpp_evento_leer on public.rrpp_evento
  for select to authenticated
  using ((rrpp_id = auth.uid() and privado.rol_actual() = 'rrpp') or privado.es_admin());

-- Ventas: el RRPP solo las suyas; admin todas. Puerta y caja: nada directo.
create policy ventas_leer on public.ventas
  for select to authenticated
  using ((rrpp_id = auth.uid() and privado.rol_actual() = 'rrpp') or privado.es_admin());

-- Entradas: las de ventas propias del RRPP; admin todas.
create policy entradas_leer on public.entradas
  for select to authenticated
  using (
    privado.es_admin()
    or (privado.rol_actual() = 'rrpp' and exists (
          select 1 from public.ventas v
          where v.id = entradas.venta_id and v.rrpp_id = auth.uid()))
  );

-- Movimientos: los propios del RRPP; admin todos.
create policy movimientos_leer on public.movimientos_rrpp
  for select to authenticated
  using ((rrpp_id = auth.uid() and privado.rol_actual() = 'rrpp') or privado.es_admin());

-- Auditoría: solo admin.
create policy auditoria_leer on public.auditoria
  for select to authenticated
  using (privado.es_admin());
