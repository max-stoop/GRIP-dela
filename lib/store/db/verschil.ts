/** Het verschil tussen wat laatst in de database stond en de staat nu; de acties in store.ts merken daar niets van. */
import type { AppState } from '../types';
import type { Rol } from '../types';
import { TABELLEN, type Rij, type TabelDef } from './tabellen';

export type Operatie =
  /** Per rij of die nog niet in de oude staat stond. */
  | { tabel: string; soort: 'upsert' | 'insert'; rijen: Rij[]; nieuw?: boolean[] }
  | { tabel: string; soort: 'update'; sleutel: Rij; waarden: Rij }
  | { tabel: string; soort: 'delete'; sleutels: Rij[] };

type Index = Map<string, { rij: Rij; tekst: string }>;
const caches = new Map<string, WeakMap<object, Index>>();

const sleutelVan = (def: TabelDef, rij: Rij) => def.sleutel.map((k) => String(rij[k])).join('|');

/** JSON met gesorteerde sleutels: de database (jsonb) bewaart sleutels in een eigen volgorde, en dat is geen wijziging. */
export function vast(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(vast).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().filter((k) => (x as Rij)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${vast((x as Rij)[k])}`).join(',')}}`;
  return JSON.stringify(x ?? null);
}

function index(def: TabelDef, stuk: unknown, naam: string): Index {
  // een stuk dat (nog) niet bestaat, heeft geen rijen (null kan wel betekenis hebben, zoals een gewiste roosterbasis)
  if (stuk === undefined) return new Map();
  const maak = (): Index => new Map(def.rijen(stuk, naam).map((rij) => [sleutelVan(def, rij), { rij, tekst: vast(rij) }]));
  if (stuk == null || typeof stuk !== 'object') return maak();
  let c = caches.get(def.naam);
  if (!c) caches.set(def.naam, (c = new WeakMap()));
  let i = c.get(stuk);
  if (!i) c.set(stuk, (i = maak()));
  return i;
}

const planner = (rol: Rol) => rol !== 'medewerker';

function wijzeVoor(def: TabelDef, rol: Rol): 'upsert' | 'insert-update' | 'alleen-insert' {
  if (def.wijze === 'upsert-planner') return planner(rol) ? 'upsert' : 'insert-update';
  return def.wijze;
}

/** Weghalen staat los; de volgorde regelt voerUit. */
export function verschil(oud: AppState, nieuw: AppState, rol: Rol, defs: TabelDef[] = TABELLEN): Operatie[] {
  const uit: Operatie[] = [];
  for (const def of defs) {
    const wijze = wijzeVoor(def, rol);
    const so = def.stukken(oud), sn = def.stukken(nieuw);
    if (so === sn) continue;
    const nieuweRijen: Rij[] = [], isNieuw: boolean[] = [], weg: Rij[] = [];
    const namen = new Set([...Object.keys(so), ...Object.keys(sn)]);
    for (const naam of namen) {
      if (so[naam] === sn[naam]) continue;
      const io = index(def, so[naam], naam), inw = index(def, sn[naam], naam);
      for (const [k, { rij, tekst }] of inw) {
        const was = io.get(k);
        if (!was) { nieuweRijen.push(rij); isNieuw.push(true); continue; }
        if (was.tekst === tekst) continue;
        if (wijze === 'alleen-insert') continue;
        if (wijze === 'upsert') { nieuweRijen.push(rij); isNieuw.push(false); continue; }
        const waarden: Rij = {};
        for (const [kol, v] of Object.entries(rij)) if (vast(v) !== vast(was.rij[kol])) waarden[kol] = v;
        for (const kol of Object.keys(was.rij)) if (!(kol in rij)) waarden[kol] = null;
        uit.push({ tabel: def.naam, soort: 'update', sleutel: Object.fromEntries(def.sleutel.map((s) => [s, rij[s]])), waarden });
      }
      if (wijze === 'alleen-insert') continue;
      for (const [k, { rij }] of io) if (!inw.has(k)) weg.push(Object.fromEntries(def.sleutel.map((s) => [s, rij[s]])));
    }
    if (nieuweRijen.length) uit.push({ tabel: def.naam, soort: wijze === 'upsert' ? 'upsert' : 'insert', rijen: nieuweRijen, nieuw: isNieuw });
    if (weg.length) uit.push({ tabel: def.naam, soort: 'delete', sleutels: weg });
  }
  return uit;
}
