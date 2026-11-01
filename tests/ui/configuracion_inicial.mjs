// Prueba supabase/configuracion_inicial.sql sobre una base limpia (solo
// migraciones, sin semilla), como un proyecto recién creado: crea el admin,
// el evento y las tandas; el admin entra, cambia la contraseña y ve el panel.
//   node tests/ui/configuracion_inicial.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { servir } from '../servir.mjs';
import { levantarBase, instalarSupabase } from '../backend_local.mjs';
import { contador, seguirErrores, revisor } from './comun.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const c = contador();
const ok = c.ok;
const revisar = revisor(ok);
const base = await levantarBase({ semilla: false });
const q = async (sql, p) => (await base.pool.query(sql, p)).rows;
const srv = await servir(0);
const nav = await chromium.launch();
const script = readFileSync(new URL('../../supabase/configuracion_inicial.sql', import.meta.url), 'utf8');

try {
  let fallo = null;
  try { await base.pool.query(script); } catch (err) { fallo = err.message; }
  ok(/Cambiá la contraseña temporal/.test(fallo || ''), 'si no se cambia la contraseña de ejemplo, el script se niega a correr');
  ok((await q('select count(*)::int n from perfiles'))[0].n === 0, 'y no deja nada a medias');

  const conClave = script.replace("'CAMBIAR-esta-clave-1'", "'Temporal-2026'");
  await base.pool.query(conClave);
  const [v] = await q(`select (select count(*)::int from perfiles where rol = 'admin') a, (select count(*)::int from eventos) e,
                              (select count(*)::int from tandas) t, (select estado from eventos limit 1) est,
                              (select count(*)::int from secretos_evento) s, (select count(*)::int from config_club) cc`);
  ok(v.a === 1 && v.e === 1 && v.t === 3 && v.s === 1 && v.cc === 1, '1 admin, 1 evento, 3 tandas, sal del evento y configuración');
  ok(v.est === 'borrador', 'el evento queda en borrador (no se vende hasta que el admin lo habilite)');
  await base.pool.query(conClave);
  const [v2] = await q(`select (select count(*)::int from perfiles) a, (select count(*)::int from eventos) e, (select count(*)::int from tandas) t`);
  ok(v2.a === 1 && v2.e === 1 && v2.t === 3, 'correrlo dos veces no duplica nada');

  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await instalarSupabase(ctx, base.pool);
  const p = seguirErrores(await ctx.newPage());
  await p.goto(`http://127.0.0.1:${srv.address().port}/`);
  await p.fill('input[name=usuario]', 'admin');
  await p.fill('input[name=clave]', 'Temporal-2026');
  await p.click('button[type=submit]');
  await p.waitForSelector('#form-clave');
  ok(true, 'el admin entra con la contraseña temporal y se le pide cambiarla');
  await p.fill('input[name=clave]', 'MiClaveDeAdmin1');
  await p.fill('input[name=clave2]', 'MiClaveDeAdmin1');
  await p.click('button[type=submit]');
  await p.waitForSelector('.admin-kpis');
  const t = (await p.innerText('main')).replace(/\s+/g, ' ');
  ok(/Entradas emitidas 0 \/ 1\.000/.test(t) && /Venta RRPP abierta|La venta todavía no está abierta/.test(t), 've el tablero del evento recién creado');
  await revisar(p, 'tablero recién configurado');
  await p.click('a[href="#evento"]');
  await p.waitForSelector('#form-evento');
  ok(/Anticipada.*General.*Puerta/.test((await p.innerText('main')).replace(/\s+/g, ' ')), 'las 3 tandas aparecen en Evento y tandas');
  await p.selectOption('#form-evento [name=estado]', 'venta');
  await p.fill('#form-evento [name=lugar]', 'Salón del club');
  await p.click('#guardar-evento');
  await p.waitForSelector('#aviso-toast:not([hidden]) >> text=Cambios guardados.');
  ok((await q('select estado, lugar from eventos'))[0].estado === 'venta', 'desde el panel se pone "A la venta" y se carga el lugar');
  await ctx.close();
} catch (err) {
  console.error(err);
  c.fallas++;
} finally {
  await nav.close();
  srv.close();
  await base.detener();
}
if (c.fallas) { console.log(`\n${c.fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nConfiguración inicial: todo bien.');
