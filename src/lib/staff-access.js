// Only a confirmed denial ends the local session. Network failures must not
// be mistaken for an administrator disabling an account.
export async function checkStaffAccess(client) {
  try {
    const { data, error } = await client.rpc('staff_current_access');
    if (error || (data !== true && data !== false)) return 'unavailable';
    if (data) return 'active';
    const result = await client.auth.signOut({ scope: 'local' });
    return result.error ? 'signout_failed' : 'disabled';
  } catch {
    return 'unavailable';
  }
}
