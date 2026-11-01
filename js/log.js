// Registro de errores técnicos. La persona sigue viendo mensajes simples;
// el detalle técnico se guarda en la base (errores_tecnicos) para que el
// admin lo vea en el panel. Nunca se manda el fragmento de la URL (donde
// viaja el token) ni códigos de entrada; la base vuelve a limpiar.
(function () {
  'use strict';

  const COLA = 'entradas-errores-pendientes';
  const MAX_POR_SESION = 30;
  const esComprador = /entrada\.html$/.test(location.pathname);
  let enviados = 0;
  const recientes = new Map();   // mensaje → momento (evita repetir el mismo en ráfaga)

  function limpiar(texto, max) {
    return String(texto == null ? '' : texto)
      .replace(/#[^\s"']*/g, '#…')
      .replace(/\b[A-Z2-7]{26}\b/g, '[código]')
      .replace(/\b\d{7,8}\b/g, '[número]')
      .slice(0, max || 500);
  }

  function pantallaActual() {
    const h = document.querySelector('h1, h2');
    return limpiar((esComprador ? 'comprador · ' : '') + (location.hash.startsWith('#') && !esComprador ? location.hash.slice(1) + ' · ' : '') + (h ? h.textContent.trim() : ''), 80);
  }

  function armar(origen, err, extra) {
    const e = err || {};
    return {
      origen: origen || 'app',
      pantalla: pantallaActual(),
      mensaje: limpiar(e.message || e.msg || (typeof e === 'string' ? e : JSON.stringify(e)), 500),
      detalle: Object.assign({
        nombre: e.name || null, codigo: e.code || null, hint: e.hint || null, estado: e.status || null,
        stack: limpiar(e.stack || '', 1500), conectado: navigator.onLine,
      }, extra || {}),
      version: self.APP_VERSION,
      navegador: limpiar(navigator.userAgent, 300),
      pagina: limpiar(location.origin + location.pathname, 300),
    };
  }

  function leerCola() { try { return JSON.parse(localStorage.getItem(COLA) || '[]'); } catch (_) { return []; } }
  function guardarCola(c) { try { localStorage.setItem(COLA, JSON.stringify(c.slice(-20))); } catch (_) { /* nada */ } }

  async function mandar(datos) {
    if (!window.API || !API.configurado()) return false;
    try {
      const cliente = esComprador ? API.publico() : API.conSesion();
      let consulta = cliente.rpc('registrar_error', { p_datos: datos });
      if (typeof consulta.retry === 'function') consulta = consulta.retry(false);
      const { error } = await consulta;
      return !error;
    } catch (_) {
      return false;
    }
  }

  let vaciando = false;
  async function vaciarCola() {
    if (vaciando) return;   // un solo envío a la vez (si no, se mandarían duplicados)
    const cola = leerCola();
    if (!cola.length || !navigator.onLine) return;
    vaciando = true;
    guardarCola([]);
    const quedan = [];
    try {
      for (const d of cola) { if (!(await mandar(d))) quedan.push(d); }
    } finally {
      if (quedan.length) guardarCola(leerCola().concat(quedan));
      vaciando = false;
    }
  }

  // Registra un error técnico. No tira nunca.
  async function error(origen, err, extra) {
    try {
      if (enviados >= MAX_POR_SESION) return;
      const datos = armar(origen, err, extra);
      const clave = datos.origen + '|' + datos.mensaje;
      const ahora = Date.now();
      if (recientes.has(clave) && ahora - recientes.get(clave) < 10000) return;
      recientes.set(clave, ahora);
      enviados++;
      if (!navigator.onLine || !(await mandar(datos))) {
        const cola = leerCola(); cola.push(datos); guardarCola(cola);
      } else {
        vaciarCola();
      }
    } catch (_) { /* registrar un error nunca rompe la app */ }
  }

  window.addEventListener('error', (ev) => {
    if (!ev || !ev.message) return;   // errores de carga de recursos: los ve el service worker
    error('js', { message: ev.message, name: 'Error', stack: ev.error && ev.error.stack }, { archivo: limpiar(ev.filename, 200), linea: ev.lineno, columna: ev.colno });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev && ev.reason;
    if (r && r.silencioso) return;
    error('js', r instanceof Error ? r : { message: String(r && (r.message || r)) }, { tipo: 'promesa sin manejar' });
  });
  window.addEventListener('online', vaciarCola);
  setTimeout(vaciarCola, 5000);

  window.LOG = Object.freeze({ error, vaciarCola });
})();
