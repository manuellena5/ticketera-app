// Fase 5 · Carga: 1.000 entradas, lista de puerta, escaneo de 1.000 en local
// (hash + búsqueda y lectura de QR con jsQR en Chromium) y registro de los
// 1.000 ingresos desde 2 celulares.
//   node tests/carga/carga.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { levantarBase, comoUsuario, fijarReloj } from '../backend_local.mjs';
import { contador } from '../ui/comun.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const c = contador();
const ok = c.ok;
const RRPP = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013'];
const P1 = '00000000-0000-4000-8000-000000000021', P2 = '00000000-0000-4000-8000-000000000022';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const base = await levantarBase({ ahora: '2026-11-10 12:00:00-03' });
base.pool.options.max = 20;
const q = async (sql, p) => (await base.pool.query(sql, p)).rows;
const ms = (t0) => Date.now() - t0;

try {
  await q(`update tandas set cantidad = 1000 where nombre = 'Anticipada'; update rrpp_evento set limite_tipo = 'sin_limite', limite_valor = null`);

  console.log('\n== 1.000 entradas emitidas por RPC (500 ventas de 2, 10 a la vez)');
  let t0 = Date.now();
  const tiempos = [];
  for (let lote = 0; lote < 50; lote++) {
    await Promise.all(Array.from({ length: 10 }, async (_, j) => {
      const i = lote * 10 + j;
      const t = Date.now();
      await comoUsuario(base.pool, RRPP[i % 3], `select public.emitir_venta($1, $2, $3, null, 2, 'efectivo')`,
        [randomUUID(), 'Persona ' + i, String(20000000 + i)]);
      tiempos.push(ms(t));
    }));
  }
  const total = ms(t0);
  tiempos.sort((a, b) => a - b);
  const [{ n }] = await q(`select count(*)::int n from entradas`);
  ok(n === 1000, `1.000 entradas en la base (${total} ms en total)`);
  ok(tiempos[Math.floor(tiempos.length * 0.95)] < 500, `emitir una venta: mediana ${tiempos[250]} ms, p95 ${tiempos[475]} ms (con 10 a la vez)`);

  console.log('\n== Lista de puerta');
  await fijarReloj(base.pool, '2026-12-18 23:00:00-03');
  t0 = Date.now();
  const [{ r: lista }] = await comoUsuario(base.pool, P1, 'select public.descargar_lista_puerta() r');
  const tLista = ms(t0);
  const kb = Math.round(JSON.stringify(lista).length / 1024);
  ok(lista.entradas.length === 1000 && tLista < 3000, `descarga de 1.000 entradas: ${tLista} ms, ${kb} KB`);
  ok(kb < 400, 'la lista pesa poco (se baja bien con 4G)');

  console.log('\n== Escaneo de 1.000 en el celular (Chromium)');
  const codigos = (await q('select codigo from entradas order by random()')).map((x) => x.codigo);
  const nav = await chromium.launch();
  const page = await (await nav.newContext()).newPage();
  // http://127.0.0.1 es contexto seguro (hace falta para SHA-256): se sirve una página vacía.
  await page.route('http://127.0.0.1:9/', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>carga</title>' }));
  await page.goto('http://127.0.0.1:9/');
  await page.addScriptTag({ content: readFileSync(new URL('../../vendor/jsqr/jsQR.js', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: readFileSync(new URL('../../vendor/qrcode/qrcode.js', import.meta.url), 'utf8') });
  const res = await page.evaluate(async ({ lista, codigos }) => {
    const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const mapa = new Map(lista.map((f) => [f.h, f]));
    let t = performance.now(), encontradas = 0;
    for (const cod of codigos) { const f = mapa.get(await sha(cod)); if (f && f.e === 'valida' && !f.i) { f.i = 'x'; encontradas++; } }
    const busqueda = (performance.now() - t) / codigos.length;
    // Lectura del QR: cuadro de cámara de 640×480 con el QR al medio
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
    const g = cv.getContext('2d', { willReadFrequently: true });
    let lectura = 0, leidas = 0;
    for (const cod of codigos.slice(0, 40)) {
      const qr = qrcode(0, 'M'); qr.addData(cod, 'Alphanumeric'); qr.make();
      const n = qr.getModuleCount(), celda = Math.floor(300 / (n + 8)), lado = celda * (n + 8), x0 = (640 - lado) / 2, y0 = (480 - lado) / 2;
      g.fillStyle = '#777'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#fff'; g.fillRect(x0, y0, lado, lado); g.fillStyle = '#000';
      for (let f = 0; f < n; f++) for (let k = 0; k < n; k++) if (qr.isDark(f, k)) g.fillRect(x0 + (k + 4) * celda, y0 + (f + 4) * celda, celda, celda);
      const t2 = performance.now();
      const img = g.getImageData(0, 0, 640, 480);
      const r = jsQR(img.data, 640, 480, { inversionAttempts: 'dontInvert' });
      lectura += performance.now() - t2;
      if (r && r.data === cod) leidas++;
    }
    return { busqueda, encontradas, lectura: lectura / 40, leidas };
  }, { lista: lista.entradas, codigos });
  await nav.close();
  ok(res.encontradas === 1000, 'los 1.000 QR se validan con la lista guardada (sin red)');
  ok(res.busqueda < 10, `validar un QR (hash + búsqueda): ${res.busqueda.toFixed(2)} ms promedio`);
  ok(res.leidas === 40 && res.lectura < 300, `leer un QR de un cuadro de cámara con jsQR: ${res.lectura.toFixed(0)} ms promedio (40 de 40 leídos)`);
  ok(res.lectura + res.busqueda + 100 < 1000, 'con el ciclo de cámara de 100 ms, cada escaneo queda muy por debajo de 1 segundo');

  console.log('\n== 1.000 ingresos desde 2 celulares (lotes de 100, 100 repetidos entre los dos)');
  const hashes = lista.entradas.map((f) => f.h);
  const desdeA = hashes.slice(0, 550), desdeB = hashes.slice(450);
  t0 = Date.now();
  const subir = async (usuario, hs, disp, base0) => {
    for (let i = 0; i < hs.length; i += 100) {
      const lote = hs.slice(i, i + 100).map((h, j) => ({ h, dispositivo: disp, momento: new Date(Date.parse('2026-10-31T23:00:00-03:00') + (base0 + i + j) * 1000).toISOString() }));
      await comoUsuario(base.pool, usuario, 'select public.registrar_ingresos($1::jsonb)', [JSON.stringify(lote)]);
    }
  };
  await Promise.all([subir(P1, desdeA, 'puerta1-a', 0), subir(P2, desdeB, 'puerta2-b', 600)]);
  const tIngresos = ms(t0);
  const [{ r: cont }] = await comoUsuario(base.pool, P1, 'select public.contador_puerta() r');
  ok(cont.adentro === 1000, `adentro: 1.000 (${tIngresos} ms para subir los dos celulares en paralelo)`);
  const [{ d }] = await q(`select count(*)::int d from auditoria where accion = 'intento_duplicado'`);
  ok(d === 100, 'los 100 repetidos entre celulares quedaron como intento duplicado');
  const [{ g }] = await q(`select count(*)::int g from entradas where ingreso_dispositivo = 'puerta1-a' and codigo_hash = any($1)`, [hashes.slice(450, 550)]);
  ok(g === 100, 'en los repetidos ganó el primero (celular 1)');

  console.log('\n== Panel con 1.000 entradas');
  for (const f of ['tablero_admin', 'rendicion_admin', 'resumen_cierre']) {
    t0 = Date.now();
    await comoUsuario(base.pool, ADMIN, `select public.${f}()`);
    const t = ms(t0);
    ok(t < 2000, `${f}: ${t} ms`);
  }
  t0 = Date.now();
  const [{ r: cambios }] = await comoUsuario(base.pool, P2, `select public.cambios_puerta(now() - interval '1 hour') r`);
  ok(cambios.entradas.length === 1000 && ms(t0) < 3000, `sincronización completa de un celular: ${ms(t0)} ms`);
} catch (err) {
  console.error(err);
  c.fallas++;
} finally {
  await base.detener();
}
if (c.fallas) { console.log(`\n${c.fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nCarga: todo bien.');
