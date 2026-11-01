# Prueba de campo (antes del 30/11)

Objetivo: probar con gente real, en celulares reales, todo el circuito: venta, link del comprador,
puerta (con y sin señal), caja y rendición. Unas 20 entradas de prueba.

## Antes

1. Proyecto de Supabase creado y configurado (ver `docs/SEGURIDAD.md`, "Configuración del proyecto").
2. Evento de prueba en estado **A la venta**, con tandas cargadas. Precios bajos o normales: es de prueba.
3. Usuarios creados desde el panel: 2 o 3 RRPP reales (uno ad honorem, uno con límite), 2 de puerta y 1 de caja.
   Mandarles el acceso con "Enviar acceso por WhatsApp".
4. Celulares: al menos un Android de gama baja. Instalar la app ("Agregar a pantalla de inicio").

## Durante (unos 30 a 45 minutos)

| # | Quién | Qué hacer | Qué tiene que pasar |
|---|---|---|---|
| 1 | Cada RRPP | Primer ingreso | Pide elegir contraseña; después ve su Inicio |
| 2 | Cada RRPP | 3 o 4 ventas (alguna de 2 o 3 entradas, efectivo y transferencia) | Emitir en 3 toques; WhatsApp abre con el mensaje |
| 3 | RRPP | Una venta sin señal (modo avión) | "Sin conexión. Para emitir entradas necesitás internet." |
| 4 | Compradores | Abrir el link, poner el DNI | Ven sus QR; "Guardar imagen" baja el PNG |
| 5 | Comprador | DNI mal 5 veces | Al quinto: "Hiciste muchos intentos…" |
| 6 | Comprador | Pasar una entrada a otra persona | Le llega un link solo de esa entrada |
| 7 | RRPP con límite | Vender hasta el límite | "Te quedan N…" y después frena |
| 8 | Admin | Bajar el tope a lo emitido + 2 | Las ventas frenan al llegar |
| 9 | Puerta 1 y 2 | Descargar la lista con señal | "Lista lista · N entradas · HH:MM" |
| 10 | Puerta 1 y 2 | Modo avión, escanear QR (en pantalla y en la imagen guardada) | Verde VÁLIDA, en menos de 1 segundo, con sonido |
| 11 | Puerta 1 y 2 | Escanear el mismo QR en los dos celulares sin señal | Los dos dan VÁLIDA (riesgo conocido) |
| 12 | Puerta 1 y 2 | Volver a tener señal | En menos de 10 s sincronizan; el admin ve el intento repetido en Auditoría |
| 13 | Puerta | Buscar por DNI y por apellido; marcar y deshacer un ingreso | Funciona sin señal; queda en Auditoría |
| 14 | Caja | Ventas en efectivo y transferencia; una en modo avión | "Entregá N pulseras"; la de sin señal queda pendiente y sube sola |
| 15 | Admin | Anular una venta | El comprador ve "Esta entrada fue anulada"; la puerta da ANULADA tras sincronizar |
| 16 | Admin | Rendición: registrar entrega y pagar comisión | Comprobante PNG; el RRPP lo ve en su Inicio |
| 17 | Admin | Exportar CSV y abrirlo en Excel | Columnas separadas, acentos bien |

Anotar: tiempos, mensajes que confundieron, botones difíciles de tocar, batería al final, señal en el salón.

## Después

- Revisar Tablero, Rendición y Auditoría juntos.
- Si la prueba se hizo en el proyecto de producción, borrar los datos de prueba con
  `supabase/limpiar_pruebas.sql` (desde el SQL Editor; lee las advertencias del archivo) **antes** de abrir la venta real.
- Volcar acá lo que haya que cambiar.
