/** Draait één keer als de server start. Alleen op Node (niet in de edge-runtime van de middleware). */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/taken/start');
  }
}
