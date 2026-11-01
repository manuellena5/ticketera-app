// Recorre las pantallas de la fase 0 con Chromium headless:
//  - sin errores de consola ni violaciones de CSP;
//  - en pantalla no aparecen UUIDs, "supabase" ni nombres de tablas;
//  - versión visible, botones de 48 px o más, texto de 16 px o más;
//  - el service worker cachea la app y abre sin conexión;
//  - un error de ingreso se muestra en términos de la persona.
//   node tests/ui/fase0.mjs
import { createRequire } from 'node:module';
import { servir } from '../servir.mjs';
import { URL_PROYECTO } from '../backend_local.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PROHIBIDO = [/[0-9a-f]{8}-[0-9a-f]{4}-/i, /supabase/i,
  /\b(eventos|tandas|config_club|perfiles|rrpp_evento|ventas|entradas|movimientos_rrpp|auditoria|intentos_link|secretos_evento)\b(?=[_(]|\.[a-z])/i,
  /\b(rpc|jwt|uuid|null|undefined|NaN|P0001|42501)\b/];

let fallas = 0;
const ok = (cond, desc) => { console.log((cond ? '  ok · ' : '  FALLA · ') + desc); if (!cond) fallas++; };

const srv = await servir(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const navegador = await chromium.launch();

async function nuevaPagina(contexto) {
  const page = await contexto.newPage();
  page.errores = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errores.push(m.text()); });
  page.on('pageerror', (e) => page.errores.push(String(e)));
  return page;
}

async function revisarPantalla(page, nombre) {
  const texto = await page.evaluate(() => document.body.innerText);
  const encontrado = PROHIBIDO.map((re) => texto.match(re)).filter(Boolean).map((m) => m[0]);
  ok(encontrado.length === 0, `${nombre}: sin datos internos en pantalla` + (encontrado.length ? ` (${encontrado.join(', ')})` : ''));
  ok(page.errores.length === 0, `${nombre}: sin errores de consola ni CSP` + (page.errores.length ? ` (${page.errores.join(' | ')})` : ''));
  const chicos = await page.evaluate(() => [...document.querySelectorAll('button, .boton, input')]
    .filter((b) => b.offsetParent).filter((b) => b.getBoundingClientRect().height < 48).map((b) => b.textContent || b.name));
  ok(chicos.length === 0, `${nombre}: botones y campos de 48 px o más` + (chicos.length ? ` (${chicos.join(', ')})` : ''));
  const letraChica = await page.evaluate(() => [...document.querySelectorAll('main *')]
    .filter((e) => e.offsetParent && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.textContent.trim().slice(0, 30)));
  ok(letraChica.length === 0, `${nombre}: texto de 16 px o más` + (letraChica.length ? ` (${letraChica.join(', ')})` : ''));
}

const MOVIL = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR' };

// 1) App sin configurar (estado del repo)
{
  const ctx = await navegador.newContext(MOVIL);
  const page = await nuevaPagina(ctx);
  await page.goto(BASE);
  await page.waitForSelector('.aviso');
  ok((await page.textContent('#version')) === '· v1', 'índice: muestra "· v1" en el encabezado');
  ok(/no está lista/.test(await page.textContent('main')), 'índice sin configurar: aviso claro');
  ok(await page.evaluate(() => document.fonts.check('16px Figtree')), 'tipografía Figtree cargada desde el repo');
  await revisarPantalla(page, 'índice sin configurar');

  // Service worker y modo avión
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const cacheNombres = await page.evaluate(() => caches.keys());
  ok(cacheNombres.includes('entradas-v1'), 'service worker: caché "entradas-v1"');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.aviso');
  ok(await page.isVisible('#sin-conexion'), 'sin conexión: abre desde la caché y avisa');
  const p2 = await nuevaPagina(ctx);
  await p2.goto(BASE + 'entrada.html#t=ABC');
  await p2.waitForSelector('.hero');
  ok(/no está completo/.test(await p2.textContent('main')), 'sin conexión: la página del comprador abre desde la caché');
  await ctx.close();
}

// 2) App configurada (se simula config.js y la respuesta de ingreso)
{
  const ctx = await navegador.newContext(MOVIL);
  await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body:
    "window.CONFIG = Object.freeze({ SUPABASE_URL: '" + URL_PROYECTO + "', SUPABASE_ANON_KEY: 'clave-publica-de-prueba', AUTH_DOMAIN: 'usuarios.ticketera-app.com.ar', NOMBRE_CLUB: 'Club Deportivo Mitre' });" }));
  let emailPedido = null;
  await ctx.route(URL_PROYECTO + '/auth/v1/token**', async (r) => {
    emailPedido = JSON.parse(r.request().postData() || '{}').email;
    await r.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
  });
  const page = await nuevaPagina(ctx);
  await page.goto(BASE);
  await page.waitForSelector('#form-ingreso');
  await revisarPantalla(page, 'ingreso');
  await page.fill('input[name=usuario]', '  Lucia ');
  await page.fill('input[name=clave]', 'equivocada');
  await page.click('button[type=submit]');
  await page.waitForSelector('.aviso--error');
  ok((await page.textContent('.aviso--error')) === 'Usuario o contraseña incorrectos.', 'ingreso fallido: mensaje claro');
  ok(emailPedido === 'lucia@usuarios.ticketera-app.com.ar', 'el usuario se convierte en el mail interno (minúsculas, sin espacios)');
  page.errores = page.errores.filter((e) => !/400/.test(e));   // el 400 simulado lo loguea el navegador
  await revisarPantalla(page, 'ingreso con error');

  await page.click('button[type=submit]');   // campos vacíos tras re-render
  await page.waitForSelector('.aviso--error');
  ok((await page.textContent('.aviso--error')) === 'Completá usuario y contraseña.', 'campos vacíos: mensaje claro');
  await ctx.close();
}

// 3) Página del comprador
{
  const ctx = await navegador.newContext(MOVIL);
  const page = await nuevaPagina(ctx);
  await page.goto(BASE + 'entrada.html');
  await page.waitForSelector('.aviso');
  ok(/no está completo/.test(await page.textContent('main')), 'comprador sin token: aviso claro');
  await revisarPantalla(page, 'comprador sin token');
  await page.goto(BASE + 'entrada.html#t=ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  await page.reload();
  await page.waitForSelector('.aviso');
  ok(/no está lista/.test(await page.textContent('main')), 'comprador con la app sin configurar: aviso claro');
  await revisarPantalla(page, 'comprador con token');
  await ctx.close();
}

await navegador.close();
srv.close();
if (fallas) { console.log(`\n${fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nUI fase 0: todo bien.');
