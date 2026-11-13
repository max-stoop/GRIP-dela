/**
 * Verlofruimte per regio per week: bezetting min verzuim min de te borgen uren. In schoolvakanties mag het cluster
 * helpen: past het niet in de regio maar wel in het cluster, dan kan het met collega's of externen uit het cluster.
 */
import { addDays, fromDay, isoRange, mondayOf, todayIso, toDay, weekdayMon } from '../dates';
import { borgingWeek, normWeek, regiosVanCluster } from './norm';
import type { NormParameters } from './parameters';
import type { Beleid, Medewerker } from '../rooster/types';
import { NBD, NBD_STANDAARD, type NbdParameters } from '../nbd/parameters';
import { nbdCapaciteitWeek, type NbdCapaciteitWeek } from '../nbd/capaciteit';

export type SchoolRegio = 'noord' | 'midden' | 'zuid';

export interface Schoolvakantie {
  id: string;
  naam: string;
  regio: SchoolRegio | 'alle';
  van: string;
  tot: string;
  /** Overgenomen uit het rijksoverzicht, of indicatief (nog controleren). */
  bron: 'rijksoverheid' | 'indicatief' | 'handmatig';
}

/** Benaderd op basis van het werkgebied. */
export const SCHOOLREGIO: Record<string, SchoolRegio> = {
  Friesland: 'noord', Groningen: 'noord', 'Noord-Oost': 'noord', 'Twente/Achterhoek': 'noord', 'Veluwe-IJssel': 'midden',
  Amsterdam: 'noord', 'Noord-Holland': 'noord', 'Noord-Holland Midden': 'noord', 'Spaarne-Rijnland': 'noord',
  Arnhem: 'midden', 'Midden Nederland': 'midden', Nijmegen: 'zuid', Utrecht: 'midden',
  Haaglanden: 'midden', Rotterdam: 'midden', 'West Brabant/Zeeland': 'zuid', 'Zuid Holland Zuid': 'midden',
  Kempenland: 'zuid', 'Midden Limburg': 'zuid', 'Oost Brabant': 'zuid', 'Zuid Limburg': 'zuid',
  Breda: 'zuid', 'Den Bosch': 'zuid', Eindhoven: 'zuid', Tilburg: 'zuid',
};

/** Startwaarden; indicatief. Haal de officiële data op of pas ze aan onder Instellingen. */
export const STANDAARD_SCHOOLVAKANTIES: Schoolvakantie[] = [
  { id: 'kv25', naam: 'Kerstvakantie', regio: 'alle', van: '2025-12-20', tot: '2026-01-04', bron: 'indicatief' },
  { id: 'vv26', naam: 'Voorjaarsvakantie', regio: 'alle', van: '2026-02-14', tot: '2026-02-22', bron: 'indicatief' },
  { id: 'mv26', naam: 'Meivakantie', regio: 'alle', van: '2026-04-25', tot: '2026-05-03', bron: 'indicatief' },
  { id: 'zv26n', naam: 'Zomervakantie', regio: 'noord', van: '2026-07-04', tot: '2026-08-16', bron: 'indicatief' },
  { id: 'zv26m', naam: 'Zomervakantie', regio: 'midden', van: '2026-07-18', tot: '2026-08-30', bron: 'indicatief' },
  { id: 'zv26z', naam: 'Zomervakantie', regio: 'zuid', van: '2026-07-11', tot: '2026-08-23', bron: 'indicatief' },
  { id: 'hv26n', naam: 'Herfstvakantie', regio: 'noord', van: '2026-10-17', tot: '2026-10-25', bron: 'indicatief' },
  { id: 'hv26m', naam: 'Herfstvakantie', regio: 'midden', van: '2026-10-17', tot: '2026-10-25', bron: 'indicatief' },
  { id: 'hv26z', naam: 'Herfstvakantie', regio: 'zuid', van: '2026-10-10', tot: '2026-10-18', bron: 'indicatief' },
  { id: 'kv26', naam: 'Kerstvakantie', regio: 'alle', van: '2026-12-19', tot: '2027-01-03', bron: 'indicatief' },
  { id: 'vv27n', naam: 'Voorjaarsvakantie', regio: 'noord', van: '2027-02-20', tot: '2027-02-28', bron: 'indicatief' },
  { id: 'vv27m', naam: 'Voorjaarsvakantie', regio: 'midden', van: '2027-02-13', tot: '2027-02-21', bron: 'indicatief' },
  { id: 'vv27z', naam: 'Voorjaarsvakantie', regio: 'zuid', van: '2027-02-06', tot: '2027-02-14', bron: 'indicatief' },
  { id: 'mv27', naam: 'Meivakantie', regio: 'alle', van: '2027-04-24', tot: '2027-05-02', bron: 'indicatief' },
  { id: 'zv27n', naam: 'Zomervakantie', regio: 'noord', van: '2027-07-10', tot: '2027-08-22', bron: 'indicatief' },
  { id: 'zv27m', naam: 'Zomervakantie', regio: 'midden', van: '2027-07-17', tot: '2027-08-29', bron: 'indicatief' },
  { id: 'zv27z', naam: 'Zomervakantie', regio: 'zuid', van: '2027-07-24', tot: '2027-09-05', bron: 'indicatief' },
  { id: 'hv27n', naam: 'Herfstvakantie', regio: 'noord', van: '2027-10-16', tot: '2027-10-24', bron: 'indicatief' },
  { id: 'hv27m', naam: 'Herfstvakantie', regio: 'midden', van: '2027-10-16', tot: '2027-10-24', bron: 'indicatief' },
  { id: 'hv27z', naam: 'Herfstvakantie', regio: 'zuid', van: '2027-10-23', tot: '2027-10-31', bron: 'indicatief' },
  { id: 'kv27', naam: 'Kerstvakantie', regio: 'alle', van: '2027-12-25', tot: '2028-01-09', bron: 'indicatief' },
];

const NIEUW_IN_2026_10 = new Set(['kv25', 'vv26', 'mv26', 'zv26n', 'zv26m', 'zv26z', 'hv27n', 'hv27m', 'hv27z', 'kv27']);

/** Een vakantie met dezelfde naam, regio en beginjaar (opgehaald of zelf ingevoerd) gaat voor de startwaarde. */
export function vulSchoolvakantiesAan(lijst: Schoolvakantie[]): Schoolvakantie[] {
  // al eens aangevuld: wat er daarna is verwijderd, blijft weg
  if (lijst.some((v) => NIEUW_IN_2026_10.has(v.id))) return lijst;
  const sleutel = (v: Schoolvakantie) => `${v.naam.toLowerCase()}|${v.regio}|${v.van.slice(0, 4)}`;
  const bekend = new Set(lijst.flatMap((v) => [v.id, sleutel(v)]));
  // opgehaalde data per regio vervangen een startwaarde voor 'alle'
  const bijRegio = new Set(lijst.filter((v) => v.regio !== 'alle').map((v) => `${v.naam.toLowerCase()}|${v.van.slice(0, 4)}`));
  const extra = STANDAARD_SCHOOLVAKANTIES.filter((d) => !bekend.has(d.id) && !bekend.has(sleutel(d)) && !(d.regio === 'alle' && bijRegio.has(`${d.naam.toLowerCase()}|${d.van.slice(0, 4)}`)));
  return extra.length ? [...lijst, ...extra].sort((a, b) => a.van.localeCompare(b.van)) : lijst;
}

/** "Herfstvakantie (regio zuid)": scholen hebben per regio (noord, midden, zuid) een eigen week. */
export function vakantieNaam(v: Pick<Schoolvakantie, 'naam' | 'regio'>): string {
  return v.regio === 'alle' ? v.naam : `${v.naam} (regio ${v.regio})`;
}

export function schoolvakantieIn(vakanties: Schoolvakantie[], regio: string, maandag: string): Schoolvakantie | null {
  const sr = SCHOOLREGIO[regio];
  const zondag = addDays(maandag, 6);
  return vakanties.find((v) => (v.regio === 'alle' || v.regio === sr) && v.van <= zondag && v.tot >= maandag) ?? null;
}

export function inSchoolvakantie(vakanties: Schoolvakantie[], regio: string, datum: string): boolean {
  const sr = SCHOOLREGIO[regio];
  return vakanties.some((v) => (v.regio === 'alle' || v.regio === sr) && v.van <= datum && v.tot >= datum);
}

export interface VerlofItem {
  id: string;
  medewerkerId: string;
  regio: string;
  van: string;
  tot: string;
  status: 'aangevraagd' | 'goedgekeurd' | 'afgewezen' | 'ingetrokken';
  aangevraagd: string;
  rondeId?: string;
  soort?: string;
}

/** maandag → uren; werkdagen ma t/m vr tellen contract / 5. */
export function verlofUrenPerWeek(v: VerlofItem, contract: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of isoRange(v.van, v.tot)) {
    const n = toDay(d);
    if (weekdayMon(n) > 4) continue;
    const m = fromDay(mondayOf(n));
    out.set(m, (out.get(m) ?? 0) + contract / 5);
  }
  return out;
}

export interface WeekRuimte {
  maandag: string;
  week: number;
  bezetting: number;
  verzuim: number;
  borging: number;
  /** Bezetting min verzuim min borging. */
  ruimte: number;
  /** Gemiddeld over het jaar, ter vergelijking. */
  normVerlof: number;
  goedgekeurd: number;
  aangevraagd: number;
  /** Na goedgekeurd verlof. */
  over: number;
  schoolvakantie: Schoolvakantie | null;
}

export interface VerlofContext {
  normen: NormParameters;
  beleid: Beleid;
  medewerkers: Medewerker[];
  verlof: VerlofItem[];
  schoolvakanties: Schoolvakantie[];
  /** Standaard de contracturen van het team, of de begroting (fte × 40). */
  bezetting?: 'team' | 'begroting';
  /** Bij de NBD volgt de ruimte uit de capaciteitsplanning van de NBD. */
  nbd?: NbdParameters;
}

export function bezettingTeam(medewerkers: Medewerker[], regio: string): number {
  return medewerkers.filter((m) => m.regio === regio && m.actief && !m.extern).reduce((s, m) => s + m.contract, 0);
}

function verlofPerWeek(ctx: Pick<VerlofContext, 'medewerkers' | 'verlof'>, regio: string): Map<string, { goed: number; aan: number }> {
  const contract = new Map(ctx.medewerkers.map((m) => [m.id, m.contract]));
  // alleen verlof van wie in de bezetting zit: niet van wie uit het team is, en niet van externen
  const telt = new Set(ctx.medewerkers.filter((m) => m.actief && !m.extern).map((m) => m.id));
  const perWeek = new Map<string, { goed: number; aan: number }>();
  for (const v of ctx.verlof) {
    if (v.regio !== regio || (v.status !== 'goedgekeurd' && v.status !== 'aangevraagd') || !telt.has(v.medewerkerId)) continue;
    for (const [m, h] of verlofUrenPerWeek(v, contract.get(v.medewerkerId) ?? 0)) {
      const x = perWeek.get(m) ?? { goed: 0, aan: 0 };
      if (v.status === 'goedgekeurd') x.goed += h; else x.aan += h;
      perWeek.set(m, x);
    }
  }
  return perWeek;
}

export function nbdCapaciteitUitVerlof(ctx: VerlofContext, van: string, weken: number): NbdCapaciteitWeek[] {
  const inv = { p: ctx.nbd ?? NBD_STANDAARD, normen: ctx.normen, team: ctx.medewerkers.filter((m) => m.regio === NBD), verlofPerWeek: verlofPerWeek(ctx, NBD) };
  const start = mondayOf(toDay(van));
  return Array.from({ length: weken }, (_, w) => nbdCapaciteitWeek(inv, fromDay(start + 7 * w)));
}

export function verlofRuimte(ctx: VerlofContext, regio: string, van: string, weken: number): WeekRuimte[] {
  const team = bezettingTeam(ctx.medewerkers, regio);
  const perWeek = verlofPerWeek(ctx, regio);
  if (regio === NBD) {
    // de NBD: bezetting, verzuim en de te borgen uren uit de capaciteitsplanning van de NBD
    return nbdCapaciteitUitVerlof(ctx, van, weken).map((c) => {
      const verzuim = c.ziek + c.overigVerzuim, borging = c.benodigd + c.overig;
      return {
        maandag: c.maandag, week: normWeek(c.maandag), bezetting: c.bruto, verzuim, borging, ruimte: c.ruimte, normVerlof: c.bruto * ctx.beleid.verlofNorm,
        goedgekeurd: c.verlof, aangevraagd: c.aangevraagd, over: c.over, schoolvakantie: schoolvakantieIn(ctx.schoolvakanties, regio, c.maandag),
      };
    });
  }
  const start = mondayOf(toDay(van));
  const out: WeekRuimte[] = [];
  for (let w = 0; w < weken; w++) {
    const maandag = fromDay(start + 7 * w);
    const nw = normWeek(maandag);
    const b = borgingWeek(ctx.normen, regio, nw, ctx.beleid.clusterSpeling);
    const r = ctx.normen.regios[regio];
    const bezetting = ctx.bezetting === 'begroting' || !team ? (r ? r.fte[Math.min(3, Math.floor((nw - 1) / 13))] * ctx.normen.urenPerFte : 0) : team;
    const verzuim = bezetting * ctx.beleid.verzuimNorm;
    const borging = b?.totaal ?? 0;
    const ruimte = bezetting - verzuim - borging;
    const x = perWeek.get(maandag) ?? { goed: 0, aan: 0 };
    out.push({
      maandag, week: nw, bezetting, verzuim, borging, ruimte, normVerlof: bezetting * ctx.beleid.verlofNorm,
      goedgekeurd: x.goed, aangevraagd: x.aan, over: ruimte - x.goed, schoolvakantie: schoolvakantieIn(ctx.schoolvakanties, regio, maandag),
    });
  }
  return out;
}

export type AdviesSoort = 'past' | 'krap' | 'cluster' | 'past_niet';

export const ADVIES_LABEL: Record<AdviesSoort, string> = {
  past: 'Past',
  krap: 'Past krap',
  cluster: 'Past in het cluster',
  past_niet: 'Past niet',
};

export interface Advies {
  soort: AdviesSoort;
  /** Bij krap, cluster of past niet. */
  knelpunt?: string;
  uitleg: string;
}

/** Goedgekeurd verlof gaat eerst af. Daarna voorrang voor wie dit jaar minder verlof in schoolvakanties kreeg, dan wie eerder aanvroeg. */
export function verlofAdvies(ctx: VerlofContext, cluster: string, opts: { krapMarge?: number; vandaag?: string } = {}): Map<string, Advies> {
  const marge = opts.krapMarge ?? 8;
  const ditJaar = (opts.vandaag ?? todayIso()).slice(0, 4);
  // de NBD is landelijk en hoort bij geen cluster: daar is het eigen team het cluster
  const regios = cluster === NBD ? [NBD] : regiosVanCluster(ctx.normen, cluster);
  const contract = new Map(ctx.medewerkers.map((m) => [m.id, m.contract]));
  const open = ctx.verlof.filter((v) => v.status === 'aangevraagd' && regios.includes(v.regio));
  const out = new Map<string, Advies>();
  if (!open.length) return out;
  const van = open.reduce((a, v) => (v.van < a ? v.van : a), open[0].van);
  const tot = open.reduce((a, v) => (v.tot > a ? v.tot : a), open[0].tot);
  const weken = Math.floor((mondayOf(toDay(tot)) - mondayOf(toDay(van))) / 7) + 1;
  const rest = new Map<string, Map<string, number>>();
  const school = new Map<string, Map<string, boolean>>();
  for (const r of regios) {
    const rij = verlofRuimte(ctx, r, van, weken);
    rest.set(r, new Map(rij.map((w) => [w.maandag, w.over])));
    school.set(r, new Map(rij.map((w) => [w.maandag, !!w.schoolvakantie])));
  }
  const schoolUren = new Map<string, number>();
  for (const v of ctx.verlof) {
    if (v.status !== 'goedgekeurd' || !regios.includes(v.regio)) continue;
    for (const [m, h] of verlofUrenPerWeek(v, contract.get(v.medewerkerId) ?? 0)) {
      if (m.startsWith(ditJaar) && schoolvakantieIn(ctx.schoolvakanties, v.regio, m)) schoolUren.set(v.medewerkerId, (schoolUren.get(v.medewerkerId) ?? 0) + h);
    }
  }
  const volgorde = [...open].sort((a, b) => (schoolUren.get(a.medewerkerId) ?? 0) - (schoolUren.get(b.medewerkerId) ?? 0) || a.aangevraagd.localeCompare(b.aangevraagd));
  const clusterOver = (m: string) => regios.reduce((s, r) => s + Math.max(0, rest.get(r)!.get(m) ?? 0), 0);
  const tekst = (m: string) => `week van ${m.slice(8, 10)}-${m.slice(5, 7)}`;
  for (const v of volgorde) {
    const uren = verlofUrenPerWeek(v, contract.get(v.medewerkerId) ?? 0);
    const r = rest.get(v.regio)!;
    let soort: AdviesSoort = 'past', knelpunt: string | undefined;
    for (const [m, h] of uren) {
      const over = r.get(m) ?? 0;
      if (over - h >= marge) continue;
      if (over - h >= 0) { if (soort === 'past') { soort = 'krap'; knelpunt = m; } continue; }
      if (school.get(v.regio)!.get(m) && clusterOver(m) - h >= 0) { soort = 'cluster'; knelpunt = m; continue; }
      soort = 'past_niet'; knelpunt = m;
      break;
    }
    if (soort !== 'past_niet') {
      for (const [m, h] of uren) {
        let nodig = h;
        const eigen = Math.max(0, r.get(m) ?? 0);
        const af = Math.min(eigen, nodig);
        r.set(m, (r.get(m) ?? 0) - af);
        nodig -= af;
        // de rest uit het cluster, bij de regio met de meeste ruimte
        for (const rg of [...regios].sort((a, b) => (rest.get(b)!.get(m) ?? 0) - (rest.get(a)!.get(m) ?? 0))) {
          if (nodig <= 0) break;
          const x = Math.max(0, rest.get(rg)!.get(m) ?? 0), af2 = Math.min(x, nodig);
          rest.get(rg)!.set(m, (rest.get(rg)!.get(m) ?? 0) - af2);
          nodig -= af2;
        }
      }
    }
    const uitleg = soort === 'past' ? 'Er is ruimte in alle weken.'
      : soort === 'krap' ? `Past, maar de ruimte is daarna bijna op (${tekst(knelpunt!)}).`
      : soort === 'cluster' ? `In de regio is geen ruimte in de ${tekst(knelpunt!)}, in het cluster wel (schoolvakantie).`
      : `Geen ruimte in de ${tekst(knelpunt!)}, ook niet in het cluster.`;
    out.set(v.id, { soort, knelpunt, uitleg });
  }
  return out;
}
