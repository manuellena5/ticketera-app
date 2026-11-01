// Registro de errores técnicos de punta a punta.
//   node tests/ui/errores.mjs
import { createRequire } from 'node:module';
import { servir } from '../servir.mjs';
import { levantarBase, instalarSupabase, comoUsuario } from '../backend_local.mjs';
import { MOVIL, contador, seguirErrores, revisor } from './comun.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const c = contador();
const ok = c.ok;
const revisar = revisor(ok);
const base = await levantarBase({ ahora: '2026-11-10 12:00:00-03' });
const q = async (sql, p) => (await base.pool.query(sql, p)).rows;
const srv = await servir(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const nav = await chromium.launch();
const esperar = async (fn, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const texto = (page, sel = 'body') => page.innerText(sel).then((t) => t.replace(/\s+/g, ' ').trim());

try {
  console.log('\n== Servicio de usuarios caído (como el error de CORS)');
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const reg = await instalarSupabase(ctx, base.pool);
  const p = await ctx.newPage();
  seguirErrores(p);
  await p.goto(BASE);
  await p.fill('input[name=usuario]', 'admin');
  await p.fill('input[name=clave]', 'prueba1234');
  await p.click('button[type=submit]');
  await p.waitForSelector('#form-clave');
  await p.fill('input[name=clave]', 'claveNueva1');
  await p.fill('input[name=clave2]', 'claveNueva1');
  await p.click('button[type=submit]');
  await p.waitForSelector('.admin-kpis');
  reg.funcionCaida = true;
  await p.click('a[href="#rrpp"]');
  await p.waitForSelector('#nuevo-usuario');
  await p.click('#nuevo-usuario');
  await p.fill('#form-nuevo [name=nombre]', 'Juan Gómez');
  await p.fill('#form-nuevo [name=usuario]', 'juan.gomez');
  await p.click('#crear-usuario');
  await p.waitForSelector('#panel .aviso--error');
  ok(/No se pudo conectar con el servicio que crea usuarios/.test(await texto(p, '#panel .aviso--error')), 'el admin ve un mensaje claro (no el error técnico)');
  ok(await esperar(async () => (await q(`select count(*)::int n from errores_tecnicos where origen = 'funcion'`))[0].n === 1),
     'y el detalle técnico queda en la tabla de errores');
  const [ef] = await q(`select usuario_id, rol, detalle from errores_tecnicos where origen = 'funcion'`);
  ok(ef.rol === 'admin' && ef.detalle.funcion === 'admin_crear_usuario' && ef.detalle.accion === 'crear', 'con quién, qué función y qué acción');
  p.errores = [];
  reg.funcionCaida = false;

  console.log('\n== Errores de la app (JavaScript)');
  await p.evaluate(() => { setTimeout(() => { throw new Error('prueba de error en la app'); }, 0); });
  ok(await esperar(async () => (await q(`select count(*)::int n from errores_tecnicos where origen = 'js' and mensaje like '%prueba de error en la app%'`))[0].n === 1),
     'un error de JavaScript se registra solo');
  await p.evaluate(() => { Promise.reject(new Error('promesa rota de prueba')); });
  ok(await esperar(async () => (await q(`select count(*)::int n from errores_tecnicos where mensaje like '%promesa rota de prueba%'`))[0].n === 1),
     'y también una promesa sin manejar');
  p.errores = [];

  console.log('\n== Panel: sección Errores');
  await p.click('a[href="#errores"]');
  await p.waitForSelector('a[href="#errores"][aria-current="page"]');
  await p.waitForSelector('.tabla tbody tr[data-i]');
  const t = await texto(p, 'main');
  ok(/Servicio de usuarios/.test(t) && /prueba de error en la app/.test(t) && /Administración/.test(t), 'el admin ve los errores con dónde, quién y qué pasó');
  await p.click('tr[data-i]:has-text("Servicio de usuarios")');
  await p.waitForSelector('.detalle-error');
  ok(/admin_crear_usuario/.test(await texto(p, '.detalle-error')), 'tocando uno se ve el detalle técnico');
  p.errores = p.errores.filter((m) => !/prueba de error|promesa rota/.test(m));
  await revisar(p, 'errores técnicos (muestra detalle técnico a propósito)', { tecnica: true });
  await p.click('#err-revisados');
  ok(await esperar(async () => (await q(`select count(*)::int n from errores_tecnicos where not revisado`))[0].n === 0), 'marcar como revisados');
  await ctx.close();

  console.log('\n== Página del comprador y sin conexión');
  const [{ r }] = await comoUsuario(base.pool, '00000000-0000-4000-8000-000000000011',
    `select public.emitir_venta(gen_random_uuid(), 'Ana Pérez', '30111222', null, 1, 'efectivo') as r`);
  const ctx2 = await nav.newContext({ ...MOVIL, serviceWorkers: 'block' });
  await instalarSupabase(ctx2, base.pool);
  const pc = await ctx2.newPage();
  await pc.goto(BASE + 'entrada.html#t=' + r.token);
  await pc.waitForSelector('#form-dni');
  await pc.evaluate(() => { setTimeout(() => { throw new Error('falla en la página del comprador'); }, 0); });
  ok(await esperar(async () => (await q(`select count(*)::int n from errores_tecnicos where mensaje like '%falla en la página del comprador%'`))[0].n === 1),
     'los errores de la página del comprador también se registran (sin sesión)');
  const [ec] = await q(`select usuario_id, pagina, pantalla from errores_tecnicos where mensaje like '%falla en la página del comprador%'`);
  ok(ec.usuario_id === null && !/#|[A-Z2-7]{26}/.test(ec.pagina + ' ' + ec.pantalla), 'sin usuario y sin el token del link');
  await ctx2.setOffline(true);
  await pc.evaluate(() => { setTimeout(() => { throw new Error('error sin señal'); }, 0); });
  await pc.waitForTimeout(500);
  ok((await q(`select count(*)::int n from errores_tecnicos where mensaje like '%error sin señal%'`))[0].n === 0, 'sin señal se guarda en el celular');
  await ctx2.setOffline(false);
  await pc.evaluate(() => window.dispatchEvent(new Event('online')));
  ok(await esperar(async () => (await q(`select count(*)::int n from errores_tecnicos where mensaje like '%error sin señal%'`))[0].n === 1), 'y se manda cuando vuelve la señal');
  await ctx2.close();
} catch (err) {
  console.error(err);
  c.fallas++;
} finally {
  await nav.close();
  srv.close();
  await base.detener();
}
if (c.fallas) { console.log(`\n${c.fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nErrores técnicos: todo bien.');
