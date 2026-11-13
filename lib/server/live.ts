/**
 * Eén LISTEN-verbinding per serverproces; elk open tabblad krijgt de seintjes via /api/live. Valt de verbinding weg,
 * dan sluiten alle tabbladen hun stroom; de browser verbindt opnieuw en leest dan alles bij.
 */
import { Client } from 'pg';
import { database } from './postgres';

interface Luisteraar { wijziging: (tabel: string) => void; weg: () => void }

const luisteraars = new Set<Luisteraar>();
let verbinding: Promise<Client> | null = null;

function verbroken(c: Client) {
  verbinding = null;
  c.end().catch(() => undefined);
  for (const l of [...luisteraars]) l.weg();
  luisteraars.clear();
}

async function verbind(): Promise<Client> {
  await database();
  const c = new Client({ connectionString: process.env.DATABASE_URL, keepAlive: true });
  c.on('notification', (n) => { for (const l of luisteraars) l.wijziging(n.payload ?? ''); });
  c.on('error', () => verbroken(c));
  c.on('end', () => verbroken(c));
  await c.connect();
  await c.query('listen grip_wijziging');
  return c;
}

export async function luister(l: Luisteraar): Promise<() => void> {
  verbinding ??= verbind().catch((e) => { verbinding = null; throw e; });
  await verbinding;
  luisteraars.add(l);
  return () => { luisteraars.delete(l); };
}
