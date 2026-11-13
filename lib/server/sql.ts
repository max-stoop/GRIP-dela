/**
 * Een Vraag als SQL. Tabellen en functies komen uit een vaste lijst, kolomnamen moeten er als kolomnaam uitzien en
 * waarden gaan altijd als parameter mee. Wat iemand mag zien en wijzigen, bepaalt de RLS in de database.
 */
import { TABELLEN, type Rij } from '../store/db/tabellen';
import { ontbrekendeLeesfunctie, type Filter } from '../store/db/db';
import type { Vraag } from '../store/db/vraag';

export class OngeldigeVraag extends Error {}

const TABEL = new Set([...TABELLEN.map((t) => t.naam), 'rp_goedkeuring_stap']);
// rp_opruimen staat erbij voor de dagelijkse taak op de server; wie is ingelogd, mag hem in de database niet uitvoeren
const FUNCTIE = new Set(['rp_meldingen_per_regio', 'rp_collegas', 'rp_rooster_versies_vanaf', 'rp_gepubliceerd_vanaf', 'rp_verlof_team', 'rp_wensen_team', 'rp_dagtaak_claim', 'rp_opruimen']);
const OPERATOR: Record<Filter['op'], string> = { eq: '=', gte: '>=', lte: '<=', in: '= any' };
const NAAM = /^[a-z_][a-z0-9_]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function eis(ok: unknown, wat: string): asserts ok {
  if (!ok) throw new OngeldigeVraag(`Ongeldige aanvraag: ${wat}`);
}

function naam(x: unknown): string {
  eis(typeof x === 'string' && NAAM.test(x), 'naam');
  return `"${x}"`;
}

const geheel = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;

export interface Sql { sql: string; params: unknown[]; uit: (rijen: Rij[]) => unknown }

/** Uitkomsten als JSON, zoals PostgREST ze geeft: datums als tekst, getallen als getal. */
const alsJson = (sql: string, params: unknown[]): Sql => ({
  sql: `select coalesce(json_agg(t), '[]'::json) as j from (${sql}) t`,
  params,
  uit: (r) => r[0]?.j ?? [],
});

export function alsSql(v: Vraag): Sql {
  switch (v.op) {
    case 'lees': {
      eis(TABEL.has(v.tabel), 'tabel');
      const o = v.opties ?? {};
      const params: unknown[] = [];
      eis(o.kolommen == null || typeof o.kolommen === 'string', 'kolommen');
      const kolommen = o.kolommen == null ? '*' : o.kolommen.split(',').map((k) => naam(k.trim())).join(', ');
      eis(o.filters == null || Array.isArray(o.filters), 'filters');
      const waar = (o.filters ?? []).map((f) => {
        eis(f && f.op in OPERATOR && (f.op !== 'in' || Array.isArray(f.waarde)), 'filter');
        params.push(f.waarde);
        return f.op === 'in' ? `${naam(f.kolom)} = any($${params.length})` : `${naam(f.kolom)} ${OPERATOR[f.op]} $${params.length}`;
      });
      eis(o.orde == null || Array.isArray(o.orde), 'orde');
      const orde = (o.orde ?? []).map((k) => `${naam(k)}${o.aflopend ? ' desc' : ''}`);
      eis(o.limiet == null || geheel(o.limiet, 1, 1_000_000), 'limiet');
      return alsJson(`select ${kolommen} from ${v.tabel}${waar.length ? ` where ${waar.join(' and ')}` : ''}${orde.length ? ` order by ${orde.join(', ')}` : ''}${o.limiet ? ` limit ${o.limiet}` : ''}`, params);
    }
    case 'rpc': {
      eis(FUNCTIE.has(v.functie), 'functie');
      const args = Object.entries(v.args ?? {});
      eis(v.orde == null || Array.isArray(v.orde), 'orde');
      const orde = (v.orde ?? []).map(naam);
      return alsJson(`select * from ${v.functie}(${args.map(([k], i) => `${naam(k)} => $${i + 1}`).join(', ')})${orde.length ? ` order by ${orde.join(', ')}` : ''}`, args.map(([, w]) => w));
    }
    case 'bewaar':
      eis(Array.isArray(v.stappen), 'stappen');
      return { sql: 'select rp_bewaar($1::jsonb) as uit', params: [JSON.stringify(v.stappen)], uit: (r) => r[0]?.uit ?? [] };
    case 'klaarzetten':
      eis(UUID.test(String(v.id)) && geheel(v.nr, 0, 10_000) && Array.isArray(v.stappen), 'deel');
      return { sql: 'insert into rp_bewaar_deel (id, nr, stappen) values ($1, $2, $3::jsonb)', params: [v.id, v.nr, JSON.stringify(v.stappen)], uit: () => null };
    case 'bewaarKlaar':
      eis(UUID.test(String(v.id)) && geheel(v.delen, 1, 10_000), 'delen');
      return { sql: 'select rp_bewaar_klaar($1::uuid, $2::int) as uit', params: [v.id, v.delen], uit: (r) => r[0]?.uit ?? [] };
    case 'ruimOp':
      eis(UUID.test(String(v.id)), 'id');
      return { sql: 'delete from rp_bewaar_deel where id = $1', params: [v.id], uit: () => null };
    case 'schemaVersie':
      return { sql: 'select rp_schema_versie() as v', params: [], uit: (r) => Number(r[0]?.v) };
    default:
      throw new OngeldigeVraag('Ongeldige aanvraag: bewerking');
  }
}

export type Uitvoerder = (sql: string, params: unknown[]) => Promise<Rij[]>;

export async function beantwoord(v: Vraag, voer: Uitvoerder): Promise<unknown> {
  const s = alsSql(v);
  try {
    return s.uit(await voer(s.sql, s.params));
  } catch (e) {
    if (v.op === 'schemaVersie' && ontbrekendeLeesfunctie('rp_schema_versie', e)) return null;
    throw e;
  }
}

/** Een aanvraag uit de browser: alleen de vorm, de inhoud controleert alsSql. */
export function leesVraag(x: unknown): Vraag {
  eis(x && typeof x === 'object' && typeof (x as { op?: unknown }).op === 'string', 'vorm');
  const v = x as Vraag;
  if (v.op === 'lees') eis(typeof v.tabel === 'string' && (v.opties == null || typeof v.opties === 'object'), 'lees');
  if (v.op === 'rpc') eis(typeof v.functie === 'string' && (v.args == null || (typeof v.args === 'object' && !Array.isArray(v.args))), 'rpc');
  return v;
}
