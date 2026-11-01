// Utilidades de presentación. Todo lo que ve la persona pasa por acá:
// montos, plurales, fechas y mensajes de error sin jerga.
(function () {
  'use strict';

  const TZ = 'America/Argentina/Buenos_Aires';

  // "1 entrada" / "3 entradas"
  function plural(n, sing, plur) {
    return miles(n) + ' ' + (Number(n) === 1 ? sing : plur);
  }

  // 20000 → "20.000"
  function miles(n) {
    const v = Math.round(Number(n) || 0);
    const signo = v < 0 ? '-' : '';
    return signo + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // 20000 → "$20.000"
  function pesos(n) {
    const v = Math.round(Number(n) || 0);
    return (v < 0 ? '-$' : '$') + miles(Math.abs(v));
  }

  function partes(fecha) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    const f = new Intl.DateTimeFormat('es-AR', {
      timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
    }).formatToParts(d);
    const o = {};
    for (const p of f) o[p.type] = p.value;
    return o;
  }

  // "30/11"
  function diaMes(fecha) { const p = partes(fecha); return p.day + '/' + p.month; }
  // "23:14"
  function hora(fecha) { const p = partes(fecha); return p.hour + ':' + p.minute; }
  // "18/12/2026"
  function fechaCorta(fecha) { const p = partes(fecha); return p.day + '/' + p.month + '/' + p.year; }
  // "viernes 18/12 · 23:59 hs"
  function fechaEvento(fecha) {
    const p = partes(fecha);
    return p.weekday + ' ' + p.day + '/' + p.month + ' · ' + p.hour + ':' + p.minute + ' hs';
  }

  // Solo dígitos del DNI ("30.111.222" → "30111222")
  function soloDigitos(s) { return String(s || '').replace(/\D+/g, ''); }
  function dniValido(s) { return /^\d{7,8}$/.test(soloDigitos(s)); }

  function escaparHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Mensaje para la persona a partir de un error de la base o de la red.
  // Las RPC mandan el texto listo en "message" y un código corto en "hint".
  // Nunca se muestra nada técnico.
  const MENSAJES_RED = 'Sin conexión. Revisá tu internet y probá de nuevo.';
  const MENSAJE_GENERICO = 'Algo salió mal. Probá de nuevo en un momento.';
  function mensajeDeError(err) {
    if (!navigator.onLine) return MENSAJES_RED;
    if (!err) return MENSAJE_GENERICO;
    if (err.code === 'P0001' && err.message) return err.message;   // mensaje propio de la RPC
    const txt = String(err.message || err);
    if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(txt)) return MENSAJES_RED;
    if (/Invalid login credentials/i.test(txt)) return 'Usuario o contraseña incorrectos.';
    if (/JWT|session|token/i.test(txt)) return 'Tenés que ingresar de nuevo.';
    return MENSAJE_GENERICO;
  }

  // Botón anti doble envío: se deshabilita ANTES del await y se libera en finally.
  async function conBoton(boton, fn) {
    if (boton.disabled) return;
    boton.disabled = true;
    boton.setAttribute('aria-busy', 'true');
    try { return await fn(); }
    finally { boton.disabled = false; boton.removeAttribute('aria-busy'); }
  }

  window.U = Object.freeze({
    plural, miles, pesos, diaMes, hora, fechaCorta, fechaEvento,
    soloDigitos, dniValido, escaparHTML, mensajeDeError, conBoton,
  });
})();
