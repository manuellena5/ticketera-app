// Fase 3 · Puerta y caja de punta a punta.
// La cámara se simula con un canvas que dibuja el QR que pide el test: así
// se prueba la lectura real (video → canvas → jsQR) y el tiempo de escaneo.
//   node tests/ui/fase3.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { servir } from '../servir.mjs';
import { levantarBase, instalarSupabase, fijarReloj, comoUsuario } from '../backend_local.mjs';
import { MOVIL, contador, seguirErrores, revisor } from './comun.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const c = contador();
const ok = c.ok;
const revisar = revisor(ok);
const LUCIA = '00000000-0000-4000-8000-000000000011';

const CAMARA_FALSA = '(() => {\n' + readFileSync(new URL('../../vendor/qrcode/qrcode.js', import.meta.url), 'utf8') + `
  window.__qr = null;
  navigator.mediaDevices.getUserMedia = async () => {
    const cv = document.createElement('canvas');
    cv.width = 640; cv.height = 480;
    const g = cv.getContext('2d');
    const dibujar = () => {
      g.fillStyle = '#6B7280'; g.fillRect(0, 0, 640, 480);
      if (!window.__qr) return;
      const q = qrcode(0, 'M');
      q.addData(window.__qr, /^[0-9A-Z $%*+\\-./:]+$/.test(window.__qr) ? 'Alphanumeric' : 'Byte');
      q.make();
      const n = q.getModuleCount(), celda = Math.floor(380 / (n + 8)), lado = celda * (n + 8);
      const x0 = (640 - lado) / 2, y0 = (480 - lado) / 2;
      g.fillStyle = '#fff'; g.fillRect(x0, y0, lado, lado);
      g.fillStyle = '#000';
      for (let f = 0; f < n; f++) for (let k = 0; k < n; k++) if (q.isDark(f, k)) g.fillRect(x0 + (k + 4) * celda, y0 + (f + 4) * celda, celda, celda);
    };
    setInterval(dibujar, 40); dibujar();
    return cv.captureStream(25);
  };
})();`;

const base = await levantarBase({ ahora: '2026-11-10 12:00:00-03' });
const { pool } = base;
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const srv = await servir(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const navegador = await chromium.launch();
const texto = (page, sel = 'body') => page.innerText(sel).then((t) => t.replace(/\s+/g, ' ').trim());
const esperar = async (fn, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };

async function contexto(opciones = {}) {
  const ctx = await navegador.newContext({ ...MOVIL, serviceWorkers: 'block', ...opciones });
  await ctx.addInitScript(CAMARA_FALSA);
  ctx.registro = await instalarSupabase(ctx, pool);
  return ctx;
}
async function ingresar(ctx, usuario, clave = 'prueba1234', nueva = 'claveNueva1') {
  const page = seguirErrores(await ctx.newPage());
  await page.goto(BASE);
  await page.waitForSelector('#form-ingreso');
  await page.fill('input[name=usuario]', usuario);
  await page.fill('input[name=clave]', clave);
  await page.click('button[type=submit]');
  await page.waitForSelector('#form-clave, .cabecera-puerta');
  if (await page.$('#form-clave')) {
    await page.fill('input[name=clave]', nueva);
    await page.fill('input[name=clave2]', nueva);
    await page.click('button[type=submit]');
    await page.waitForSelector('.cabecera-puerta');
  }
  return page;
}
async function escanear(page, codigo) {
  await page.evaluate(() => { document.querySelector('#resultado').dataset.n = 'x'; });
  const antes = await texto(page, '#resultado');
  const t0 = Date.now();
  await page.evaluate((v) => { window.__qr = v; }, codigo);
  await page.waitForFunction((a) => {
    const r = document.querySelector('#resultado');
    return r && r.innerText.replace(/\s+/g, ' ').trim() !== a;
  }, antes, { timeout: 5000 });
  const ms = Date.now() - t0;
  await page.evaluate(() => { window.__qr = null; });
  await page.waitForTimeout(120);
  return { ms, titulo: await texto(page, '.resultado__titulo'), l1: await texto(page, '.resultado__l1'), l2: await texto(page, '.resultado__l2'),
           clase: await page.getAttribute('#resultado', 'class') };
}

try {
  // Ventas de RRPP antes del cierre
  const ventas = [];
  for (const [n, d, cant] of [['Ana Pérez', '30111456', 2], ['Juan Díaz', '31222333', 1], ['Carla Ruiz', '32333444', 3], ['Pedro Gómez', '33444555', 1]]) {
    const [r] = await comoUsuario(pool, LUCIA, `select public.emitir_venta(gen_random_uuid(), $1, $2, null, $3, 'efectivo') as r`, [n, d, cant]);
    ventas.push(r.r);
  }
  const cod = async (i, nro) => (await q('select codigo from entradas where venta_id = $1 and nro = $2', [ventas[i].venta.ref, nro]))[0].codigo;
  await fijarReloj(pool, '2026-12-18 23:00:00-03');

  // ===================================================================
  console.log('\n== Preparar puerta');
  const ctxA = await contexto();
  const pA = await ingresar(ctxA, 'puerta1');
  ok(/Descargá la lista/.test(await texto(pA, 'main')), 'sin lista: pide descargarla');
  ok(/Adentro 0 \/ 1\.000/.test(await texto(pA, 'header')), 'contador "Adentro: 0 / 1.000"');
  await revisar(pA, 'preparar sin lista');
  await pA.click('#descargar');
  await pA.waitForSelector('#estado-lista');
  ok(/^Lista lista · 7 entradas · \d\d:\d\d$/.test(await texto(pA, '#estado-lista')), '"Lista lista · 7 entradas · HH:MM"');
  ok(/Sincronizado \d\d:\d\d/.test(await texto(pA, '#sync')), 'muestra cuándo se sincronizó por última vez');
  await revisar(pA, 'preparar con lista');

  // ===================================================================
  console.log('\n== Escáner');
  await pA.click('#abrir');
  await pA.waitForSelector('#video');
  await pA.waitForFunction(() => document.querySelector('#video').readyState >= 2);
  await revisar(pA, 'escáner');
  const c1 = await cod(0, 2);
  let r = await escanear(pA, c1);
  ok(r.titulo === 'VÁLIDA' && r.l1 === 'Ana Pérez · Entrada 2 de 2' && r.l2 === 'Anticipada · Colocá la pulsera' && /resultado--ok/.test(r.clase),
     'QR válido: verde "VÁLIDA", nombre, "Entrada 2 de 2", tanda y "Colocá la pulsera"');
  ok(r.ms < 1000, `escanea en menos de 1 segundo (${r.ms} ms)`);
  ok(await esperar(async () => (await q('select ingreso_en from entradas where codigo = $1', [c1]))[0].ingreso_en !== null), 'con señal, el ingreso sube a la nube');
  await revisar(pA, 'escáner válida');
  r = await escanear(pA, c1);
  ok(r.titulo === 'YA INGRESÓ' && /^A las \d\d:\d\d · Ana Pérez$/.test(r.l1) && r.l2 === 'DNI terminado en 456 · Entrada 2 de 2' && /resultado--ya/.test(r.clase),
     'QR repetido: ámbar "YA INGRESÓ" con hora, nombre y últimos 3 del DNI');
  r = await escanear(pA, 'AAAAAAAAAAAAAAAAAAAAAAAAAA');
  ok(r.titulo === 'NO VÁLIDA' && r.l1 === 'Esta entrada no existe' && /resultado--no/.test(r.clase), 'QR inventado: rojo "NO VÁLIDA"');
  r = await escanear(pA, 'https://otra-cosa.com/promo');
  ok(r.titulo === 'NO VÁLIDA' && r.l1 === 'Este QR no es una entrada', 'QR de otra cosa: "Este QR no es una entrada"');
  await q(`update ventas set estado = 'anulada' where id = $1`, [ventas[3].venta.ref]);
  await pA.goBack();
  await pA.click('#sincronizar');
  await pA.waitForSelector('#aviso-toast:not([hidden])');
  await pA.click('#abrir');
  await pA.waitForFunction(() => document.querySelector('#video').readyState >= 2);
  r = await escanear(pA, await cod(3, 1));
  ok(r.titulo === 'ANULADA' && /Pedro Gómez/.test(r.l2), 'venta anulada (llegó por sincronización): "ANULADA"');
  ok(/Adentro 1 \/ 1\.000/.test(await texto(pA, 'header')), 'el contador muestra 1 adentro');

  // ===================================================================
  console.log('\n== Sin conexión y dos celulares');
  const ctxB = await contexto();
  const pB = await ingresar(ctxB, 'puerta2');
  await pB.click('#descargar');
  await pB.waitForSelector('#estado-lista');
  await pB.click('#abrir');
  await pB.waitForFunction(() => document.querySelector('#video').readyState >= 2);
  await ctxA.setOffline(true);
  await ctxB.setOffline(true);
  const cC = await cod(2, 1);
  r = await escanear(pA, cC);
  ok(r.titulo === 'VÁLIDA', 'sin señal el celular 1 valida con la lista guardada');
  ok(/Sin conexión desde \d\d:\d\d · lista de las \d\d:\d\d · 1 sin subir/.test(await texto(pA, '#sync')), '"Sin conexión desde HH:MM", hora de la lista y "1 sin subir"');
  await revisar(pA, 'escáner sin conexión');
  await pA.waitForTimeout(1200);
  r = await escanear(pB, cC);
  ok(r.titulo === 'VÁLIDA', 'el celular 2, también sin señal, no se entera (riesgo conocido)');
  await ctxB.setOffline(false);   // el 2 sube primero (pasó después)
  ok(await esperar(async () => /^puerta2-/.test((await q('select ingreso_dispositivo from entradas where codigo = $1', [cC]))[0].ingreso_dispositivo || ''), 15000),
     'vuelve la señal en el celular 2: sube su ingreso');
  await ctxA.setOffline(false);
  ok(await esperar(async () => /^puerta1-/.test((await q('select ingreso_dispositivo from entradas where codigo = $1', [cC]))[0].ingreso_dispositivo || ''), 15000),
     'después de sincronizar los dos, gana el primer ingreso (celular 1)');
  ok((await q(`select count(*)::int n from auditoria where accion = 'intento_duplicado'`))[0].n >= 1, 'el otro queda en auditoría como intento duplicado');
  const horaA = (await q('select ingreso_en from entradas where codigo = $1', [cC]))[0].ingreso_en;
  await pB.goBack();
  await pB.click('#sincronizar');
  await pB.waitForSelector('#aviso-toast:not([hidden])');
  await pB.click('#abrir');
  await pB.waitForFunction(() => document.querySelector('#video').readyState >= 2);
  r = await escanear(pB, cC);
  const hhmm = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(horaA);
  ok(r.titulo === 'YA INGRESÓ' && r.l1.startsWith('A las ' + hhmm), 'el celular 2 se entera: "Ya ingresó" con la hora del celular 1');
  await ctxB.close();

  // ===================================================================
  console.log('\n== Buscar por DNI o apellido');
  await pA.click('#buscar');
  await pA.waitForSelector('#q');
  await revisar(pA, 'buscar');
  await pA.fill('#q', '31.222.333');
  await pA.waitForSelector('[data-marcar]');
  ok(/Juan Díaz Entrada 1 de 1 · Anticipada DNI terminado en 333/.test(await texto(pA, '#resultados')), 'buscar por DNI completo (sin conexión, con hash)');
  await pA.fill('#q', 'ruiz');
  await pA.waitForSelector('.fila-busqueda');
  ok((await pA.$$('.fila-busqueda')).length === 3, 'buscar por apellido: las 3 entradas de Carla Ruiz');
  await pA.fill('#q', 'diaz');
  await pA.waitForSelector('[data-marcar]');
  await revisar(pA, 'buscar con resultados');
  await pA.click('[data-marcar]');
  await pA.waitForSelector('[data-deshacer]');
  const cJ = await cod(1, 1);
  ok(await esperar(async () => (await q('select ingreso_en from entradas where codigo = $1', [cJ]))[0].ingreso_en !== null), 'marcar ingreso desde la búsqueda');
  await pA.click('[data-deshacer]');
  await pA.waitForSelector('dialog[open]');
  await pA.click('dialog button[value=si]');
  await pA.waitForSelector('[data-marcar]');
  ok(await esperar(async () => (await q('select ingreso_en from entradas where codigo = $1', [cJ]))[0].ingreso_en === null), 'deshacer el ingreso lo puede hacer quien maneja la puerta');
  ok((await q(`select count(*)::int n from auditoria where accion = 'deshacer_ingreso'`))[0].n === 1, 'y queda en auditoría');
  await pA.goBack();   // al escáner
  await pA.waitForSelector('#video');
  await pA.goBack();   // a preparar
  await pA.waitForSelector('#estado-lista');

  // Salir con ingresos sin subir pide confirmación
  await ctxA.setOffline(true);
  await pA.click('#buscar');
  await pA.fill('#q', 'diaz');
  await pA.waitForSelector('[data-marcar]');
  await pA.click('[data-marcar]');
  await pA.goBack();
  await pA.click('#salir');
  await pA.waitForSelector('dialog[open]');
  ok(/sin subir/.test(await texto(pA, 'dialog')), 'salir con ingresos sin subir: avisa que se pierden');
  await pA.click('dialog button[value=no]');
  await ctxA.setOffline(false);
  await ctxA.close();

  // ===================================================================
  console.log('\n== Modo avión: abrir la app sin señal');
  const ctxS = await contexto({ serviceWorkers: 'allow' });
  const pS = await ingresar(ctxS, 'puerta2', 'claveNueva1');
  await pS.click('#descargar');
  await pS.waitForSelector('#estado-lista');
  await pS.evaluate(() => navigator.serviceWorker.ready);
  await pS.reload();
  await pS.waitForSelector('#estado-lista');
  await ctxS.setOffline(true);
  await pS.reload();
  await pS.waitForSelector('#estado-lista');
  ok(/Lista lista · 7 entradas/.test(await texto(pS, '#estado-lista')) && /Sin conexión desde/.test(await texto(pS, '#sync')), 'en modo avión abre con la lista guardada');
  await pS.click('#abrir');
  await pS.waitForFunction(() => document.querySelector('#video').readyState >= 2);
  r = await escanear(pS, await cod(2, 3));
  ok(r.titulo === 'VÁLIDA', 'y escanea en modo avión');
  await ctxS.setOffline(false);
  await ctxS.close();

  // ===================================================================
  console.log('\n== Venta en puerta (caja)');
  const ctxC = await contexto();
  const pC = await ingresar(ctxC, 'caja');
  await pC.waitForSelector('#cobrar');
  await pC.waitForSelector('text=Puerta · $25.000 cada una');
  ok(true, 'caja: "Puerta · $25.000 cada una"');
  ok(/Sincronizado \d\d:\d\d/.test(await texto(pC, '#sync')), 'la caja también muestra la última sincronización');
  await revisar(pC, 'venta en puerta');
  const adentro0 = Number((await texto(pC, '#adentro')).split(' ')[0].replace(/\./g, ''));
  await pC.click('#mas');
  ok(await texto(pC, '#total') === '$50.000' && await texto(pC, '#cobrar') === 'Cobrar y dar 2 pulseras', 'total y "Cobrar y dar 2 pulseras"');
  await pC.evaluate(() => { const b = document.getElementById('cobrar'); b.click(); b.click(); });
  await pC.waitForSelector('.pulseras');
  ok(await texto(pC, '.pulseras__titulo') === 'Entregá 2 pulseras', '"Entregá 2 pulseras"');
  await revisar(pC, 'entregá pulseras');
  ok((await q(`select count(*)::int n from ventas where canal = 'caja'`))[0].n === 1, 'el doble toque no duplica la venta');
  ok((await q(`select count(*)::int n from entradas e join ventas v on v.id = e.venta_id where v.canal = 'caja' and e.ingreso_en is not null`))[0].n === 2, 'las 2 entradas quedan ingresadas (pulsera)');
  await pC.click('#listo');
  await pC.waitForSelector('#caja-pulseras');
  ok(await texto(pC, '#caja-pulseras') === '2' && await texto(pC, '#caja-efectivo') === '$50.000', 'caja de puerta: 2 pulseras, $50.000 en efectivo');
  ok(Number((await texto(pC, '#adentro')).split(' ')[0].replace(/\./g, '')) === adentro0 + 2, 'la venta en puerta suma al contador de adentro');
  await pC.click('[data-medio=transferencia]');
  await pC.waitForSelector('.datos-club');
  ok(/Alias CLUB\.MITRE\.PRUEBA/.test(await texto(pC, '.datos-club')), 'transferencia: muestra los datos del club en grande');
  await revisar(pC, 'venta en puerta transferencia');
  await pC.click('#cobrar');
  await pC.waitForSelector('.pulseras');
  await pC.click('#listo');
  await pC.waitForSelector('#caja-transf');
  ok(await texto(pC, '#caja-transf') === '$25.000', 'transferencias aparte');

  // Tope con conexión
  await q(`update eventos set tope_entradas = privado.emitidas_evento(id) + 1`);
  await pC.click('[data-medio=efectivo]');
  await pC.click('#mas');
  await pC.click('#cobrar');
  await pC.waitForSelector('#error');
  ok(await texto(pC, '#error') === 'Queda 1 lugar en el evento.', 'con conexión frena en el tope: "Queda 1 lugar en el evento."');
  await revisar(pC, 'caja tope');

  // Sin conexión: guarda, avisa cerca del tope y al subir acepta con aviso
  await ctxC.setOffline(true);
  await pC.click('#cobrar');
  await pC.waitForSelector('.pulseras');
  ok(/Venta guardada en el celular/.test(await texto(pC, '.pulseras')), 'sin conexión: vende igual y la guarda en el celular');
  await pC.click('#listo');
  await pC.waitForSelector('#caja-pulseras');
  ok(/1 venta pendiente de subir/.test(await texto(pC, 'main')), '"1 venta pendiente de subir"');
  ok(/Se llegó al tope de/.test(await texto(pC, 'main')), 'avisa que el contador local llegó al tope');
  ok(/Sin conexión desde \d\d:\d\d · 1 sin subir/.test(await texto(pC, '#sync')), 'muestra desde cuándo no sincroniza');
  await revisar(pC, 'caja sin conexión');
  await ctxC.setOffline(false);
  await pC.waitForSelector('text=por encima del tope', { timeout: 15000 });
  ok(/Se vendieron 1 entrada por encima del tope mientras no había conexión\./.test(await texto(pC, 'main')), 'al volver la señal se acepta y avisa que pasó el tope');
  ok((await q(`select count(*)::int n from auditoria where accion = 'venta_puerta_sobre_tope'`))[0].n === 1, 'queda en auditoría para el admin');
  ok(!/pendiente de subir/.test(await texto(pC, 'main')), 'ya no quedan ventas pendientes');
  await ctxC.close();
} catch (err) {
  console.error(err);
  c.fallas++;
} finally {
  await navegador.close();
  srv.close();
  await base.detener();
}

if (c.fallas) { console.log(`\n${c.fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nUI fase 3: todo bien.');
