export async function afmelden() {
  await fetch('/auth/uitloggen', { method: 'POST' });
  window.location.href = '/login';
}
