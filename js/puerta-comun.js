// Piezas compartidas por los celulares de Puerta y Caja: almacenamiento en
// IndexedDB, reloj corregido con la hora del servidor, estado de
// sincronización, contador "Adentro" y avisos con sonido y vibración.
(function () {
  'use strict';

  const e = U.escaparHTML;

  // ---------------- IndexedDB (clave → valor) ----------------
  const KV = (() => {
    let dbp = null;
    function db() {
      if (!dbp) {
        dbp = new Promise((ok, ko) => {
          const r = indexedDB.open('entradas-puerta', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => ok(r.result);
          r.onerror = () => ko(r.error);
        });
      }
      return dbp;
    }
    async function get(k) {
      const d = await db();
      return new Promise((ok, ko) => {
        const t = d.transaction('kv').objectStore('kv').get(k);
        t.onsuccess = () => ok(t.result);
        t.onerror = () => ko(t.error);
      });
    }
    async function set(k, v) {
      const d = await db();
      return new Promise((ok, ko) => {
        const tx = d.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => ok();
        tx.onerror = () => ko(tx.error);
      });
    }
    async function borrarTodo() {
      const d = await db();
      return new Promise((ok) => {
        const tx = d.transaction('kv', 'readwrite');
        tx.objectStore('kv').clear();
        tx.oncomplete = () => ok();
        tx.onerror = () => ok();
      });
    }
    return { get, set, borrarTodo };
  })();

  // ---------------- Reloj corregido ----------------
  // El orden de los ingresos (gana el primero) usa la hora del servidor:
  // offset = hora del servidor − hora del celular, medido en cada respuesta.
  const Reloj = {
    offset: Number(U.leer('entradas-puerta-offset')) || 0,
    ahora() { return Date.now() + this.offset; },
    ajustar(servidorIso, t0, t1) {
      if (!servidorIso) return;
      const s = Date.parse(servidorIso);
      if (!Number.isFinite(s)) return;
      this.offset = Math.round(s - (t0 + t1) / 2);
      U.guardar('entradas-puerta-offset', this.offset);
    },
    iso() { return new Date(this.ahora()).toISOString(); },
  };

  // ---------------- Dispositivo ----------------
  function dispositivo(perfil) {
    let d = U.leer('entradas-dispositivo');
    if (!d || !d.startsWith(perfil.usuario + '-')) {
      d = perfil.usuario + '-' + Math.random().toString(36).slice(2, 6);
      U.guardar('entradas-dispositivo', d);
    }
    return d;
  }

  // ---------------- Hash ----------------
  async function sha256(texto) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizar(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  // ---------------- Sonido y vibración ----------------
  let audio = null;
  function prepararSonido() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (_) { audio = null; }
  }
  function tono(frec, desde, dur) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = frec; o.type = 'square';
    g.gain.setValueAtTime(0.0001, audio.currentTime + desde);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + desde + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + desde + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(audio.currentTime + desde); o.stop(audio.currentTime + desde + dur + 0.02);
  }
  function avisar(tipo) {
    try {
      if (navigator.vibrate) navigator.vibrate(tipo === 'ok' ? 120 : tipo === 'ya' ? [120, 80, 120] : [300, 100, 300]);
    } catch (_) { /* sin vibración */ }
    if (!audio) return;
    try {
      if (tipo === 'ok') tono(1320, 0, 0.12);
      else if (tipo === 'ya') { tono(660, 0, 0.12); tono(660, 0.18, 0.12); }
      else { tono(220, 0, 0.25); tono(180, 0.3, 0.35); }
    } catch (_) { /* nada */ }
  }

  // ---------------- Estado de sincronización ----------------
  // Siempre visible (pedido de M): cuándo fue la última vez que se
  // sincronizó con la nube.
  function textoSync(s) {
    const partes = [];
    let clase = 'ok';
    if (!navigator.onLine || s.error) {
      clase = 'alerta';
      partes.push(s.ultima ? 'Sin conexión desde ' + U.hora(s.ultima) : 'Sin conexión');
    } else if (s.ultima) {
      partes.push('Sincronizado ' + U.hora(s.ultima));
    } else {
      clase = 'alerta';
      partes.push('Todavía no se sincronizó');
    }
    if (s.lista) partes.push('lista de las ' + U.hora(s.lista));
    if (s.pendientes > 0) { partes.push(U.plural(s.pendientes, 'sin subir', 'sin subir')); clase = 'alerta'; }
    return { clase, texto: partes.join(' · ') };
  }

  function htmlSync(s) {
    const t = textoSync(s);
    return '<p class="sync sync--' + t.clase + '" id="sync"><span class="sync__punto" aria-hidden="true"></span>' +
      '<span id="sync-texto">' + e(t.texto) + '</span></p>';
  }

  function actualizarSync(raiz, s) {
    const p = raiz.querySelector('#sync');
    if (!p) return;
    const t = textoSync(s);
    p.className = 'sync sync--' + t.clase;
    p.querySelector('#sync-texto').textContent = t.texto;
  }

  // ---------------- Contador "Adentro" ----------------
  function htmlContador(c) {
    const adentro = Math.max(0, c.adentro || 0);
    const tope = c.tope || 0;
    return '<div class="contador-puerta">' +
      '<div class="contador-puerta__fila"><p class="contador-puerta__etiqueta">Adentro</p>' +
      '<p class="contador-puerta__dato" id="adentro">' + U.miles(adentro) +
      (tope ? ' <small>/ ' + U.miles(tope) + '</small>' : '') + '</p></div>' +
      '<div class="barra-progreso barra-progreso--oscura" aria-hidden="true"><span id="barra-adentro"></span></div>' +
      '</div>';
  }
  function pintarBarra(raiz, c) {
    const b = raiz.querySelector('#barra-adentro');
    if (b) {
      b.style.width = Math.min(100, Math.round(100 * (c.adentro || 0) / Math.max(1, c.tope || 1))) + '%';
      b.classList.toggle('barra-aviso', !!(c.aviso_desde && (c.adentro || 0) >= c.aviso_desde));
    }
  }

  window.KV = KV;
  window.PUERTA = Object.freeze({ KV, Reloj, dispositivo, sha256, normalizar, prepararSonido, avisar,
                                  htmlSync, actualizarSync, textoSync, htmlContador, pintarBarra });
})();
