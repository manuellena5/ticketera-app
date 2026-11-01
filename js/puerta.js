// App de Puerta (rol "puerta"): preparar la lista, escanear sin conexión,
// buscar por DNI o apellido, y sincronizar cada 10 segundos si hay señal.
(function () {
  'use strict';

  const e = U.escaparHTML;
  const P = window.PUERTA;
  const INTERVALO_SYNC = 10000;
  const CODIGO = /^[A-Z2-7]{26}$/;

  function montar(raiz, perfil, ctx) {
    const st = {
      lista: new Map(),        // h → fila
      meta: null,              // { generada, evento, sal, cambiosDesde }
      pendientes: [],          // cola: { tipo: 'ingreso'|'deshacer', h, momento, dispositivo, via, motivo }
      contador: { adentro: 0, tope: 0 },
      ultimaSync: null,
      error: false,
      sincronizando: false,
      detener: null,
      ultimo: { cod: null, t: 0 },
      busqueda: '',
    };
    const disp = P.dispositivo(perfil);
    const $ = (s) => raiz.querySelector(s);
    const $$ = (s) => [...raiz.querySelectorAll(s)];

    // ---------------- Persistencia ----------------
    let timerGuardar = null;
    function guardarLista() {
      clearTimeout(timerGuardar);
      timerGuardar = setTimeout(() => { P.KV.set('lista', [...st.lista.values()]).catch(() => {}); }, 300);
    }
    function guardarEstado() {
      return Promise.all([
        P.KV.set('pendientes', st.pendientes),
        P.KV.set('meta', st.meta),
        P.KV.set('contador', st.contador),
        P.KV.set('ultimaSync', st.ultimaSync),
      ]).catch(() => {});
    }
    async function cargar() {
      try {
        const [lista, meta, pend, cont, ult] = await Promise.all(
          ['lista', 'meta', 'pendientes', 'contador', 'ultimaSync'].map((k) => P.KV.get(k)));
        if (Array.isArray(lista)) lista.forEach((f) => st.lista.set(f.h, f));
        st.meta = meta || null;
        st.pendientes = Array.isArray(pend) ? pend : [];
        st.contador = cont || st.contador;
        st.ultimaSync = ult || null;
      } catch (_) { /* sin almacenamiento: funciona solo con señal */ }
    }

    // ---------------- Contador y estado ----------------
    function contadorVisible() {
      const ingresosPend = st.pendientes.filter((p) => p.tipo === 'ingreso').length;
      const deshacerPend = st.pendientes.filter((p) => p.tipo === 'deshacer').length;
      return { ...st.contador, adentro: (st.contador.adentro || 0) + ingresosPend - deshacerPend };
    }
    function estadoSync() {
      return { ultima: st.ultimaSync, error: st.error, lista: st.meta && st.meta.generada, pendientes: st.pendientes.length };
    }
    function refrescarCabecera() {
      P.actualizarSync(raiz, estadoSync());
      const c = contadorVisible();
      const a = $('#adentro');
      if (a) a.innerHTML = U.miles(Math.max(0, c.adentro)) + (c.tope ? ' <small>/ ' + U.miles(c.tope) + '</small>' : '');
      P.pintarBarra(raiz, c);
    }

    // ---------------- Sincronización ----------------
    function aplicarFila(f) {
      const local = st.lista.get(f.h);
      const pendiente = st.pendientes.find((p) => p.h === f.h);
      if (pendiente && local) {
        // Lo local todavía no subió: se respeta hasta que suba.
        st.lista.set(f.h, { ...f, i: local.i });
      } else {
        st.lista.set(f.h, f);
      }
    }

    async function llamar(nombre, args) {
      const t0 = Date.now();
      const r = await API.rpc(nombre, args);
      const t1 = Date.now();
      const c = r && (r.contador || r);
      if (c && c.servidor_ahora) P.Reloj.ajustar(c.servidor_ahora, t0, t1);
      return r;
    }

    async function sincronizar() {
      if (st.sincronizando) { st.otraVez = true; return; }   // al terminar se vuelve a correr
      if (!navigator.onLine) { st.error = true; refrescarCabecera(); return; }
      if (!st.meta) {
        // Todavía sin lista: al menos el contador y la hora del servidor.
        try {
          st.contador = await llamar('contador_puerta', {});
          st.ultimaSync = Date.now(); st.error = false;
        } catch (err) {
          if (ctx.esSesionInvalida(err)) { detenerTodo(); return ctx.sesionInvalida(err); }
          st.error = true;
        }
        return refrescarCabecera();
      }
      st.sincronizando = true;
      try {
        // 1) Subir lo hecho en este celular, en orden.
        while (st.pendientes.length) {
          const primero = st.pendientes[0];
          if (primero.tipo === 'deshacer') {
            const r = await llamar('deshacer_ingreso', { p_h: primero.h, p_motivo: primero.motivo || null });
            st.pendientes.shift();
            if (r && r.fila) aplicarFila(r.fila);
            if (r && r.contador) st.contador = r.contador;
          } else {
            let n = 0;
            while (n < st.pendientes.length && n < 200 && st.pendientes[n].tipo === 'ingreso') n++;
            const lote = st.pendientes.slice(0, n);
            const r = await llamar('registrar_ingresos', {
              p_lote: lote.map((p) => ({ h: p.h, momento: p.momento, dispositivo: p.dispositivo, via: p.via })),
            });
            st.pendientes.splice(0, n);
            (r.resultados || []).forEach((x) => {
              const f = st.lista.get(x.h);
              if (f && x.ingreso) f.i = x.ingreso;   // si ganó otro celular, queda su hora
            });
            st.contador = r.contador || st.contador;
          }
          await guardarEstado();
        }
        // 2) Bajar lo que cambió (otro escáner, anulaciones, entradas nuevas).
        const r2 = await llamar('cambios_puerta', { p_desde: st.meta.cambiosDesde || st.meta.generada });
        (r2.entradas || []).forEach(aplicarFila);
        st.contador = r2.contador || st.contador;
        // Se pide con 30 s de margen para no perder cambios que se estaban guardando.
        st.meta.cambiosDesde = new Date(Date.parse(r2.contador.servidor_ahora) - 30000).toISOString();
        st.ultimaSync = Date.now();
        st.error = false;
        guardarLista();
        await guardarEstado();
      } catch (err) {
        if (ctx.esSesionInvalida(err)) { detenerTodo(); return ctx.sesionInvalida(err); }
        st.error = true;
      } finally {
        st.sincronizando = false;
        refrescarCabecera();
        if (st.pantalla === 'buscar') pintarResultados();
        if (st.otraVez) { st.otraVez = false; setTimeout(sincronizar, 0); }
      }
    }

    async function descargarLista(boton) {
      await U.conBoton(boton, async () => {
        if (!navigator.onLine) return U.avisar('Sin conexión. Para descargar la lista necesitás internet.');
        try {
          if (st.pendientes.length) await sincronizar();
          if (st.pendientes.length) return U.avisar('Hay ingresos sin subir. Esperá a que se sincronicen.');
          const r = await llamar('descargar_lista_puerta', {});
          st.lista = new Map();
          r.entradas.forEach((f) => st.lista.set(f.h, f));
          st.meta = { generada: r.generada, evento: r.evento, sal: r.sal,
                      cambiosDesde: new Date(Date.parse(r.generada) - 30000).toISOString() };
          st.contador = r.contador;
          st.ultimaSync = Date.now();
          st.error = false;
          await P.KV.set('lista', r.entradas);
          await guardarEstado();
          U.avisar('Lista descargada.');
          pPreparar();
        } catch (err) {
          if (ctx.esSesionInvalida(err)) return ctx.sesionInvalida(err);
          U.avisar(U.mensajeDeError(err));
        }
      });
    }

    // ---------------- Ingresos ----------------
    function marcarIngreso(f, via) {
      f.i = P.Reloj.iso();
      st.pendientes.push({ tipo: 'ingreso', h: f.h, momento: f.i, dispositivo: disp, via });
      guardarLista();
      guardarEstado();
      refrescarCabecera();
      if (navigator.onLine) setTimeout(sincronizar, 0);
    }

    function deshacerIngreso(f, motivo) {
      const idx = st.pendientes.findIndex((p) => p.tipo === 'ingreso' && p.h === f.h);
      if (idx >= 0) st.pendientes.splice(idx, 1);   // no había subido: se borra y listo
      else st.pendientes.push({ tipo: 'deshacer', h: f.h, motivo });
      f.i = null;
      guardarLista();
      guardarEstado();
      refrescarCabecera();
      if (navigator.onLine) setTimeout(sincronizar, 0);
    }

    function entradaDe(f) { return 'Entrada ' + f.nro + ' de ' + f.c; }

    async function alLeer(texto) {
      const cod = String(texto || '').trim().toUpperCase();
      const ahora = Date.now();
      if (cod === st.ultimo.cod && ahora - st.ultimo.t < 2500) return;   // el mismo QR sigue en cámara
      st.ultimo = { cod, t: ahora };
      if (!CODIGO.test(cod)) {
        return resultado('no', 'NO VÁLIDA', 'Este QR no es una entrada', 'Pedí que la busquen por DNI');
      }
      const f = st.lista.get(await P.sha256(cod));
      if (!f) return resultado('no', 'NO VÁLIDA', 'Esta entrada no existe', 'Pedí que la busquen por DNI');
      if (f.e !== 'valida') return resultado('no', 'ANULADA', 'Esta entrada fue anulada', f.n + ' · ' + entradaDe(f));
      if (f.i) {
        return resultado('ya', 'YA INGRESÓ', 'A las ' + U.hora(f.i) + ' · ' + f.n,
          'DNI terminado en ' + f.d3 + ' · ' + entradaDe(f) + (f.p ? ' · Pasada a ' + f.p : ''));
      }
      marcarIngreso(f, 'qr');
      resultado('ok', 'VÁLIDA', f.n + ' · ' + entradaDe(f),
        [f.t, f.p ? 'Pasada a ' + f.p : null, 'Colocá la pulsera'].filter(Boolean).join(' · '));
    }

    function resultado(tipo, titulo, l1, l2) {
      P.avisar(tipo);
      const r = $('#resultado');
      if (!r) return;
      r.className = 'resultado resultado--' + tipo;
      r.innerHTML = '<p class="resultado__titulo">' + e(titulo) + '</p>' +
        '<p class="resultado__l1">' + e(l1) + '</p><p class="resultado__l2">' + e(l2) + '</p>';
    }

    // ---------------- Pantallas ----------------
    function detenerCamara() { if (st.detener) { st.detener(); st.detener = null; } }
    function detenerTodo() { detenerCamara(); clearInterval(timerSync); }

    function ir(p, reemplazar) {
      detenerCamara();
      st.pantalla = p;
      if (reemplazar) history.replaceState({ puerta: p }, ''); else history.pushState({ puerta: p }, '');
      ({ preparar: pPreparar, escaner: pEscaner, buscar: pBuscar })[p]();
    }
    window.onpopstate = (ev) => {
      const p = (ev.state && ev.state.puerta) || 'preparar';
      detenerCamara();
      st.pantalla = p;
      ({ preparar: pPreparar, escaner: pEscaner, buscar: pBuscar })[p]();
    };

    function cabecera(titulo) {
      return '<header class="cabecera-puerta oscura">' +
        '<div class="hero__fila"><h1 class="cabecera-puerta__titulo">' + e(titulo) + '</h1>' + ctx.VERSION + '</div>' +
        P.htmlContador(contadorVisible()) + P.htmlSync(estadoSync()) +
        '</header>';
    }

    function pPreparar() {
      const hay = !!st.meta;
      ctx.mostrar(cabecera('Puerta') +
        '<main class="contenido pantalla">' +
        (hay
          ? '<section class="tarjeta"><p class="tarjeta__etiqueta">Lista de entradas</p>' +
            '<p class="tarjeta__dato tarjeta__dato--chico" id="estado-lista">Lista lista · ' + e(U.plural(st.lista.size, 'entrada', 'entradas')) +
            ' · ' + U.hora(st.meta.generada) + '</p>' +
            '<p class="tarjeta__nota">Funciona sin conexión. Antes de abrir las puertas, sincronizá con señal.</p></section>'
          : '<div class="aviso aviso--alerta">Descargá la lista de entradas con señal antes de empezar.</div>') +
        (hay ? '<button class="boton boton--principal boton--ancho boton--grande" type="button" id="abrir">Abrir escáner</button>' : '') +
        '<button class="boton ' + (hay ? '' : 'boton--principal boton--grande ') + 'boton--ancho" type="button" id="descargar">' +
        (hay ? 'Actualizar lista' : 'Descargar lista') + '</button>' +
        (hay ? '<button class="boton boton--ancho" type="button" id="buscar">Buscar por DNI o apellido</button>' +
               '<button class="boton boton--ancho" type="button" id="sincronizar">Sincronizar ahora</button>' : '') +
        '<button class="boton boton--texto boton--ancho" type="button" id="salir">Salir</button>' +
        '</main>');
      P.pintarBarra(raiz, contadorVisible());
      const a = $('#abrir');
      if (a) a.addEventListener('click', () => { P.prepararSonido(); ir('escaner'); });
      $('#descargar').addEventListener('click', (ev) => descargarLista(ev.currentTarget));
      const b = $('#buscar');
      if (b) b.addEventListener('click', () => ir('buscar'));
      const s = $('#sincronizar');
      if (s) s.addEventListener('click', (ev) => U.conBoton(ev.currentTarget, async () => {
        await sincronizar();
        U.avisar(st.error ? 'Sin conexión. Se sincroniza cuando vuelva la señal.' : 'Sincronizado.');
      }));
      $('#salir').addEventListener('click', salir);
    }

    async function salir() {
      if (st.pendientes.length) {
        const si = await U.confirmar('Hay ' + U.plural(st.pendientes.length, 'ingreso', 'ingresos') +
          ' sin subir. Si salís ahora se pierden. ¿Salir igual?', 'Salir igual', 'Cancelar');
        if (!si) return;
      }
      detenerTodo();
      await P.KV.borrarTodo().catch(() => {});
      ctx.salir();
    }

    async function pEscaner() {
      ctx.mostrar('<div class="escaner oscura">' + cabecera('Escáner') +
        '<div class="escaner__camara"><video id="video" aria-label="Cámara"></video>' +
        '<div class="escaner__marco" aria-hidden="true"><span></span><span></span><span></span><span></span></div>' +
        '<p class="escaner__ayuda">Apuntá al QR</p></div>' +
        '<section class="resultado resultado--neutro" id="resultado" aria-live="assertive">' +
        '<p class="resultado__titulo">Listo para escanear</p><p class="resultado__l1">&nbsp;</p><p class="resultado__l2">&nbsp;</p></section>' +
        '<nav class="escaner__nav">' +
        '<button class="boton boton--oscuro" type="button" id="buscar">Buscar por DNI</button>' +
        '<button class="boton boton--oscuro" type="button" id="volver">Volver</button>' +
        '</nav></div>');
      P.pintarBarra(raiz, contadorVisible());
      $('#buscar').addEventListener('click', () => ir('buscar'));
      $('#volver').addEventListener('click', () => history.back());
      try {
        st.detener = await Escaner.iniciar($('#video'), alLeer);
        if (st.pantalla !== 'escaner') detenerCamara();
      } catch (_) {
        resultado('no', 'SIN CÁMARA', 'Necesitamos la cámara para escanear.', 'Permitila en el navegador o buscá por DNI.');
      }
    }

    function pBuscar() {
      ctx.mostrar(cabecera('Buscar') +
        '<main class="contenido pantalla">' +
        '<label class="campo"><span class="campo__etiqueta">DNI o apellido</span>' +
        '<input class="entrada-texto" type="search" id="q" autocomplete="off" value="' + e(st.busqueda) + '" autofocus></label>' +
        '<div id="resultados"></div>' +
        '<button class="boton boton--ancho" type="button" id="volver">Volver</button>' +
        '</main>');
      P.pintarBarra(raiz, contadorVisible());
      const q = $('#q');
      q.addEventListener('input', () => { st.busqueda = q.value; pintarResultados(); });
      $('#volver').addEventListener('click', () => history.back());
      pintarResultados();
    }

    let busquedaId = 0;
    async function pintarResultados() {
      const caja = $('#resultados');
      if (!caja) return;
      const id = ++busquedaId;
      const q = st.busqueda.trim();
      const digitos = U.soloDigitos(q);
      let filas = [];
      if (digitos.length >= 7 && st.meta && st.meta.sal) {
        const hd = await P.sha256(digitos + st.meta.sal);
        filas = [...st.lista.values()].filter((f) => f.hd === hd);
      } else if (digitos.length === 3) {
        filas = [...st.lista.values()].filter((f) => f.d3 === digitos);
      } else if (!digitos && P.normalizar(q).length >= 3) {
        const n = P.normalizar(q);
        filas = [...st.lista.values()].filter((f) => P.normalizar(f.n).includes(n) || (f.p && P.normalizar(f.p).includes(n)));
      }
      if (id !== busquedaId) return;
      filas.sort((a, b) => a.n.localeCompare(b.n, 'es') || a.nro - b.nro);
      if (!q) { caja.innerHTML = '<p class="suave">Escribí el DNI completo, los últimos 3 números o el apellido.</p>'; return; }
      if (!filas.length) { caja.innerHTML = '<p class="suave">No hay entradas que coincidan.</p>'; return; }
      caja.innerHTML = '<section class="lista">' + filas.slice(0, 40).map((f) => {
        let accion;
        if (f.e !== 'valida') accion = '<span class="chip chip--error">Anulada</span>';
        else if (f.i) accion = '<span class="busqueda__acciones"><span class="chip chip--ok">Ingresó ' + U.hora(f.i) + '</span>' +
          '<button class="boton boton--texto boton--peligro-texto" type="button" data-deshacer="' + e(f.h) + '">Deshacer</button></span>';
        else accion = '<button class="boton boton--whatsapp" type="button" data-marcar="' + e(f.h) + '">Marcar ingreso</button>';
        return '<div class="fila-venta fila-busqueda"><span><p class="fila-venta__nombre">' + e(f.n) + '</p>' +
          '<p class="fila-venta__detalle">' + e(entradaDe(f)) + (f.t ? ' · ' + e(f.t) : '') + '</p>' +
          '<p class="fila-venta__detalle">DNI terminado en ' + e(f.d3) + (f.p ? ' · Pasada a ' + e(f.p) : '') + '</p></span>' +
          accion + '</div>';
      }).join('') + '</section>' +
      (filas.length > 40 ? '<p class="suave">Hay más resultados: escribí más letras.</p>' : '');
      $$('[data-marcar]').forEach((b) => b.addEventListener('click', () => {
        const f = st.lista.get(b.dataset.marcar);
        if (f && !f.i) { marcarIngreso(f, 'busqueda'); P.avisar('ok'); U.avisar('Ingreso marcado: ' + f.n + '.'); pintarResultados(); }
      }));
      $$('[data-deshacer]').forEach((b) => b.addEventListener('click', async () => {
        const f = st.lista.get(b.dataset.deshacer);
        if (!f) return;
        const si = await U.confirmar('¿Deshacer el ingreso de ' + f.n + ' (' + entradaDe(f).toLowerCase() + ')? Queda registrado.', 'Sí, deshacer', 'Cancelar');
        if (si) { deshacerIngreso(f, 'Deshecho desde la puerta'); U.avisar('Ingreso deshecho.'); pintarResultados(); }
      }));
    }

    // ---------------- Arranque ----------------
    let timerSync = null;
    window.addEventListener('online', () => { st.error = false; sincronizar(); });
    window.addEventListener('offline', () => { st.error = true; refrescarCabecera(); });

    cargar().then(() => {
      ir('preparar', true);
      timerSync = setInterval(sincronizar, INTERVALO_SYNC);
      sincronizar();
    });
  }

  window.APPS.puerta = montar;
})();
