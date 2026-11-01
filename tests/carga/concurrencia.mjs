// Fase 5 · Concurrencia contra Postgres real (conexiones en paralelo).
//  - 20 emisiones simultáneas cuando quedan 5 lugares → solo 5 pasan.
//  - Lo mismo con el stock de una tanda y con el límite de un RRPP.
//  - Tope disputado a la vez por RRPP, caja y cortesías.
//  - Mismo doble toque (misma clave) 10 veces a la vez → 1 sola venta.
//  - 2 escáneres registrando el mismo QR a la vez → 1 ingreso.
//   node tests/carga/concurrencia.mjs
import { randomUUID } from 'node:crypto';
import { levantarBase, comoUsuario, fijarReloj } from '../backend_local.mjs';
import { contador } from '../ui/comun.mjs';

const c = contador();
const ok = c.ok;
const U = {
  admin: '00000000-0000-4000-8000-000000000001', lucia: '00000000-0000-4000-8000-000000000011',
  martin: '00000000-0000-4000-8000-000000000012', sofia: '00000000-0000-4000-8000-000000000013',
  puerta1: '00000000-0000-4000-8000-000000000021', puerta2: '00000000-0000-4000-8000-000000000022',
  caja: '00000000-0000-4000-8000-000000000031',
};
const base = await levantarBase({ ahora: '2026-11-10 12:00:00-03' });
base.pool.options.max = 40;
const q = async (sql, p) => (await base.pool.query(sql, p)).rows;
const emitidas = async () => Number((await q(`select coalesce(sum(cantidad),0) n from ventas where estado = 'activa'`))[0].n);

async function intento(usuario, sql, params) {
  try { await comoUsuario(base.pool, usuario, sql, params); return 'ok'; }
  catch (err) { return err.hint || err.code; }
}
const vender = (u, i, idem = randomUUID()) => intento(u, `select public.emitir_venta($1, $2, $3, null, 1, 'efectivo')`, [idem, 'Persona ' + i, String(30000000 + i)]);
const contar = (res) => res.reduce((a, r) => { a[r] = (a[r] || 0) + 1; return a; }, {});

try {
  console.log('\n== Tope: 20 a la vez con 5 lugares');
  await q(`update eventos set tope_entradas = 5`);
  let t0 = Date.now();
  let res = await Promise.all(Array.from({ length: 20 }, (_, i) => vender([U.lucia, U.martin, U.sofia][i % 3], i)));
  let r = contar(res);
  ok(r.ok === 5 && r.tope === 15, `pasaron ${r.ok || 0}, frenadas por el tope ${r.tope || 0} (${Date.now() - t0} ms)`);
  ok(await emitidas() === 5, 'en la base quedaron exactamente 5 entradas: no se pasó el tope');

  console.log('\n== Stock de la tanda: 20 a la vez con 5 en la Anticipada (precio visto $20.000, como la app)');
  await q(`update eventos set tope_entradas = 1000; update tandas set cantidad = privado.emitidas_tanda(id) + 5 where nombre = 'Anticipada'`);
  res = await Promise.all(Array.from({ length: 20 }, (_, i) => intento([U.lucia, U.martin][i % 2],
    `select public.emitir_venta($1, $2, $3, null, 1, 'efectivo', 20000)`, [randomUUID(), 'Persona ' + (100 + i), String(30000100 + i)])));
  r = contar(res);
  ok(r.ok === 5 && r.precio_cambio === 15, `pasaron 5 a $20.000; las otras 15 frenan con "cambió la tanda" (${JSON.stringify(r)})`);
  const [ta] = await q(`select privado.emitidas_tanda(id) e, cantidad c from tandas where nombre = 'Anticipada'`);
  ok(Number(ta.e) === ta.c, 'la Anticipada quedó justa: ni una de más');
  ok(Number((await q(`select count(*) n from ventas v join tandas t on t.id = v.tanda_id where t.nombre = 'General'`))[0].n) === 0, 'ninguna se cobró a un precio que el RRPP no vio');

  console.log('\n== Límite del RRPP: a Sofía le quedan 3 de cupo, 15 pedidos a la vez');
  await q(`update tandas set cantidad = 500 where nombre = 'Anticipada'`);   // vuelve a haber stock
  const vendidasSofia = async () => Number((await q(`select coalesce(sum(v.cantidad),0) n from ventas v join tandas t on t.id = v.tanda_id
                                                    where v.rrpp_id = $1 and t.nombre = 'Anticipada' and v.estado = 'activa'`, [U.sofia]))[0].n);
  // Lo que ya vendió depende del reparto al azar de la prueba del tope: el cupo es eso + 3.
  const yaSofia = await vendidasSofia();
  await q(`update rrpp_evento set limite_tipo = 'cantidad', limite_valor = $2 where rrpp_id = $1`, [U.sofia, yaSofia + 3]);
  res = await Promise.all(Array.from({ length: 15 }, (_, i) => vender(U.sofia, 200 + i)));
  r = contar(res);
  const ahoraSofia = await vendidasSofia();
  ok(r.ok === 3 && r.limite_rrpp === 12 && ahoraSofia === yaSofia + 3,
     `pasaron justo 3 y 12 frenaron por el límite (tenía ${yaSofia}, cupo ${yaSofia + 3}, quedó en ${ahoraSofia})`);

  console.log('\n== Doble toque simultáneo: misma clave 10 veces a la vez');
  const idem = randomUUID();
  res = await Promise.all(Array.from({ length: 10 }, () => vender(U.lucia, 999, idem)));
  r = contar(res);
  ok(r.ok === 10, `las 10 respuestas son correctas (${JSON.stringify(r)})`);
  ok(Number((await q(`select count(*) n from ventas where idempotency_key = $1`, [idem]))[0].n) === 1, 'y hay una sola venta');

  console.log('\n== Tope disputado por RRPP, caja y cortesías a la vez');
  await fijarReloj(base.pool, '2026-12-14 23:00:00-03');
  await q(`update tandas set desde = '2026-12-01 00:00-03' where nombre = 'Puerta'`);   // para que caja y RRPP vendan a la vez
  await q(`update eventos set tope_entradas = privado.emitidas_evento(id) + 7`);
  const antes = await emitidas();
  res = await Promise.all([
    ...Array.from({ length: 10 }, (_, i) => vender(U.lucia, 300 + i)),
    ...Array.from({ length: 10 }, () => intento(U.caja, `select public.venta_puerta($1, 1, 'efectivo')`, [randomUUID()])),
    ...Array.from({ length: 5 }, (_, i) => intento(U.admin, `select public.emitir_cortesia($1, $2, 1)`, ['Invitado ' + i, String(40000000 + i)])),
  ]);
  r = contar(res);
  ok(r.ok === 7 && await emitidas() === antes + 7, `entraron justo 7 entre los tres canales (${JSON.stringify(r)})`);

  console.log('\n== Dos escáneres con el mismo QR a la vez (4 pedidos simultáneos)');
  const [h] = await q(`select codigo_hash h from entradas e join ventas v on v.id = e.venta_id where v.canal = 'rrpp' and e.ingreso_en is null limit 1`);
  const dupAntes = Number((await q(`select count(*) n from auditoria where accion = 'intento_duplicado'`))[0].n);
  // Como los celulares reales, cada uno manda la hora del escaneo: cel-0 escaneó primero.
  const t0s = Date.parse('2026-10-31T23:00:00-03:00');
  await Promise.all([U.puerta1, U.puerta2, U.puerta1, U.puerta2].map((u, i) => comoUsuario(base.pool, u,
    `select public.registrar_ingresos(jsonb_build_array(jsonb_build_object('h', $1::text, 'dispositivo', $2::text, 'momento', $3::text)))`,
    [h.h, 'cel-' + i, new Date(t0s + i * 1000).toISOString()])));
  const [ing] = await q(`select ingreso_dispositivo d, ingreso_en t from entradas where codigo_hash = $1`, [h.h]);
  const dupDespues = Number((await q(`select count(*) n from auditoria where accion = 'intento_duplicado'`))[0].n);
  ok(ing.d === 'cel-0' && ing.t.getTime() === t0s, `un solo ingreso y gana el que escaneó primero, sin importar el orden de llegada (${ing.d})`);
  ok(dupDespues - dupAntes === 3, `los otros 3 quedan como intento duplicado en la auditoría (${dupDespues - dupAntes})`);
} catch (err) {
  console.error(err);
  c.fallas++;
} finally {
  await base.detener();
}
if (c.fallas) { console.log(`\n${c.fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nConcurrencia: todo bien.');
