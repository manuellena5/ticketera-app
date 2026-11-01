// Edge Function admin_crear_usuario
// Crea usuarios (RRPP, puerta, caja, admin) y restablece contraseñas.
// - Verifica que quien llama sea admin activo (con SU token, vía mi_perfil).
// - Usa la service role SOLO acá, desde los secrets de la función. Nunca va al frontend.
// - La lógica de datos (perfil, habilitación en el evento, auditoría) está en SQL:
//   public.admin_registrar_usuario y public.admin_clave_temporal (solo service_role).
//
// Despliegue:
//   supabase functions deploy admin_crear_usuario
//   supabase secrets set AUTH_DOMAIN=usuarios.ticketera-app.com.ar ORIGENES_PERMITIDOS=https://<usuario>.github.io
// (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY ya los provee Supabase.)
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const URL_PROYECTO = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DOMINIO = Deno.env.get('AUTH_DOMAIN') ?? 'usuarios.ticketera-app.com.ar';
const ORIGENES = (Deno.env.get('ORIGENES_PERMITIDOS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const USUARIO = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const ROLES = ['admin', 'rrpp', 'puerta', 'caja'];

// Contraseña temporal legible (sin letras que se confunden).
function claveTemporal(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const r = crypto.getRandomValues(new Uint32Array(8));
  let s = '';
  for (let i = 0; i < 4; i++) s += letras[r[i] % letras.length];
  s += '-';
  for (let i = 4; i < 8; i++) s += numeros[r[i] % numeros.length];
  return s;   // ej. "kmtr-4829"
}

function cors(origen: string | null): Record<string, string> {
  const permitido = origen && (ORIGENES.length === 0 || ORIGENES.includes(origen)) ? origen : (ORIGENES[0] ?? '*');
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('Origin'));
  const responder = (status: number, cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...h, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return responder(405, { mensaje: 'No permitido.' });

  const autorizacion = req.headers.get('Authorization') ?? '';
  if (!autorizacion.startsWith('Bearer ')) return responder(401, { mensaje: 'Tenés que ingresar de nuevo.' });

  // 1) ¿Quién llama? (con su propio token: respeta RLS y "activo")
  const cliente = createClient(URL_PROYECTO, ANON, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: yo } = await cliente.auth.getUser();
  const { data: perfil } = await cliente.rpc('mi_perfil');
  const fila = Array.isArray(perfil) ? perfil[0] : perfil;
  if (!yo?.user || !fila || fila.rol !== 'admin') return responder(403, { mensaje: 'No tenés permiso para hacer esto.' });
  const adminId = yo.user.id;

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json(); } catch { return responder(400, { mensaje: 'Algo salió mal. Probá de nuevo.' }); }

  const servicio = createClient(URL_PROYECTO, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

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
      return responder(existe ? 409 : 400, { mensaje: existe ? 'Ese usuario ya existe. Elegí otro.' : 'No se pudo crear el usuario.' });
    }
    const { error: e2 } = await servicio.rpc('admin_registrar_usuario', {
      p_admin: adminId, p_user: creado.user.id, p_nombre: nombre, p_usuario: usuario,
      p_telefono: cuerpo.telefono ?? null, p_pueblo: cuerpo.pueblo ?? null, p_rol: rol,
    });
    if (e2) {
      await servicio.auth.admin.deleteUser(creado.user.id);   // no dejar usuarios a medias
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
    if (error) return responder(400, { mensaje: 'No se pudo cambiar la contraseña.' });
    const { error: e2 } = await servicio.rpc('admin_clave_temporal', { p_admin: adminId, p_user: id });
    if (e2) return responder(400, { mensaje: 'No se pudo cambiar la contraseña.' });
    return responder(200, { usuario: p.usuario, clave });
  }

  return responder(400, { mensaje: 'Algo salió mal. Probá de nuevo.' });
});
