# Checklist de seguridad (sección 5 del plan)

Revisado en la fase 5. Cada punto dice **cómo se verificó** (test automático) o qué queda
**pendiente de configurar** en el proyecto real de Supabase.

`npm test` corre todo lo automático. Referencias: `tests/sql/*.sql` (base),
`tests/ui/*.mjs` (pantallas de punta a punta), `tests/carga/*.mjs` (carga y concurrencia).

## 5.1 Las reglas viven en la base

| Punto | Estado | Verificación |
|---|---|---|
| RLS activado en todas las tablas | ✅ | `10_fase0.sql` recorre todas las tablas de `public` |
| anon no lee ni escribe ninguna tabla | ✅ | `10_fase0.sql`: select/insert/update/delete por tabla → permiso denegado |
| authenticated no escribe ninguna tabla (todo por RPC) | ✅ | `10_fase0.sql` (privilegios) + intentos directos por rol |
| RRPP lee solo sus ventas; puerta/caja no leen ventas; admin lee todo | ✅ | `10_fase0.sql` |
| Toda RPC es `SECURITY DEFINER` con `search_path = public` | ✅ | `10_fase0.sql` lo verifica en el catálogo |
| El rol sale de `perfiles` por `auth.uid()`; un rol enviado en el token se ignora | ✅ | `10_fase0.sql` ("un rol admin mandado en el token se ignora") |
| Matriz completa función × rol (40 funciones × 7 situaciones = 280 casos) | ✅ | `60_matriz_roles.sql`; si aparece una función sin declarar, falla |
| Los clientes no pueden crear objetos en `public` | ✅ | migración 0008 + `60_matriz_roles.sql` |

## 5.2 Funciones RPC

| Punto | Estado | Verificación |
|---|---|---|
| Precio y comisión los pone el servidor; no se pueden alterar | ✅ | `20_fase1.sql`, `fase1.mjs` (intento desde el navegador) |
| Tanda vigente; si se agota pasa a la siguiente; no se parte la venta | ✅ | `20_fase1.sql`, `fase1.mjs` |
| Stock de tanda, límite por RRPP (fijo/%) y tope, sin carreras | ✅ | `20_fase1.sql` + `concurrencia.mjs` (20 a la vez con 5 lugares → pasan 5) |
| Idempotencia (doble toque / reintento) | ✅ | `20_fase1.sql`, `fase1.mjs`, `concurrencia.mjs` (10 a la vez → 1 venta) |
| Token del link devuelto una vez; solo se guarda el hash | ✅ | `20_fase1.sql` |
| Freno de fuerza bruta: 5 intentos y 15 minutos | ✅ | `30_fase2.sql`, `fase2.mjs` |
| Link rotado / pase rotado dejan de funcionar | ✅ | `30_fase2.sql`, `fase2.mjs` |
| Lista de puerta sin código en claro ni DNI completo | ✅ | `40_fase3.sql` |
| Gana el primer ingreso; repetidos a auditoría | ✅ | `40_fase3.sql`, `fase3.mjs`, `concurrencia.mjs`, `carga.mjs` |
| Tope bloqueante en `emitir_venta`, `venta_puerta` y cortesías | ✅ | `concurrencia.mjs` (los tres canales a la vez) |
| Caja sin señal: se acepta por encima del tope con aviso y auditoría (decisión de M) | ✅ | `40_fase3.sql`, `fase3.mjs` |
| No bajar tope ni cantidad de tanda por debajo de lo emitido | ✅ | `50_fase4.sql`, `fase4.mjs` |
| Anular solo admin, con motivo y quién/cuándo | ✅ | `50_fase4.sql`, `fase4.mjs` |

## 5.3 Códigos y links

| Punto | Estado | Verificación |
|---|---|---|
| Código de entrada: 128 bits aleatorios en base32 | ✅ | `10_fase0.sql` (1.000 códigos distintos, base32 RFC 4648) |
| Token del link independiente del código | ✅ | `20_fase1.sql` |
| Token en el fragmento (`#t=` / `#e=`), no viaja al servidor | ✅ | diseño de `entrada.html`; `fase1.mjs` revisa el link |
| La página pública no usa la sesión de nadie | ✅ | `fase2.mjs` (con una sesión de RRPP abierta en el mismo celular) |

## 5.4 Autenticación

| Punto | Estado | Verificación / pendiente |
|---|---|---|
| Usuario + contraseña con mail interno; el RRPP solo ve su usuario | ✅ | `fase0.mjs`, `fase1.mjs` |
| Alta por el admin + "Enviar acceso por WhatsApp" | ✅ | `fase4.mjs` (alta, primer ingreso y cambio de clave) |
| Cambio de contraseña obligatorio la primera vez (mínimo 8) | ✅ en la app | `fase1.mjs`. ⚠️ **Pendiente**: en Supabase → Auth → *Password min length* = 8 |
| Desactivar un usuario lo bloquea al instante | ✅ | `10_fase0.sql`, `20_fase1.sql`, `fase1.mjs` |
| Registro abierto desactivado | ⚠️ **Pendiente** | Supabase → Auth → *Allow new users to sign up* = **off**. (Aunque alguien se registre, sin perfil no tiene ningún permiso: lo prueba `10_fase0.sql`.) |
| Confirmación de mail desactivada | ⚠️ **Pendiente** | Supabase → Auth → Email → *Confirm email* = **off** |

## 5.5 Puerta sin conexión

| Punto | Estado | Verificación |
|---|---|---|
| Lista en IndexedDB con hashes y lo mínimo | ✅ | `40_fase3.sql`, `fase3.mjs` (modo avión) |
| Sincronización cada 10 s con señal | ✅ | `fase3.mjs` |
| "Sin conexión desde HH:MM" y última sincronización siempre visible | ✅ | `fase3.mjs` |
| Riesgo conocido: dos escáneres sin señal | ⚠️ Aceptado | Se resuelve al sincronizar (gana el primero, `fase3.mjs`). Conviene modem 4G/Wi-Fi en la puerta |
| Caja sin señal: guarda, marca pendientes y avisa cerca del tope | ✅ | `fase3.mjs` |

## 5.6 Otros

| Punto | Estado | Verificación / pendiente |
|---|---|---|
| CSP estricto, sin scripts de terceros, sin inline | ✅ | `revisar_estatico.mjs` + sin errores de CSP en todas las pantallas |
| `connect-src` solo al proyecto | ⚠️ **Pendiente** | Al crear el proyecto: URL en `js/config.js` **y** en el CSP de `index.html` y `entrada.html` (`npm run test:estatico` avisa si no coinciden) |
| Anti doble envío (botón deshabilitado antes del await + clave) | ✅ | `fase1.mjs`, `fase3.mjs` |
| Auditoría de toda escritura relevante | ✅ | `50_fase4.sql`, `fase4.mjs` |
| Texto de datos personales + anonimizar manual | ✅ | "Los datos se usan solo…" en Nueva entrada; `50_fase4.sql` |
| Respaldo CSV desde el panel | ✅ | `fase4.mjs` ("Descargar todo") |
| Ninguna clave privilegiada en el repo | ✅ | `revisar_estatico.mjs` |

## Configuración del proyecto Supabase (al crearlo)

- [ ] Auth: sign up **off**, confirm email **off**, password min length **8**.
- [ ] Correr las migraciones en orden (`supabase/migrations/`). **No** correr `seed.sql` en producción (o usar
      `supabase/limpiar_pruebas.sql` después de la prueba de campo).
- [ ] `js/config.js` + CSP con la URL y la *anon key* (nunca la *service role*).
- [ ] Desplegar la Edge Function `admin_crear_usuario` con **Verify JWT desactivado** (la función verifica que sea un admin).
- [ ] Crear el primer admin (ver README).
- [ ] Plan **Pro** el mes de la venta, o activar el ping diario (`.github/workflows/ping-supabase.yml`).
- [ ] Opcional: desactivar Realtime y GraphQL (no se usan; igual no exponen nada porque no hay permisos).

## Riesgos que quedan (y su respuesta)

| Riesgo | Respuesta |
|---|---|
| Celular de puerta robado | Tiene la lista con nombres, últimos 3 del DNI y hashes. El admin desactiva el usuario; "Salir" borra la lista. |
| Celular de RRPP robado | El admin desactiva el usuario (bloqueo inmediato) y reenvía o anula lo necesario. |
| Captura del QR compartida | Gana el primer escaneo; el segundo ve "Ya ingresó a las HH:MM" con nombre y DNI parcial. |
| Dos escáneres sin señal | Ver 5.5. |
| Comisión pagada y después se anula la venta | El panel muestra el saldo negativo; se descuenta del próximo pago. |
