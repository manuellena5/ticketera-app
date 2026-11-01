// Fase 1 · RRPP de punta a punta (Chromium headless + Postgres local con las
// migraciones reales; Auth y RPC de Supabase emulados en tests/backend_local.mjs).
//   node tests/ui/fase1.mjs
import { createRequire } from 'node:module';
import { servir } from '../servir.mjs';
import { levantarBase, instalarSupabase, fijarReloj } from '../backend_local.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PROHIBIDO = [/[0-9a-f]{8}-[0-9a-f]{4}-/i, /supabase/i,
  /\b(eventos|tandas|config_club|perfiles|rrpp_evento|ventas|entradas|movimientos_rrpp|auditoria|intentos_link|secretos_evento)\b(?=[_(]|\.[a-z])/i,
  /\b(rpc|jwt|uuid|null|undefined|NaN|P0001|42501|PGRST\d+)\b/, /\[object /];

let fallas = 0;
const ok = (cond, desc) => { console.log((cond ? '  ok · ' : '  FALLA · ') + desc); if (!cond) fallas++; };

const base = await levantarBase({ ahora: '2026-11-10 12:00:00-03' });
const { pool } = base;
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const srv = await servir(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const navegador = await chromium.launch();
const MOVIL = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR' };

async function contexto(opciones = {}) {
  const ctx = await navegador.newContext({ ...MOVIL, ...opciones });
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>WhatsApp</p>' }));
  ctx.registro = await instalarSupabase(ctx, pool);
  return ctx;
}

async function pagina(ctx) {
  const page = await ctx.newPage();
  page.errores = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|ERR_INTERNET_DISCONNECTED/.test(m.text())) page.errores.push(m.text()); });
  page.on('pageerror', (e) => page.errores.push(String(e)));
  return page;
}

const revisadas = new Set();
async function revisar(page, nombre) {
  await page.waitForTimeout(50);
  const texto = await page.evaluate(() => document.body.innerText);
  const hallado = PROHIBIDO.map((re) => texto.match(re)).filter(Boolean).map((m) => m[0]);
  const chicos = await page.evaluate(() => [...document.querySelectorAll('button, .boton, input, a.boton')]
    .filter((b) => b.offsetParent && b.type !== 'hidden').filter((b) => b.getBoundingClientRect().height < 44)
    .map((b) => (b.textContent || b.name || b.id).trim()));
  const letra = await page.evaluate(() => [...document.querySelectorAll('main *')]
    .filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.textContent.trim().slice(0, 25)));
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const problemas = [
    hallado.length && 'datos internos: ' + hallado.join(', '),
    page.errores.length && 'consola: ' + page.errores.join(' | '),
    chicos.length && 'botones chicos: ' + chicos.join(', '),
    letra.length && 'texto < 16px: ' + letra.join(', '),
    !ancho && 'scroll horizontal',
  ].filter(Boolean);
  if (!revisadas.has(nombre) || problemas.length) ok(problemas.length === 0, `pantalla "${nombre}": sin IDs ni jerga, sin errores, 48 px, 16 px, sin scroll lateral` + (problemas.length ? ' → ' + problemas.join(' / ') : ''));
  revisadas.add(nombre);
  page.errores = [];
}

async function ingresar(page, usuario, clave = 'prueba1234') {
  await page.goto(BASE);
  await page.waitForSelector('#form-ingreso');
  await page.fill('input[name=usuario]', usuario);
  await page.fill('input[name=clave]', clave);
  await page.click('button[type=submit]');
}

async function cambiarClave(page, clave = 'claveNueva1') {
  await page.waitForSelector('#form-clave');
  await page.fill('input[name=clave]', clave);
  await page.fill('input[name=clave2]', clave);
  await page.click('button[type=submit]');
}

const textoDe = (page, sel) => page.innerText(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim());

try {
  // =====================================================================
  console.log('\n== Ingreso y cambio de contraseña obligatorio');
  const ctx = await contexto({ serviceWorkers: 'block' });
  const page = await pagina(ctx);
  await ingresar(page, 'lucia', 'mal');
  await page.waitForSelector('.aviso--error');
  ok(await textoDe(page, '.aviso--error') === 'Usuario o contraseña incorrectos.', 'contraseña incorrecta: mensaje claro');
  await ingresar(page, 'Lucia');
  await page.waitForSelector('#form-clave');
  ok(/elegí una contraseña tuya/i.test(await textoDe(page, 'main')), 'primer ingreso: obliga a elegir contraseña');
  await revisar(page, 'cambiar contraseña');
  await page.fill('input[name=clave]', 'corta');
  await page.fill('input[name=clave2]', 'corta');
  await page.click('button[type=submit]');
  await page.waitForSelector('.aviso--error');
  ok(/al menos 8/.test(await textoDe(page, '.aviso--error')), 'contraseña corta: rechazada');
  await page.fill('input[name=clave]', 'claveNueva1');
  await page.fill('input[name=clave2]', 'otraCosa22');
  await page.click('button[type=submit]');
  await page.waitForSelector('.aviso--error');
  ok(/no coinciden/.test(await textoDe(page, '.aviso--error')), 'contraseñas distintas: rechazadas');
  await page.fill('input[name=clave]', 'prueba1234');
  await page.fill('input[name=clave2]', 'prueba1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('.aviso--error');
  ok(/distinta/.test(await textoDe(page, '.aviso--error')), 'misma contraseña temporal: rechazada');
  await cambiarClave(page);
  await page.waitForSelector('text=Hola, Lucía');
  ok((await q(`select debe_cambiar_clave from perfiles where usuario = 'lucia'`))[0].debe_cambiar_clave === false, 'la base registra que ya cambió la contraseña');

  // =====================================================================
  console.log('\n== Inicio');
  await page.waitForSelector('.tanda-vigente');
  ok(await textoDe(page, '.tanda-vigente') === 'Tanda vigente Anticipada · $20.000 hasta el 30/11', 'tanda vigente: "Anticipada · $20.000 · hasta el 30/11"');
  ok(/Simón Aguirre · Vie 18\/12/.test(await textoDe(page, 'header')), 'encabezado con artista y fecha');
  ok(/· v1/.test(await textoDe(page, 'header')), 'versión chiquita en el encabezado');
  ok(/Tu comisión/.test(await textoDe(page, 'main')), 'Lucía ve su comisión');
  ok(/Todavía no vendiste/.test(await textoDe(page, 'main')), 'sin ventas todavía');
  await revisar(page, 'inicio');

  // =====================================================================
  console.log('\n== Emitir en 3 toques');
  await page.click('#nueva');                                                     // toque 1
  await page.waitForSelector('#form-venta');
  ok(/Anticipada · \$20\.000 cada una/.test(await textoDe(page, 'header')), 'Nueva entrada muestra tanda y precio');
  await revisar(page, 'nueva entrada');
  await page.fill('input[name=nombre]', 'Ana Pérez');
  await page.fill('input[name=dni]', '30.123.456');
  await page.fill('input[name=tel]', '03401 15 551234');
  await page.click('#mas');
  ok(await textoDe(page, '#total') === '$40.000' && await textoDe(page, '#emitir') === 'Emitir 2 entradas', 'total grande y botón "Emitir 2 entradas"');
  await page.click('#emitir');                                                    // toque 2
  await page.waitForSelector('text=Entradas listas');
  ok(/Ana Pérez · 2 entradas · \$40\.000 en efectivo/.test(await textoDe(page, 'main')), 'resumen de la venta');
  const href = await page.getAttribute('#enviar', 'href');
  const urlWa = new URL(href);
  const textoWa = urlWa.searchParams.get('text');
  ok(urlWa.origin + urlWa.pathname === 'https://wa.me/5493401551234', 'WhatsApp al número normalizado (sin 0 ni 15)');
  ok(/^¡Hola Ana! Estas son tus 2 entradas para \*Simón Aguirre\*, viernes 18\/12\./.test(textoWa), 'mensaje armado con nombre, cantidad, artista y fecha');
  const token = (textoWa.match(/entrada\.html#t=([A-Z2-7]{26})/) || [])[1];
  ok(!!token, 'el mensaje lleva el link con el token en el fragmento (#t=)');
  const venta = (await q(`select * from ventas where titular_dni = '30123456'`))[0];
  ok(venta && Number(venta.precio_unitario) === 20000 && Number(venta.comision_unitaria) === 750 && venta.cantidad === 2, 'en la base: 2 entradas a $20.000 con comisión $750');
  ok(venta.link_hash === (await q('select privado.sha256_hex($1) h', [token]))[0].h, 'la base guarda solo el hash del token');
  await revisar(page, 'entrada lista');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#enviar')]);  // toque 3
  await popup.close();
  await page.waitForTimeout(300);
  ok((await q('select enviada_en from ventas where id = $1', [venta.id]))[0].enviada_en !== null, 'tocar "Enviar por WhatsApp" la marca como enviada');
  const cliente = await ctx.newPage();
  await cliente.close();

  await page.click('#copiar');
  await page.waitForSelector('#aviso-toast:not([hidden])');
  ok(await textoDe(page, '#aviso-toast') === 'Link copiado.', '"Copiar link" avisa');
  await page.click('#inicio');
  await page.waitForSelector('.fila-venta');
  ok(/Ana Pérez 2 entradas · Efectivo Enviada/.test(await textoDe(page, '.fila-venta')), 'la venta aparece en "Mis ventas" como Enviada');
  ok(/\$40\.000/.test(await textoDe(page, '.tarjeta--ancha')), 'efectivo a rendir: $40.000');
  ok(/\$1\.500/.test(await textoDe(page, '.tarjetas')), 'comisión: 2 × $750 = $1.500');

  // =====================================================================
  console.log('\n== Validaciones, doble toque y transferencia');
  await page.click('#nueva');
  await page.fill('input[name=nombre]', 'Juan Díaz');
  await page.fill('input[name=dni]', '123');
  await page.click('#emitir');
  await page.waitForSelector('#error');
  ok(await textoDe(page, '#error') === 'Revisá el DNI: tiene que tener 7 u 8 números.' &&
     await page.getAttribute('input[name=dni]', 'aria-invalid') === 'true', 'DNI inválido: mensaje claro y campo marcado');
  ok(await page.inputValue('input[name=nombre]') === 'Juan Díaz', 'no se pierde lo que ya escribió');
  await revisar(page, 'nueva entrada con error');
  await page.fill('input[name=dni]', '31222333');
  await page.fill('input[name=tel]', '');
  await page.click('[data-medio=transferencia]');
  await page.waitForSelector('.datos-club');
  ok(/Alias CLUB\.MITRE\.PRUEBA/.test(await textoDe(page, '.datos-club')) && /Pedile el comprobante/.test(await textoDe(page, '.datos-club')),
     'transferencia: muestra los datos del club y "Pedile el comprobante"');
  await revisar(page, 'nueva entrada transferencia');
  await page.click('#copiar-alias');
  await page.waitForSelector('#aviso-toast:not([hidden])');
  ok(await textoDe(page, '#aviso-toast') === 'Alias copiado.', '"Copiar alias" funciona');
  const antes = (await q('select count(*)::int n from ventas'))[0].n;
  await page.evaluate(() => { const b = document.getElementById('emitir'); b.click(); b.click(); b.click(); });
  await page.waitForSelector('text=Entrada lista');
  await page.waitForTimeout(400);
  ok((await q('select count(*)::int n from ventas'))[0].n === antes + 1, 'el doble (triple) toque no duplica la venta');
  ok(new URL(await page.getAttribute('#enviar', 'href')).pathname === '/', 'sin WhatsApp cargado: abre WhatsApp para elegir contacto');

  // Reintento tras corte de red: misma clave, una sola venta
  await page.click('#otra');
  await page.fill('input[name=nombre]', 'Pedro Gómez');
  await page.fill('input[name=dni]', '32333444');
  ctx.registro.cortarRespuesta.emitir_venta = 1;   // la venta se registra pero la respuesta no llega
  await page.click('#emitir');
  await page.waitForSelector('#error');
  ok(/Sin conexión/.test(await textoDe(page, '#error')), 'si se corta la respuesta: avisa sin conexión');
  await page.click('#emitir');
  await page.waitForSelector('text=Entrada lista');
  ok((await q(`select count(*)::int n from ventas where titular_dni = '32333444'`))[0].n === 1, 'el reintento no duplica (misma clave de la venta)');
  page.errores = page.errores.filter((m) => !/ERR_FAILED/.test(m));   // el corte simulado

  // =====================================================================
  console.log('\n== Precio y comisión no se pueden alterar desde el celular');
  const r1 = await page.evaluate(async () => {
    const c = API.conSesion();
    const a = await c.rpc('emitir_venta', { p_idem: U.nuevaClave(), p_nombre: 'Trucho', p_dni: '33444555', p_tel: null, p_cantidad: 1, p_medio: 'efectivo', p_precio_visto: 1 });
    const b = await c.rpc('emitir_venta', { p_idem: U.nuevaClave(), p_nombre: 'Trucho', p_dni: '33444555', p_tel: null, p_cantidad: 1, p_medio: 'efectivo', p_precio: 1, p_comision: 0 });
    const d = await c.from('ventas').update({ precio_unitario: 1 }).eq('titular_dni', '30123456').select();
    const f = await c.from('rrpp_evento').update({ comision_por_entrada: 99999 }).neq('comision_por_entrada', -1).select();
    return { a: a.error && a.error.hint, b: !!b.error, d: !!d.error || (d.data || []).length === 0, f: !!f.error || (f.data || []).length === 0 };
  }).catch((e) => ({ err: String(e) }));
  ok(r1.a === 'precio_cambio', 'mandar otro precio no emite');
  ok(r1.b, 'mandar parámetros de precio/comisión inventados no funciona');
  ok((await q(`select count(*)::int n from ventas where titular_nombre = 'Trucho'`))[0].n === 0, 'ninguna venta trucha quedó registrada');

  // =====================================================================
  console.log('\n== Cambio de tanda al agotarse');
  await page.click('#inicio');
  await page.click('#nueva');
  await page.waitForSelector('#form-venta');
  await page.fill('input[name=nombre]', 'Carla Ruiz');
  await page.fill('input[name=dni]', '34555666');
  await q(`update tandas set cantidad = privado.emitidas_tanda(id) where nombre = 'Anticipada'`);   // se agota mientras completa
  await page.click('#emitir');
  await page.waitForSelector('#error');
  ok(await textoDe(page, '#error') === 'Cambió la tanda: ahora vendés General a $23.000. Revisá el total antes de emitir.', 'si la tanda cambia mientras completa: frena y avisa el precio nuevo');
  ok(await textoDe(page, '#total') === '$23.000' && /General · \$23\.000/.test(await textoDe(page, 'header')), 'el formulario se actualiza al precio General');
  await page.click('#emitir');
  await page.waitForSelector('text=Entrada lista');
  ok(Number((await q(`select precio_unitario from ventas where titular_dni = '34555666'`))[0].precio_unitario) === 23000, 'la venta sale a precio General aunque no llegó su fecha');
  await page.click('#inicio');
  await page.waitForSelector('text=Se agotó la Anticipada');
  ok(/Se agotó la Anticipada\. Ahora vendés General a \$23\.000\./.test(await textoDe(page, 'main')), 'Inicio: "Se agotó la Anticipada. Ahora vendés General a $23.000."');

  // =====================================================================
  console.log('\n== Detalle, reenvío y Mis ventas');
  await page.click('.fila-venta >> text=Ana Pérez');
  await page.waitForSelector('.entrada-fila');
  ok(/Entrada 1 de 2 Sin usar Entrada 2 de 2 Sin usar/.test(await textoDe(page, 'main')), 'detalle: estado de cada entrada');
  ok(/pedíselo al administrador/.test(await textoDe(page, 'main')), 'el RRPP no anula: se lo pide al admin');
  await revisar(page, 'detalle de venta');
  await q(`update entradas set ingreso_en = '2026-12-18 23:14:00-03' where venta_id = $1 and nro = 1`, [venta.id]);
  await page.click('#volver');
  await page.click('.fila-venta >> text=Ana Pérez');
  await page.waitForSelector('text=Ingresó 23:14');
  ok(true, 'detalle: "Ingresó 23:14"');
  const hashAntes = venta.link_hash;
  await page.click('#reenviar');
  await page.waitForSelector('dialog[open]');
  await revisar(page, 'confirmar reenvío');
  await page.click('dialog button[value=si]');
  await page.waitForSelector('text=Entradas listas');
  const hashDespues = (await q('select link_hash from ventas where id = $1', [venta.id]))[0].link_hash;
  ok(hashDespues !== hashAntes, 'reenviar genera un link nuevo (el anterior deja de andar)');
  await page.click('#inicio');
  await page.waitForSelector('.fila-venta');
  ok(/Ana Pérez 2 entradas · Efectivo Ingresaron 1 de 2/.test(await textoDe(page, 'main')), 'la lista muestra "Ingresaron 1 de 2"');
  // Ver todas: hacen falta más de 5 ventas
  for (let i = 0; i < 3; i++) {
    await page.evaluate(async (i) => API.rpc('emitir_venta', { p_idem: U.nuevaClave(), p_nombre: 'Persona ' + i, p_dni: '4000000' + i, p_tel: null, p_cantidad: 1, p_medio: 'efectivo' }), i);
  }
  await page.reload();
  await page.waitForSelector('#ver-todas');
  await page.click('#ver-todas');
  await page.waitForSelector('#buscar');
  await revisar(page, 'mis ventas');
  await page.fill('#buscar', '3012');
  await page.waitForTimeout(100);
  ok((await page.$$('.fila-venta')).length === 1 && /Ana Pérez/.test(await textoDe(page, '.lista')), 'buscar por DNI');
  await page.fill('#buscar', 'pedro');
  await page.waitForTimeout(100);
  ok((await page.$$('.fila-venta')).length === 1 && /Pedro Gómez/.test(await textoDe(page, '.lista')), 'buscar por nombre');
  await page.goBack();
  await page.waitForSelector('.tanda-vigente');
  ok(true, 'el botón atrás del celular vuelve al Inicio');

  // =====================================================================
  console.log('\n== Sin conexión');
  await ctx.setOffline(true);
  await page.click('#nueva');
  await page.waitForSelector('#error');
  ok(await textoDe(page, '#error') === 'Sin conexión. Para emitir entradas necesitás internet.', 'Nueva entrada sin señal: mensaje correcto');
  await page.fill('input[name=nombre]', 'Sin Señal');
  await page.fill('input[name=dni]', '35666777');
  const n0 = (await q('select count(*)::int n from ventas'))[0].n;
  await page.click('#emitir');
  await page.waitForTimeout(200);
  ok(await textoDe(page, '#error') === 'Sin conexión. Para emitir entradas necesitás internet.' && (await q('select count(*)::int n from ventas'))[0].n === n0, 'no emite sin señal');
  ok(await page.isVisible('#sin-conexion'), 'barra "Sin conexión" visible');
  await revisar(page, 'nueva entrada sin conexión');
  await page.click('#volver');
  await page.waitForSelector('.fila-venta');
  ok((await page.$$('.fila-venta')).length === 5, 'sin señal igual se ven las últimas ventas');
  await ctx.setOffline(false);
  await ctx.close();

  // Con el service worker: abrir la app en modo avión muestra lo guardado
  const ctxSW = await contexto();
  const pSW = await pagina(ctxSW);
  await ingresar(pSW, 'lucia', 'claveNueva1');
  await pSW.waitForSelector('.fila-venta');
  await pSW.evaluate(() => navigator.serviceWorker.ready);
  await pSW.reload();
  await pSW.waitForSelector('.fila-venta');
  const configOk = await pSW.evaluate(() => API.configurado());
  if (configOk && await pSW.evaluate(() => !!navigator.serviceWorker.controller)) {
    await ctxSW.setOffline(true);
    await pSW.reload();
    await pSW.waitForSelector('.tanda-vigente');
    ok(/Estás viendo lo último guardado/.test(await textoDe(pSW, 'main')) && (await pSW.$$('.fila-venta')).length === 5,
       'modo avión: la app abre y muestra las últimas ventas guardadas');
    await revisar(pSW, 'inicio sin conexión');
  } else {
    ok(false, 'el service worker no tomó control de la página');
  }
  await ctxSW.close();

  // =====================================================================
  console.log('\n== Ad honorem, límite por porcentaje y tope');
  const ctx2 = await contexto({ serviceWorkers: 'block' });
  const p2 = await pagina(ctx2);
  await ingresar(p2, 'martin');
  await cambiarClave(p2);
  await p2.waitForSelector('.tanda-vigente');
  ok(!/Tu comisión/.test(await textoDe(p2, 'main')), 'Martín (ad honorem) no ve la tarjeta de comisión');
  await ctx2.close();

  await q(`update tandas set cantidad = 50 where nombre = 'General'`);  // Sofía: 20% de 50 = 10
  const ctx3 = await contexto({ serviceWorkers: 'block' });
  const p3 = await pagina(ctx3);
  await ingresar(p3, 'sofia');
  await cambiarClave(p3);
  await p3.waitForSelector('.tanda-vigente');
  ok(/Te quedan 10 en esta tanda/.test(await textoDe(p3, '.tarjetas')), 'Sofía: "Te quedan 10 en esta tanda" (20% de 50)');
  await q(`update tandas set cantidad = 100 where nombre = 'General'`);
  await p3.reload();
  await p3.waitForSelector('.tanda-vigente');
  ok(/Te quedan 20 en esta tanda/.test(await textoDe(p3, '.tarjetas')), 'el límite por % se ajusta solo si cambia la tanda (20% de 100 = 20)');
  await p3.click('#nueva');
  for (let i = 0; i < 5; i++) await p3.click('#mas');
  ok(await textoDe(p3, '#cantidad') === '6' && await p3.isDisabled('#mas'), 'cantidad de 1 a 6');
  await q(`update eventos set tope_entradas = privado.emitidas_evento(id) + 2`);
  await p3.fill('input[name=nombre]', 'Grupo Grande');
  await p3.fill('input[name=dni]', '36777888');
  await p3.click('#emitir');
  await p3.waitForSelector('#error');
  ok(await textoDe(p3, '#error') === 'Quedan 2 lugares en el evento.', 'tope: "Quedan 2 lugares en el evento."');
  await q(`update eventos set tope_entradas = 1000`);

  // Desactivar mientras está usando la app
  await q(`update perfiles set activo = false where usuario = 'sofia'`);
  await p3.click('#emitir');
  await p3.waitForSelector('#form-ingreso');
  ok(/Tu usuario está desactivado/.test(await textoDe(p3, 'main')), 'usuario desactivado: queda afuera al instante con un mensaje claro');
  await ctx3.close();

  // Fuera de fecha de venta RRPP
  await fijarReloj(pool, '2026-12-16 10:00:00-03');
  const ctx4 = await contexto({ serviceWorkers: 'block' });
  const p4 = await pagina(ctx4);
  await ingresar(p4, 'lucia', 'claveNueva1');
  await p4.waitForSelector('.lista');
  ok(/La venta de RRPP ya cerró/.test(await textoDe(p4, 'main')) && await p4.isDisabled('#nueva'), 'después del cierre: aviso y sin botón de venta');
  await revisar(p4, 'inicio venta cerrada');
  await ctx4.close();
} catch (err) {
  console.error(err);
  fallas++;
} finally {
  await navegador.close();
  srv.close();
  await base.detener();
}

if (fallas) { console.log(`\n${fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nUI fase 1: todo bien.');
