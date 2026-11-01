-- =====================================================================
-- Tests de la fase 1: emitir_venta y compañía.
-- Corre después de cargar la semilla. Reloj fijo con privado.ahora().
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

\i tests/sql/_helpers.sql

-- Reloj: 10/11/2026 al mediodía (Anticipada vigente por fecha)
create or replace function privado.ahora() returns timestamptz language sql stable as
  $$ select '2026-11-10 12:00:00-03'::timestamptz $$;

-- Emite como un usuario (llamar con role authenticated)
create function pruebas.emitir(p_user uuid, p_cant int, p_medio text default 'efectivo',
                               p_idem uuid default gen_random_uuid(),
                               p_nombre text default 'Ana Pérez', p_dni text default '30111222',
                               p_tel text default '5493401551234')
returns jsonb language plpgsql as $$
begin
  perform pruebas.como(p_user);
  return public.emitir_venta(p_idem, p_nombre, p_dni, p_tel, p_cant, p_medio);
end $$;
grant execute on all functions in schema pruebas to authenticated;

\echo
\echo '== Emisión básica'
set role authenticated;
select pruebas.emitir(:lucia, 2, 'efectivo', '11111111-1111-4111-8111-111111111111') as r1 \gset
reset role;
select (:'r1'::jsonb #>> '{venta,ref}') as v1, (:'r1'::jsonb ->> 'token') as tok1 \gset

select pruebas.ok((:'r1'::jsonb #>> '{venta,precio}')::numeric = 20000, 'precio de la Anticipada puesto por el servidor ($20.000)');
select pruebas.ok((:'r1'::jsonb #>> '{venta,total}')::numeric = 40000, 'total = precio × cantidad');
select pruebas.ok(:'r1'::jsonb #>> '{venta,tanda}' = 'Anticipada', 'sale en la tanda vigente');
select pruebas.ok(:'tok1' ~ '^[A-Z2-7]{26}$', 'devuelve un token de 128 bits');
select pruebas.ok((select comision_unitaria from public.ventas where id = :'v1') = 750, 'copia la comisión de Lucía ($750)');
select pruebas.ok((select link_hash from public.ventas where id = :'v1') = privado.sha256_hex(:'tok1'), 'guarda solo el sha256 del token');
select pruebas.ok(not exists (
  select 1 from public.ventas v where v.link_hash = :'tok1' or v.titular_nombre = :'tok1'
  union all select 1 from public.entradas e where e.codigo = :'tok1'), 'el token no queda guardado en ningún lado');
select pruebas.ok((select count(distinct codigo) from public.entradas where venta_id = :'v1') = 2, 'genera una entrada con código propio por persona');
select pruebas.ok((select array_agg(nro order by nro) from public.entradas where venta_id = :'v1') = array[1,2], 'entradas numeradas 1..cantidad');
select pruebas.ok((select count(*) from public.auditoria where accion = 'emitir_venta' and detalle->>'venta' = :'v1') = 1, 'queda en auditoría');
select pruebas.ok((select titular_tel from public.ventas where id = :'v1') = '5493401551234', 'guarda el WhatsApp');
select pruebas.ok(not exists (
  select 1 from pg_proc p, unnest(coalesce(p.proargnames, '{}')) a
  where p.proname = 'emitir_venta' and a <> 'p_precio_visto' and a ~* 'precio|comision|total|tanda|rrpp'),
  'emitir_venta no recibe precio, comisión, tanda ni RRPP del cliente');

\echo
\echo '== Doble toque / reintento'
set role authenticated;
select pruebas.emitir(:lucia, 2, 'efectivo', '11111111-1111-4111-8111-111111111111') as r1b \gset
reset role;
select pruebas.ok((:'r1b'::jsonb ->> 'repetida')::boolean, 'el reintento se reconoce');
select pruebas.ok((select count(*) from public.ventas where idempotency_key = '11111111-1111-4111-8111-111111111111') = 1, 'el doble toque no duplica la venta');
select pruebas.ok((select count(*) from public.entradas where venta_id = :'v1') = 2, 'ni las entradas');
select pruebas.ok((select link_hash from public.ventas where id = :'v1') = privado.sha256_hex(:'r1b'::jsonb ->> 'token')
                  and (:'r1b'::jsonb ->> 'token') <> :'tok1', 'el reintento entrega un link nuevo e invalida el anterior');
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000012', 1, 'efectivo', '11111111-1111-4111-8111-111111111111')$$,
                     'P0001', 'otro RRPP no puede reusar la clave de una venta ajena', 'datos');

\echo
\echo '== Validaciones'
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1, 'efectivo', gen_random_uuid(), 'Ana', '123')$$, 'P0001', 'DNI corto', 'dni');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1, 'efectivo', gen_random_uuid(), 'Ana', '123456789')$$, 'P0001', 'DNI largo', 'dni');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1, 'efectivo', gen_random_uuid(), '   ')$$, 'P0001', 'nombre vacío', 'nombre');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 7)$$, 'P0001', 'más que el máximo por venta (6)', 'cantidad');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 0)$$, 'P0001', 'cantidad 0', 'cantidad');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1, 'cortesia')$$, 'P0001', 'el RRPP no puede emitir cortesías', 'medio');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1, 'efectivo', gen_random_uuid(), 'Ana', '30111222', '12')$$, 'P0001', 'WhatsApp inválido', 'tel');
select pruebas.emitir(:lucia, 1, 'transferencia', gen_random_uuid(), '  Juan   Díaz ', '30.222.333', '') as r2 \gset
select pruebas.ok(:'r2'::jsonb #>> '{venta,nombre}' = 'Juan Díaz' and :'r2'::jsonb #>> '{venta,dni}' = '30222333'
                  and :'r2'::jsonb #>> '{venta,tel}' is null, 'normaliza nombre, DNI con puntos y WhatsApp vacío');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000021', 1)$$, 'P0001', 'puerta no emite', 'sin_permiso');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000031', 1)$$, 'P0001', 'caja no emite por acá', 'sin_permiso');
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000001', 1)$$, 'P0001', 'admin no emite como RRPP', 'sin_permiso');
select pruebas.como(:lucia);
select pruebas.falla($$select public.emitir_venta(gen_random_uuid(), 'Ana Pérez', '30111222', null, 1, 'efectivo', 1)$$,
                     'P0001', 'con un precio visto distinto no emite (ni más barato)', 'precio_cambio');
select pruebas.ok((public.emitir_venta(gen_random_uuid(), 'Ana Pérez', '30111222', null, 1, 'efectivo', 20000) #>> '{venta,precio}')::numeric = 20000,
                  'con el precio visto correcto emite normal');
reset role;

\echo
\echo '== Comisión congelada y ad honorem'
update public.rrpp_evento set comision_por_entrada = 1000 where rrpp_id = :lucia;
set role authenticated;
select pruebas.emitir(:lucia, 1) as r3 \gset
select pruebas.emitir(:martin, 1) as r4 \gset
reset role;
select pruebas.ok((select comision_unitaria from public.ventas where id = (:'r3'::jsonb #>> '{venta,ref}')::uuid) = 1000, 'la venta nueva usa la comisión nueva');
select pruebas.ok((select comision_unitaria from public.ventas where id = :'v1') = 750, 'la venta anterior conserva su comisión');
select pruebas.ok((select comision_unitaria from public.ventas where id = (:'r4'::jsonb #>> '{venta,ref}')::uuid) = 0, 'Martín vende ad honorem ($0)');

\echo
\echo '== Stock de la tanda y cambio de tanda'
-- Dejar 3 lugares en la Anticipada
update public.tandas set cantidad = privado.emitidas_tanda(id) + 3 where id = :anticip;
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000012', 4)$$, 'P0001', 'no parte la venta: "Quedan 3 entradas de la Anticipada."', 'stock_tanda');
select pruebas.ok(public.inicio_rrpp() #>> '{tanda,nombre}' = 'Anticipada', 'sigue la Anticipada mientras tenga stock');
select pruebas.emitir(:martin, 3) as r5 \gset
select pruebas.ok(:'r5'::jsonb #>> '{venta,tanda}' = 'Anticipada', 'vende las últimas 3 de la Anticipada');
select pruebas.emitir(:martin, 1) as r6 \gset
select pruebas.ok(:'r6'::jsonb #>> '{venta,tanda}' = 'General' and (:'r6'::jsonb #>> '{venta,precio}')::numeric = 23000,
                  'agotada la Anticipada, la siguiente sale a precio General aunque no llegó su fecha');
select pruebas.ok(public.inicio_rrpp() ->> 'aviso_tanda' = 'Se agotó la Anticipada. Ahora vendés General a $23.000.', 'Inicio avisa el cambio de tanda');
reset role;

-- Mensaje exacto del stock
update public.tandas set cantidad = privado.emitidas_tanda(id) + 3 where id = :anticip;
set role authenticated;
do $$
declare v_msg text;
begin
  perform pruebas.emitir('00000000-0000-4000-8000-000000000012', 4);
exception when others then
  get stacked diagnostics v_msg = message_text;
  perform pruebas.ok(v_msg = 'Quedan 3 entradas de la Anticipada.', 'mensaje: "Quedan 3 entradas de la Anticipada."');
end $$;
reset role;
update public.tandas set cantidad = privado.emitidas_tanda(id) where id = :anticip;

\echo
\echo '== Límite por RRPP'
-- Sofía: 20% de la tanda. General con 20 → límite 4.
update public.tandas set cantidad = 20 where id = '00000000-0000-4000-8000-0000000000a2';
set role authenticated;
select pruebas.como(:lucia);
select pruebas.ok((public.inicio_rrpp() #>> '{tanda,limite}')::int is null, 'Lucía sin límite propio');
select pruebas.como(:sofia);
select pruebas.ok((public.inicio_rrpp() #>> '{tanda,limite}')::int = 4, 'Sofía: 20% de 20 = 4');
select pruebas.emitir(:sofia, 4) as r7 \gset
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000013', 1)$$, 'P0001', 'Sofía no pasa su límite', 'limite_rrpp');
select pruebas.como(:sofia);
select pruebas.ok((public.inicio_rrpp() #>> '{tanda,te_quedan}')::int = 0, 'Inicio: le quedan 0');
reset role;
update public.tandas set cantidad = 30 where id = '00000000-0000-4000-8000-0000000000a2';
set role authenticated;
select pruebas.como(:sofia);
select pruebas.ok((public.inicio_rrpp() #>> '{tanda,limite}')::int = 6, 'el % se recalcula solo al cambiar la cantidad (20% de 30 = 6)');
select pruebas.emitir(:sofia, 2) as r8 \gset
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000013', 1)$$, 'P0001', 'y vuelve a frenar en 6', 'limite_rrpp');
reset role;
update public.rrpp_evento set limite_tipo = 'cantidad', limite_valor = 2 where rrpp_id = :lucia;
set role authenticated;
do $$
declare v_msg text;
begin
  perform pruebas.emitir('00000000-0000-4000-8000-000000000011', 3);
  perform pruebas.ok(false, 'límite fijo');
exception when others then
  get stacked diagnostics v_msg = message_text;
  perform pruebas.ok(v_msg = 'Te quedan 2 entradas en esta tanda.', 'límite fijo de 2: "Te quedan 2 entradas en esta tanda."');
end $$;
reset role;
update public.rrpp_evento set limite_tipo = 'sin_limite', limite_valor = null where rrpp_id = :lucia;

\echo
\echo '== Tope general'
update public.tandas set cantidad = 500 where id = '00000000-0000-4000-8000-0000000000a2';
update public.eventos set tope_entradas = privado.emitidas_evento(id) + 1 where id = :evento;
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 2)$$, 'P0001', 'el tope manda aunque la tanda tenga stock', 'tope');
select pruebas.emitir(:lucia, 1) as r9 \gset
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1)$$, 'P0001', 'al llegar al tope se bloquea', 'tope');
reset role;
-- Cortesías y caja también cuentan para el tope
update public.eventos set tope_entradas = privado.emitidas_evento(id) + 2 where id = :evento;
insert into public.ventas (evento_id, canal, titular_nombre, cantidad, precio_unitario, total, medio)
values (:evento, 'cortesia', 'Invitado', 2, 0, 0, 'cortesia');
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1)$$, 'P0001', 'las cortesías cuentan para el tope', 'tope');
reset role;
update public.eventos set tope_entradas = 1000 where id = :evento;

\echo
\echo '== Cierre, estado y habilitación'
update public.eventos set cierre_venta_rrpp = '2026-11-10 11:59:00-03' where id = :evento;
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1)$$, 'P0001', 'después del cierre de venta RRPP no emite', 'venta_cerrada');
select pruebas.como(:lucia);
select pruebas.ok(not (public.inicio_rrpp() ->> 'puede_vender')::boolean, 'Inicio avisa que la venta cerró');
reset role;
update public.eventos set cierre_venta_rrpp = '2026-12-15 23:59:59-03', estado = 'borrador' where id = :evento;
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1)$$, 'P0001', 'evento en borrador: no emite', 'venta_cerrada');
reset role;
update public.eventos set estado = 'venta' where id = :evento;
delete from public.rrpp_evento where rrpp_id = :martin;
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000012', 1)$$, 'P0001', 'RRPP sin condiciones en el evento: no emite', 'no_habilitado');
reset role;
insert into public.rrpp_evento (evento_id, rrpp_id) values (:evento, :martin);
update public.perfiles set activo = false where user_id = :martin;
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000012', 1)$$, 'P0001', 'usuario desactivado: no emite', 'usuario_inactivo');
reset role;
update public.perfiles set activo = true where user_id = :martin;

\echo
\echo '== Fechas de las tandas'
update public.tandas set cantidad = 500 where id = :anticip;
create or replace function privado.ahora() returns timestamptz language sql stable as $$ select '2026-10-20 12:00:00-03'::timestamptz $$;
set role authenticated;
select pruebas.falla($$select pruebas.emitir('00000000-0000-4000-8000-000000000011', 1)$$, 'P0001', 'antes de la Anticipada: "No hay entradas a la venta"', 'sin_tanda');
reset role;
create or replace function privado.ahora() returns timestamptz language sql stable as $$ select '2026-12-05 12:00:00-03'::timestamptz $$;
set role authenticated;
select pruebas.emitir(:lucia, 1) as r10 \gset
select pruebas.ok(:'r10'::jsonb #>> '{venta,tanda}' = 'General', 'vencida la Anticipada por fecha, vende General');
select pruebas.como(:lucia);
select pruebas.ok(public.inicio_rrpp() ->> 'aviso_tanda' is null, 'sin aviso de "se agotó" si terminó por fecha');
reset role;
create or replace function privado.ahora() returns timestamptz language sql stable as $$ select '2026-11-10 12:00:00-03'::timestamptz $$;

\echo
\echo '== Reenviar link, detalle y enviada'
set role authenticated;
select pruebas.como(:lucia);
select public.reenviar_link(:'v1') as rl \gset
reset role;
select pruebas.ok((select link_hash from public.ventas where id = :'v1') = privado.sha256_hex(:'rl'::jsonb ->> 'token'), 'reenviar rota el link (el anterior deja de andar)');
select pruebas.ok((select count(*) from public.auditoria where accion = 'reenviar_link') = 1, 'el reenvío queda en auditoría');
set role authenticated;
select pruebas.como(:martin);
select pruebas.falla(format('select public.reenviar_link(%L)', :'v1'), 'P0001', 'otro RRPP no puede reenviar una venta ajena', 'no_encontrada');
select pruebas.falla(format('select public.detalle_venta(%L)', :'v1'), 'P0001', 'otro RRPP no ve el detalle ajeno', 'no_encontrada');
select public.marcar_enviada(:'v1');
select pruebas.como(:admin);
select pruebas.ok((public.reenviar_link(:'v1') ->> 'token') is not null, 'el admin también puede reenviar');
select pruebas.como(:lucia);
select pruebas.ok(not (public.detalle_venta(:'v1') ->> 'enviada')::boolean, 'marcar ajena no cambia nada');
select public.marcar_enviada(:'v1');
select public.detalle_venta(:'v1') as det \gset
select pruebas.ok((:'det'::jsonb ->> 'enviada')::boolean, 'queda marcada como enviada');
select pruebas.ok(jsonb_array_length(:'det'::jsonb -> 'entradas') = 2
                  and :'det'::jsonb #>> '{entradas,0,estado}' = 'valida', 'detalle con el estado de cada entrada');
select pruebas.ok(:'det'::text !~ '"codigo"', 'el detalle no expone los códigos de los QR');
reset role;

\echo
\echo '== Inicio del RRPP: cuentas'
insert into public.movimientos_rrpp (evento_id, rrpp_id, tipo, monto) values
  (:evento, :lucia, 'entrega_efectivo', 30000), (:evento, :lucia, 'pago_comision', 750);
set role authenticated;
select pruebas.como(:lucia);
select public.inicio_rrpp() as ini \gset
reset role;
select
  sum(cantidad) filter (where estado = 'activa') as e_vend,
  sum(total) filter (where estado = 'activa' and medio = 'efectivo') as e_efec,
  sum(total) filter (where estado = 'activa' and medio = 'transferencia') as e_transf,
  sum(cantidad * comision_unitaria) filter (where estado = 'activa') as e_com
from public.ventas where rrpp_id = :lucia \gset
select pruebas.ok((:'ini'::jsonb ->> 'vendidas')::numeric = :e_vend, 'vendidas = Σ cantidad (' || :e_vend || ')');
select pruebas.ok((:'ini'::jsonb ->> 'efectivo_a_rendir')::numeric = :e_efec - 30000, 'efectivo a rendir = cobrado − rendido, sin descontar comisión');
select pruebas.ok((:'ini'::jsonb ->> 'transferencias')::numeric = :e_transf, 'transferencias aparte');
select pruebas.ok((:'ini'::jsonb ->> 'comision_ganada')::numeric = :e_com and (:'ini'::jsonb ->> 'comision_pagada')::numeric = 750,
                  'comisión ganada (congelada por venta) y pagada');
select pruebas.ok(not (:'ini'::jsonb ->> 'ad_honorem')::boolean, 'Lucía no es ad honorem');
select pruebas.ok(jsonb_array_length(:'ini'::jsonb -> 'ventas') = (select count(*) from public.ventas where rrpp_id = :lucia), 've todas sus ventas y nada más');
set role authenticated;
select pruebas.como(:martin);
select pruebas.ok((public.inicio_rrpp() ->> 'ad_honorem')::boolean, 'Martín es ad honorem: no se muestra comisión');
reset role;

\echo
\echo 'Fase 1: todos los chequeos pasaron.'
