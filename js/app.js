// App principal: ingreso, cambio de contraseña obligatorio y, según el rol,
// la app de RRPP, Puerta, Caja o Admin (cada una se registra en window.APPS).
(function () {
  'use strict';

  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const e = U.escaparHTML;
  const app = $('#app');
  const VERSION = '<span class="encabezado__version" id="version">· v' + e(self.APP_VERSION) + '</span>';

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW igual funciona online */ });
    });
  }

  // ---------- Conexión ----------
  function actualizarConexion() {
    $('#sin-conexion').hidden = navigator.onLine;
  }
  window.addEventListener('online', actualizarConexion);
  window.addEventListener('offline', actualizarConexion);
  actualizarConexion();

  // ---------- Pantallas comunes ----------
  // Encabezado simple con el nombre del club y la versión.
  function encabezadoClub() {
    return '<header class="encabezado"><h1 class="encabezado__titulo">Club Deportivo Mitre ' + VERSION + '</h1></header>';
  }

  function mostrar(html) {
    app.innerHTML = html;
    window.scrollTo(0, 0);
    const foco = app.querySelector('[autofocus]');
    if (foco) foco.focus();
  }

  function pantallaSinConfigurar() {
    mostrar(encabezadoClub() +
      '<main class="contenido pantalla">' +
      '<div class="marca"><img src="img/icono-192.png" alt=""></div>' +
      '<h2 class="centrado">Entradas</h2>' +
      '<div class="aviso aviso--alerta">La app todavía no está lista para usarse. Avisale a quien la administra.</div>' +
      '</main>');
  }

  function pantallaIngreso(mensaje) {
    mostrar(encabezadoClub() +
      '<main class="contenido pantalla">' +
      '<div class="marca"><img src="img/icono-192.png" alt=""></div>' +
      '<h2 class="centrado">Ingresar</h2>' +
      (mensaje ? '<div class="aviso aviso--error" role="alert">' + e(mensaje) + '</div>' : '') +
      '<form class="tarjeta" id="form-ingreso" novalidate>' +
      '  <label class="campo"><span class="campo__etiqueta">Usuario</span>' +
      '    <input class="entrada-texto" name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>' +
      '  <label class="campo"><span class="campo__etiqueta">Contraseña</span>' +
      '    <input class="entrada-texto" name="clave" type="password" autocomplete="current-password" required></label>' +
      '</form>' +
      '<button class="boton boton--principal boton--ancho boton--grande" type="submit" form="form-ingreso">Ingresar</button>' +
      '</main>');
    const form = $('#form-ingreso');
    const boton = app.querySelector('button[type="submit"]');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      U.conBoton(boton, async () => {
        const usuario = form.usuario.value.trim();
        const clave = form.clave.value;
        if (!usuario || !clave) return pantallaIngreso('Completá usuario y contraseña.');
        if (!navigator.onLine) return pantallaIngreso('Sin conexión. Para ingresar necesitás internet.');
        try {
          const { error } = await API.conSesion().auth.signInWithPassword({ email: API.emailDe(usuario), password: clave });
          if (error) throw error;
          await iniciar();
        } catch (err) {
          pantallaIngreso(U.mensajeDeError(err));
        }
      });
    });
  }

  // Primer ingreso: obliga a elegir una contraseña nueva (mínimo 8).
  function pantallaCambiarClave(perfil, mensaje) {
    mostrar(encabezadoClub() +
      '<main class="contenido pantalla">' +
      '<h2>Hola, ' + e(U.primerNombre(perfil.nombre)) + '</h2>' +
      '<p>Antes de empezar, elegí una contraseña tuya. Tiene que tener al menos 8 caracteres.</p>' +
      (mensaje ? '<div class="aviso aviso--error" role="alert">' + e(mensaje) + '</div>' : '') +
      '<form class="tarjeta" id="form-clave" novalidate>' +
      '  <input type="text" name="usuario" autocomplete="username" value="' + e(perfil.usuario) + '" hidden>' +
      '  <label class="campo"><span class="campo__etiqueta">Contraseña nueva</span>' +
      '    <input class="entrada-texto" name="clave" type="password" autocomplete="new-password" minlength="8" required autofocus></label>' +
      '  <label class="campo"><span class="campo__etiqueta">Repetila</span>' +
      '    <input class="entrada-texto" name="clave2" type="password" autocomplete="new-password" minlength="8" required></label>' +
      '</form>' +
      '<button class="boton boton--principal boton--ancho boton--grande" type="submit" form="form-clave">Guardar contraseña</button>' +
      '<button class="boton boton--texto boton--ancho" type="button" id="salir">Salir</button>' +
      '</main>');
    $('#salir').addEventListener('click', salir);
    const form = $('#form-clave');
    const boton = app.querySelector('button[type="submit"]');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      U.conBoton(boton, async () => {
        const clave = form.clave.value;
        if (clave.length < 8) return pantallaCambiarClave(perfil, 'La contraseña tiene que tener al menos 8 caracteres.');
        if (clave !== form.clave2.value) return pantallaCambiarClave(perfil, 'Las dos contraseñas no coinciden.');
        if (!navigator.onLine) return pantallaCambiarClave(perfil, 'Sin conexión. Para guardar la contraseña necesitás internet.');
        try {
          const { error } = await API.conSesion().auth.updateUser({ password: clave });
          if (error) throw error;
          U.avisar('Listo, ya tenés tu contraseña.');
          await iniciar();
        } catch (err) {
          pantallaCambiarClave(perfil, U.mensajeDeError(err));
        }
      });
    });
  }

  async function salir() {
    U.borrar('entradas-cache-');
    try { await API.conSesion().auth.signOut(); } catch (_) { /* igual se limpia */ }
    history.replaceState(null, '', location.pathname);
    pantallaIngreso();
  }

  // Si una RPC dice que la sesión ya no vale (usuario desactivado o vencida).
  async function sesionInvalida(err) {
    U.borrar('entradas-cache-');
    if (window.KV) window.KV.borrarTodo().catch(() => {});
    try { await API.conSesion().auth.signOut(); } catch (_) { /* nada */ }
    pantallaIngreso(err && err.message ? err.message : 'Tenés que ingresar de nuevo.');
  }

  function esSesionInvalida(err) {
    return !!err && (err.hint === 'usuario_inactivo' || err.hint === 'sin_sesion' ||
                     err.code === 'PGRST301' || err.code === '42501');
  }

  // Lo que cada app de rol recibe para no repetir código.
  const CTX = { mostrar, salir, sesionInvalida, esSesionInvalida, VERSION };

  // Cada fase monta su app según el rol.
  const APPS = {};
  window.APPS = APPS;

  function pantallaRol(perfil) {
    const montar = APPS[perfil.rol];
    if (montar) return montar(app, perfil, CTX);
    mostrar(encabezadoClub() +
      '<main class="contenido pantalla">' +
      '<h2>Hola, ' + e(U.primerNombre(perfil.nombre)) + '</h2>' +
      '<div class="tarjeta"><p>Tu pantalla todavía está en preparación.</p></div>' +
      '<button class="boton boton--ancho" type="button" id="salir">Salir</button>' +
      '</main>');
    $('#salir').addEventListener('click', salir);
  }

  async function iniciar() {
    if (!API.configurado()) return pantallaSinConfigurar();
    const { data } = await API.conSesion().auth.getSession();
    if (!data.session) return pantallaIngreso();
    let perfil = null;
    try {
      const filas = await API.rpc('mi_perfil');
      perfil = Array.isArray(filas) ? filas[0] : filas;
      if (perfil) U.guardar('entradas-cache-perfil', perfil);
    } catch (err) {
      if (esSesionInvalida(err)) return sesionInvalida(err);
      // Sin señal: se sigue con el último perfil guardado en este celular.
      if (U.esErrorDeRed(err)) perfil = U.leer('entradas-cache-perfil');
      if (!perfil) return pantallaIngreso(U.mensajeDeError(err));
    }
    if (!perfil) return salir();
    if (perfil.debe_cambiar_clave) return pantallaCambiarClave(perfil);
    pantallaRol(perfil);
  }

  window.addEventListener('DOMContentLoaded', iniciar);
})();
