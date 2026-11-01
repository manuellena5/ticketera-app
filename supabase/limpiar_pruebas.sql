-- =====================================================================
-- Borra los DATOS DE PRUEBA de un evento (ventas, entradas, rendiciones,
-- auditoría e intentos) para arrancar la venta real limpia.
--
-- ⚠️ NO SE PUEDE DESHACER. Correr a mano en el SQL Editor de Supabase,
-- solo después de la prueba de campo y ANTES de abrir la venta real.
-- No borra usuarios, tandas, configuración ni el evento.
-- Reemplazar el nombre del evento abajo y correr todo junto.
-- =====================================================================
begin;

do $$
declare
  v_evento uuid;
  v_nombre constant text := 'Baile con Simón Aguirre';   -- ← nombre exacto del evento
begin
  select id into v_evento from public.eventos where nombre = v_nombre;
  if v_evento is null then raise exception 'No existe un evento llamado %', v_nombre; end if;

  delete from public.entradas         where evento_id = v_evento;
  delete from public.movimientos_rrpp where evento_id = v_evento;
  delete from public.ventas           where evento_id = v_evento;
  delete from public.auditoria        where evento_id = v_evento;
  delete from public.intentos_link;

  insert into public.auditoria (evento_id, accion, detalle)
  values (v_evento, 'limpiar_pruebas', jsonb_build_object('cuando', now()));
  raise notice 'Datos de prueba borrados del evento %', v_nombre;
end $$;

commit;
