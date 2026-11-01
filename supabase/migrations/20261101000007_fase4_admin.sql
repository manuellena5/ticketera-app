-- =====================================================================
-- 0007 · Fase 4: panel de administración
-- Tablero, RRPP, evento y tandas, configuración, ventas (anular,
-- cortesías), transferencias, rendición, auditoría, exportes y cierre.
-- Todo con exigir_rol('admin') y auditoría de cada escritura.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Evento en curso: el de venta, si no el borrador más próximo y, si todos
-- están cerrados, el último cerrado (el panel lo sigue mostrando después
-- del cierre; las reglas de venta lo rechazan por su estado).
create or replace function privado.evento_actual()
returns public.eventos
language sql stable security definer
set search_path = public
as $$
  select e.* from public.eventos e
  order by (e.estado = 'venta') desc, (e.estado = 'borrador') desc,
           case when e.estado = 'cerrado' then -extract(epoch from e.fecha) else extract(epoch from e.fecha) end
  limit 1
$$;

create or replace function privado.ev_admin()
returns public.eventos language sql stable set search_path = public
as $$ select (privado.evento_actual()).* $$;

create or replace function privado.hora_ar(p timestamptz)
returns text language sql stable set search_path = public
as $$ select to_char(p at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') $$;

-- Estado de una tanda para el panel: vigente, terminada, agotada o próxima.
create or replace function privado.etiqueta_tanda(p_vigente boolean, p_agotada boolean, p_vencida boolean, p_empezo boolean)
returns text language sql immutable set search_path = public
as $$
  select case when p_vigente then 'vigente'
              when p_agotada then 'agotada'
              when p_vencida or p_empezo then 'terminada'
              else 'proxima' end
$$;

-- Saldos de rendición por RRPP (sección 7 del plan).
create or replace function privado.rendicion(p_evento uuid)
returns table (
  rrpp_id uuid, nombre text, usuario text, pueblo text, telefono text, activo boolean,
  comision_actual numeric, entradas bigint, efectivo_cobrado numeric,
  transf_confirmadas numeric, transf_pendientes numeric, rendido numeric, efectivo_a_rendir numeric,
  comision_ganada numeric, comision_pagada numeric, comision_a_pagar numeric, ad_honorem boolean)
language sql stable set search_path = public
as $$
  with base as (
    select p.user_id, p.nombre, p.usuario, p.pueblo, p.telefono, p.activo, re.comision_por_entrada
    from public.perfiles p
    left join public.rrpp_evento re on re.rrpp_id = p.user_id and re.evento_id = p_evento
    where p.rol = 'rrpp'
      and (re.rrpp_id is not null or exists (select 1 from public.ventas v where v.rrpp_id = p.user_id and v.evento_id = p_evento))
  ), v as (
    select v.rrpp_id,
           sum(v.cantidad) as entradas,
           sum(v.total) filter (where v.medio = 'efectivo') as efectivo,
           sum(v.total) filter (where v.medio = 'transferencia' and v.transferencia_confirmada) as tconf,
           sum(v.total) filter (where v.medio = 'transferencia' and not v.transferencia_confirmada) as tpend,
           sum(v.cantidad * v.comision_unitaria) as comision
    from public.ventas v
    where v.evento_id = p_evento and v.estado = 'activa' and v.canal = 'rrpp'
    group by v.rrpp_id
  ), m as (
    select m.rrpp_id,
           sum(m.monto) filter (where m.tipo = 'entrega_efectivo') as rendido,
           sum(m.monto) filter (where m.tipo = 'pago_comision') as pagada
    from public.movimientos_rrpp m where m.evento_id = p_evento group by m.rrpp_id
  )
  select b.user_id, b.nombre, b.usuario, b.pueblo, b.telefono, b.activo,
         coalesce(b.comision_por_entrada, 0),
         coalesce(v.entradas, 0), coalesce(v.efectivo, 0), coalesce(v.tconf, 0), coalesce(v.tpend, 0),
         coalesce(m.rendido, 0), coalesce(v.efectivo, 0) - coalesce(m.rendido, 0),
         coalesce(v.comision, 0), coalesce(m.pagada, 0), coalesce(v.comision, 0) - coalesce(m.pagada, 0),
         coalesce(b.comision_por_entrada, 0) = 0 and coalesce(v.comision, 0) = 0 and coalesce(m.pagada, 0) = 0
  from base b
  left join v on v.rrpp_id = b.user_id
  left join m on m.rrpp_id = b.user_id
  order by b.nombre
$$;

create or replace function privado.num(p jsonb, k text)
returns numeric language plpgsql immutable set search_path = public
as $$
begin
  if p ? k and jsonb_typeof(p -> k) <> 'null' then
    return (p ->> k)::numeric;
  end if;
  return null;
exception when others then
  perform privado.error('datos', 'Revisá los números cargados.');
end;
$$;

create or replace function privado.fecha(p jsonb, k text)
returns timestamptz language plpgsql stable set search_path = public
as $$
begin
  if p ? k and coalesce(p ->> k, '') <> '' then
    return (p ->> k)::timestamptz;
  end if;
  return null;
exception when others then
  perform privado.error('datos', 'Revisá las fechas cargadas.');
end;
$$;

-- ---------------------------------------------------------------------
-- Tablero
-- ---------------------------------------------------------------------
create or replace function public.tablero_admin()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_ev public.eventos;
  v_res jsonb;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  if v_ev.id is null then return jsonb_build_object('evento', null); end if;

  select jsonb_build_object(
    'evento', jsonb_build_object('nombre', v_ev.nombre, 'artista', v_ev.artista, 'fecha', v_ev.fecha, 'lugar', v_ev.lugar,
              'tope', v_ev.tope_entradas, 'aviso_desde', v_ev.aviso_desde, 'max_por_venta', v_ev.max_por_venta,
              'cierre_venta_rrpp', v_ev.cierre_venta_rrpp, 'estado', v_ev.estado),
    'venta_rrpp', privado.motivo_sin_venta_rrpp(v_ev) is null,
    'motivo_rrpp', privado.motivo_sin_venta_rrpp(v_ev),
    'emitidas', privado.emitidas_evento(v_ev.id),
    'adentro', privado.adentro(v_ev.id),
    'vendido', (select coalesce(sum(total), 0) from public.ventas where evento_id = v_ev.id and estado = 'activa'),
    'efectivo', (select coalesce(sum(total), 0) from public.ventas where evento_id = v_ev.id and estado = 'activa' and medio = 'efectivo'),
    'transferencias', (select coalesce(sum(total), 0) from public.ventas where evento_id = v_ev.id and estado = 'activa' and medio = 'transferencia'),
    'transf_pendientes', (select jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total), 0))
                          from public.ventas where evento_id = v_ev.id and estado = 'activa' and medio = 'transferencia' and not transferencia_confirmada),
    'efectivo_a_rendir', (select coalesce(sum(efectivo_a_rendir), 0) from privado.rendicion(v_ev.id)),
    'comision_a_pagar', (select coalesce(sum(comision_a_pagar), 0) from privado.rendicion(v_ev.id)),
    'rrpp_con_saldo', (select count(*) from privado.rendicion(v_ev.id) where efectivo_a_rendir <> 0 or comision_a_pagar <> 0),
    'tandas', (select coalesce(jsonb_agg(x order by x.canal desc, x.orden), '[]'::jsonb) from (
                 select t.nombre, c.canal, t.orden, t.precio, t.cantidad, t.emitidas, t.quedan, t.desde, t.hasta,
                        privado.etiqueta_tanda(t.vigente, t.agotada, t.vencida, t.empezo) as estado,
                        (select coalesce(sum(v.total), 0) from public.ventas v where v.tanda_id = t.tanda_id and v.estado = 'activa') as recaudado
                 from (values ('rrpp'), ('caja')) c(canal), privado.estado_tandas(v_ev.id, c.canal) t) x),
    'canales', (select coalesce(jsonb_object_agg(canal, jsonb_build_object('entradas', n, 'total', tot)), '{}'::jsonb) from (
                 select canal, sum(cantidad) n, sum(total) tot from public.ventas
                 where evento_id = v_ev.id and estado = 'activa' group by canal) c),
    'rrpp', (select coalesce(jsonb_agg(jsonb_build_object(
                 'nombre', r.nombre, 'pueblo', r.pueblo, 'entradas', r.entradas, 'efectivo_a_rendir', r.efectivo_a_rendir,
                 'comision_a_pagar', r.comision_a_pagar) order by r.entradas desc, r.nombre), '[]'::jsonb)
             from privado.rendicion(v_ev.id) r),
    'ingresos_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'n', n) order by h), '[]'::jsonb) from (
                 select to_char(date_trunc('hour', e.ingreso_en at time zone 'America/Argentina/Buenos_Aires'), 'HH24":00"') h, count(*) n
                 from public.entradas e join public.ventas v on v.id = e.venta_id
                 where e.evento_id = v_ev.id and e.ingreso_en is not null and v.estado = 'activa'
                 group by 1) x),
    'avisos', (select coalesce(jsonb_agg(jsonb_build_object('accion', a.accion, 'cuando', a.creado_en, 'detalle', a.detalle) order by a.creado_en desc), '[]'::jsonb)
               from (select * from public.auditoria a
                     where a.evento_id = v_ev.id and a.accion in ('venta_puerta_sobre_tope')
                     order by a.creado_en desc limit 20) a),
    'duplicados', (select count(*) from public.auditoria where evento_id = v_ev.id and accion = 'intento_duplicado')
  ) into v_res;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------
-- Rendición y movimientos
-- ---------------------------------------------------------------------
create or replace function public.rendicion_admin()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_ev public.eventos;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  return jsonb_build_object(
    'filas', (select coalesce(jsonb_agg(jsonb_build_object(
                'ref', r.rrpp_id, 'nombre', r.nombre, 'usuario', r.usuario, 'pueblo', r.pueblo, 'telefono', r.telefono,
                'activo', r.activo, 'comision_actual', r.comision_actual, 'entradas', r.entradas,
                'efectivo_cobrado', r.efectivo_cobrado, 'transf_confirmadas', r.transf_confirmadas,
                'transf_pendientes', r.transf_pendientes, 'rendido', r.rendido, 'efectivo_a_rendir', r.efectivo_a_rendir,
                'comision_ganada', r.comision_ganada, 'comision_pagada', r.comision_pagada,
                'comision_a_pagar', r.comision_a_pagar, 'ad_honorem', r.ad_honorem)), '[]'::jsonb)
              from privado.rendicion(v_ev.id) r),
    'movimientos', (select coalesce(jsonb_agg(jsonb_build_object(
                'nro', x.nro, 'rrpp', p.nombre, 'tipo', x.tipo, 'monto', x.monto, 'nota', x.nota, 'cuando', x.creado_en,
                'por', (select q.nombre from public.perfiles q where q.user_id = x.registrado_por)) order by x.creado_en desc), '[]'::jsonb)
              from (select m.*, row_number() over (order by m.creado_en) as nro from public.movimientos_rrpp m where m.evento_id = v_ev.id) x
              join public.perfiles p on p.user_id = x.rrpp_id),
    'cierre_rrpp', v_ev.cierre_venta_rrpp,
    'venta_rrpp_cerrada', v_ev.cierre_venta_rrpp is not null and privado.ahora() > v_ev.cierre_venta_rrpp);
end;
$$;

create or replace function public.registrar_movimiento_rrpp(
  p_rrpp_id uuid, p_tipo text, p_monto numeric, p_nota text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo    public.perfiles;
  v_ev    public.eventos;
  v_r     record;
  v_pend  numeric;
  v_nota  text := nullif(left(trim(coalesce(p_nota, '')), 300), '');
  v_mov   public.movimientos_rrpp;
  v_nro   bigint;
  v_desp  record;
begin
  v_yo := privado.exigir_rol('admin');
  select e.* into v_ev from public.eventos e where e.id = (privado.evento_actual()).id for update;
  if p_tipo not in ('entrega_efectivo', 'pago_comision') then
    perform privado.error('datos', 'Elegí si es una entrega de efectivo o un pago de comisión.');
  end if;
  if p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) then
    perform privado.error('monto', 'Escribí un monto mayor a $0.');
  end if;
  select * into v_r from privado.rendicion(v_ev.id) where rrpp_id = p_rrpp_id;
  if v_r.rrpp_id is null then
    perform privado.error('no_encontrado', 'No encontramos a ese RRPP.');
  end if;
  v_pend := case when p_tipo = 'entrega_efectivo' then v_r.efectivo_a_rendir else v_r.comision_a_pagar end;
  if p_monto > v_pend and v_nota is null then
    perform privado.error('excede',
      'Es más que lo pendiente (' || privado.pesos(greatest(v_pend, 0)) || '). Si es correcto, agregá una nota que lo explique.');
  end if;

  insert into public.movimientos_rrpp (evento_id, rrpp_id, tipo, monto, nota, registrado_por)
  values (v_ev.id, p_rrpp_id, p_tipo, p_monto, v_nota, v_yo.user_id)
  returning * into v_mov;
  select count(*) into v_nro from public.movimientos_rrpp where evento_id = v_ev.id;
  select * into v_desp from privado.rendicion(v_ev.id) where rrpp_id = p_rrpp_id;

  perform privado.auditar(v_ev.id, 'movimiento_rrpp', jsonb_build_object('rrpp', p_rrpp_id, 'tipo', p_tipo,
    'monto', p_monto, 'nota', v_nota, 'pendiente_antes', v_pend));

  return jsonb_build_object(
    'nro', v_nro, 'tipo', p_tipo, 'monto', p_monto, 'nota', v_nota, 'cuando', v_mov.creado_en,
    'rrpp', v_r.nombre, 'telefono', v_r.telefono, 'por', v_yo.nombre,
    'saldo', case when p_tipo = 'entrega_efectivo' then v_desp.efectivo_a_rendir else v_desp.comision_a_pagar end,
    'evento', privado.evento_publico(v_ev.id));
end;
$$;

-- ---------------------------------------------------------------------
-- RRPP y usuarios
-- ---------------------------------------------------------------------
create or replace function public.usuarios_admin()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_ev    public.eventos;
  v_tanda record;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  select * into v_tanda from privado.estado_tandas(v_ev.id, 'rrpp') where vigente;
  return jsonb_build_object(
    'tanda', case when v_tanda.tanda_id is null then null
                  else jsonb_build_object('nombre', v_tanda.nombre, 'cantidad', v_tanda.cantidad) end,
    'usuarios', (select coalesce(jsonb_agg(jsonb_build_object(
        'ref', p.user_id, 'nombre', p.nombre, 'usuario', p.usuario, 'telefono', p.telefono, 'pueblo', p.pueblo,
        'rol', p.rol, 'activo', p.activo, 'debe_cambiar_clave', p.debe_cambiar_clave,
        'comision', re.comision_por_entrada, 'limite_tipo', re.limite_tipo, 'limite_valor', re.limite_valor,
        'habilitado', re.rrpp_id is not null,
        'limite_vigente', case when v_tanda.tanda_id is null or re.rrpp_id is null then null
                               else privado.limite_rrpp(v_ev.id, p.user_id, v_tanda.tanda_id) end,
        'vendidas_vigente', case when v_tanda.tanda_id is null then 0 else privado.vendidas_rrpp_tanda(p.user_id, v_tanda.tanda_id) end,
        'vendidas', (select coalesce(sum(v.cantidad), 0) from public.ventas v where v.rrpp_id = p.user_id and v.evento_id = v_ev.id and v.estado = 'activa'))
        order by case p.rol when 'admin' then 0 when 'rrpp' then 1 when 'puerta' then 2 else 3 end, p.nombre), '[]'::jsonb)
      from public.perfiles p
      left join public.rrpp_evento re on re.rrpp_id = p.user_id and re.evento_id = v_ev.id));
end;
$$;

create or replace function public.ajustar_rrpp(
  p_rrpp_id uuid, p_comision numeric, p_limite_tipo text, p_limite_valor numeric)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_ev    public.eventos;
  v_antes public.rrpp_evento;
  v_rol   text;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  select rol into v_rol from public.perfiles where user_id = p_rrpp_id;
  if v_rol is distinct from 'rrpp' then
    perform privado.error('no_encontrado', 'No encontramos a ese RRPP.');
  end if;
  if p_comision is null or p_comision < 0 then
    perform privado.error('comision', 'La comisión tiene que ser $0 o más.');
  end if;
  if p_limite_tipo not in ('sin_limite', 'cantidad', 'porcentaje') then
    perform privado.error('limite', 'Elegí el tipo de límite.');
  end if;
  if p_limite_tipo = 'cantidad' and (p_limite_valor is null or p_limite_valor < 0 or p_limite_valor <> trunc(p_limite_valor)) then
    perform privado.error('limite', 'Escribí una cantidad entera de entradas.');
  end if;
  if p_limite_tipo = 'porcentaje' and (p_limite_valor is null or p_limite_valor <= 0 or p_limite_valor > 100) then
    perform privado.error('limite', 'El porcentaje tiene que ser de 1 a 100.');
  end if;

  select * into v_antes from public.rrpp_evento where evento_id = v_ev.id and rrpp_id = p_rrpp_id;
  insert into public.rrpp_evento (evento_id, rrpp_id, comision_por_entrada, limite_tipo, limite_valor)
  values (v_ev.id, p_rrpp_id, p_comision, p_limite_tipo, case when p_limite_tipo = 'sin_limite' then null else p_limite_valor end)
  on conflict (evento_id, rrpp_id) do update
    set comision_por_entrada = excluded.comision_por_entrada,
        limite_tipo = excluded.limite_tipo, limite_valor = excluded.limite_valor;

  perform privado.auditar(v_ev.id, 'ajustar_rrpp', jsonb_build_object('rrpp', p_rrpp_id,
    'antes', case when v_antes.rrpp_id is null then null else jsonb_build_object('comision', v_antes.comision_por_entrada,
             'limite_tipo', v_antes.limite_tipo, 'limite_valor', v_antes.limite_valor) end,
    'despues', jsonb_build_object('comision', p_comision, 'limite_tipo', p_limite_tipo, 'limite_valor', p_limite_valor)));
  return public.usuarios_admin();
end;
$$;

create or replace function public.activar_usuario(p_user_id uuid, p_activo boolean)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_yo public.perfiles;
begin
  v_yo := privado.exigir_rol('admin');
  if p_user_id = v_yo.user_id and not p_activo then
    perform privado.error('propio', 'No podés desactivar tu propio usuario.');
  end if;
  update public.perfiles set activo = p_activo where user_id = p_user_id;
  if not found then perform privado.error('no_encontrado', 'No encontramos ese usuario.'); end if;
  perform privado.auditar((privado.evento_actual()).id, case when p_activo then 'activar_usuario' else 'desactivar_usuario' end,
                          jsonb_build_object('usuario', p_user_id));
  return public.usuarios_admin();
end;
$$;

-- Lo llaman la Edge Function admin_crear_usuario (con la service role) y
-- el backend local de pruebas. NO lo puede llamar ningún cliente.
create or replace function public.admin_registrar_usuario(
  p_admin uuid, p_user uuid, p_nombre text, p_usuario text, p_telefono text, p_pueblo text, p_rol text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_admin public.perfiles;
  v_ev    public.eventos;
begin
  select * into v_admin from public.perfiles where user_id = p_admin and activo and rol = 'admin';
  if v_admin.user_id is null then perform privado.error('sin_permiso', 'No tenés permiso para hacer esto.'); end if;
  if p_rol not in ('admin', 'rrpp', 'puerta', 'caja') then perform privado.error('rol', 'Elegí el tipo de usuario.'); end if;
  insert into public.perfiles (user_id, nombre, usuario, telefono, pueblo, rol, activo, debe_cambiar_clave)
  values (p_user, trim(p_nombre), lower(trim(p_usuario)), nullif(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), ''),
          nullif(trim(coalesce(p_pueblo, '')), ''), p_rol, true, true);
  v_ev := privado.evento_actual();
  if p_rol = 'rrpp' and v_ev.id is not null then
    insert into public.rrpp_evento (evento_id, rrpp_id) values (v_ev.id, p_user) on conflict do nothing;
  end if;
  insert into public.auditoria (evento_id, usuario_id, accion, detalle)
  values (v_ev.id, p_admin, 'crear_usuario', jsonb_build_object('usuario', p_user, 'nombre', p_nombre, 'rol', p_rol));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_clave_temporal(p_admin uuid, p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_admin public.perfiles;
begin
  select * into v_admin from public.perfiles where user_id = p_admin and activo and rol = 'admin';
  if v_admin.user_id is null then perform privado.error('sin_permiso', 'No tenés permiso para hacer esto.'); end if;
  -- Después de que Auth cambió la clave (el trigger apagó el aviso), se vuelve a pedir el cambio.
  update public.perfiles set debe_cambiar_clave = true where user_id = p_user;
  insert into public.auditoria (evento_id, usuario_id, accion, detalle)
  values ((privado.evento_actual()).id, p_admin, 'restablecer_clave', jsonb_build_object('usuario', p_user));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Evento, tandas y configuración
-- ---------------------------------------------------------------------
create or replace function public.evento_admin()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_ev public.eventos;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  return jsonb_build_object(
    'evento', jsonb_build_object('ref', v_ev.id, 'nombre', v_ev.nombre, 'artista', v_ev.artista, 'fecha', v_ev.fecha,
              'lugar', v_ev.lugar, 'tope', v_ev.tope_entradas, 'aviso_desde', v_ev.aviso_desde,
              'max_por_venta', v_ev.max_por_venta, 'cierre_venta_rrpp', v_ev.cierre_venta_rrpp, 'estado', v_ev.estado),
    'emitidas', privado.emitidas_evento(v_ev.id),
    'cortesias', (select coalesce(sum(cantidad), 0) from public.ventas where evento_id = v_ev.id and canal = 'cortesia' and estado = 'activa'),
    'tandas', (select coalesce(jsonb_agg(jsonb_build_object(
                 'ref', t.tanda_id, 'nombre', t.nombre, 'canal', c.canal, 'precio', t.precio, 'cantidad', t.cantidad,
                 'desde', t.desde, 'hasta', t.hasta, 'orden', t.orden, 'emitidas', t.emitidas, 'quedan', t.quedan,
                 'estado', privado.etiqueta_tanda(t.vigente, t.agotada, t.vencida, t.empezo)) order by c.canal desc, t.orden), '[]'::jsonb)
               from (values ('rrpp'), ('caja')) c(canal), privado.estado_tandas(v_ev.id, c.canal) t),
    'config', (select jsonb_build_object('nombre_club', nombre_club, 'alias', transf_alias, 'cbu_cvu', transf_cbu_cvu,
                                         'titular', transf_titular, 'entidad', transf_entidad, 'actualizado_en', actualizado_en)
               from public.config_club where id = 1));
end;
$$;

create or replace function public.ajustar_evento(p_evento_id uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_ev    public.eventos;
  v_nuevo public.eventos;
  v_emit  bigint;
begin
  perform privado.exigir_rol('admin');
  select * into v_ev from public.eventos where id = coalesce(p_evento_id, (privado.evento_actual()).id) for update;
  if v_ev.id is null then perform privado.error('no_encontrado', 'No encontramos el evento.'); end if;
  v_nuevo := v_ev;
  if p_datos ? 'nombre'  then v_nuevo.nombre  := nullif(trim(p_datos ->> 'nombre'), ''); end if;
  if p_datos ? 'artista' then v_nuevo.artista := nullif(trim(p_datos ->> 'artista'), ''); end if;
  if p_datos ? 'lugar'   then v_nuevo.lugar   := nullif(trim(p_datos ->> 'lugar'), ''); end if;
  if p_datos ? 'fecha'   then v_nuevo.fecha   := privado.fecha(p_datos, 'fecha'); end if;
  if p_datos ? 'tope'    then v_nuevo.tope_entradas := privado.num(p_datos, 'tope'); end if;
  if p_datos ? 'aviso_desde' then v_nuevo.aviso_desde := privado.num(p_datos, 'aviso_desde'); end if;
  if p_datos ? 'max_por_venta' then v_nuevo.max_por_venta := privado.num(p_datos, 'max_por_venta'); end if;
  if p_datos ? 'cierre_venta_rrpp' then v_nuevo.cierre_venta_rrpp := privado.fecha(p_datos, 'cierre_venta_rrpp'); end if;
  if p_datos ? 'estado'  then v_nuevo.estado := p_datos ->> 'estado'; end if;

  if v_nuevo.nombre is null then perform privado.error('nombre', 'Escribí el nombre del evento.'); end if;
  if v_nuevo.fecha is null then perform privado.error('fecha', 'Cargá la fecha y hora del evento.'); end if;
  if v_nuevo.estado not in ('borrador', 'venta', 'cerrado') then perform privado.error('estado', 'Elegí el estado del evento.'); end if;
  if v_nuevo.max_por_venta is null or v_nuevo.max_por_venta < 1 or v_nuevo.max_por_venta > 20 then
    perform privado.error('max_por_venta', 'El máximo por venta tiene que ser de 1 a 20.');
  end if;
  v_emit := privado.emitidas_evento(v_ev.id);
  if v_nuevo.tope_entradas is null or v_nuevo.tope_entradas < 1 then
    perform privado.error('tope', 'Cargá el tope general.');
  end if;
  if v_nuevo.tope_entradas < v_emit then
    perform privado.error('tope', 'El tope no puede quedar por debajo de las ' || privado.plural(v_emit, 'entrada', 'entradas') || ' ya emitidas.');
  end if;
  if v_nuevo.aviso_desde is not null and (v_nuevo.aviso_desde < 1 or v_nuevo.aviso_desde > v_nuevo.tope_entradas) then
    perform privado.error('aviso_desde', 'El aviso tiene que estar entre 1 y el tope.');
  end if;

  update public.eventos set nombre = v_nuevo.nombre, artista = v_nuevo.artista, lugar = v_nuevo.lugar, fecha = v_nuevo.fecha,
         tope_entradas = v_nuevo.tope_entradas, aviso_desde = v_nuevo.aviso_desde, max_por_venta = v_nuevo.max_por_venta,
         cierre_venta_rrpp = v_nuevo.cierre_venta_rrpp, estado = v_nuevo.estado
   where id = v_ev.id;

  perform privado.auditar(v_ev.id, 'ajustar_evento', jsonb_build_object(
    'antes', to_jsonb(v_ev) - 'id' - 'creado_en', 'despues', to_jsonb(v_nuevo) - 'id' - 'creado_en'));
  return public.evento_admin();
end;
$$;

-- p_tanda_id null = tanda nueva. p_datos.borrar = true borra (solo sin ventas).
create or replace function public.ajustar_tanda(p_tanda_id uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_ev    public.eventos;
  v_t     public.tandas;
  v_nueva public.tandas;
  v_emit  bigint := 0;
begin
  perform privado.exigir_rol('admin');
  select e.* into v_ev from public.eventos e where e.id = (privado.evento_actual()).id for update;

  if p_tanda_id is not null then
    select * into v_t from public.tandas where id = p_tanda_id and evento_id = v_ev.id;
    if v_t.id is null then perform privado.error('no_encontrada', 'No encontramos esa tanda.'); end if;
    v_emit := privado.emitidas_tanda(v_t.id);
    if coalesce((p_datos ->> 'borrar')::boolean, false) then
      if exists (select 1 from public.ventas where tanda_id = v_t.id) then
        perform privado.error('con_ventas', 'Esta tanda ya tiene ventas: no se puede borrar. Podés dejarla en 0 o cambiarle las fechas.');
      end if;
      delete from public.tandas where id = v_t.id;
      perform privado.auditar(v_ev.id, 'borrar_tanda', to_jsonb(v_t));
      return public.evento_admin();
    end if;
    v_nueva := v_t;
  else
    v_nueva.id := gen_random_uuid();
    v_nueva.evento_id := v_ev.id;
    v_nueva.canal := 'rrpp';
    v_nueva.orden := coalesce((select max(orden) + 1 from public.tandas where evento_id = v_ev.id), 1);
  end if;

  if p_datos ? 'nombre'   then v_nueva.nombre := nullif(trim(p_datos ->> 'nombre'), ''); end if;
  if p_datos ? 'canal'    then v_nueva.canal := p_datos ->> 'canal'; end if;
  if p_datos ? 'precio'   then v_nueva.precio := privado.num(p_datos, 'precio'); end if;
  if p_datos ? 'cantidad' then v_nueva.cantidad := privado.num(p_datos, 'cantidad'); end if;
  if p_datos ? 'desde'    then v_nueva.desde := privado.fecha(p_datos, 'desde'); end if;
  if p_datos ? 'hasta'    then v_nueva.hasta := privado.fecha(p_datos, 'hasta'); end if;
  if p_datos ? 'orden'    then v_nueva.orden := privado.num(p_datos, 'orden'); end if;

  if v_nueva.nombre is null then perform privado.error('nombre', 'Escribí el nombre de la tanda.'); end if;
  if v_nueva.canal not in ('rrpp', 'caja') then perform privado.error('canal', 'Elegí quién vende la tanda: RRPP o caja.'); end if;
  if v_nueva.precio is null or v_nueva.precio < 0 then perform privado.error('precio', 'Cargá el precio.'); end if;
  if v_nueva.cantidad is null or v_nueva.cantidad < 0 or v_nueva.cantidad <> trunc(v_nueva.cantidad) then
    perform privado.error('cantidad', 'Cargá la cantidad de entradas.');
  end if;
  if v_nueva.cantidad < v_emit then
    perform privado.error('cantidad', 'La cantidad no puede quedar por debajo de las ' || privado.plural(v_emit, 'entrada', 'entradas') || ' ya emitidas.');
  end if;
  if v_nueva.desde is not null and v_nueva.hasta is not null and v_nueva.desde >= v_nueva.hasta then
    perform privado.error('fechas', 'La fecha "hasta" tiene que ser posterior a "desde".');
  end if;
  if p_tanda_id is not null and v_emit > 0 and (v_nueva.canal <> v_t.canal or v_nueva.precio <> v_t.precio) then
    -- Cambiar el precio de una tanda con ventas es válido (las ventas guardan su precio), pero queda registrado.
    null;
  end if;

  if p_tanda_id is null then
    insert into public.tandas (id, evento_id, nombre, canal, precio, cantidad, desde, hasta, orden)
    values (v_nueva.id, v_ev.id, v_nueva.nombre, v_nueva.canal, v_nueva.precio, v_nueva.cantidad, v_nueva.desde, v_nueva.hasta, v_nueva.orden);
  else
    update public.tandas set nombre = v_nueva.nombre, canal = v_nueva.canal, precio = v_nueva.precio, cantidad = v_nueva.cantidad,
           desde = v_nueva.desde, hasta = v_nueva.hasta, orden = v_nueva.orden
     where id = v_t.id;
  end if;
  perform privado.auditar(v_ev.id, case when p_tanda_id is null then 'crear_tanda' else 'ajustar_tanda' end,
    jsonb_build_object('antes', case when p_tanda_id is null then null else to_jsonb(v_t) - 'evento_id' end,
                       'despues', to_jsonb(v_nueva) - 'evento_id'));
  return public.evento_admin();
end;
$$;

create or replace function public.ajustar_config_club(p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo    public.perfiles;
  v_antes public.config_club;
begin
  v_yo := privado.exigir_rol('admin');
  insert into public.config_club (id) values (1) on conflict do nothing;
  select * into v_antes from public.config_club where id = 1 for update;
  update public.config_club set
    nombre_club    = coalesce(nullif(trim(p_datos ->> 'nombre_club'), ''), nombre_club),
    transf_alias   = case when p_datos ? 'alias'   then nullif(trim(p_datos ->> 'alias'), '') else transf_alias end,
    transf_cbu_cvu = case when p_datos ? 'cbu_cvu' then nullif(regexp_replace(p_datos ->> 'cbu_cvu', '\s', '', 'g'), '') else transf_cbu_cvu end,
    transf_titular = case when p_datos ? 'titular' then nullif(trim(p_datos ->> 'titular'), '') else transf_titular end,
    transf_entidad = case when p_datos ? 'entidad' then nullif(trim(p_datos ->> 'entidad'), '') else transf_entidad end,
    actualizado_en = now(), actualizado_por = v_yo.user_id
  where id = 1;
  if exists (select 1 from public.config_club where id = 1 and transf_cbu_cvu is not null and transf_cbu_cvu !~ '^[0-9]{22}$') then
    perform privado.error('cbu', 'El CBU o CVU tiene que tener 22 números.');
  end if;
  perform privado.auditar((privado.evento_actual()).id, 'ajustar_config_club',
    jsonb_build_object('antes', to_jsonb(v_antes) - 'id', 'datos', p_datos));
  return public.evento_admin();
end;
$$;

-- ---------------------------------------------------------------------
-- Ventas: listado, anular, cortesías, transferencias
-- ---------------------------------------------------------------------
create or replace function public.ventas_admin(p_filtros jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_ev public.eventos;
  v_q  text := lower(trim(coalesce(p_filtros ->> 'q', '')));
  v_qd text := regexp_replace(coalesce(p_filtros ->> 'q', ''), '\D', '', 'g');
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  return coalesce((
    select jsonb_agg(x order by x ->> 'creada' desc) from (
      select jsonb_build_object(
        'ref', v.id, 'creada', v.creado_en, 'canal', v.canal, 'rrpp', p.nombre, 'rrpp_ref', v.rrpp_id,
        'tanda', t.nombre, 'nombre', v.titular_nombre, 'dni', v.titular_dni, 'tel', v.titular_tel,
        'cantidad', v.cantidad, 'precio', v.precio_unitario, 'total', v.total, 'medio', v.medio,
        'confirmada', v.transferencia_confirmada, 'estado', v.estado, 'enviada', v.enviada_en is not null,
        'motivo_anulacion', v.motivo_anulacion,
        'ingresaron', (select count(*) from public.entradas e where e.venta_id = v.id and e.ingreso_en is not null)) as x
      from public.ventas v
      left join public.perfiles p on p.user_id = v.rrpp_id
      left join public.tandas t on t.id = v.tanda_id
      where v.evento_id = v_ev.id
        and (v_q = '' or lower(v.titular_nombre) like '%' || v_q || '%' or (v_qd <> '' and v.titular_dni like '%' || v_qd || '%'))
        and (coalesce(p_filtros ->> 'rrpp', '') = '' or v.rrpp_id::text = p_filtros ->> 'rrpp')
        and (coalesce(p_filtros ->> 'tanda', '') = '' or t.nombre = p_filtros ->> 'tanda')
        and (coalesce(p_filtros ->> 'medio', '') = '' or v.medio = p_filtros ->> 'medio')
        and (coalesce(p_filtros ->> 'estado', '') = '' or v.estado = p_filtros ->> 'estado')
        and (coalesce(p_filtros ->> 'canal', '') = '' or v.canal = p_filtros ->> 'canal')
        and (coalesce(p_filtros ->> 'confirmada', '') = '' or v.transferencia_confirmada = (p_filtros ->> 'confirmada')::boolean)
      order by v.creado_en desc
      limit 1000) s), '[]'::jsonb);
end;
$$;

create or replace function public.anular_venta(p_venta_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo     public.perfiles;
  v_venta  public.ventas;
  v_motivo text := nullif(left(trim(coalesce(p_motivo, '')), 300), '');
begin
  v_yo := privado.exigir_rol('admin');
  if v_motivo is null then perform privado.error('motivo', 'Escribí el motivo de la anulación.'); end if;
  select * into v_venta from public.ventas where id = p_venta_id for update;
  if v_venta.id is null then perform privado.error('no_encontrada', 'No encontramos esa venta.'); end if;
  if v_venta.estado = 'anulada' then perform privado.error('anulada', 'Esta venta ya estaba anulada.'); end if;
  update public.ventas set estado = 'anulada', anulada_por = v_yo.user_id, anulada_en = now(), motivo_anulacion = v_motivo
   where id = v_venta.id;
  update public.entradas set estado = 'anulada' where venta_id = v_venta.id;
  perform privado.auditar(v_venta.evento_id, 'anular_venta', jsonb_build_object('venta', v_venta.id, 'motivo', v_motivo,
    'titular', v_venta.titular_nombre, 'cantidad', v_venta.cantidad, 'total', v_venta.total,
    'ya_ingresaron', (select count(*) from public.entradas where venta_id = v_venta.id and ingreso_en is not null)));
  return privado.resumen_venta(v_venta.id);
end;
$$;

drop function if exists public.emitir_cortesia(text, text, int);
create or replace function public.emitir_cortesia(p_nombre text, p_dni text, p_cantidad int, p_tel text default null, p_idem uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_yo     public.perfiles;
  v_ev     public.eventos;
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_dni    text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
  v_tel    text := nullif(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), '');
  v_emit   bigint;
  v_venta  uuid;
  v_token  text;
  v_previa public.ventas;
  i        int;
begin
  v_yo := privado.exigir_rol('admin');
  -- Primero se bloquea la fila del evento: serializa las ventas y hace que
  -- dos pedidos con la misma clave (doble toque simultáneo) se vean entre sí.
  perform 1 from public.eventos e where e.id = (privado.evento_actual()).id for update;
  if p_idem is not null then
    select * into v_previa from public.ventas where idempotency_key = p_idem;
    if v_previa.id is not null then
      v_token := privado.rotar_link_venta(v_previa.id);
      return jsonb_build_object('venta', privado.resumen_venta(v_previa.id), 'evento', privado.datos_evento(v_previa.evento_id),
                                'token', v_token, 'repetida', true);
    end if;
  end if;
  if length(v_nombre) < 3 then perform privado.error('nombre', 'Escribí el nombre y apellido.'); end if;
  if v_dni !~ '^[0-9]{7,8}$' then perform privado.error('dni', 'Revisá el DNI: tiene que tener 7 u 8 números.'); end if;
  if v_tel is not null and length(v_tel) not between 8 and 15 then perform privado.error('tel', 'Revisá el WhatsApp.'); end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 20 then perform privado.error('cantidad', 'La cantidad tiene que ser de 1 a 20.'); end if;

  select e.* into v_ev from public.eventos e where e.id = (privado.evento_actual()).id for update;
  v_emit := privado.emitidas_evento(v_ev.id);
  if v_emit + p_cantidad > v_ev.tope_entradas then
    perform privado.error('tope', case when v_ev.tope_entradas - v_emit <= 0 then 'Se llegó al tope de entradas del evento. Si querés emitir igual, subí el tope.'
      else 'Quedan ' || privado.plural(v_ev.tope_entradas - v_emit, 'lugar', 'lugares') || ' en el evento.' end);
  end if;

  v_token := privado.nuevo_codigo();
  insert into public.ventas (evento_id, canal, titular_nombre, titular_dni, titular_tel, cantidad, precio_unitario, total,
                             medio, link_hash, idempotency_key, creada_por)
  values (v_ev.id, 'cortesia', v_nombre, v_dni, v_tel, p_cantidad, 0, 0, 'cortesia', privado.sha256_hex(v_token), p_idem, v_yo.user_id)
  returning id into v_venta;
  for i in 1 .. p_cantidad loop
    insert into public.entradas (evento_id, venta_id, nro, codigo) values (v_ev.id, v_venta, i, privado.nuevo_codigo());
  end loop;
  perform privado.auditar(v_ev.id, 'emitir_cortesia', jsonb_build_object('venta', v_venta, 'nombre', v_nombre, 'cantidad', p_cantidad));
  return jsonb_build_object('venta', privado.resumen_venta(v_venta), 'evento', privado.datos_evento(v_ev.id),
                            'token', v_token, 'repetida', false);
end;
$$;

drop function if exists public.confirmar_transferencias(uuid[]);
create or replace function public.confirmar_transferencias(p_venta_ids uuid[], p_confirmar boolean default true)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_ev public.eventos;
  v_n  int;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  update public.ventas set transferencia_confirmada = p_confirmar
   where id = any (p_venta_ids) and evento_id = v_ev.id and medio = 'transferencia'
     and transferencia_confirmada is distinct from p_confirmar;
  get diagnostics v_n = row_count;
  perform privado.auditar(v_ev.id, case when p_confirmar then 'confirmar_transferencias' else 'desconfirmar_transferencias' end,
                          jsonb_build_object('ventas', to_jsonb(p_venta_ids), 'cambiadas', v_n));
  return jsonb_build_object('cambiadas', v_n);
end;
$$;

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create or replace function public.auditoria_admin(p_filtros jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_ev public.eventos;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'cuando', a.creado_en, 'quien', p.nombre, 'rol', p.rol, 'accion', a.accion,
      'detalle', a.detalle - 'venta' - 'entrada' - 'rrpp' - 'usuario' - 'h',
      'sobre', coalesce((select x.nombre from public.perfiles x where x.user_id::text in (a.detalle ->> 'rrpp', a.detalle ->> 'usuario')),
                        (select v.titular_nombre from public.ventas v where v.id::text = a.detalle ->> 'venta'),
                        (select v.titular_nombre from public.entradas e join public.ventas v on v.id = e.venta_id where e.id::text = a.detalle ->> 'entrada')))
      order by a.creado_en desc)
    from (select * from public.auditoria a
          where (a.evento_id = v_ev.id or a.evento_id is null)
            and (coalesce(p_filtros ->> 'accion', '') = '' or a.accion = p_filtros ->> 'accion')
          order by a.creado_en desc limit coalesce((p_filtros ->> 'limite')::int, 300)) a
    left join public.perfiles p on p.user_id = a.usuario_id), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Exportes (filas planas para CSV; el CSV lo arma la app)
-- ---------------------------------------------------------------------
create or replace function public.exportar_admin(p_tipo text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_ev public.eventos;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  if p_tipo = 'ventas' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'Fecha', privado.hora_ar(v.creado_en), 'Canal', v.canal, 'RRPP', coalesce(p.nombre, ''), 'Tanda', coalesce(t.nombre, ''),
      'Titular', v.titular_nombre, 'DNI', coalesce(v.titular_dni, ''), 'WhatsApp', coalesce(v.titular_tel, ''),
      'Cantidad', v.cantidad, 'Precio', v.precio_unitario, 'Total', v.total, 'Medio', v.medio,
      'Transferencia confirmada', case when v.medio = 'transferencia' then case when v.transferencia_confirmada then 'Sí' else 'No' end else '' end,
      'Comisión por entrada', v.comision_unitaria, 'Estado', v.estado, 'Motivo anulación', coalesce(v.motivo_anulacion, ''))
      order by v.creado_en)
      from public.ventas v left join public.perfiles p on p.user_id = v.rrpp_id left join public.tandas t on t.id = v.tanda_id
      where v.evento_id = v_ev.id), '[]'::jsonb);
  elsif p_tipo = 'entradas' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'Titular', v.titular_nombre, 'DNI', coalesce(v.titular_dni, ''), 'Entrada', e.nro || ' de ' || v.cantidad,
      'Canal', v.canal, 'Tanda', coalesce(t.nombre, ''), 'RRPP', coalesce(p.nombre, ''), 'Pasada a', coalesce(e.pasada_a, ''),
      'Estado', case when v.estado = 'anulada' then 'anulada' else e.estado end,
      'Ingreso', coalesce(privado.hora_ar(e.ingreso_en), ''), 'Dispositivo', coalesce(e.ingreso_dispositivo, ''))
      order by v.creado_en, e.nro)
      from public.entradas e join public.ventas v on v.id = e.venta_id
      left join public.tandas t on t.id = v.tanda_id left join public.perfiles p on p.user_id = v.rrpp_id
      where e.evento_id = v_ev.id), '[]'::jsonb);
  elsif p_tipo = 'rendiciones' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'RRPP', r.nombre, 'Pueblo', coalesce(r.pueblo, ''), 'Entradas', r.entradas, 'Efectivo cobrado', r.efectivo_cobrado,
      'Transferencias confirmadas', r.transf_confirmadas, 'Transferencias pendientes', r.transf_pendientes,
      'Ya rendido', r.rendido, 'Efectivo a rendir', r.efectivo_a_rendir, 'Comisión ganada', r.comision_ganada,
      'Comisión pagada', r.comision_pagada, 'Comisión a pagar', r.comision_a_pagar)) from privado.rendicion(v_ev.id) r), '[]'::jsonb);
  elsif p_tipo = 'movimientos' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'Fecha', privado.hora_ar(m.creado_en), 'RRPP', p.nombre,
      'Tipo', case m.tipo when 'entrega_efectivo' then 'Entrega de efectivo' else 'Pago de comisión' end,
      'Monto', m.monto, 'Nota', coalesce(m.nota, ''), 'Registró', coalesce(q.nombre, '')) order by m.creado_en)
      from public.movimientos_rrpp m join public.perfiles p on p.user_id = m.rrpp_id left join public.perfiles q on q.user_id = m.registrado_por
      where m.evento_id = v_ev.id), '[]'::jsonb);
  elsif p_tipo = 'ingresos' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'Hora', privado.hora_ar(e.ingreso_en), 'Titular', v.titular_nombre, 'Entrada', e.nro || ' de ' || v.cantidad,
      'Canal', v.canal, 'Tanda', coalesce(t.nombre, ''), 'Dispositivo', coalesce(e.ingreso_dispositivo, '')) order by e.ingreso_en)
      from public.entradas e join public.ventas v on v.id = e.venta_id left join public.tandas t on t.id = v.tanda_id
      where e.evento_id = v_ev.id and e.ingreso_en is not null and v.estado = 'activa' and e.estado = 'valida'), '[]'::jsonb);
  end if;
  perform privado.error('datos', 'Elegí qué querés exportar.');
end;
$$;

-- ---------------------------------------------------------------------
-- Cierre del evento: resumen para el Excel de escenarios
-- ---------------------------------------------------------------------
create or replace function public.resumen_cierre()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_ev public.eventos;
begin
  perform privado.exigir_rol('admin');
  v_ev := privado.ev_admin();
  return jsonb_build_object(
    'evento', jsonb_build_object('nombre', v_ev.nombre, 'artista', v_ev.artista, 'fecha', v_ev.fecha, 'tope', v_ev.tope_entradas),
    'por_tanda', (select coalesce(jsonb_agg(jsonb_build_object('tanda', x.tanda, 'canal', x.canal, 'entradas', x.entradas, 'total', x.total)
                                            order by x.orden nulls last, x.canal), '[]'::jsonb)
                  from (select coalesce(t.nombre, case v.canal when 'cortesia' then 'Cortesías' else 'Sin tanda' end) as tanda,
                               v.canal, t.orden, sum(v.cantidad) as entradas, sum(v.total) as total
                        from public.ventas v left join public.tandas t on t.id = v.tanda_id
                        where v.evento_id = v_ev.id and v.estado = 'activa' group by 1, v.canal, t.orden) x),
    'emitidas', privado.emitidas_evento(v_ev.id),
    'ingresaron', privado.adentro(v_ev.id),
    'no_ingresaron', privado.emitidas_evento(v_ev.id) - privado.adentro(v_ev.id),
    'recaudado', (select coalesce(sum(total), 0) from public.ventas where evento_id = v_ev.id and estado = 'activa'),
    'efectivo', (select coalesce(sum(total), 0) from public.ventas where evento_id = v_ev.id and estado = 'activa' and medio = 'efectivo'),
    'transferencias', (select coalesce(sum(total), 0) from public.ventas where evento_id = v_ev.id and estado = 'activa' and medio = 'transferencia'),
    'comisiones', (select coalesce(sum(comision_ganada), 0) from privado.rendicion(v_ev.id)),
    'anuladas', (select coalesce(sum(cantidad), 0) from public.ventas where evento_id = v_ev.id and estado = 'anulada'),
    'ingresos_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'n', n) order by h), '[]'::jsonb) from (
                 select to_char(date_trunc('hour', e.ingreso_en at time zone 'America/Argentina/Buenos_Aires'), 'DD/MM HH24":00"') h, count(*) n
                 from public.entradas e join public.ventas v on v.id = e.venta_id
                 where e.evento_id = v_ev.id and e.ingreso_en is not null and v.estado = 'activa' group by 1) x));
end;
$$;

-- ---------------------------------------------------------------------
-- Anonimizar DNI y teléfono. NO se ejecuta sola: M decide cuándo.
-- Exige el evento cerrado y escribir ANONIMIZAR para confirmar.
-- ---------------------------------------------------------------------
drop function if exists public.anonimizar_datos_personales(uuid);
create or replace function public.anonimizar_datos_personales(p_evento_id uuid, p_confirmacion text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_ev public.eventos;
  v_n  int;
begin
  perform privado.exigir_rol('admin');
  select * into v_ev from public.eventos where id = coalesce(p_evento_id, (privado.evento_actual()).id);
  if v_ev.estado <> 'cerrado' then perform privado.error('abierto', 'Primero cerrá el evento.'); end if;
  if coalesce(p_confirmacion, '') <> 'ANONIMIZAR' then
    perform privado.error('confirmar', 'Para confirmar escribí ANONIMIZAR.');
  end if;
  update public.ventas set titular_dni = case when titular_dni is null then null else '00000000' end, titular_tel = null
   where evento_id = v_ev.id;
  get diagnostics v_n = row_count;
  perform privado.auditar(v_ev.id, 'anonimizar', jsonb_build_object('ventas', v_n));
  return jsonb_build_object('ventas', v_n);
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol_actual() to authenticated;
grant execute on function privado.es_admin()   to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.tablero_admin()', 'public.rendicion_admin()', 'public.registrar_movimiento_rrpp(uuid, text, numeric, text)',
    'public.usuarios_admin()', 'public.ajustar_rrpp(uuid, numeric, text, numeric)', 'public.activar_usuario(uuid, boolean)',
    'public.evento_admin()', 'public.ajustar_evento(uuid, jsonb)', 'public.ajustar_tanda(uuid, jsonb)',
    'public.ajustar_config_club(jsonb)', 'public.ventas_admin(jsonb)', 'public.anular_venta(uuid, text)',
    'public.emitir_cortesia(text, text, int, text, uuid)', 'public.confirmar_transferencias(uuid[], boolean)',
    'public.auditoria_admin(jsonb)', 'public.exportar_admin(text)', 'public.resumen_cierre()',
    'public.anonimizar_datos_personales(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Solo la service role (Edge Function de usuarios).
revoke all on function public.admin_registrar_usuario(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_clave_temporal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_registrar_usuario(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.admin_clave_temporal(uuid, uuid) to service_role;
