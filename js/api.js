// Acceso a Supabase. El cliente usa SOLO la anon key; las reglas (precio,
// comisión, límites, tope, rol) las decide la base con RLS y RPC.
(function () {
  'use strict';

  let cliente = null;
  let clientePublico = null;

  function configurado() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CONFIG.SUPABASE_URL) &&
           CONFIG.SUPABASE_ANON_KEY && !/^TU-/.test(CONFIG.SUPABASE_ANON_KEY);
  }

  // Cliente con sesión (RRPP, puerta, caja, admin). La sesión queda guardada.
  function conSesion() {
    if (!cliente) {
      cliente = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
                storageKey: 'entradas-sesion' },
      });
    }
    return cliente;
  }

  // Cliente de la página pública: nunca usa la sesión de nadie.
  function publico() {
    if (!clientePublico) {
      clientePublico = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
                storageKey: 'entradas-publico' },
      });
    }
    return clientePublico;
  }

  // Llama a una RPC y devuelve data o tira el error tal cual (lo traduce U.mensajeDeError).
  async function rpc(nombre, args, { anonimo = false } = {}) {
    const c = anonimo ? publico() : conSesion();
    let consulta = c.rpc(nombre, args || {});
    // Sin reintentos automáticos: sin señal se avisa al instante, y los
    // reintentos de una venta los maneja la app con la misma clave.
    if (typeof consulta.retry === 'function') consulta = consulta.retry(false);
    const { data, error } = await consulta;
    if (error) {
      // Los mensajes propios de las reglas (P0001) no son errores técnicos; tampoco
      // una sesión vencida o la falta de señal. El resto se registra.
      const esRegla = error.code === 'P0001';
      const sinSenal = !navigator.onLine;
      const sesion = error.code === 'PGRST301' || /JWT/i.test(error.message || '');
      if (!esRegla && !sinSenal && !sesion && window.LOG) LOG.error('rpc', error, { funcion: nombre });
      throw error;
    }
    return data;
  }

  function emailDe(usuario) {
    return String(usuario || '').trim().toLowerCase() + '@' + CONFIG.AUTH_DOMAIN;
  }

  window.API = Object.freeze({ configurado, conSesion, publico, rpc, emailDe });
})();
