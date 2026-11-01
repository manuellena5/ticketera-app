# Puesta en marcha con el proyecto de Supabase

Proyecto: `https://nkeijeavrkdhtkvkgcvh.supabase.co` (ya cargado en `js/config.js` y en el CSP).

## 1. Base de datos

1. ✅ Migraciones (`supabase/migrations/`, en orden).
2. **Configuración inicial**: abrir `supabase/configuracion_inicial.sql`, cambiar el usuario, el nombre y la
   **contraseña temporal** del admin (las 3 líneas marcadas con ◄) y correrlo en *SQL Editor*.
   Crea el primer admin, el evento (en borrador) con sus 3 tandas y la configuración del club.
   Al final muestra `admins 1 · eventos 1 · tandas 3 · config 1`.
   **No** correr `seed.sql` (es solo para pruebas: tiene contraseñas conocidas).
3. **Verificación** (solo lectura): correr `supabase/verificar_proyecto.sql`. Todas las filas tienen que decir ✅.

## 2. Autenticación (Authentication → Sign In / Providers)

- **Allow new users to sign up**: desactivado (los usuarios los crea el admin).
- **Email** → **Confirm email**: desactivado.
- **Minimum password length**: 8.

## 3. Clave pública en la app

✅ Cargada en `js/config.js` (anon public). Es pública: va en el frontend.
**Nunca** poner la *Secret key* ni la *service_role* en el repo.

## 4. Edge Function para crear usuarios desde el panel

1. Correr la migración **`20261101000009_errores_tecnicos.sql`** (crea el registro de errores técnicos
   que usa la función y la app).
2. *Edge Functions → `admin_crear_usuario` → Code*: reemplazar todo por el contenido actual de
   `supabase/functions/admin_crear_usuario/index.ts` y **Deploy**.
3. *Edge Functions → `admin_crear_usuario` → Details / Settings*: **desactivar "Verify JWT"**
   (en algunos paneles dice "Enforce JWT verification" o "Verify JWT with legacy secret") y guardar.
   Es necesario: el navegador primero hace una consulta previa sin token (CORS) y, si el gateway exige
   el token, la rechaza y aparece el error *"Response to preflight request doesn't pass access control
   check"*. La función igual verifica ella misma que quien llama sea un admin activo.
4. *Edge Functions → Secrets*: `AUTH_DOMAIN` = `usuarios.ticketera-app.com.ar` y (opcional)
   `ORIGENES_PERMITIDOS` = `https://manuellena5.github.io`.

Con la CLI: `supabase functions deploy admin_crear_usuario --no-verify-jwt --project-ref nkeijeavrkdhtkvkgcvh`
(o usa `supabase/config.toml`, que ya tiene `verify_jwt = false`).

Si algo falla, el detalle técnico queda en el panel: **Errores**.

## 5. Primer ingreso y datos del evento

1. Abrir la app publicada (`https://manuellena5.github.io/ticketera-app/`), entrar con el usuario y la
   contraseña temporal del admin y elegir la contraseña definitiva.
2. *Evento y tandas*: cargar el **lugar**, revisar fecha, tope, precios y cantidades, y los **datos para
   transferir** (alias, CBU/CVU, titular, banco).
3. *RRPP*: crear los usuarios (RRPP, 2 de puerta, 1 de caja) y mandarles el acceso por WhatsApp.
4. Cuando todo esté listo, *Evento y tandas → Estado: A la venta*.

## 6. Antes de vender

- Hacer la prueba de campo (`docs/PRUEBA_DE_CAMPO.md`) y, si se hizo sobre este proyecto, borrar las ventas
  de prueba con `supabase/limpiar_pruebas.sql`.
- Plan Pro el mes de la venta, o el ping diario: en GitHub → *Settings → Secrets and variables → Actions*,
  crear `SUPABASE_URL` y `SUPABASE_ANON_KEY` (la clave pública).
