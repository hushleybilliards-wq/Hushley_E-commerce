import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: object, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = request.headers.get('Authorization') || '';
  if (!url || !secret) return reply({ error: 'Staff account service is unavailable.' }, 503);
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply({ error: 'Sign in as the owner.' }, 401);
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || user?.app_metadata?.role !== 'admin') return reply({ error: 'Owner access required.' }, 403);
  let input: { name?: unknown; email?: unknown; password?: unknown };
  try { input = await request.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!name || name.length > 120 || !/^[^@+\s]+@gmail\.com$/.test(email) || password.length < 12 || password.length > 72 || !/[A-Z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return reply({ error: 'Enter a name, Gmail address, and password of at least 12 characters with an uppercase letter and symbol.' }, 400);
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: false, app_metadata: { role: 'staff' }, user_metadata: { full_name: name } });
  if (error || !data.user) return reply({ error: 'Could not create the account. Check that the email is not already in use.' }, 400);
  const { error: registerError } = await admin.rpc('register_staff_account', { p_user_id: data.user.id, p_name: name, p_email: email });
  if (registerError) {
    // An unregistered staff identity has no staff permissions; remove it when possible.
    await admin.auth.admin.deleteUser(data.user.id);
    return reply({ error: 'Account setup failed. Contact the shop administrator.' }, 500);
  }
  // Signup confirmation proves mailbox ownership; the database separately
  // refuses staff access until Auth records email_confirmed_at.
  const { error: verificationError } = await admin.auth.resend({ type: 'signup', email });
  return reply({ success: true, verification_sent: !verificationError }, 201);
});
