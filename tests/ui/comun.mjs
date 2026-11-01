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
  // opciones.tecnica: pantallas que muestran a propósito datos técnicos
  // (el registro de errores del admin): no se revisa la jerga.
  return async function revisar(page, nombre, opciones = {}) {
    await page.waitForTimeout(50);
    const texto = await page.evaluate(() => document.body.innerText);
    const hallado = opciones.tecnica ? [] : PROHIBIDO.map((re) => texto.match(re)).filter(Boolean).map((m) => m[0]);
    const chicos = await page.evaluate(() => [...document.querySelectorAll('button, .boton, input')]
      .filter((b) => b.offsetParent && b.type !== 'hidden' && b.type !== 'checkbox').filter((b) => b.getBoundingClientRect().height < 44)
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

// Cámara simulada: un canvas que dibuja el QR de window.__qr (para probar
// la lectura real video → canvas → jsQR sin cámara física).
export function camaraFalsa() {
  return '(() => {\n' + readFileSync(new URL('../../vendor/qrcode/qrcode.js', import.meta.url), 'utf8') + `
  window.__qr = null;
  navigator.mediaDevices.getUserMedia = async () => {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
    const g = cv.getContext('2d');
    const dibujar = () => {
      g.fillStyle = '#6B7280'; g.fillRect(0, 0, 640, 480);
      if (!window.__qr) return;
      const q = qrcode(0, 'M'); q.addData(window.__qr, /^[0-9A-Z $%*+\\-./:]+$/.test(window.__qr) ? 'Alphanumeric' : 'Byte'); q.make();
      const n = q.getModuleCount(), celda = Math.floor(380 / (n + 8)), lado = celda * (n + 8), x0 = (640 - lado) / 2, y0 = (480 - lado) / 2;
      g.fillStyle = '#fff'; g.fillRect(x0, y0, lado, lado); g.fillStyle = '#000';
      for (let f = 0; f < n; f++) for (let k = 0; k < n; k++) if (q.isDark(f, k)) g.fillRect(x0 + (k + 4) * celda, y0 + (f + 4) * celda, celda, celda);
    };
    setInterval(dibujar, 40); dibujar();
    return cv.captureStream(25);
  };
})();`;
}
