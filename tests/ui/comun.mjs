// Utilidades compartidas por los tests de interfaz.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export const PROHIBIDO = [/[0-9a-f]{8}-[0-9a-f]{4}-/i, /supabase/i,
  /\b(eventos|tandas|config_club|perfiles|rrpp_evento|ventas|entradas|movimientos_rrpp|auditoria|intentos_link|secretos_evento)\b(?=[_(]|\.[a-z])/i,
  /\b(rpc|jwt|uuid|null|undefined|NaN|P0001|42501|PGRST\d+)\b/, /\[object /];

export const MOVIL = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR' };

export function contador() {
  const c = { fallas: 0 };
  c.ok = (cond, desc) => { console.log((cond ? '  ok · ' : '  FALLA · ') + desc); if (!cond) c.fallas++; };
  return c;
}

export function seguirErrores(page) {
  page.errores = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|ERR_INTERNET_DISCONNECTED/.test(m.text())) page.errores.push(m.text()); });
  page.on('pageerror', (e) => page.errores.push(String(e)));
  return page;
}

// Revisa una pantalla: sin datos internos, sin errores, botones ≥ 44 px,
// texto ≥ 16 px en <main> y sin scroll lateral.
export function revisor(ok) {
  const vistas = new Set();
  return async function revisar(page, nombre) {
    await page.waitForTimeout(50);
    const texto = await page.evaluate(() => document.body.innerText);
    const hallado = PROHIBIDO.map((re) => texto.match(re)).filter(Boolean).map((m) => m[0]);
    const chicos = await page.evaluate(() => [...document.querySelectorAll('button, .boton, input')]
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
    if (!vistas.has(nombre) || problemas.length) {
      ok(problemas.length === 0, `pantalla "${nombre}": sin IDs ni jerga, sin errores, 48 px, 16 px, sin scroll lateral` + (problemas.length ? ' → ' + problemas.join(' / ') : ''));
    }
    vistas.add(nombre);
    page.errores = [];
  };
}

// Página auxiliar (sin CSP) con jsQR para leer QR desde PNG o desde canvas.
export async function lectorQR(navegador) {
  const ctx = await navegador.newContext();
  const page = await ctx.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: readFileSync(require.resolve('jsqr/dist/jsQR.js'), 'utf8') });
  return {
    async leerPNG(buffer) {
      return page.evaluate(async (b64) => {
        const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
        const bmp = await createImageBitmap(blob);
        const cv = document.createElement('canvas');
        cv.width = bmp.width; cv.height = bmp.height;
        const c = cv.getContext('2d');
        c.drawImage(bmp, 0, 0);
        const img = c.getImageData(0, 0, cv.width, cv.height);
        const r = jsQR(img.data, img.width, img.height);
        return r ? r.data : null;
      }, buffer.toString('base64'));
    },
    cerrar: () => ctx.close(),
  };
}

// PNG de un canvas de la página probada.
export async function pngDeCanvas(page, selector) {
  const b64 = await page.$eval(selector, (cv) => cv.toDataURL('image/png').split(',')[1]);
  return Buffer.from(b64, 'base64');
}
