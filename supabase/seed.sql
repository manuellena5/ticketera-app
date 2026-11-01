-- =====================================================================
-- Datos semilla para PRUEBAS. No usar en producción tal cual:
-- las contraseñas son conocidas. En producción los usuarios se crean
-- desde el panel de admin (Edge Function) o desde el panel de Supabase.
--
-- Usuarios (contraseña temporal de todos: "prueba1234"; se pide cambiarla
-- en el primer ingreso):
--   admin    · Administración             · admin
--   lucia    · Lucía Fernández            · rrpp, comisión $750, sin límite
--   martin   · Martín Gómez               · rrpp, ad honorem, sin límite
--   sofia    · Sofía Ruiz                 · rrpp, comisión $500, límite 20% por tanda
--   puerta1  · Puerta 1                   · puerta
--   puerta2  · Puerta 2                   · puerta
--   caja     · Caja                       · caja
-- El mail interno es <usuario>@<dominio>; el dominio tiene que coincidir con
-- AUTH_DOMAIN de js/config.js.
-- =====================================================================

do $$
declare
  dominio constant text := 'usuarios.ticketera-app.com.ar';
  clave   constant text := 'prueba1234';
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-8000-000000000001'::uuid, 'admin',   'Administración',  'admin',  null,                null),
      ('00000000-0000-4000-8000-000000000011'::uuid, 'lucia',   'Lucía Fernández', 'rrpp',   '5492355000011',     'Mitre'),
      ('00000000-0000-4000-8000-000000000012'::uuid, 'martin',  'Martín Gómez',    'rrpp',   '5492355000012',     'Pueblo 2'),
      ('00000000-0000-4000-8000-000000000013'::uuid, 'sofia',   'Sofía Ruiz',      'rrpp',   '5492355000013',     'Pueblo 3'),
      ('00000000-0000-4000-8000-000000000021'::uuid, 'puerta1', 'Puerta 1',        'puerta', null,                null),
      ('00000000-0000-4000-8000-000000000022'::uuid, 'puerta2', 'Puerta 2',        'puerta', null,                null),
      ('00000000-0000-4000-8000-000000000031'::uuid, 'caja',    'Caja',            'caja',   null,                null)
    ) as t(id, usuario, nombre, rol, telefono, pueblo)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.usuario || '@' || dominio,
      extensions.crypt(clave, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '')
    on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.usuario || '@' || dominio, 'email_verified', true),
      'email', now(), now(), now())
    on conflict do nothing;

    insert into public.perfiles (user_id, nombre, usuario, telefono, pueblo, rol)
    values (u.id, u.nombre, u.usuario, u.telefono, u.pueblo, u.rol)
    on conflict (user_id) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Evento y tandas (horario de Argentina, -03)
-- ---------------------------------------------------------------------
insert into public.eventos (id, nombre, artista, fecha, lugar, tope_entradas, aviso_desde,
                            max_por_venta, cierre_venta_rrpp, estado)
values ('00000000-0000-4000-8000-0000000000e1',
        'Baile con Simón Aguirre', 'Simón Aguirre',
        '2026-12-18 23:59:00-03', null,   -- el lugar lo carga el admin
        1000, 950, 6, '2026-12-15 23:59:59-03', 'venta')
on conflict (id) do nothing;

insert into public.secretos_evento (evento_id)
values ('00000000-0000-4000-8000-0000000000e1')
on conflict (evento_id) do nothing;

insert into public.tandas (id, evento_id, nombre, canal, precio, cantidad, desde, hasta, orden) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1',
   'Anticipada', 'rrpp', 20000, 500, '2026-11-01 00:00:00-03', '2026-11-30 23:59:59-03', 1),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000e1',
   'General',    'rrpp', 23000, 350, '2026-12-01 00:00:00-03', '2026-12-15 23:59:59-03', 2),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000e1',
   'Puerta',     'caja', 25000, 300, '2026-12-18 00:00:00-03', '2026-12-19 06:00:00-03', 3)
on conflict (id) do nothing;

insert into public.rrpp_evento (evento_id, rrpp_id, comision_por_entrada, limite_tipo, limite_valor) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000011', 750, 'sin_limite', null),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000012',   0, 'sin_limite', null),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000013', 500, 'porcentaje', 20)
on conflict do nothing;

-- Datos de transferencia de PRUEBA (el admin carga los reales en el panel).
insert into public.config_club (id, transf_alias, transf_cbu_cvu, transf_titular, transf_entidad, actualizado_en)
values (1, 'CLUB.MITRE.PRUEBA', '0000000000000000000000', 'Club Deportivo Mitre', 'Banco de prueba', now())
on conflict (id) do nothing;
