// Fase 4 · Panel de administración de punta a punta.
//   node tests/ui/fase4.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { servir } from '../servir.mjs';
import { levantarBase, instalarSupabase, comoUsuario } from '../backend_local.mjs';
import { MOVIL, contador, seguirErrores, revisor } from './comun.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const c = contador();
const ok = c.ok;
const revisar = revisor(ok);
const LUCIA = '00000000-0000-4000-8000-000000000011';
const MARTIN = '00000000-0000-4000-8000-000000000012';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const ESCRITORIO = { viewport: { width: 1280, height: 900 }, locale: 'es-AR' };

const base = await levantarBase({ ahora: '2026-11-10 12:00:00-03' });
const { pool } = base;
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const srv = await servir(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const navegador = await chromium.launch();
const esperar = async (fn, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const texto = (page, sel = 'body') => page.innerText(sel).then((t) => t.replace(/\s+/g, ' ').trim());

async function contexto(opciones = {}) {
  const ctx = await navegador.newContext({ ...ESCRITORIO, serviceWorkers: 'block', acceptDownloads: true, ...opciones });
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>WhatsApp</p>' }));
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
  await page.waitForSelector('#form-clave, .admin-cabecera, .tanda-vigente');
  if (await page.$('#form-clave')) {
    await page.fill('input[name=clave]', nueva);
    await page.fill('input[name=clave2]', nueva);
    await page.click('button[type=submit]');
  }
  return page;
}
async function vender(usuario, nombre, dni, cant, medio) {
  const [r] = await comoUsuario(pool, usuario, `select public.emitir_venta(gen_random_uuid(), $1, $2, '5493401551234', $3, $4) as r`, [nombre, dni, cant, medio]);
  return r.r;
}
async function ir(page, seccion, espera) {
  await page.click('.admin-nav a[href="#' + seccion + '"]');
  // El marco se redibuja entero al cambiar de sección: primero se espera el menú
  // marcado (ya no queda nada de la pantalla anterior) y después el contenido.
  await page.waitForSelector('.admin-nav a[href="#' + seccion + '"][aria-current="page"]');
  await page.waitForSelector(espera + ':not(:has-text("Cargando…"))');
  await page.waitForFunction(() => !/Cargando…/.test(document.querySelector('main').innerText));
}
async function descargarCSV(page, accion) {
  const [d] = await Promise.all([page.waitForEvent('download'), accion()]);
  return { nombre: d.suggestedFilename(), texto: readFileSync(await d.path(), 'utf8') };
}
function leerCSV(t) {
  // parser simple con comillas
  const filas = []; let fila = [], celda = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) { if (ch === '"' && t[i + 1] === '"') { celda += '"'; i++; } else if (ch === '"') comillas = false; else celda += ch; }
    else if (ch === '"') comillas = true;
    else if (ch === ';') { fila.push(celda); celda = ''; }
    else if (ch === '\n') { fila.push(celda.replace(/\r$/, '')); filas.push(fila); fila = []; celda = ''; }
    else celda += ch;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

try {
  // Set de prueba
  await vender(LUCIA, 'Ana Pérez', '30111222', 2, 'efectivo');
  await vender(LUCIA, 'Juan Díaz', '31222333', 1, 'transferencia');
  await vender(MARTIN, 'Carla Ruiz', '32333444', 2, 'efectivo');
  await comoUsuario(pool, ADMIN, `select public.ajustar_rrpp($1, 1000, 'sin_limite', null)`, [LUCIA]);
  await vender(LUCIA, 'Laura Sosa', '34555666', 1, 'efectivo');

  // ===================================================================
  console.log('\n== Tablero');
  const ctx = await contexto();
  const page = await ingresar(ctx, 'admin');
  await page.waitForSelector('.admin-kpis');
  ok(/Entradas emitidas 6 \/ 1\.000/.test(await texto(page, '.admin-kpis')), 'emitidas / tope: 6 / 1.000');
  ok(/Vendido \$120\.000 Efectivo \$100\.000 · Transferencias \$20\.000/.test(await texto(page, '.admin-kpis')), 'vendido, con efectivo y transferencias');
  ok(/Efectivo por rendir \$100\.000 Comisiones a pagar: \$3\.250/.test(await texto(page, '.admin-kpis')), 'efectivo por rendir y comisiones a pagar');
  ok(/Transferencias sin confirmar \$20\.000 1 venta/.test(await texto(page, '.admin-kpis')), 'transferencias sin confirmar');
  ok(/Anticipada · \$20\.000 6 de 500/.test(await texto(page, 'main')), 'por tanda');
  ok(/Lucía Fernández Mitre 4 \$60\.000/.test(await texto(page, 'main')), 'por RRPP');
  await revisar(page, 'tablero');

  // ===================================================================
  console.log('\n== Rendición');
  await ir(page, 'rendicion', '.tabla--rendicion');
  const filaLucia = await texto(page, '.tabla--rendicion tr:has-text("Lucía")');
  ok(filaLucia === 'Lucía Fernández Mitre 4 $60.000 $0 $60.000 $3.250 $0 $3.250', 'Lucía: comisión cambiada a mitad de la venta (3 × $750 + 1 × $1.000)');
  ok(/Martín Gómez .*\$40\.000 \$0 \$40\.000 Ad honorem/.test(await texto(page, '.tabla--rendicion')), 'Martín: ad honorem');
  await revisar(page, 'rendición');
  await page.click('.tabla--rendicion tr:has-text("Lucía")');
  await page.waitForSelector('form[data-tipo=entrega_efectivo]');
  ok(await page.inputValue('form[data-tipo=entrega_efectivo] input[name=monto]') === '60.000', 'propone el efectivo pendiente');
  await page.fill('form[data-tipo=entrega_efectivo] input[name=monto]', '70.000');
  await page.click('[data-registrar=entrega_efectivo]');
  await page.waitForSelector('.aviso--error');
  ok(/Es más que lo pendiente \(\$60\.000\)/.test(await texto(page, '.aviso--error')), 'no deja entregar más de lo pendiente sin nota');
  await page.fill('form[data-tipo=entrega_efectivo] input[name=monto]', '30.000');
  ok(/Después de esto: \$30\.000 pendiente/.test(await texto(page, 'form[data-tipo=entrega_efectivo]')), '"Después de esta entrega" se calcula en vivo');
  await page.click('[data-registrar=entrega_efectivo]');
  await page.waitForSelector('text=Comprobante N.º 1');
  await revisar(page, 'comprobante');
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('#bajar-comprobante')]);
  const buf = readFileSync(await png.path());
  ok(png.suggestedFilename() === 'comprobante-1.png' && buf.subarray(1, 4).toString() === 'PNG' && buf.length > 10000, 'comprobante en imagen PNG');
  ok(/Comprobante N\.º 1/.test(decodeURIComponent(await page.getAttribute('#wa-comprobante', 'href'))), 'y para mandar por WhatsApp');
  await page.click('#cerrar-panel');
  ok(/Lucía Fernández Mitre 4 \$60\.000 \$30\.000 \$30\.000/.test(await texto(page, '.tabla--rendicion')), 'saldo actualizado: quedan $30.000');
  await page.click('.tabla--rendicion tr:has-text("Lucía")');
  await page.fill('form[data-tipo=pago_comision] input[name=monto]', '3.250');
  await page.click('[data-registrar=pago_comision]');
  await page.waitForSelector('text=Comprobante N.º 2');
  await page.click('#cerrar-panel');
  ok(/\$3\.250 \$3\.250 Al día/.test(await texto(page, '.tabla--rendicion tr:has-text("Lucía")')), 'comisión pagada: al día');
  const sql = (await q(`select sum(case when tipo='entrega_efectivo' then monto end) e, sum(case when tipo='pago_comision' then monto end) p from movimientos_rrpp`))[0];
  ok(Number(sql.e) === 30000 && Number(sql.p) === 3250, 'los movimientos quedan en la base');

  // ===================================================================
  console.log('\n== Ventas: detalle, reenviar, anular y cortesía');
  await ir(page, 'ventas', '#filtros');
  await revisar(page, 'ventas');
  await page.fill('#filtros [name=q]', '31.222');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-i]').length === 1);
  ok(/Juan Díaz/.test(await texto(page, 'tbody')), 'buscar por DNI');
  await page.fill('#filtros [name=q]', '');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-i]').length === 4);
  await page.selectOption('#filtros [name=medio]', 'transferencia');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-i]').length === 1);
  ok(true, 'filtrar por medio');
  await page.selectOption('#filtros [name=medio]', '');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-i]').length === 4);
  await page.click('tr[data-i]:has-text("Ana Pérez")');
  await page.waitForSelector('#panel .entrada-fila');
  ok(/Entrada 1 de 2 Sin usar Entrada 2 de 2 Sin usar/.test(await texto(page, '#panel')), 'detalle con el estado de cada entrada');
  await revisar(page, 'detalle de venta');
  await page.click('#reenviar');
  await page.click('dialog button[value=si]');
  await page.waitForSelector('#enviar-wa');
  ok(/entrada\.html#t=[A-Z2-7]{26}/.test(decodeURIComponent(await page.getAttribute('#enviar-wa', 'href'))), 'reenviar link: WhatsApp con el link nuevo');
  await page.click('#cerrar-panel');
  await page.click('tr[data-i]:has-text("Laura Sosa")');
  await page.waitForSelector('#anular');
  await page.click('#anular');
  await page.click('#confirmar-anular');
  await page.waitForSelector('#panel .aviso--error');
  ok(/Escribí el motivo/.test(await texto(page, '#panel .aviso--error')), 'anular pide el motivo');
  await page.fill('textarea[name=motivo]', 'Pagó con un billete falso');
  await page.click('#confirmar-anular');
  await page.waitForSelector('#panel >> text=Anulada: Pagó con un billete falso.');
  ok((await q(`select estado, anulada_por from ventas where titular_dni = '34555666'`))[0].anulada_por === ADMIN, 'queda registrado quién anuló');
  await page.click('#nueva-cortesia');
  await page.fill('#form-cortesia [name=nombre]', 'Invitado Especial');
  await page.fill('#form-cortesia [name=dni]', '35666777');
  await page.fill('#form-cortesia [name=cantidad]', '2');
  await revisar(page, 'emitir cortesía');
  await page.click('#emitir-cortesia');
  await page.waitForSelector('text=Cortesía emitida');
  ok((await q(`select total, canal from ventas where titular_dni = '35666777'`))[0].canal === 'cortesia', 'cortesía emitida a $0');
  ok(/entrada\.html#t=/.test(decodeURIComponent(await page.getAttribute('#enviar-wa', 'href'))), 'con su link para WhatsApp');

  // ===================================================================
  console.log('\n== Transferencias y exportes');
  await ir(page, 'transferencias', '.tabla');
  await revisar(page, 'transferencias');
  await page.check('.check');
  await page.click('#confirmar-sel');
  await page.waitForSelector('text=No hay transferencias para mostrar');
  ok((await q(`select transferencia_confirmada from ventas where titular_dni = '31222333'`))[0].transferencia_confirmada === true, 'marcar transferencias confirmadas');
  const tcsv = await descargarCSV(page, () => page.click('#exportar-transf'));
  ok(tcsv.texto.startsWith('﻿') && tcsv.texto.split('\r\n')[0] === '﻿Fecha;Titular;DNI;RRPP / canal;Monto;Confirmada', 'CSV de transferencias para cruzar con Mercado Pago');

  await ir(page, 'exportar', '.botones-exportar');
  await revisar(page, 'exportar y cierre');
  const v = await descargarCSV(page, () => page.click('[data-exportar=ventas]'));
  const filas = leerCSV(v.texto.replace(/^﻿/, ''));
  ok(v.texto.charCodeAt(0) === 0xFEFF, 'CSV con BOM UTF-8 (Excel reconoce los acentos)');
  ok(filas[0].includes('Titular') && filas[0].length > 10 && filas.every((f) => f.length === filas[0].length), 'separado por ";" y con todas las filas parejas');
  ok(filas.length - 1 === (await q('select count(*)::int n from ventas'))[0].n, 'una fila por venta');
  ok(filas.some((f) => f.includes('Ana Pérez')) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(v.texto), 'acentos intactos y sin IDs internos');
  const iTotal = filas[0].indexOf('Total');
  ok(filas.slice(1).every((f) => /^\d+(\.\d+)?$/.test(f[iTotal])), 'montos como números (sin "$" ni puntos de miles)');
  ok(/Entradas emitidas 7 Ingresaron 0 No vinieron: 7 Recaudado \$100\.000/.test(await texto(page, 'main')), 'resumen del evento para el cierre (la anulada no cuenta)');

  // ===================================================================
  console.log('\n== RRPP: comisión, límite por porcentaje y accesos');
  await ir(page, 'rrpp', '.tabla');
  await revisar(page, 'rrpp');
  await page.click('tr[data-ref]:has-text("Sofía Ruiz")');
  await page.waitForSelector('#form-rrpp');
  await page.click('[data-limite=porcentaje]');
  await page.fill('#form-rrpp [name=limite_valor]', '50');
  ok(/50% = 250 entradas en la Anticipada/.test(await texto(page, '#limite-efectivo')), 'muestra el límite efectivo ("50% = 250 entradas")');
  await page.click('#guardar-rrpp');
  await page.waitForSelector('tbody >> text=50% de la tanda');
  ok(/Sofía Ruiz .* 50% de la tanda 0 de 250/.test(await texto(page, 'tbody')), 'guardado: 0 de 250 en la Anticipada');
  await ir(page, 'evento', '#form-evento');
  await page.click('tr[data-ref]:has-text("Anticipada")');
  await page.fill('#form-tanda [name=cantidad]', '300');
  await page.click('#guardar-tanda');
  await page.waitForSelector('tr:has-text("Anticipada") >> text=300');
  await ir(page, 'rrpp', '.tabla');
  ok(/Sofía Ruiz .* 50% de la tanda 0 de 150/.test(await texto(page, 'tbody')), 'al cambiar la cantidad de la tanda, el límite por % se recalcula (150)');

  await page.click('#nuevo-usuario');
  await page.fill('#form-nuevo [name=nombre]', 'Juan Gómez');
  await page.fill('#form-nuevo [name=usuario]', 'Juan.Gomez');
  await page.fill('#form-nuevo [name=telefono]', '3401 552233');
  await page.fill('#form-nuevo [name=pueblo]', 'Landeta');
  await revisar(page, 'nuevo usuario');
  await page.click('#crear-usuario');
  await page.waitForSelector('#enviar-acceso');
  const acceso = decodeURIComponent(new URL(await page.getAttribute('#enviar-acceso', 'href')).searchParams.get('text'));
  const clave = (acceso.match(/Contraseña temporal: (\S+)/) || [])[1];
  ok(/^https:\/\/wa\.me\/5493401552233/.test(await page.getAttribute('#enviar-acceso', 'href')) && /Usuario: juan\.gomez/.test(acceso) && !!clave,
     '"Enviar acceso por WhatsApp" con usuario, contraseña temporal y link');
  await revisar(page, 'usuario creado');
  const ctxJ = await contexto(MOVIL);
  const pJ = await ingresar(ctxJ, 'juan.gomez', clave, 'miClaveJuan1');
  await pJ.waitForSelector('.tanda-vigente');
  ok(/Hola, Juan/.test(await texto(pJ, 'header')), 'el usuario nuevo entra, cambia la contraseña y ve su Inicio de RRPP');
  await ctxJ.close();
  await page.click('tr[data-ref]:has-text("Juan Gómez")');
  await page.click('#nueva-clave');
  await page.click('dialog button[value=si]');
  await page.waitForSelector('#enviar-acceso');
  const clave2 = (decodeURIComponent(await page.getAttribute('#enviar-acceso', 'href')).match(/Contraseña temporal: (\S+)/) || [])[1];
  ok(clave2 && clave2 !== clave && (await q(`select debe_cambiar_clave from perfiles where usuario = 'juan.gomez'`))[0].debe_cambiar_clave, 'restablecer contraseña: temporal nueva y vuelve a pedir el cambio');
  await page.click('#activar');
  await page.click('dialog button[value=si]');
  ok(await esperar(async () => (await q(`select activo from perfiles where usuario = 'juan.gomez'`))[0].activo === false), 'desactivar usuario');

  // ===================================================================
  console.log('\n== Evento y tandas');
  await ir(page, 'evento', '#form-evento');
  await revisar(page, 'evento y tandas');
  await page.fill('#form-evento [name=tope]', '5');
  await page.click('#guardar-evento');
  await page.waitForSelector('#error-evento');
  ok(/no puede quedar por debajo de las 7 entradas ya emitidas/.test(await texto(page, '#error-evento')), 'el tope no puede bajar de lo emitido');
  await page.fill('#form-evento [name=tope]', '1.100');
  await page.fill('#form-evento [name=lugar]', 'Salón comunal · Landeta');
  await page.fill('#form-evento [name=alias]', 'CLUB.MITRE.MP');
  await page.click('#guardar-evento');
  await esperar(async () => (await q('select transf_alias from config_club'))[0].transf_alias === 'CLUB.MITRE.MP');
  const ev = (await q('select tope_entradas, lugar from eventos'))[0];
  ok(ev.tope_entradas === 1100 && ev.lugar === 'Salón comunal · Landeta', 'tope movido y lugar cargado');
  ok((await q('select transf_alias from config_club'))[0].transf_alias === 'CLUB.MITRE.MP', 'datos para transferencias guardados');
  ok(await page.inputValue('#form-evento [name=fecha]') === '2026-12-18T23:59', 'fecha y hora en horario de Argentina');
  await page.click('#nueva-tanda');
  await page.fill('#form-tanda [name=nombre]', 'Última');
  await page.fill('#form-tanda [name=precio]', '24.000');
  await page.fill('#form-tanda [name=cantidad]', '500');
  await page.click('#guardar-tanda');
  await page.waitForSelector('tr:has-text("Última")');
  ok(/El tope general manda: se van a vender como máximo 1\.100/.test(await texto(page, '.nota-gris')), 'aviso si la suma de las tandas supera el tope');

  // ===================================================================
  console.log('\n== Auditoría y celular');
  await ir(page, 'auditoria', '#filtro-auditoria');
  const au = await texto(page, 'tbody');
  ok(/Anuló una venta Laura Sosa · 1 entrada · Motivo: Pagó con un billete falso/.test(au), 'auditoría: quién anuló, qué y por qué');
  ok(/Registró un movimiento de rendición Lucía Fernández/.test(au) && /Creó un usuario/.test(au) && /Desactivó un usuario/.test(au), 'movimientos, altas y bajas en la auditoría');
  await revisar(page, 'auditoría');
  await ctx.close();

  const ctxM = await contexto(MOVIL);
  const pM = await ingresar(ctxM, 'admin', 'claveNueva1');
  await pM.waitForSelector('.admin-kpis');
  for (const [s, sel] of [['tablero', '.admin-kpis'], ['rendicion', '.tabla--rendicion'], ['ventas', '#filtros'], ['rrpp', '.tabla'], ['evento', '#form-evento'], ['transferencias', '.admin-pestanas'], ['exportar', '.botones-exportar'], ['auditoria', '.tabla']]) {
    await ir(pM, s, sel);
    await revisar(pM, 'celular · ' + s);
  }
  await ctxM.close();

  const ctxR = await contexto(MOVIL);
  const pR = await ingresar(ctxR, 'lucia');
  await pR.waitForSelector('.tanda-vigente');
  ok(/Efectivo a rendir \$10\.000 Ya rendiste \$30\.000/.test(await texto(pR, '.tarjeta--ancha')) && /Tu comisión \$2\.250 Te corresponde · cobrado \$3\.250/.test(await texto(pR, '.tarjetas')),
     'el RRPP ve en su Inicio las entregas y la comisión cobrada');
  await ctxR.close();
} catch (err) {
  console.error(err);
  c.fallas++;
} finally {
  await navegador.close();
  srv.close();
  await base.detener();
}

if (c.fallas) { console.log(`\n${c.fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nUI fase 4: todo bien.');
