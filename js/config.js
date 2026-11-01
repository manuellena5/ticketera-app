// Configuración pública del frontend. Solo va la anon key: la service role
// key NUNCA se pone acá ni en ningún archivo del repo.
// Si cambia SUPABASE_URL, actualizar también el connect-src del
// Content-Security-Policy en index.html y entrada.html (lo controla
// tests/ui/revisar_estatico.mjs).
window.CONFIG = Object.freeze({
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-ANON-KEY',
  // Dominio del mail interno de cada usuario (<usuario>@<dominio>).
  // Tiene que coincidir con el de supabase/seed.sql y la Edge Function.
  AUTH_DOMAIN: 'usuarios.clubdeportivomitre.com.ar',
  NOMBRE_CLUB: 'Club Deportivo Mitre',
});
