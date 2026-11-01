-- =====================================================================
-- 0006 · Fase 3: puerta y caja
-- Lista para validar sin conexión, registro de ingresos (gana el primero),
-- cambios para sincronizar, deshacer ingreso, venta en puerta y caja.
-- =====================================================================

-- Cuándo cambió cada entrada (para que los celulares de puerta bajen solo
-- lo nuevo: ingresos del otro escáner, anulaciones, entradas nuevas).
alter table public.entradas add column if not exists actualizado_en timestamptz not null default now();
create index if not exists entradas_evento_actualizado on public.entradas (evento_id, actualizado_en);

-- Hash del código guardado e indexado: la puerta trabaja con hashes y
-- así cada validación es una búsqueda directa.
alter table public.entradas add column if not exists codigo_hash text
  generated always as (privado.sha256_hex(codigo)) stored;
create unique index if not exists entradas_codigo_hash on public.entradas (codigo_hash);

create or replace function privado.marcar_actualizada()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.actualizado_en := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists entradas_actualizado on public.entradas;
create trigger entradas_actualizado before update on public.entradas
  for each row execute function privado.marcar_actualizada();

-- Al anular una venta, sus entradas cambian (lo hace la RPC de admin en la
-- fase 4); igual se toca la entrada si cambia el estado de la venta.
create or replace function privado.venta_cambio_estado()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.estado is distinct from old.estado then
    update public.entradas set actualizado_en = clock_timestamp() where venta_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists ventas_estado on public.ventas;
create trigger ventas_estado after update of estado on public.ventas
  for each row execute function privado.venta_cambio_estado();

-- Personas adentro: entradas con ingreso (QR + pulseras de caja).
create or replace function privado.adentro(p_evento uuid)
returns bigint language sql stable set search_path = public
as $$
  select count(*) from public.entradas e
  join public.ventas v on v.id = e.venta_id
  where e.evento_id = p_evento and e.ingreso_en is not null and e.estado = 'valida' and v.estado = 'activa'
$$;

create or replace function privado.contador(p_evento uuid)
returns jsonb language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'adentro', privado.adentro(e.id),
    'emitidas', privado.emitidas_evento(e.id),
    'tope', e.tope_entradas,
    'aviso_desde', e.aviso_desde,
    'servidor_ahora', clock_timestamp())
  from public.eventos e where e.id = p_evento
$$;

-- Fila de la lista de puerta: lo mínimo para validar sin conexión.
-- Nunca el código en claro ni el DNI completo.
create or replace function privado.fila_puerta(p_entrada uuid)
returns jsonb language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'h',  e.codigo_hash,
    'n',  v.titular_nombre,
    'd3', right(coalesce(v.titular_dni, ''), 3),
    'hd', case when v.titular_dni is null then null
               else privado.sha256_hex(v.titular_dni || (select s.sal from public.secretos_evento s where s.evento_id = e.evento_id)) end,
    't',  coalesce(t.nombre, case v.canal when 'cortesia' then 'Cortesía' else '' end),
    'nro', e.nro,
    'c',  v.cantidad,
    'e',  case when e.estado = 'valida' and v.estado = 'activa' then 'valida' else 'anulada' end,
    'i',  e.ingreso_en,
    'p',  e.pasada_a)
  from public.entradas e
  join public.ventas v on v.id = e.venta_id
  left join public.tandas t on t.id = v.tanda_id
  where e.id = p_entrada
$$;

-- Momento informado por un celular: no puede ser futuro (reloj adelantado).
create or replace function privado.momento_seguro(p_momento timestamptz)
returns timestamptz language sql stable set search_path = public
as $$
  select case when p_momento is null or p_momento > clock_timestamp() then clock_timestamp() else p_momento end
$$;

create or replace function privado.evento_de(p_evento uuid)
returns public.eventos language sql stable set search_path = public
as $$
  select e.* from public.eventos e where e.id = coalesce(p_evento, (privado.evento_actual()).id)
$$;

-- ---------------------------------------------------------------------
-- descargar_lista_puerta
-- ---------------------------------------------------------------------
create or replace function public.descargar_lista_puerta(p_evento_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_ev public.eventos;
begin
  perform privado.exigir_rol('puerta');
  v_ev := privado.evento_de(p_evento_id);
  if v_ev.id is null then perform privado.error('sin_evento', 'No hay ningún evento cargado.'); end if;
  return jsonb_build_object(
    'evento', jsonb_build_object('nombre', v_ev.nombre, 'artista', v_ev.artista, 'fecha', v_ev.fecha),
    'sal', (select s.sal from public.secretos_evento s where s.evento_id = v_ev.id),
    'contador', privado.contador(v_ev.id),
    'generada', clock_timestamp(),
    'entradas', coalesce((
      select jsonb_agg(privado.fila_puerta(e.id))
      from public.entradas e join public.ventas v on v.id = e.venta_id
      where e.evento_id = v_ev.id and v.canal <> 'caja'), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- cambios_puerta: lo que cambió desde un momento (otros escáneres,
-- anulaciones, entradas nuevas).
-- ---------------------------------------------------------------------
create or replace function public.cambios_puerta(p_desde timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_ev public.eventos;
begin
  perform privado.exigir_rol('puerta');
  v_ev := privado.evento_actual();
  return jsonb_build_object(
    'contador', privado.contador(v_ev.id),
    'entradas', coalesce((
      select jsonb_agg(privado.fila_puerta(e.id))
      from public.entradas e join public.ventas v on v.id = e.venta_id
      where e.evento_id = v_ev.id and v.canal <> 'caja'
        and (p_desde is null or e.actualizado_en > p_desde)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- registrar_ingresos: lote de {h, momento, dispositivo, via}.
-- Regla: gana el primer ingreso por momento. Los repetidos quedan en
-- auditoría como "intento duplicado".
-- ---------------------------------------------------------------------
create or replace function public.registrar_ingresos(p_lote jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo      public.perfiles;
  v_ev      public.eventos;
  it        jsonb;
  v_ent     public.entradas;
  v_venta   public.ventas;
  v_mom     timestamptz;
  v_disp    text;
  v_res     jsonb := '[]'::jsonb;
  v_estado  text;
begin
  v_yo := privado.exigir_rol('puerta');
  v_ev := privado.evento_actual();
  if jsonb_typeof(p_lote) is distinct from 'array' or jsonb_array_length(p_lote) > 500 then
    perform privado.error('datos', 'Algo salió mal. Probá de nuevo.');
  end if;

  for it in select * from jsonb_array_elements(p_lote) loop
    v_ent := null;
    v_mom := privado.momento_seguro(nullif(it ->> 'momento', '')::timestamptz);
    v_disp := left(coalesce(it ->> 'dispositivo', ''), 40);

    select e.* into v_ent from public.entradas e
    where e.evento_id = v_ev.id and e.codigo_hash = (it ->> 'h')
    for update;

    if v_ent.id is null then
      v_estado := 'no_valida';
      perform privado.auditar(v_ev.id, 'ingreso_no_valido', jsonb_build_object('h', left(it ->> 'h', 16), 'dispositivo', v_disp));
    else
      select * into v_venta from public.ventas where id = v_ent.venta_id;
      if v_ent.estado <> 'valida' or v_venta.estado <> 'activa' then
        v_estado := 'anulada';
        perform privado.auditar(v_ev.id, 'ingreso_anulada', jsonb_build_object('entrada', v_ent.id, 'dispositivo', v_disp, 'momento', v_mom));
      elsif v_ent.ingreso_en is null then
        update public.entradas set ingreso_en = v_mom, ingreso_dispositivo = v_disp, ingreso_por = v_yo.user_id
         where id = v_ent.id returning * into v_ent;
        v_estado := 'ok';
        perform privado.auditar(v_ev.id, 'ingreso', jsonb_build_object('entrada', v_ent.id, 'dispositivo', v_disp,
                                'momento', v_mom, 'via', coalesce(it ->> 'via', 'qr')));
      elsif v_mom < v_ent.ingreso_en then
        -- Llegó después pero pasó antes: gana este; el otro queda como duplicado.
        perform privado.auditar(v_ev.id, 'intento_duplicado', jsonb_build_object('entrada', v_ent.id,
                                'dispositivo', v_ent.ingreso_dispositivo, 'momento', v_ent.ingreso_en, 'gano', v_disp));
        update public.entradas set ingreso_en = v_mom, ingreso_dispositivo = v_disp, ingreso_por = v_yo.user_id
         where id = v_ent.id returning * into v_ent;
        v_estado := 'ok';
      else
        v_estado := case when v_ent.ingreso_dispositivo = v_disp and v_ent.ingreso_en = v_mom then 'ok' else 'duplicado' end;
        if v_estado = 'duplicado' then
          perform privado.auditar(v_ev.id, 'intento_duplicado', jsonb_build_object('entrada', v_ent.id,
                                  'dispositivo', v_disp, 'momento', v_mom, 'gano', v_ent.ingreso_dispositivo));
        end if;
      end if;
    end if;

    v_res := v_res || jsonb_build_object('h', it ->> 'h', 'resultado', v_estado,
                                         'ingreso', v_ent.ingreso_en, 'dispositivo', v_ent.ingreso_dispositivo);
  end loop;

  return jsonb_build_object('resultados', v_res, 'contador', privado.contador(v_ev.id));
end;
$$;

-- ---------------------------------------------------------------------
-- deshacer_ingreso: lo hace quien maneja el celular de puerta (decisión
-- de M) o el admin. Queda en auditoría con el motivo.
-- ---------------------------------------------------------------------
create or replace function public.deshacer_ingreso(p_h text, p_motivo text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo  public.perfiles;
  v_ev  public.eventos;
  v_ent public.entradas;
begin
  v_yo := privado.exigir_rol('puerta', 'admin');
  v_ev := privado.evento_actual();
  select e.* into v_ent from public.entradas e
  where e.evento_id = v_ev.id and e.codigo_hash = p_h for update;
  if v_ent.id is null then
    perform privado.error('no_encontrada', 'No encontramos esa entrada.');
  end if;
  if v_ent.ingreso_en is not null then
    update public.entradas set ingreso_en = null, ingreso_dispositivo = null, ingreso_por = null where id = v_ent.id;
    perform privado.auditar(v_ev.id, 'deshacer_ingreso', jsonb_build_object(
      'entrada', v_ent.id, 'ingreso_era', v_ent.ingreso_en, 'dispositivo_era', v_ent.ingreso_dispositivo,
      'motivo', nullif(left(trim(coalesce(p_motivo, '')), 200), '')));
  end if;
  return jsonb_build_object('fila', privado.fila_puerta(v_ent.id), 'contador', privado.contador(v_ev.id));
end;
$$;

-- ---------------------------------------------------------------------
-- venta_puerta: caja. Crea la venta y las entradas ya ingresadas (pulsera).
-- Con conexión respeta stock y tope. Las ventas hechas SIN conexión
-- (p_offline) se aceptan siempre, aunque pasen el tope (las personas ya
-- tienen la pulsera): quedan en auditoría y se devuelve un aviso.
-- ---------------------------------------------------------------------
drop function if exists public.venta_puerta(uuid, int, text);
create or replace function public.venta_puerta(
  p_idem uuid, p_cantidad int, p_medio text,
  p_precio_visto numeric default null, p_offline boolean default false, p_momento timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo     public.perfiles;
  v_ev     public.eventos;
  v_tanda  record;
  v_previa public.ventas;
  v_venta  uuid;
  v_mom    timestamptz;
  v_emit   bigint;
  v_aviso  text;
  i        int;
begin
  v_yo := privado.exigir_rol('caja');
  if p_idem is null then perform privado.error('datos', 'Algo salió mal. Probá de nuevo.'); end if;

  select * into v_previa from public.ventas where idempotency_key = p_idem;
  if found then
    if v_previa.creada_por is distinct from v_yo.user_id then
      perform privado.error('datos', 'Algo salió mal. Probá de nuevo.');
    end if;
    return jsonb_build_object('cantidad', v_previa.cantidad, 'total', v_previa.total, 'medio', v_previa.medio,
                              'repetida', true, 'contador', privado.contador(v_previa.evento_id), 'caja', privado.caja(v_previa.evento_id));
  end if;

  if p_medio is null or p_medio not in ('efectivo', 'transferencia') then
    perform privado.error('medio', 'Elegí cómo cobraste: efectivo o transferencia.');
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 20 then
    perform privado.error('cantidad', 'La cantidad tiene que ser de 1 a 20.');
  end if;

  select e.* into v_ev from public.eventos e where e.id = (privado.evento_actual()).id for update;
  if v_ev.id is null or v_ev.estado <> 'venta' then
    perform privado.error('venta_cerrada', 'La venta no está abierta.');
  end if;

  v_mom := case when p_offline then privado.momento_seguro(p_momento) else clock_timestamp() end;

  select * into v_tanda from privado.estado_tandas(v_ev.id, 'caja') where vigente;
  if p_offline then
    -- Sin conexión se cobró con el precio que tenía el celular.
    if p_precio_visto is not null then
      select * into v_tanda from privado.estado_tandas(v_ev.id, 'caja')
      where precio = p_precio_visto order by vigente desc, orden limit 1;
    end if;
    if v_tanda.tanda_id is null then
      select * into v_tanda from privado.estado_tandas(v_ev.id, 'caja') order by vigente desc, orden desc limit 1;
    end if;
    if v_tanda.tanda_id is null then
      perform privado.error('sin_tanda', 'No hay una tanda de puerta cargada.');
    end if;
  else
    if v_tanda.tanda_id is null then
      perform privado.error('sin_tanda', 'No hay entradas de puerta a la venta en este momento.');
    end if;
    if p_precio_visto is not null and p_precio_visto <> v_tanda.precio then
      perform privado.error('precio_cambio', 'Cambió el precio: ahora la entrada sale ' || privado.pesos(v_tanda.precio) || '.');
    end if;
    if p_cantidad > v_tanda.quedan then
      perform privado.error('stock_tanda', case when v_tanda.quedan = 0 then 'No quedan entradas de puerta.'
        when v_tanda.quedan = 1 then 'Queda 1 entrada de puerta.'
        else 'Quedan ' || privado.plural(v_tanda.quedan, 'entrada', 'entradas') || ' de puerta.' end);
    end if;
  end if;

  v_emit := privado.emitidas_evento(v_ev.id);
  if v_emit + p_cantidad > v_ev.tope_entradas then
    if not p_offline then
      perform privado.error('tope', case when v_ev.tope_entradas - v_emit <= 0 then 'Se llegó al tope de entradas del evento.'
        when v_ev.tope_entradas - v_emit = 1 then 'Queda 1 lugar en el evento.'
        else 'Quedan ' || privado.plural(v_ev.tope_entradas - v_emit, 'lugar', 'lugares') || ' en el evento.' end);
    end if;
    v_aviso := 'Se vendieron ' || privado.plural(v_emit + p_cantidad - v_ev.tope_entradas, 'entrada', 'entradas')
               || ' por encima del tope mientras no había conexión.';
  end if;

  insert into public.ventas (evento_id, canal, tanda_id, titular_nombre, cantidad, precio_unitario, total,
                             medio, idempotency_key, creada_por, creado_en)
  values (v_ev.id, 'caja', v_tanda.tanda_id, 'Venta en puerta', p_cantidad, v_tanda.precio, v_tanda.precio * p_cantidad,
          p_medio, p_idem, v_yo.user_id, v_mom)
  returning id into v_venta;

  for i in 1 .. p_cantidad loop
    insert into public.entradas (evento_id, venta_id, nro, codigo, ingreso_en, ingreso_dispositivo, ingreso_por)
    values (v_ev.id, v_venta, i, privado.nuevo_codigo(), v_mom, 'caja', v_yo.user_id);
  end loop;

  perform privado.auditar(v_ev.id, 'venta_puerta', jsonb_build_object('venta', v_venta, 'cantidad', p_cantidad,
    'precio', v_tanda.precio, 'medio', p_medio, 'sin_conexion', p_offline, 'momento', v_mom));
  if v_aviso is not null then
    perform privado.auditar(v_ev.id, 'venta_puerta_sobre_tope', jsonb_build_object('venta', v_venta,
      'cantidad', p_cantidad, 'emitidas_antes', v_emit, 'tope', v_ev.tope_entradas));
  end if;

  return jsonb_build_object('cantidad', p_cantidad, 'total', v_tanda.precio * p_cantidad, 'medio', p_medio,
                            'repetida', false, 'aviso', v_aviso,
                            'contador', privado.contador(v_ev.id), 'caja', privado.caja(v_ev.id));
end;
$$;

-- Totales de la caja de puerta.
create or replace function privado.caja(p_evento uuid)
returns jsonb language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'pulseras', coalesce(sum(v.cantidad), 0),
    'efectivo', coalesce(sum(v.total) filter (where v.medio = 'efectivo'), 0),
    'transferencias', coalesce(sum(v.total) filter (where v.medio = 'transferencia'), 0),
    'ventas', count(*))
  from public.ventas v
  where v.evento_id = p_evento and v.canal = 'caja' and v.estado = 'activa'
$$;

-- ---------------------------------------------------------------------
-- caja_puerta: lo que muestra el celular de caja.
-- ---------------------------------------------------------------------
create or replace function public.caja_puerta()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_ev    public.eventos;
  v_tanda record;
begin
  perform privado.exigir_rol('caja');
  v_ev := privado.evento_actual();
  select * into v_tanda from privado.estado_tandas(v_ev.id, 'caja') where vigente;
  return jsonb_build_object(
    'evento', jsonb_build_object('nombre', v_ev.nombre, 'artista', v_ev.artista, 'fecha', v_ev.fecha),
    'abierta', v_ev.estado = 'venta',
    'tanda', case when v_tanda.tanda_id is null then null
                  else jsonb_build_object('nombre', v_tanda.nombre, 'precio', v_tanda.precio, 'quedan', v_tanda.quedan) end,
    'contador', privado.contador(v_ev.id),
    'caja', privado.caja(v_ev.id));
end;
$$;

-- Contador para cualquier usuario de puerta/caja/admin.
create or replace function public.contador_puerta()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform privado.exigir_rol('puerta', 'caja', 'admin');
  return privado.contador((privado.evento_actual()).id);
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol_actual() to authenticated;
grant execute on function privado.es_admin()   to authenticated;

revoke all on function public.cambios_puerta(timestamptz) from public, anon;
revoke all on function public.deshacer_ingreso(text, text) from public, anon;
revoke all on function public.venta_puerta(uuid, int, text, numeric, boolean, timestamptz) from public, anon;
revoke all on function public.caja_puerta() from public, anon;
revoke all on function public.contador_puerta() from public, anon;
grant execute on function public.cambios_puerta(timestamptz) to authenticated;
grant execute on function public.deshacer_ingreso(text, text) to authenticated;
grant execute on function public.venta_puerta(uuid, int, text, numeric, boolean, timestamptz) to authenticated;
grant execute on function public.caja_puerta() to authenticated;
grant execute on function public.contador_puerta() to authenticated;
