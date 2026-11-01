-- =====================================================================
-- 0003 · Funciones RPC (la única puerta de escritura)
-- Todas: SECURITY DEFINER, search_path fijo y rol verificado con
-- privado.exigir_rol() a partir de auth.uid().
-- Fase 0: validación de rol lista; la lógica de negocio llega en cada fase.
-- =====================================================================

create or replace function privado.no_disponible()
returns void
language plpgsql
set search_path = public
as $$
begin
  perform privado.error('no_disponible', 'Esta opción todavía no está disponible.');
end;
$$;

-- ---------------------------------------------------------------------
-- Sesión
-- ---------------------------------------------------------------------

-- Datos mínimos del usuario actual para decidir qué app mostrar.
create or replace function public.mi_perfil()
returns table (nombre text, usuario text, rol text, debe_cambiar_clave boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v public.perfiles;
begin
  v := privado.exigir_rol('admin','rrpp','puerta','caja');
  return query select v.nombre, v.usuario, v.rol, v.debe_cambiar_clave;
end;
$$;

-- Datos para transferir al club: los ven todos los que cobran.
create or replace function public.datos_transferencia()
returns table (alias text, cbu_cvu text, titular text, entidad text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin','rrpp','caja');
  return query
    select c.transf_alias, c.transf_cbu_cvu, c.transf_titular, c.transf_entidad
    from public.config_club c where c.id = 1;
end;
$$;

-- ---------------------------------------------------------------------
-- RRPP
-- ---------------------------------------------------------------------
create or replace function public.emitir_venta(
  p_idem uuid, p_nombre text, p_dni text, p_tel text, p_cantidad int, p_medio text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('rrpp');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.reenviar_link(p_venta_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('rrpp','admin');
  perform privado.no_disponible();
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Comprador (página pública, sin sesión)
-- ---------------------------------------------------------------------
create or replace function public.ver_entradas(p_token text, p_dni text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.pasar_entrada(p_token text, p_dni text, p_nro int, p_nombre text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.ver_entrada_pasada(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.no_disponible();
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Puerta y caja
-- ---------------------------------------------------------------------
create or replace function public.descargar_lista_puerta(p_evento_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('puerta');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.registrar_ingresos(p_lote jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('puerta');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.venta_puerta(p_idem uuid, p_cantidad int, p_medio text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('caja');
  perform privado.no_disponible();
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------
create or replace function public.anular_venta(p_venta_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.emitir_cortesia(p_nombre text, p_dni text, p_cantidad int)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.confirmar_transferencias(p_venta_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.registrar_movimiento_rrpp(
  p_rrpp_id uuid, p_tipo text, p_monto numeric, p_nota text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.ajustar_rrpp(
  p_rrpp_id uuid, p_comision numeric, p_limite_tipo text, p_limite_valor numeric)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.ajustar_evento(p_evento_id uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.ajustar_tanda(p_tanda_id uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

create or replace function public.ajustar_config_club(p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

-- Anonimiza DNI y teléfono de un evento. NO se ejecuta sola: M decide cuándo.
create or replace function public.anonimizar_datos_personales(p_evento_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('admin');
  perform privado.no_disponible();
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución (todo revocado por defecto en 0002)
-- ---------------------------------------------------------------------
revoke all on all functions in schema public  from public, anon, authenticated;
revoke all on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol_actual() to authenticated;
grant execute on function privado.es_admin()   to authenticated;

-- Página pública del comprador: lo único que puede llamar anon.
grant execute on function public.ver_entradas(text, text)             to anon, authenticated;
grant execute on function public.pasar_entrada(text, text, int, text) to anon, authenticated;
grant execute on function public.ver_entrada_pasada(text)             to anon, authenticated;

-- Usuarios con sesión (cada función valida el rol adentro).
grant execute on function public.mi_perfil()                                     to authenticated;
grant execute on function public.datos_transferencia()                           to authenticated;
grant execute on function public.emitir_venta(uuid, text, text, text, int, text) to authenticated;
grant execute on function public.reenviar_link(uuid)                             to authenticated;
grant execute on function public.descargar_lista_puerta(uuid)                    to authenticated;
grant execute on function public.registrar_ingresos(jsonb)                       to authenticated;
grant execute on function public.venta_puerta(uuid, int, text)                   to authenticated;
grant execute on function public.anular_venta(uuid, text)                        to authenticated;
grant execute on function public.emitir_cortesia(text, text, int)                to authenticated;
grant execute on function public.confirmar_transferencias(uuid[])                to authenticated;
grant execute on function public.registrar_movimiento_rrpp(uuid, text, numeric, text) to authenticated;
grant execute on function public.ajustar_rrpp(uuid, numeric, text, numeric)      to authenticated;
grant execute on function public.ajustar_evento(uuid, jsonb)                     to authenticated;
grant execute on function public.ajustar_tanda(uuid, jsonb)                      to authenticated;
grant execute on function public.ajustar_config_club(jsonb)                      to authenticated;
grant execute on function public.anonimizar_datos_personales(uuid)               to authenticated;
