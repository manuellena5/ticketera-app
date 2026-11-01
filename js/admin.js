// Panel de administración (rol "admin"). Escritorio o celular.
// Secciones: Tablero, Ventas, RRPP, Transferencias, Rendición, Evento y
// tandas, Auditoría y Exportar (con el cierre del evento).
// Todas las reglas las aplica la base: acá solo se muestran y se piden.
(function () {
  'use strict';

  const e = U.escaparHTML;
  const SECCIONES = [
    ['tablero', 'Tablero'], ['ventas', 'Ventas'], ['rrpp', 'RRPP'], ['transferencias', 'Transferencias'],
    ['rendicion', 'Rendición'], ['evento', 'Evento y tandas'], ['auditoria', 'Auditoría'], ['exportar', 'Exportar'],
  ];
  const MEDIO = { efectivo: 'Efectivo', transferencia: 'Transferencia', cortesia: 'Cortesía' };
  const CANAL = { rrpp: 'RRPP', caja: 'Puerta', cortesia: 'Cortesía', papel: 'Papel' };
  const ROL = { admin: 'Administración', rrpp: 'RRPP', puerta: 'Escáner de puerta', caja: 'Caja de puerta' };
  const ESTADO_TANDA = { vigente: ['Vigente', 'ok'], agotada: ['Agotada', 'neutro'], terminada: ['Terminada', 'neutro'], proxima: ['Próxima', 'pendiente'] };
  const ICONO_WA = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.6-5.5A8.4 8.4 0 1 1 21 11.5z"/></svg>';

  // ---------------- Utilidades del panel ----------------
  const TZ = 'America/Argentina/Buenos_Aires';
  // ISO → "YYYY-MM-DDTHH:MM" (hora de Argentina) para <input type="datetime-local">
  function aLocal(iso) {
    if (!iso) return '';
    const p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(iso)).forEach((x) => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
  }
  // "YYYY-MM-DDTHH:MM" (Argentina, -03) → ISO
  function deLocal(v) { return v ? v + ':00-03:00' : null; }
  function fechaHora(iso) { return iso ? U.diaMes(iso) + ' ' + U.hora(iso) : ''; }
  function numero(v) {
    const s = String(v == null ? '' : v).replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // CSV para Excel en castellano: separador ";" y BOM UTF-8.
  function csv(filas) {
    if (!filas || !filas.length) return '﻿';
    const cols = Object.keys(filas[0]);
    const celda = (v) => {
      const s = v == null ? '' : String(v);
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [cols.map(celda).join(';')].concat(filas.map((f) => cols.map((c) => celda(f[c])).join(';'))).join('\r\n');
  }
  function bajarArchivo(contenido, nombre, tipo) {
    const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function hoy() { return aLocal(new Date().toISOString()).slice(0, 10); }

  function linkEntrada(token) { return new URL('entrada.html#t=' + token, location.href).href; }
  function linkApp() { return new URL('index.html', location.href).href; }

  function mensajeEntrada(venta, evento, link) {
    const nombre = U.primerNombre(venta.nombre);
    const quien = evento ? (evento.artista || evento.nombre) : 'el evento';
    const cuando = evento && evento.fecha ? ', ' + U.diaEvento(evento.fecha) : '';
    const una = venta.cantidad === 1;
    return '¡Hola ' + nombre + '! ' + (una ? 'Esta es tu entrada' : 'Estas son tus ' + venta.cantidad + ' entradas') +
      ' para *' + quien + '*' + cuando + '.\nAbrí el link e ingresá tu DNI para ver ' + (una ? 'tu QR' : 'tus QR') + ':\n' +
      link + '\nGuardá la imagen: en la puerta puede no haber señal.';
  }
  function urlWhatsApp(tel, texto) { return 'https://wa.me/' + (tel || '') + '?text=' + encodeURIComponent(texto); }

  function mensajeAcceso(nombre, usuario, clave) {
    return '¡Hola ' + U.primerNombre(nombre) + '! Ya tenés acceso a la app de entradas del ' + CONFIG.NOMBRE_CLUB + '.\n' +
      'Usuario: ' + usuario + '\nContraseña temporal: ' + clave + '\nEntrá acá: ' + linkApp() + '\n' +
      'La primera vez te va a pedir que elijas una contraseña nueva.';
  }

  // Comprobante de rendición en PNG (para mandar por WhatsApp).
  async function comprobante(m) {
    try { await document.fonts.load('800 40px Figtree'); } catch (_) { /* nada */ }
    const W = 900, H = 1100;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const F = "'Figtree', system-ui, sans-serif";
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111827'; g.fillRect(0, 0, W, 210);
    g.fillStyle = '#FDBA74'; g.font = '700 28px ' + F; g.fillText(CONFIG.NOMBRE_CLUB.toUpperCase(), 60, 80);
    g.fillStyle = '#FFFFFF'; g.font = '800 54px ' + F; g.fillText('Comprobante N.º ' + m.nro, 60, 150);
    g.fillStyle = '#4B5563'; g.font = '600 32px ' + F;
    g.fillText(m.tipo === 'entrega_efectivo' ? 'Entrega de efectivo del RRPP al club' : 'Pago de comisión del club al RRPP', 60, 290);
    g.fillStyle = '#111827'; g.font = '800 44px ' + F; g.fillText(m.rrpp, 60, 360);
    g.font = '800 110px ' + F; g.fillText(U.pesos(m.monto), 60, 510);
    g.font = '400 32px ' + F; g.fillStyle = '#111827';
    const lineas = [
      'Fecha: ' + U.fechaCorta(m.cuando) + ' · ' + U.hora(m.cuando) + ' hs',
      (m.evento ? 'Evento: ' + (m.evento.artista || m.evento.nombre) : ''),
      (m.tipo === 'entrega_efectivo' ? 'Efectivo que queda por rendir: ' : 'Comisión que queda por pagar: ') + U.pesos(Math.max(0, m.saldo)) +
        (Number(m.saldo) < 0 ? ' (a favor del RRPP: ' + U.pesos(-m.saldo) + ')' : ''),
      'Registró: ' + (m.por || ''),
    ].filter(Boolean);
    lineas.forEach((l, i) => g.fillText(l, 60, 600 + i * 56));
    if (m.nota) {
      g.fillStyle = '#4B5563'; g.font = '400 28px ' + F;
      const palabras = ('Nota: ' + m.nota).split(' ');
      let linea = '', y = 600 + lineas.length * 56 + 30;
      for (const p of palabras) {
        if (g.measureText(linea + p).width > W - 120) { g.fillText(linea, 60, y); linea = ''; y += 40; }
        linea += p + ' ';
      }
      g.fillText(linea, 60, y);
    }
    g.fillStyle = '#9CA3AF'; g.font = '400 24px ' + F;
    g.fillText('Comprobante generado por la app de entradas.', 60, H - 50);
    return new Promise((ok) => cv.toBlob(ok, 'image/png'));
  }

  // =====================================================================
  function montar(raiz, perfil, ctx) {
    const st = {
      seccion: null,
      tablero: null, evento: null, usuarios: null, rendicion: null, ventas: null, auditoria: null, cierre: null,
      filtros: { q: '', rrpp: '', tanda: '', medio: '', estado: '', canal: '' },
      seleccion: null,        // panel lateral abierto (venta, usuario, rrpp de rendición, tanda)
      resultado: null,        // último resultado a mostrar (link, acceso, comprobante)
      transfSel: new Set(),
      transfFiltro: 'pendientes',
    };
    let timerTablero = null;
    const $ = (s) => raiz.querySelector(s);
    const $$ = (s) => [...raiz.querySelectorAll(s)];

    async function rpc(nombre, args) {
      try {
        return await API.rpc(nombre, args);
      } catch (err) {
        if (ctx.esSesionInvalida(err)) { await ctx.sesionInvalida(err); throw Object.assign(new Error('sesion'), { silencioso: true }); }
        throw err;
      }
    }
    function avisoError(err) { if (!err || !err.silencioso) U.avisar(U.mensajeDeError(err)); }

    async function funcionUsuarios(cuerpo) {
      const { data, error } = await API.conSesion().functions.invoke('admin_crear_usuario', { body: cuerpo });
      if (error) {
        let mensaje = null;
        try { mensaje = (await error.context.json()).mensaje; } catch (_) { /* sin cuerpo */ }
        throw Object.assign(new Error(mensaje || 'No se pudo completar.'), { code: 'P0001', message: mensaje || U.mensajeDeError(error) });
      }
      return data;
    }

    // ---------------- Marco ----------------
    function marco(contenido) {
      const ev = st.tablero && st.tablero.evento || st.evento && st.evento.evento;
      const titulo = ev ? (ev.artista || ev.nombre) + (ev.fecha ? ' · ' + U.diaCorto(ev.fecha) : '') : 'Panel';
      ctx.mostrar(
        '<header class="admin-cabecera oscura">' +
        '<div class="admin-cabecera__titulo"><p class="admin-cabecera__rol">Administrador ' + ctx.VERSION + '</p>' +
        '<h1>' + e(titulo) + '</h1></div>' +
        '<nav class="admin-nav" aria-label="Secciones">' +
        SECCIONES.map(([id, txt]) => '<a href="#' + id + '"' + (st.seccion === id ? ' aria-current="page"' : '') + '>' + txt + '</a>').join('') +
        '<button class="boton boton--texto" type="button" id="salir">Salir</button>' +
        '</nav></header>' +
        '<main class="admin-contenido">' + contenido + '</main>');
      $('#salir').addEventListener('click', ctx.salir);
    }

    function cargando(titulo) { marco('<h2>' + e(titulo) + '</h2><p class="suave">Cargando…</p>'); }

    function chip(txt, tipo) { return '<span class="chip chip--' + tipo + '">' + e(txt) + '</span>'; }

    function barra(valor, total, clase) {
      const pct = Math.min(100, Math.round(100 * (valor || 0) / Math.max(1, total || 0)));
      return '<div class="barra-progreso ' + (clase || '') + '" aria-hidden="true"><span data-ancho="' + pct + '"></span></div>';
    }
    function pintarBarras() { $$('[data-ancho]').forEach((b) => { b.style.width = b.dataset.ancho + '%'; }); }

    // ======================= Tablero =======================
    async function sTablero(silencioso) {
      if (!silencioso) cargando('Tablero');
      try { st.tablero = await rpc('tablero_admin'); } catch (err) { return avisoError(err); }
      if (st.seccion !== 'tablero') return;
      const t = st.tablero;
      if (!t.evento) return marco('<h2>Tablero</h2><div class="aviso aviso--alerta">Todavía no hay ningún evento cargado.</div>');
      const ev = t.evento;
      const vig = (t.tandas || []).find((x) => x.estado === 'vigente' && x.canal === 'rrpp');
      const faltan = ev.tope - t.emitidas;
      const cerca = ev.aviso_desde && t.emitidas >= ev.aviso_desde;
      const canal = (c) => (t.canales[c] || { entradas: 0, total: 0 });
      let html = '<div class="admin-titulo"><h2>Tablero</h2><p class="suave">' +
        (vig ? 'Tanda vigente: ' + e(vig.nombre) + ' · ' + U.pesos(vig.precio) + (vig.hasta ? ' · hasta el ' + U.diaMes(vig.hasta) : '') : 'Sin tanda de RRPP vigente') +
        ' · ' + (t.venta_rrpp ? 'Venta RRPP abierta' : e(t.motivo_rrpp || 'Venta RRPP cerrada')) + '</p></div>';
      if (cerca) html += '<div class="aviso aviso--alerta" role="status">Atención: se emitieron ' + U.miles(t.emitidas) + ' de ' + U.miles(ev.tope) + '. ' +
        (faltan > 0 ? 'Quedan ' + U.plural(faltan, 'lugar', 'lugares') + ' hasta el tope.' : 'Se llegó al tope: la venta está frenada.') + '</div>';
      (t.avisos || []).forEach((a) => {
        html += '<div class="aviso aviso--error">Venta en puerta por encima del tope sin conexión (' + fechaHora(a.cuando) + '): ' +
          U.plural(a.detalle.cantidad, 'pulsera', 'pulseras') + '. Tope: ' + U.miles(a.detalle.tope) + '.</div>';
      });
      html += '<section class="admin-kpis">' +
        '<div class="tarjeta"><p class="tarjeta__etiqueta">Entradas emitidas</p><p class="tarjeta__dato">' + U.miles(t.emitidas) +
        ' <small class="suave">/ ' + U.miles(ev.tope) + '</small></p>' + barra(t.emitidas, ev.tope, cerca ? 'barra-alerta' : '') +
        '<p class="tarjeta__nota">' + (faltan > 0 ? 'Faltan ' + U.miles(faltan) + ' para el tope' : 'Tope alcanzado') + '</p></div>' +
        '<div class="tarjeta"><p class="tarjeta__etiqueta">Vendido</p><p class="tarjeta__dato">' + U.pesos(t.vendido) + '</p>' +
        '<p class="tarjeta__nota">Efectivo ' + U.pesos(t.efectivo) + ' · Transferencias ' + U.pesos(t.transferencias) + '</p></div>' +
        '<div class="tarjeta"><p class="tarjeta__etiqueta">Efectivo por rendir</p><p class="tarjeta__dato texto-acento">' + U.pesos(t.efectivo_a_rendir) + '</p>' +
        '<p class="tarjeta__nota">Comisiones a pagar: ' + U.pesos(t.comision_a_pagar) + '</p>' +
        '<a href="#rendicion" class="enlace">' + U.plural(t.rrpp_con_saldo, 'RRPP con saldo', 'RRPP con saldo') + ' · Ver rendición</a></div>' +
        '<div class="tarjeta"><p class="tarjeta__etiqueta">Transferencias sin confirmar</p><p class="tarjeta__dato">' + U.pesos(t.transf_pendientes.monto) + '</p>' +
        '<a href="#transferencias" class="enlace">' + U.plural(t.transf_pendientes.cantidad, 'venta', 'ventas') + ' · Cruzar con Mercado Pago</a></div>' +
        '<div class="tarjeta"><p class="tarjeta__etiqueta">Adentro</p><p class="tarjeta__dato" id="tablero-adentro">' + U.miles(t.adentro) + '</p>' +
        '<p class="tarjeta__nota">Ingresos en vivo · se actualiza solo' + (t.duplicados ? ' · ' + U.plural(t.duplicados, 'intento repetido', 'intentos repetidos') : '') + '</p></div>' +
        '</section>';
      html += '<div class="admin-dos">' +
        '<section class="tarjeta admin-dos__chico"><h3>Por tanda</h3>' +
        t.tandas.map((x) => '<div class="tanda-fila"><div class="tanda-fila__txt"><strong>' + e(x.nombre) + ' · ' + U.pesos(x.precio) + '</strong>' +
          '<span>' + U.miles(x.emitidas) + ' de ' + U.miles(x.cantidad) + ' · ' + (x.estado === 'proxima' && x.desde ? 'se habilita el ' + U.diaMes(x.desde) : U.pesos(x.recaudado)) + '</span></div>' +
          barra(x.emitidas, x.cantidad) + '</div>').join('') +
        '<div class="tanda-fila"><div class="tanda-fila__txt"><strong>Cortesías</strong><span>' + U.miles(canal('cortesia').entradas) + '</span></div></div>' +
        '<p class="tarjeta__nota">Por canal: RRPP ' + U.miles(canal('rrpp').entradas) + ' · Puerta ' + U.miles(canal('caja').entradas) +
        ' · Cortesías ' + U.miles(canal('cortesia').entradas) + '</p></section>' +
        '<section class="tarjeta admin-dos__grande"><h3>Por RRPP</h3><div class="tabla-caja"><table class="tabla">' +
        '<thead><tr><th>RRPP</th><th>Pueblo</th><th class="num">Vendidas</th><th class="num">Efectivo por rendir</th></tr></thead><tbody>' +
        (t.rrpp.length ? t.rrpp.map((r) => '<tr><td><strong>' + e(r.nombre) + '</strong></td><td>' + e(r.pueblo || '') + '</td><td class="num">' + U.miles(r.entradas) + '</td>' +
          '<td class="num">' + (Number(r.efectivo_a_rendir) === 0 ? '<span class="texto-ok">Al día</span>' : '<strong>' + U.pesos(r.efectivo_a_rendir) + '</strong>') + '</td></tr>').join('')
          : '<tr><td colspan="4" class="suave">Todavía no hay RRPP.</td></tr>') +
        '</tbody></table></div></section></div>';
      if ((t.ingresos_hora || []).length) {
        const max = Math.max(...t.ingresos_hora.map((x) => x.n));
        html += '<section class="tarjeta"><h3>Ingresos por hora</h3><div class="horas">' +
          t.ingresos_hora.map((x) => '<div class="horas__fila"><span>' + e(x.hora) + '</span>' + barra(x.n, max) + '<strong>' + U.miles(x.n) + '</strong></div>').join('') +
          '</div></section>';
      }
      marco(html);
      pintarBarras();
    }

    // ======================= Ventas =======================
    async function cargarVentas() {
      const f = {};
      Object.entries(st.filtros).forEach(([k, v]) => { if (v) f[k] = v; });
      st.ventas = await rpc('ventas_admin', { p_filtros: f });
    }

    async function sVentas() {
      cargando('Ventas');
      try {
        await Promise.all([cargarVentas(), st.usuarios ? null : rpc('usuarios_admin').then((u) => { st.usuarios = u; }),
                           st.evento ? null : rpc('evento_admin').then((x) => { st.evento = x; })]);
      } catch (err) { return avisoError(err); }
      pVentas();
    }

    function opciones(lista, actual, todos) {
      return '<option value="">' + e(todos) + '</option>' + lista.map(([v, t]) => '<option value="' + e(v) + '"' + (v === actual ? ' selected' : '') + '>' + e(t) + '</option>').join('');
    }

    function estadoVenta(v) {
      if (v.estado === 'anulada') return chip('Anulada', 'error');
      if (v.ingresaron > 0) return chip(v.ingresaron === v.cantidad ? 'Ingresó' : 'Ingresaron ' + v.ingresaron + ' de ' + v.cantidad, 'ok');
      if (v.canal === 'caja') return chip('Pulsera', 'ok');
      return v.enviada ? chip('Enviada', 'ok') : chip('Sin enviar', 'pendiente');
    }

    function pVentas() {
      if (st.seccion !== 'ventas') return;
      const f = st.filtros;
      const rrpps = (st.usuarios.usuarios || []).filter((u) => u.rol === 'rrpp').map((u) => [u.ref, u.nombre]);
      const tandas = [...new Set((st.evento.tandas || []).map((t) => t.nombre))].map((n) => [n, n]);
      const lista = st.ventas || [];
      const sel = st.seleccion && st.seleccion.tipo === 'venta' ? st.seleccion : null;
      let html = '<div class="admin-titulo"><h2>Ventas</h2><button class="boton boton--principal" type="button" id="nueva-cortesia">Emitir cortesía</button></div>' +
        '<form class="tarjeta admin-filtros" id="filtros">' +
        '<label class="campo"><span class="campo__etiqueta">Buscar</span><input class="entrada-texto" type="search" name="q" placeholder="Nombre o DNI" value="' + e(f.q) + '"></label>' +
        '<label class="campo"><span class="campo__etiqueta">RRPP</span><select class="entrada-texto" name="rrpp">' + opciones(rrpps, f.rrpp, 'Todos') + '</select></label>' +
        '<label class="campo"><span class="campo__etiqueta">Tanda</span><select class="entrada-texto" name="tanda">' + opciones(tandas, f.tanda, 'Todas') + '</select></label>' +
        '<label class="campo"><span class="campo__etiqueta">Medio</span><select class="entrada-texto" name="medio">' + opciones(Object.entries(MEDIO), f.medio, 'Todos') + '</select></label>' +
        '<label class="campo"><span class="campo__etiqueta">Canal</span><select class="entrada-texto" name="canal">' + opciones(Object.entries(CANAL).slice(0, 3), f.canal, 'Todos') + '</select></label>' +
        '<label class="campo"><span class="campo__etiqueta">Estado</span><select class="entrada-texto" name="estado">' + opciones([['activa', 'Activas'], ['anulada', 'Anuladas']], f.estado, 'Todas') + '</select></label>' +
        '</form>' +
        '<div class="admin-dos">' +
        '<section class="tarjeta admin-dos__grande"><p class="suave">' + U.plural(lista.length, 'venta', 'ventas') + ' · ' +
        U.plural(lista.filter((v) => v.estado === 'activa').reduce((a, v) => a + v.cantidad, 0), 'entrada', 'entradas') + '</p>' +
        '<div class="tabla-caja"><table class="tabla tabla--clic"><thead><tr><th>Fecha</th><th>Titular</th><th>RRPP / canal</th><th>Tanda</th><th class="num">Cant.</th><th class="num">Total</th><th>Medio</th><th>Estado</th></tr></thead><tbody>' +
        (lista.length ? lista.map((v, i) => '<tr data-i="' + i + '" tabindex="0"' + (sel && sel.v.ref === v.ref ? ' class="fila-sel"' : '') + '><td>' + fechaHora(v.creada) + '</td>' +
          '<td><strong>' + e(v.nombre) + '</strong>' + (v.dni ? '<br><span class="suave">DNI ' + e(v.dni) + '</span>' : '') + '</td>' +
          '<td>' + e(v.rrpp || CANAL[v.canal]) + '</td><td>' + e(v.tanda || '') + '</td><td class="num">' + v.cantidad + '</td>' +
          '<td class="num">' + U.pesos(v.total) + '</td><td>' + e(MEDIO[v.medio]) + '</td><td>' + estadoVenta(v) + '</td></tr>').join('')
          : '<tr><td colspan="8" class="suave">No hay ventas con esos filtros.</td></tr>') +
        '</tbody></table></div></section>' +
        '<aside class="admin-dos__chico" id="panel">' + panelVenta() + '</aside></div>';
      marco(html);
      const form = $('#filtros');
      let espera = null;
      form.addEventListener('input', (ev) => {
        st.filtros[ev.target.name] = ev.target.value;
        clearTimeout(espera);
        espera = setTimeout(async () => {
          try { await cargarVentas(); } catch (err) { return avisoError(err); }
          const foco = document.activeElement && document.activeElement.name;
          const pos = foco === 'q' ? document.activeElement.selectionStart : null;
          pVentas();
          if (foco) { const el = $('[name="' + foco + '"]'); if (el) { el.focus(); if (pos != null) el.setSelectionRange(pos, pos); } }
        }, ev.target.name === 'q' ? 300 : 0);
      });
      form.addEventListener('submit', (ev) => ev.preventDefault());
      $$('tr[data-i]').forEach((tr) => {
        const abrir = () => abrirVenta(lista[Number(tr.dataset.i)]);
        tr.addEventListener('click', abrir);
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(); });
      });
      $('#nueva-cortesia').addEventListener('click', () => { st.seleccion = { tipo: 'cortesia' }; st.resultado = null; pVentas(); $('#panel').scrollIntoView({ block: 'nearest' }); });
      conectarPanelVenta();
    }

    async function abrirVenta(v) {
      st.seleccion = { tipo: 'venta', v, det: null };
      st.resultado = null;
      pVentas();
      try { st.seleccion.det = await rpc('detalle_venta', { p_venta_id: v.ref }); } catch (err) { avisoError(err); }
      pVentas();
      const p = $('#panel'); if (p) p.scrollIntoView({ block: 'nearest' });
    }

    function bloqueLink(r, titulo) {
      const link = linkEntrada(r.token);
      const texto = mensajeEntrada(r.venta, r.evento, link);
      return '<div class="aviso aviso--ok">' + e(titulo) + '</div>' +
        '<a class="boton boton--whatsapp boton--ancho" target="_blank" rel="noopener" id="enviar-wa" href="' + e(urlWhatsApp(r.venta.tel, texto)) + '">' + ICONO_WA + ' Enviar por WhatsApp</a>' +
        '<button class="boton boton--ancho" type="button" id="copiar-link" data-link="' + e(link) + '">Copiar link</button>';
    }

    function panelVenta() {
      const s = st.seleccion;
      if (s && s.tipo === 'cortesia') {
        return '<section class="tarjeta panel-destacado"><h3>Emitir cortesía</h3><p class="suave">A $0. Cuenta para el tope.</p>' +
          (st.resultado && st.resultado.tipo === 'cortesia' ? bloqueLink(st.resultado.r, 'Cortesía emitida: ' + st.resultado.r.venta.nombre + ' · ' + U.plural(st.resultado.r.venta.cantidad, 'entrada', 'entradas') + '.') :
          (s.error ? '<div class="aviso aviso--error" role="alert">' + e(s.error) + '</div>' : '') +
          '<form id="form-cortesia" novalidate>' +
          '<label class="campo"><span class="campo__etiqueta">Nombre y apellido</span><input class="entrada-texto" name="nombre" value="' + e(s.nombre || '') + '"></label>' +
          '<label class="campo"><span class="campo__etiqueta">DNI</span><input class="entrada-texto" name="dni" inputmode="numeric" value="' + e(s.dni || '') + '"></label>' +
          '<label class="campo"><span class="campo__etiqueta">WhatsApp (opcional)</span><input class="entrada-texto" name="tel" type="tel" value="' + e(s.tel || '') + '"></label>' +
          '<label class="campo"><span class="campo__etiqueta">Cantidad</span><input class="entrada-texto" name="cantidad" type="number" min="1" max="20" value="' + e(s.cantidad || 1) + '"></label>' +
          '</form><button class="boton boton--principal boton--ancho" type="submit" form="form-cortesia" id="emitir-cortesia">Emitir cortesía</button>') +
          '<button class="boton boton--texto boton--ancho" type="button" id="cerrar-panel">Cerrar</button></section>';
      }
      if (!s || s.tipo !== 'venta') return '<section class="tarjeta"><p class="suave">Tocá una venta para ver el detalle, reenviar el link o anularla.</p></section>';
      const v = s.det || s.v;
      let html = '<section class="tarjeta panel-destacado"><h3>' + e(v.nombre) + '</h3>' +
        '<p class="suave">' + e(CANAL[s.v.canal]) + (s.v.rrpp ? ' · ' + e(s.v.rrpp) : '') + ' · ' + fechaHora(s.v.creada) + '</p>' +
        '<dl class="datos">' + (v.dni ? '<dt>DNI</dt><dd>' + e(v.dni) + '</dd>' : '') + (v.tel ? '<dt>WhatsApp</dt><dd>' + e(v.tel) + '</dd>' : '') +
        '<dt>Tanda</dt><dd>' + e(v.tanda || '—') + '</dd><dt>Total</dt><dd>' + U.pesos(v.total) + ' · ' + e(MEDIO[v.medio]) + '</dd>' +
        (s.v.medio === 'transferencia' ? '<dt>Transferencia</dt><dd>' + (s.v.confirmada ? 'Confirmada' : 'Sin confirmar') + '</dd>' : '') + '</dl>';
      if (s.det && s.det.entradas) {
        html += '<div>' + s.det.entradas.map((x) => '<div class="entrada-fila"><span>Entrada ' + x.nro + ' de ' + v.cantidad +
          (x.pasada_a ? '<br><span class="suave">Pasada a ' + e(x.pasada_a) + '</span>' : '') + '</span>' +
          (x.estado === 'anulada' ? chip('Anulada', 'error') : x.ingreso ? chip('Ingresó ' + U.hora(x.ingreso), 'ok') : chip('Sin usar', 'neutro')) + '</div>').join('') + '</div>';
      }
      if (v.estado === 'anulada') {
        html += '<div class="aviso aviso--error">Anulada' + (v.motivo_anulacion ? ': ' + e(v.motivo_anulacion) : '') + '.</div>';
      } else if (st.resultado && st.resultado.tipo === 'reenvio') {
        html += bloqueLink(st.resultado.r, 'Link nuevo generado. El anterior ya no funciona.');
      } else {
        if (s.v.canal !== 'caja') html += '<button class="boton boton--whatsapp boton--ancho" type="button" id="reenviar">' + ICONO_WA + ' Reenviar link</button>';
        html += s.anulando
          ? '<form id="form-anular" novalidate><label class="campo"><span class="campo__etiqueta">Motivo de la anulación</span>' +
            '<textarea class="entrada-texto" name="motivo" rows="2" autofocus></textarea></label></form>' +
            (s.error ? '<div class="aviso aviso--error" role="alert">' + e(s.error) + '</div>' : '') +
            '<button class="boton boton--peligro boton--ancho" type="submit" form="form-anular" id="confirmar-anular">Anular venta</button>'
          : '<button class="boton boton--peligro boton--ancho" type="button" id="anular">Anular venta</button>';
      }
      return html + '<button class="boton boton--texto boton--ancho" type="button" id="cerrar-panel">Cerrar</button></section>';
    }

    function conectarPanelVenta() {
      const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
      on('cerrar-panel', () => { st.seleccion = null; st.resultado = null; pVentas(); });
      on('copiar-link', (ev) => U.copiar(ev.currentTarget.dataset.link, 'Link copiado.'));
      on('anular', () => { st.seleccion.anulando = true; st.seleccion.error = null; pVentas(); });
      on('reenviar', async (ev) => {
        const boton = ev.currentTarget;
        const si = await U.confirmar('Se genera un link nuevo y el anterior deja de funcionar. ¿Seguimos?', 'Sí, generar link nuevo', 'Cancelar');
        if (!si) return;
        await U.conBoton(boton, async () => {
          try { st.resultado = { tipo: 'reenvio', r: await rpc('reenviar_link', { p_venta_id: st.seleccion.v.ref }) }; pVentas(); }
          catch (err) { avisoError(err); }
        });
      });
      const fa = $('#form-anular');
      if (fa) fa.addEventListener('submit', (ev) => {
        ev.preventDefault();
        U.conBoton($('#confirmar-anular'), async () => {
          const motivo = fa.motivo.value.trim();
          if (!motivo) { st.seleccion.error = 'Escribí el motivo de la anulación.'; return pVentas(); }
          try {
            await rpc('anular_venta', { p_venta_id: st.seleccion.v.ref, p_motivo: motivo });
            U.avisar('Venta anulada.');
            await cargarVentas();
            const v = st.ventas.find((x) => x.ref === st.seleccion.v.ref) || st.seleccion.v;
            st.tablero = null;
            await abrirVenta(v);
          } catch (err) { st.seleccion.error = U.mensajeDeError(err); pVentas(); }
        });
      });
      const fc = $('#form-cortesia');
      if (fc) fc.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const s = st.seleccion;
        ['nombre', 'dni', 'tel', 'cantidad'].forEach((k) => { s[k] = fc[k].value; });
        if (!s.idem) s.idem = U.nuevaClave();
        U.conBoton($('#emitir-cortesia'), async () => {
          const tel = U.telWhatsApp(s.tel);
          if (tel === null) { s.error = 'Revisá el WhatsApp: poné código de área y número.'; return pVentas(); }
          try {
            const r = await rpc('emitir_cortesia', { p_nombre: s.nombre, p_dni: U.soloDigitos(s.dni), p_cantidad: Number(s.cantidad), p_tel: tel || null, p_idem: s.idem });
            st.resultado = { tipo: 'cortesia', r };
            st.seleccion = { tipo: 'cortesia' };
            await cargarVentas();
            pVentas();
          } catch (err) { s.error = U.mensajeDeError(err); pVentas(); }
        });
      });
    }

    // ======================= RRPP y usuarios =======================
    async function sRrpp() {
      cargando('RRPP y usuarios');
      try { st.usuarios = await rpc('usuarios_admin'); } catch (err) { return avisoError(err); }
      pRrpp();
    }

    function textoLimite(u) {
      if (!u.habilitado) return 'No habilitado';
      if (u.limite_tipo === 'cantidad') return U.miles(u.limite_valor) + ' por tanda';
      if (u.limite_tipo === 'porcentaje') return U.miles(u.limite_valor) + '% de la tanda';
      return 'Sin límite';
    }

    function pRrpp() {
      if (st.seccion !== 'rrpp') return;
      const us = st.usuarios.usuarios || [];
      const tv = st.usuarios.tanda;
      const rrpps = us.filter((u) => u.rol === 'rrpp');
      const otros = us.filter((u) => u.rol !== 'rrpp');
      const sel = st.seleccion && st.seleccion.tipo === 'usuario' ? us.find((u) => u.ref === st.seleccion.ref) : null;
      const nuevo = st.seleccion && st.seleccion.tipo === 'nuevo';
      const fila = (u) => '<tr data-ref="' + e(u.ref) + '" tabindex="0"' + (sel && sel.ref === u.ref ? ' class="fila-sel"' : '') + '>' +
        '<td><strong>' + e(u.nombre) + '</strong><br><span class="suave">' + e(u.usuario) + (u.pueblo ? ' · ' + e(u.pueblo) : '') + '</span>' +
        (!u.activo ? ' ' + chip('Desactivado', 'error') : '') + '</td>' +
        (u.rol === 'rrpp'
          ? '<td>' + (Number(u.comision) === 0 ? chip('Ad honorem', 'azul') : U.pesos(u.comision)) + '</td><td>' + e(textoLimite(u)) + '</td>' +
            '<td>' + (tv ? U.miles(u.vendidas_vigente) + (u.limite_vigente != null ? ' de ' + U.miles(u.limite_vigente) : '') : '—') + '</td><td class="num">' + U.miles(u.vendidas) + '</td>'
          : '<td colspan="4">' + e(ROL[u.rol]) + '</td>') + '</tr>';
      let html = '<div class="admin-titulo"><h2>RRPP y usuarios</h2><button class="boton boton--principal" type="button" id="nuevo-usuario">Nuevo usuario</button></div>' +
        '<div class="admin-dos"><section class="tarjeta admin-dos__grande">' +
        '<div class="tabla-caja"><table class="tabla tabla--clic"><thead><tr><th>RRPP</th><th>Comisión</th><th>Límite por tanda</th><th>' +
        (tv ? 'En la ' + e(tv.nombre) : 'En la tanda vigente') + '</th><th class="num">Total</th></tr></thead><tbody>' +
        (rrpps.length ? rrpps.map(fila).join('') : '<tr><td colspan="5" class="suave">Todavía no hay RRPP.</td></tr>') +
        '</tbody></table></div>' +
        '<h3 class="separado">Otros usuarios</h3><div class="tabla-caja"><table class="tabla tabla--clic"><tbody>' + otros.map(fila).join('') + '</tbody></table></div>' +
        '<p class="tarjeta__nota">Si cambiás una comisión, las ventas ya hechas mantienen la anterior.</p></section>' +
        '<aside class="admin-dos__chico" id="panel">' + (nuevo ? panelNuevo() : sel ? panelUsuario(sel, tv) : '<section class="tarjeta"><p class="suave">Tocá un usuario para editarlo.</p></section>') + '</aside></div>';
      marco(html);
      $$('tr[data-ref]').forEach((tr) => {
        const abrir = () => { st.seleccion = { tipo: 'usuario', ref: tr.dataset.ref }; st.resultado = null; pRrpp(); $('#panel').scrollIntoView({ block: 'nearest' }); };
        tr.addEventListener('click', abrir);
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(); });
      });
      $('#nuevo-usuario').addEventListener('click', () => { st.seleccion = { tipo: 'nuevo', rol: 'rrpp' }; st.resultado = null; pRrpp(); });
      conectarPanelUsuario(sel, tv);
    }

    function bloqueAcceso(r) {
      const texto = mensajeAcceso(r.nombre, r.usuario, r.clave);
      return '<div class="aviso aviso--ok">Usuario: <strong>' + e(r.usuario) + '</strong> · Contraseña temporal: <strong>' + e(r.clave) + '</strong></div>' +
        '<a class="boton boton--whatsapp boton--ancho" id="enviar-acceso" target="_blank" rel="noopener" href="' + e(urlWhatsApp(U.telWhatsApp(r.telefono || '') || '', texto)) + '">' +
        ICONO_WA + ' Enviar acceso por WhatsApp</a>';
    }

    function panelNuevo() {
      const s = st.seleccion;
      if (st.resultado && st.resultado.tipo === 'acceso') {
        return '<section class="tarjeta panel-destacado"><h3>Usuario creado</h3>' + bloqueAcceso(st.resultado.r) +
          '<button class="boton boton--texto boton--ancho" type="button" id="cerrar-panel">Cerrar</button></section>';
      }
      return '<section class="tarjeta panel-destacado"><h3>Nuevo usuario</h3>' +
        (s.error ? '<div class="aviso aviso--error" role="alert">' + e(s.error) + '</div>' : '') +
        '<form id="form-nuevo" novalidate>' +
        '<label class="campo"><span class="campo__etiqueta">Nombre y apellido</span><input class="entrada-texto" name="nombre" value="' + e(s.nombre || '') + '" autofocus></label>' +
        '<label class="campo"><span class="campo__etiqueta">Usuario</span><input class="entrada-texto" name="usuario" autocapitalize="none" spellcheck="false" value="' + e(s.usuario || '') + '">' +
        '<span class="campo__ayuda">Con el que entra a la app. Sin espacios, por ejemplo: juan.gomez</span></label>' +
        '<label class="campo"><span class="campo__etiqueta">WhatsApp</span><input class="entrada-texto" name="telefono" type="tel" value="' + e(s.telefono || '') + '"></label>' +
        '<label class="campo"><span class="campo__etiqueta">Pueblo</span><input class="entrada-texto" name="pueblo" value="' + e(s.pueblo || '') + '"></label>' +
        '<label class="campo"><span class="campo__etiqueta">Tipo de usuario</span><select class="entrada-texto" name="rol">' +
        Object.entries(ROL).map(([v, t]) => '<option value="' + v + '"' + (v === (s.rol || 'rrpp') ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        '</form><button class="boton boton--principal boton--ancho" type="submit" form="form-nuevo" id="crear-usuario">Crear usuario</button>' +
        '<button class="boton boton--texto boton--ancho" type="button" id="cerrar-panel">Cancelar</button></section>';
    }

    function panelUsuario(u, tv) {
      const s = st.seleccion;
      const lt = s.limite_tipo || u.limite_tipo || 'sin_limite';
      let html = '<section class="tarjeta panel-destacado"><h3>' + e(u.nombre) + '</h3>' +
        '<p class="suave">Usuario: ' + e(u.usuario) + ' · ' + e(ROL[u.rol]) + (u.pueblo ? ' · ' + e(u.pueblo) : '') + '</p>' +
        (u.debe_cambiar_clave ? '<p class="suave">Todavía no eligió su contraseña.</p>' : '');
      if (u.rol === 'rrpp') {
        html += (s.error ? '<div class="aviso aviso--error" role="alert">' + e(s.error) + '</div>' : '') +
          '<form id="form-rrpp" novalidate>' +
          '<label class="campo"><span class="campo__etiqueta">Comisión por entrada</span><input class="entrada-texto" name="comision" inputmode="numeric" value="' +
          e(s.comision != null ? s.comision : U.miles(u.comision || 0)) + '"><span class="campo__ayuda">Poné $0 para que venda ad honorem.</span></label>' +
          '<div class="campo"><span class="campo__etiqueta" id="et-lim">Límite por tanda</span><div class="opciones opciones--3" role="group" aria-labelledby="et-lim">' +
          [['sin_limite', 'Sin límite'], ['cantidad', 'Cantidad'], ['porcentaje', '% de la tanda']].map(([v, t]) =>
            '<button type="button" class="opcion" data-limite="' + v + '" aria-pressed="' + (lt === v) + '">' + t + '</button>').join('') + '</div></div>' +
          (lt !== 'sin_limite' ? '<label class="campo"><span class="campo__etiqueta">' + (lt === 'cantidad' ? 'Entradas por tanda' : 'Porcentaje') + '</span>' +
            '<input class="entrada-texto" name="limite_valor" inputmode="numeric" value="' + e(s.limite_valor != null ? s.limite_valor : (u.limite_tipo === lt ? u.limite_valor : '')) + '">' +
            '<span class="campo__ayuda" id="limite-efectivo"></span></label>' : '') +
          '</form><button class="boton boton--principal boton--ancho" type="submit" form="form-rrpp" id="guardar-rrpp">Guardar</button>';
      }
      if (st.resultado && st.resultado.tipo === 'acceso' && st.resultado.r.usuario === u.usuario) html += bloqueAcceso(st.resultado.r);
      else html += '<button class="boton boton--ancho" type="button" id="nueva-clave">Nueva contraseña y enviar acceso</button>';
      html += '<button class="boton boton--texto boton--ancho ' + (u.activo ? 'boton--peligro-texto' : '') + '" type="button" id="activar">' +
        (u.activo ? 'Desactivar usuario' : 'Activar usuario') + '</button>' +
        '<button class="boton boton--texto boton--ancho" type="button" id="cerrar-panel">Cerrar</button></section>';
      return html;
    }

    function conectarPanelUsuario(u, tv) {
      const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
      on('cerrar-panel', () => { st.seleccion = null; st.resultado = null; pRrpp(); });
      const fn = $('#form-nuevo');
      if (fn) fn.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const s = st.seleccion;
        ['nombre', 'usuario', 'telefono', 'pueblo', 'rol'].forEach((k) => { s[k] = fn[k].value.trim(); });
        U.conBoton($('#crear-usuario'), async () => {
          try {
            const r = await funcionUsuarios({ accion: 'crear', nombre: s.nombre, usuario: s.usuario.toLowerCase(), telefono: s.telefono, pueblo: s.pueblo, rol: s.rol });
            st.resultado = { tipo: 'acceso', r: { ...r, nombre: s.nombre, telefono: s.telefono } };
            st.usuarios = await rpc('usuarios_admin');
            pRrpp();
          } catch (err) { s.error = err.message || U.mensajeDeError(err); pRrpp(); }
        });
      });
      if (!u) return;
      $$('[data-limite]').forEach((b) => b.addEventListener('click', () => {
        const f = $('#form-rrpp');
        st.seleccion.comision = f.comision.value;
        st.seleccion.limite_tipo = b.dataset.limite;
        st.seleccion.limite_valor = null;
        pRrpp();
      }));
      const f = $('#form-rrpp');
      const efectivo = () => {
        const out = $('#limite-efectivo');
        if (!out || !f.limite_valor) return;
        const v = numero(f.limite_valor.value);
        const lt = st.seleccion.limite_tipo || u.limite_tipo;
        if (lt === 'porcentaje' && tv && Number.isFinite(v)) out.textContent = U.miles(v) + '% = ' + U.plural(Math.floor(tv.cantidad * v / 100), 'entrada', 'entradas') + ' en la ' + tv.nombre + '. Se ajusta solo si cambia la tanda.';
        else if (lt === 'cantidad') out.textContent = 'Entradas que puede vender en cada tanda.';
        else out.textContent = '';
      };
      if (f && f.limite_valor) { f.limite_valor.addEventListener('input', efectivo); efectivo(); }
      if (f) f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        U.conBoton($('#guardar-rrpp'), async () => {
          const lt = st.seleccion.limite_tipo || u.limite_tipo || 'sin_limite';
          const com = numero(f.comision.value);
          const val = f.limite_valor ? numero(f.limite_valor.value) : null;
          if (!Number.isFinite(com) || com === null) { st.seleccion.error = 'Escribí la comisión (o $0).'; return pRrpp(); }
          try {
            st.usuarios = await rpc('ajustar_rrpp', { p_rrpp_id: u.ref, p_comision: com, p_limite_tipo: lt, p_limite_valor: lt === 'sin_limite' ? null : val });
            st.seleccion = { tipo: 'usuario', ref: u.ref };
            U.avisar('Guardado.');
            pRrpp();
          } catch (err) { st.seleccion.error = U.mensajeDeError(err); pRrpp(); }
        });
      });
      on('nueva-clave', async (ev) => {
        const boton = ev.currentTarget;
        const si = await U.confirmar('Se genera una contraseña temporal nueva para ' + u.nombre + '. La actual deja de funcionar. ¿Seguimos?', 'Sí, generar', 'Cancelar');
        if (!si) return;
        await U.conBoton(boton, async () => {
          try {
            const r = await funcionUsuarios({ accion: 'restablecer', user_id: u.ref });
            st.resultado = { tipo: 'acceso', r: { ...r, nombre: u.nombre, telefono: u.telefono } };
            st.usuarios = await rpc('usuarios_admin');
            pRrpp();
          } catch (err) { U.avisar(err.message || U.mensajeDeError(err)); }
        });
      });
      on('activar', async (ev) => {
        const boton = ev.currentTarget;
        if (u.activo) {
          const si = await U.confirmar('¿Desactivar a ' + u.nombre + '? Queda bloqueado al instante en todos sus celulares.', 'Sí, desactivar', 'Cancelar');
          if (!si) return;
        }
        await U.conBoton(boton, async () => {
          try { st.usuarios = await rpc('activar_usuario', { p_user_id: u.ref, p_activo: !u.activo }); U.avisar(u.activo ? 'Usuario desactivado.' : 'Usuario activado.'); pRrpp(); }
          catch (err) { avisoError(err); }
        });
      });
    }

    // ======================= Transferencias =======================
    async function sTransferencias() {
      cargando('Transferencias');
      try { st.ventas = await rpc('ventas_admin', { p_filtros: { medio: 'transferencia', estado: 'activa' } }); } catch (err) { return avisoError(err); }
      pTransferencias();
    }

    function pTransferencias() {
      if (st.seccion !== 'transferencias') return;
      const todas = st.ventas || [];
      const lista = todas.filter((v) => st.transfFiltro === 'todas' || (st.transfFiltro === 'pendientes' ? !v.confirmada : v.confirmada));
      const pend = todas.filter((v) => !v.confirmada);
      marco('<div class="admin-titulo"><h2>Transferencias</h2><button class="boton" type="button" id="exportar-transf">Exportar CSV</button></div>' +
        '<p class="suave">Marcá las que aparecen en el resumen de Mercado Pago. Sin confirmar: ' + U.plural(pend.length, 'venta', 'ventas') + ' · ' +
        U.pesos(pend.reduce((a, v) => a + Number(v.total), 0)) + '.</p>' +
        '<div class="opciones opciones--3 admin-pestanas" role="group" aria-label="Mostrar">' +
        [['pendientes', 'Sin confirmar'], ['confirmadas', 'Confirmadas'], ['todas', 'Todas']].map(([v, t]) =>
          '<button type="button" class="opcion" data-filtro="' + v + '" aria-pressed="' + (st.transfFiltro === v) + '">' + t + '</button>').join('') + '</div>' +
        '<section class="tarjeta"><div class="tabla-caja"><table class="tabla"><thead><tr><th><span class="solo-lector">Elegir</span></th><th>Fecha</th><th>Titular</th><th>RRPP / canal</th><th class="num">Monto</th><th>Estado</th></tr></thead><tbody>' +
        (lista.length ? lista.map((v) => '<tr><td><label class="check-caja"><input type="checkbox" class="check" data-ref="' + e(v.ref) + '" aria-label="Elegir ' + e(v.nombre) + '"' + (st.transfSel.has(v.ref) ? ' checked' : '') + '></label></td>' +
          '<td>' + fechaHora(v.creada) + '</td><td><strong>' + e(v.nombre) + '</strong></td><td>' + e(v.rrpp || CANAL[v.canal]) + '</td>' +
          '<td class="num">' + U.pesos(v.total) + '</td><td>' + (v.confirmada ? chip('Confirmada', 'ok') : chip('Sin confirmar', 'pendiente')) + '</td></tr>').join('')
          : '<tr><td colspan="6" class="suave">No hay transferencias para mostrar.</td></tr>') +
        '</tbody></table></div>' +
        '<div class="botones-fila"><button class="boton boton--principal" type="button" id="confirmar-sel">Marcar como confirmadas</button>' +
        '<button class="boton" type="button" id="desconfirmar-sel">Quitar confirmación</button></div></section>');
      $$('[data-filtro]').forEach((b) => b.addEventListener('click', () => { st.transfFiltro = b.dataset.filtro; pTransferencias(); }));
      $$('.check').forEach((c) => c.addEventListener('change', () => { if (c.checked) st.transfSel.add(c.dataset.ref); else st.transfSel.delete(c.dataset.ref); }));
      const cambiar = (valor) => async (ev) => {
        if (!st.transfSel.size) return U.avisar('Elegí al menos una transferencia.');
        await U.conBoton(ev.currentTarget, async () => {
          try {
            const r = await rpc('confirmar_transferencias', { p_venta_ids: [...st.transfSel], p_confirmar: valor });
            U.avisar(U.plural(r.cambiadas, 'transferencia actualizada', 'transferencias actualizadas') + '.');
            st.transfSel.clear();
            st.ventas = await rpc('ventas_admin', { p_filtros: { medio: 'transferencia', estado: 'activa' } });
            pTransferencias();
          } catch (err) { avisoError(err); }
        });
      };
      $('#confirmar-sel').addEventListener('click', cambiar(true));
      $('#desconfirmar-sel').addEventListener('click', cambiar(false));
      $('#exportar-transf').addEventListener('click', () => {
        bajarArchivo(csv(todas.map((v) => ({ Fecha: fechaHora(v.creada), Titular: v.nombre, DNI: v.dni || '', 'RRPP / canal': v.rrpp || CANAL[v.canal],
          Monto: Number(v.total), Confirmada: v.confirmada ? 'Sí' : 'No' }))), 'transferencias-' + hoy() + '.csv');
      });
    }

    // ======================= Rendición =======================
    async function sRendicion() {
      cargando('Rendición');
      try { st.rendicion = await rpc('rendicion_admin'); } catch (err) { return avisoError(err); }
      pRendicion();
    }

    function pRendicion() {
      if (st.seccion !== 'rendicion') return;
      const r = st.rendicion;
      const filas = r.filas || [];
      const sel = st.seleccion && st.seleccion.tipo === 'rendicion' ? filas.find((f) => f.ref === st.seleccion.ref) : null;
      const tot = (k) => filas.reduce((a, f) => a + Number(f[k] || 0), 0);
      const faltan = filas.filter((f) => Number(f.efectivo_a_rendir) !== 0 || Number(f.comision_a_pagar) !== 0);
      const saldo = (v, cls) => Number(v) === 0 ? '<span class="texto-ok">Al día</span>' : '<strong class="' + cls + '">' + U.pesos(v) + '</strong>';
      let html = '<div class="admin-titulo"><h2>Rendición</h2></div>' +
        '<p class="suave">Cada RRPP rinde todo el efectivo que cobró. La comisión se paga aparte. Las transferencias van directo al club.</p>';
      if (r.venta_rrpp_cerrada && faltan.length) html += '<div class="aviso aviso--alerta">Cerró la venta de RRPP. Falta cerrar la cuenta de: ' + faltan.map((f) => e(f.nombre)).join(', ') + '.</div>';
      else if (r.venta_rrpp_cerrada) html += '<div class="aviso aviso--ok">Cerró la venta de RRPP y todas las cuentas están en $0.</div>';
      html += '<div class="admin-dos"><section class="tarjeta admin-dos__grande"><div class="tabla-caja"><table class="tabla tabla--clic tabla--rendicion">' +
        '<thead><tr class="grupos"><th></th><th></th><th colspan="3" class="grupo-efectivo">Efectivo</th><th colspan="3" class="grupo-comision">Comisión</th></tr>' +
        '<tr><th>RRPP</th><th class="num">Entradas</th><th class="num">Cobrado</th><th class="num">Entregado</th><th class="num">A rendir</th>' +
        '<th class="num">Le corresponde</th><th class="num">Pagado</th><th class="num">A pagar</th></tr></thead><tbody>' +
        (filas.length ? filas.map((f) => '<tr data-ref="' + e(f.ref) + '" tabindex="0"' + (sel && sel.ref === f.ref ? ' class="fila-sel"' : '') + '>' +
          '<td><strong>' + e(f.nombre) + '</strong>' + (f.pueblo ? '<br><span class="suave">' + e(f.pueblo) + '</span>' : '') + '</td>' +
          '<td class="num">' + U.miles(f.entradas) + '</td><td class="num">' + U.pesos(f.efectivo_cobrado) + '</td><td class="num">' + U.pesos(f.rendido) + '</td>' +
          '<td class="num">' + saldo(f.efectivo_a_rendir, 'texto-acento') + '</td>' +
          (f.ad_honorem ? '<td colspan="3" class="centrado">' + chip('Ad honorem', 'azul') + '</td>'
            : '<td class="num">' + U.pesos(f.comision_ganada) + '</td><td class="num">' + U.pesos(f.comision_pagada) + '</td><td class="num">' + saldo(f.comision_a_pagar, 'texto-azul') + '</td>') +
          '</tr>').join('') : '<tr><td colspan="8" class="suave">Todavía no hay RRPP.</td></tr>') +
        '</tbody><tfoot><tr><td>Total</td><td class="num">' + U.miles(tot('entradas')) + '</td><td class="num">' + U.pesos(tot('efectivo_cobrado')) + '</td>' +
        '<td class="num">' + U.pesos(tot('rendido')) + '</td><td class="num">' + U.pesos(tot('efectivo_a_rendir')) + '</td><td class="num">' + U.pesos(tot('comision_ganada')) + '</td>' +
        '<td class="num">' + U.pesos(tot('comision_pagada')) + '</td><td class="num">' + U.pesos(tot('comision_a_pagar')) + '</td></tr></tfoot></table></div></section>' +
        '<aside class="admin-dos__chico" id="panel">' + panelRendicion(sel) + '</aside></div>';
      if ((r.movimientos || []).length) {
        html += '<section class="tarjeta"><h3>Movimientos</h3><div class="tabla-caja"><table class="tabla"><thead><tr><th>N.º</th><th>Fecha</th><th>RRPP</th><th>Tipo</th><th class="num">Monto</th><th>Nota</th></tr></thead><tbody>' +
          r.movimientos.map((m) => '<tr><td>' + m.nro + '</td><td>' + fechaHora(m.cuando) + '</td><td>' + e(m.rrpp) + '</td><td>' +
            (m.tipo === 'entrega_efectivo' ? 'Entrega de efectivo' : 'Pago de comisión') + '</td><td class="num">' + U.pesos(m.monto) + '</td><td>' + e(m.nota || '') + '</td></tr>').join('') +
          '</tbody></table></div></section>';
      }
      marco(html);
      $$('tr[data-ref]').forEach((tr) => {
        const abrir = () => { st.seleccion = { tipo: 'rendicion', ref: tr.dataset.ref }; st.resultado = null; pRendicion(); $('#panel').scrollIntoView({ block: 'nearest' }); };
        tr.addEventListener('click', abrir);
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(); });
      });
      conectarRendicion(sel);
    }

    function panelRendicion(f) {
      if (st.resultado && st.resultado.tipo === 'comprobante') {
        const m = st.resultado.m;
        return '<section class="tarjeta panel-destacado"><h3>Comprobante N.º ' + m.nro + '</h3>' +
          '<p>' + (m.tipo === 'entrega_efectivo' ? 'Entrega de efectivo' : 'Pago de comisión') + ' · ' + e(m.rrpp) + ' · <strong>' + U.pesos(m.monto) + '</strong></p>' +
          '<p class="suave">' + (m.tipo === 'entrega_efectivo' ? 'Queda por rendir: ' : 'Queda por pagar: ') + U.pesos(m.saldo) + '</p>' +
          '<button class="boton boton--principal boton--ancho" type="button" id="bajar-comprobante">Guardar comprobante (imagen)</button>' +
          '<a class="boton boton--whatsapp boton--ancho" id="wa-comprobante" target="_blank" rel="noopener" href="' + e(urlWhatsApp(U.telWhatsApp(m.telefono || '') || '',
            'Comprobante N.º ' + m.nro + ' · ' + CONFIG.NOMBRE_CLUB + '\n' + (m.tipo === 'entrega_efectivo' ? 'Recibimos tu entrega de efectivo: ' : 'Te pagamos la comisión: ') +
            U.pesos(m.monto) + '\n' + (m.tipo === 'entrega_efectivo' ? 'Te queda por rendir: ' : 'Te queda por cobrar: ') + U.pesos(Math.max(0, m.saldo)) + '\nFecha: ' + U.fechaCorta(m.cuando) + ' ' + U.hora(m.cuando))) + '">' +
          ICONO_WA + ' Enviar por WhatsApp</a>' +
          '<p class="tarjeta__nota">Guardá la imagen y adjuntala en el chat.</p>' +
          '<button class="boton boton--texto boton--ancho" type="button" id="cerrar-panel">Listo</button></section>';
      }
      if (!f) return '<section class="tarjeta"><p class="suave">Tocá un RRPP para registrar una entrega de efectivo o pagarle la comisión.</p></section>';
      const s = st.seleccion;
      const despues = (tipo) => {
        const base = Number(tipo === 'entrega_efectivo' ? f.efectivo_a_rendir : f.comision_a_pagar);
        const m = numero(s[tipo] != null ? s[tipo] : base);
        if (!Number.isFinite(m)) return '';
        const d = base - (m || 0);
        return d === 0 ? '$0 · Al día' : d > 0 ? U.pesos(d) + ' pendiente' : U.pesos(-d) + ' de más';
      };
      const bloque = (tipo, titulo, sub, etiqueta, boton, clase) => {
        const base = Number(tipo === 'entrega_efectivo' ? f.efectivo_a_rendir : f.comision_a_pagar);
        return '<section class="tarjeta ' + clase + '"><h3>' + titulo + '</h3><p class="suave">' + e(f.nombre) + ' · ' + sub + ' ' + U.pesos(base) + '</p>' +
          (s.error && s.errorTipo === tipo ? '<div class="aviso aviso--error" role="alert">' + e(s.error) + '</div>' : '') +
          '<form data-tipo="' + tipo + '" novalidate>' +
          '<label class="campo"><span class="campo__etiqueta">' + etiqueta + '</span><input class="entrada-texto entrada-texto--monto" name="monto" inputmode="numeric" value="' +
          e(s[tipo] != null ? s[tipo] : (base > 0 ? U.miles(base) : '')) + '"></label>' +
          '<p class="despues">Después de esto: <strong data-despues="' + tipo + '">' + despues(tipo) + '</strong></p>' +
          '<label class="campo"><span class="campo__etiqueta">Nota (opcional)</span><input class="entrada-texto" name="nota" value="' + e(s['nota_' + tipo] || '') + '"></label>' +
          '</form><button class="boton ' + (tipo === 'entrega_efectivo' ? 'boton--principal' : 'boton--azul') + ' boton--ancho" type="button" data-registrar="' + tipo + '">' + boton + '</button></section>';
      };
      return bloque('entrega_efectivo', 'Registrar entrega de efectivo', 'a rendir', 'Efectivo recibido', 'Registrar y generar comprobante', 'panel-destacado') +
        (f.ad_honorem ? '' : bloque('pago_comision', 'Pagar comisión', 'le corresponden', 'Monto a pagar', 'Registrar pago y generar comprobante', 'panel-azul')) +
        '<button class="boton boton--texto boton--ancho" type="button" id="cerrar-panel">Cerrar</button>';
    }

    function conectarRendicion(f) {
      const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
      on('cerrar-panel', () => { st.seleccion = null; st.resultado = null; pRendicion(); });
      on('bajar-comprobante', async (ev) => {
        await U.conBoton(ev.currentTarget, async () => {
          const m = st.resultado.m;
          bajarArchivo(await comprobante(m), 'comprobante-' + m.nro + '.png', 'image/png');
          U.avisar('Comprobante guardado.');
        });
      });
      if (!f) return;
      $$('form[data-tipo]').forEach((form) => {
        const tipo = form.dataset.tipo;
        form.monto.addEventListener('input', () => {
          st.seleccion[tipo] = form.monto.value;
          const out = $('[data-despues="' + tipo + '"]');
          const base = Number(tipo === 'entrega_efectivo' ? f.efectivo_a_rendir : f.comision_a_pagar);
          const m = numero(form.monto.value);
          if (out) out.textContent = !Number.isFinite(m) ? '' : (base - (m || 0)) === 0 ? '$0 · Al día' : (base - (m || 0)) > 0 ? U.pesos(base - (m || 0)) + ' pendiente' : U.pesos((m || 0) - base) + ' de más';
        });
        form.nota.addEventListener('input', () => { st.seleccion['nota_' + tipo] = form.nota.value; });
        form.addEventListener('submit', (ev) => ev.preventDefault());
      });
      $$('[data-registrar]').forEach((b) => b.addEventListener('click', () => U.conBoton(b, async () => {
        const tipo = b.dataset.registrar;
        const form = $('form[data-tipo="' + tipo + '"]');
        const monto = numero(form.monto.value);
        st.seleccion.errorTipo = tipo;
        if (!Number.isFinite(monto) || !monto || monto <= 0) { st.seleccion.error = 'Escribí un monto mayor a $0.'; return pRendicion(); }
        try {
          const m = await rpc('registrar_movimiento_rrpp', { p_rrpp_id: f.ref, p_tipo: tipo, p_monto: monto, p_nota: form.nota.value.trim() || null });
          st.resultado = { tipo: 'comprobante', m };
          st.seleccion = { tipo: 'rendicion', ref: f.ref };
          st.rendicion = await rpc('rendicion_admin');
          st.tablero = null;
          pRendicion();
        } catch (err) { st.seleccion.error = U.mensajeDeError(err); pRendicion(); }
      })));
    }

    // ======================= Evento y tandas =======================
    async function sEvento() {
      cargando('Evento y tandas');
      try { st.evento = await rpc('evento_admin'); } catch (err) { return avisoError(err); }
      pEvento();
    }

    function pEvento() {
      if (st.seccion !== 'evento') return;
      const d = st.evento;
      const ev = d.evento;
      const c = d.config || {};
      const s = st.seleccion && st.seleccion.tipo === 'tanda' ? st.seleccion : null;
      const tandaSel = s && s.ref ? d.tandas.find((t) => t.ref === s.ref) : null;
      const sumaRrpp = d.tandas.reduce((a, t) => a + Number(t.cantidad), 0);
      const campo = (n, etq, val, extra) => '<label class="campo"><span class="campo__etiqueta">' + etq + '</span><input class="entrada-texto" name="' + n + '" value="' + e(val == null ? '' : val) + '"' + (extra || '') + '></label>';
      let html = '<div class="admin-titulo"><h2>Evento y tandas</h2></div>' +
        (st.errorEvento ? '<div class="aviso aviso--error" role="alert" id="error-evento">' + e(st.errorEvento) + '</div>' : '') +
        '<div class="admin-dos"><section class="tarjeta admin-dos__chico"><h3>Evento</h3><form id="form-evento" class="grilla-form" novalidate>' +
        campo('nombre', 'Nombre', ev.nombre) + campo('artista', 'Artista', ev.artista) +
        campo('fecha', 'Fecha y hora', aLocal(ev.fecha), ' type="datetime-local"') + campo('lugar', 'Lugar', ev.lugar, ' placeholder="Ej.: Salón comunal · Landeta"') +
        campo('tope', 'Tope general', U.miles(ev.tope), ' inputmode="numeric"') + campo('aviso_desde', 'Avisar desde', ev.aviso_desde ? U.miles(ev.aviso_desde) : '', ' inputmode="numeric"') +
        campo('max_por_venta', 'Máximo por venta', ev.max_por_venta, ' inputmode="numeric"') + campo('cierre_venta_rrpp', 'Cierre venta RRPP', aLocal(ev.cierre_venta_rrpp), ' type="datetime-local"') +
        '<label class="campo"><span class="campo__etiqueta">Estado</span><select class="entrada-texto" name="estado">' +
        [['borrador', 'Borrador (no se vende)'], ['venta', 'A la venta'], ['cerrado', 'Cerrado']].map(([v, t]) => '<option value="' + v + '"' + (ev.estado === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        '<h4 class="grilla-form__ancho separado">Datos para transferencias</h4><p class="grilla-form__ancho tarjeta__nota">Les aparecen a todos los RRPP y a la caja.</p>' +
        campo('alias', 'Alias', c.alias) + campo('cbu_cvu', 'CBU / CVU', c.cbu_cvu, ' inputmode="numeric"') +
        campo('titular', 'Titular', c.titular) + campo('entidad', 'Banco o billetera', c.entidad) +
        '</form><p class="tarjeta__nota">El tope se puede mover. No puede quedar por debajo de las ' + U.plural(d.emitidas, 'entrada', 'entradas') + ' ya emitidas.</p>' +
        '<button class="boton boton--principal boton--ancho" type="submit" form="form-evento" id="guardar-evento">Guardar cambios</button></section>' +
        '<section class="tarjeta admin-dos__grande"><div class="admin-titulo"><h3>Tandas</h3><button class="boton" type="button" id="nueva-tanda">Nueva tanda</button></div>' +
        '<div class="tabla-caja"><table class="tabla tabla--clic"><thead><tr><th>Tanda</th><th>Vende</th><th class="num">Precio</th><th>Desde</th><th>Hasta</th><th class="num">Cantidad</th><th class="num">Emitidas</th><th>Estado</th></tr></thead><tbody>' +
        d.tandas.map((t) => '<tr data-ref="' + e(t.ref) + '" tabindex="0"' + (tandaSel && tandaSel.ref === t.ref ? ' class="fila-sel"' : '') + '><td><strong>' + e(t.nombre) + '</strong></td><td>' + (t.canal === 'rrpp' ? 'RRPP' : 'Caja') + '</td>' +
          '<td class="num">' + U.pesos(t.precio) + '</td><td>' + (t.desde ? fechaHora(t.desde) : '—') + '</td><td>' + (t.hasta ? fechaHora(t.hasta) : '—') + '</td>' +
          '<td class="num">' + U.miles(t.cantidad) + '</td><td class="num">' + U.miles(t.emitidas) + (t.quedan > 0 ? ' <span class="suave">· quedan ' + U.miles(t.quedan) + '</span>' : '') + '</td>' +
          '<td>' + chip(ESTADO_TANDA[t.estado][0], ESTADO_TANDA[t.estado][1]) + '</td></tr>').join('') +
        '</tbody></table></div>' +
        '<div class="nota-gris"><p><strong>Suma de tandas: ' + U.miles(sumaRrpp) + '</strong> · Tope general: ' + U.miles(ev.tope) + ' · Cortesías emitidas: ' + U.miles(d.cortesias) + '</p>' +
        (sumaRrpp > ev.tope ? '<p><strong>El tope general manda: se van a vender como máximo ' + U.miles(ev.tope) + '.</strong></p>' : '') +
        '<p class="suave">Si una tanda se agota, aparece la siguiente para vender aunque no haya llegado su fecha. El tope general siempre manda.</p></div>' +
        (s ? panelTanda(s, tandaSel) : '') + '</section></div>';
      marco(html);
      $$('tr[data-ref]').forEach((tr) => {
        const abrir = () => { st.seleccion = { tipo: 'tanda', ref: tr.dataset.ref }; pEvento(); const p = $('#form-tanda'); if (p) p.scrollIntoView({ block: 'nearest' }); };
        tr.addEventListener('click', abrir);
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(); });
      });
      $('#nueva-tanda').addEventListener('click', () => { st.seleccion = { tipo: 'tanda', ref: null }; pEvento(); const p = $('#form-tanda'); if (p) p.scrollIntoView({ block: 'nearest' }); });
      const fe = $('#form-evento');
      fe.addEventListener('submit', (ev) => {
        ev.preventDefault();
        U.conBoton($('#guardar-evento'), async () => {
          st.errorEvento = null;
          const datos = {
            nombre: fe.nombre.value, artista: fe.artista.value, lugar: fe.lugar.value, fecha: deLocal(fe.fecha.value),
            tope: numero(fe.tope.value), aviso_desde: numero(fe.aviso_desde.value), max_por_venta: numero(fe.max_por_venta.value),
            cierre_venta_rrpp: deLocal(fe.cierre_venta_rrpp.value), estado: fe.estado.value,
          };
          if ([datos.tope, datos.aviso_desde, datos.max_por_venta].some((x) => Number.isNaN(x))) { st.errorEvento = 'Revisá los números cargados.'; return pEvento(); }
          try {
            await rpc('ajustar_evento', { p_evento_id: null, p_datos: datos });
            st.evento = await rpc('ajustar_config_club', { p_datos: { alias: fe.alias.value, cbu_cvu: fe.cbu_cvu.value, titular: fe.titular.value, entidad: fe.entidad.value } });
            st.tablero = null;
            U.avisar('Cambios guardados.');
            pEvento();
          } catch (err) { st.errorEvento = U.mensajeDeError(err); try { st.evento = await rpc('evento_admin'); } catch (_) { /* nada */ } pEvento(); }
        });
      });
      conectarTanda(s, tandaSel);
    }

    function panelTanda(s, t) {
      const v = t || { nombre: '', canal: 'rrpp', precio: '', cantidad: '', desde: null, hasta: null };
      return '<section class="panel-tanda"><h3>' + (t ? 'Editar tanda ' + e(t.nombre) : 'Nueva tanda') + '</h3>' +
        (s.error ? '<div class="aviso aviso--error" role="alert">' + e(s.error) + '</div>' : '') +
        '<form id="form-tanda" class="grilla-form" novalidate>' +
        '<label class="campo"><span class="campo__etiqueta">Nombre</span><input class="entrada-texto" name="nombre" value="' + e(v.nombre) + '"></label>' +
        '<label class="campo"><span class="campo__etiqueta">Vende</span><select class="entrada-texto" name="canal"><option value="rrpp"' + (v.canal === 'rrpp' ? ' selected' : '') + '>RRPP</option><option value="caja"' + (v.canal === 'caja' ? ' selected' : '') + '>Caja (puerta)</option></select></label>' +
        '<label class="campo"><span class="campo__etiqueta">Precio</span><input class="entrada-texto" name="precio" inputmode="numeric" value="' + e(v.precio === '' ? '' : U.miles(v.precio)) + '"></label>' +
        '<label class="campo"><span class="campo__etiqueta">Cantidad</span><input class="entrada-texto" name="cantidad" inputmode="numeric" value="' + e(v.cantidad === '' ? '' : U.miles(v.cantidad)) + '"></label>' +
        '<label class="campo"><span class="campo__etiqueta">Desde</span><input class="entrada-texto" name="desde" type="datetime-local" value="' + e(aLocal(v.desde)) + '"></label>' +
        '<label class="campo"><span class="campo__etiqueta">Hasta</span><input class="entrada-texto" name="hasta" type="datetime-local" value="' + e(aLocal(v.hasta)) + '"></label>' +
        '</form>' + (t && t.emitidas > 0 ? '<p class="tarjeta__nota">Ya tiene ' + U.plural(t.emitidas, 'entrada emitida', 'entradas emitidas') + ': la cantidad no puede bajar de ahí. Si cambiás el precio, las ventas hechas mantienen el suyo.</p>' : '') +
        '<div class="botones-fila"><button class="boton boton--principal" type="submit" form="form-tanda" id="guardar-tanda">Guardar tanda</button>' +
        '<button class="boton" type="button" id="cancelar-tanda">Cancelar</button></div>' +
        (t && t.emitidas === 0 ? '<button class="boton boton--texto boton--peligro-texto boton--ancho" type="button" id="borrar-tanda">Borrar tanda</button>' : '') +
        '</section>';
    }

    function conectarTanda(s, t) {
      const f = $('#form-tanda');
      if (!f) return;
      $('#cancelar-tanda').addEventListener('click', () => { st.seleccion = null; pEvento(); });
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        U.conBoton($('#guardar-tanda'), async () => {
          const datos = { nombre: f.nombre.value, canal: f.canal.value, precio: numero(f.precio.value), cantidad: numero(f.cantidad.value),
                          desde: deLocal(f.desde.value), hasta: deLocal(f.hasta.value) };
          if (Number.isNaN(datos.precio) || Number.isNaN(datos.cantidad)) { st.seleccion.error = 'Revisá el precio y la cantidad.'; return pEvento(); }
          try { st.evento = await rpc('ajustar_tanda', { p_tanda_id: t ? t.ref : null, p_datos: datos }); st.seleccion = null; st.tablero = null; U.avisar('Tanda guardada.'); pEvento(); }
          catch (err) { st.seleccion.error = U.mensajeDeError(err); pEvento(); }
        });
      });
      const b = $('#borrar-tanda');
      if (b) b.addEventListener('click', async () => {
        if (!(await U.confirmar('¿Borrar la tanda ' + t.nombre + '?', 'Sí, borrar', 'Cancelar'))) return;
        try { st.evento = await rpc('ajustar_tanda', { p_tanda_id: t.ref, p_datos: { borrar: true } }); st.seleccion = null; U.avisar('Tanda borrada.'); pEvento(); }
        catch (err) { st.seleccion.error = U.mensajeDeError(err); pEvento(); }
      });
    }

    // ======================= Auditoría =======================
    const ACCIONES = {
      emitir_venta: 'Emitió una venta', reenviar_link: 'Reenvió el link', pasar_entrada: 'El comprador pasó una entrada',
      anular_venta: 'Anuló una venta', emitir_cortesia: 'Emitió una cortesía', confirmar_transferencias: 'Confirmó transferencias',
      desconfirmar_transferencias: 'Quitó la confirmación de transferencias', movimiento_rrpp: 'Registró un movimiento de rendición',
      ajustar_rrpp: 'Cambió las condiciones de un RRPP', ajustar_evento: 'Cambió el evento', ajustar_tanda: 'Cambió una tanda',
      crear_tanda: 'Creó una tanda', borrar_tanda: 'Borró una tanda', ajustar_config_club: 'Cambió los datos para transferir',
      crear_usuario: 'Creó un usuario', restablecer_clave: 'Generó una contraseña nueva', activar_usuario: 'Activó un usuario',
      desactivar_usuario: 'Desactivó un usuario', ingreso: 'Ingreso en la puerta', intento_duplicado: 'Intento de ingreso repetido',
      ingreso_no_valido: 'QR no válido en la puerta', ingreso_anulada: 'Intentaron entrar con una entrada anulada',
      deshacer_ingreso: 'Deshizo un ingreso', venta_puerta: 'Venta en puerta', venta_puerta_sobre_tope: 'Venta en puerta por encima del tope',
      anonimizar: 'Anonimizó los datos personales',
    };
    function detalleAuditoria(a) {
      const d = a.detalle || {};
      const partes = [];
      if (a.sobre) partes.push(a.sobre);
      if (d.cantidad) partes.push(U.plural(d.cantidad, 'entrada', 'entradas'));
      if (d.monto) partes.push(U.pesos(d.monto));
      if (d.tipo) partes.push(d.tipo === 'entrega_efectivo' ? 'entrega de efectivo' : 'pago de comisión');
      if (d.motivo) partes.push('Motivo: ' + d.motivo);
      if (d.nota) partes.push('Nota: ' + d.nota);
      if (d.nombre && !a.sobre) partes.push(d.nombre);
      if (d.cambiadas != null) partes.push(U.plural(d.cambiadas, 'venta', 'ventas'));
      if (d.dispositivo) partes.push('Celular ' + d.dispositivo);
      if (d.despues && d.despues.comision != null) partes.push('Comisión ' + U.pesos(d.despues.comision));
      return partes.join(' · ');
    }
    async function sAuditoria() {
      cargando('Auditoría');
      try { st.auditoria = await rpc('auditoria_admin', { p_filtros: st.filtroAuditoria ? { accion: st.filtroAuditoria } : {} }); } catch (err) { return avisoError(err); }
      if (st.seccion !== 'auditoria') return;
      marco('<div class="admin-titulo"><h2>Auditoría</h2></div><p class="suave">Quién hizo qué y cuándo (últimos 300 registros).</p>' +
        '<label class="campo admin-filtro-corto"><span class="campo__etiqueta">Mostrar</span><select class="entrada-texto" id="filtro-auditoria">' +
        '<option value="">Todo</option>' + Object.entries(ACCIONES).map(([k, t]) => '<option value="' + k + '"' + (st.filtroAuditoria === k ? ' selected' : '') + '>' + e(t) + '</option>').join('') +
        '</select></label><section class="tarjeta"><div class="tabla-caja"><table class="tabla"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead><tbody>' +
        (st.auditoria.length ? st.auditoria.map((a) => '<tr><td>' + fechaHora(a.cuando) + '</td><td>' + e(a.quien || 'Comprador') + '</td>' +
          '<td>' + e(ACCIONES[a.accion] || a.accion.replace(/_/g, ' ')) + '</td><td>' + e(detalleAuditoria(a)) + '</td></tr>').join('')
          : '<tr><td colspan="4" class="suave">Sin registros.</td></tr>') + '</tbody></table></div></section>');
      $('#filtro-auditoria').addEventListener('change', (ev) => { st.filtroAuditoria = ev.target.value; sAuditoria(); });
    }

    // ======================= Exportar y cierre =======================
    const EXPORTES = [['ventas', 'Ventas'], ['entradas', 'Entradas'], ['rendiciones', 'Rendiciones'], ['movimientos', 'Movimientos de rendición'], ['ingresos', 'Ingresos en la puerta']];
    async function exportar(tipo) {
      const filas = await rpc('exportar_admin', { p_tipo: tipo });
      bajarArchivo(csv(filas), tipo + '-' + hoy() + '.csv');
    }
    async function sExportar() {
      cargando('Exportar y cierre');
      try {
        const [c, ev] = await Promise.all([rpc('resumen_cierre'), rpc('evento_admin')]);
        st.cierre = c; st.evento = ev;
      } catch (err) { return avisoError(err); }
      if (st.seccion !== 'exportar') return;
      const c = st.cierre;
      const cerrado = st.evento.evento.estado === 'cerrado';
      const canalTxt = (x) => x.canal === 'caja' ? 'Puerta' : x.canal === 'cortesia' ? 'Cortesía' : 'RRPP';
      marco('<div class="admin-titulo"><h2>Exportar y cierre</h2></div>' +
        '<section class="tarjeta"><h3>Exportar a Excel (CSV)</h3><p class="suave">Separado por punto y coma, listo para Excel en castellano. Sirve también como respaldo diario.</p>' +
        '<div class="botones-exportar">' + EXPORTES.map(([k, t]) => '<button class="boton" type="button" data-exportar="' + k + '">' + t + '</button>').join('') +
        '<button class="boton boton--principal" type="button" id="exportar-todo">Descargar todo (respaldo)</button></div></section>' +
        '<section class="tarjeta"><h3>Resumen del evento</h3>' +
        '<div class="admin-kpis">' +
        '<div><p class="tarjeta__etiqueta">Entradas emitidas</p><p class="tarjeta__dato">' + U.miles(c.emitidas) + '</p></div>' +
        '<div><p class="tarjeta__etiqueta">Ingresaron</p><p class="tarjeta__dato">' + U.miles(c.ingresaron) + '</p><p class="tarjeta__nota">No vinieron: ' + U.miles(c.no_ingresaron) + '</p></div>' +
        '<div><p class="tarjeta__etiqueta">Recaudado</p><p class="tarjeta__dato">' + U.pesos(c.recaudado) + '</p><p class="tarjeta__nota">Efectivo ' + U.pesos(c.efectivo) + ' · Transferencias ' + U.pesos(c.transferencias) + '</p></div>' +
        '<div><p class="tarjeta__etiqueta">Comisiones</p><p class="tarjeta__dato">' + U.pesos(c.comisiones) + '</p><p class="tarjeta__nota">Anuladas: ' + U.plural(c.anuladas, 'entrada', 'entradas') + '</p></div>' +
        '</div><div class="tabla-caja"><table class="tabla"><thead><tr><th>Tanda</th><th>Canal</th><th class="num">Entradas</th><th class="num">Total</th></tr></thead><tbody>' +
        c.por_tanda.map((x) => '<tr><td>' + e(x.tanda) + '</td><td>' + canalTxt(x) + '</td><td class="num">' + U.miles(x.entradas) + '</td><td class="num">' + U.pesos(x.total) + '</td></tr>').join('') +
        '</tbody></table></div>' +
        (c.ingresos_hora.length ? '<h4 class="separado">Ingresos por hora</h4><div class="tabla-caja"><table class="tabla"><tbody>' +
          c.ingresos_hora.map((x) => '<tr><td>' + e(x.hora) + '</td><td class="num">' + U.miles(x.n) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
        '<button class="boton boton--ancho" type="button" id="exportar-cierre">Descargar resumen (CSV)</button></section>' +
        '<section class="tarjeta"><h3>Datos personales</h3>' +
        (cerrado
          ? '<p>Borra los DNI y teléfonos de este evento. No se puede deshacer. No pasa sola: la hacés vos cuando quieras.</p>' +
            '<label class="campo"><span class="campo__etiqueta">Para confirmar, escribí ANONIMIZAR</span><input class="entrada-texto" id="confirmar-anonimizar" autocomplete="off"></label>' +
            '<button class="boton boton--peligro boton--ancho" type="button" id="anonimizar">Anonimizar DNI y teléfonos</button>'
          : '<p class="suave">Cuando cierres el evento vas a poder borrar los DNI y teléfonos desde acá. No pasa solo.</p>') +
        '</section>');
      $$('[data-exportar]').forEach((b) => b.addEventListener('click', () => U.conBoton(b, async () => {
        try { await exportar(b.dataset.exportar); } catch (err) { avisoError(err); }
      })));
      $('#exportar-todo').addEventListener('click', (ev) => U.conBoton(ev.currentTarget, async () => {
        try { for (const [k] of EXPORTES) await exportar(k); U.avisar('Respaldo descargado.'); } catch (err) { avisoError(err); }
      }));
      $('#exportar-cierre').addEventListener('click', () => {
        bajarArchivo(csv(c.por_tanda.map((x) => ({ Tanda: x.tanda, Canal: canalTxt(x), Entradas: x.entradas, Total: Number(x.total) }))
          .concat([{ Tanda: 'Total emitidas', Canal: '', Entradas: c.emitidas, Total: Number(c.recaudado) },
                   { Tanda: 'Ingresaron', Canal: '', Entradas: c.ingresaron, Total: '' },
                   { Tanda: 'Comisiones', Canal: '', Entradas: '', Total: Number(c.comisiones) }])
          .concat(c.ingresos_hora.map((x) => ({ Tanda: 'Ingresos ' + x.hora, Canal: '', Entradas: x.n, Total: '' })))), 'cierre-' + hoy() + '.csv');
      });
      const an = $('#anonimizar');
      if (an) an.addEventListener('click', () => U.conBoton(an, async () => {
        try {
          const r = await rpc('anonimizar_datos_personales', { p_evento_id: null, p_confirmacion: $('#confirmar-anonimizar').value.trim() });
          U.avisar('Listo: ' + U.plural(r.ventas, 'venta anonimizada', 'ventas anonimizadas') + '.');
        } catch (err) { avisoError(err); }
      }));
    }

    // ---------------- Navegación ----------------
    const CARGAR = { tablero: sTablero, ventas: sVentas, rrpp: sRrpp, transferencias: sTransferencias, rendicion: sRendicion,
                     evento: sEvento, auditoria: sAuditoria, exportar: sExportar };
    function irA() {
      const s = (location.hash || '#tablero').slice(1);
      const sec = CARGAR[s] ? s : 'tablero';
      if (sec !== st.seccion) { st.seleccion = null; st.resultado = null; }
      st.seccion = sec;
      clearInterval(timerTablero);
      if (sec === 'tablero') timerTablero = setInterval(() => { if (document.visibilityState === 'visible' && st.seccion === 'tablero') sTablero(true); }, 15000);
      CARGAR[sec]();
    }
    window.addEventListener('hashchange', irA);
    window.onpopstate = null;
    irA();
  }

  window.APPS.admin = montar;
})();
