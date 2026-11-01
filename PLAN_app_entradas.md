# App de entradas para eventos del club — Plan de desarrollo

> Plan para que lo implemente **Claude Code**, fase por fase. Cada fase termina con criterios de aceptación verificables.
> Prioridades, en este orden: **1) seguridad**, **2) facilidad de uso para los RRPP**, **3) rendición de la plata clara**.
> El mockup de pantallas (RRPP, comprador, puerta y admin) está en el canvas "App de entradas — mockup". Los textos, colores y jerarquía del mockup son la referencia visual. Paleta: fondo `#F3F4F6`, texto `#111827`, acción principal `#C2410C`, WhatsApp/válida `#15803D`, alerta `#FBBF24`, error `#B91C1C`. Tipografía Figtree (vendorizada).

---

## 0. Contexto

- Organiza el **Club Deportivo Mitre** (escribirlo siempre así, completo).
- Evento: baile con **Simón Aguirre**, viernes **18/12/2026 a las 23:59 hs**. Público esperado: ~1.000 personas de 4 o 5 pueblos.
- Venta por **RRPP**: el comprador le paga en **efectivo** o **transferencia a la cuenta del club**. El RRPP carga la venta y le manda la entrada por WhatsApp.
- **Tandas de precio**: Anticipada ($20.000 hasta 30/11), General ($23.000 del 1/12 al 15/12) y Puerta ($25.000 el día del evento). Cada tanda tiene **precio, fechas y cantidad de entradas**, todo configurable.
- **Puerta**: la venta se registra en la app y se entrega una **pulsera**, sin QR.
- **Tope general**: la banda cobra 10% más si se superan las **1.000 personas**. La app cuenta en vivo y frena la venta al llegar al tope, que el admin **puede mover**.
- **Comisión por RRPP**: cada RRPP tiene su monto por entrada (por ejemplo $750). Con $0 vende **ad honorem**.
- No hay página pública del evento ni cobro online. El RRPP es el único canal digital.

## 1. Decisiones tomadas (no cambiar sin consultar a M)

| Tema | Decisión |
|---|---|
| Transferencias | Van **a la cuenta del club**. El RRPP solo rinde el efectivo. |
| Venta en puerta | Se registra en la app (efectivo o transferencia) y se entrega pulsera. Sin QR. Suma al conteo y a la caja. |
| Link del comprador | **Pide el DNI** del titular y recién ahí muestra el QR. |
| Entradas de papel para comercios | **Más adelante** (fase 6). El modelo de datos ya las contempla. |
| Quién carga los datos | El RRPP, en el momento de la venta. El comprador no carga nada. |
| Anular una venta | Solo el administrador. Queda registrado quién y cuándo. |
| Multi-evento | El modelo es multi-evento desde el día 1 (todo cuelga de `evento_id`), aunque la v1 se use para un solo baile. |
| Varias entradas en una venta | **Titular + repartir.** El RRPP carga solo los datos del que paga, con 1 a 6 entradas. El titular abre su link con su DNI y puede **pasar cada QR** a otra persona por WhatsApp. No se pide el DNI de cada asistente. |
| Comisión | **Por RRPP**, con monto propio por entrada. $0 = ad honorem. La comisión de cada venta queda **congelada** al emitirla: si después se cambia el monto, las ventas anteriores no cambian. |
| Límite por RRPP | Por tanda, configurable por RRPP: **sin límite** (vende de la bolsa común de la tanda), **cantidad fija** (por ejemplo 60 por tanda) o **porcentaje de la tanda** (por ejemplo 20%: se ajusta solo si cambia la cantidad de la tanda). |
| Tandas | Cada una con **precio, desde, hasta y cantidad**. **Si una tanda se agota, aparece la siguiente para vender** aunque no haya llegado su fecha. Ver regla de tanda vigente en 5.2. |
| Datos para transferir | Se cargan **una vez** en la configuración del panel de admin (alias, CBU/CVU, titular de la cuenta, banco o billetera) y **les aparecen a todos los usuarios** que cobran: RRPP y caja. |
| Tope general | Configurable y **movible** por el admin. Manda sobre la suma de las tandas. No puede bajar por debajo de lo ya emitido. |
| Cortesías | Solo las emite el admin, a $0, y **cuentan para el tope**. |
| Usuarios | Usuario y contraseña que crea el admin. El panel tiene **"Enviar acceso por WhatsApp"** con usuario, contraseña temporal y link a la app. En el primer ingreso se obliga a cambiar la contraseña. |
| Puerta | **2 celulares de escáner** (rol `puerta`) y **1 celular de caja** para la venta en puerta (rol `caja`). |
| Cierre de venta RRPP | Configurable. Por defecto, el fin de la tanda General (15/12 23:59). |

| Rendición | El RRPP rinde **todo** el efectivo. La comisión **no se descuenta**: se muestra aparte (cuánto le corresponde) y el club se la paga por separado. |

### Supuesto por defecto
- Al llegar al tope, la app **bloquea** la emisión. El admin puede subir el tope (decisión consciente de pagar el recargo).

## 2. Reglas de UX (obligatorias)

Las apps del club las usa gente no técnica:
- **Nada de jerga ni datos internos en pantalla**: ni IDs, ni nombres de tablas, ni URLs de backend, ni códigos de error técnicos.
- Mensajes **cortos, en presente y en términos de la persona**. Ejemplos: "Sin conexión. Para emitir entradas necesitás internet." / "Ya ingresó a las 23:14." / "Te quedan 12 entradas en esta tanda."
- Helper `plural(n, sing, plur)`: "1 entrada" / "3 entradas".
- **Mobile-first.** Botones de **48 px o más**, un solo botón principal por pantalla, texto de 16 px o más y alto contraste.
- **Emitir una entrada en 3 toques** desde el inicio: Nueva entrada → completar → Emitir → Enviar por WhatsApp.
- Vocabulario de M: "cobrar", no "pagar". "Rendir", "Entrada", "Tanda", "Pulsera".
- Español de Argentina (voseo). Montos con `$` y separador de miles con punto: `$20.000`.
- El número de versión chiquito en el encabezado (`· v1`) es lo único "técnico" visible, para soporte.

## 3. Arquitectura

- **Frontend**: PWA estática en **GitHub Pages**, con HTML, CSS y JS sin framework (el mismo estilo que las otras apps del club). Service worker con `CACHE_NAME` versionado; `APP_VERSION` y `CACHE_NAME` se suben juntos en cada cambio.
  - `index.html`: login y, según el rol, la app de **RRPP**, **Puerta** o **Admin**.
  - `entrada.html`: página pública del comprador. No requiere login.
- **Backend**: **Supabase** (Postgres + Auth + RLS + funciones RPC).
  - El cliente usa **solo la anon key**. La service role key **nunca** va al frontend.
  - Crear usuarios RRPP: **Edge Function `admin_crear_usuario`**, que valida que quien llama es admin y usa la service role desde los secrets de la función. Alternativa para la v1: crearlos desde el panel de Supabase.
- **Librerías vendorizadas** (copiadas al repo, sin CDN en runtime): generador de QR y lector de QR por cámara (por ejemplo `qr-scanner` o `jsQR`). Así funcionan offline y no dependen de terceros.
- **Plan de Supabase**: el gratis alcanza en volumen, pero **se pausa tras ~7 días sin actividad**. Pasar a **Pro (US$25)** el mes de la venta, o como mínimo agregar un ping diario.

## 4. Modelo de datos (Postgres)

Todas las tablas llevan `id uuid default gen_random_uuid()`, `creado_en timestamptz default now()` y `evento_id` donde aplique. Los IDs son internos y **nunca se muestran**.

```sql
eventos (
  id, nombre, fecha, lugar,
  tope_entradas int not null,          -- 1000, movible por el admin
  aviso_desde int,                     -- 950 (aviso en el tablero)
  max_por_venta int default 6,
  cierre_venta_rrpp timestamptz,       -- después de esto, solo puerta
  estado text check (estado in ('borrador','venta','cerrado'))
)

tandas (
  id, evento_id, nombre,               -- 'Anticipada' | 'General' | 'Puerta'
  canal text check (canal in ('rrpp','caja')),
  precio numeric not null,
  cantidad int not null,               -- stock de la tanda
  desde timestamptz, hasta timestamptz,
  orden int
)

config_club (                          -- una sola fila; la edita solo el admin
  id int primary key default 1 check (id = 1),
  nombre_club text default 'Club Deportivo Mitre',
  transf_alias text, transf_cbu_cvu text,
  transf_titular text, transf_entidad text,   -- banco o billetera
  actualizado_en timestamptz, actualizado_por uuid
)
-- Lectura: roles admin, rrpp y caja (RPC `datos_transferencia()`). Nunca anon.

perfiles (
  user_id uuid primary key references auth.users,
  nombre, usuario, telefono, pueblo,
  rol text check (rol in ('admin','rrpp','puerta','caja')),
  activo boolean default true,
  debe_cambiar_clave boolean default true
)

rrpp_evento (                          -- condiciones de cada RRPP en cada evento
  evento_id, rrpp_id references perfiles,
  comision_por_entrada numeric not null default 0,   -- 0 = ad honorem
  limite_tipo text check (limite_tipo in ('sin_limite','cantidad','porcentaje')) default 'sin_limite',
  limite_valor numeric,                -- 60 (entradas por tanda) o 20 (% de la tanda)
  primary key (evento_id, rrpp_id)
)
-- Límite efectivo en una tanda: sin_limite → stock de la tanda;
-- cantidad → limite_valor; porcentaje → floor(tanda.cantidad × limite_valor / 100).

ventas (
  id, evento_id,
  canal text check (canal in ('rrpp','caja','cortesia','papel')),
  rrpp_id references perfiles null,    -- null en caja/cortesía
  tanda_id references tandas,
  titular_nombre text not null,        -- en puerta puede ser 'Venta en puerta'
  titular_dni text,                    -- solo dígitos, 7–8; obligatorio en canal rrpp
  titular_tel text,
  cantidad int check (cantidad between 1 and 20),
  precio_unitario numeric not null,    -- lo pone el SERVIDOR según la tanda vigente
  total numeric not null,
  comision_unitaria numeric not null default 0,  -- copia congelada de la comisión del RRPP al emitir
  medio text check (medio in ('efectivo','transferencia','cortesia')),
  transferencia_confirmada boolean default false,
  link_hash text unique,               -- sha256 del token del link (el token NO se guarda)
  estado text check (estado in ('activa','anulada')) default 'activa',
  anulada_por, anulada_en, motivo_anulacion,
  idempotency_key uuid unique,         -- evita ventas duplicadas por doble toque o reintento
  creada_por uuid references perfiles
)

entradas (
  id, evento_id, venta_id,
  nro int,                             -- 1..cantidad dentro de la venta
  codigo text unique not null,         -- aleatorio de 128 bits en base32; es lo que lleva el QR
  serie text,                          -- para papel en la fase 6 (ej. 'N-0012')
  estado text check (estado in ('valida','anulada')) default 'valida',
  link_propio_hash text unique,        -- sha256 del link individual cuando el titular la pasa a otra persona
  pasada_a text,                       -- nombre opcional que escribe el titular ("Laura")
  ingreso_en timestamptz,              -- null = no ingresó
  ingreso_dispositivo text,
  ingreso_por uuid
)

movimientos_rrpp (                     -- entregas de efectivo y pagos de comisión, por separado
  id, evento_id, rrpp_id,
  tipo text check (tipo in ('entrega_efectivo','pago_comision')),
  monto numeric not null check (monto > 0),
  nota text,
  registrado_por uuid
)

auditoria (
  id, evento_id, usuario_id, accion text, detalle jsonb, creado_en
)

intentos_link (                        -- freno de fuerza bruta en la página pública
  link_hash text, intentos int, bloqueado_hasta timestamptz
)
```

Índices: `entradas(codigo)`, `ventas(evento_id, rrpp_id)`, `ventas(titular_dni)`, `entradas(evento_id, ingreso_en)`.

## 5. Seguridad (el núcleo del proyecto)

### 5.1 Principio: las reglas viven en la base, no en la app
- **RLS activado en todas las tablas.** Los clientes **no escriben tablas directamente**: toda escritura pasa por **funciones RPC `SECURITY DEFINER`** que validan rol, estado y reglas. Revocar `insert/update/delete` a `anon` y `authenticated` sobre todas las tablas.
- Lecturas: el RRPP lee **solo sus ventas**; Puerta lee solo lo necesario para validar (por RPC); el Admin lee todo.
- Toda función RPC usa `set search_path = public` y verifica el rol desde `perfiles` con `auth.uid()`. Nunca confía en un rol enviado por el cliente.

### 5.2 Funciones RPC

| Función | Rol | Qué valida |
|---|---|---|
| `emitir_venta(idem_key, nombre, dni, tel, cantidad, medio)` | rrpp | Usuario activo; evento en `venta`; antes de `cierre_venta_rrpp`; **tanda vigente** (regla abajo; el precio lo pone el servidor); `cantidad ≤ max_por_venta`; **stock de la tanda**; **límite del RRPP en esa tanda**; **tope general**, con `SELECT … FOR UPDATE` sobre la fila del evento para serializar; DNI de 7–8 dígitos; nombre no vacío. Copia la comisión del RRPP en `comision_unitaria`. Genera los códigos y el token del link. Devuelve el **token una sola vez** (se guarda solo el hash). Idempotente por `idem_key`. Si la venta no entra en la tanda vigente, responde con un mensaje claro ("Quedan 3 entradas de la Anticipada") y **no** parte la venta entre dos tandas. |
| `pasar_entrada(token, dni, nro, nombre_opcional)` | anon | Valida token y DNI del titular (mismo freno de intentos). Genera un **link individual** para esa entrada y devuelve el token una sola vez. Si ya existía uno, lo rota (el anterior deja de andar). |
| `ver_entrada_pasada(token_individual)` | anon | Muestra solo esa entrada (QR, evento, tanda). No pide DNI: el titular eligió a quién mandarla. |
| `reenviar_link(venta_id)` | rrpp (propia) / admin | Rota el token: genera uno nuevo e invalida el anterior. Sirve si el comprador perdió el mensaje o se mandó a otro número. |
| `ver_entradas(token, dni)` | anon | Busca por `sha256(token)`; compara el DNI; **máximo 5 intentos fallidos** y bloqueo de 15 minutos; mensaje genérico si falla. Devuelve titular, evento, tanda y la lista de `{nro, codigo, estado, ingresó}`. Nunca devuelve datos de otras ventas. |
| `descargar_lista_puerta(evento_id)` | puerta | Devuelve solo lo necesario para validar sin conexión: `sha256(codigo)`, nombre del titular, últimos 3 dígitos del DNI, `sha256(dni + sal_evento)`, tanda, nro/cantidad, estado y si ya ingresó. |
| `registrar_ingresos(lote[])` | puerta | Lote de `{codigo, momento, dispositivo}`. Regla: **gana el primer ingreso** por timestamp; los repetidos quedan en auditoría como "intento duplicado". |
| `venta_puerta(idem_key, cantidad, medio)` | caja | Tanda canal `caja`; stock; tope; crea la venta y las entradas **ya marcadas como ingresadas** (pulsera). |
| `anular_venta(venta_id, motivo)` | admin | Anula la venta y sus entradas; auditoría. |
| `emitir_cortesia(nombre, dni, cantidad)` | admin | A $0, cuenta para el tope. |
| `confirmar_transferencias(venta_ids[])` | admin | Marca las transferencias que aparecen en el resumen de Mercado Pago. |
| `registrar_movimiento_rrpp(rrpp_id, tipo, monto, nota)` | admin | `tipo` = entrega de efectivo o pago de comisión. Valida que no supere lo pendiente (salvo confirmación con nota). Auditoría. |
| `ajustar_rrpp(rrpp_id, comision, limite_tipo, limite_valor)` | admin | Auditoría. Las ventas ya emitidas conservan su comisión. |
| `ajustar_evento(...)` y `ajustar_tanda(...)` | admin | No permite bajar el tope ni la cantidad de una tanda por debajo de lo ya emitido. Auditoría. |
| `admin_crear_usuario` (Edge Function) | admin | Crea el usuario con contraseña temporal, `debe_cambiar_clave = true`, y devuelve el texto para "Enviar acceso por WhatsApp". |

**Regla de tanda vigente** (para un canal):
1. Se recorren las tandas del canal en `orden`.
2. Una tanda **termina** cuando se agota (`cantidad − emitidas = 0`) o cuando pasa su `hasta`.
3. Una tanda **empieza** cuando llega su `desde` **o cuando termina la anterior** (decisión de M: si se agota una tanda, aparece la siguiente para vender, sin esperar su fecha).
4. La vigente es la primera, en `orden`, que empezó, no terminó y tiene stock.
5. El cambio de tanda se refleja al instante en todos los celulares: la próxima venta ya sale con el precio nuevo. En el Inicio del RRPP: "Se agotó la Anticipada. Ahora vendés General a $23.000."
6. Si no hay tanda vigente: "No hay entradas a la venta en este momento."
7. El tope general siempre manda: aunque la tanda tenga stock, no se emite si se llega al tope.

### 5.3 Códigos y links
- **Código de entrada** (lo que lleva el QR): 128 bits de `gen_random_bytes` en base32, sin datos personales. No correlativo e imposible de adivinar.
- **Token del link**: otros 128 bits, independiente del código. En la base solo se guarda `sha256(token)`.
- El link va en el **fragmento** (`entrada.html#t=TOKEN`). El fragmento no viaja al servidor ni queda en logs ni en el referrer.
- La página pública **no** usa la sesión de ningún usuario. Llama solo a `ver_entradas`.

### 5.4 Autenticación
- Supabase Auth con **usuario y contraseña** que crea el admin. Internamente se usa un mail sintético (`<usuario>@<dominio-del-club>`) con confirmación desactivada. El RRPP solo ve y escribe su usuario.
- El admin entrega el acceso con **"Enviar acceso por WhatsApp"**: abre WhatsApp con el usuario, una contraseña temporal y el link de la app. En el primer ingreso la app obliga a elegir una contraseña nueva (mínimo 8 caracteres). El admin puede **restablecer** la contraseña y volver a mandarla.
- La sesión persiste en el celular. **Desactivar un usuario** (`activo=false`) lo bloquea al instante en todas las RPC.

### 5.5 Puerta sin conexión
- La lista descargada se guarda en **IndexedDB**, con hashes y lo mínimo (ver 5.2).
- Los ingresos se guardan localmente y se sincronizan **cada 10 segundos si hay señal**.
- **Dispositivos**: 2 celulares de escáner (rol `puerta`) y 1 celular de caja (rol `caja`).
- **Riesgo conocido**: los dos escáneres sin señal no se enteran de los ingresos del otro, así que una copia del mismo QR podría entrar una vez por cada uno. Mitigación: sincronización forzada antes de abrir las puertas, sincronización cada 10 segundos con señal, y en pantalla "Sin conexión desde 22:41" para que el personal lo sepa. Conviene un modem 4G o Wi-Fi para la puerta.
- **Caja**: la venta en puerta **necesita conexión** para respetar el stock y el tope. Sin señal permite seguir vendiendo, guarda las ventas en el celular, las marca "pendientes de subir" y avisa si el contador local se acerca al tope.

### 5.6 Otros
- **Content-Security-Policy** por meta tag: `default-src 'self'`; `connect-src` solo al proyecto Supabase; sin scripts de terceros en runtime.
- **Anti doble envío**: deshabilitar el botón **antes** del `await`, liberarlo en un `finally`, y usar `idempotency_key`.
- **Auditoría** de toda escritura relevante.
- **Datos personales**: texto breve al emitir ("Los datos se usan solo para tu entrada al evento."). Dejar lista una función para anonimizar DNI y teléfono después del evento. **No se ejecuta sola**: M decide cuándo.
- **Respaldo**: exportación CSV diaria desde el panel de Admin.

### 5.7 Amenazas y respuesta
| Riesgo | Respuesta |
|---|---|
| RRPP emite sin cobrar | Cada entrada emitida es deuda del RRPP. Límite por tanda y rendición. |
| RRPP o comprador reenvía el link | El link pide el DNI del titular. |
| Captura de pantalla compartida | Gana el primer escaneo; el segundo da "Ya ingresó a las HH:MM", con nombre y últimos 3 dígitos del DNI para verificar. |
| El titular pasa un QR y además lo usa otro | Es el mismo código: gana el primer escaneo. El titular ve en su link qué entradas ya pasó y a quién. |
| QR inventado o falsificado | Código aleatorio de 128 bits: "Entrada no válida". |
| Celular de un RRPP robado | El admin desactiva al usuario y anula o reenvía lo necesario. |
| App modificada por alguien | Las reglas están en la base: precio, comisión, límites y tope los decide el servidor. |
| Fuerza bruta sobre el DNI de un link | 5 intentos y bloqueo; el token por sí solo ya es imposible de adivinar. |
| Superar 1.000 personas | Tope bloqueante en `emitir_venta` y `venta_puerta`, con aviso al 95%. |

## 6. Pantallas

### 6.1 RRPP (celular)
1. **Ingresar**: usuario y contraseña. Recordar sesión.
2. **Inicio**:
   - Tanda vigente y precio ("Anticipada · $20.000 · hasta el 30/11").
   - Botón grande **Nueva entrada**.
   - Tarjetas: **Vendidas** (12, y "te quedan 48 en esta tanda" si tiene límite), **Efectivo a rendir** (todo lo cobrado en efectivo, sin descontar nada) y **Tu comisión** ("Te corresponden $9.000 · cobrado $0"). La tarjeta de comisión no aparece si vende ad honorem.
   - Lista de ventas recientes: nombre, cantidad, medio y estado ("Enviada", "Ingresó").
3. **Nueva entrada**:
   - Campos: nombre y apellido, DNI (teclado numérico), WhatsApp (opcional pero recomendado).
   - Cantidad con − / + (1 a 6).
   - Medio: **Efectivo** / **Transferencia al club**. Al elegir transferencia se muestran los **datos del club** cargados por el admin (alias, CBU/CVU, titular y banco), con botones "Copiar alias" y "Compartir datos por WhatsApp", y el texto "Pedile el comprobante".
   - Total grande.
   - Botón **Emitir entrada**.
4. **Entrada lista**:
   - Resumen de la venta.
   - Botón principal **Enviar por WhatsApp**: abre `wa.me/<tel>?text=` con un mensaje armado que incluye el link.
   - Secundarios: "Copiar link" y "Nueva entrada".
5. **Detalle de venta** (desde la lista): reenviar por WhatsApp (rota el link) y ver el estado de cada entrada. Para anular, el RRPP pide al admin; no puede anular él.
6. **Sin conexión**: "Sin conexión. Para emitir entradas necesitás internet." Igual se pueden ver las últimas ventas guardadas.

### 6.2 Comprador (link público)

**Circuito de una compra de varias entradas:**
1. El RRPP emite, por ejemplo, 3 entradas a nombre de **Ana** (con el DNI de Ana) y le manda **su link** por WhatsApp.
2. **El link de Ana queda siempre asociado a ella**: para abrirlo hay que poner el DNI de Ana. Ahí ve sus 3 QR.
3. En cada QR que no es para ella toca **"Pasar a otra persona"**: escribe el nombre (opcional, por ejemplo "Laura"), se abre WhatsApp y le manda a Laura **un link solo de esa entrada**.
4. **Laura no ve nada de Ana**: solo su entrada, con el QR y el botón "Guardar imagen". No necesita DNI ni app.
5. Ana sigue viendo las 3 entradas, con la marca "Pasada a Laura". Si se equivocó de número, la vuelve a pasar y el link anterior deja de funcionar.
6. En la puerta cada QR vale una vez: **gana el primer escaneo**, venga del celular de Ana o del de Laura.

1. Encabezado del evento: artista, fecha, lugar y hora.
2. "Ingresá tu DNI para ver tus entradas" → teclado numérico → **Ver mis entradas**.
3. Por cada entrada: QR grande, "Entrada 1 de 2", titular, tanda y botones **Guardar imagen** (PNG generado en canvas, offline) y **Pasar a otra persona**.
4. **Pasar a otra persona**: pide un nombre opcional ("¿Para quién es?") y abre WhatsApp con un link solo para esa entrada. La entrada queda marcada "Pasada a Laura". El titular puede volver a mandarla, lo que deja sin efecto el link anterior.
5. **Link individual** (el que recibe el amigo): muestra solo esa entrada, con QR y Guardar imagen. No pide DNI.
6. Consejo: "Guardá la imagen. En la puerta puede no haber señal. El QR es único y se habilita el dia del único"
7. Estados posibles: "Esta entrada fue anulada. Consultá con quien te la vendió." / "Ya ingresó".

### 6.3 Puerta (celular)
1. **Preparar puerta**: descarga la lista. Muestra "Lista lista · 812 entradas · 21:40" y el botón **Abrir escáner**.
2. **Escáner**:
   - Cámara a pantalla completa y resultado grande con color, sonido y vibración:
     - Verde **VÁLIDA**: nombre, "Entrada 2 de 3", tanda → "Colocá la pulsera".
     - Ámbar **YA INGRESÓ**: hora, nombre, últimos 3 dígitos del DNI.
     - Rojo **NO VÁLIDA** o **ANULADA**.
   - Barra fija con "Adentro: 412 / 1.000" y estado de conexión.
3. **Buscar por DNI o apellido**: para quien perdió el QR o no tiene batería. Muestra las entradas del titular y permite marcar el ingreso.
4. **Venta en puerta** (celular de caja, rol `caja`): precio de la tanda Puerta, cantidad, **Efectivo** / **Transferencia** (muestra los datos del club cargados por el admin, en grande, para que el comprador los copie) → **Cobrar y dar pulseras** → "Entregá 2 pulseras".
5. **Caja de puerta**: efectivo, transferencias y cantidad vendida en puerta, para el arqueo final.
6. El usuario `puerta` ve el escáner y la búsqueda. El usuario `caja` ve la venta en puerta y la caja. Los dos ven el contador.

### 6.4 Admin (escritorio o celular; puede ser más denso)
1. **Tablero**:
   - Vendidas / tope con barra.
   - Por tanda y por canal (RRPP, puerta, cortesía).
   - Recaudación: efectivo pendiente de rendir, transferencias pendientes de confirmar, rendido y comisiones a pagar.
   - Ingresos en vivo el día del evento.
   - Alerta al acercarse al tope.
2. **RRPP**:
   - crear (nombre, usuario, pueblo, teléfono), **Enviar acceso por WhatsApp**, restablecer contraseña, activar o desactivar;
   - **comisión por entrada** ($0 = ad honorem);
   - **límite por tanda**: sin límite, cantidad fija o % de la tanda. La pantalla muestra el límite efectivo en la tanda vigente ("20% = 100 entradas");
   - ventas y saldo de cada uno.
3. **Evento y tandas**:
   - evento: nombre, fecha y hora, lugar, **tope general** (movible, con aviso desde), máximo por venta y cierre de venta RRPP;
   - **datos para transferencias** (alias, CBU/CVU, titular, banco o billetera): se cargan una vez y les aparecen a los RRPP y a la caja;
   - tandas: nombre, canal (RRPP o caja), **precio, desde, hasta y cantidad**, con emitidas y quedan;
   - aviso si la suma de las tandas supera el tope ("El tope general manda: se van a vender como máximo 1.000").
4. **Ventas**: buscador (nombre, DNI), filtros (RRPP, tanda, medio, estado), anular con motivo, reenviar link, emitir cortesía.
5. **Transferencias**: lista de ventas por transferencia (fecha, monto, titular, RRPP), marcar confirmadas y exportar CSV para cruzar con el resumen de Mercado Pago.
6. **Rendición** (ver sección 7).
7. **Auditoría**: quién hizo qué y cuándo.
8. **Exportes**: CSV con `;` y BOM UTF-8 (Excel es-AR) de ventas, entradas, rendiciones e ingresos.
9. **Cierre del evento**: resumen final (entradas por tanda y canal, ingresos, comisiones, ingresos por hora) para cargar en el Excel de escenarios.

## 7. Rendición de la plata

Por cada RRPP:

```
Entradas vendidas         = Σ cantidad (ventas activas)
Efectivo cobrado          = Σ total de ventas en efectivo
Transferencias            = Σ total de ventas por transferencia   (confirmadas / pendientes)
Ya rendido                = Σ movimientos 'entrega_efectivo'
Efectivo a rendir         = Efectivo cobrado − Ya rendido

Comisión ganada           = Σ cantidad × comision_unitaria (congelada en cada venta; 0 si es ad honorem)
Comisión pagada           = Σ movimientos 'pago_comision'
Comisión a pagar          = Comisión ganada − Comisión pagada
```

**La comisión no se descuenta del efectivo.** El RRPP rinde **todo** el efectivo que cobró, y la comisión se le paga aparte. Son dos cuentas separadas.

- **Pantalla de admin:** una fila por RRPP con los dos saldos y dos botones:
  - **Registrar entrega** (efectivo que trae el RRPP);
  - **Pagar comisión** (lo que el club le paga).
  Cada movimiento genera un comprobante (imagen PNG) para mandar por WhatsApp.
- **El RRPP ve en su Inicio dos tarjetas separadas**, siempre actualizadas: **"Efectivo a rendir"** (todo lo cobrado en efectivo menos lo ya entregado) y **"Tu comisión"** (cuánto le corresponde y cuánto ya cobró). Si es ad honorem, la tarjeta de comisión no aparece.
- Al cierre de la venta RRPP, los dos saldos tienen que quedar en 0. El tablero muestra quién falta.
- No se puede registrar una entrega mayor al efectivo pendiente ni un pago mayor a la comisión pendiente, salvo que el admin lo confirme con una nota.

## 8. Fases

> Fechas orientativas. Hoy es 1/11. Corte de decisión "sistema propio vs plataforma": **~15/11**.

### Fase 0 — Base (1 a 2 días)
- Repo `gestion_entradas`, estructura de PWA, service worker y versión.
- Proyecto Supabase: SQL del esquema, RLS, revocaciones, funciones RPC vacías con validación de rol.
- Datos semilla: evento, 3 tandas con cantidad, 1 admin, 3 RRPP de prueba (uno con comisión, uno ad honorem, uno con límite por porcentaje), 2 usuarios de puerta y 1 de caja.
- **Acepta si**: un usuario `anon` no puede leer ni escribir ninguna tabla (probado con SQL), y los roles se resuelven por `auth.uid()`.

### Fase 1 — RRPP (2 a 3 días)
- Login con cambio de contraseña obligatorio la primera vez, Inicio, Nueva entrada (`emitir_venta`), Entrada lista con WhatsApp, lista y detalle de ventas.
- **Acepta si**:
  - una venta se emite en 3 toques desde el Inicio;
  - el precio y la comisión no se pueden alterar desde el cliente;
  - no se puede pasar del stock de la tanda, del límite del RRPP ni del tope;
  - al agotarse la Anticipada, la siguiente venta sale a precio General aunque no haya llegado su fecha;
  - el doble toque no duplica;
  - sin conexión aparece el mensaje correcto;
  - ningún ID aparece en pantalla.

### Fase 2 — Link del comprador (1 a 2 días)
- `entrada.html`, `ver_entradas`, QR, Guardar imagen, estados, bloqueo por intentos, **Pasar a otra persona** (`pasar_entrada`) y vista del link individual.
- **Acepta si**: con DNI incorrecto no muestra nada y bloquea al quinto intento; el token rotado deja de funcionar; la imagen guardada se escanea bien; una entrada pasada se ve en el link individual sin DNI y, al volver a pasarla, el link anterior deja de andar.

### Fase 3 — Puerta (3 a 4 días)
- Preparar puerta, escáner offline, resultados, buscar por DNI, sincronización, contador, venta en puerta, caja.
- **Acepta si**:
  - funciona en modo avión después de descargar la lista;
  - escanea en menos de 1 segundo;
  - un QR repetido da "Ya ingresó";
  - con dos celulares, después de sincronizar, gana el primer ingreso;
  - la venta en puerta suma al contador y frena en el tope.

### Fase 4 — Admin (3 a 5 días)
- Tablero, RRPP (comisión, límite, accesos por WhatsApp), evento y tandas (cantidad, fechas, tope movible), ventas (anular, reenviar, cortesías), transferencias, rendición con comprobante, auditoría, exportes, cierre.
- **Acepta si**: los saldos de la rendición cuadran con la fórmula de la sección 7 en un set de prueba, incluido un RRPP ad honorem y uno al que se le cambió la comisión a mitad de la venta; el límite por porcentaje se recalcula al cambiar la cantidad de la tanda; el CSV abre bien en Excel es-AR.

### Fase 5 — Endurecimiento y prueba de campo (continuo, cerrar antes del 30/11)
- Tests SQL de RLS y de cada RPC (casos válidos y prohibidos por rol).
- E2E con Playwright de los tres flujos.
- Carga: 1.000 entradas, escaneo de 1.000 en local, 2 celulares.
- Concurrencia en el tope: 20 emisiones simultáneas cuando quedan 5 lugares → solo 5 pasan.
- Revisión de la checklist de seguridad (sección 5).
- **Prueba de campo** con 2 o 3 RRPP reales (20 entradas de prueba) y una puerta simulada sin señal.

### Fase 6 — Papel para comercios (después)
- Generar PDF de entradas con serie y QR (8 por A4), asignar **bloques de series** por comercio, rendición y anulación de las devueltas. Solo valen las rendidas.

## 9. Verificación antes de cada entrega
- Recorrer todas las pantallas con Chromium headless y comprobar que `document.body.innerText` **no** contenga UUIDs (`/[0-9a-f]{8}-[0-9a-f]{4}-/i`), "supabase" ni nombres de tablas.
- Probar en un Android de gama baja real: cámara, modo avión, batería.
- Subir `APP_VERSION` y `CACHE_NAME` juntos.
- Contar qué se probó y cómo, no "debería andar".
- **No hacer commit ni push** salvo que M lo pida.

## 10. Costos
- GitHub Pages: gratis.
- Supabase: gratis en volumen. Recomendado **Pro US$25** el mes de la venta para evitar la pausa por inactividad.
- WhatsApp con link `wa.me`: gratis (lo envía el RRPP desde su propio WhatsApp).
- Sin mail en la v1.

## 11. Preguntas abiertas para M (con el supuesto que se usa mientras tanto)

1. **Datos personales**: qué hacer con DNIs y teléfonos después del evento. M lo define más adelante; la función de anonimizar queda lista pero **no se ejecuta sola**.

### Ya definido por M (01/11)
- Venta con titular y la posibilidad de pasar cada QR.
- Comisión configurable por RRPP, incluido ad honorem.
- Límite por RRPP configurable por tanda (fijo o dinámico).
- Tope general movible y tandas con fecha y cantidad.
- Cierre de venta configurable.
- Cortesías solo del admin.
- Usuario y contraseña creados por el admin y enviados por WhatsApp.
- 2 escáneres + 1 caja. El salón está en el centro del pueblo: se espera buena señal (igual se prueba el día anterior y queda el modo sin conexión de respaldo).
- La comisión se muestra aparte y se paga aparte; el RRPP rinde todo el efectivo.
- Si se agota una tanda, aparece la siguiente para vender.
- Datos de transferencia en la configuración del admin, visibles para todos los que cobran.
- Hora del evento: 23:59 hs. Nombre: Club Deportivo Mitre.
