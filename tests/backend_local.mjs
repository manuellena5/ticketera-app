// Backend local para probar la app de punta a punta SIN un proyecto de Supabase:
//  - levanta un Postgres descartable con la emulación de Supabase, las
//    migraciones y la semilla (las mismas reglas que en producción);
//  - emula, dentro de Playwright, lo mínimo de Auth (/auth/v1) y de PostgREST
//    (/rest/v1/rpc) que usa supabase-js, ejecutando cada RPC con el rol
//    anon/authenticated y los claims del usuario, igual que Supabase.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, chownSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// El mismo proyecto que js/config.js (así coincide con el CSP). Las pruebas
// nunca llegan a la red: Playwright intercepta todo lo que va a esa URL.
export const URL_PROYECTO = readFileSync(path.join(RAIZ, 'js/config.js'), 'utf8').match(/SUPABASE_URL:\s*'([^']+)'/)[1];
export const ANON_KEY = 'clave-anon-de-prueba';

function pgBin() {
  const base = '/usr/lib/postgresql';
  const v = readdirSync(base).sort((a, b) => Number(b) - Number(a))[0];
  return path.join(base, v, 'bin');
}

export async function levantarBase({ ahora, semilla = true } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pg-entradas-'));
  const root = process.getuid && process.getuid() === 0;
  const como = (bin, args) => root
    ? execFileSync('runuser', ['-u', 'postgres', '--', path.join(pgBin(), bin), ...args], { stdio: 'pipe' })
    : execFileSync(path.join(pgBin(), bin), args, { stdio: 'pipe' });
  if (root) chownSync(dir, Number(execFileSync('id', ['-u', 'postgres']).toString().trim()), 0);
  const puerto = 55000 + Math.floor(Math.random() * 4000);
  como('initdb', ['-D', dir + '/datos', '-U', 'postgres', '-A', 'trust', '--locale=C.UTF-8', '-E', 'UTF8']);
  como('pg_ctl', ['-D', dir + '/datos', '-o', `-k ${dir} -p ${puerto} -c listen_addresses=''`, '-l', dir + '/log', '-w', 'start']);

  const pool = new pg.Pool({ host: dir, port: puerto, user: 'postgres', database: 'postgres', max: 8 });
  const archivos = ['tests/sql/00_supabase_stub.sql',
    ...readdirSync(path.join(RAIZ, 'supabase/migrations')).sort().map((f) => 'supabase/migrations/' + f),
    ...(semilla ? ['supabase/seed.sql'] : [])];
  for (const f of archivos) await pool.query(readFileSync(path.join(RAIZ, f), 'utf8'));
  if (ahora) await fijarReloj(pool, ahora);

  return {
    pool,
    async detener() {
      await pool.end();
      try { como('pg_ctl', ['-D', dir + '/datos', '-m', 'immediate', 'stop']); } catch { /* nada */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Reloj de la base para las pruebas (privado.ahora()).
export async function fijarReloj(pool, ahora) {
  await pool.query(`create or replace function privado.ahora() returns timestamptz language sql stable as $$ select '${ahora}'::timestamptz $$`);
}

// ---------------- JWT de mentira (firmado con un secreto local) ----------------
const SECRETO = randomBytes(32);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function firmar(payload) {
  const cuerpo = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(payload);
  return cuerpo + '.' + createHmac('sha256', SECRETO).update(cuerpo).digest('base64url');
}
function verificar(token) {
  const [h, p, f] = String(token || '').split('.');
  if (!f || createHmac('sha256', SECRETO).update(h + '.' + p).digest('base64url') !== f) return null;
  const datos = JSON.parse(Buffer.from(p, 'base64url').toString());
  return datos.exp > Date.now() / 1000 ? datos : null;
}

function sesion(u) {
  const ahora = Math.floor(Date.now() / 1000);
  const claims = { sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: ahora, exp: ahora + 3600 };
  const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token: firmar(claims), token_type: 'bearer', expires_in: 3600, expires_at: ahora + 3600,
           refresh_token: firmar({ sub: u.id, exp: ahora + 86400, tipo: 'refresh' }), user };
}

function claveTemporal() {
  const letras = 'abcdefghjkmnpqrstuvwxyz', numeros = '23456789';
  const r = randomBytes(8);
  let s = '';
  for (let i = 0; i < 4; i++) s += letras[r[i] % letras.length];
  s += '-';
  for (let i = 4; i < 8; i++) s += numeros[r[i] % numeros.length];
  return s;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*',
               'access-control-expose-headers': '*' };

// Instala la emulación en un contexto de Playwright.
// Devuelve un objeto para inspeccionar llamadas en los tests.
export async function instalarSupabase(contexto, pool) {
  const registro = { rpc: [], cortarRespuesta: {} };

  async function json(route, status, body) {
    await route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' },
                          body: body === undefined ? '' : JSON.stringify(body) });
  }

  async function auth(route, req, url) {
    const ruta = url.pathname.replace('/auth/v1', '');
    const cuerpo = req.postData() ? JSON.parse(req.postData()) : {};
    if (ruta === '/token' && url.searchParams.get('grant_type') === 'password') {
      const r = await pool.query(
        `select id, email from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`,
        [String(cuerpo.email || '').toLowerCase(), String(cuerpo.password || '')]);
      if (!r.rows[0]) return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(route, 200, sesion(r.rows[0]));
    }
    if (ruta === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const datos = verificar(cuerpo.refresh_token);
      if (!datos) return json(route, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      const r = await pool.query('select id, email from auth.users where id = $1', [datos.sub]);
      return json(route, 200, sesion(r.rows[0]));
    }
    const claims = verificar((req.headers()['authorization'] || '').replace(/^Bearer /, ''));
    if (ruta === '/logout') return json(route, 204);
    if (!claims) return json(route, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    const u = (await pool.query('select id, email, encrypted_password from auth.users where id = $1', [claims.sub])).rows[0];
    if (ruta === '/user' && req.method() === 'GET') return json(route, 200, sesion(u).user);
    if (ruta === '/user' && req.method() === 'PUT') {
      if (cuerpo.password) {
        if (String(cuerpo.password).length < 6) return json(route, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
        const igual = (await pool.query('select extensions.crypt($1, $2) = $2 as igual', [cuerpo.password, u.encrypted_password])).rows[0].igual;
        if (igual) return json(route, 422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' });
        await pool.query(`update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf', 4)) where id = $2`, [cuerpo.password, u.id]);
      }
      return json(route, 200, sesion(u).user);
    }
    return json(route, 404, { code: 404, msg: 'no emulado' });
  }

  async function rpc(route, req, url) {
    const nombre = url.pathname.replace('/rest/v1/rpc/', '');
    const token = (req.headers()['authorization'] || '').replace(/^Bearer /, '');
    const claims = token === ANON_KEY ? null : verificar(token);
    if (token !== ANON_KEY && !claims) return json(route, 401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null });
    const args = req.postData() ? JSON.parse(req.postData()) : {};
    registro.rpc.push({ nombre, args, usuario: claims && claims.sub });

    const info = (await pool.query(
      `select p.proretset, p.prorettype = 'void'::regtype as es_void,
              coalesce(p.proargnames, '{}') as nombres, coalesce(p.proargmodes::text[], '{}') as modos,
              array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`, [nombre])).rows[0];
    if (!info) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function', details: null, hint: null });

    const nombresIn = info.nombres.filter((_, i) => !info.modos[i] || info.modos[i] === 'i');
    if (Object.keys(args).some((k) => !nombresIn.includes(k))) {
      return json(route, 404, { code: 'PGRST202', message: 'Could not find the function with those parameters', details: null, hint: null });
    }
    const params = [];
    const partes = Object.keys(args).map((k) => {
      const tipo = info.tipos[nombresIn.indexOf(k)];
      if (!tipo) throw new Error('argumento desconocido ' + k);
      let v = args[k];
      if (v !== null && typeof v === 'object') v = tipo.endsWith('[]') ? '{' + v.join(',') + '}' : JSON.stringify(v);
      params.push(v);
      return `${k} => $${params.length}::${tipo}`;
    });
    const llamada = `public.${nombre}(${partes.join(', ')})`;
    const sql = info.proretset ? `select coalesce(json_agg(x), '[]') as r from ${llamada} x`
              : info.es_void ? `select ${llamada}, null::json as r`
              : `select to_json(${llamada}) as r`;

    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || { role: 'anon' })]);
      await c.query(claims ? 'set local role authenticated' : 'set local role anon');
      const r = await c.query(sql, params);
      await c.query('commit');
      // Simula que la venta se registró pero la respuesta no llegó al celular.
      if (registro.cortarRespuesta && registro.cortarRespuesta[nombre] > 0) {
        registro.cortarRespuesta[nombre]--;
        return route.abort('failed');
      }
      if (info.es_void) return json(route, 204);
      return json(route, 200, r.rows[0].r);
    } catch (err) {
      await c.query('rollback').catch(() => {});
      const status = err.code === '42501' ? (claims ? 403 : 401) : err.code === 'P0001' ? 400 : 400;
      return json(route, status, { code: err.code, message: err.message, details: err.detail || null, hint: err.hint || null });
    } finally {
      c.release();
    }
  }

  // Emulación de la Edge Function admin_crear_usuario: mismos pasos y las
  // mismas funciones SQL (admin_registrar_usuario / admin_clave_temporal).
  async function funcionUsuarios(route, req) {
    const claims = verificar((req.headers()['authorization'] || '').replace(/^Bearer /, ''));
    if (!claims) return json(route, 401, { mensaje: 'Tenés que ingresar de nuevo.' });
    const yo = (await pool.query(`select rol, activo from perfiles where user_id = $1`, [claims.sub])).rows[0];
    if (!yo || !yo.activo || yo.rol !== 'admin') return json(route, 403, { mensaje: 'No tenés permiso para hacer esto.' });
    const cuerpo = JSON.parse(req.postData() || '{}');
    registro.funciones = (registro.funciones || []).concat([cuerpo]);
    const clave = claveTemporal();
    const comoServicio = async (sql, params) => {
      const c = await pool.connect();
      try { await c.query('begin'); await c.query('set local role service_role'); const r = await c.query(sql, params); await c.query('commit'); return r; }
      catch (err) { await c.query('rollback').catch(() => {}); throw err; }
      finally { c.release(); }
    };
    if (cuerpo.accion === 'crear') {
      const usuario = String(cuerpo.usuario || '').trim().toLowerCase();
      if (String(cuerpo.nombre || '').trim().length < 3) return json(route, 400, { mensaje: 'Escribí el nombre y apellido.' });
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(usuario)) return json(route, 400, { mensaje: 'El usuario tiene que tener de 3 a 30 letras o números, sin espacios.' });
      const email = usuario + '@usuarios.ticketera-app.com.ar';
      if ((await pool.query('select 1 from auth.users where email = $1', [email])).rows[0]) return json(route, 409, { mensaje: 'Ese usuario ya existe. Elegí otro.' });
      const id = (await pool.query(`insert into auth.users (id, email, encrypted_password, aud, role) values (gen_random_uuid(), $1, extensions.crypt($2, extensions.gen_salt('bf', 4)), 'authenticated', 'authenticated') returning id`, [email, clave])).rows[0].id;
      try {
        await comoServicio('select public.admin_registrar_usuario($1, $2, $3, $4, $5, $6, $7)',
          [claims.sub, id, cuerpo.nombre, usuario, cuerpo.telefono || null, cuerpo.pueblo || null, cuerpo.rol]);
      } catch (err) {
        await pool.query('delete from auth.users where id = $1', [id]);
        return json(route, 400, { mensaje: err.code === 'P0001' ? err.message : 'No se pudo crear el usuario.' });
      }
      return json(route, 200, { usuario, clave });
    }
    if (cuerpo.accion === 'restablecer') {
      const p = (await pool.query('select usuario from perfiles where user_id = $1', [cuerpo.user_id])).rows[0];
      if (!p) return json(route, 404, { mensaje: 'No encontramos ese usuario.' });
      await pool.query(`update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf', 4)) where id = $2`, [clave, cuerpo.user_id]);
      await comoServicio('select public.admin_clave_temporal($1, $2)', [claims.sub, cuerpo.user_id]);
      return json(route, 200, { usuario: p.usuario, clave });
    }
    return json(route, 400, { mensaje: 'Algo salió mal. Probá de nuevo.' });
  }

  // Las rutas emuladas responden aunque el contexto esté "sin conexión":
  // se corta a mano para que el modo avión sea real.
  const setOffline = contexto.setOffline.bind(contexto);
  contexto.setOffline = async (v) => { registro.offline = v; return setOffline(v); };

  await contexto.route(URL_PROYECTO + '/**', async (route) => {
    if (registro.offline) return route.abort('internetdisconnected');
    // DEMORA_BACKEND=400 simula un servidor lento (para encontrar carreras en los tests).
    const demora = Number(process.env.DEMORA_BACKEND || 0);
    if (demora) await new Promise((r) => setTimeout(r, demora));
    if (registro.offline) return route.abort('internetdisconnected');
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    try {
      if (url.pathname.startsWith('/auth/v1/')) return await auth(route, req, url);
      if (url.pathname.startsWith('/rest/v1/rpc/')) return await rpc(route, req, url);
      if (url.pathname === '/functions/v1/admin_crear_usuario') {
        // funcionCaida simula lo que ve el navegador cuando el preflight de CORS falla.
        if (registro.funcionCaida) return route.abort('failed');
        return await funcionUsuarios(route, req);
      }
      return json(route, 404, { message: 'no emulado' });
    } catch (err) {
      console.error('backend_local:', err);
      return json(route, 500, { message: 'error del backend local' });
    }
  });

  // config.js apuntando al "proyecto" emulado
  await contexto.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body:
    `window.CONFIG = Object.freeze({ SUPABASE_URL: '${URL_PROYECTO}', SUPABASE_ANON_KEY: '${ANON_KEY}', ` +
    `AUTH_DOMAIN: 'usuarios.ticketera-app.com.ar', NOMBRE_CLUB: 'Club Deportivo Mitre' });` }));

  return registro;
}

// Ejecuta una RPC como un usuario (para preparar datos en los tests).
export async function comoUsuario(pool, usuarioId, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: usuarioId, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
