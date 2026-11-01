// Edge Function admin_crear_usuario
// Crea usuarios (RRPP, puerta, caja, admin) y restablece contraseñas.
// - Verifica ELLA MISMA que quien llama sea admin activo (con su token, vía
//   mi_perfil). Por eso se despliega con "Verify JWT" DESACTIVADO: si el
//   gateway verifica el JWT, rechaza el preflight de CORS (OPTIONS, que no
//   lleva token) y el navegador bloquea la llamada.
// - Usa la service role SOLO acá (Supabase la pasa como variable). Nunca va
//   al frontend.
// - La lógica de datos está en SQL: admin_registrar_usuario y
//   admin_clave_temporal (solo service_role). Los errores técnicos se
//   guardan en errores_tecnicos (registrar_error_servidor).
//
// Despliegue (panel): Edge Functions → admin_crear_usuario → pegar este
// archivo → Deploy, y en Details/Settings desactivar "Verify JWT".
// Secret: AUTH_DOMAIN (opcional; por defecto usuarios.ticketera-app.com.ar).
// Diagnóstico: abrir https://<proyecto>.supabase.co/functions/v1/admin_crear_usuario
// en el navegador tiene que mostrar "La función de usuarios está funcionando.".
// CLI: supabase functions deploy admin_crear_usuario --no-verify-jwt
import { createClient } from 'jsr:@supabase/supabase-js@2';

const USUARIO = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const ROLES = ['admin', 'rrpp', 'puerta', 'caja'];

// CORS permisivo a propósito: la seguridad no depende del origen sino del
// token de un admin activo (que se verifica abajo). Se devuelven los
// encabezados que el navegador pide, así ningún encabezado nuevo de
// supabase-js rompe el preflight.
function cors(req: Request): Record<string, string> {
  const pedidos = req.headers.get('Access-Control-Request-Headers');
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': pedidos || 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

// Contraseña temporal legible (sin letras que se confunden), ej. "kmtr-4829".
function claveTemporal(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const r = crypto.getRandomValues(new Uint32Array(8));
  let s = '';
  for (let i = 0; i < 4; i++) s += letras[r[i] % letras.length];
  s += '-';
  for (let i = 4; i < 8; i++) s += numeros[r[i] % numeros.length];
  return s;
}

Deno.serve(async (req) => {
  const h = cors(req);
  // 1) Preflight de CORS: siempre 200, antes de cualquier otra cosa.
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: h });

  const responder = (status: number, cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...h, 'Content-Type': 'application/json' } });

  let servicio: ReturnType<typeof createClient> | null = null;
  let adminId: string | null = null;
  const registrarError = async (mensaje: string, detalle: Record<string, unknown> = {}) => {
    try {
      if (servicio) await servicio.rpc('registrar_error_servidor', { p_datos: { origen: 'edge', pantalla: 'admin_crear_usuario', mensaje, detalle }, p_usuario: adminId });
    } catch (_) { /* nada */ }
  };

  try {
    // Abrir la URL en el navegador (GET) sirve de diagnóstico: si se ve este
    // mensaje, la función está desplegada, arranca y "Verify JWT" está apagado.
    if (req.method === 'GET') {
      return responder(200, {
        mensaje: 'La función de usuarios está funcionando.',
        configurada: Boolean(Deno.env.get('SUPABASE_URL') && Deno.env.get('SUPABASE_ANON_KEY') && Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
        dominio: Deno.env.get('AUTH_DOMAIN') ?? 'usuarios.ticketera-app.com.ar (por defecto)',
      });
    }
    if (req.method !== 'POST') return responder(405, { mensaje: 'No permitido.' });

    const URL_PROYECTO = Deno.env.get('SUPABASE_URL');
    const ANON = Deno.env.get('SUPABASE_ANON_KEY');
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const DOMINIO = Deno.env.get('AUTH_DOMAIN') ?? 'usuarios.ticketera-app.com.ar';
    if (!URL_PROYECTO || !ANON || !SERVICE) {
      return responder(500, { mensaje: 'La función de usuarios no está bien configurada. Avisale a quien administra la app.' });
    }
    servicio = createClient(URL_PROYECTO, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    const autorizacion = req.headers.get('Authorization') ?? '';
    if (!autorizacion.startsWith('Bearer ')) return responder(401, { mensaje: 'Tenés que ingresar de nuevo.' });

    // 2) ¿Quién llama? Con su propio token (respeta "activo" y el rol de perfiles).
    const cliente = createClient(URL_PROYECTO, ANON, {
      global: { headers: { Authorization: autorizacion } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: yo } = await cliente.auth.getUser(autorizacion.slice(7));
    const { data: perfil } = await cliente.rpc('mi_perfil');
    const fila = Array.isArray(perfil) ? perfil[0] : perfil;
    if (!yo?.user || !fila || fila.rol !== 'admin') return responder(403, { mensaje: 'No tenés permiso para hacer esto.' });
    adminId = yo.user.id;

    let cuerpo: Record<string, unknown>;
    try { cuerpo = await req.json(); } catch { return responder(400, { mensaje: 'Algo salió mal. Probá de nuevo.' }); }

    if (cuerpo.accion === 'crear') {
      const nombre = String(cuerpo.nombre ?? '').trim();
      const usuario = String(cuerpo.usuario ?? '').trim().toLowerCase();
      const rol = String(cuerpo.rol ?? '');
      if (nombre.length < 3) return responder(400, { mensaje: 'Escribí el nombre y apellido.' });
      if (!USUARIO.test(usuario)) return responder(400, { mensaje: 'El usuario tiene que tener de 3 a 30 letras o números, sin espacios.' });
      if (!ROLES.includes(rol)) return responder(400, { mensaje: 'Elegí el tipo de usuario.' });

      const clave = claveTemporal();
      const { data: creado, error } = await servicio.auth.admin.createUser({
        email: `${usuario}@${DOMINIO}`, password: clave, email_confirm: true,
      });
      if (error || !creado?.user) {
        const existe = /already|registered|exists/i.test(error?.message ?? '');
        if (!existe) await registrarError('createUser: ' + (error?.message ?? 'sin usuario'), { usuario });
        return responder(existe ? 409 : 400, { mensaje: existe ? 'Ese usuario ya existe. Elegí otro.' : 'No se pudo crear el usuario.' });
      }
      const { error: e2 } = await servicio.rpc('admin_registrar_usuario', {
        p_admin: adminId, p_user: creado.user.id, p_nombre: nombre, p_usuario: usuario,
        p_telefono: cuerpo.telefono ?? null, p_pueblo: cuerpo.pueblo ?? null, p_rol: rol,
      });
      if (e2) {
        await servicio.auth.admin.deleteUser(creado.user.id);   // no dejar usuarios a medias
        if (e2.code !== 'P0001') await registrarError('admin_registrar_usuario: ' + e2.message, { code: e2.code, usuario });
        return responder(400, { mensaje: e2.code === 'P0001' ? e2.message : 'No se pudo crear el usuario.' });
      }
      return responder(200, { usuario, clave });
    }

    if (cuerpo.accion === 'restablecer') {
      const id = String(cuerpo.user_id ?? '');
      const { data: p } = await servicio.from('perfiles').select('usuario').eq('user_id', id).maybeSingle();
      if (!p) return responder(404, { mensaje: 'No encontramos ese usuario.' });
      const clave = claveTemporal();
      const { error } = await servicio.auth.admin.updateUserById(id, { password: clave });
      if (error) {
        await registrarError('updateUserById: ' + error.message);
        return responder(400, { mensaje: 'No se pudo cambiar la contraseña.' });
      }
      const { error: e2 } = await servicio.rpc('admin_clave_temporal', { p_admin: adminId, p_user: id });
      if (e2) {
        await registrarError('admin_clave_temporal: ' + e2.message, { code: e2.code });
        return responder(400, { mensaje: 'No se pudo cambiar la contraseña.' });
      }
      return responder(200, { usuario: (p as { usuario: string }).usuario, clave });
    }

    return responder(400, { mensaje: 'Algo salió mal. Probá de nuevo.' });
  } catch (err) {
    await registrarError('Excepción: ' + String((err as Error)?.message ?? err), { stack: String((err as Error)?.stack ?? '').slice(0, 1500) });
    return responder(500, { mensaje: 'Algo salió mal. Probá de nuevo en un momento.' });
  }
});
