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
    if (/should be different/i.test(txt)) return 'Elegí una contraseña distinta a la que te pasaron.';
    if (/Password should be|weak|at least/i.test(txt)) return 'La contraseña tiene que tener al menos 8 caracteres.';
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

  // WhatsApp de Argentina para wa.me: "3401 551234", "03401 15 551234",
  // "+54 9 3401 551234" → "5493401551234". '' si está vacío, null si no sirve.
  function telWhatsApp(s) {
    let d = soloDigitos(s);
    if (!d) return '';
    if (d.length === 13 && d.startsWith('549')) return d;
    if (d.length === 12 && d.startsWith('54')) return '549' + d.slice(2);
    d = d.replace(/^0/, '');
    if (d.length === 12) {
      for (const largo of [4, 3, 2]) {          // código de área de 4, 3 o 2 cifras + "15"
        if (d.substr(largo, 2) === '15') { d = d.slice(0, largo) + d.slice(largo + 2); break; }
      }
    }
    return d.length === 10 ? '549' + d : null;
  }

  // "viernes 18/12"
  function diaEvento(fecha) {
    const p = partes(fecha);
    return p.weekday + ' ' + p.day + '/' + p.month;
  }
  // "Vie 18/12"
  function diaCorto(fecha) {
    const p = partes(fecha);
    return p.weekday.charAt(0).toUpperCase() + p.weekday.slice(1, 3) + ' ' + p.day + '/' + p.month;
  }

  // "Viernes 18 de diciembre · 23:59 hs"
  function fechaLarga(fecha) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    const p = partes(d);
    const mes = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, month: 'long' }).format(d);
    return p.weekday.charAt(0).toUpperCase() + p.weekday.slice(1) + ' ' + Number(p.day) + ' de ' + mes +
      ' · ' + p.hour + ':' + p.minute + ' hs';
  }

  function primerNombre(nombre) { return String(nombre || '').trim().split(/\s+/)[0] || ''; }

  function nuevaClave() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  let toastTimer = null;
  function avisar(texto) {
    let t = document.getElementById('aviso-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'aviso-toast'; t.className = 'aviso-toast'; t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = texto; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  async function copiar(texto, aviso) {
    try {
      if (!navigator.clipboard) throw new Error('sin portapapeles');
      // Algunos navegadores dejan la promesa esperando un permiso que nunca
      // llega: a los 1,5 s se usa el método alternativo igual.
      await Promise.race([
        navigator.clipboard.writeText(texto),
        new Promise((_, ko) => setTimeout(() => ko(new Error('portapapeles sin respuesta')), 1500)),
      ]);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = texto; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) { /* nada */ }
      ta.remove();
    }
    avisar(aviso || 'Copiado.');
  }

  // Diálogo de confirmación propio (sin window.confirm). Devuelve true/false.
  function confirmar(texto, si, no) {
    return new Promise((resolver) => {
      const d = document.createElement('dialog');
      d.className = 'dialogo';
      d.innerHTML = '<p></p><button class="boton boton--principal boton--ancho" value="si"></button>' +
                    '<button class="boton boton--ancho" value="no"></button>';
      d.querySelector('p').textContent = texto;
      d.querySelector('[value=si]').textContent = si || 'Sí';
      d.querySelector('[value=no]').textContent = no || 'Cancelar';
      d.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b) { d.close(b.value); }
      });
      d.addEventListener('close', () => { resolver(d.returnValue === 'si'); d.remove(); });
      document.body.appendChild(d);
      d.showModal();
    });
  }

  function guardar(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (_) { /* sin almacenamiento */ }
  }
  function leer(clave) {
    try { return JSON.parse(localStorage.getItem(clave) || 'null'); } catch (_) { return null; }
  }
  function borrar(prefijo) {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(prefijo)).forEach((k) => localStorage.removeItem(k));
    } catch (_) { /* nada */ }
  }

  function esErrorDeRed(err) {
    if (!navigator.onLine) return true;
    const txt = String((err && err.message) || err || '');
    return /fetch|network|Failed to fetch|NetworkError|Load failed/i.test(txt);
  }

  window.U = Object.freeze({
    plural, miles, pesos, diaMes, hora, fechaCorta, fechaEvento, diaEvento, diaCorto, fechaLarga,
    soloDigitos, dniValido, escaparHTML, mensajeDeError, conBoton, telWhatsApp, primerNombre,
    nuevaClave, avisar, copiar, confirmar, guardar, leer, borrar, esErrorDeRed,
  });
})();
