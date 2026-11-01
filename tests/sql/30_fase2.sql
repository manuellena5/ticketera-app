-- =====================================================================
-- Tests de la fase 2: link del comprador (anon).
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

\i tests/sql/_helpers.sql

create or replace function privado.ahora() returns timestamptz language sql stable as
  $$ select '2026-11-10 12:00:00-03'::timestamptz $$;

-- Venta de Lucía a Ana (2 entradas) y otra a Juan
set role authenticated;
select pruebas.como(:lucia);
select public.emitir_venta(gen_random_uuid(), 'Ana Pérez', '30111222', null, 2, 'efectivo') as r1 \gset
select public.emitir_venta(gen_random_uuid(), 'Juan Díaz', '31222333', null, 3, 'efectivo') as r2 \gset
reset role;
select (:'r1'::jsonb ->> 'token') as tok, (:'r1'::jsonb #>> '{venta,ref}') as v1, (:'r2'::jsonb ->> 'token') as tok2 \gset

\echo
\echo '== Ver entradas con DNI'
set role anon;
select pruebas.como(null);
select public.ver_entradas(:'tok', '30.111.222') as ve \gset
select pruebas.ok((:'ve'::jsonb ->> 'ok')::boolean, 'con el DNI del titular abre (acepta puntos)');
select pruebas.ok(:'ve'::jsonb ->> 'titular' = 'Ana Pérez' and :'ve'::jsonb ->> 'tanda' = 'Anticipada'
                  and (:'ve'::jsonb ->> 'cantidad')::int = 2, 'titular, tanda y cantidad');
select pruebas.ok(:'ve'::jsonb #>> '{evento,artista}' = 'Simón Aguirre' and :'ve'::jsonb #>> '{evento,club}' = 'Club Deportivo Mitre', 'datos del evento');
select pruebas.ok(jsonb_array_length(:'ve'::jsonb -> 'entradas') = 2
                  and (select bool_and(x ->> 'codigo' ~ '^[A-Z2-7]{26}$') from jsonb_array_elements(:'ve'::jsonb -> 'entradas') x),
                  'devuelve solo sus 2 entradas con su código');
select pruebas.ok(:'ve'::text !~* '"(dni|titular_dni|tel|ref|id|venta_id|link_hash|rrpp|comision|precio|total)"',
                  'no devuelve DNI, teléfono, IDs, precio ni datos del RRPP');
select pruebas.ok(public.evento_del_link(:'tok') ->> 'artista' = 'Simón Aguirre', 'el encabezado del evento se ve antes del DNI');
select pruebas.ok(public.evento_del_link('AAAAAAAAAAAAAAAAAAAAAAAAAA') is null and public.evento_del_link('x') is null, 'con un link inventado no muestra nada');
select pruebas.ok(public.evento_del_link(:'tok') - 'nombre' - 'artista' - 'fecha' - 'lugar' - 'club' = '{}'::jsonb, 'el encabezado no trae datos de la venta');
reset role;
select pruebas.ok(:'ve'::jsonb #>> '{entradas,0,codigo}' = (select codigo from public.entradas where venta_id = :'v1' and nro = 1), 'el código es el de la entrada 1');

\echo
\echo '== Freno de fuerza bruta'
set role anon;
select pruebas.ok(public.ver_entradas(:'tok', '30111223') ->> 'motivo' = 'dni', 'DNI incorrecto: no muestra nada (intento 1)');
select pruebas.ok(public.ver_entradas(:'tok', '1') ->> 'motivo' = 'dni', 'intento 2');
select pruebas.ok(public.ver_entradas(:'tok', '') ->> 'motivo' = 'dni', 'intento 3');
select public.ver_entradas(:'tok', '31222333') as f4 \gset
select pruebas.ok(:'f4'::jsonb ->> 'motivo' = 'dni' and :'f4'::jsonb ? 'entradas' = false, 'intento 4 (con el DNI de otro comprador): nada');
select public.ver_entradas(:'tok', '99999999') as f5 \gset
select pruebas.ok(:'f5'::jsonb ->> 'motivo' = 'bloqueado', 'al quinto intento fallido se bloquea');
select pruebas.ok(:'f5'::jsonb ->> 'mensaje' = 'Hiciste muchos intentos. Esperá 15 minutos y probá de nuevo.', 'mensaje de bloqueo claro');
select pruebas.ok(public.ver_entradas(:'tok', '30111222') ->> 'motivo' = 'bloqueado', 'bloqueado: ni con el DNI correcto');
select pruebas.ok(public.pasar_entrada(:'tok', '30111222', 1, 'x') ->> 'motivo' = 'bloqueado', 'bloqueado también para pasar entradas');
select pruebas.ok(public.ver_entradas(:'tok2', '31222333') ->> 'ok' = 'true', 'el bloqueo es solo de ese link');
reset role;
select pruebas.ok((select bloqueado_hasta from public.intentos_link where link_hash = privado.sha256_hex(:'tok')) = '2026-11-10 12:15:00-03',
                  'el bloqueo queda guardado (15 minutos)');
create or replace function privado.ahora() returns timestamptz language sql stable as $$ select '2026-11-10 12:16:00-03'::timestamptz $$;
set role anon;
select pruebas.ok(public.ver_entradas(:'tok', '30111222') ->> 'ok' = 'true', 'pasados 15 minutos, con el DNI correcto abre');
reset role;
select pruebas.ok(not exists (select 1 from public.intentos_link where link_hash = privado.sha256_hex(:'tok')), 'abrir bien limpia los intentos');
set role anon;
select pruebas.ok(public.ver_entradas('BBBBBBBBBBBBBBBBBBBBBBBBBB', '30111222') ->> 'mensaje' = public.ver_entradas(:'tok', '11111111') ->> 'mensaje',
                  'link inexistente y DNI incorrecto dan el mismo mensaje');
select pruebas.ok(public.ver_entradas('abc', '30111222') ->> 'motivo' = 'link', 'link incompleto: aviso propio');
select public.ver_entradas(:'tok', '30111222');   -- limpia
reset role;

\echo
\echo '== Link rotado'
set role authenticated;
select pruebas.como(:lucia);
select public.reenviar_link(:'v1') ->> 'token' as tok_nuevo \gset
reset role;
set role anon;
select pruebas.como(null);
select pruebas.ok(public.ver_entradas(:'tok', '30111222') ->> 'ok' = 'false', 'el token rotado deja de funcionar');
select pruebas.ok(public.ver_entradas(:'tok_nuevo', '30111222') ->> 'ok' = 'true', 'el token nuevo funciona');
reset role;

\echo
\echo '== Pasar a otra persona'
set role anon;
select pruebas.ok(public.pasar_entrada(:'tok_nuevo', '11111111', 2, 'Laura') ->> 'motivo' = 'dni', 'para pasar también hace falta el DNI');
select public.pasar_entrada(:'tok_nuevo', '30111222', 2, '  Laura  ') as p1 \gset
select pruebas.ok((:'p1'::jsonb ->> 'ok')::boolean and :'p1'::jsonb ->> 'token' ~ '^[A-Z2-7]{26}$', 'genera un link individual');
select public.ver_entrada_pasada(:'p1'::jsonb ->> 'token') as vp \gset
select pruebas.ok((:'vp'::jsonb ->> 'ok')::boolean and (:'vp'::jsonb ->> 'nro')::int = 2 and :'vp'::jsonb ->> 'para' = 'Laura', 'el link individual muestra esa entrada, sin DNI');
select pruebas.ok(:'vp'::jsonb ->> 'de' = 'Ana', 'de quien la pasó: solo el primer nombre');
select pruebas.ok(:'vp'::text !~* '"(dni|titular|tel|entradas|ref|id|venta_id|precio|total)"', 'el link individual no muestra nada más de la venta');
select public.ver_entradas(:'tok_nuevo', '30111222') as ve2 \gset
select pruebas.ok(:'ve2'::jsonb #>> '{entradas,1,pasada_a}' = 'Laura' and (:'ve2'::jsonb #>> '{entradas,1,pasada}')::boolean, 'el titular la ve "Pasada a Laura"');
select pruebas.ok(:'vp'::jsonb ->> 'codigo' = :'ve2'::jsonb #>> '{entradas,1,codigo}', 'es el mismo QR (gana el primer escaneo)');
select public.pasar_entrada(:'tok_nuevo', '30111222', 2, 'Laura B') as p2 \gset
select pruebas.ok(public.ver_entrada_pasada(:'p1'::jsonb ->> 'token') ->> 'ok' = 'false', 'al volver a pasarla, el link anterior deja de andar');
select pruebas.ok(public.ver_entrada_pasada(:'p2'::jsonb ->> 'token') ->> 'para' = 'Laura B', 'y el nuevo funciona');
select pruebas.ok(public.ver_entradas(:'tok_nuevo', '30111222') ->> 'ok' = 'true', 'pasar no afecta el link del titular');
select pruebas.ok(public.pasar_entrada(:'tok_nuevo', '30111222', 9, null) ->> 'motivo' = 'nro', 'entrada inexistente');
select pruebas.ok(public.pasar_entrada(:'tok_nuevo', '30111222', 1, '') ->> 'nombre' is null, 'el nombre es opcional');
select pruebas.ok(public.ver_entrada_pasada('CCCCCCCCCCCCCCCCCCCCCCCCCC') ->> 'ok' = 'false', 'link individual inventado: nada');
reset role;
select pruebas.ok((select count(*) from public.auditoria where accion = 'pasar_entrada') = 3, 'cada pase queda en auditoría');

\echo
\echo '== Estados: ya ingresó y anulada'
update public.entradas set ingreso_en = '2026-12-18 23:14:00-03' where venta_id = :'v1' and nro = 1;
set role anon;
select pruebas.ok(public.ver_entradas(:'tok_nuevo', '30111222') #>> '{entradas,0,ingreso}' is not null, 'el titular ve que ya ingresó');
select pruebas.ok(public.pasar_entrada(:'tok_nuevo', '30111222', 1, 'x') ->> 'motivo' = 'ingreso', 'una entrada usada no se puede pasar');
reset role;
update public.ventas set estado = 'anulada' where id = :'v1';
update public.entradas set estado = 'anulada' where venta_id = :'v1';
set role anon;
select public.ver_entradas(:'tok_nuevo', '30111222') as va \gset
select pruebas.ok(:'va'::jsonb ->> 'estado' = 'anulada' and :'va'::jsonb #>> '{entradas,1,codigo}' is null, 'venta anulada: se informa y no muestra QR');
select public.ver_entrada_pasada(:'p2'::jsonb ->> 'token') as vpa \gset
select pruebas.ok(:'vpa'::jsonb ->> 'estado' = 'anulada' and :'vpa'::jsonb ->> 'codigo' is null, 'link individual de una venta anulada: sin QR');
select pruebas.ok(public.pasar_entrada(:'tok_nuevo', '30111222', 2, 'x') ->> 'motivo' = 'anulada', 'una entrada anulada no se pasa');
reset role;

\echo
\echo 'Fase 2: todos los chequeos pasaron.'
