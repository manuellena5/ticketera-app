// Página pública del comprador. No usa la sesión de nadie: llama solo a
// evento_del_link / ver_entradas / pasar_entrada / ver_entrada_pasada con
// la anon key. El token viaja en el fragmento (#t=… del titular, #e=… de una
// entrada pasada), que no llega a ningún servidor ni queda en logs.
(function () {
  'use strict';

  const e = U.escaparHTML;
  const app = document.getElementById('app');
  const CLAVE_DNI = 'entradas-comprador-dni';
  const CONSEJO = 'Guardá la imagen. En la puerta puede no haber señal. El QR es único y se habilita el día del evento.';
  const SIN_SENAL = 'Sin conexión. Para ver tus entradas necesitás internet. Si ya guardaste la imagen, usá esa.';

  const ICONO_CANDADO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  const ICONO_INFO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>';
  const ICONO_BAJAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
  const ICONO_PASAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h12M12 6l6 6-6 6"/></svg>';
  const ICONO_WA = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.6-5.5A8.4 8.4 0 1 1 21 11.5z"/></svg>';

  const st = { modo: null, token: null, evento: null, datos: null, abiertas: new Set(), dni: null };

  // Service worker: la página abre aunque en la puerta no haya señal.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  // ---------------- Conexión ----------------
  function actualizarConexion() { document.getElementById('sin-conexion').hidden = navigator.onLine; }
  window.addEventListener('online', actualizarConexion);
  window.addEventListener('offline', actualizarConexion);
  actualizarConexion();

  // El DNI se recuerda solo en esta pestaña y para este link (no se reusa en otro).
  const claveDni = () => CLAVE_DNI + '-' + (st.token || '').slice(0, 10);
  function leerDni() { try { return sessionStorage.getItem(claveDni()); } catch (_) { return null; } }
  function guardarDni(v) { try { if (v) sessionStorage.setItem(claveDni(), v); else sessionStorage.removeItem(claveDni()); } catch (_) { /* nada */ } }

  function render(html) {
    app.innerHTML = html;
    const foco = app.querySelector('[autofocus]');
    if (foco) foco.focus();
  }
  const $ = (s) => app.querySelector(s);
  const $$ = (s) => [...app.querySelectorAll(s)];

  async function rpc(nombre, args) {
    return API.rpc(nombre, args, { anonimo: true });
  }

  // ---------------- Encabezados ----------------
  function heroEvento() {
    const ev = st.evento;
    const presenta = ((ev && ev.club) || CONFIG.NOMBRE_CLUB) + ' presenta';
    return '<header class="hero oscura">' +
      '<div class="hero__fila"><p class="hero__presenta">' + e(presenta) + '</p>' +
      '<span class="encabezado__version" id="version">· v' + e(self.APP_VERSION) + '</span></div>' +
      (ev ? '<h1 class="hero__titulo">' + e(ev.artista || ev.nombre) + '</h1>' +
            '<p class="hero__dato">' + e(U.fechaLarga(ev.fecha)) + '</p>' +
            (ev.lugar ? '<p class="hero__dato">' + e(ev.lugar) + '</p>' : '')
          : '<h1 class="hero__titulo">Tus entradas</h1>') +
      '</header>';
  }

  function encabezadoTitular() {
    const ev = st.evento || {};
    const d = st.datos;
    const linea = [ev.artista || ev.nombre, ev.fecha ? U.diaCorto(ev.fecha) : null, ev.lugar].filter(Boolean).join(' · ');
    return '<header class="hero hero--compacto oscura">' +
      '<div class="hero__fila"><p class="hero__dato">' + e(linea) + '</p>' +
      '<span class="encabezado__version" id="version">· v' + e(self.APP_VERSION) + '</span></div>' +
      '<h1 class="hero__nombre">' + e(d.titular) + '</h1>' +
      '<p class="hero__dato">' + e(U.plural(d.cantidad, 'entrada', 'entradas')) + (d.tanda ? ' · ' + e(d.tanda) : '') + '</p>' +
      '</header>';
  }

  function nota(texto, destacada) {
    return '<div class="nota' + (destacada ? ' nota--destacada' : '') + '">' + (destacada ? ICONO_INFO : ICONO_CANDADO) +
      '<p>' + e(texto) + '</p></div>';
  }

  function pantallaAviso(texto) {
    render(heroEvento() + '<main class="contenido pantalla"><div class="aviso aviso--alerta">' + e(texto) + '</div></main>');
  }

  // ---------------- DNI ----------------
  function pantallaDni(mensaje) {
    render(heroEvento() +
      '<main class="contenido pantalla">' +
      '<div><h2>Tus entradas</h2><p class="suave">Ingresá tu DNI para verlas.</p></div>' +
      (mensaje ? '<div class="aviso aviso--error" role="alert" id="error">' + e(mensaje) + '</div>' : '') +
      '<form id="form-dni" novalidate>' +
      '<label class="campo"><span class="campo__etiqueta">DNI</span>' +
      '<input class="entrada-texto entrada-texto--grande" name="dni" inputmode="numeric" autocomplete="off" placeholder="Sin puntos" maxlength="10" autofocus></label>' +
      '</form>' +
      '<button class="boton boton--principal boton--ancho boton--grande" type="submit" form="form-dni" id="ver">Ver mis entradas</button>' +
      nota('Pedimos tu DNI para que nadie más pueda usar tus entradas, aunque le reenvíen este link.') +
      '</main>');
    const form = $('#form-dni');
    form.dni.addEventListener('input', () => { form.dni.value = U.soloDigitos(form.dni.value).slice(0, 8); });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const dni = U.soloDigitos(form.dni.value);
      U.conBoton($('#ver'), async () => {
        if (!U.dniValido(dni)) return pantallaDni('Revisá el DNI: tiene que tener 7 u 8 números.');
        await abrir(dni);
      });
    });
  }

  async function abrir(dni) {
    if (!navigator.onLine) return pantallaDni(SIN_SENAL);
    let r;
    try {
      r = await rpc('ver_entradas', { p_token: st.token, p_dni: dni });
    } catch (err) {
      return pantallaDni(U.esErrorDeRed(err) ? SIN_SENAL : U.mensajeDeError(err));
    }
    if (!r || !r.ok) {
      guardarDni(null);
      if (r && r.motivo === 'link') return pantallaAviso(r.mensaje);
      return pantallaDni(r ? r.mensaje : U.mensajeDeError());
    }
    st.dni = dni;
    guardarDni(dni);
    st.datos = r;
    if (r.evento) st.evento = r.evento;
    pantallaEntradas();
  }

  // ---------------- Entradas del titular ----------------
  function tarjetaEntrada(x, total) {
    const anulada = st.datos.estado === 'anulada' || x.estado === 'anulada';
    const titulo = 'Entrada ' + x.nro + ' de ' + total;
    if (anulada) {
      return '<section class="tarjeta entrada">' +
        '<div class="entrada__cabeza"><h3>' + titulo + '</h3><span class="chip chip--error">Anulada</span></div>' +
        '<p>Esta entrada fue anulada. Consultá con quien te la vendió.</p></section>';
    }
    if (x.ingreso) {
      return '<section class="tarjeta entrada">' +
        '<div class="entrada__cabeza"><h3>' + titulo + '</h3><span class="chip chip--neutro">Ya ingresó</span></div>' +
        '<p>Ya ingresó a las ' + U.hora(x.ingreso) + '.' + (x.pasada_a ? ' (Pasada a ' + e(x.pasada_a) + ')' : '') + '</p></section>';
    }
    const pasadaA = x.pasada ? (x.pasada_a ? 'Pasada a ' + x.pasada_a : 'Pasada a otra persona') : null;
    if (x.pasada && !st.abiertas.has(x.nro)) {
      return '<section class="tarjeta entrada entrada--cerrada">' +
        '<div><h3>' + titulo + '</h3><p class="texto-ok">' + e(pasadaA) + '</p></div>' +
        '<button class="boton boton--texto" type="button" data-ver="' + x.nro + '">Ver QR</button></section>';
    }
    return '<section class="tarjeta entrada">' +
      '<div class="entrada__cabeza"><h3>' + titulo + '</h3><span class="chip chip--ok">Válida</span></div>' +
      (pasadaA ? '<p class="texto-ok">' + e(pasadaA) + '</p>' : '') +
      '<div class="qr-caja" data-qr="' + x.nro + '"></div>' +
      '<button class="boton boton--principal boton--ancho" type="button" data-guardar="' + x.nro + '">' + ICONO_BAJAR + ' Guardar imagen</button>' +
      '<button class="boton boton--borde-ok boton--ancho" type="button" data-pasar="' + x.nro + '">' + ICONO_PASAR + (x.pasada ? ' Volver a pasar' : ' Pasar a otra persona') + '</button>' +
      '</section>';
  }

  function pantallaEntradas() {
    const d = st.datos;
    render(encabezadoTitular() +
      '<main class="contenido pantalla">' +
      (d.estado === 'anulada' ? '<div class="aviso aviso--error">Esta entrada fue anulada. Consultá con quien te la vendió.</div>' : '') +
      d.entradas.map((x) => tarjetaEntrada(x, d.cantidad)).join('') +
      nota(CONSEJO, true) +
      '</main>');
    d.entradas.forEach((x) => {
      const caja = $('[data-qr="' + x.nro + '"]');
      if (caja && x.codigo) caja.appendChild(QR.canvas(x.codigo, 250, 'Código QR de la entrada ' + x.nro));
    });
    $$('[data-ver]').forEach((b) => b.addEventListener('click', () => { st.abiertas.add(Number(b.dataset.ver)); pantallaEntradas(); }));
    $$('[data-guardar]').forEach((b) => b.addEventListener('click', () => {
      const x = d.entradas.find((y) => y.nro === Number(b.dataset.guardar));
      U.conBoton(b, () => guardarImagen(x.codigo, x.nro, d.cantidad, x.pasada_a ? 'Para ' + x.pasada_a : d.titular, d.tanda));
    }));
    $$('[data-pasar]').forEach((b) => b.addEventListener('click', () => {
      history.pushState({ pasar: Number(b.dataset.pasar) }, '');
      pantallaPasar(Number(b.dataset.pasar));
    }));
  }

  async function guardarImagen(codigo, nro, total, nombre, tanda) {
    const ev = st.evento || {};
    const blob = await QR.imagenEntrada({
      codigo,
      presenta: ((ev.club || CONFIG.NOMBRE_CLUB) + ' presenta'),
      titulo: ev.artista || ev.nombre || 'Entrada',
      fecha: ev.fecha ? U.fechaLarga(ev.fecha) : '',
      lugar: ev.lugar || '',
      linea1: 'Entrada ' + nro + ' de ' + total,
      linea2: [nombre, tanda].filter(Boolean).join(' · '),
    });
    const base = String(ev.artista || ev.nombre || 'entrada').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await QR.descargar(blob, 'entrada-' + base + '-' + nro + '.png');
    U.avisar('Imagen guardada.');
  }

  // ---------------- Pasar a otra persona ----------------
  function mensajePase(para, link) {
    const ev = st.evento || {};
    const de = U.primerNombre(st.datos.titular);
    const cuando = ev.fecha ? ', ' + U.diaEvento(ev.fecha) + ' a las ' + U.hora(ev.fecha) + ' hs' : '';
    return '¡Hola' + (para ? ' ' + para : '') + '! ' + de + ' te pasó una entrada para *' + (ev.artista || ev.nombre || 'el evento') + '*' + cuando + '.\n' +
      link + '\n' +
      'Guardá la imagen del QR antes de ir.';
  }

  function pantallaPasar(nro, mensaje) {
    const x = st.datos.entradas.find((y) => y.nro === nro);
    if (!x) return pantallaEntradas();
    render(encabezadoTitular() +
      '<main class="contenido pantalla">' +
      '<section class="tarjeta pasar">' +
      '<div><h2>Pasar la entrada ' + nro + '</h2>' +
      '<p class="suave">Le llega un link solo con esta entrada. Tu link sigue siendo tuyo.</p></div>' +
      (mensaje ? '<div class="aviso aviso--error" role="alert" id="error">' + e(mensaje) + '</div>' : '') +
      '<label class="campo"><span class="campo__etiqueta">¿Para quién es? (opcional)</span>' +
      '<input class="entrada-texto" id="para" maxlength="40" autocomplete="off" autocapitalize="words" value="' + e(x.pasada_a || '') + '" autofocus></label>' +
      '<div><p class="tarjeta__etiqueta">Así le llega</p><div class="burbuja" id="vista"></div></div>' +
      '<button class="boton boton--whatsapp boton--ancho boton--grande" type="button" id="enviar">' + ICONO_WA + ' Enviar por WhatsApp</button>' +
      '<button class="boton boton--texto boton--ancho" type="button" id="cancelar">Cancelar</button>' +
      '</section>' +
      nota('Cada QR entra una sola vez. Si la volvés a pasar, el link anterior deja de funcionar.') +
      '</main>');
    const para = $('#para');
    const vista = () => { $('#vista').textContent = mensajePase(para.value.trim(), '[link de tu entrada]'); };
    para.addEventListener('input', vista);
    vista();
    $('#cancelar').addEventListener('click', () => history.back());
    $('#enviar').addEventListener('click', (ev) => U.conBoton(ev.currentTarget, () => pasar(nro, para.value.trim())));
  }

  async function pasar(nro, para) {
    if (!navigator.onLine) return pantallaPasar(nro, 'Sin conexión. Para pasar la entrada necesitás internet.');
    // Se abre la ventana ANTES de esperar al servidor para que el celular no la bloquee.
    const ventana = window.open('', '_blank');
    let r;
    try {
      r = await rpc('pasar_entrada', { p_token: st.token, p_dni: st.dni, p_nro: nro, p_nombre: para || null });
    } catch (err) {
      if (ventana) ventana.close();
      return pantallaPasar(nro, U.esErrorDeRed(err) ? 'Sin conexión. Para pasar la entrada necesitás internet.' : U.mensajeDeError(err));
    }
    if (!r || !r.ok) {
      if (ventana) ventana.close();
      if (r && (r.motivo === 'dni' || r.motivo === 'bloqueado')) { guardarDni(null); return pantallaDni(r.mensaje); }
      return pantallaPasar(nro, r ? r.mensaje : U.mensajeDeError());
    }
    const link = new URL('entrada.html#e=' + r.token, location.href).href;
    const url = 'https://wa.me/?text=' + encodeURIComponent(mensajePase(r.nombre || '', link));
    if (ventana) ventana.location.href = url; else location.href = url;
    // Refresca la lista ("Pasada a Laura")
    try {
      const d = await rpc('ver_entradas', { p_token: st.token, p_dni: st.dni });
      if (d && d.ok) st.datos = d;
    } catch (_) { /* se ve al recargar */ }
    st.abiertas.delete(nro);
    history.back();
    U.avisar('Listo. Si te equivocaste, la podés volver a pasar.');
  }

  // ---------------- Link individual (quien recibe) ----------------
  async function abrirPasada() {
    if (!navigator.onLine) return pantallaAviso(SIN_SENAL);
    let r;
    try {
      r = await rpc('ver_entrada_pasada', { p_token: st.token });
    } catch (err) {
      return pantallaAviso(U.esErrorDeRed(err) ? SIN_SENAL : U.mensajeDeError(err));
    }
    if (!r || !r.ok) return pantallaAviso(r ? r.mensaje : U.mensajeDeError());
    if (r.evento) st.evento = r.evento;
    const anulada = r.estado === 'anulada';
    let cuerpo;
    if (anulada) {
      cuerpo = '<div class="aviso aviso--error">Esta entrada fue anulada. Consultá con quien te la pasó.</div>';
    } else if (r.ingreso) {
      cuerpo = '<section class="tarjeta entrada"><div class="entrada__cabeza"><h3>Tu entrada</h3><span class="chip chip--neutro">Ya ingresó</span></div>' +
        '<p>Ya ingresó a las ' + U.hora(r.ingreso) + '.</p></section>';
    } else {
      cuerpo = '<section class="tarjeta entrada">' +
        '<div class="centrado"><h2>' + (r.para ? 'Tu entrada, ' + e(r.para) : 'Tu entrada') + '</h2>' +
        '<p class="suave">Te la pasó ' + e(r.de) + (r.tanda ? ' · ' + e(r.tanda) : '') + '</p></div>' +
        '<div class="qr-caja" id="qr"></div>' +
        '<button class="boton boton--principal boton--ancho" type="button" id="guardar">' + ICONO_BAJAR + ' Guardar imagen</button>' +
        '</section>';
    }
    render(heroEvento() + '<main class="contenido pantalla">' + cuerpo +
      nota('Guardá la imagen y mostrala en la puerta. El QR es único y se habilita el día del evento.', true) +
      '</main>');
    if (!anulada && !r.ingreso) {
      $('#qr').appendChild(QR.canvas(r.codigo, 250, 'Código QR de tu entrada'));
      $('#guardar').addEventListener('click', (ev) => U.conBoton(ev.currentTarget, () =>
        guardarImagen(r.codigo, r.nro, r.cantidad, r.para ? 'Para ' + r.para : '', r.tanda)));
    }
  }

  // ---------------- Arranque ----------------
  async function iniciar() {
    const frag = new URLSearchParams(location.hash.slice(1));
    st.modo = frag.has('t') ? 't' : frag.has('e') ? 'e' : null;
    st.token = (frag.get(st.modo) || '').trim().toUpperCase();
    st.datos = null; st.abiertas = new Set();
    if (!st.modo || !/^[A-Z2-7]{26}$/.test(st.token)) {
      return pantallaAviso('Este link no está completo. Pedile a quien te vendió la entrada que te lo vuelva a mandar.');
    }
    if (!API.configurado()) return pantallaAviso('La página todavía no está lista. Avisale a quien te vendió la entrada.');
    render(heroEvento() + '<main class="contenido"><p class="suave centrado">Cargando…</p></main>');

    if (st.modo === 'e') return abrirPasada();
    try { st.evento = await rpc('evento_del_link', { p_token: st.token }); } catch (_) { /* el encabezado es opcional */ }
    const dni = leerDni();
    if (dni) return abrir(dni);
    pantallaDni();
  }

  window.addEventListener('popstate', (ev) => {
    if (st.datos && ev.state && ev.state.pasar) return pantallaPasar(ev.state.pasar);
    if (st.datos) return pantallaEntradas();
  });
  window.addEventListener('hashchange', iniciar);
  window.addEventListener('DOMContentLoaded', iniciar);
})();
