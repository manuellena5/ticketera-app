// Servidor estático mínimo para probar la PWA en local (como GitHub Pages).
//   node tests/servir.mjs [puerto]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

export function servir(puerto = 0) {
  const srv = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const archivo = path.join(RAIZ, path.normalize(p));
      if (!archivo.startsWith(RAIZ + path.sep) || /[\\/]\.(git|github)\b/.test(archivo)) throw new Error('fuera');
      const datos = await readFile(archivo);
      res.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(datos);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('No encontrado');
    }
  });
  return new Promise((ok) => srv.listen(puerto, '127.0.0.1', () => ok(srv)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const srv = await servir(Number(process.argv[2] || 8080));
  console.log('Sirviendo en http://127.0.0.1:' + srv.address().port + '/');
}
