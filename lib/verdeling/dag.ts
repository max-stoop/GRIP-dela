/**
 * De meldingen van een dag in één keer verdelen, standaard om 07:00. Gesprekken beginnen om 10:00 of 13:00, tenzij er
 * een tijd is afgesproken. Daarna per cluster de kans dat de 1B nog valt: alleen wat later binnenkomt kan dat nog
 * doen, dus die kans is veel kleiner dan volgens het rooster.
 */
import { CLUSTERS, COORDS, REGION_CLUSTER } from '../model/config';
import { DIENSTEN, normaliseerDienst } from '../rooster/diensten';
import { inRooster, type Cellen, type DienstCode, type Medewerker } from '../rooster/types';
import { poissonVerdeling } from '../capaciteit/beschikbaarheid';
import { addDays } from '../dates';
import { afstandKm, puntVan, type PostcodeTabel } from './geo';
import { reeksVoor } from './invoer';
import { STANDAARD_PARAMETERS, type Dagdeel, type Invoer, type Melding, type Parameters, type Persoon, type Punt, type Slot } from './types';

const U = 60;

const STANDAARD_TIJDEN = [10 * U, 13 * U];

/** Per dienst het tijdvak uit het roosterbeleid en de standaardtijden die erin passen. */
export const DAG_PLEKTIJDEN: Partial<Record<DienstCode, { dienst: [number, number]; plekken: { dagdeel: Dagdeel; van: number; tot: number; tijden: number[]; soort: Slot['soort'] }[] }>> = {
  '1': { dienst: [9 * U, 17 * U], plekken: [{ dagdeel: 'ochtend', van: 10 * U, tot: 13 * U, tijden: [10 * U, 13 * U], soort: 'regel' }] },
  '1M': { dienst: [11 * U, 19 * U], plekken: [{ dagdeel: 'middag', van: 12 * U, tot: 15 * U, tijden: [13 * U], soort: 'regel' }] },
  '2': { dienst: [9 * U, 19 * U], plekken: [{ dagdeel: 'ochtend', van: 10 * U, tot: 10.5 * U, tijden: [10 * U], soort: 'regel' }, { dagdeel: 'middag', van: 13 * U, tot: 15 * U, tijden: [13 * U], soort: 'regel' }] },
  '1B': { dienst: [11 * U, 19 * U], plekken: [{ dagdeel: 'middag', van: 12 * U, tot: 15 * U, tijden: [13 * U], soort: '1B' }] },
};

/**
 * Na 07:00 komt nog 5% van de meldingen vroeg genoeg voor 10:00 en 10% alleen nog voor 13:00. De kosten leggen een
 * vaste volgorde vast: eerste plekken in de eigen regio en het cluster, dan het tweede gesprek van een 2, dan de 1B,
 * dan een ander cluster. Elke stap kost meer dan de langste reis in de stap ervoor.
 */
export const DAG_PARAMETERS: Partial<Parameters> = { aandeelOchtend: 0.05, aandeelMiddag: 0.1, tweedeGesprek: 150, inzet1B: 300, buitenCluster: 400 };

export type Stap = 'eigen' | 'cluster' | 'tweede' | '1B' | 'ander';

export const STAP_NAAM: Record<Stap, string> = {
  eigen: 'Eigen regio',
  cluster: 'Elders in het cluster',
  tweede: 'Tweede gesprek van een 2',
  '1B': '1B',
  ander: 'Ander cluster',
};

export function stapVan(o: { meldingRegio: string; persoonRegio: string; soort: Slot['soort']; tweede: boolean }): Stap {
  if (REGION_CLUSTER[o.meldingRegio] !== REGION_CLUSTER[o.persoonRegio]) return 'ander';
  if (o.soort === '1B') return '1B';
  if (o.tweede) return 'tweede';
  return o.meldingRegio === o.persoonRegio ? 'eigen' : 'cluster';
}

/** Per persoon alles na het vroegste. */
export function tweedeGesprekken(toewijzingen: { meldingId: string; persoonId: string; start: number }[]): Set<string> {
  const per = new Map<string, { meldingId: string; start: number }[]>();
  for (const t of toewijzingen) per.set(t.persoonId, [...(per.get(t.persoonId) ?? []), t]);
  const uit = new Set<string>();
  for (const l of per.values()) l.sort((a, b) => a.start - b.start || a.meldingId.localeCompare(b.meldingId)).slice(1).forEach((t) => uit.add(t.meldingId));
  return uit;
}

export interface DagMelding {
  id: string;
  /** PC4: we bewaren geen adres. */
  postcode: string;
  regio: string;
  /** In minuten; leeg = 10:00 of 13:00, wat het beste past. */
  tijd?: number;
}

export interface DagToewijzing {
  meldingId: string;
  persoonId: string;
  slotId: string;
  start: number;
  reistijd: number;
  /** Doorgegeven: blijft staan als er opnieuw wordt verdeeld. */
  vast?: boolean;
}

export interface DagVerdeling {
  datum: string;
  meldingen: DagMelding[];
  toewijzingen: DagToewijzing[];
  verdeeld?: string;
  door?: string;
}

/** Benaderd: het dichtstbijzijnde regiomidden. */
export function regioVanPostcode(tabel: PostcodeTabel, postcode: string): string | null {
  const p = puntVan(tabel, postcode);
  if (!p) return null;
  let beste: string | null = null, d0 = Infinity;
  for (const [r, [lat, lng]] of Object.entries(COORDS)) {
    if (!REGION_CLUSTER[r]) continue;
    const d = afstandKm(p, { lat, lng });
    if (d < d0) { d0 = d; beste = r; }
  }
  return beste;
}

/** "10:00", "10.30" of "1030" naar minuten; null als het geen tijd is. */
export function leesTijd(t: string): number | null {
  const m = /^\s*([01]?\d|2[0-3])[:.]?([0-5]\d)?\s*$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * U + Number(m[2] ?? 0);
}

/** Per regel een postcode, eventueel met een tijd ("3521 AB 13:00", "1012;10.30"). */
export function leesLijst(tekst: string): { meldingen: { postcode: string; tijd?: number }[]; fouten: string[] } {
  const meldingen: { postcode: string; tijd?: number }[] = [];
  const fouten: string[] = [];
  tekst.split(/\r?\n/).forEach((regel, i) => {
    const r = regel.trim();
    if (!r) return;
    const pc = /([1-9]\d{3})\s?([A-Za-z]{2})?/.exec(r);
    if (!pc) { fouten.push(`Regel ${i + 1}: geen postcode`); return; }
    const rest = r.slice(pc.index + pc[0].length);
    const t = /(\d{1,2}[:.]\d{2})/.exec(rest);
    const tijd = t ? leesTijd(t[1]) : null;
    // alleen de 4 cijfers: genoeg voor de reistijd, en we bewaren zo geen adres
    meldingen.push({ postcode: pc[1], ...(tijd != null ? { tijd } : {}) });
  });
  return { meldingen, fouten };
}

/** Gewogen naar hoe lang geleden (halfwaarde 4 dagen). Zonder verdeling een schatting uit het rooster. */
export function recenteDossiers(id: string, datum: string, cellen: Cellen, verdelingen: Record<string, DagVerdeling>, halfwaarde = 4): number {
  let b = 0;
  for (let d = 1; d <= 14; d++) {
    const dag = addDays(datum, -d);
    const v = verdelingen[dag];
    const gewicht = 0.5 ** ((d - 1) / halfwaarde);
    if (v?.toewijzingen.length) {
      b += v.toewijzingen.filter((t) => t.persoonId === id).length * gewicht;
      continue;
    }
    const c = cellen[id]?.[dag];
    if (!c) continue;
    const def = DIENSTEN[normaliseerDienst(c)];
    b += def.plekken * (def.categorie === 'beschikbaar' ? 0.25 : 0.8) * gewicht;
  }
  return b;
}

interface DagOpties {
  datum: string;
  tabel: PostcodeTabel;
  medewerkers: Medewerker[];
  rooster: Record<string, Cellen>;
  verdelingen: Record<string, DagVerdeling>;
  verdeling: DagVerdeling;
  /** Voorspelling of de vastgestelde verwachting. */
  lam: (regio: string) => number;
  parameters?: Partial<Parameters>;
}

interface DagInvoer {
  invoer: Invoer;
  /** Die rekenen vanaf het midden van de regio. */
  zonderPostcode: string[];
  onbekend: string[];
}

export function dagInvoer(o: DagOpties): DagInvoer {
  const par: Parameters = { ...STANDAARD_PARAMETERS, ...DAG_PARAMETERS, ...o.parameters };
  const personen: Persoon[] = [];
  const zonderPostcode: string[] = [];
  for (const regio of Object.keys(REGION_CLUSTER)) {
    const cellen = o.rooster[regio] ?? {};
    const cluster = REGION_CLUSTER[regio];
    for (const m of o.medewerkers) {
      if (m.regio !== regio || !inRooster(m) || m.functie === 'UL') continue;
      const code = normaliseerDienst(cellen[m.id]?.[o.datum] ?? '-');
      const t = DAG_PLEKTIJDEN[code];
      if (!t) continue;
      const eigen = m.postcode ? puntVan(o.tabel, m.postcode) : null;
      if (!eigen) zonderPostcode.push(m.id);
      const [lat, lng] = COORDS[regio];
      const thuis: Punt = eigen ?? { postcode: '', lat, lng, plaats: `midden van ${regio}` };
      personen.push({
        id: m.id, naam: m.naam, regio, cluster, contract: m.contract, thuis,
        dienstStart: t.dienst[0], dienstEind: t.dienst[1],
        slots: t.plekken.map((p, i) => ({ id: `${m.id}#${i}`, persoonId: m.id, dagdeel: p.dagdeel, van: p.van, tot: p.tot, tijden: p.tijden, soort: p.soort })),
        afspraken: [],
        belasting: recenteDossiers(m.id, o.datum, cellen, o.verdelingen),
        reeks: reeksVoor(cellen, m.id, o.datum),
      });
    }
  }
  const vast = new Map(o.verdeling.toewijzingen.filter((t) => t.vast).map((t) => [t.meldingId, t.slotId]));
  const meldingen: Melding[] = [];
  const onbekend: string[] = [];
  for (const d of o.verdeling.meldingen) {
    const plek = puntVan(o.tabel, d.postcode);
    const cluster = REGION_CLUSTER[d.regio];
    if (!plek || !cluster) { onbekend.push(d.id); continue; }
    const slotId = vast.get(d.id);
    meldingen.push({
      id: d.id, plek, regio: d.regio, cluster, ontvangen: `${o.datum}T07:00`,
      ...(d.tijd != null ? { tijd: d.tijd } : {}),
      ...(slotId ? { vast: { slotId } } : {}),
    });
  }
  const verwacht: Record<string, number> = {};
  for (const [c, rs] of Object.entries(CLUSTERS)) verwacht[c] = rs.reduce((a, r) => a + Math.max(0, o.lam(r) || 0), 0);
  return { invoer: { personen, meldingen, verwacht, parameters: par }, zonderPostcode, onbekend };
}

export interface KansNa {
  /** Kans dat er na de verdeling nog minstens één 1B valt (of, zonder 1B, dat er een plek tekortkomt). */
  minstensEen: number;
  /** Gemiddelde kans per vrije 1B. */
  gemiddeld: number;
  nogVerwacht: number;
}

export interface VrijePlekken {
  tien: number;
  beide: number;
  dertien: number;
  b: number;
}

export function vrijePlekken(slots: Slot[]): VrijePlekken {
  const v: VrijePlekken = { tien: 0, beide: 0, dertien: 0, b: 0 };
  const [t10, t13] = STANDAARD_TIJDEN;
  for (const s of slots) {
    if (s.soort === '1B') { v.b++; continue; }
    const k10 = s.van <= t10 && s.tot >= t10, k13 = s.van <= t13 && s.tot >= t13;
    if (k10 && k13) v.beide++;
    else if (k10) v.tien++;
    else if (k13) v.dertien++;
  }
  return v;
}

/**
 * Later komen nog No meldingen die 10:00 halen en Nm die alleen 13:00 halen (Poisson). De late nemen eerst een plek
 * die alleen om 13:00 kan, de vroege eerst een die alleen om 10:00 kan; wat overblijft, valt op een 1B.
 */
export function kans1BNa(vrij: VrijePlekken, vraag: { ochtend: number; middag: number }): KansNa {
  const t = Math.max(0, vrij.tien), be = Math.max(0, vrij.beide), d = Math.max(0, vrij.dertien), b = Math.max(0, vrij.b);
  const po = poissonVerdeling(Math.max(0, vraag.ochtend)), pm = poissonVerdeling(Math.max(0, vraag.middag));
  const over = new Map<number, number>();
  for (let no = 0; no < po.length; no++) {
    if (po[no] < 1e-12) continue;
    for (let nm = 0; nm < pm.length; nm++) {
      const p = po[no] * pm[nm];
      if (p < 1e-14) continue;
      const ld = Math.min(nm, d), lb = Math.min(nm - ld, be);
      const ea = Math.min(no, t), eb = Math.min(no - ea, be - lb), ed = Math.min(no - ea - eb, d - ld);
      const k = nm - ld - lb + (no - ea - eb - ed);
      over.set(k, (over.get(k) ?? 0) + p);
    }
  }
  let minstensEen = 0, verwacht1B = 0;
  for (const [k, p] of over) {
    if (k >= 1) minstensEen += p;
    verwacht1B += p * Math.min(b, k);
  }
  return { minstensEen: Math.min(1, minstensEen), gemiddeld: b ? Math.min(1, verwacht1B / b) : Math.min(1, minstensEen), nogVerwacht: vraag.ochtend + vraag.middag };
}
