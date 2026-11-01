-- =====================================================================
-- 0004 · Fase 1: venta de RRPP
-- emitir_venta, tanda vigente, límite por RRPP, tope general, inicio del
-- RRPP, detalle de venta, reenvío del link y marca de "enviada".
-- =====================================================================

-- Si el RRPP ya tocó "Enviar por WhatsApp" (para "Enviada" / "Sin enviar").
alter table public.ventas add column if not exists enviada_en timestamptz;

-- ---------------------------------------------------------------------
-- Reloj. En producción es now(); los tests lo reemplazan dentro de una
-- transacción que se descarta. No depende de nada que mande el cliente.
-- ---------------------------------------------------------------------
create or replace function privado.ahora()
returns timestamptz
language sql stable
set search_path = public
as $$ select now() $$;

-- "1 entrada" / "3 entradas" para los mensajes de la base.
create or replace function privado.plural(n bigint, sing text, plur text)
returns text
language sql immutable
set search_path = public
as $$
  select to_char(n, 'FM999G999G999') || ' ' || case when n = 1 then sing else plur end
$$;

-- "$20.000"
create or replace function privado.pesos(n numeric)
returns text
language sql immutable
set search_path = public
as $$
  select '$' || replace(to_char(round(n), 'FM999,999,999,990'), ',', '.')
$$;

-- Entradas emitidas (ventas activas) de una tanda.
create or replace function privado.emitidas_tanda(p_tanda uuid)
returns bigint
language sql stable
set search_path = public
as $$
  select coalesce(sum(v.cantidad), 0)
  from public.ventas v
  where v.tanda_id = p_tanda and v.estado = 'activa'
$$;

-- Entradas emitidas en todo el evento (todos los canales, cortesías incluidas).
create or replace function privado.emitidas_evento(p_evento uuid)
returns bigint
language sql stable
set search_path = public
as $$
  select coalesce(sum(v.cantidad), 0)
  from public.ventas v
  where v.evento_id = p_evento and v.estado = 'activa'
$$;

-- ---------------------------------------------------------------------
-- Estado de las tandas de un canal, según la regla de tanda vigente:
--  1. Se recorren en orden.
--  2. Una tanda termina si se agota o si pasa su "hasta".
--  3. Empieza cuando llega su "desde" o cuando termina la anterior.
--  4. La vigente es la primera que empezó, no terminó y tiene stock.
-- ---------------------------------------------------------------------
create or replace function privado.estado_tandas(p_evento uuid, p_canal text)
returns table (
  tanda_id uuid, nombre text, precio numeric, cantidad int, desde timestamptz, hasta timestamptz,
  orden int, emitidas bigint, quedan bigint, agotada boolean, vencida boolean,
  empezo boolean, vigente boolean)
language plpgsql stable
set search_path = public
as $$
declare
  t record;
  v_ahora timestamptz := privado.ahora();
  v_anterior_termino boolean := false;
  v_ya_hay_vigente boolean := false;
  v_emitidas bigint;
  v_agotada boolean;
  v_vencida boolean;
  v_empezo boolean;
begin
  for t in
    select * from public.tandas
    where evento_id = p_evento and canal = p_canal
    order by orden, desde nulls first, creado_en
  loop
    v_emitidas := privado.emitidas_tanda(t.id);
    v_agotada  := v_emitidas >= t.cantidad;
    v_vencida  := t.hasta is not null and v_ahora > t.hasta;
    v_empezo   := (t.desde is null or v_ahora >= t.desde) or v_anterior_termino;

    tanda_id := t.id; nombre := t.nombre; precio := t.precio; cantidad := t.cantidad;
    desde := t.desde; hasta := t.hasta; orden := t.orden;
    emitidas := v_emitidas; quedan := greatest(t.cantidad - v_emitidas, 0);
    agotada := v_agotada; vencida := v_vencida; empezo := v_empezo;
    vigente := (not v_ya_hay_vigente) and v_empezo and not v_agotada and not v_vencida;
    if vigente then v_ya_hay_vigente := true; end if;
    return next;

    v_anterior_termino := v_agotada or v_vencida;
  end loop;
end;
$$;

-- Límite efectivo de un RRPP en una tanda. NULL = sin límite propio
-- (vende de la bolsa común de la tanda).
create or replace function privado.limite_rrpp(p_evento uuid, p_rrpp uuid, p_tanda uuid)
returns int
language sql stable
set search_path = public
as $$
  select case re.limite_tipo
           when 'cantidad'   then re.limite_valor::int
           when 'porcentaje' then floor(t.cantidad * re.limite_valor / 100)::int
           else null
         end
  from public.rrpp_evento re
  join public.tandas t on t.id = p_tanda
  where re.evento_id = p_evento and re.rrpp_id = p_rrpp
$$;

create or replace function privado.vendidas_rrpp_tanda(p_rrpp uuid, p_tanda uuid)
returns bigint
language sql stable
set search_path = public
as $$
  select coalesce(sum(v.cantidad), 0)
  from public.ventas v
  where v.rrpp_id = p_rrpp and v.tanda_id = p_tanda and v.estado = 'activa'
$$;

-- Motivo por el que el RRPP no puede vender ahora (NULL = puede).
create or replace function privado.motivo_sin_venta_rrpp(p_evento public.eventos)
returns text
language sql stable
set search_path = public
as $$
  select case
    when p_evento.id is null then 'No hay ningún evento a la venta.'
    when p_evento.estado = 'borrador' then 'La venta todavía no está abierta.'
    when p_evento.estado = 'cerrado' then 'La venta de este evento ya cerró.'
    when p_evento.cierre_venta_rrpp is not null and privado.ahora() > p_evento.cierre_venta_rrpp
      then 'La venta de RRPP ya cerró. Ahora se vende solo en la puerta.'
    else null
  end
$$;

-- Link nuevo para una venta: devuelve el token y guarda solo su hash.
create or replace function privado.rotar_link_venta(p_venta uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_token text := privado.nuevo_codigo();
begin
  update public.ventas set link_hash = privado.sha256_hex(v_token) where id = p_venta;
  return v_token;
end;
$$;

-- Resumen de una venta para la app del RRPP (sin IDs salvo la referencia
-- interna "ref", que la app usa para pedir el detalle y nunca muestra).
create or replace function privado.resumen_venta(p_venta uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'ref', v.id,
    'nombre', v.titular_nombre,
    'dni', v.titular_dni,
    'tel', v.titular_tel,
    'cantidad', v.cantidad,
    'precio', v.precio_unitario,
    'total', v.total,
    'medio', v.medio,
    'tanda', t.nombre,
    'estado', v.estado,
    'creada', v.creado_en,
    'enviada', v.enviada_en is not null,
    'ingresaron', (select count(*) from public.entradas e where e.venta_id = v.id and e.ingreso_en is not null)
  )
  from public.ventas v
  left join public.tandas t on t.id = v.tanda_id
  where v.id = p_venta
$$;

-- Datos del evento para armar el mensaje de WhatsApp.
create or replace function privado.datos_evento(p_evento uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object('nombre', e.nombre, 'artista', e.artista, 'fecha', e.fecha, 'lugar', e.lugar)
  from public.eventos e where e.id = p_evento
$$;

-- ---------------------------------------------------------------------
-- emitir_venta: la venta del RRPP. Todas las reglas acá.
-- ---------------------------------------------------------------------
-- p_precio_visto: el precio que el RRPP tenía en pantalla. NO fija nada:
-- si la tanda cambió mientras completaba el formulario, se frena para que
-- no cobre un monto equivocado. El precio lo sigue poniendo el servidor.
drop function if exists public.emitir_venta(uuid, text, text, text, int, text);
create or replace function public.emitir_venta(
  p_idem uuid, p_nombre text, p_dni text, p_tel text, p_cantidad int, p_medio text,
  p_precio_visto numeric default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo        public.perfiles;
  v_evento    public.eventos;
  v_cond      public.rrpp_evento;
  v_tanda     record;
  v_previa    public.ventas;
  v_nombre    text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_dni       text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
  v_tel       text := nullif(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), '');
  v_motivo    text;
  v_limite    int;
  v_vendidas  bigint;
  v_emitidas  bigint;
  v_venta     uuid;
  v_token     text;
  i           int;
begin
  v_yo := privado.exigir_rol('rrpp');

  if p_idem is null then
    perform privado.error('datos', 'Algo salió mal. Probá de nuevo.');
  end if;

  -- Primero se bloquea la fila del evento: serializa las ventas y hace que
  -- dos pedidos con la misma clave (doble toque simultáneo) se vean entre sí.
  perform 1 from public.eventos e where e.id = (privado.evento_actual()).id for update;

  -- Reintento (doble toque, se cortó la señal): misma venta, link nuevo.
  select * into v_previa from public.ventas where idempotency_key = p_idem;
  if found then
    if v_previa.creada_por is distinct from v_yo.user_id or v_previa.estado <> 'activa' then
      perform privado.error('datos', 'Algo salió mal. Probá de nuevo.');
    end if;
    v_token := privado.rotar_link_venta(v_previa.id);
    return jsonb_build_object('venta', privado.resumen_venta(v_previa.id),
                              'evento', privado.datos_evento(v_previa.evento_id),
                              'token', v_token, 'repetida', true);
  end if;

  -- Datos del titular
  if length(v_nombre) < 3 or length(v_nombre) > 80 then
    perform privado.error('nombre', 'Escribí el nombre y apellido.');
  end if;
  if v_dni !~ '^[0-9]{7,8}$' then
    perform privado.error('dni', 'Revisá el DNI: tiene que tener 7 u 8 números.');
  end if;
  if v_tel is not null and length(v_tel) not between 8 and 15 then
    perform privado.error('tel', 'Revisá el WhatsApp: poné código de área y número.');
  end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia') then
    perform privado.error('medio', 'Elegí cómo cobraste: efectivo o transferencia.');
  end if;

  -- Fila del evento bloqueada: serializa todas las emisiones del evento
  -- (stock de tanda, límite del RRPP y tope general sin carreras).
  select e.* into v_evento from public.eventos e
  where e.id = (privado.evento_actual()).id
  for update;

  v_motivo := privado.motivo_sin_venta_rrpp(v_evento);
  if v_motivo is not null then
    perform privado.error('venta_cerrada', v_motivo);
  end if;

  if p_cantidad is null or p_cantidad < 1 or p_cantidad > v_evento.max_por_venta then
    perform privado.error('cantidad', 'Podés emitir de 1 a ' || privado.plural(v_evento.max_por_venta, 'entrada', 'entradas') || ' por venta.');
  end if;

  select * into v_cond from public.rrpp_evento where evento_id = v_evento.id and rrpp_id = v_yo.user_id;
  if not found then
    perform privado.error('no_habilitado', 'No estás habilitado para vender en este evento. Hablá con el club.');
  end if;

  -- Tanda vigente (el precio lo pone el servidor)
  select * into v_tanda from privado.estado_tandas(v_evento.id, 'rrpp') where vigente;
  if not found then
    perform privado.error('sin_tanda', 'No hay entradas a la venta en este momento.');
  end if;
  if p_precio_visto is not null and p_precio_visto <> v_tanda.precio then
    perform privado.error('precio_cambio',
      'Cambió la tanda: ahora vendés ' || v_tanda.nombre || ' a ' || privado.pesos(v_tanda.precio)
      || '. Revisá el total antes de emitir.');
  end if;
  if p_cantidad > v_tanda.quedan then
    -- No se parte la venta entre dos tandas.
    perform privado.error('stock_tanda',
      case when v_tanda.quedan = 1 then 'Queda 1 entrada de la ' || v_tanda.nombre || '.'
           else 'Quedan ' || privado.plural(v_tanda.quedan, 'entrada', 'entradas') || ' de la ' || v_tanda.nombre || '.' end);
  end if;

  -- Límite del RRPP en esta tanda
  v_limite := privado.limite_rrpp(v_evento.id, v_yo.user_id, v_tanda.tanda_id);
  if v_limite is not null then
    v_vendidas := privado.vendidas_rrpp_tanda(v_yo.user_id, v_tanda.tanda_id);
    if v_vendidas + p_cantidad > v_limite then
      perform privado.error('limite_rrpp',
        case when v_limite - v_vendidas <= 0 then 'Ya vendiste todas tus entradas de esta tanda.'
             when v_limite - v_vendidas = 1 then 'Te queda 1 entrada en esta tanda.'
             else 'Te quedan ' || privado.plural(v_limite - v_vendidas, 'entrada', 'entradas') || ' en esta tanda.' end);
    end if;
  end if;

  -- Tope general: siempre manda
  v_emitidas := privado.emitidas_evento(v_evento.id);
  if v_emitidas + p_cantidad > v_evento.tope_entradas then
    perform privado.error('tope',
      case when v_evento.tope_entradas - v_emitidas <= 0 then 'Se llegó al tope de entradas del evento.'
           when v_evento.tope_entradas - v_emitidas = 1 then 'Queda 1 lugar en el evento.'
           else 'Quedan ' || privado.plural(v_evento.tope_entradas - v_emitidas, 'lugar', 'lugares') || ' en el evento.' end);
  end if;

  -- Venta + entradas
  v_token := privado.nuevo_codigo();
  insert into public.ventas (
    evento_id, canal, rrpp_id, tanda_id, titular_nombre, titular_dni, titular_tel,
    cantidad, precio_unitario, total, comision_unitaria, medio, link_hash,
    idempotency_key, creada_por)
  values (
    v_evento.id, 'rrpp', v_yo.user_id, v_tanda.tanda_id, v_nombre, v_dni, v_tel,
    p_cantidad, v_tanda.precio, v_tanda.precio * p_cantidad, v_cond.comision_por_entrada,
    p_medio, privado.sha256_hex(v_token), p_idem, v_yo.user_id)
  returning id into v_venta;

  for i in 1 .. p_cantidad loop
    insert into public.entradas (evento_id, venta_id, nro, codigo)
    values (v_evento.id, v_venta, i, privado.nuevo_codigo());
  end loop;

  perform privado.auditar(v_evento.id, 'emitir_venta', jsonb_build_object(
    'venta', v_venta, 'tanda', v_tanda.nombre, 'cantidad', p_cantidad,
    'precio', v_tanda.precio, 'medio', p_medio, 'comision', v_cond.comision_por_entrada));

  return jsonb_build_object('venta', privado.resumen_venta(v_venta),
                            'evento', privado.datos_evento(v_evento.id),
                            'token', v_token, 'repetida', false);
end;
$$;

-- ---------------------------------------------------------------------
-- reenviar_link: link nuevo; el anterior deja de funcionar.
-- ---------------------------------------------------------------------
create or replace function public.reenviar_link(p_venta_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo    public.perfiles;
  v_venta public.ventas;
  v_token text;
begin
  v_yo := privado.exigir_rol('rrpp', 'admin');
  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found or (v_yo.rol = 'rrpp' and v_venta.rrpp_id is distinct from v_yo.user_id) then
    perform privado.error('no_encontrada', 'No encontramos esa venta.');
  end if;
  if v_venta.estado <> 'activa' then
    perform privado.error('anulada', 'Esta venta está anulada.');
  end if;
  if v_venta.link_hash is null then
    perform privado.error('sin_link', 'Esta venta no tiene link.');
  end if;
  v_token := privado.rotar_link_venta(v_venta.id);
  perform privado.auditar(v_venta.evento_id, 'reenviar_link', jsonb_build_object('venta', v_venta.id));
  return jsonb_build_object('venta', privado.resumen_venta(v_venta.id),
                            'evento', privado.datos_evento(v_venta.evento_id),
                            'token', v_token);
end;
$$;

-- ---------------------------------------------------------------------
-- marcar_enviada: el RRPP tocó "Enviar por WhatsApp".
-- ---------------------------------------------------------------------
create or replace function public.marcar_enviada(p_venta_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo public.perfiles;
begin
  v_yo := privado.exigir_rol('rrpp');
  update public.ventas set enviada_en = coalesce(enviada_en, now())
  where id = p_venta_id and rrpp_id = v_yo.user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- detalle_venta: la venta y el estado de cada entrada.
-- ---------------------------------------------------------------------
create or replace function public.detalle_venta(p_venta_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_yo    public.perfiles;
  v_venta public.ventas;
begin
  v_yo := privado.exigir_rol('rrpp', 'admin');
  select * into v_venta from public.ventas where id = p_venta_id;
  if not found or (v_yo.rol = 'rrpp' and v_venta.rrpp_id is distinct from v_yo.user_id) then
    perform privado.error('no_encontrada', 'No encontramos esa venta.');
  end if;
  return privado.resumen_venta(v_venta.id) || jsonb_build_object(
    'anulada_en', v_venta.anulada_en,
    'motivo_anulacion', v_venta.motivo_anulacion,
    'entradas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nro', e.nro, 'estado', e.estado, 'ingreso', e.ingreso_en, 'pasada_a', e.pasada_a)
             order by e.nro)
      from public.entradas e where e.venta_id = v_venta.id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- inicio_rrpp: todo lo que muestra el Inicio del RRPP en una llamada.
-- ---------------------------------------------------------------------
create or replace function public.inicio_rrpp()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_yo        public.perfiles;
  v_evento    public.eventos;
  v_cond      public.rrpp_evento;
  v_tanda     record;
  v_previa    record;
  v_motivo    text;
  v_limite    int;
  v_vend_t    bigint := 0;
  v_aviso     text;
  v_tanda_js  jsonb := null;
  v_cuentas   record;
  v_mov       record;
begin
  v_yo := privado.exigir_rol('rrpp');
  v_evento := privado.evento_actual();
  select * into v_cond from public.rrpp_evento where evento_id = v_evento.id and rrpp_id = v_yo.user_id;

  v_motivo := privado.motivo_sin_venta_rrpp(v_evento);
  if v_motivo is null and v_cond.rrpp_id is null then
    v_motivo := 'No estás habilitado para vender en este evento. Hablá con el club.';
  end if;

  if v_evento.id is not null then
    select * into v_tanda from privado.estado_tandas(v_evento.id, 'rrpp') where vigente;
    if found then
      v_limite := privado.limite_rrpp(v_evento.id, v_yo.user_id, v_tanda.tanda_id);
      v_vend_t := privado.vendidas_rrpp_tanda(v_yo.user_id, v_tanda.tanda_id);
      v_tanda_js := jsonb_build_object(
        'nombre', v_tanda.nombre, 'precio', v_tanda.precio, 'hasta', v_tanda.hasta,
        'quedan', v_tanda.quedan, 'limite', v_limite, 'vendidas', v_vend_t,
        'te_quedan', case when v_limite is null then null
                          else greatest(least(v_limite - v_vend_t, v_tanda.quedan), 0) end);

      -- ¿Se adelantó porque se agotó la anterior?
      select * into v_previa from privado.estado_tandas(v_evento.id, 'rrpp')
      where orden <= v_tanda.orden and tanda_id <> v_tanda.tanda_id
      order by orden desc limit 1;
      if found and v_previa.agotada and not v_previa.vencida then
        v_aviso := 'Se agotó la ' || v_previa.nombre || '. Ahora vendés ' || v_tanda.nombre
                   || ' a ' || privado.pesos(v_tanda.precio) || '.';
      end if;
    elsif v_motivo is null then
      v_motivo := 'No hay entradas a la venta en este momento.';
    end if;
  end if;

  select
    coalesce(sum(v.cantidad), 0)                                                      as vendidas,
    coalesce(sum(v.total) filter (where v.medio = 'efectivo'), 0)                     as efectivo,
    coalesce(sum(v.total) filter (where v.medio = 'transferencia'), 0)                as transferencias,
    coalesce(sum(v.cantidad * v.comision_unitaria), 0)                                as comision_ganada
  into v_cuentas
  from public.ventas v
  where v.evento_id = v_evento.id and v.rrpp_id = v_yo.user_id and v.estado = 'activa';

  select
    coalesce(sum(m.monto) filter (where m.tipo = 'entrega_efectivo'), 0) as rendido,
    coalesce(sum(m.monto) filter (where m.tipo = 'pago_comision'), 0)    as comision_pagada
  into v_mov
  from public.movimientos_rrpp m
  where m.evento_id = v_evento.id and m.rrpp_id = v_yo.user_id;

  return jsonb_build_object(
    'nombre', v_yo.nombre,
    'evento', case when v_evento.id is null then null else privado.datos_evento(v_evento.id) end,
    'puede_vender', v_motivo is null,
    'motivo', v_motivo,
    'max_por_venta', coalesce(v_evento.max_por_venta, 6),
    'tanda', v_tanda_js,
    'aviso_tanda', v_aviso,
    'vendidas', v_cuentas.vendidas,
    'efectivo_cobrado', v_cuentas.efectivo,
    'efectivo_rendido', v_mov.rendido,
    'efectivo_a_rendir', v_cuentas.efectivo - v_mov.rendido,
    'transferencias', v_cuentas.transferencias,
    'ad_honorem', coalesce(v_cond.comision_por_entrada, 0) = 0 and v_cuentas.comision_ganada = 0,
    'comision_por_entrada', coalesce(v_cond.comision_por_entrada, 0),
    'comision_ganada', v_cuentas.comision_ganada,
    'comision_pagada', v_mov.comision_pagada,
    'ventas', coalesce((
      select jsonb_agg(privado.resumen_venta(v.id) order by v.creado_en desc)
      from public.ventas v
      where v.evento_id = v_evento.id and v.rrpp_id = v_yo.user_id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol_actual() to authenticated;
grant execute on function privado.es_admin()   to authenticated;

revoke all on function public.emitir_venta(uuid, text, text, text, int, text, numeric) from public, anon;
grant execute on function public.emitir_venta(uuid, text, text, text, int, text, numeric) to authenticated;
revoke all on function public.marcar_enviada(uuid) from public, anon;
revoke all on function public.detalle_venta(uuid)  from public, anon;
revoke all on function public.inicio_rrpp()        from public, anon;
grant execute on function public.marcar_enviada(uuid) to authenticated;
grant execute on function public.detalle_venta(uuid)  to authenticated;
grant execute on function public.inicio_rrpp()        to authenticated;
