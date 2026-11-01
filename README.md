# Entradas · Club Deportivo Mitre

PWA estática (GitHub Pages) + Supabase para vender entradas por RRPP, validar en la puerta y rendir la plata.
El plan completo está en [`PLAN_app_entradas.md`](PLAN_app_entradas.md).

## Estructura

```
index.html            Ingreso y, según el rol, RRPP / Puerta / Caja / Admin
entrada.html          Página pública del comprador (sin login, token en #t=…)
sw.js                 Service worker (CACHE_NAME sale de js/version.js)
manifest.webmanifest
css/app.css           Estilos (paleta y tipografía del mockup)
js/version.js         APP_VERSION y CACHE_NAME: se cambian SOLO acá
js/config.js          URL del proyecto, anon key y dominio interno de usuarios
js/util.js            plural(), pesos(), fechas, mensajes de error sin jerga
js/api.js             Cliente de Supabase (solo anon key)
js/app.js             Arranque, ingreso, cambio de contraseña y ruteo por rol
js/rrpp.js            App del RRPP (Inicio, Nueva entrada, Entrada lista, Mis ventas, Detalle)
js/puerta-comun.js    IndexedDB, reloj corregido con el servidor, estado de sincronización, sonido
js/escaner.js         Cámara + lectura de QR (BarcodeDetector o jsQR)
js/puerta.js          App de Puerta (preparar lista, escáner sin conexión, buscar, sincronizar)
js/caja.js            App de Caja (venta en puerta con pulsera, caja de puerta, ventas sin señal)
js/admin.js           Panel de administración (tablero, ventas, RRPP, transferencias, rendición,
                      evento y tandas, auditoría, exportes y cierre)
js/entrada.js         Página del comprador (DNI, QR, guardar imagen, pasar a otra persona)
js/qr.js              Dibujo del QR y de la imagen PNG de la entrada
vendor/               Librerías copiadas al repo (sin CDN): supabase-js, qrcode-generator, jsQR, Figtree
supabase/migrations/  Esquema, seguridad (RLS + revocaciones) y RPC
supabase/functions/   Edge Function admin_crear_usuario (alta de usuarios y contraseñas temporales)
supabase/seed.sql     Datos de PRUEBA (evento, tandas, usuarios)
tests/                Tests SQL (Postgres local), de interfaz (Chromium) y de carga
docs/                 Checklist de seguridad y guía de la prueba de campo
.github/workflows/    Tests en cada push y ping diario a Supabase
```

## Estado

- **Fase 0** (base): lista.
- **Fase 1** (RRPP): lista. `emitir_venta` con tanda vigente, stock, límite por RRPP, tope general,
  comisión congelada e idempotencia; Inicio, Nueva entrada, Entrada lista con WhatsApp, Mis ventas y Detalle.
- **Fase 2** (link del comprador): lista. DNI con freno de 5 intentos y bloqueo de 15 minutos, QR por
  entrada, Guardar imagen (PNG), Pasar a otra persona con link individual (`#e=`) que se invalida al
  volver a pasarla.
- **Fase 3** (puerta y caja): lista. Lista en IndexedDB (solo hashes), escáner offline con resultado
  en color + sonido + vibración, gana el primer ingreso entre celulares (hora corregida con el servidor),
  buscar por DNI o apellido, deshacer ingreso (queda en auditoría), sincronización cada 10 s con la
  última sincronización siempre visible, venta en puerta que frena en el tope con señal y, sin señal,
  guarda las ventas y las sube después aunque pasen el tope (con aviso y auditoría).
- **Fase 4** (admin): lista. Tablero con alertas, ventas (buscar, filtrar, reenviar, anular con motivo,
  cortesías), RRPP (comisión, límite fijo o %, alta con "Enviar acceso por WhatsApp", nueva contraseña,
  desactivar), transferencias (confirmar y CSV), rendición según la sección 7 con comprobante PNG,
  evento/tandas/datos para transferir, auditoría legible, exportes CSV para Excel es-AR, resumen de
  cierre y anonimización manual de DNI y teléfonos.
- **Fase 5** (endurecimiento): matriz de permisos función × rol, concurrencia (20 a la vez con 5 lugares
  → pasan 5), carga de 1.000 entradas y 1.000 ingresos desde 2 celulares, flujo completo de punta a punta,
  checklist de seguridad (`docs/SEGURIDAD.md`) y guía de la prueba de campo (`docs/PRUEBA_DE_CAMPO.md`).
  **Falta**: la prueba de campo con RRPP reales y un Android de gama baja (necesita el proyecto de Supabase).

## Seguridad en dos líneas

- **RLS en todas las tablas** y **ninguna escritura directa**: `anon` y `authenticated` no tienen
  `insert/update/delete` en nada. Todo pasa por funciones RPC `SECURITY DEFINER` que verifican el rol
  desde `perfiles` con `auth.uid()`.
- El frontend usa **solo la anon key**. La service role key nunca va al repo.

## Poner en marcha Supabase

1. Crear el proyecto en Supabase (región São Paulo, la más cercana).
2. **Auth → Providers → Email**: activado, *Confirm email* **desactivado**. *Allow new users to sign up*:
   **desactivado** (los usuarios los crea el admin).
3. **SQL Editor**: correr en orden `supabase/migrations/*.sql`.
   Para pruebas, correr también `supabase/seed.sql` (contraseña de todos: `prueba1234`).
   Con la CLI: `supabase db push` y `supabase db reset` para la semilla.
4. **Settings → API**: copiar *Project URL* y *anon public key* a `js/config.js`, y poner el mismo host
   en el `connect-src` del Content-Security-Policy de `index.html` y `entrada.html`
   (`npm run test:estatico` avisa si no coinciden).
5. **Edge Function de usuarios** (para crear usuarios y mandar el acceso por WhatsApp desde el panel):
   ```bash
   supabase functions deploy admin_crear_usuario
   supabase secrets set AUTH_DOMAIN=usuarios.ticketera-app.com.ar ORIGENES_PERMITIDOS=https://<usuario>.github.io
   ```
   La service role la usa solo la función (Supabase se la da sola); nunca va al frontend.
   Mientras no esté instalada, los usuarios se pueden crear desde el panel de Supabase (Auth → Add user,
   con mail `<usuario>@usuarios.ticketera-app.com.ar`) y su perfil con `admin_registrar_usuario`.
6. **Primer admin**: crear el usuario en Auth y su fila en `perfiles` con `rol = 'admin'` desde el SQL Editor.
7. Plan: el gratis se pausa tras ~7 días sin uso. Pasar a **Pro** el mes de la venta.

## Probar en local

Requisitos: Node 18+ (`npm install` para el driver de Postgres de los tests), PostgreSQL 14+ instalado (solo los binarios; el script levanta uno descartable)
y Playwright con Chromium.

```bash
npm test               # todo (SQL, estáticos, pantallas, flujo completo, carga)
npm run test:sql       # RLS, revocaciones y roles sobre un Postgres local que emula Supabase
npm run test:estatico  # CSP, archivos del service worker, claves filtradas
npm run test:ui        # pantallas en Chromium headless (sin IDs ni jerga, 48 px, modo avión)
                       # fase 1: de punta a punta contra un Postgres local con las migraciones
                       # reales; Auth y RPC de Supabase se emulan en tests/backend_local.mjs
npm run test:flujo     # RRPP → comprador → puerta → admin, encadenados
npm run test:carga     # concurrencia y carga (1.000 entradas)
npm run servir         # http://127.0.0.1:8080/
```

## Versión

En cada cambio publicado subir `APP_VERSION` en `js/version.js` (el `CACHE_NAME` se deriva solo).
