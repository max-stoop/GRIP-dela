/**
 * Van rooster naar verdeling, en voor de simulatie een aangevuld landelijk beeld. Fictief tot de bron er is:
 * woonpostcodes (tenzij ingevuld), voorgangen, recente dossiers en de meldingen zelf.
 */
import { CLUSTERS, COORDS, REGION_CLUSTER } from '../model/config';
import { DIENSTEN, normaliseerDienst } from '../rooster/diensten';
import { inRooster, type Cellen, type DienstCode, type Medewerker } from '../rooster/types';
import type { NormParameters } from '../capaciteit/parameters';
import { lamNorm, normWeek, plekkenNorm } from '../capaciteit/norm';
import { spelingOpDag } from '../capaciteit/beschikbaarheid';
import { addDays, toDay, weekdayMon } from '../dates';
import { rng } from '../model/demo';
import { afstandKm, puntVan, type PostcodeTabel } from './geo';
import { STANDAARD_PARAMETERS, type Afspraak, type Dagdeel, type Invoer, type Melding, type Parameters, type Persoon, type Punt, type Slot } from './types';

const U = 60;

/** Per dienst: vertrek kan niet eerder en het laatste gesprek is erbinnen af; per plek het tijdvak uit het roosterbeleid. */
const PLEKTIJDEN: Partial<Record<DienstCode, { dienst: [number, number]; plekken: { dagdeel: Dagdeel; van: number; tot: number; soort: Slot['soort'] }[] }>> = {
  '1': { dienst: [9 * U, 17 * U], plekken: [{ dagdeel: 'ochtend', van: 10 * U, tot: 13 * U, soort: 'regel' }] },
  '1M': { dienst: [11 * U, 19 * U], plekken: [{ dagdeel: 'middag', van: 12 * U, tot: 15 * U, soort: 'regel' }] },
  '2': { dienst: [9 * U, 19 * U], plekken: [{ dagdeel: 'ochtend', van: 10 * U, tot: 10.5 * U, soort: 'regel' }, { dagdeel: 'middag', van: 14.5 * U, tot: 15 * U, soort: 'regel' }] },
  '1B': { dienst: [11 * U, 19 * U], plekken: [{ dagdeel: 'middag', van: 12 * U, tot: 15 * U, soort: '1B' }] },
};

export function slotsVoor(persoonId: string, code: DienstCode): { dienst: [number, number]; slots: Slot[] } | null {
  const t = PLEKTIJDEN[code];
  if (!t) return null;
  return {
    dienst: t.dienst,
    slots: t.plekken.map((p, i) => ({ id: `${persoonId}#${i}`, persoonId, ...p })),
  };
}

/** Inclusief 1B. */
export function reeksVoor(cellen: Cellen, id: string, datum: string): number {
  let n = 0;
  for (let d = 1; d <= 14; d++) {
    const c = cellen[id]?.[addDays(datum, -d)];
    if (!c || DIENSTEN[normaliseerDienst(c)].plekken === 0) break;
    n++;
  }
  return n;
}

/** Zolang er geen echte dossiers zijn: de plekken van de afgelopen twee weken maal de kans dat ze gevuld waren. */
export function belastingUitRooster(cellen: Cellen, id: string, datum: string, bezetting = 0.8, halfwaarde = 4): number {
  let b = 0;
  for (let d = 1; d <= 14; d++) {
    const c = cellen[id]?.[addDays(datum, -d)];
    if (!c) continue;
    const def = DIENSTEN[normaliseerDienst(c)];
    const kans = def.categorie === 'beschikbaar' ? 0.25 : bezetting;
    b += def.plekken * kans * 0.5 ** ((d - 1) / halfwaarde);
  }
  return b;
}

/** Benaderd, alleen voor de simulatie: in productie staat de regio in de melding. */
export function postcodesPerRegio(tabel: PostcodeTabel): Map<string, string[]> {
  const uit = new Map<string, string[]>(Object.keys(COORDS).map((r) => [r, []]));
  const midden = Object.entries(COORDS).map(([r, [lat, lng]]) => ({ r, lat, lng }));
  for (const [pc, [lat, lng]] of tabel) {
    let beste = midden[0], d0 = Infinity;
    for (const m of midden) {
      const d = afstandKm({ lat, lng }, m);
      if (d < d0) { d0 = d; beste = m; }
    }
    uit.get(beste.r)!.push(pc);
  }
  for (const l of uit.values()) l.sort();
  return uit;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface SimulatieOpties {
  datum: string;
  normen: NormParameters;
  tabel: PostcodeTabel;
  medewerkers: Medewerker[];
  rooster: Record<string, Cellen>;
  /** medewerker-id → postcode */
  postcodes?: Record<string, string>;
  /** Ontbreekt = de norm. */
  lam?: (regio: string) => number | null | undefined;
  /** 1 = verwacht. */
  drukte?: number;
  /** Fictief tot het dossiersysteem gekoppeld is. */
  voorgangKans?: number;
  seed?: number;
  parameters?: Partial<Parameters>;
}

interface Simulatie {
  invoer: Invoer;
  /** De rest is aangevuld uit de norm. */
  echt: string[];
  aangevuld: string[];
  zonderPostcode: number;
}

const NAMEN = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'V', 'W'];

/** Hoe een regio zonder rooster zijn plekken vult: 1B's, minstens één 1M, een 2 bij veel plekken, de rest een 1. */
export function dienstenUitNorm(plekken: number, beschikbaar: number): DienstCode[] {
  const b = Math.min(plekken, beschikbaar);
  let rest = plekken - b;
  const uit: DienstCode[] = Array.from({ length: b }, () => '1B' as DienstCode);
  if (rest >= 6) { uit.push('2'); rest -= 2; }
  const middag = rest >= 2 ? Math.max(1, Math.round(rest * 0.3)) : 0;
  for (let i = 0; i < rest; i++) uit.push(i < middag ? '1M' : '1');
  return uit;
}

/** Echte roosters waar die er zijn, aangevuld volgens de vastgestelde regelplekken. */
export function simulatie(o: SimulatieOpties): Simulatie {
  const par: Parameters = { ...STANDAARD_PARAMETERS, ...o.parameters };
  // eigen reeksen per persoon en voor de meldingen: een ander rooster of een ingevulde postcode verandert de
  // meldingen niet, zodat je de uitkomst eerlijk kunt vergelijken
  const seed = o.seed ?? 1;
  const voor = (sleutel: string) => rng(hash(`${seed}|${sleutel}`));
  const perRegio = postcodesPerRegio(o.tabel);
  const punt = (pc: string): Punt => puntVan(o.tabel, pc)!;
  const willekeurig = (regio: string, h: number): Punt => {
    const lijst = perRegio.get(regio)!;
    return punt(lijst[h % lijst.length]);
  };
  const week = normWeek(o.datum), dagMa = weekdayMon(toDay(o.datum));
  const personen: Persoon[] = [];
  const echt: string[] = [], aangevuld: string[] = [];
  let zonderPostcode = 0;
  const regios = Object.keys(REGION_CLUSTER);

  const voorgang = (id: string, thuis: Punt, regio: string, code: DienstCode): Afspraak[] => {
    const R = voor(`voorgang|${id}`);
    if (!(code === '1M' || code === '1B') || R.uniform() >= (o.voorgangKans ?? 0.25)) return [];
    const plek = R.uniform() < 0.5 ? thuis : willekeurig(regio, Math.floor(R.uniform() * 1e9));
    const start = R.pick([9 * U, 9.5 * U, 10 * U]);
    return [{ id: `${id}:voorgang`, start, eind: start + 90, plek, soort: 'voorgang', omschrijving: 'Uitvaart (fictief)' }];
  };

  const extraSpeling = new Map<string, number>();
  for (const [cl, rs] of Object.entries(CLUSTERS)) {
    // de speling van het cluster komt bij de regio's met de meeste meldingen
    const s = spelingOpDag(o.normen, cl, week, dagMa);
    const op = [...rs].sort((a, b) => (lamNorm(o.normen, b, o.datum) ?? 0) - (lamNorm(o.normen, a, o.datum) ?? 0));
    for (let i = 0; i < s; i++) extraSpeling.set(op[i % op.length], (extraSpeling.get(op[i % op.length]) ?? 0) + 1);
  }

  for (const regio of regios) {
    const cluster = REGION_CLUSTER[regio];
    const cellen = o.rooster[regio] ?? {};
    const team = o.medewerkers.filter((m) => m.regio === regio && inRooster(m) && m.functie !== 'UL');
    const metDienst = team.filter((m) => PLEKTIJDEN[normaliseerDienst(cellen[m.id]?.[o.datum] ?? '-')]);
    if (metDienst.length) {
      echt.push(regio);
      for (const m of metDienst) {
        const code = normaliseerDienst(cellen[m.id][o.datum]);
        const s = slotsVoor(m.id, code)!;
        const ingevuld = o.postcodes?.[m.id] ? puntVan(o.tabel, o.postcodes[m.id]) : null;
        if (!ingevuld) zonderPostcode++;
        const thuis = ingevuld ?? willekeurig(regio, hash(m.id));
        personen.push({
          id: m.id, naam: m.naam, regio, cluster, contract: m.contract, thuis,
          dienstStart: s.dienst[0], dienstEind: s.dienst[1], slots: s.slots,
          afspraken: voorgang(m.id, thuis, regio, code),
          belasting: belastingUitRooster(cellen, m.id, o.datum), reeks: reeksVoor(cellen, m.id, o.datum),
        });
      }
    } else {
      aangevuld.push(regio);
      const k = (plekkenNorm(o.normen, regio, o.datum) ?? 0) + (extraSpeling.get(regio) ?? 0);
      dienstenUitNorm(k, o.normen.beschikbaarPerDag).forEach((code, i) => {
        const id = `sim:${regio}:${i}`;
        const R = voor(`persoon|${id}`);
        const s = slotsVoor(id, code)!;
        const thuis = willekeurig(regio, hash(id));
        personen.push({
          id, naam: `${regio} ${NAMEN[i % NAMEN.length]}`, regio, cluster, contract: R.pick([24, 28, 32, 36]), thuis,
          dienstStart: s.dienst[0], dienstEind: s.dienst[1], slots: s.slots,
          afspraken: voorgang(id, thuis, regio, code),
          // recente dossiers en reeks: fictief, met spreiding zodat werkdruk iets uitmaakt
          belasting: Math.round(R.uniform() * 30) / 10, reeks: R.pick([0, 0, 1, 1, 2, 3]), fictief: true,
        });
      });
    }
  }

  // meldingen die om middernacht bekend zijn: wat sinds de vorige verdeling binnenkwam
  const meldingen: Melding[] = [];
  const verwacht: Record<string, number> = {};
  const nacht = Math.max(0, 1 - par.aandeelOchtend - par.aandeelMiddag);
  const R = voor(`meldingen|${o.datum}`);
  for (const regio of regios) {
    const l = o.lam?.(regio) ?? lamNorm(o.normen, regio, o.datum) ?? 0;
    const cl = REGION_CLUSTER[regio];
    verwacht[cl] = (verwacht[cl] ?? 0) + l;
    const n = R.poisson(l * nacht * (o.drukte ?? 1));
    for (let i = 0; i < n; i++) {
      const plek = willekeurig(regio, Math.floor(R.uniform() * 1e9));
      // binnengekomen gisteren tussen 12:00 en 24:00; het gesprek moet binnen 24 uur
      const binnen = Math.round(12 * U + R.uniform() * 12 * U);
      const gisteren = addDays(o.datum, -1);
      const m: Melding = {
        id: `M${String(meldingen.length + 1).padStart(3, '0')}`, plek, regio, cluster: cl,
        ontvangen: `${gisteren}T${String(Math.floor(binnen / U)).padStart(2, '0')}:${String(binnen % U).padStart(2, '0')}`,
        uiterlijk: binnen,
      };
      const v = R.uniform();
      if (v < 0.1) m.voorkeurDagdeel = 'ochtend';
      else if (v < 0.2) m.voorkeurDagdeel = 'middag';
      meldingen.push(m);
    }
  }
  return { invoer: { personen, meldingen, verwacht, parameters: par }, echt, aangevuld, zonderPostcode };
}
