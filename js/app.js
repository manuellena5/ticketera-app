// App principal: ingreso y, según el rol, RRPP, Puerta, Caja o Admin.
// Fase 0: estructura, versión, service worker, aviso de conexión e ingreso.
(function () {
  'use strict';

  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const app = $('#app');

  // ---------- Versión y service worker ----------
  $('#version').textContent = '· v' + self.APP_VERSION;

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

  // ---------- Pantallas ----------
  function mostrar(html) {
    app.innerHTML = '<section class="pantalla">' + html + '</section>';
    const foco = app.querySelector('[autofocus]');
    if (foco) foco.focus();
  }

  function pantallaSinConfigurar() {
    mostrar(
      '<div class="marca"><img src="img/icono-192.png" alt=""></div>' +
      '<h2 class="centrado">Entradas</h2>' +
      '<div class="aviso aviso--alerta">La app todavía no está lista para usarse. Avisale a quien la administra.</div>'
    );
  }

  function pantallaIngreso(mensaje) {
    mostrar(
      '<div class="marca"><img src="img/icono-192.png" alt=""></div>' +
      '<h2 class="centrado">Ingresar</h2>' +
      (mensaje ? '<div class="aviso aviso--error" role="alert">' + U.escaparHTML(mensaje) + '</div>' : '') +
      '<form class="tarjeta" id="form-ingreso" novalidate>' +
      '  <label class="campo"><span class="campo__etiqueta">Usuario</span>' +
      '    <input class="entrada-texto" name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>' +
      '  <label class="campo"><span class="campo__etiqueta">Contraseña</span>' +
      '    <input class="entrada-texto" name="clave" type="password" autocomplete="current-password" required></label>' +
      '</form>' +
      '<button class="boton boton--principal boton--ancho boton--grande" type="submit" form="form-ingreso">Ingresar</button>'
    );
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
        } catch (e) {
          pantallaIngreso(U.mensajeDeError(e));
        }
      });
    });
  }

  async function salir() {
    try { await API.conSesion().auth.signOut(); } catch (_) { /* igual se limpia */ }
    pantallaIngreso();
  }

  function botonSalir() {
    const acc = $('#acciones-encabezado');
    acc.innerHTML = '<button class="boton boton--texto" type="button" id="salir">Salir</button>';
    $('#salir').addEventListener('click', salir);
  }

  // Lugar donde cada fase monta su app según el rol.
  const APPS = {};
  window.APPS = APPS;

  function pantallaRol(perfil) {
    botonSalir();
    const montar = APPS[perfil.rol];
    if (montar) return montar(app, perfil);
    mostrar(
      '<h2>Hola, ' + U.escaparHTML(perfil.nombre.split(' ')[0]) + '</h2>' +
      '<div class="tarjeta"><p>Tu pantalla todavía está en preparación.</p></div>'
    );
  }

  async function iniciar() {
    if (!API.configurado()) return pantallaSinConfigurar();
    const { data } = await API.conSesion().auth.getSession();
    if (!data.session) { $('#acciones-encabezado').innerHTML = ''; return pantallaIngreso(); }
    try {
      const filas = await API.rpc('mi_perfil');
      const perfil = Array.isArray(filas) ? filas[0] : filas;
      if (!perfil) return salir();
      pantallaRol(perfil);
    } catch (e) {
      if (e && (e.hint === 'usuario_inactivo' || e.hint === 'sin_sesion')) {
        try { await API.conSesion().auth.signOut(); } catch (_) {}
        return pantallaIngreso(e.message);
      }
      pantallaIngreso(U.mensajeDeError(e));
    }
  }

  iniciar();
})();
