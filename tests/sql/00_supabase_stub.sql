-- =====================================================================
-- Emulación mínima de Supabase para correr las migraciones y los tests
-- en un Postgres local. NO se aplica en Supabase.
-- Reproduce: roles anon/authenticated/service_role, schema auth con
-- auth.uid(), pgcrypto en "extensions" y los privilegios por defecto
-- generosos que Supabase da en "public" (para que el test de
-- revocaciones sea realista).
-- =====================================================================

create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;

create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  instance_id             uuid,
  id                      uuid primary key,
  aud                     text,
  role                    text,
  email                   text unique,
  encrypted_password      text,
  email_confirmed_at      timestamptz,
  raw_app_meta_data       jsonb,
  raw_user_meta_data      jsonb,
  created_at              timestamptz,
  updated_at              timestamptz,
  confirmation_token      text,
  recovery_token          text,
  email_change_token_new  text,
  email_change            text
);

create table auth.identities (
  id               uuid primary key,
  user_id          uuid references auth.users(id) on delete cascade,
  provider_id      text not null,
  identity_data    jsonb not null,
  provider         text not null,
  last_sign_in_at  timestamptz,
  created_at       timestamptz,
  updated_at       timestamptz,
  unique (provider_id, provider)
);

-- Igual que en Supabase: el "sub" del JWT de la request.
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Privilegios por defecto de Supabase en public.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
