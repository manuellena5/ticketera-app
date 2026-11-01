-- =====================================================================
-- Tests de la fase 4: administración.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

\i tests/sql/_helpers.sql

create or replace function privado.ahora() returns timestamptz language sql stable as
  $$ select '2026-11-10 12:00:00-03'::timestamptz $$;

create function pruebas.vender(p_user uuid, p_nombre text, p_dni text, p_cant int, p_medio text)
returns jsonb language plpgsql as $$
begin
  perform pruebas.como(p_user);
  return public.emitir_venta(gen_random_uuid(), p_nombre, p_dni, null, p_cant, p_medio);
end $$;
grant execute on all functions in schema pruebas to authenticated;

\echo
\echo '== Set de prueba de rendición'
set role authenticated;
-- Lucía ($750): 2 en efectivo + 1 por transferencia
select pruebas.vender(:lucia, 'Ana Pérez', '30111222', 2, 'efectivo') as l1 \gset
select pruebas.vender(:lucia, 'Juan Díaz', '31222333', 1, 'transferencia') as l2 \gset
-- Martín (ad honorem): 2 en efectivo
select pruebas.vender(:martin, 'Carla Ruiz', '32333444', 2, 'efectivo') as m1 \gset
-- Sofía ($500): 1 en efectivo que después se anula
select pruebas.vender(:sofia, 'Pedro Gómez', '33444555', 1, 'efectivo') as s1 \gset
-- El admin le cambia la comisión a Lucía a mitad de la venta
select pruebas.como(:admin);
select public.ajustar_rrpp(:lucia, 1000, 'sin_limite', null) as aj \gset
-- Lucía vende 1 más en efectivo (con la comisión nueva)
select pruebas.vender(:lucia, 'Laura Sosa', '34555666', 1, 'efectivo') as l3 \gset
select pruebas.como(:admin);
select public.registrar_movimiento_rrpp(:lucia, 'entrega_efectivo', 30000, null) as mv1 \gset
select public.registrar_movimiento_rrpp(:lucia, 'pago_comision', 750, null) as mv2 \gset
select public.anular_venta((:'s1'::jsonb #>> '{venta,ref}')::uuid, 'Cliente se arrepintió') as an \gset
select public.rendicion_admin() as rd \gset
reset role;

-- Fórmula de la sección 7, calculada a mano sobre las tablas
create temp table esperado as
select p.user_id,
  coalesce((select sum(cantidad) from ventas where rrpp_id = p.user_id and estado = 'activa'), 0) as entradas,
  coalesce((select sum(total) from ventas where rrpp_id = p.user_id and estado = 'activa' and medio = 'efectivo'), 0) as cobrado,
  coalesce((select sum(monto) from movimientos_rrpp where rrpp_id = p.user_id and tipo = 'entrega_efectivo'), 0) as rendido,
  coalesce((select sum(cantidad * comision_unitaria) from ventas where rrpp_id = p.user_id and estado = 'activa'), 0) as ganada,
  coalesce((select sum(monto) from movimientos_rrpp where rrpp_id = p.user_id and tipo = 'pago_comision'), 0) as pagada
from perfiles p where p.rol = 'rrpp';

select pruebas.ok((select bool_and(
    (f ->> 'entradas')::numeric = e.entradas
    and (f ->> 'efectivo_cobrado')::numeric = e.cobrado
    and (f ->> 'efectivo_a_rendir')::numeric = e.cobrado - e.rendido
    and (f ->> 'comision_ganada')::numeric = e.ganada
    and (f ->> 'comision_a_pagar')::numeric = e.ganada - e.pagada)
  from jsonb_array_elements(:'rd'::jsonb -> 'filas') f join esperado e on e.user_id = (f ->> 'ref')::uuid),
  'los saldos cuadran con la fórmula de la sección 7 para todos los RRPP');

select pruebas.ok((select (f ->> 'efectivo_cobrado')::numeric = 60000 and (f ->> 'efectivo_a_rendir')::numeric = 30000
                          and (f ->> 'transf_pendientes')::numeric = 20000
                   from jsonb_array_elements(:'rd'::jsonb -> 'filas') f where f ->> 'nombre' = 'Lucía Fernández'),
                  'Lucía: cobró $60.000 en efectivo, rindió $30.000, le quedan $30.000; la transferencia va aparte');
select pruebas.ok((select (f ->> 'comision_ganada')::numeric = 3250 and (f ->> 'comision_a_pagar')::numeric = 2500
                   from jsonb_array_elements(:'rd'::jsonb -> 'filas') f where f ->> 'nombre' = 'Lucía Fernández'),
                  'comisión cambiada a mitad de la venta: 3 × $750 + 1 × $1.000 = $3.250 (pagado $750, a pagar $2.500)');
select pruebas.ok((select (f ->> 'ad_honorem')::boolean and (f ->> 'comision_ganada')::numeric = 0 and (f ->> 'efectivo_a_rendir')::numeric = 40000
                   from jsonb_array_elements(:'rd'::jsonb -> 'filas') f where f ->> 'nombre' = 'Martín Gómez'),
                  'Martín ad honorem: sin comisión, rinde los $40.000');
select pruebas.ok((select (f ->> 'entradas')::numeric = 0 and (f ->> 'efectivo_a_rendir')::numeric = 0
                   from jsonb_array_elements(:'rd'::jsonb -> 'filas') f where f ->> 'nombre' = 'Sofía Ruiz'),
                  'la venta anulada no cuenta para la rendición');
select pruebas.ok((:'mv1'::jsonb ->> 'saldo')::numeric = 30000 and (:'mv1'::jsonb ->> 'nro')::int = 1, 'el movimiento devuelve el saldo después y el número de comprobante');
select pruebas.ok(jsonb_array_length(:'rd'::jsonb -> 'movimientos') = 2, 'lista de movimientos');

\echo
\echo '== Movimientos: no más que lo pendiente salvo con nota'
set role authenticated;
select pruebas.como(:admin);
select pruebas.falla(format('select public.registrar_movimiento_rrpp(%L, %L, 50000, null)', :lucia, 'entrega_efectivo'), 'P0001',
                     'entrega mayor a lo pendiente sin nota: no', 'excede');
select pruebas.ok((public.registrar_movimiento_rrpp(:lucia, 'entrega_efectivo', 31000, 'Trajo $1.000 de más, se le devuelve') ->> 'saldo')::numeric = -1000,
                  'con nota se acepta (queda saldo a favor del RRPP)');
select pruebas.falla(format('select public.registrar_movimiento_rrpp(%L, %L, 0, null)', :lucia, 'pago_comision'), 'P0001', 'monto $0: no', 'monto');
select pruebas.falla(format('select public.registrar_movimiento_rrpp(%L, %L, 10, null)', :lucia, 'otro'), 'P0001', 'tipo inválido', 'datos');
select pruebas.como(:lucia);
select pruebas.falla(format('select public.registrar_movimiento_rrpp(%L, %L, 10, null)', :lucia, 'pago_comision'), 'P0001', 'un RRPP no registra movimientos', 'sin_permiso');
reset role;

\echo
\echo '== Límite por porcentaje y tandas'
set role authenticated;
select pruebas.como(:admin);
select public.usuarios_admin() as us \gset
select pruebas.ok((select (u ->> 'limite_vigente')::int = 100 from jsonb_array_elements(:'us'::jsonb -> 'usuarios') u where u ->> 'usuario' = 'sofia'),
                  'Sofía: 20% de la Anticipada (500) = 100');
select public.ajustar_tanda('00000000-0000-4000-8000-0000000000a1', '{"cantidad": 300}') as t1 \gset
select pruebas.ok((select (u ->> 'limite_vigente')::int = 60 from jsonb_array_elements(public.usuarios_admin() -> 'usuarios') u where u ->> 'usuario' = 'sofia'),
                  'al cambiar la cantidad de la tanda a 300, el límite se recalcula solo (60)');
select pruebas.falla($$select public.ajustar_tanda('00000000-0000-4000-8000-0000000000a1', '{"cantidad": 2}')$$, 'P0001',
                     'la cantidad no puede quedar por debajo de lo emitido', 'cantidad');
select public.ajustar_tanda(null, '{"nombre": "Última", "canal": "rrpp", "precio": 24000, "cantidad": 50, "desde": "2026-12-10T00:00:00-03:00", "hasta": "2026-12-15T23:59:00-03:00"}') as t2 \gset
select pruebas.ok(exists (select 1 from jsonb_array_elements(:'t2'::jsonb -> 'tandas') t where t ->> 'nombre' = 'Última' and t ->> 'estado' = 'proxima'),
                  'crear una tanda nueva');
select pruebas.ok(public.ajustar_tanda((select (t ->> 'ref')::uuid from jsonb_array_elements(:'t2'::jsonb -> 'tandas') t where t ->> 'nombre' = 'Última'),
                  '{"borrar": true}') -> 'tandas' @? '$[*] ? (@.nombre == "Última")' = false, 'borrar una tanda sin ventas');
select pruebas.falla($$select public.ajustar_tanda('00000000-0000-4000-8000-0000000000a1', '{"borrar": true}')$$, 'P0001',
                     'una tanda con ventas no se borra', 'con_ventas');
select pruebas.falla($$select public.ajustar_tanda('00000000-0000-4000-8000-0000000000a1', '{"desde": "2026-12-01", "hasta": "2026-11-01"}')$$, 'P0001',
                     'fechas al revés: no', 'fechas');
select pruebas.ok((select t ->> 'estado' from jsonb_array_elements(public.evento_admin() -> 'tandas') t where t ->> 'nombre' = 'Anticipada') = 'vigente'
                  and (select t ->> 'estado' from jsonb_array_elements(public.evento_admin() -> 'tandas') t where t ->> 'nombre' = 'General') = 'proxima',
                  'cada tanda con su estado (vigente, próxima)');
reset role;

\echo
\echo '== Evento y configuración'
set role authenticated;
select pruebas.como(:admin);
select public.ajustar_evento(null, '{"lugar": "Salón comunal · Landeta", "tope": 1200}') as ev \gset
select pruebas.ok(:'ev'::jsonb #>> '{evento,lugar}' = 'Salón comunal · Landeta' and (:'ev'::jsonb #>> '{evento,tope}')::int = 1200, 'el admin carga el lugar y mueve el tope');
select pruebas.falla($$select public.ajustar_evento(null, '{"tope": 3}')$$, 'P0001', 'el tope no puede bajar de lo ya emitido', 'tope');
select pruebas.falla($$select public.ajustar_evento(null, '{"aviso_desde": 5000}')$$, 'P0001', 'el aviso no puede superar el tope', 'aviso_desde');
select pruebas.falla($$select public.ajustar_evento(null, '{"estado": "otro"}')$$, 'P0001', 'estado inválido', 'estado');
select public.ajustar_config_club('{"alias": "CLUB.MITRE.MP", "cbu_cvu": "0000003100000000000001", "titular": "Club Deportivo Mitre", "entidad": "Mercado Pago"}') as cf \gset
select pruebas.ok(:'cf'::jsonb #>> '{config,alias}' = 'CLUB.MITRE.MP', 'datos de transferencia guardados');
select pruebas.falla($$select public.ajustar_config_club('{"cbu_cvu": "123"}')$$, 'P0001', 'CBU/CVU con menos de 22 números: no', 'cbu');
select pruebas.como(:lucia);
select pruebas.ok((select alias from public.datos_transferencia()) = 'CLUB.MITRE.MP', 'los RRPP ven los datos nuevos');
select pruebas.falla($$select public.ajustar_evento(null, '{"tope": 5000}')$$, 'P0001', 'un RRPP no cambia el evento', 'sin_permiso');
select pruebas.falla($$select public.tablero_admin()$$, 'P0001', 'un RRPP no ve el tablero', 'sin_permiso');
reset role;
set role anon;
select pruebas.ok(public.evento_del_link(:'l1'::jsonb ->> 'token') ->> 'lugar' = 'Salón comunal · Landeta', 'el lugar aparece en el link del comprador');
reset role;
select pruebas.ok((select count(*) from auditoria where accion in ('ajustar_evento', 'ajustar_config_club', 'ajustar_tanda', 'crear_tanda', 'borrar_tanda', 'ajustar_rrpp')) >= 6,
                  'cada cambio de configuración queda en auditoría');

\echo
\echo '== Cortesías, transferencias y ventas'
set role authenticated;
select pruebas.como(:admin);
select public.emitir_cortesia('Invitado Especial', '35666777', 2, null) as co \gset
select pruebas.ok((:'co'::jsonb #>> '{venta,total}')::numeric = 0 and :'co'::jsonb ->> 'token' ~ '^[A-Z2-7]{26}$', 'cortesía a $0 con su link');
reset role;
set role anon;
select pruebas.ok(public.ver_entradas(:'co'::jsonb ->> 'token', '35666777') ->> 'ok' = 'true', 'el link de la cortesía funciona');
reset role;
update public.eventos set tope_entradas = privado.emitidas_evento(id) + 1;
set role authenticated;
select pruebas.como(:admin);
select pruebas.falla($$select public.emitir_cortesia('Otro', '36777888', 2)$$, 'P0001', 'las cortesías cuentan para el tope', 'tope');
select pruebas.como(:lucia);
select pruebas.falla($$select public.emitir_cortesia('Otro', '36777888', 1)$$, 'P0001', 'solo el admin emite cortesías', 'sin_permiso');
select pruebas.como(:admin);
select public.ventas_admin('{"medio": "transferencia"}') as vt \gset
select pruebas.ok(jsonb_array_length(:'vt'::jsonb) = 1 and not (:'vt'::jsonb #>> '{0,confirmada}')::boolean, 'filtro por medio: 1 transferencia sin confirmar');
select pruebas.ok((public.confirmar_transferencias(array[(:'vt'::jsonb #>> '{0,ref}')::uuid]) ->> 'cambiadas')::int = 1, 'marcar la transferencia como confirmada');
select pruebas.ok((select (f ->> 'transf_confirmadas')::numeric = 20000 and (f ->> 'transf_pendientes')::numeric = 0
                   from jsonb_array_elements(public.rendicion_admin() -> 'filas') f where f ->> 'nombre' = 'Lucía Fernández'), 'la rendición la muestra confirmada');
select pruebas.ok(jsonb_array_length(public.ventas_admin('{"q": "30.111"}')) = 1, 'buscar por DNI');
select pruebas.ok(jsonb_array_length(public.ventas_admin('{"q": "díaz"}')) = 1, 'buscar por nombre');
select pruebas.ok(jsonb_array_length(public.ventas_admin(jsonb_build_object('rrpp', :lucia))) = 3, 'filtrar por RRPP');
select pruebas.ok(jsonb_array_length(public.ventas_admin('{"estado": "anulada"}')) = 1, 'filtrar anuladas');
select pruebas.falla(format('select public.anular_venta(%L, %L)', :'l1'::jsonb #>> '{venta,ref}', ''), 'P0001', 'anular sin motivo: no', 'motivo');
select public.tablero_admin() as tb \gset
select pruebas.ok((:'tb'::jsonb ->> 'emitidas')::int = (select sum(cantidad) from public.ventas where estado = 'activa')
                  and (:'tb'::jsonb #>> '{canales,cortesia,entradas}')::int = 2, 'tablero: emitidas y por canal (cortesías)');
select pruebas.ok((:'tb'::jsonb ->> 'efectivo_a_rendir')::numeric = (select sum((f ->> 'efectivo_a_rendir')::numeric) from jsonb_array_elements(public.rendicion_admin() -> 'filas') f),
                  'tablero: efectivo por rendir = suma de la rendición');
select pruebas.ok(jsonb_array_length(:'tb'::jsonb -> 'tandas') = 3, 'tablero: por tanda');
reset role;

\echo
\echo '== Auditoría, exportes y cierre'
set role authenticated;
select pruebas.como(:admin);
select public.auditoria_admin() as au \gset
select pruebas.ok(exists (select 1 from jsonb_array_elements(:'au'::jsonb) a where a ->> 'accion' = 'anular_venta' and a ->> 'quien' = 'Administración'
                          and a ->> 'sobre' = 'Pedro Gómez' and a #>> '{detalle,motivo}' = 'Cliente se arrepintió'),
                  'auditoría: quién anuló, a quién y por qué');
select pruebas.ok((select count(*) from jsonb_array_elements(public.exportar_admin('ventas'))) = (select count(*) from ventas), 'exportar ventas: todas');
select pruebas.ok(public.exportar_admin('ventas') -> 0 ? 'Titular' and public.exportar_admin('ventas') -> 0 ? 'Transferencia confirmada', 'columnas en castellano');
select pruebas.ok(public.exportar_admin('ventas')::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-', 'los exportes no traen IDs internos');
select pruebas.ok(jsonb_array_length(public.exportar_admin('entradas')) = (select count(*) from entradas), 'exportar entradas');
select pruebas.ok(jsonb_array_length(public.exportar_admin('rendiciones')) = 3, 'exportar rendiciones');
select pruebas.ok(jsonb_array_length(public.exportar_admin('movimientos')) = 3, 'exportar movimientos');
select pruebas.ok(jsonb_typeof(public.exportar_admin('ingresos')) = 'array', 'exportar ingresos');
select public.resumen_cierre() as rc \gset
select pruebas.ok((:'rc'::jsonb ->> 'emitidas')::int = (:'rc'::jsonb ->> 'ingresaron')::int + (:'rc'::jsonb ->> 'no_ingresaron')::int
                  and (:'rc'::jsonb ->> 'anuladas')::int = 1, 'cierre: emitidas = ingresaron + no ingresaron; anuladas aparte');
select pruebas.ok((:'rc'::jsonb ->> 'comisiones')::numeric = 3250, 'cierre: comisiones del evento');
select pruebas.falla($$select public.anonimizar_datos_personales(null, 'ANONIMIZAR')$$, 'P0001', 'anonimizar exige el evento cerrado', 'abierto');
reset role;
update public.eventos set estado = 'cerrado';
set role authenticated;
select pruebas.como(:admin);
select pruebas.falla($$select public.anonimizar_datos_personales(null, 'si')$$, 'P0001', 'anonimizar exige escribir ANONIMIZAR', 'confirmar');
select pruebas.ok((public.anonimizar_datos_personales(null, 'ANONIMIZAR') ->> 'ventas')::int > 0, 'anonimiza cuando M lo decide');
reset role;
select pruebas.ok(not exists (select 1 from ventas where titular_dni not in ('00000000') or titular_tel is not null), 'DNI y teléfonos borrados');

\echo
\echo '== Usuarios'
set role authenticated;
select pruebas.como(:admin);
select pruebas.falla(format('select public.admin_registrar_usuario(%L, gen_random_uuid(), %L, %L, null, null, %L)', :admin, 'X', 'xx', 'rrpp'),
                     '42501', 'crear perfiles directo: solo la service role (Edge Function)');
select pruebas.falla(format('select public.activar_usuario(%L, false)', :admin), 'P0001', 'el admin no se puede desactivar a sí mismo', 'propio');
select pruebas.ok((select not (u ->> 'activo')::boolean from jsonb_array_elements(public.activar_usuario(:martin, false) -> 'usuarios') u where u ->> 'usuario' = 'martin'),
                  'desactivar un usuario');
reset role;
-- Flujo de la Edge Function (con service_role)
insert into auth.users (id, email, encrypted_password) values ('00000000-0000-4000-8000-0000000000f1', 'nuevo@x', 'x');
set role service_role;
select public.admin_registrar_usuario(:admin, '00000000-0000-4000-8000-0000000000f1', 'Nuevo RRPP', 'Nuevo.RRPP', '3401 555', 'Landeta', 'rrpp');
reset role;
select pruebas.ok((select usuario = 'nuevo.rrpp' and debe_cambiar_clave and rol = 'rrpp' from perfiles where user_id = '00000000-0000-4000-8000-0000000000f1'),
                  'la Edge Function crea el perfil con cambio de clave obligatorio');
select pruebas.ok(exists (select 1 from rrpp_evento where rrpp_id = '00000000-0000-4000-8000-0000000000f1'), 'y lo habilita en el evento (ad honorem, sin límite)');
update auth.users set encrypted_password = 'otra' where id = '00000000-0000-4000-8000-0000000000f1';
set role service_role;
select public.admin_clave_temporal(:admin, '00000000-0000-4000-8000-0000000000f1');
reset role;
select pruebas.ok((select debe_cambiar_clave from perfiles where user_id = '00000000-0000-4000-8000-0000000000f1'), 'restablecer la clave vuelve a pedir el cambio');
select pruebas.ok((select count(*) from auditoria where accion in ('crear_usuario', 'restablecer_clave', 'desactivar_usuario')) = 3, 'altas, claves y bajas en auditoría');

\echo
\echo 'Fase 4: todos los chequeos pasaron.'
