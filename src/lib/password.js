// Client-side guidance; Supabase Auth settings remain the server-side authority.
export function passwordIssue(password, email = '') {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Add at least one uppercase letter.';
  if (!/[^\p{L}\p{N}\s]/u.test(password)) return 'Add at least one symbol.';
  if (email && password.toLowerCase() === email.trim().toLowerCase()) return 'Choose a password different from your email address.';
  for (let i = 0; i < password.length - 2; i++) {
    const chars = password.slice(i, i + 3);
    if (/^[0-9]{3}$/.test(chars)) {
      const [a, b, c] = [...chars].map(Number);
      if ((b === a + 1 && c === b + 1) || (b === a - 1 && c === b - 1)) {
        return 'Avoid number sequences such as 123 or 321.';
      }
    }
  }
  return '';
}
