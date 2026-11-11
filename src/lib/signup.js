// This is a signup rule only; existing customers can still sign in with their identity.
export function isGmailSignupEmail(value) {
  return /^[^@+\s]+@gmail\.com$/i.test(String(value || '').trim());
}
