// Configuración pública del frontend. Solo va la anon key: la service role
// key NUNCA se pone acá ni en ningún archivo del repo.
// Si cambia SUPABASE_URL, actualizar también el connect-src del
// Content-Security-Policy en index.html y entrada.html (lo controla
// tests/ui/revisar_estatico.mjs).
window.CONFIG = Object.freeze({
  SUPABASE_URL: 'https://nkeijeavrkdhtkvkgcvh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rZWlqZWF2cmtkaHRrdmtnY3ZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NjI3NjgsImV4cCI6MjEwOTEzODc2OH0.s3r_IBFOmy1OnwyAvatotE1HYV1BY3C6UIy07Nu0uaE',
  // Dominio del mail interno de cada usuario (<usuario>@<dominio>).
  // Tiene que coincidir con el de supabase/seed.sql y la Edge Function.
  AUTH_DOMAIN: 'usuarios.ticketera-app.com.ar',
  NOMBRE_CLUB: 'Club Deportivo Mitre',
});
