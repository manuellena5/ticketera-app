-- =====================================================================
-- CONFIGURACIÓN INICIAL DE PRODUCCIÓN (correr UNA vez, después de las
-- migraciones, en el SQL Editor de Supabase).
--
-- Crea:
--   1. El primer usuario administrador (con contraseña temporal: la app
--      le pide cambiarla en el primer ingreso).
--   2. El evento, en estado "borrador" (no se vende hasta que el admin lo
--      pase a "A la venta" desde el panel).
--   3. Las 3 tandas del plan (Anticipada, General, Puerta).
--   4. La fila de configuración del club (los datos para transferir se
--      cargan después desde el panel).
--
-- NO correr seed.sql en producción: ese archivo es solo para pruebas.
-- Si ya existe un evento o el usuario, este script no los duplica.
--
-- ► Antes de correrlo, cambiá los 3 valores marcados con ◄ (usuario,
--   nombre y contraseña temporal del admin).
-- ► Todo lo del evento (fecha, lugar, tope, precios, cantidades) se puede
--   cambiar después desde el panel: Evento y tandas.
-- =====================================================================

do $$
declare
  -- ◄ Admin --------------------------------------------------------------
  v_usuario  constant text := 'admin';                 -- ◄ usuario para entrar a la app
  v_nombre   constant text := 'Administración';        -- ◄ nombre que se muestra
  v_clave    constant text := 'CAMBIAR-esta-clave-1';  -- ◄ contraseña temporal (8 o más)
  -- Dominio interno de los usuarios: tiene que coincidir con AUTH_DOMAIN de js/config.js
  v_dominio  constant text := 'usuarios.ticketera-app.com.ar';

  v_email    text := lower(v_usuario) || '@' || v_dominio;
  v_admin    uuid;
  v_evento   uuid;
begin
  if v_clave like 'CAMBIAR%' then
    raise exception 'Cambiá la contraseña temporal del admin (v_clave) antes de correr el script.';
  end if;
  if length(v_clave) < 8 then
    raise exception 'La contraseña temporal tiene que tener al menos 8 caracteres.';
  end if;

  -- 1) Primer admin ------------------------------------------------------
  select id into v_admin from auth.users where email = v_email;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_clave, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_admin, v_admin::text,
            jsonb_build_object('sub', v_admin::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
    raise notice 'Admin creado: usuario "%".', lower(v_usuario);
  else
    raise notice 'El usuario "%" ya existía en Auth: no se toca su contraseña.', lower(v_usuario);
  end if;

  insert into public.perfiles (user_id, nombre, usuario, rol, activo, debe_cambiar_clave)
  values (v_admin, v_nombre, lower(v_usuario), 'admin', true, true)
  on conflict (user_id) do update set rol = 'admin', activo = true;

  -- 2) Evento ------------------------------------------------------------
  select id into v_evento from public.eventos order by creado_en limit 1;
  if v_evento is null then
    insert into public.eventos (nombre, artista, fecha, lugar, tope_entradas, aviso_desde,
                                max_por_venta, cierre_venta_rrpp, estado)
    values ('Baile con Simón Aguirre', 'Simón Aguirre', '2026-12-18 23:59:00-03', null,
            1000, 950, 6, '2026-12-15 23:59:00-03', 'borrador')
    returning id into v_evento;
    insert into public.secretos_evento (evento_id) values (v_evento);

    -- 3) Tandas ------------------------------------------------------------
    insert into public.tandas (evento_id, nombre, canal, precio, cantidad, desde, hasta, orden) values
      (v_evento, 'Anticipada', 'rrpp', 20000, 500, '2026-11-01 00:00:00-03', '2026-11-30 23:59:00-03', 1),
      (v_evento, 'General',    'rrpp', 23000, 350, '2026-12-01 00:00:00-03', '2026-12-15 23:59:00-03', 2),
      (v_evento, 'Puerta',     'caja', 25000, 300, '2026-12-18 00:00:00-03', '2026-12-19 06:00:00-03', 3);
    raise notice 'Evento y tandas creados (en borrador).';
  else
    insert into public.secretos_evento (evento_id) values (v_evento) on conflict do nothing;
    raise notice 'Ya había un evento: no se creó otro.';
  end if;

  -- 4) Configuración del club ---------------------------------------------
  insert into public.config_club (id) values (1) on conflict (id) do nothing;

  insert into public.auditoria (evento_id, usuario_id, accion, detalle)
  values (v_evento, v_admin, 'configuracion_inicial', '{}'::jsonb);
end $$;

-- Verificación rápida (tiene que mostrar 1 admin, 1 evento y 3 tandas):
select
  (select count(*) from public.perfiles where rol = 'admin' and activo) as admins,
  (select count(*) from public.eventos) as eventos,
  (select count(*) from public.tandas) as tandas,
  (select count(*) from public.config_club) as config;
