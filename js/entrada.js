// Página pública del comprador. No usa la sesión de nadie: solo llama a
// ver_entradas / pasar_entrada / ver_entrada_pasada con la anon key.
// El token viaja en el fragmento (#t=...), que no llega a ningún servidor.
// Fase 0: estructura. La lógica llega en la fase 2.
(function () {
  'use strict';

  const app = document.getElementById('app');
  document.getElementById('version').textContent = '· v' + self.APP_VERSION;

  function actualizarConexion() {
    document.getElementById('sin-conexion').hidden = navigator.onLine;
  }
  window.addEventListener('online', actualizarConexion);
  window.addEventListener('offline', actualizarConexion);
  actualizarConexion();

  const fragmento = new URLSearchParams(location.hash.slice(1));
  const tieneLink = fragmento.has('t') || fragmento.has('e');

  app.innerHTML =
    '<section class="pantalla">' +
    '<h2>Tu entrada</h2>' +
    (tieneLink
      ? '<div class="tarjeta"><p>Muy pronto vas a poder ver tu entrada acá.</p></div>'
      : '<div class="aviso aviso--alerta">Este link no está completo. Pedile a quien te vendió la entrada que te lo vuelva a mandar.</div>') +
    '</section>';
})();
