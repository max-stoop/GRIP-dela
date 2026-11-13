/**
 * Versiecontrole: elke rij heeft een versie die bij elke wijziging omhoog gaat. De app stuurt de versie mee die ze
 * kent; heeft iemand anders de rij intussen gewijzigd, dan wordt niets bewaard. Of een nieuwe rij nog niet bestaat,
 * controleren we alleen als de app dat deel van de tabel heeft gelezen.
 */
import { TABELLEN, type Rij } from './tabellen';
import type { Filter, Versie } from './db';
import type { Operatie } from './verschil';

const SLEUTELS = new Map(TABELLEN.map((t) => [t.naam, t.sleutel]));

/** "id" of "medewerker_id|datum" */
function sleutelTekst(tabel: string, rij: Rij): string | null {
  const s = SLEUTELS.get(tabel);
  if (!s) return null;
  const delen = s.map((k) => rij[k]);
  return delen.some((v) => v == null) ? null : delen.map((v) => String(v)).join('|');
}

export interface Gelezen {
  versies: Map<string, number>;
  /** 'alles' als de hele tabel is gelezen, voor zover deze gebruiker hem mag zien. */
  vensters: Filter[][] | 'alles';
}

export type Leesronde = Map<string, Gelezen>;

export function noteer(ronde: Leesronde, tabel: string, filters: Filter[], rijen: Rij[]) {
  if (!SLEUTELS.has(tabel)) return;
  let g = ronde.get(tabel);
  if (!g) ronde.set(tabel, (g = { versies: new Map(), vensters: [] }));
  if (!filters.length) g.vensters = 'alles';
  else if (g.vensters !== 'alles') g.vensters.push(filters);
  for (const r of rijen) {
    const v = r.rij_versie;
    const k = sleutelTekst(tabel, r);
    if (k != null && (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))) g.versies.set(k, Number(v));
  }
}

const vergelijk = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

function binnen(rij: Rij, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = rij[f.kolom];
    if (v == null) return false;
    if (f.op === 'eq') return String(v) === String(f.waarde);
    if (f.op === 'in') return (f.waarde as unknown[]).map(String).includes(String(v));
    const c = vergelijk(v, f.waarde);
    return f.op === 'gte' ? c >= 0 : c <= 0;
  });
}

export class Versies {
  private tabellen = new Map<string, Gelezen>();

  /** Een deel gelezen (een ander onderdeel leest dezelfde tabel met een filter): dat deel bijwerken, de rest houden. */
  vervang(ronde: Leesronde) {
    for (const [t, g] of ronde) {
      const oud = this.tabellen.get(t);
      if (!oud || g.vensters === 'alles') {
        this.tabellen.set(t, { versies: new Map(g.versies), vensters: g.vensters === 'alles' ? 'alles' : [...g.vensters] });
        continue;
      }
      for (const [k, v] of g.versies) oud.versies.set(k, v);
      if (oud.vensters === 'alles') continue;
      const bekend = new Set(oud.vensters.map((f) => JSON.stringify(f)));
      for (const f of g.vensters) if (!bekend.has(JSON.stringify(f))) oud.vensters.push(f);
    }
  }

  leeg() {
    this.tabellen.clear();
  }

  /** > 0 wat de app kent, 0 als een nieuwe rij nog niet mag bestaan, undefined zonder controle. */
  controle(tabel: string, rij: Rij, nieuw: boolean): number | undefined {
    const g = this.tabellen.get(tabel);
    if (!g) return undefined;
    const k = sleutelTekst(tabel, rij);
    if (k == null) return undefined;
    if (!nieuw) return g.versies.get(k);
    return g.vensters === 'alles' || g.vensters.some((f) => binnen(rij, f)) ? 0 : undefined;
  }

  naSchrijven(versies: Versie[], ops: Operatie[]) {
    for (const o of ops) {
      if (o.soort !== 'delete') continue;
      const g = this.tabellen.get(o.tabel);
      if (!g) continue;
      for (const s of o.sleutels) {
        const k = sleutelTekst(o.tabel, s);
        if (k != null) g.versies.delete(k);
      }
    }
    for (const v of versies) {
      let g = this.tabellen.get(v.t);
      if (!g) this.tabellen.set(v.t, (g = { versies: new Map(), vensters: [] }));
      g.versies.set(v.k.map((x) => String(x)).join('|'), Number(v.v));
    }
  }
}
