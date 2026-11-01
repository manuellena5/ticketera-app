// Lector de QR con la cámara. Usa BarcodeDetector cuando el celular lo
// trae (rápido, nativo) y si no, jsQR vendorizado. Todo local, sin red.
(function () {
  'use strict';

  async function crearDetector() {
    try {
      if ('BarcodeDetector' in window) {
        const formatos = await window.BarcodeDetector.getSupportedFormats();
        if (formatos.includes('qr_code')) return new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch (_) { /* se usa jsQR */ }
    return null;
  }

  // Arranca la cámara en <video> y llama alLeer(texto) con cada QR leído.
  // Devuelve una función para detener.
  async function iniciar(video, alLeer) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    await video.play().catch(() => {});

    const detector = await crearDetector();
    const lienzo = document.createElement('canvas');
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    let activo = true;
    let timer = null;

    async function paso() {
      if (!activo) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          let texto = null;
          if (detector) {
            const r = await detector.detect(video);
            if (r && r[0]) texto = r[0].rawValue;
          } else {
            const escala = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
            lienzo.width = Math.round(video.videoWidth * escala);
            lienzo.height = Math.round(video.videoHeight * escala);
            ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
            const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
            const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (r && r.data) texto = r.data;
          }
          if (texto && activo) await alLeer(texto);
        }
      } catch (_) { /* un cuadro que falla no corta el escáner */ }
      if (activo) timer = setTimeout(paso, 100);
    }
    paso();

    return function detener() {
      activo = false;
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }

  window.Escaner = Object.freeze({ iniciar });
})();
