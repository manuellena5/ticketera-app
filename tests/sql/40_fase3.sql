-- =====================================================================
-- Tests de la fase 3: puerta y caja.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

\i tests/sql/_helpers.sql
\set puerta2 '''00000000-0000-4000-8000-000000000022'''

create or replace function privado.ahora() returns timestamptz language sql stable as
  $$ select '2026-11-10 12:00:00-03'::timestamptz $$;

-- Ventas de prueba
set role authenticated;
select pruebas.como(:lucia);
select public.emitir_venta(gen_random_uuid(), 'Ana Pérez', '30111456', null, 2, 'efectivo') as r1 \gset
select public.emitir_venta(gen_random_uuid(), 'Juan Díaz', '31222333', null, 1, 'efectivo') as r2 \gset
reset role;
select (:'r1'::jsonb #>> '{venta,ref}') as v1, (:'r2'::jsonb #>> '{venta,ref}') as v2 \gset
select privado.sha256_hex(codigo) as h1 from public.entradas where venta_id = :'v1' and nro = 1 \gset
select privado.sha256_hex(codigo) as h2 from public.entradas where venta_id = :'v1' and nro = 2 \gset
select privado.sha256_hex(codigo) as h3 from public.entradas where venta_id = :'v2' and nro = 1 \gset
select codigo as c1 from public.entradas where venta_id = :'v1' and nro = 1 \gset

\echo
\echo '== Lista de puerta'
set role authenticated;
select pruebas.como(:puerta1);
select public.descargar_lista_puerta() as lista \gset
select pruebas.ok(jsonb_array_length(:'lista'::jsonb -> 'entradas') = 3, 'trae todas las entradas emitidas');
select pruebas.ok(:'lista'::text !~ :'c1', 'la lista NO trae el código en claro');
select pruebas.ok(:'lista'::text !~ '30111456' and :'lista'::text !~ '31222333', 'la lista NO trae el DNI completo');
select pruebas.ok(exists (select 1 from jsonb_array_elements(:'lista'::jsonb -> 'entradas') x
                          where x ->> 'h' = :'h1' and x ->> 'n' = 'Ana Pérez' and x ->> 'd3' = '456'
                            and (x ->> 'nro')::int = 1 and (x ->> 'c')::int = 2 and x ->> 't' = 'Anticipada' and x ->> 'e' = 'valida'),
                  'cada fila: hash del código, nombre, últimos 3 del DNI, tanda, nro/cantidad y estado');
reset role;
select pruebas.ok(exists (select 1 from jsonb_array_elements(:'lista'::jsonb -> 'entradas') x
                          where x ->> 'h' = :'h1' and x ->> 'hd' = privado.sha256_hex('30111456' || (:'lista'::jsonb ->> 'sal'))),
                  'búsqueda por DNI sin conexión: sha256(DNI + sal del evento)');
set role authenticated;
select pruebas.ok((:'lista'::jsonb #>> '{contador,tope}')::int = 1000 and (:'lista'::jsonb #>> '{contador,adentro}')::int = 0, 'contador: 0 / 1.000');
select pruebas.ok(:'lista'::jsonb #>> '{contador,servidor_ahora}' is not null, 'manda la hora del servidor (para corregir el reloj del celular)');
select pruebas.como(:lucia);
select pruebas.falla($$select public.descargar_lista_puerta()$$, 'P0001', 'un RRPP no baja la lista', 'sin_permiso');
select pruebas.como(:caja);
select pruebas.falla($$select public.descargar_lista_puerta()$$, 'P0001', 'la caja no baja la lista', 'sin_permiso');
select pruebas.falla($$select public.registrar_ingresos('[]')$$, 'P0001', 'la caja no registra ingresos', 'sin_permiso');
reset role;

\echo
\echo '== Ingresos: gana el primero'
set role authenticated;
select pruebas.como(:puerta1);
select public.registrar_ingresos(jsonb_build_array(
  jsonb_build_object('h', :'h1', 'momento', '2026-10-31 23:14:00-03', 'dispositivo', 'puerta1-a'))) as ri \gset
select pruebas.ok(:'ri'::jsonb #>> '{resultados,0,resultado}' = 'ok', 'primer escaneo: ingresa');
select pruebas.ok((:'ri'::jsonb #>> '{contador,adentro}')::int = 1, 'el contador suma');
select pruebas.ok(public.registrar_ingresos(jsonb_build_array(
  jsonb_build_object('h', :'h1', 'momento', '2026-10-31 23:14:00-03', 'dispositivo', 'puerta1-a'))) #>> '{resultados,0,resultado}' = 'ok',
  'reenviar el mismo ingreso (reintento) no es duplicado');
select pruebas.como(:puerta2);
select public.registrar_ingresos(jsonb_build_array(
  jsonb_build_object('h', :'h1', 'momento', '2026-10-31 23:20:00-03', 'dispositivo', 'puerta2-b'))) as rd \gset
select pruebas.ok(:'rd'::jsonb #>> '{resultados,0,resultado}' = 'duplicado'
                  and (:'rd'::jsonb #>> '{resultados,0,ingreso}')::timestamptz = '2026-10-31 23:14:00-03', 'segundo escaneo (otro celular): duplicado, informa la hora del primero');
-- Escáner sin señal que pasó ANTES pero sincroniza DESPUÉS
select public.registrar_ingresos(jsonb_build_array(
  jsonb_build_object('h', :'h2', 'momento', '2026-10-31 23:30:00-03', 'dispositivo', 'puerta2-b'))) as x \gset
select pruebas.como(:puerta1);
select public.registrar_ingresos(jsonb_build_array(
  jsonb_build_object('h', :'h2', 'momento', '2026-10-31 23:25:00-03', 'dispositivo', 'puerta1-a'))) as ra \gset
reset role;
select pruebas.ok((select ingreso_en from public.entradas where privado.sha256_hex(codigo) = :'h2') = '2026-10-31 23:25:00-03'
                  and (select ingreso_dispositivo from public.entradas where privado.sha256_hex(codigo) = :'h2') = 'puerta1-a',
                  'con dos celulares, después de sincronizar gana el primer ingreso (aunque llegue después)');
select pruebas.ok((select count(*) from public.auditoria where accion = 'intento_duplicado') = 2, 'los repetidos quedan en auditoría como "intento duplicado"');
set role authenticated;
select pruebas.como(:puerta1);
select public.registrar_ingresos(jsonb_build_array(
  jsonb_build_object('h', :'h3', 'momento', '2099-01-01 00:00:00-03', 'dispositivo', 'puerta1-a'),
  jsonb_build_object('h', repeat('0', 64), 'momento', '2026-10-31 23:40:00-03', 'dispositivo', 'puerta1-a'))) as rf \gset
reset role;
select pruebas.ok((select ingreso_en from public.entradas where privado.sha256_hex(codigo) = :'h3') <= clock_timestamp(), 'un reloj adelantado no deja momentos futuros');
select pruebas.ok(:'rf'::jsonb #>> '{resultados,1,resultado}' = 'no_valida', 'código inexistente: no válida');
update public.ventas set estado = 'anulada' where id = :'v2';
set role authenticated;
select pruebas.como(:puerta1);
select pruebas.ok(public.registrar_ingresos(jsonb_build_array(jsonb_build_object('h', :'h3', 'dispositivo', 'x'))) #>> '{resultados,0,resultado}' = 'anulada', 'venta anulada: anulada');
reset role;
update public.ventas set estado = 'activa' where id = :'v2';

\echo
\echo '== Cambios para sincronizar'
select clock_timestamp() as marca \gset
set role authenticated;
select pruebas.como(:puerta1);
select pruebas.ok(jsonb_array_length(public.cambios_puerta(:'marca') -> 'entradas') = 0, 'sin cambios desde la marca');
select pruebas.como(:puerta2);
select public.registrar_ingresos(jsonb_build_array(jsonb_build_object('h', :'h3', 'dispositivo', 'puerta2-b'))) as x \gset
reset role;
update public.ventas set estado = 'anulada' where id = :'v1';
set role authenticated;
select pruebas.como(:puerta1);
select public.cambios_puerta(:'marca') as cb \gset
select pruebas.ok(jsonb_array_length(:'cb'::jsonb -> 'entradas') >= 2, 'baja los cambios del otro escáner y las anulaciones');
select pruebas.ok(exists (select 1 from jsonb_array_elements(:'cb'::jsonb -> 'entradas') x where x ->> 'h' = :'h1' and x ->> 'e' = 'anulada'), 'la anulación llega como "anulada"');
reset role;
update public.ventas set estado = 'activa' where id = :'v1';

\echo
\echo '== Deshacer ingreso'
set role authenticated;
select pruebas.como(:puerta2);
select public.deshacer_ingreso(:'h1', 'Se marcó por error') as dh \gset
select pruebas.ok(:'dh'::jsonb #>> '{fila,i}' is null, 'quien maneja la puerta puede deshacer un ingreso');
select pruebas.como(:lucia);
select pruebas.falla(format('select public.deshacer_ingreso(%L)', :'h1'), 'P0001', 'un RRPP no puede', 'sin_permiso');
reset role;
select pruebas.ok((select detalle ->> 'motivo' from public.auditoria where accion = 'deshacer_ingreso') = 'Se marcó por error', 'queda en auditoría con el motivo');

\echo
\echo '== Venta en puerta'
create or replace function privado.ahora() returns timestamptz language sql stable as $$ select '2026-12-18 23:00:00-03'::timestamptz $$;
set role authenticated;
select pruebas.como(:caja);
select public.caja_puerta() as cj \gset
select pruebas.ok(:'cj'::jsonb #>> '{tanda,nombre}' = 'Puerta' and (:'cj'::jsonb #>> '{tanda,precio}')::numeric = 25000, 'caja: tanda Puerta a $25.000');
select (:'cj'::jsonb #>> '{contador,adentro}')::int as adentro0 \gset
select public.venta_puerta('22222222-2222-4222-8222-222222222222', 2, 'efectivo', 25000) as vp \gset
select pruebas.ok((:'vp'::jsonb ->> 'total')::numeric = 50000, 'cobra 2 × $25.000');
select pruebas.ok((:'vp'::jsonb #>> '{contador,adentro}')::int = :adentro0 + 2, 'las pulseras suman al contador de adentro');
select pruebas.ok((:'vp'::jsonb #>> '{caja,pulseras}')::int = 2 and (:'vp'::jsonb #>> '{caja,efectivo}')::numeric = 50000, 'caja de puerta: pulseras y efectivo');
select pruebas.ok((public.venta_puerta('22222222-2222-4222-8222-222222222222', 2, 'efectivo', 25000) ->> 'repetida')::boolean, 'el doble toque no duplica');
select public.venta_puerta(gen_random_uuid(), 1, 'transferencia', 25000) as vt \gset
select pruebas.ok((:'vt'::jsonb #>> '{caja,transferencias}')::numeric = 25000, 'transferencias aparte');
select pruebas.falla($$select public.venta_puerta(gen_random_uuid(), 1, 'efectivo', 20000)$$, 'P0001', 'precio distinto al vigente: frena', 'precio_cambio');
reset role;
select pruebas.ok((select bool_and(e.ingreso_en is not null) from public.entradas e join public.ventas v on v.id = e.venta_id where v.canal = 'caja'),
                  'las entradas de caja nacen ingresadas (pulsera)');
select pruebas.ok((select count(*) from public.ventas where canal = 'caja' and titular_nombre = 'Venta en puerta') = 2, 'venta registrada como "Venta en puerta"');

-- Tope: con conexión frena; sin conexión se acepta y avisa
update public.eventos set tope_entradas = privado.emitidas_evento(id) + 1 where id = :evento;
set role authenticated;
select pruebas.como(:caja);
select pruebas.falla($$select public.venta_puerta(gen_random_uuid(), 2, 'efectivo', 25000)$$, 'P0001', 'con conexión: frena en el tope', 'tope');
select public.venta_puerta(gen_random_uuid(), 3, 'efectivo', 25000, true, '2026-10-31 23:50:00-03') as vo \gset
select pruebas.ok(:'vo'::jsonb ->> 'aviso' = 'Se vendieron 2 entradas por encima del tope mientras no había conexión.', 'sin conexión: se acepta igual y avisa cuántas pasaron el tope');
select pruebas.como(:lucia);
select pruebas.falla($$select public.venta_puerta(gen_random_uuid(), 1, 'efectivo')$$, 'P0001', 'un RRPP no vende en puerta', 'sin_permiso');
select pruebas.como(:puerta1);
select pruebas.ok((public.contador_puerta() ->> 'adentro')::int >= 3, 'puerta ve el contador');
reset role;
select pruebas.ok((select count(*) from public.auditoria where accion = 'venta_puerta_sobre_tope') = 1, 'la venta por encima del tope queda en auditoría (aviso al admin)');
select pruebas.ok((select creado_en from public.ventas where idempotency_key is not null and canal = 'caja' order by creado_en limit 1) = '2026-10-31 23:50:00-03',
                  'la venta sin conexión conserva la hora en que se hizo');

\echo
\echo 'Fase 3: todos los chequeos pasaron.'
