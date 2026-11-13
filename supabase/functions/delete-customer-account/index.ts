import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: object, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publishable = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !secret || !publishable) return reply({ error: 'Account deletion is unavailable. Please try again later.' }, 503);
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply({ error: 'Please sign in again.' }, 401);
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return reply({ error: 'Your session has expired. Sign in again.' }, 401);
  if (['admin', 'staff'].includes(user.app_metadata?.role)) return reply({ error: 'This feature is available for customer accounts only.' }, 403);
  let body: { password?: unknown };
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 1024) return reply({ error: 'Enter your current password.' }, 400);
  const verifier = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const credentials = user.email && user.email_confirmed_at ? { email: user.email, password } : user.phone && user.phone_confirmed_at ? { phone: user.phone, password } : null;
  if (!credentials) return reply({ error: 'Your verified sign-in identity is unavailable. Sign in again.' }, 400);
  const { data: verified, error: passwordError } = await verifier.auth.signInWithPassword(credentials);
  if (passwordError?.status === 429) return reply({ error: 'Too many attempts. Wait and try again.' }, 429);
  if (passwordError || verified.user?.id !== user.id) return reply({ error: 'Password is incorrect. Please try again.' }, 401);
  // The production schema keeps orders and private payment-proof objects when a
  // customer is removed. Never delete a proof as part of account deletion.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return reply({ error: 'The account could not be deleted. Please try again later.' }, 500);
  return reply({ success: true }, 200);
});
