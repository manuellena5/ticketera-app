// Fase 5 · Los tres flujos encadenados, como el día real:
// RRPP vende → comprador abre con DNI y pasa una entrada → quien recibe la
// abre → la puerta escanea los QR que se ven en esos celulares → el admin
// cobra la rendición → el RRPP lo ve en su Inicio.
//   node tests/ui/flujo_completo.mjs
import { createRequire } from 'node:module';
import { servir } from '../servir.mjs';
import { levantarBase, instalarSupabase, fijarReloj } from '../backend_local.mjs';
import { MOVIL, contador, seguirErrores, revisor, lectorQR, pngDeCanvas, camaraFalsa } from './comun.mjs';
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
const lector = await lectorQR(nav);
const texto = (page, sel = 'body') => page.innerText(sel).then((t) => t.replace(/\s+/g, ' ').trim());

async function celular(extra = {}) {
  const ctx = await nav.newContext({ ...MOVIL, serviceWorkers: 'block', acceptDownloads: true, ...extra });
  await ctx.addInitScript(camaraFalsa());
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>WhatsApp</p>' }));
  await instalarSupabase(ctx, base.pool);
  return ctx;
}
async function ingresar(ctx, usuario, espera) {
  const p = seguirErrores(await ctx.newPage());
  await p.goto(BASE);
  await p.fill('input[name=usuario]', usuario);
  await p.fill('input[name=clave]', 'prueba1234');
  await p.click('button[type=submit]');
  await p.waitForSelector('#form-clave');
  await p.fill('input[name=clave]', 'claveNueva1');
  await p.fill('input[name=clave2]', 'claveNueva1');
  await p.click('button[type=submit]');
  await p.waitForSelector(espera);
  return p;
}

try {
  console.log('\n== 1. La RRPP vende 2 entradas en efectivo');
  const cRrpp = await celular();
  const rrpp = await ingresar(cRrpp, 'lucia', '.tanda-vigente');
  await rrpp.click('#nueva');
  await rrpp.fill('input[name=nombre]', 'Ana Pérez');
  await rrpp.fill('input[name=dni]', '30111456');
  await rrpp.fill('input[name=tel]', '3401 551234');
  await rrpp.click('#mas');
  await rrpp.click('#emitir');
  await rrpp.waitForSelector('#enviar');
  const msj = new URL(await rrpp.getAttribute('#enviar', 'href')).searchParams.get('text');
  const linkAna = msj.match(/https?:\/\/\S+entrada\.html#t=[A-Z2-7]{26}/)[0];
  ok(true, 'venta emitida y mensaje de WhatsApp armado');

  console.log('\n== 2. Ana abre su link, ve sus QR y le pasa una a Laura');
  const cAna = await celular();
  const ana = seguirErrores(await cAna.newPage());
  await ana.goto(linkAna);
  await ana.fill('input[name=dni]', '30111456');
  await ana.click('#ver');
  await ana.waitForSelector('[data-qr="2"] canvas');
  const qrAna = await lector.leerPNG(await pngDeCanvas(ana, '[data-qr="1"] canvas'));
  await ana.click('[data-pasar="2"]');
  await ana.fill('#para', 'Laura');
  const [wa] = await Promise.all([cAna.waitForEvent('page'), ana.click('#enviar')]);
  await wa.waitForURL(/wa\.me/);
  const linkLaura = new URL(wa.url()).searchParams.get('text').match(/https?:\/\/\S+entrada\.html#e=[A-Z2-7]{26}/)[0];
  await wa.close();
  await ana.waitForSelector('.entrada--cerrada');
  ok(/Pasada a Laura/.test(await texto(ana, 'main')), 'Ana la ve "Pasada a Laura"');

  console.log('\n== 3. Laura abre su link (sin DNI)');
  const cLaura = await celular();
  const laura = seguirErrores(await cLaura.newPage());
  await laura.goto(linkLaura);
  await laura.waitForSelector('canvas.qr');
  const qrLaura = await lector.leerPNG(await pngDeCanvas(laura, 'canvas.qr'));
  ok(/Tu entrada, Laura/.test(await texto(laura, 'main')) && qrLaura && qrLaura !== qrAna, 'Laura tiene su propio QR');

  console.log('\n== 4. El día del evento: la puerta escanea lo que muestran los celulares');
  await fijarReloj(base.pool, '2026-12-18 23:30:00-03');
  const cPuerta = await celular();
  const puerta = await ingresar(cPuerta, 'puerta1', '#descargar');
  await puerta.click('#descargar');
  await puerta.waitForSelector('#abrir');
  await puerta.click('#abrir');
  await puerta.waitForFunction(() => document.querySelector('#video').readyState >= 2);
  const escanear = async (cod) => {
    const antes = await texto(puerta, '#resultado');
    await puerta.evaluate((v) => { window.__qr = v; }, cod);
    await puerta.waitForFunction((a) => document.querySelector('#resultado').innerText.replace(/\s+/g, ' ').trim() !== a, antes);
    await puerta.evaluate(() => { window.__qr = null; });
    await puerta.waitForTimeout(150);
    return texto(puerta, '#resultado');
  };
  ok(/^VÁLIDA Ana Pérez · Entrada 1 de 2/.test(await escanear(qrAna)), 'entra Ana');
  ok(/^VÁLIDA Ana Pérez · Entrada 2 de 2 Anticipada · Pasada a Laura · Colocá la pulsera/.test(await escanear(qrLaura)), 'entra Laura (pasada por Ana)');
  await puerta.waitForTimeout(2600);
  ok(/^YA INGRESÓ A las \d\d:\d\d · Ana Pérez DNI terminado en 456/.test(await escanear(qrLaura)), 'una captura de pantalla del QR de Laura ya no entra');
  await revisar(puerta, 'escáner en el flujo completo');
  await ana.reload();
  await ana.waitForSelector('text=Ya ingresó');
  ok((await ana.$$('canvas.qr')).length === 0, 'Ana ve en su link que las dos ya ingresaron');

  console.log('\n== 5. El admin cobra la rendición y la RRPP lo ve');
  const cAdmin = await celular({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  const admin = await ingresar(cAdmin, 'admin', '.admin-kpis');
  ok(/Adentro 2/.test(await texto(admin, '.admin-kpis')), 'el tablero muestra 2 adentro');
  await admin.click('a[href="#rendicion"]');
  await admin.click('.tabla--rendicion tr:has-text("Lucía")');
  await admin.click('[data-registrar=entrega_efectivo]');
  await admin.waitForSelector('text=Comprobante N.º 1');
  ok(/Lucía Fernández Mitre 2 \$40\.000 \$40\.000 Al día/.test(await texto(admin, '.tabla--rendicion')), 'Lucía rindió los $40.000: al día');
  await rrpp.click('#inicio');
  await rrpp.waitForSelector('.tarjeta--ancha >> text=Ya rendiste $40.000');
  ok(/Efectivo a rendir \$0/.test(await texto(rrpp, '.tarjeta--ancha')) && /Ingresaron/.test(await texto(rrpp, '.lista')), 'la RRPP ve $0 a rendir y que sus clientes ingresaron');
} catch (err) {
  console.error(err);
  c.fallas++;
} finally {
  await lector.cerrar();
  await nav.close();
  srv.close();
  await base.detener();
}
if (c.fallas) { console.log(`\n${c.fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nFlujo completo: todo bien.');
