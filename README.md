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
js/entrada.js         Página del comprador
vendor/               Librerías copiadas al repo (sin CDN): supabase-js, Figtree
supabase/migrations/  Esquema, seguridad (RLS + revocaciones) y RPC
supabase/seed.sql     Datos de PRUEBA (evento, tandas, usuarios)
tests/                Tests SQL (Postgres local) y de interfaz (Chromium)
```

## Estado

- **Fase 0** (base): lista.
- **Fase 1** (RRPP): lista. `emitir_venta` con tanda vigente, stock, límite por RRPP, tope general,
  comisión congelada e idempotencia; Inicio, Nueva entrada, Entrada lista con WhatsApp, Mis ventas y Detalle.

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
5. Plan: el gratis se pausa tras ~7 días sin uso. Pasar a **Pro** el mes de la venta.

## Probar en local

Requisitos: Node 18+ (`npm install` para el driver de Postgres de los tests), PostgreSQL 14+ instalado (solo los binarios; el script levanta uno descartable)
y Playwright con Chromium.

```bash
npm test               # todo
npm run test:sql       # RLS, revocaciones y roles sobre un Postgres local que emula Supabase
npm run test:estatico  # CSP, archivos del service worker, claves filtradas
npm run test:ui        # pantallas en Chromium headless (sin IDs ni jerga, 48 px, modo avión)
                       # fase 1: de punta a punta contra un Postgres local con las migraciones
                       # reales; Auth y RPC de Supabase se emulan en tests/backend_local.mjs
npm run servir         # http://127.0.0.1:8080/
```

## Versión

En cada cambio publicado subir `APP_VERSION` en `js/version.js` (el `CACHE_NAME` se deriva solo).
