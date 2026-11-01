-- =====================================================================
-- 0005 · Fase 2: link del comprador
-- ver_entradas, pasar_entrada, ver_entrada_pasada y evento_del_link.
-- Son las únicas funciones que puede llamar anon.
--
-- Importante: los fallos de DNI NO se informan con RAISE, porque un error
-- deshace la transacción y con ella el conteo de intentos. Estas funciones
-- devuelven {ok:false, motivo, mensaje} y el conteo queda guardado.
-- =====================================================================

-- Mensajes para la persona (sin datos internos y sin distinguir si el
-- link existe o si el DNI está mal).
create or replace function privado.msj_link_fallido()
returns text language sql immutable set search_path = public
as $$ select 'No pudimos abrir tus entradas. Revisá el DNI e intentá de nuevo.' $$;

create or replace function privado.msj_link_bloqueado()
returns text language sql immutable set search_path = public
as $$ select 'Hiciste muchos intentos. Esperá 15 minutos y probá de nuevo.' $$;

create or replace function privado.token_valido(p_token text)
returns boolean language sql immutable set search_path = public
as $$ select coalesce(p_token ~ '^[A-Z2-7]{26}$', false) $$;

-- ¿Está bloqueado este link? (bloquea la fila para serializar intentos)
create or replace function privado.link_bloqueado(p_hash text)
returns boolean
language plpgsql
set search_path = public
as $$
declare v public.intentos_link;
begin
  insert into public.intentos_link (link_hash) values (p_hash) on conflict (link_hash) do nothing;
  select * into v from public.intentos_link where link_hash = p_hash for update;
  return v.bloqueado_hasta is not null and v.bloqueado_hasta > privado.ahora();
end;
$$;

-- Suma un intento fallido. Al quinto: bloqueo de 15 minutos.
create or replace function privado.link_fallo(p_hash text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_intentos int;
begin
  update public.intentos_link
     set intentos = case when bloqueado_hasta is not null and bloqueado_hasta <= privado.ahora() then 1 else intentos + 1 end,
         bloqueado_hasta = case when bloqueado_hasta is not null and bloqueado_hasta <= privado.ahora() then null else bloqueado_hasta end
   where link_hash = p_hash
  returning intentos into v_intentos;
  if v_intentos >= 5 then
    update public.intentos_link set bloqueado_hasta = privado.ahora() + interval '15 minutes', intentos = 0
     where link_hash = p_hash;
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'mensaje', privado.msj_link_bloqueado());
  end if;
  return jsonb_build_object('ok', false, 'motivo', 'dni', 'mensaje', privado.msj_link_fallido());
end;
$$;

create or replace function privado.link_ok(p_hash text)
returns void language sql set search_path = public
as $$ delete from public.intentos_link where link_hash = p_hash $$;

-- Valida token + DNI del titular. Devuelve la venta o, si falla, el jsonb
-- de error en p_error (y la venta en NULL).
create or replace function privado.abrir_link(p_token text, p_dni text, out p_venta public.ventas, out p_error jsonb)
language plpgsql
set search_path = public
as $$
declare
  v_hash text;
  v_dni  text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
begin
  if not privado.token_valido(p_token) then
    p_error := jsonb_build_object('ok', false, 'motivo', 'link', 'mensaje',
      'Este link no está completo. Pedile a quien te vendió la entrada que te lo vuelva a mandar.');
    return;
  end if;
  v_hash := privado.sha256_hex(p_token);
  if privado.link_bloqueado(v_hash) then
    p_error := jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'mensaje', privado.msj_link_bloqueado());
    return;
  end if;
  select * into p_venta from public.ventas where link_hash = v_hash;
  if p_venta.id is null or p_venta.titular_dni is null or p_venta.titular_dni <> v_dni then
    p_venta := null;
    p_error := privado.link_fallo(v_hash);
    return;
  end if;
  perform privado.link_ok(v_hash);
end;
$$;

create or replace function privado.evento_publico(p_evento uuid)
returns jsonb language sql stable set search_path = public
as $$
  select jsonb_build_object('nombre', e.nombre, 'artista', e.artista, 'fecha', e.fecha, 'lugar', e.lugar,
                            'club', (select nombre_club from public.config_club where id = 1))
  from public.eventos e where e.id = p_evento
$$;

-- ---------------------------------------------------------------------
-- evento_del_link: encabezado de la página (artista, fecha, lugar) antes
-- de pedir el DNI. No muestra nada de la venta.
-- ---------------------------------------------------------------------
create or replace function public.evento_del_link(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_evento uuid;
begin
  if not privado.token_valido(p_token) then return null; end if;
  select v.evento_id into v_evento from public.ventas v where v.link_hash = privado.sha256_hex(p_token);
  if v_evento is null then
    select e.evento_id into v_evento from public.entradas e where e.link_propio_hash = privado.sha256_hex(p_token);
  end if;
  if v_evento is null then return null; end if;
  return privado.evento_publico(v_evento);
end;
$$;

-- ---------------------------------------------------------------------
-- ver_entradas: el titular abre su link con su DNI.
-- ---------------------------------------------------------------------
create or replace function public.ver_entradas(p_token text, p_dni text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
begin
  select * into r from privado.abrir_link(p_token, p_dni);
  if r.p_error is not null then return r.p_error; end if;

  return jsonb_build_object(
    'ok', true,
    'titular', (r.p_venta).titular_nombre,
    'cantidad', (r.p_venta).cantidad,
    'estado', (r.p_venta).estado,
    'tanda', (select t.nombre from public.tandas t where t.id = (r.p_venta).tanda_id),
    'evento', privado.evento_publico((r.p_venta).evento_id),
    'entradas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nro', e.nro,
               'estado', e.estado,
               'codigo', case when e.estado = 'valida' and (r.p_venta).estado = 'activa' then e.codigo end,
               'ingreso', e.ingreso_en,
               'pasada_a', e.pasada_a,
               'pasada', e.link_propio_hash is not null)
             order by e.nro)
      from public.entradas e where e.venta_id = (r.p_venta).id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- pasar_entrada: el titular manda una entrada a otra persona. Genera un
-- link individual (si ya había uno, lo reemplaza: el anterior deja de andar).
-- ---------------------------------------------------------------------
create or replace function public.pasar_entrada(p_token text, p_dni text, p_nro int, p_nombre text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  v_ent    public.entradas;
  v_nombre text := nullif(left(regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), 40), '');
  v_token  text;
begin
  select * into r from privado.abrir_link(p_token, p_dni);
  if r.p_error is not null then return r.p_error; end if;

  select * into v_ent from public.entradas where venta_id = (r.p_venta).id and nro = p_nro for update;
  if v_ent.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'nro', 'mensaje', 'No encontramos esa entrada.');
  end if;
  if (r.p_venta).estado <> 'activa' or v_ent.estado <> 'valida' then
    return jsonb_build_object('ok', false, 'motivo', 'anulada', 'mensaje', 'Esta entrada fue anulada. Consultá con quien te la vendió.');
  end if;
  if v_ent.ingreso_en is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ingreso', 'mensaje', 'Esta entrada ya se usó para entrar.');
  end if;

  v_token := privado.nuevo_codigo();
  update public.entradas
     set link_propio_hash = privado.sha256_hex(v_token), pasada_a = v_nombre
   where id = v_ent.id;

  perform privado.auditar(v_ent.evento_id, 'pasar_entrada',
    jsonb_build_object('venta', v_ent.venta_id, 'nro', v_ent.nro, 'nombre', v_nombre,
                       'reemplaza_link', v_ent.link_propio_hash is not null));

  return jsonb_build_object('ok', true, 'token', v_token, 'nro', v_ent.nro, 'nombre', v_nombre);
end;
$$;

-- ---------------------------------------------------------------------
-- ver_entrada_pasada: quien recibe ve solo esa entrada. Sin DNI.
-- Del titular solo se muestra el primer nombre ("Te la pasó Ana").
-- ---------------------------------------------------------------------
create or replace function public.ver_entrada_pasada(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_ent   public.entradas;
  v_venta public.ventas;
begin
  if privado.token_valido(p_token) then
    select * into v_ent from public.entradas where link_propio_hash = privado.sha256_hex(p_token);
  end if;
  if v_ent.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'link', 'mensaje',
      'Este link ya no funciona. Pedile a quien te pasó la entrada que te la vuelva a mandar.');
  end if;
  select * into v_venta from public.ventas where id = v_ent.venta_id;
  return jsonb_build_object(
    'ok', true,
    'nro', v_ent.nro,
    'cantidad', v_venta.cantidad,
    'para', v_ent.pasada_a,
    'de', split_part(trim(v_venta.titular_nombre), ' ', 1),
    'tanda', (select t.nombre from public.tandas t where t.id = v_venta.tanda_id),
    'estado', case when v_venta.estado = 'activa' then v_ent.estado else 'anulada' end,
    'codigo', case when v_ent.estado = 'valida' and v_venta.estado = 'activa' then v_ent.codigo end,
    'ingreso', v_ent.ingreso_en,
    'evento', privado.evento_publico(v_ent.evento_id));
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;
grant execute on function privado.rol_actual() to authenticated;
grant execute on function privado.es_admin()   to authenticated;

revoke all on function public.evento_del_link(text) from public;
grant execute on function public.evento_del_link(text)               to anon, authenticated;
grant execute on function public.ver_entradas(text, text)             to anon, authenticated;
grant execute on function public.pasar_entrada(text, text, int, text) to anon, authenticated;
grant execute on function public.ver_entrada_pasada(text)             to anon, authenticated;
