/**
 * De bewerkingen van Db als gewone gegevens, zodat ze over HTTP kunnen (Azure: browser → /api/db) en de server ze als
 * SQL uitvoert (lib/server/sql.ts).
 */
import type { Rij } from './tabellen';
import type { Db, LeesOpties, Stap, Versie } from './db';

export type Vraag =
  | { op: 'lees'; tabel: string; opties?: LeesOpties }
  | { op: 'rpc'; functie: string; args?: Rij; orde?: string[] }
  | { op: 'bewaar'; stappen: Stap[] }
  | { op: 'klaarzetten'; id: string; nr: number; stappen: Stap[] }
  | { op: 'bewaarKlaar'; id: string; delen: number }
  | { op: 'ruimOp'; id: string }
  | { op: 'schemaVersie' };

export function vraagDb(stel: (v: Vraag) => Promise<unknown>): Db {
  return {
    lees: async (tabel, opties) => (await stel({ op: 'lees', tabel, opties })) as Rij[],
    rpc: async (functie, args, orde) => (await stel({ op: 'rpc', functie, args, orde })) as Rij[],
    bewaar: async (stappen) => (stappen.length ? ((await stel({ op: 'bewaar', stappen })) as Versie[]) : []),
    klaarzetten: async (id, nr, stappen) => { await stel({ op: 'klaarzetten', id, nr, stappen }); },
    bewaarKlaar: async (id, delen) => (await stel({ op: 'bewaarKlaar', id, delen })) as Versie[],
    ruimOp: async (id) => { await stel({ op: 'ruimOp', id }); },
    schemaVersie: async () => (await stel({ op: 'schemaVersie' })) as number | null,
  };
}

/** De database via de eigen server, met de rechten van wie is ingelogd. */
export const apiDb = (): Db => vraagDb(async (v) => {
  const r = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
  const js = await r.json().catch(() => null) as { uit?: unknown; fout?: string } | null;
  if (!r.ok || !js) throw new Error(js?.fout ?? `De database gaf geen antwoord (${r.status})`);
  return js.uit;
});
