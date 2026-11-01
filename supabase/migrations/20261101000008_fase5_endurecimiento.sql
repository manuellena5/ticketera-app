-- =====================================================================
-- 0008 · Fase 5: endurecimiento
-- =====================================================================

-- Los clientes no pueden crear objetos en public (evita que alguien con
-- sesión "sombree" una tabla o función que use una SECURITY DEFINER).
revoke create on schema public from public, anon, authenticated;
revoke all on schema privado from public, anon;

-- Limpieza del freno de intentos: borra registros viejos sin bloqueo vigente.
-- (La puede correr el admin o un cron; no toca nada más.)
create or replace function public.limpiar_intentos_link()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_n int;
begin
  perform privado.exigir_rol('admin');
  delete from public.intentos_link
   where (bloqueado_hasta is null or bloqueado_hasta < now()) and creado_en < now() - interval '1 day';
  get diagnostics v_n = row_count;
  return jsonb_build_object('borrados', v_n);
end;
$$;
revoke all on function public.limpiar_intentos_link() from public, anon;
grant execute on function public.limpiar_intentos_link() to authenticated;

-- Ping diario (GitHub Actions) para que el plan gratis no se pause: no
-- devuelve nada ni escribe. Lo puede llamar anon.
create or replace function public.ping()
returns text
language sql stable security definer
set search_path = public
as $$ select 'ok'::text $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
