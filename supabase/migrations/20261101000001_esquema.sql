-- =====================================================================
-- App de entradas · Club Deportivo Mitre
-- 0001 · Esquema
-- Multi-evento desde el día 1: todo cuelga de evento_id.
-- Los IDs son internos y nunca se muestran en pantalla.
-- =====================================================================

-- En Supabase, pgcrypto vive en el schema "extensions".
create extension if not exists pgcrypto with schema extensions;

-- Funciones internas (no expuestas por la API: PostgREST solo expone "public").
create schema if not exists privado;

-- ---------------------------------------------------------------------
-- Eventos
-- ---------------------------------------------------------------------
create table public.eventos (
  id                 uuid primary key default gen_random_uuid(),
  creado_en          timestamptz not null default now(),
  nombre             text not null check (length(trim(nombre)) > 0),
  artista            text,
  fecha              timestamptz not null,
  lugar              text,
  tope_entradas      int  not null check (tope_entradas > 0),
  aviso_desde        int  check (aviso_desde is null or aviso_desde > 0),
  max_por_venta      int  not null default 6 check (max_por_venta between 1 and 20),
  cierre_venta_rrpp  timestamptz,
  estado             text not null default 'borrador'
                     check (estado in ('borrador','venta','cerrado'))
);

-- Sal por evento para sha256(dni + sal) en la lista de puerta.
-- Tabla aparte: nadie la lee salvo las funciones SECURITY DEFINER.
create table public.secretos_evento (
  evento_id  uuid primary key references public.eventos(id) on delete cascade,
  sal        text not null default encode(extensions.gen_random_bytes(16), 'hex')
);

-- ---------------------------------------------------------------------
-- Tandas de precio
-- ---------------------------------------------------------------------
create table public.tandas (
  id         uuid primary key default gen_random_uuid(),
  creado_en  timestamptz not null default now(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  canal      text not null check (canal in ('rrpp','caja')),
  precio     numeric(12,2) not null check (precio >= 0),
  cantidad   int  not null check (cantidad >= 0),
  desde      timestamptz,
  hasta      timestamptz,
  orden      int  not null default 0,
  check (desde is null or hasta is null or desde < hasta)
);
create index tandas_evento_canal_orden on public.tandas (evento_id, canal, orden);

-- ---------------------------------------------------------------------
-- Configuración del club (una sola fila)
-- ---------------------------------------------------------------------
create table public.config_club (
  id               int primary key default 1 check (id = 1),
  nombre_club      text not null default 'Club Deportivo Mitre',
  transf_alias     text,
  transf_cbu_cvu   text,
  transf_titular   text,
  transf_entidad   text,            -- banco o billetera
  actualizado_en   timestamptz,
  actualizado_por  uuid
);

-- ---------------------------------------------------------------------
-- Perfiles de usuario (1 a 1 con auth.users)
-- ---------------------------------------------------------------------
create table public.perfiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  creado_en           timestamptz not null default now(),
  nombre              text not null check (length(trim(nombre)) > 0),
  usuario             text not null unique check (usuario ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  telefono            text,
  pueblo              text,
  rol                 text not null check (rol in ('admin','rrpp','puerta','caja')),
  activo              boolean not null default true,
  debe_cambiar_clave  boolean not null default true
);

-- ---------------------------------------------------------------------
-- Condiciones de cada RRPP en cada evento
-- ---------------------------------------------------------------------
create table public.rrpp_evento (
  evento_id             uuid not null references public.eventos(id) on delete cascade,
  rrpp_id               uuid not null references public.perfiles(user_id),
  creado_en             timestamptz not null default now(),
  comision_por_entrada  numeric(12,2) not null default 0 check (comision_por_entrada >= 0),  -- 0 = ad honorem
  limite_tipo           text not null default 'sin_limite'
                        check (limite_tipo in ('sin_limite','cantidad','porcentaje')),
  limite_valor          numeric,
  primary key (evento_id, rrpp_id),
  check (
    (limite_tipo = 'sin_limite') or
    (limite_tipo = 'cantidad'   and limite_valor is not null and limite_valor >= 0 and limite_valor = trunc(limite_valor)) or
    (limite_tipo = 'porcentaje' and limite_valor is not null and limite_valor >  0 and limite_valor <= 100)
  )
);
-- Límite efectivo en una tanda:
--   sin_limite → stock de la tanda
--   cantidad   → limite_valor
--   porcentaje → floor(tanda.cantidad × limite_valor / 100)

-- ---------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------
create table public.ventas (
  id                        uuid primary key default gen_random_uuid(),
  creado_en                 timestamptz not null default now(),
  evento_id                 uuid not null references public.eventos(id),
  canal                     text not null check (canal in ('rrpp','caja','cortesia','papel')),
  rrpp_id                   uuid references public.perfiles(user_id),   -- null en caja/cortesía
  tanda_id                  uuid references public.tandas(id),
  titular_nombre            text not null check (length(trim(titular_nombre)) > 0),
  titular_dni               text check (titular_dni is null or titular_dni ~ '^[0-9]{7,8}$'),
  titular_tel               text,
  cantidad                  int not null check (cantidad between 1 and 20),
  precio_unitario           numeric(12,2) not null check (precio_unitario >= 0),  -- lo pone el SERVIDOR
  total                     numeric(12,2) not null check (total >= 0),
  comision_unitaria         numeric(12,2) not null default 0 check (comision_unitaria >= 0),  -- congelada al emitir
  medio                     text not null check (medio in ('efectivo','transferencia','cortesia')),
  transferencia_confirmada  boolean not null default false,
  link_hash                 text unique,       -- sha256 del token del link (el token NO se guarda)
  estado                    text not null default 'activa' check (estado in ('activa','anulada')),
  anulada_por               uuid references public.perfiles(user_id),
  anulada_en                timestamptz,
  motivo_anulacion          text,
  idempotency_key           uuid unique,
  creada_por                uuid references public.perfiles(user_id),
  check (canal <> 'rrpp' or (rrpp_id is not null and titular_dni is not null)),
  check (total = precio_unitario * cantidad)
);
create index ventas_evento_rrpp on public.ventas (evento_id, rrpp_id);
create index ventas_titular_dni on public.ventas (titular_dni);
create index ventas_tanda       on public.ventas (tanda_id) where estado = 'activa';

-- ---------------------------------------------------------------------
-- Entradas (una por persona; lo que lleva el QR es "codigo")
-- ---------------------------------------------------------------------
create table public.entradas (
  id                   uuid primary key default gen_random_uuid(),
  creado_en            timestamptz not null default now(),
  evento_id            uuid not null references public.eventos(id),
  venta_id             uuid not null references public.ventas(id),
  nro                  int  not null check (nro >= 1),
  codigo               text not null unique,     -- 128 bits aleatorios en base32
  serie                text,                     -- papel (fase 6), ej. 'N-0012'
  estado               text not null default 'valida' check (estado in ('valida','anulada')),
  link_propio_hash     text unique,              -- sha256 del link individual
  pasada_a             text,
  ingreso_en           timestamptz,              -- null = no ingresó
  ingreso_dispositivo  text,
  ingreso_por          uuid references public.perfiles(user_id),
  unique (venta_id, nro)
);
-- entradas(codigo) ya tiene índice por el UNIQUE.
create index entradas_evento_ingreso on public.entradas (evento_id, ingreso_en);
create index entradas_venta          on public.entradas (venta_id);

-- ---------------------------------------------------------------------
-- Movimientos de cada RRPP: entregas de efectivo y pagos de comisión
-- ---------------------------------------------------------------------
create table public.movimientos_rrpp (
  id              uuid primary key default gen_random_uuid(),
  creado_en       timestamptz not null default now(),
  evento_id       uuid not null references public.eventos(id),
  rrpp_id         uuid not null references public.perfiles(user_id),
  tipo            text not null check (tipo in ('entrega_efectivo','pago_comision')),
  monto           numeric(12,2) not null check (monto > 0),
  nota            text,
  registrado_por  uuid references public.perfiles(user_id)
);
create index movimientos_evento_rrpp on public.movimientos_rrpp (evento_id, rrpp_id);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table public.auditoria (
  id          uuid primary key default gen_random_uuid(),
  creado_en   timestamptz not null default now(),
  evento_id   uuid references public.eventos(id),
  usuario_id  uuid,
  accion      text not null,
  detalle     jsonb not null default '{}'::jsonb
);
create index auditoria_evento_fecha on public.auditoria (evento_id, creado_en desc);

-- ---------------------------------------------------------------------
-- Freno de fuerza bruta en la página pública
-- ---------------------------------------------------------------------
create table public.intentos_link (
  link_hash        text primary key,
  creado_en        timestamptz not null default now(),
  intentos         int not null default 0,
  bloqueado_hasta  timestamptz
);
