// App del RRPP: Inicio, Nueva entrada, Entrada lista, Mis ventas y Detalle.
// Emitir en 3 toques: Nueva entrada → Emitir → Enviar por WhatsApp.
// Precio, comisión, límites y tope los decide la base: acá solo se muestran.
(function () {
  'use strict';

  const e = U.escaparHTML;
  const CACHE = 'entradas-cache-rrpp';

  const ICONO_VOLVER = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICONO_MAS = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const ICONO_OK = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICONO_WA = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.6-5.5A8.4 8.4 0 1 1 21 11.5z"/></svg>';

  const MEDIO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };
  const SIN_SENAL_EMITIR = 'Sin conexión. Para emitir entradas necesitás internet.';

  function montar(raiz, perfil, ctx) {
    const st = {
      datos: U.leer(CACHE),         // último inicio_rrpp (sirve sin señal)
      transf: U.leer(CACHE + '-transf'),
      form: null,                   // formulario de Nueva entrada en curso
      lista: null,                  // última venta emitida/reenviada { venta, evento, token }
      detalle: null,
      offline: false,
    };

    // ---------------- Navegación (botón atrás de Android) ----------------
    const PANTALLAS = { inicio: pInicio, nueva: pNueva, lista: pLista, ventas: pVentas, detalle: pDetalle };
    function ir(nombre, reemplazar) {
      const estado = { rrpp: nombre };
      if (reemplazar) history.replaceState(estado, ''); else history.pushState(estado, '');
      PANTALLAS[nombre]();
      if (nombre === 'inicio') refrescarInicio();
    }
    // Muestra lo guardado al instante y actualiza en cuanto llega lo nuevo.
    async function refrescarInicio() {
      const r = await refrescar();
      if (r !== null && history.state && history.state.rrpp === 'inicio') pInicio();
    }
    window.onpopstate = (ev) => {
      const n = ev.state && ev.state.rrpp;
      if (n && PANTALLAS[n] && (n !== 'lista' || st.lista) && (n !== 'detalle' || st.detalle)) PANTALLAS[n]();
      else pInicio();
      if (!n || n === 'inicio') refrescarInicio();
    };
    function volver() { if (history.state && history.state.rrpp && history.state.rrpp !== 'inicio') history.back(); else ir('inicio', true); }

    function render(html) { ctx.mostrar(html); }
    function $(s) { return raiz.querySelector(s); }
    function $$(s) { return [...raiz.querySelectorAll(s)]; }

    function encabezadoSub(titulo, sub) {
      return '<header class="encabezado encabezado--sub">' +
        '<button class="volver" type="button" id="volver" aria-label="Volver">' + ICONO_VOLVER + '</button>' +
        '<div class="encabezado__textos"><h1>' + e(titulo) + '</h1>' + (sub ? '<p>' + e(sub) + '</p>' : '') + '</div>' +
        '<div class="encabezado__acciones">' + ctx.VERSION + '</div>' +
        '</header>';
    }
    function conectarVolver() { const b = $('#volver'); if (b) b.addEventListener('click', volver); }

    async function manejarError(err, mostrarEn) {
      if (ctx.esSesionInvalida(err)) { await ctx.sesionInvalida(err); return true; }
      if (mostrarEn) mostrarEn(U.mensajeDeError(err));
      return false;
    }

    // ---------------- Datos ----------------
    async function refrescar() {
      try {
        const d = await API.rpc('inicio_rrpp');
        st.datos = d; st.offline = false;
        U.guardar(CACHE, d);
        return true;
      } catch (err) {
        if (ctx.esSesionInvalida(err)) { await ctx.sesionInvalida(err); return null; }
        st.offline = U.esErrorDeRed(err);
        if (!st.offline) U.avisar(U.mensajeDeError(err));
        return false;
      }
    }

    async function datosTransferencia() {
      try {
        const filas = await API.rpc('datos_transferencia');
        const d = Array.isArray(filas) ? filas[0] : filas;
        if (d) { st.transf = d; U.guardar(CACHE + '-transf', d); }
      } catch (err) {
        if (ctx.esSesionInvalida(err)) return ctx.sesionInvalida(err);
      }
      return st.transf;
    }

    // ---------------- Textos ----------------
    function estadoVenta(v) {
      if (v.estado === 'anulada') return '<span class="chip chip--error">Anulada</span>';
      if (v.ingresaron > 0) {
        return '<span class="chip chip--ok">' +
          (v.cantidad === 1 ? 'Ingresó' : (v.ingresaron === v.cantidad ? 'Ingresaron' : 'Ingresaron ' + v.ingresaron + ' de ' + v.cantidad)) + '</span>';
      }
      return v.enviada ? '<span class="chip chip--ok">Enviada</span>' : '<span class="chip chip--pendiente">Sin enviar</span>';
    }

    function filaVenta(v, i) {
      return '<button class="fila-venta" type="button" data-i="' + i + '">' +
        '<span><p class="fila-venta__nombre">' + e(v.nombre) + '</p>' +
        '<p class="fila-venta__detalle">' + e(U.plural(v.cantidad, 'entrada', 'entradas')) + ' · ' + e(MEDIO[v.medio] || '') + '</p></span>' +
        estadoVenta(v) + '</button>';
    }

    function conectarFilas(lista) {
      $$('.fila-venta').forEach((b) => b.addEventListener('click', () => abrirDetalle(lista[Number(b.dataset.i)])));
    }

    function linkEntrada(token) {
      return new URL('entrada.html#t=' + token, location.href).href;
    }

    function mensajeWhatsApp(venta, evento, link) {
      const nombre = U.primerNombre(venta.nombre);
      const quien = evento ? (evento.artista || evento.nombre) : 'el baile';
      const cuando = evento && evento.fecha ? ', ' + U.diaEvento(evento.fecha) : '';
      const una = venta.cantidad === 1;
      return '¡Hola ' + nombre + '! ' +
        (una ? 'Esta es tu entrada' : 'Estas son tus ' + venta.cantidad + ' entradas') +
        ' para *' + quien + '*' + cuando + '.\n' +
        'Abrí el link e ingresá tu DNI para ver ' + (una ? 'tu QR' : 'tus QR') + ':\n' +
        link + '\n' +
        'Guardá la imagen: en la puerta puede no haber señal.';
    }

    function urlWhatsApp(tel, texto) {
      return 'https://wa.me/' + (tel || '') + '?text=' + encodeURIComponent(texto);
    }

    function textoDatosClub(t) {
      return 'Datos para transferir al ' + CONFIG.NOMBRE_CLUB + ':\n' +
        (t.alias ? 'Alias: ' + t.alias + '\n' : '') +
        (t.cbu_cvu ? 'CBU/CVU: ' + t.cbu_cvu + '\n' : '') +
        (t.titular ? 'Titular: ' + t.titular + '\n' : '') +
        (t.entidad ? 'Banco: ' + t.entidad + '\n' : '') +
        'Después mandame el comprobante.';
    }

    // ======================= Inicio =======================
    function pInicio() {
      const d = st.datos;
      const ev = d && d.evento;
      const nombre = U.primerNombre((d && d.nombre) || perfil.nombre);
      let html =
        '<header class="encabezado encabezado--hero oscura">' +
        '<div class="fila"><p class="evento">' + (ev ? e((ev.artista || ev.nombre) + (ev.fecha ? ' · ' + U.diaCorto(ev.fecha) : '')) : '&nbsp;') + '</p>' +
        ctx.VERSION + '</div>' +
        '<div class="fila"><h1>Hola, ' + e(nombre) + '</h1>' +
        '<button class="boton boton--texto" type="button" id="salir">Salir</button></div>' +
        '</header><main class="contenido pantalla">';

      if (!d) {
        html += st.offline
          ? '<div class="aviso aviso--alerta">Sin conexión. Cuando vuelva la señal vas a ver tus ventas.</div>'
          : '<p class="suave centrado">Cargando…</p>';
        render(html + '</main>');
        $('#salir').addEventListener('click', ctx.salir);
        return;
      }

      if (st.offline) html += '<div class="aviso aviso--alerta">Sin conexión. Estás viendo lo último guardado.</div>';
      if (d.aviso_tanda) html += '<div class="aviso aviso--alerta" role="status">' + e(d.aviso_tanda) + '</div>';
      if (!d.puede_vender && d.motivo) html += '<div class="aviso aviso--alerta">' + e(d.motivo) + '</div>';

      if (d.tanda) {
        html += '<section class="tanda-vigente">' +
          '<div><p class="tanda-vigente__etiqueta">Tanda vigente</p>' +
          '<p class="tanda-vigente__precio">' + e(d.tanda.nombre) + ' · ' + U.pesos(d.tanda.precio) + '</p></div>' +
          (d.tanda.hasta ? '<p class="tanda-vigente__hasta">hasta el ' + U.diaMes(d.tanda.hasta) + '</p>' : '') +
          '</section>';
      }

      html += '<button class="boton boton--principal boton--ancho boton--grande" type="button" id="nueva"' +
        (d.puede_vender ? '' : ' disabled') + '>' + ICONO_MAS + ' Nueva entrada</button>';

      // Tarjetas
      const t = d.tanda;
      const conLimite = t && t.limite != null;
      html += '<section class="tarjetas tarjetas--2">';
      html += '<div class="tarjeta"><p class="tarjeta__etiqueta">Vendidas</p>' +
        '<p class="tarjeta__dato">' + U.miles(d.vendidas) + '</p>' +
        (conLimite
          ? '<div class="barra-progreso" aria-hidden="true"><span data-ancho="' + Math.min(100, Math.round(100 * t.vendidas / Math.max(1, t.limite))) + '"></span></div>' +
            '<p class="tarjeta__nota">' + (t.te_quedan === 0 ? 'No te quedan en esta tanda' : 'Te ' + (t.te_quedan === 1 ? 'queda 1' : 'quedan ' + U.miles(t.te_quedan)) + ' en esta tanda') + '</p>'
          : '') +
        '</div>';
      if (!d.ad_honorem) {
        html += '<div class="tarjeta"><p class="tarjeta__etiqueta">Tu comisión</p>' +
          '<p class="tarjeta__dato">' + U.pesos(d.comision_ganada) + '</p>' +
          '<p class="tarjeta__nota">Te corresponde · cobrado ' + U.pesos(d.comision_pagada) + '</p></div>';
      }
      html += '<div class="tarjeta tarjeta--ancha">' +
        '<div><p class="tarjeta__etiqueta">Efectivo a rendir</p>' +
        '<p class="tarjeta__dato">' + U.pesos(d.efectivo_a_rendir) + '</p>' +
        '<p class="tarjeta__nota">' + (d.efectivo_rendido > 0 ? 'Ya rendiste ' + U.pesos(d.efectivo_rendido) : 'Todo lo que cobraste en efectivo') + '</p></div>' +
        '<div class="derecha"><p class="tarjeta__etiqueta">Transferencias</p>' +
        '<p class="tarjeta__dato tarjeta__dato--chico">' + U.pesos(d.transferencias) + '</p>' +
        '<p class="tarjeta__nota">van al club</p></div>' +
        '</div></section>';

      // Ventas recientes
      const ventas = d.ventas || [];
      html += '<section class="lista"><div class="lista__titulo"><h2>Mis ventas</h2>' +
        (ventas.length > 5 ? '<button class="boton boton--texto" type="button" id="ver-todas">Ver todas</button>' : '') +
        '</div>' +
        (ventas.length ? ventas.slice(0, 5).map(filaVenta).join('') : '<p class="lista__vacia">Todavía no vendiste entradas.</p>') +
        '</section></main>';

      render(html);
      $$('[data-ancho]').forEach((b) => { b.style.width = b.dataset.ancho + '%'; });   // CSSOM: permitido por el CSP
      $('#salir').addEventListener('click', ctx.salir);
      const bNueva = $('#nueva');
      if (bNueva) bNueva.addEventListener('click', () => { st.form = null; ir('nueva'); });
      const bTodas = $('#ver-todas');
      if (bTodas) bTodas.addEventListener('click', () => ir('ventas'));
      conectarFilas(ventas);
    }

    // ======================= Nueva entrada =======================
    function formNuevo() {
      return { idem: U.nuevaClave(), nombre: '', dni: '', tel: '', cantidad: 1, medio: 'efectivo', error: null, campo: null };
    }

    function pNueva() {
      const d = st.datos;
      if (!st.form) st.form = formNuevo();
      const f = st.form;
      const t = d && d.tanda;
      const max = (d && d.max_por_venta) || 6;
      const precio = t ? Number(t.precio) : 0;
      const error = f.error || (!navigator.onLine ? SIN_SENAL_EMITIR : null);

      const inv = (c) => (f.campo === c ? ' aria-invalid="true"' : '');
      render(
        encabezadoSub('Nueva entrada', t ? t.nombre + ' · ' + U.pesos(precio) + ' cada una' : '') +
        '<main class="contenido pantalla">' +
        (error ? '<div class="aviso aviso--error" role="alert" id="error">' + e(error) + '</div>' : '') +
        '<form id="form-venta" novalidate>' +
        '<label class="campo"><span class="campo__etiqueta">Nombre y apellido</span>' +
        '<input class="entrada-texto" name="nombre" autocomplete="off" autocapitalize="words" maxlength="80" value="' + e(f.nombre) + '"' + inv('nombre') + (f.nombre ? '' : ' autofocus') + '></label>' +
        '<div class="dos-col campo">' +
        '<label class="campo"><span class="campo__etiqueta">DNI</span>' +
        '<input class="entrada-texto" name="dni" inputmode="numeric" autocomplete="off" maxlength="10" value="' + e(f.dni) + '"' + inv('dni') + '></label>' +
        '<label class="campo"><span class="campo__etiqueta">WhatsApp</span>' +
        '<input class="entrada-texto" name="tel" type="tel" inputmode="tel" autocomplete="off" placeholder="3401 551234" value="' + e(f.tel) + '"' + inv('tel') + '></label>' +
        '</div>' +
        '<div class="campo"><span class="campo__etiqueta" id="et-cant">Cantidad</span>' +
        '<div class="contador" role="group" aria-labelledby="et-cant">' +
        '<button type="button" id="menos" aria-label="Una menos"' + (f.cantidad <= 1 ? ' disabled' : '') + '>−</button>' +
        '<output id="cantidad" aria-live="polite">' + f.cantidad + '</output>' +
        '<button type="button" id="mas" aria-label="Una más"' + (f.cantidad >= max ? ' disabled' : '') + '>+</button>' +
        '</div></div>' +
        '<div class="campo"><span class="campo__etiqueta" id="et-medio">¿Cómo cobraste?</span>' +
        '<div class="opciones" role="group" aria-labelledby="et-medio">' +
        '<button type="button" class="opcion" data-medio="efectivo" aria-pressed="' + (f.medio === 'efectivo') + '">Efectivo</button>' +
        '<button type="button" class="opcion" data-medio="transferencia" aria-pressed="' + (f.medio === 'transferencia') + '">Transferencia al club</button>' +
        '</div></div>' +
        '<div id="datos-club"></div>' +
        '<div class="total campo"><p>Total a cobrar</p><p class="total__monto" id="total">' + U.pesos(precio * f.cantidad) + '</p></div>' +
        '</form>' +
        '<div class="pie-accion">' +
        '<button class="boton boton--principal boton--ancho boton--grande" type="submit" form="form-venta" id="emitir">' +
        (f.cantidad === 1 ? 'Emitir entrada' : 'Emitir ' + f.cantidad + ' entradas') + '</button>' +
        '<p class="suave centrado">Los datos se usan solo para la entrada al evento.</p>' +
        '</div></main>');
      conectarVolver();

      const form = $('#form-venta');
      ['nombre', 'dni', 'tel'].forEach((c) => form[c].addEventListener('input', () => { f[c] = form[c].value; }));
      form.dni.addEventListener('input', () => { form.dni.value = U.soloDigitos(form.dni.value).slice(0, 8); f.dni = form.dni.value; });

      const cambiarCantidad = (n) => {
        f.cantidad = Math.max(1, Math.min(max, n));
        $('#cantidad').textContent = f.cantidad;
        $('#menos').disabled = f.cantidad <= 1;
        $('#mas').disabled = f.cantidad >= max;
        $('#total').textContent = U.pesos(precio * f.cantidad);
        $('#emitir').textContent = f.cantidad === 1 ? 'Emitir entrada' : 'Emitir ' + f.cantidad + ' entradas';
      };
      $('#menos').addEventListener('click', () => cambiarCantidad(f.cantidad - 1));
      $('#mas').addEventListener('click', () => cambiarCantidad(f.cantidad + 1));

      $$('.opcion').forEach((b) => b.addEventListener('click', () => {
        f.medio = b.dataset.medio;
        $$('.opcion').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        mostrarDatosClub();
      }));
      mostrarDatosClub();

      form.addEventListener('submit', (ev) => { ev.preventDefault(); emitir(); });

      // Precio y tanda frescos mientras completa (la tanda pudo cambiar).
      if (navigator.onLine) {
        refrescar().then((ok) => {
          if (ok && st.datos.tanda && t && Number(st.datos.tanda.precio) !== precio && history.state && history.state.rrpp === 'nueva') {
            f.error = 'Cambió la tanda: ahora vendés ' + st.datos.tanda.nombre + ' a ' + U.pesos(st.datos.tanda.precio) + '.';
            pNueva();
          }
        });
      }
    }

    async function mostrarDatosClub() {
      const caja = $('#datos-club');
      if (!caja) return;
      if (st.form.medio !== 'transferencia') { caja.innerHTML = ''; return; }
      const pintar = (t) => {
        if (!$('#datos-club') || st.form.medio !== 'transferencia') return;
        if (!t || !(t.alias || t.cbu_cvu)) {
          caja.innerHTML = '<div class="aviso aviso--alerta">El club todavía no cargó los datos para transferir. Avisale al administrador.</div>';
          return;
        }
        caja.innerHTML = '<div class="tarjeta datos-club"><dl class="datos">' +
          (t.alias ? '<dt>Alias</dt><dd>' + e(t.alias) + '</dd>' : '') +
          (t.cbu_cvu ? '<dt>CBU/CVU</dt><dd>' + e(t.cbu_cvu) + '</dd>' : '') +
          (t.titular ? '<dt>Titular</dt><dd>' + e(t.titular) + '</dd>' : '') +
          (t.entidad ? '<dt>Banco</dt><dd>' + e(t.entidad) + '</dd>' : '') +
          '</dl><div class="botones-fila">' +
          '<button class="boton" type="button" id="copiar-alias">Copiar alias</button>' +
          '<a class="boton" id="compartir-datos" target="_blank" rel="noopener">Compartir por WhatsApp</a>' +
          '</div><p><strong>Pedile el comprobante.</strong></p></div>';
        $('#copiar-alias').addEventListener('click', () => U.copiar(t.alias || t.cbu_cvu, 'Alias copiado.'));
        const comp = $('#compartir-datos');
        const actualizar = () => { comp.href = urlWhatsApp(U.telWhatsApp(st.form.tel) || '', textoDatosClub(t)); };
        actualizar();
        comp.addEventListener('pointerdown', actualizar);
        comp.addEventListener('focus', actualizar);
      };
      pintar(st.transf);
      pintar(await datosTransferencia());
    }

    async function emitir() {
      const f = st.form;
      const boton = $('#emitir');
      await U.conBoton(boton, async () => {
        f.error = null; f.campo = null;
        // Controles rápidos en el celular (la base vuelve a validar todo).
        const tel = U.telWhatsApp(f.tel);
        if (f.nombre.trim().length < 3) { f.error = 'Escribí el nombre y apellido.'; f.campo = 'nombre'; }
        else if (!U.dniValido(f.dni)) { f.error = 'Revisá el DNI: tiene que tener 7 u 8 números.'; f.campo = 'dni'; }
        else if (tel === null) { f.error = 'Revisá el WhatsApp: poné código de área y número, sin 0 ni 15.'; f.campo = 'tel'; }
        else if (!navigator.onLine) { f.error = SIN_SENAL_EMITIR; }
        if (f.error) return pNueva();

        try {
          const r = await API.rpc('emitir_venta', {
            p_idem: f.idem, p_nombre: f.nombre, p_dni: U.soloDigitos(f.dni), p_tel: tel || null,
            p_cantidad: f.cantidad, p_medio: f.medio,
            p_precio_visto: st.datos && st.datos.tanda ? Number(st.datos.tanda.precio) : null,
          });
          st.lista = r;
          st.form = null;
          ir('lista', true);
          refrescar();
        } catch (err) {
          if (await manejarError(err)) return;
          f.error = U.esErrorDeRed(err) ? SIN_SENAL_EMITIR : U.mensajeDeError(err);
          f.campo = err && ['nombre', 'dni', 'tel'].includes(err.hint) ? err.hint : null;
          if (err && ['precio_cambio', 'stock_tanda', 'sin_tanda', 'limite_rrpp', 'tope', 'venta_cerrada'].includes(err.hint)) {
            await refrescar();
          }
          pNueva();
        }
      });
    }

    // ======================= Entrada lista =======================
    function pLista() {
      const r = st.lista;
      if (!r) return ir('inicio', true);
      const v = r.venta;
      const link = linkEntrada(r.token);
      const texto = mensajeWhatsApp(v, r.evento, link);
      const una = v.cantidad === 1;
      render(
        '<header class="encabezado"><h1 class="encabezado__titulo">Club Deportivo Mitre ' + ctx.VERSION + '</h1></header>' +
        '<main class="contenido pantalla">' +
        '<div class="listo"><div class="listo__icono">' + ICONO_OK + '</div>' +
        '<h2>' + (una ? 'Entrada lista' : 'Entradas listas') + '</h2>' +
        '<p class="suave">' + e(v.nombre) + ' · ' + e(U.plural(v.cantidad, 'entrada', 'entradas')) + ' · ' +
        U.pesos(v.total) + (v.medio === 'efectivo' ? ' en efectivo' : ' por transferencia') + '</p></div>' +
        '<section class="tarjeta"><p class="tarjeta__etiqueta">Así le llega por WhatsApp</p>' +
        '<div class="burbuja">' + e(texto) + '</div></section>' +
        '<div class="pie-accion">' +
        '<a class="boton boton--whatsapp boton--ancho boton--grande" id="enviar" target="_blank" rel="noopener" href="' +
        e(urlWhatsApp(v.tel, texto)) + '">' + ICONO_WA + ' Enviar por WhatsApp</a>' +
        '<button class="boton boton--ancho" type="button" id="copiar">Copiar link</button>' +
        '<button class="boton boton--ancho" type="button" id="otra">Nueva entrada</button>' +
        '<button class="boton boton--texto boton--ancho" type="button" id="inicio">Volver al inicio</button>' +
        '</div></main>');

      $('#enviar').addEventListener('click', () => {
        const local = st.datos && (st.datos.ventas || []).find((x) => x.ref === v.ref);
        if (local) local.enviada = true;
        API.rpc('marcar_enviada', { p_venta_id: v.ref }).catch(() => { /* no es grave */ });
      });
      $('#copiar').addEventListener('click', () => U.copiar(link, 'Link copiado.'));
      $('#otra').addEventListener('click', () => { st.form = null; ir('nueva', true); });
      $('#inicio').addEventListener('click', () => ir('inicio', true));
    }

    // ======================= Mis ventas =======================
    function pVentas(filtro) {
      const ventas = (st.datos && st.datos.ventas) || [];
      const q = (filtro || '').trim().toLowerCase();
      const qd = U.soloDigitos(q);
      const filtradas = ventas.map((v, i) => [v, i]).filter(([v]) =>
        !q || v.nombre.toLowerCase().includes(q) || (qd && String(v.dni || '').includes(qd)));
      render(encabezadoSub('Mis ventas', U.plural(ventas.length, 'venta', 'ventas')) +
        '<main class="contenido pantalla">' +
        '<label class="campo"><span class="campo__etiqueta">Buscar por nombre o DNI</span>' +
        '<input class="entrada-texto" type="search" id="buscar" autocomplete="off" value="' + e(filtro || '') + '"></label>' +
        '<section class="lista">' +
        (filtradas.length ? filtradas.map(([v, i]) => filaVenta(v, i)).join('') : '<p class="lista__vacia">No hay ventas que coincidan.</p>') +
        '</section></main>');
      conectarVolver();
      const b = $('#buscar');
      b.addEventListener('input', () => {
        const pos = b.value;
        pVentas(pos);
        const nb = $('#buscar'); nb.focus(); nb.setSelectionRange(pos.length, pos.length);
      });
      conectarFilas(ventas);
    }

    // ======================= Detalle de venta =======================
    async function abrirDetalle(v) {
      st.detalle = { venta: v, completo: null };
      ir('detalle');
      try {
        st.detalle.completo = await API.rpc('detalle_venta', { p_venta_id: v.ref });
      } catch (err) {
        if (await manejarError(err)) return;
        st.detalle.error = U.esErrorDeRed(err) ? 'Sin conexión. Para ver el estado de cada entrada necesitás internet.' : U.mensajeDeError(err);
      }
      if (history.state && history.state.rrpp === 'detalle') pDetalle();
    }

    function pDetalle() {
      const det = st.detalle;
      if (!det) return ir('inicio', true);
      const v = det.completo || det.venta;
      let entradas = '';
      if (det.completo) {
        entradas = '<section class="tarjeta"><h3>Entradas</h3>' + det.completo.entradas.map((x) =>
          '<div class="entrada-fila"><span>Entrada ' + x.nro + ' de ' + v.cantidad +
          (x.pasada_a ? '<br><span class="suave">Pasada a ' + e(x.pasada_a) + '</span>' : '') + '</span>' +
          (x.estado === 'anulada' ? '<span class="chip chip--error">Anulada</span>'
            : x.ingreso ? '<span class="chip chip--ok">Ingresó ' + U.hora(x.ingreso) + '</span>'
            : '<span class="chip chip--neutro">Sin usar</span>') +
          '</div>').join('') + '</section>';
      } else if (det.error) {
        entradas = '<div class="aviso aviso--alerta">' + e(det.error) + '</div>';
      } else {
        entradas = '<p class="suave">Cargando…</p>';
      }
      const activa = v.estado === 'activa';
      render(encabezadoSub(v.nombre, U.plural(v.cantidad, 'entrada', 'entradas') + ' · ' + (MEDIO[v.medio] || '')) +
        '<main class="contenido pantalla">' +
        (activa ? '' : '<div class="aviso aviso--error">Esta venta está anulada' + (v.motivo_anulacion ? ': ' + e(v.motivo_anulacion) : '') + '.</div>') +
        '<section class="tarjeta"><dl class="datos">' +
        '<dt>DNI</dt><dd>' + e(v.dni || '') + '</dd>' +
        '<dt>Tanda</dt><dd>' + e(v.tanda || '') + '</dd>' +
        '<dt>Total</dt><dd>' + U.pesos(v.total) + '</dd>' +
        '<dt>Fecha</dt><dd>' + U.diaMes(v.creada) + ' · ' + U.hora(v.creada) + '</dd>' +
        '</dl></section>' +
        entradas +
        (activa ? '<button class="boton boton--whatsapp boton--ancho boton--grande" type="button" id="reenviar">' + ICONO_WA + ' Reenviar por WhatsApp</button>' +
                  '<p class="suave">Si la tenés que anular, pedíselo al administrador.</p>' : '') +
        '</main>');
      conectarVolver();
      const b = $('#reenviar');
      if (b) b.addEventListener('click', () => reenviar(v, b));
    }

    async function reenviar(v, boton) {
      const si = await U.confirmar('Se va a generar un link nuevo y el anterior deja de funcionar. ¿Seguimos?', 'Sí, generar link nuevo', 'Cancelar');
      if (!si) return;
      await U.conBoton(boton, async () => {
        if (!navigator.onLine) return U.avisar('Sin conexión. Para reenviar necesitás internet.');
        try {
          st.lista = await API.rpc('reenviar_link', { p_venta_id: v.ref });
          ir('lista', true);
        } catch (err) {
          await manejarError(err, U.avisar);
        }
      });
    }

    // ---------------- Arranque ----------------
    window.addEventListener('online', async () => { if (await refrescar() && history.state && history.state.rrpp === 'inicio') pInicio(); });
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && history.state && history.state.rrpp === 'inicio' && await refrescar()) pInicio();
    });

    ir('inicio', true);
  }

  window.APPS.rrpp = montar;
})();
