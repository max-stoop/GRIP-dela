/** CSRF: een browser stuurt bij een aanvraag van een andere site altijd de Origin mee; die moet deze site zijn. */
export function vanDezeSite(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    const van = new URL(origin);
    // achter een doorgeefluik ziet de server een ander adres dan de browser; die kent alleen GRIP_URL
    if (process.env.GRIP_URL && van.origin === new URL(process.env.GRIP_URL).origin) return true;
    return !!host && van.host === host.split(',')[0].trim();
  } catch {
    return false;
  }
}
