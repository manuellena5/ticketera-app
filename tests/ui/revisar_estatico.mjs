// Chequeos estáticos del frontend (sin navegador):
//  - el CSP de cada página permite conectarse SOLO al proyecto de config.js;
//  - todo archivo del service worker existe;
//  - ninguna clave service_role ni JWT con rol privilegiado en el repo;
//  - sin scripts ni estilos de terceros (CDN) en las páginas.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const leer = (p) => readFile(path.join(RAIZ, p), 'utf8');
let fallas = 0;
const ok = (cond, desc) => { console.log((cond ? '  ok · ' : '  FALLA · ') + desc); if (!cond) fallas++; };

const config = await leer('js/config.js');
const url = config.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const host = url.replace(/^https:\/\//, '').replace(/\/.*$/, '');

for (const pagina of ['index.html', 'entrada.html']) {
  const html = await leer(pagina);
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const dir = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  ok(dir['default-src']?.join(' ') === "'self'", `${pagina}: default-src 'self'`);
  ok(dir['script-src']?.join(' ') === "'self'", `${pagina}: script-src solo 'self' (sin inline ni eval)`);
  const connect = (dir['connect-src'] || []).filter((x) => x !== "'self'");
  ok(connect.length === 2 && connect.includes('https://' + host) && connect.includes('wss://' + host),
     `${pagina}: connect-src solo al proyecto de config.js (${host})`);
  ok(!/<script[^>]+src="(https?:)?\/\//.test(html) && !/<link[^>]+href="(https?:)?\/\//.test(html),
     `${pagina}: sin scripts ni estilos de terceros`);
  ok(!/<script>(?!\s*<\/script>)/.test(html) && !/\son[a-z]+="/.test(html), `${pagina}: sin JS inline`);
}

const sw = await leer('sw.js');
const lista = [...sw.matchAll(/^\s*'([^']+)',?$/gm)].map((m) => m[1]).filter((a) => a !== './');
let faltan = [];
for (const a of lista) { try { await stat(path.join(RAIZ, a)); } catch { faltan.push(a); } }
ok(lista.length > 10 && faltan.length === 0, `service worker: los ${lista.length} archivos existen` + (faltan.length ? ' (faltan: ' + faltan.join(', ') + ')' : ''));

const version = await leer('js/version.js');
ok(/self\.CACHE_NAME\s*=\s*'entradas-v'\s*\+\s*self\.APP_VERSION/.test(version) && /importScripts\('js\/version\.js'\)/.test(sw),
   'APP_VERSION y CACHE_NAME salen del mismo lugar');

async function* recorrer(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'vendor'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* recorrer(p); else yield p;
  }
}
let sospechosos = [];
for await (const p of recorrer(RAIZ)) {
  if (!/\.(js|mjs|html|json|sql|md|ts|toml|env|txt)$/.test(p)) continue;
  const txt = await readFile(p, 'utf8');
  for (const jwt of txt.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) || []) {
    try {
      const datos = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      if (datos.role !== 'anon') sospechosos.push(path.relative(RAIZ, p) + ' (rol ' + datos.role + ')');
    } catch { sospechosos.push(path.relative(RAIZ, p)); }
  }
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(txt)) sospechosos.push(path.relative(RAIZ, p) + ' (sb_secret)');
}
ok(sospechosos.length === 0, 'ninguna clave privilegiada en el repo' + (sospechosos.length ? ': ' + sospechosos.join(', ') : ''));

if (fallas) { console.log(`\n${fallas} chequeo(s) con fallas.`); process.exit(1); }
console.log('\nChequeos estáticos: todo bien.');
