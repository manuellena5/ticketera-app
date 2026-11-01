// App de Caja (rol "caja"): venta en puerta con pulsera y caja de puerta.
// Con señal respeta stock y tope. Sin señal sigue vendiendo: guarda las
// ventas en el celular ("pendientes de subir") y avisa si se acerca al tope.
(function () {
  'use strict';

  const e = U.escaparHTML;
  const P = window.PUERTA;
  const INTERVALO_SYNC = 10000;
  const CACHE = 'entradas-cache-caja';
  const MAX = 10;

  function montar(raiz, perfil, ctx) {
    const guardado = U.leer(CACHE) || {};
    const st = {
      datos: guardado.datos || null,           // último caja_puerta
      pendientes: guardado.pendientes || [],   // ventas sin subir
      avisos: guardado.avisos || [],           // avisos del servidor (sobre tope)
      ultimaSync: guardado.ultimaSync || null,
      error: false,
      transf: U.leer(CACHE + '-transf'),
      form: { cantidad: 1, medio: 'efectivo', idem: U.nuevaClave() },
      sincronizando: false,
      listo: null,
      mensaje: null,
    };
    const $ = (s) => raiz.querySelector(s);
    const $$ = (s) => [...raiz.querySelectorAll(s)];

    function persistir() {
      U.guardar(CACHE, { datos: st.datos, pendientes: st.pendientes, avisos: st.avisos, ultimaSync: st.ultimaSync });
    }

    // ---------------- Cuentas (servidor + lo que todavía no subió) ----------------
    function cuentas() {
      const d = st.datos || {};
      const c = d.contador || { adentro: 0, emitidas: 0, tope: 0 };
      const caja = d.caja || { pulseras: 0, efectivo: 0, transferencias: 0 };
      const pend = st.pendientes.reduce((a, p) => {
        a.cant += p.cantidad;
        a[p.medio] += p.cantidad * p.precio;
        return a;
      }, { cant: 0, efectivo: 0, transferencia: 0 });
      return {
        adentro: (c.adentro || 0) + pend.cant,
        emitidas: (c.emitidas || 0) + pend.cant,
        tope: c.tope || 0,
        aviso_desde: c.aviso_desde,
        pulseras: (caja.pulseras || 0) + pend.cant,
        efectivo: Number(caja.efectivo || 0) + pend.efectivo,
        transferencias: Number(caja.transferencias || 0) + pend.transferencia,
      };
    }
    function estadoSync() {
      return { ultima: st.ultimaSync, error: st.error, pendientes: st.pendientes.length };
    }

    // ---------------- Servidor ----------------
    async function llamar(nombre, args) {
      const t0 = Date.now();
      const r = await API.rpc(nombre, args);
      const c = r && r.contador;
      if (c && c.servidor_ahora) P.Reloj.ajustar(c.servidor_ahora, t0, Date.now());
      return r;
    }

    async function sincronizar() {
      if (st.sincronizando) { st.otraVez = true; return; }
      if (!navigator.onLine) { st.error = true; refrescar(); return; }
      st.sincronizando = true;
      try {
        while (st.pendientes.length) {
          const p = st.pendientes[0];
          const r = await llamar('venta_puerta', {
            p_idem: p.idem, p_cantidad: p.cantidad, p_medio: p.medio,
            p_precio_visto: p.precio, p_offline: true, p_momento: p.momento,
          });
          st.pendientes.shift();
          if (r.aviso) st.avisos.push(r.aviso);
          persistir();
        }
        st.datos = await llamar('caja_puerta', {});
        st.ultimaSync = Date.now();
        st.error = false;
        persistir();
      } catch (err) {
        if (ctx.esSesionInvalida(err)) { clearInterval(timer); return ctx.sesionInvalida(err); }
        st.error = true;
      } finally {
        st.sincronizando = false;
        refrescar();
        if (st.otraVez) { st.otraVez = false; setTimeout(sincronizar, 0); }
      }
    }

    async function datosTransferencia() {
      try {
        const filas = await API.rpc('datos_transferencia');
        const d = Array.isArray(filas) ? filas[0] : filas;
        if (d) { st.transf = d; U.guardar(CACHE + '-transf', d); }
      } catch (_) { /* se usan los guardados */ }
      return st.transf;
    }

    // ---------------- Venta ----------------
    function precio() { return st.datos && st.datos.tanda ? Number(st.datos.tanda.precio) : 0; }

    async function cobrar(boton) {
      const f = st.form;
      await U.conBoton(boton, async () => {
        st.mensaje = null;
        const p = precio();
        if (!p) { st.mensaje = 'No hay entradas de puerta a la venta en este momento.'; return pintar(); }
        const venta = { idem: f.idem, cantidad: f.cantidad, medio: f.medio, precio: p, momento: P.Reloj.iso() };
        const guardarSinConexion = () => {
          st.pendientes.push(venta);
          persistir();
          terminar(venta, true);
        };
        if (!navigator.onLine) return guardarSinConexion();
        try {
          const r = await llamar('venta_puerta', { p_idem: venta.idem, p_cantidad: venta.cantidad, p_medio: venta.medio, p_precio_visto: p });
          st.datos = { ...(st.datos || {}), contador: r.contador, caja: r.caja };
          st.ultimaSync = Date.now();
          st.error = false;
          persistir();
          terminar(venta, false);
          sincronizar();
        } catch (err) {
          if (ctx.esSesionInvalida(err)) return ctx.sesionInvalida(err);
          if (U.esErrorDeRed(err)) { st.error = true; return guardarSinConexion(); }   // se reintenta con la misma clave
          st.mensaje = U.mensajeDeError(err);
          if (err && ['precio_cambio', 'sin_tanda', 'stock_tanda', 'tope'].includes(err.hint)) await sincronizar();
          pintar();
        }
      });
    }

    function terminar(venta, sinConexion) {
      st.listo = { cantidad: venta.cantidad, sinConexion };
      st.form = { cantidad: 1, medio: 'efectivo', idem: U.nuevaClave() };
      pintar();
    }

    // ---------------- Pantalla ----------------
    // Cada 10 s se actualizan los números en el lugar (sin redibujar, para
    // no interrumpir a quien está cobrando). Solo se redibuja si aparece un
    // aviso nuevo o cambian las ventas pendientes.
    let firma = '';
    function refrescar() {
      if (st.listo) return;
      const nueva = st.avisos.length + '|' + st.pendientes.length + '|' + !!(st.datos && st.datos.tanda) + '|' + precio();
      if (nueva !== firma || !$('#caja-pulseras')) return pintar(true);
      const c = cuentas();
      P.actualizarSync(raiz, estadoSync());
      $('#adentro').innerHTML = U.miles(c.adentro) + (c.tope ? ' <small>/ ' + U.miles(c.tope) + '</small>' : '');
      P.pintarBarra(raiz, c);
      $('#caja-pulseras').textContent = U.miles(c.pulseras);
      $('#caja-efectivo').textContent = U.pesos(c.efectivo);
      $('#caja-transf').textContent = U.pesos(c.transferencias);
    }

    function avisoTope(c) {
      if (!c.tope) return '';
      const quedan = c.tope - c.emitidas;
      const estimado = st.pendientes.length ? ' (estimado: hay ventas sin subir)' : '';
      if (quedan <= 0) return '<div class="aviso aviso--error">Se llegó al tope de ' + U.miles(c.tope) + estimado + '. Avisale al encargado.</div>';
      if (c.aviso_desde && c.emitidas >= c.aviso_desde) {
        return '<div class="aviso aviso--alerta">Quedan ' + U.plural(quedan, 'lugar', 'lugares') + ' hasta el tope' + estimado + '.</div>';
      }
      return '';
    }

    function pintar(soloDatos) {
      const c = cuentas();
      const d = st.datos;
      const p = precio();
      const f = st.form;
      if (st.listo) {
        const n = st.listo.cantidad;
        ctx.mostrar('<main class="pulseras">' +
          '<p class="pulseras__titulo">Entregá ' + U.plural(n, 'pulsera', 'pulseras') + '</p>' +
          (st.listo.sinConexion ? '<p class="pulseras__nota">Venta guardada en el celular. Se sube cuando vuelva la señal.</p>' : '') +
          '<button class="boton boton--ancho boton--grande" type="button" id="listo">Listo</button>' +
          '</main>');
        P.avisar('ok');
        $('#listo').addEventListener('click', () => { st.listo = null; pintar(); });
        return;
      }
      firma = st.avisos.length + '|' + st.pendientes.length + '|' + !!(d && d.tanda) + '|' + p;
      const foco = soloDatos && document.activeElement && document.activeElement.id;
      ctx.mostrar(
        '<header class="cabecera-puerta oscura">' +
        '<div class="hero__fila"><div><h1 class="cabecera-puerta__titulo">Venta en puerta</h1>' +
        '<p class="hero__dato">' + (d && d.tanda ? e(d.tanda.nombre) + ' · ' + U.pesos(p) + ' cada una' : 'Sin precio cargado') + '</p></div>' +
        ctx.VERSION + '</div>' +
        P.htmlContador(c) + P.htmlSync(estadoSync()) +
        '</header>' +
        '<main class="contenido pantalla">' +
        st.avisos.map((a) => '<div class="aviso aviso--alerta" role="status">' + e(a) + '</div>').join('') +
        avisoTope(c) +
        (st.mensaje ? '<div class="aviso aviso--error" role="alert" id="error">' + e(st.mensaje) + '</div>' : '') +
        (d && !d.tanda ? '<div class="aviso aviso--alerta">No hay entradas de puerta a la venta en este momento.</div>' : '') +
        '<div class="campo"><span class="campo__etiqueta" id="et-cant">Cantidad</span>' +
        '<div class="contador contador--grande" role="group" aria-labelledby="et-cant">' +
        '<button type="button" id="menos" aria-label="Una menos"' + (f.cantidad <= 1 ? ' disabled' : '') + '>−</button>' +
        '<output id="cantidad">' + f.cantidad + '</output>' +
        '<button type="button" id="mas" aria-label="Una más"' + (f.cantidad >= MAX ? ' disabled' : '') + '>+</button>' +
        '</div></div>' +
        '<div class="campo"><span class="campo__etiqueta" id="et-medio">¿Cómo cobraste?</span>' +
        '<div class="opciones" role="group" aria-labelledby="et-medio">' +
        '<button type="button" class="opcion" data-medio="efectivo" aria-pressed="' + (f.medio === 'efectivo') + '">Efectivo</button>' +
        '<button type="button" class="opcion" data-medio="transferencia" aria-pressed="' + (f.medio === 'transferencia') + '">Transferencia</button>' +
        '</div></div>' +
        '<div id="datos-club"></div>' +
        '<div class="total"><p>Total a cobrar</p><p class="total__monto" id="total">' + U.pesos(p * f.cantidad) + '</p></div>' +
        '<button class="boton boton--principal boton--ancho boton--grande" type="button" id="cobrar"' + (p ? '' : ' disabled') + '>' +
        textoCobrar(f.cantidad) + '</button>' +
        '<section class="tarjeta"><h2 class="caja__titulo">Caja de puerta</h2>' +
        '<div class="caja__grilla">' +
        '<div><p class="tarjeta__etiqueta">Pulseras</p><p class="caja__dato" id="caja-pulseras">' + U.miles(c.pulseras) + '</p></div>' +
        '<div><p class="tarjeta__etiqueta">Efectivo</p><p class="caja__dato" id="caja-efectivo">' + U.pesos(c.efectivo) + '</p></div>' +
        '<div><p class="tarjeta__etiqueta">Transferencias</p><p class="caja__dato" id="caja-transf">' + U.pesos(c.transferencias) + '</p></div>' +
        '</div>' +
        (c.tope ? '<p class="tarjeta__nota">Quedan ' + U.miles(Math.max(0, c.tope - c.emitidas)) + ' lugares hasta el tope de ' + U.miles(c.tope) + '.</p>' : '') +
        (st.pendientes.length ? '<p class="tarjeta__nota texto-alerta">' + U.plural(st.pendientes.length, 'venta pendiente', 'ventas pendientes') + ' de subir.</p>' : '') +
        '</section>' +
        '<button class="boton boton--texto boton--ancho" type="button" id="salir">Salir</button>' +
        '</main>');
      P.pintarBarra(raiz, c);
      if (foco && $('#' + foco)) $('#' + foco).focus();

      const cambiar = (n) => {
        f.cantidad = Math.max(1, Math.min(MAX, n));
        $('#cantidad').textContent = f.cantidad;
        $('#menos').disabled = f.cantidad <= 1;
        $('#mas').disabled = f.cantidad >= MAX;
        $('#total').textContent = U.pesos(p * f.cantidad);
        $('#cobrar').textContent = textoCobrar(f.cantidad);
      };
      $('#menos').addEventListener('click', () => cambiar(f.cantidad - 1));
      $('#mas').addEventListener('click', () => cambiar(f.cantidad + 1));
      $$('.opcion').forEach((b) => b.addEventListener('click', () => {
        f.medio = b.dataset.medio;
        $$('.opcion').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        datosClub();
      }));
      datosClub();
      $('#cobrar').addEventListener('click', (ev) => { P.prepararSonido(); cobrar(ev.currentTarget); });
      $('#salir').addEventListener('click', salir);
    }

    function textoCobrar(n) { return 'Cobrar y dar ' + U.plural(n, 'pulsera', 'pulseras'); }

    async function datosClub() {
      const caja = $('#datos-club');
      if (!caja) return;
      if (st.form.medio !== 'transferencia') { caja.innerHTML = ''; return; }
      const pintarDatos = (t) => {
        if (!$('#datos-club') || st.form.medio !== 'transferencia') return;
        if (!t || !(t.alias || t.cbu_cvu)) {
          caja.innerHTML = '<div class="aviso aviso--alerta">El club todavía no cargó los datos para transferir.</div>';
          return;
        }
        caja.innerHTML = '<div class="tarjeta datos-club datos-club--grande"><dl class="datos">' +
          (t.alias ? '<dt>Alias</dt><dd>' + e(t.alias) + '</dd>' : '') +
          (t.cbu_cvu ? '<dt>CBU/CVU</dt><dd>' + e(t.cbu_cvu) + '</dd>' : '') +
          (t.titular ? '<dt>Titular</dt><dd>' + e(t.titular) + '</dd>' : '') +
          (t.entidad ? '<dt>Banco</dt><dd>' + e(t.entidad) + '</dd>' : '') +
          '</dl><p><strong>Pedile el comprobante antes de dar la pulsera.</strong></p></div>';
      };
      pintarDatos(st.transf);
      if (navigator.onLine) pintarDatos(await datosTransferencia());
    }

    async function salir() {
      if (st.pendientes.length) {
        const si = await U.confirmar('Hay ' + U.plural(st.pendientes.length, 'venta', 'ventas') +
          ' sin subir. Si salís ahora se pierden. ¿Salir igual?', 'Salir igual', 'Cancelar');
        if (!si) return;
      }
      clearInterval(timer);
      ctx.salir();
    }

    // ---------------- Arranque ----------------
    window.addEventListener('online', () => { st.error = false; sincronizar(); });
    window.addEventListener('offline', () => { st.error = true; refrescar(); });
    history.replaceState({ caja: true }, '');
    pintar();
    const timer = setInterval(sincronizar, INTERVALO_SYNC);
    sincronizar();
  }

  window.APPS.caja = montar;
})();
