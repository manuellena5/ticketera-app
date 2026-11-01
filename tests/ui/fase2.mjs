// Fase 2 · Link del comprador de punta a punta.
//   node tests/ui/fase2.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { servir } from '../servir.mjs';
import { levantarBase, instalarSupabase, fijarReloj, comoUsuario } from '../backend_local.mjs';
import { MOVIL, contador, seguirErrores, revisor, lectorQR, pngDeCanvas } from './comun.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const c = contador();
const ok = c.ok;
const revisar = revisor(ok);
const LUCIA = '00000000-0000-4000-8000-000000000011';

const base = await levantarBase({ ahora: '2026-11-10 12:00:00-03' });
const { pool } = base;
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const srv = await servir(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const navegador = await chromium.launch();
const lector = await lectorQR(navegador);
const texto = (page, sel = 'body') => page.innerText(sel).then((t) => t.replace(/\s+/g, ' ').trim());

async function contexto(opciones = {}) {
  const ctx = await navegador.newContext({ ...MOVIL, serviceWorkers: 'block', acceptDownloads: true, ...opciones });
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>WhatsApp</p>' }));
  ctx.registro = await instalarSupabase(ctx, pool);
  return ctx;
}
async function pagina(ctx) { return seguirErrores(await ctx.newPage()); }

async function emitir(nombre, dni, cantidad) {
  const [r] = await comoUsuario(pool, LUCIA,
    `select public.emitir_venta(gen_random_uuid(), $1, $2, null, $3, 'efectivo') as r`, [nombre, dni, cantidad]);
  return r.r;
}
// Pone el DNI y espera la respuesta del servidor (si no, se podría leer el
// cartel del intento anterior, que sigue en pantalla mientras tanto).
async function ponerDni(page, dni) {
  await page.waitForSelector('#form-dni');
  await page.fill('input[name=dni]', dni);
  const sinRed = await page.evaluate(() => !navigator.onLine);
  if (sinRed || !/^\d{7,8}$/.test(dni.replace(/\D/g, ''))) return page.click('#ver');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/ver_entradas'), { timeout: 10000 }).catch(() => {}),
    page.click('#ver'),
  ]);
  await page.waitForFunction(() => !document.querySelector('#ver') || !document.querySelector('#ver').disabled, null, { timeout: 10000 }).catch(() => {});
}

try {
  const v1 = await emitir('Ana Pérez', '30111222', 2);
  const codigos = (await q('select nro, codigo from entradas where venta_id = $1 order by nro', [v1.venta.ref])).map((x) => x.codigo);
  const linkAna = BASE + 'entrada.html#t=' + v1.token;

  // ===================================================================
  console.log('\n== Abrir con DNI');
  const ctx = await contexto();
  const page = await pagina(ctx);
  await page.goto(linkAna);
  await page.waitForSelector('#form-dni');
  await page.waitForSelector('.hero__titulo >> text=Simón Aguirre');
  ok(/CLUB DEPORTIVO MITRE PRESENTA/.test(await texto(page, 'header')) && /Viernes 18 de diciembre · 23:59 hs/.test(await texto(page, 'header')),
     'encabezado: "Club Deportivo Mitre presenta", artista, fecha y hora');
  ok(/Ingresá tu DNI para verlas/.test(await texto(page, 'main')), 'pide el DNI antes de mostrar nada');
  ok(!/Ana|Pérez|30111222/.test(await texto(page)), 'antes del DNI no aparece ningún dato del titular');
  await revisar(page, 'ingresar DNI');
  ok(await page.getAttribute('input[name=dni]', 'inputmode') === 'numeric', 'teclado numérico para el DNI');

  for (let i = 1; i <= 4; i++) {
    await ponerDni(page, '1111111' + i);
    await page.waitForSelector('#error');
  }
  ok(await texto(page, '#error') === 'No pudimos abrir tus entradas. Revisá el DNI e intentá de nuevo.' && (await page.$$('canvas.qr')).length === 0,
     'con DNI incorrecto no muestra nada');
  await revisar(page, 'DNI incorrecto');
  await ponerDni(page, '11111115');
  await page.waitForSelector('#error');
  ok(await texto(page, '#error') === 'Hiciste muchos intentos. Esperá 15 minutos y probá de nuevo.', 'al quinto intento se bloquea');
  await ponerDni(page, '30111222');
  await page.waitForSelector('#error');
  ok(/muchos intentos/.test(await texto(page, '#error')), 'bloqueado: ni con el DNI correcto');
  await fijarReloj(pool, '2026-11-10 12:16:00-03');
  await ponerDni(page, '30.111.222');
  await page.waitForSelector('canvas.qr');
  ok(true, 'pasados los 15 minutos, con el DNI correcto abre');

  // ===================================================================
  console.log('\n== Mis entradas');
  ok(/Ana Pérez/.test(await texto(page, 'header')) && /2 entradas · Anticipada/.test(await texto(page, 'header')), 'encabezado con titular, cantidad y tanda');
  ok((await page.$$('canvas.qr')).length === 2, 'un QR por entrada');
  ok(/Entrada 1 de 2 Válida/.test(await texto(page, 'main')) && /Entrada 2 de 2 Válida/.test(await texto(page, 'main')), '"Entrada 1 de 2" con estado');
  ok(/El QR es único y se habilita el día del evento/.test(await texto(page, 'main')), 'consejo de guardar la imagen');
  await revisar(page, 'mis entradas');
  ok(await lector.leerPNG(await pngDeCanvas(page, '[data-qr="1"] canvas')) === codigos[0], 'el QR en pantalla se lee y es el código de la entrada 1');
  ok(await lector.leerPNG(await pngDeCanvas(page, '[data-qr="2"] canvas')) === codigos[1], 'el QR de la entrada 2 también');

  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('[data-guardar="1"]')]);
  const png = readFileSync(await descarga.path());
  ok(descarga.suggestedFilename() === 'entrada-simon-aguirre-1.png', 'Guardar imagen descarga un PNG');
  ok(png.subarray(1, 4).toString() === 'PNG' && await lector.leerPNG(png) === codigos[0], 'la imagen guardada se escanea bien');

  await page.reload();
  await page.waitForSelector('canvas.qr');
  ok(true, 'al recargar en la misma pestaña no vuelve a pedir el DNI');

  // ===================================================================
  console.log('\n== Pasar a otra persona');
  await page.click('[data-pasar="2"]');
  await page.waitForSelector('#para');
  ok(/Pasar la entrada 2/.test(await texto(page, 'main')) && /Tu link sigue siendo tuyo/.test(await texto(page, 'main')), 'pantalla "Pasar la entrada 2"');
  await page.fill('#para', 'Laura');
  ok(/^¡Hola Laura! Ana te pasó una entrada para \*Simón Aguirre\*, viernes 18\/12 a las 23:59 hs\./.test(await texto(page, '#vista')), 'vista previa del mensaje');
  await revisar(page, 'pasar entrada');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#enviar')]);
  await popup.waitForURL(/wa\.me/);
  const msg = new URL(popup.url()).searchParams.get('text');
  await popup.close();
  const linkLaura = (msg.match(/https?:\/\/\S+entrada\.html#e=[A-Z2-7]{26}/) || [])[0];
  ok(!!linkLaura && new URL(popup.url()).pathname === '/', 'abre WhatsApp con un link solo de esa entrada (#e=)');
  await page.waitForSelector('.entrada--cerrada');
  ok(/Entrada 2 de 2 Pasada a Laura Ver QR/.test(await texto(page, '.entrada--cerrada')), 'el titular la ve "Pasada a Laura"');
  ok((await q('select pasada_a from entradas where venta_id = $1 and nro = 2', [v1.venta.ref]))[0].pasada_a === 'Laura', 'queda registrada en la base');

  // Quien recibe (otro celular)
  const ctxL = await contexto();
  const pL = await pagina(ctxL);
  await pL.goto(linkLaura);
  await pL.waitForSelector('canvas.qr');
  ok(/Tu entrada, Laura/.test(await texto(pL, 'main')) && /Te la pasó Ana · Anticipada/.test(await texto(pL, 'main')), 'Laura ve "Tu entrada, Laura" sin pedir DNI');
  ok(!/Pérez|30111222|Entrada 1/.test(await texto(pL)), 'Laura no ve nada más de Ana');
  ok(await lector.leerPNG(await pngDeCanvas(pL, 'canvas.qr')) === codigos[1], 'su QR es el de la entrada 2');
  await revisar(pL, 'entrada pasada');
  const [d2] = await Promise.all([pL.waitForEvent('download'), pL.click('#guardar')]);
  ok(await lector.leerPNG(readFileSync(await d2.path())) === codigos[1], 'Laura también puede guardar la imagen y se escanea');

  // Volver a pasarla: el link anterior deja de andar
  await page.click('[data-ver="2"]');
  await page.waitForSelector('[data-pasar="2"]');
  ok(/Volver a pasar/.test(await texto(page, '[data-pasar="2"]')), '"Ver QR" la muestra con "Volver a pasar"');
  await page.click('[data-pasar="2"]');
  await page.fill('#para', 'Laura G');
  const [popup2] = await Promise.all([ctx.waitForEvent('page'), page.click('#enviar')]);
  await popup2.waitForURL(/wa\.me/);
  await popup2.close();
  await page.waitForSelector('.entrada--cerrada');
  await pL.reload();
  await pL.waitForSelector('.aviso');
  ok(await texto(pL, '.aviso') === 'Este link ya no funciona. Pedile a quien te pasó la entrada que te la vuelva a mandar.', 'al volver a pasarla, el link anterior deja de andar');
  await revisar(pL, 'link pasado inválido');
  await ctxL.close();

  // ===================================================================
  console.log('\n== Link rotado, estados y sin conexión');
  const [rot] = await comoUsuario(pool, LUCIA, 'select public.reenviar_link($1) as r', [v1.venta.ref]);
  const ctx2 = await contexto();
  const p2 = await pagina(ctx2);
  await p2.goto(linkAna);
  await ponerDni(p2, '30111222');
  await p2.waitForSelector('#error');
  ok(/No pudimos abrir/.test(await texto(p2, '#error')), 'el link viejo (rotado por el RRPP) deja de funcionar');
  await p2.goto(BASE + 'entrada.html#t=' + rot.r.token);
  await p2.reload();
  await ponerDni(p2, '30111222');
  await p2.waitForSelector('canvas.qr');
  ok(true, 'el link nuevo funciona');

  await q(`update entradas set ingreso_en = '2026-12-18 23:14:00-03' where venta_id = $1 and nro = 1`, [v1.venta.ref]);
  await p2.reload();
  await p2.waitForSelector('text=Ya ingresó a las 23:14.');
  ok((await p2.$$('canvas.qr')).length === 0 || !(await p2.$('[data-qr="1"]')), 'entrada usada: "Ya ingresó a las 23:14." sin QR');
  await revisar(p2, 'entrada ya ingresó');

  await q(`update ventas set estado = 'anulada' where id = $1; `, [v1.venta.ref]);
  await q(`update entradas set estado = 'anulada' where venta_id = $1`, [v1.venta.ref]);
  await p2.reload();
  await p2.waitForSelector('.aviso--error');
  ok(/Esta entrada fue anulada\. Consultá con quien te la vendió\./.test(await texto(p2, 'main')) && (await p2.$$('canvas.qr')).length === 0,
     'venta anulada: aviso y sin QR');
  await revisar(p2, 'entrada anulada');

  const v2 = await emitir('Juan Díaz', '31222333', 1);
  await p2.goto(BASE + 'entrada.html#t=' + v2.token);
  await p2.reload();
  await p2.waitForSelector('#form-dni');
  await ctx2.setOffline(true);
  await ponerDni(p2, '31222333');
  await p2.waitForSelector('#error');
  ok(/Sin conexión\. Para ver tus entradas necesitás internet/.test(await texto(p2, '#error')), 'sin conexión: mensaje claro');
  await ctx2.setOffline(false);
  await p2.goto(BASE + 'entrada.html#t=ABC');
  await p2.reload();
  await p2.waitForSelector('.aviso');
  ok(/no está completo/.test(await texto(p2, '.aviso')), 'link incompleto: aviso claro');
  await ctx2.close();

  // La página pública nunca usa una sesión de RRPP aunque exista en el celular
  const ctx3 = await contexto();
  const p3 = await pagina(ctx3);
  await p3.goto(BASE);
  await p3.waitForSelector('#form-ingreso');
  await p3.fill('input[name=usuario]', 'lucia');
  await p3.fill('input[name=clave]', 'prueba1234');
  await p3.click('button[type=submit]');
  await p3.waitForSelector('#form-clave, .tanda-vigente');
  const antes = ctx3.registro.rpc.length;
  await p3.goto(BASE + 'entrada.html#t=' + v2.token);
  await ponerDni(p3, '31222333');
  await p3.waitForSelector('canvas.qr');
  const llamadas = ctx3.registro.rpc.slice(antes);
  ok(llamadas.length > 0 && llamadas.every((l) => l.usuario === null), 'la página del comprador llama sin sesión aunque el celular tenga una');
  await ctx3.close();

  await ctx.close();
} catch (err) {
  console.error(err);
  c.fallas++;
} finally {
  await lector.cerrar();
  await navegador.close();
  srv.close();
  await base.detener();
}

if (c.fallas) { console.log(`\n${c.fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nUI fase 2: todo bien.');
