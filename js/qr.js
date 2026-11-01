// Dibujo de QR y de la imagen de la entrada para guardar (todo offline,
// con la librería vendorizada qrcode-generator).
(function () {
  'use strict';

  const MARGEN = 4;   // zona silenciosa de 4 módulos: necesaria para leer bien

  function matriz(texto) {
    const qr = qrcode(0, 'M');       // versión automática, corrección media
    qr.addData(texto, 'Alphanumeric');
    qr.make();
    const n = qr.getModuleCount();
    return { n, oscuro: (f, c) => qr.isDark(f, c) };
  }

  // Dibuja el QR en un rectángulo del contexto 2D (x, y, lado en px).
  function dibujarEn(ctx, texto, x, y, lado) {
    const m = matriz(texto);
    const total = m.n + MARGEN * 2;
    const celda = Math.floor(lado / total);
    const usado = celda * total;
    const ox = x + Math.floor((lado - usado) / 2);
    const oy = y + Math.floor((lado - usado) / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, lado, lado);
    ctx.fillStyle = '#111827';
    for (let f = 0; f < m.n; f++) {
      for (let c = 0; c < m.n; c++) {
        if (m.oscuro(f, c)) ctx.fillRect(ox + (c + MARGEN) * celda, oy + (f + MARGEN) * celda, celda, celda);
      }
    }
  }

  // Canvas para mostrar en pantalla (nítido en pantallas de alta densidad).
  function canvas(texto, ladoCss, etiqueta) {
    const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const cv = document.createElement('canvas');
    cv.width = cv.height = ladoCss * ratio * 2;
    cv.className = 'qr';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', etiqueta || 'Código QR de la entrada');
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    dibujarEn(ctx, texto, 0, 0, cv.width);
    return cv;
  }

  function cortarTexto(ctx, texto, ancho) {
    if (ctx.measureText(texto).width <= ancho) return texto;
    let t = texto;
    while (t.length > 1 && ctx.measureText(t + '…').width > ancho) t = t.slice(0, -1);
    return t + '…';
  }

  // Imagen PNG de la entrada: encabezado del evento + QR grande.
  // d = { codigo, titulo, presenta, fecha, lugar, linea1, linea2 }
  async function imagenEntrada(d) {
    try { await Promise.all([document.fonts.load('800 40px Figtree'), document.fonts.load('400 30px Figtree')]); } catch (_) { /* usa la del sistema */ }
    const W = 1080, H = 1500;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const F = "'Figtree', system-ui, sans-serif";

    ctx.fillStyle = '#F3F4F6'; ctx.fillRect(0, 0, W, H);
    // Encabezado
    ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, W, 360);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FDBA74'; ctx.font = '700 30px ' + F;
    ctx.fillText(cortarTexto(ctx, (d.presenta || '').toUpperCase(), W - 140), 70, 100);
    ctx.fillStyle = '#FFFFFF'; ctx.font = '800 80px ' + F;
    ctx.fillText(cortarTexto(ctx, d.titulo || '', W - 140), 70, 200);
    ctx.fillStyle = '#E5E7EB'; ctx.font = '400 38px ' + F;
    ctx.fillText(cortarTexto(ctx, d.fecha || '', W - 140), 70, 265);
    if (d.lugar) ctx.fillText(cortarTexto(ctx, d.lugar, W - 140), 70, 320);

    // Tarjeta
    ctx.fillStyle = '#FFFFFF';
    const r = 40, x = 50, y = 410, w = W - 100, h = H - 470;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#111827'; ctx.font = '800 54px ' + F; ctx.textAlign = 'center';
    ctx.fillText(cortarTexto(ctx, d.linea1 || '', w - 80), W / 2, 500);
    ctx.fillStyle = '#4B5563'; ctx.font = '400 36px ' + F;
    ctx.fillText(cortarTexto(ctx, d.linea2 || '', w - 80), W / 2, 556);

    dibujarEn(ctx, d.codigo, (W - 760) / 2, 600, 760);

    ctx.fillStyle = '#4B5563'; ctx.font = '600 32px ' + F;
    ctx.fillText('Mostrá este QR en la puerta. Entra una sola vez.', W / 2, 1410);
    ctx.textAlign = 'start';

    return new Promise((ok) => cv.toBlob(ok, 'image/png'));
  }

  async function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  window.QR = Object.freeze({ canvas, imagenEntrada, descargar });
})();
