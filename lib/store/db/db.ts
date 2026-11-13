/** De bewerkingen die de opslag van een database nodig heeft. In de tests is dat PGlite, met dezelfde tabellen en RLS. */
import type { Rol } from '../types';
import { TABELLEN, VOLGORDE, type Rij } from './tabellen';
import type { Operatie } from './verschil';

export type Filter = { kolom: string; op: 'eq' | 'gte' | 'lte' | 'in'; waarde: unknown };

export interface LeesOpties {
  kolommen?: string;
  filters?: Filter[];
  /** Ook nodig om in stukken te lezen zonder dubbelingen. */
  orde?: string[];
  aflopend?: boolean;
  limiet?: number;
}

/** Eén stap van rp_bewaar; alle rijen hebben dezelfde kolommen. */
export interface Stap {
  tabel: string;
  soort: 'insert' | 'upsert' | 'update' | 'delete';
  sleutel: string[];
  rijen: Rij[];
  /** Per rij: > 0 de versie die de app kende, 0 als de rij nog niet mag bestaan, -1 zonder controle. */
  controles?: number[];
}

/** k: de sleutelwaarden in de volgorde van de sleutel. */
export interface Versie { t: string; k: unknown[]; v: number }

export interface Db {
  lees(tabel: string, opties?: LeesOpties): Promise<Rij[]>;
  /** orde geeft een vaste volgorde, zodat lezen in pagina's niets overslaat. */
  rpc(functie: string, args?: Rij, orde?: string[]): Promise<Rij[]>;
  /** Alles of niets (rp_bewaar). */
  bewaar(stappen: Stap[]): Promise<Versie[]>;
  /** Een grote wijziging in delen: klaarzetten verandert nog niets (rp_bewaar_deel). */
  klaarzetten(id: string, nr: number, stappen: Stap[]): Promise<void>;
  /** Alle delen samen in één transactie (rp_bewaar_klaar). */
  bewaarKlaar(id: string, delen: number): Promise<Versie[]>;
  ruimOp(id: string): Promise<void>;
  /** null als die functie er nog niet is. */
  schemaVersie(): Promise<number | null>;
  /** Tijdens het laden: rijen uit een leesfunctie, met hun versie. */
  noteer?(tabel: string, filters: Filter[], rijen: Rij[]): void;
}

export function ontbrekendeLeesfunctie(functie: string, fout: unknown): boolean {
  const m = String(fout instanceof Error ? fout.message : fout);
  return m.includes(functie) && /Could not find the function|does not exist/.test(m);
}

const sleutelVan = (tabel: string) => TABELLEN.find((t) => t.naam === tabel)!.sleutel;

/** Is de database ouder, dan bewaart de app niets: liever niet opslaan dan minder veilig opslaan. */
export const SCHEMA_NODIG = 20261111;

export class DatabaseVerouderd extends Error {
  constructor() {
    super('GRIP_SCHEMA De database is nog niet bijgewerkt');
  }
}

const schemaBekend = new WeakMap<Db, { versie: number | null; wanneer: number }>();

/** Een oude uitkomst wordt na een halve minuut opnieuw nagevraagd. */
export async function databaseBijgewerkt(db: Db): Promise<boolean> {
  const b = schemaBekend.get(db);
  if (b && b.versie != null && b.versie >= SCHEMA_NODIG) return true;
  if (!b || Date.now() - b.wanneer > 30_000) schemaBekend.set(db, { versie: await db.schemaVersie(), wanneer: Date.now() });
  const v = schemaBekend.get(db)!.versie;
  return v != null && v >= SCHEMA_NODIG;
}

interface Uitvoer {
  rol: Rol;
  /** Kolommen die niet in de staat staan, zoals de voorspelling van een run. */
  aanvullen?: (tabel: string, rij: Rij) => Rij;
  /** nieuw: de rij stond nog niet in wat de app uit de database had. */
  controle?: (tabel: string, rij: Rij, nieuw: boolean) => number | undefined;
  voortgang?: (v: Voortgang) => void;
}

export interface Voortgang {
  fase: 'klaarzetten' | 'verwerken';
  deel: number;
  van: number;
  rijen: number;
}

/** Een grotere wijziging wordt in delen klaargezet en daarna in één transactie verwerkt. */
export const MAX_TRANSACTIE = 20_000;

/** Iemand anders wijzigde dezelfde rij intussen. */
export function conflictTabel(fout: unknown): string | null {
  const t = String(fout instanceof Error ? fout.message : fout);
  const m = /GRIP_CONFLICT (rp_\w+)/.exec(t);
  if (m) return m[1];
  // twee opslagen die op elkaar wachten: de database breekt er een af; ook dat is "tegelijk gewijzigd"
  return /deadlock detected/.test(t) ? 'onbekend' : null;
}

function stappenVan(ops: Operatie[], u: Uitvoer): Stap[] {
  const plek = (t: string) => VOLGORDE.indexOf(t);
  const ctl = (tabel: string, rij: Rij, nieuw: boolean) => u.controle?.(tabel, rij, nieuw) ?? -1;
  const stap = (tabel: string, soort: Stap['soort'], rijen: Rij[], controles: number[]): Stap =>
    ({ tabel, soort, sleutel: sleutelVan(tabel), rijen, ...(controles.some((c) => c !== -1) ? { controles } : {}) });
  const uit: Stap[] = [];
  const weg = ops.filter((o): o is Extract<Operatie, { soort: 'delete' }> => o.soort === 'delete').sort((a, b) => plek(b.tabel) - plek(a.tabel));
  for (const o of weg) uit.push(stap(o.tabel, 'delete', o.sleutels, o.sleutels.map((k) => ctl(o.tabel, k, false))));
  for (const tabel of VOLGORDE) {
    for (const o of ops) {
      if (o.tabel !== tabel || (o.soort !== 'upsert' && o.soort !== 'insert')) continue;
      const rijen = o.soort === 'insert' && u.aanvullen ? o.rijen.map((r) => u.aanvullen!(tabel, r)) : o.rijen;
      // rijen met dezelfde kolommen bij elkaar: in één stap krijgt een ontbrekende kolom anders null in plaats van de
      // standaardwaarde (bijvoorbeeld de pauze, die alleen bij de NBD-tijden staat)
      const groepen = new Map<string, { rijen: Rij[]; controles: number[] }>();
      rijen.forEach((r, i) => {
        const k = Object.keys(r).sort().join(',');
        const g = groepen.get(k) ?? { rijen: [], controles: [] };
        groepen.set(k, g);
        g.rijen.push(r);
        const n = o.nieuw?.[i];
        g.controles.push(n == null ? -1 : ctl(tabel, o.rijen[i], n));
      });
      for (const g of groepen.values()) uit.push(stap(tabel, o.soort, g.rijen, g.controles));
    }
    const updates = new Map<string, { rijen: Rij[]; controles: number[] }>();
    for (const o of ops) {
      if (o.tabel !== tabel || o.soort !== 'update') continue;
      if (!Object.keys(o.waarden).length) continue;
      const rij = { ...o.sleutel, ...o.waarden };
      const k = Object.keys(rij).sort().join(',');
      const g = updates.get(k) ?? { rijen: [], controles: [] };
      updates.set(k, g);
      g.rijen.push(rij);
      g.controles.push(ctl(tabel, o.sleutel, false));
    }
    for (const g of updates.values()) uit.push(stap(tabel, 'update', g.rijen, g.controles));
  }
  return uit;
}

/** Een stap die groter is, wordt gesplitst. */
function inDelen(stappen: Stap[]): Stap[][] {
  const delen: Stap[][] = [[]];
  let n = 0;
  for (const s of stappen) {
    for (let i = 0; i < s.rijen.length; i += MAX_TRANSACTIE) {
      const rijen = s.rijen.slice(i, i + MAX_TRANSACTIE);
      if (n + rijen.length > MAX_TRANSACTIE && delen[delen.length - 1].length) { delen.push([]); n = 0; }
      delen[delen.length - 1].push({ ...s, rijen, ...(s.controles ? { controles: s.controles.slice(i, i + MAX_TRANSACTIE) } : {}) });
      n += rijen.length;
    }
  }
  return delen.filter((d) => d.length);
}

/** Eerst weghalen (van afhankelijk naar basis), dan schrijven (van basis naar afhankelijk), zodat verwijzingen kloppen. */
export async function voerUit(db: Db, ops: Operatie[], u: Uitvoer): Promise<Versie[]> {
  const stappen = stappenVan(ops, u);
  if (!stappen.length) return [];
  if (!await databaseBijgewerkt(db)) throw new DatabaseVerouderd();
  const rijen = stappen.reduce((n, s) => n + s.rijen.length, 0);
  if (rijen <= MAX_TRANSACTIE) return db.bewaar(stappen);
  // groot: in delen klaarzetten (dat verandert nog niets), dan alles samen in één transactie verwerken
  const delen = inDelen(stappen);
  const id = crypto.randomUUID();
  try {
    for (let i = 0; i < delen.length; i++) {
      u.voortgang?.({ fase: 'klaarzetten', deel: i + 1, van: delen.length, rijen });
      await db.klaarzetten(id, i, delen[i]);
    }
    u.voortgang?.({ fase: 'verwerken', deel: delen.length, van: delen.length, rijen });
    return await db.bewaarKlaar(id, delen.length);
  } catch (e) {
    await db.ruimOp(id).catch(() => undefined);
    throw e;
  }
}
