/**
 * Training, klachten en de maandstart in de NBD-diensten. Tijdens een taak zit de medewerker niet aan de telefoon;
 * GRIP zet taken waar volgens Erlang C genoeg mensen overblijven. De maandstart gaat in een paar groepen, zodat
 * iedereen er één keer bij is.
 */
import type { Cellen, Medewerker, Taak, TaakSoort, Tijden, Voorkeurprofiel } from '../rooster/types';
import { addDays, fromDay, toDay, weekday } from '../dates';
import { kwartierIndex, kwartierenOpen, type NbdDag } from './behoefte';
import { aanTelefoon, pastTaak, pauzeBuitenTaken, TAAK_SOORTEN, taakUren, type NbdDienst } from './dienst';
import { nbdDienst, weekVan } from './blokken';
import { dagServiceLevel, dekking } from './toets';
import { nbdRuilToets } from './ruil';
import { dienstTegenVoorkeur } from './voorkeuren';
import type { NbdParameters, Uur } from './parameters';
import type { NbdWijziging } from './voorstel';

const EPS = 1e-9;

/** Uren in blokken van hoogstens `blok` uur, op een kwartier: 2,5 uur in blokken van 1 uur = 1, 1 en 0,5. */
export function inBlokken(uren: number, blok: number): number[] {
  let n = Math.round(uren * 4);
  const max = Math.max(1, Math.round(blok * 4));
  const uit: number[] = [];
  while (n > 0) { const k = Math.min(max, n); uit.push(k / 4); n -= k; }
  return uit;
}

interface Dag {
  datum: string;
  nodig: number[];
  gesprekken: number;
  /** Per open kwartier, met de taken die al gepland zijn. */
  cov: number[];
  diensten: Map<string, NbdDienst>;
  gewijzigd: Set<string>;
  dag: NbdDag | undefined;
}

function dagStaat(o: { team: Medewerker[]; cellen: Cellen; tijden: Tijden | undefined; behoefte: Record<string, NbdDag>; p: NbdParameters }, datum: string): Dag {
  const diensten = new Map<string, NbdDienst>();
  for (const m of o.team) {
    const x = nbdDienst(o.cellen, o.tijden, m.id, datum);
    if (x) diensten.set(m.id, { ...x, ...(x.taken ? { taken: x.taken.map((k) => ({ ...k })) } : {}) });
  }
  const dag = o.behoefte[datum];
  const ks = kwartierenOpen(o.p);
  return {
    datum, dag, diensten, gewijzigd: new Set(),
    nodig: dag ? dag.kwartieren.map((k) => k.nodig) : ks.map(() => 0),
    gesprekken: dag?.gesprekken ?? 0,
    cov: dekking(o.p, [...diensten.values()]),
  };
}

/** Uren aan de telefoon te weinig erbij als g mensen in kwartier i van de telefoon gaan. */
const extra = (dag: Dag, i: number, g: number) => Math.max(0, dag.nodig[i] - (dag.cov[i] - g)) - Math.max(0, dag.nodig[i] - dag.cov[i]);

function kwartierenVan(p: NbdParameters, van: Uur, tot: Uur): number[] {
  const n = kwartierenOpen(p).length, uit: number[] = [];
  for (let t = van; t < tot - EPS; t += 0.25) { const i = kwartierIndex(p, t); if (i >= 0 && i < n) uit.push(i); }
  return uit;
}

function kosten(p: NbdParameters, dag: Dag, x: NbdDienst, k: Taak): { kost: number; ruimte: number } {
  let kost = 0, ruimte = 0;
  for (const i of kwartierenVan(p, k.van, k.tot)) {
    if (!aanTelefoon(x, p.open + i / 4)) continue;
    kost += extra(dag, i, 1);
    ruimte += dag.cov[i] - dag.nodig[i];
  }
  return { kost, ruimte };
}

function plaats(p: NbdParameters, dag: Dag, mid: string, k: Taak) {
  const x = dag.diensten.get(mid)!;
  for (const i of kwartierenVan(p, k.van, k.tot)) if (aanTelefoon(x, p.open + i / 4)) dag.cov[i]--;
  x.taken = [...(x.taken ?? []), { ...k }].sort((a, b) => a.van - b.van);
  dag.gewijzigd.add(mid);
}

function begintijden(x: NbdDienst, uren: number, van: Uur, tot: Uur): Uur[] {
  const uit: Uur[] = [];
  for (let t = Math.max(x.start, van); t + uren <= Math.min(x.eind, tot) + EPS; t += 0.25) uit.push(Math.round(t * 4) / 4);
  return uit;
}

const vergelijk = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) return a[i] - b[i];
  return 0;
};

/** Gewogen naar gesprekken. */
function slVan(p: NbdParameters, dagen: Dag[], cov: (d: Dag) => number[]): number {
  let g = 0, s = 0;
  for (const d of dagen) {
    if (!d.dag || d.gesprekken <= 0) continue;
    g += d.gesprekken;
    s += d.gesprekken * dagServiceLevel(p, d.dag, cov(d));
  }
  return g > 0 ? s / g : 1;
}

export interface TakenInstelling {
  /** Uren per week: bij training per medewerker, bij klachten voor het hele team. */
  uren: number;
  blok: number;
  van: Uur;
  tot: Uur;
  /** Maandag tot en met vrijdag. */
  werkdagen: boolean;
}

export interface KlachtenInstelling extends TakenInstelling {
  /** Leeg = iedereen. */
  wie: string[];
}

export const trainingStandaard = (p: Pick<NbdParameters, 'training'>): TakenInstelling => ({ uren: p.training, blok: 1, van: 9, tot: 17, werkdagen: true });
export const klachtenStandaard = (p: Pick<NbdParameters, 'klachten'>): KlachtenInstelling => ({ uren: p.klachten > 0 ? p.klachten : 8, blok: 1, van: 9, tot: 17, werkdagen: true, wie: [] });

interface TakenInvoer {
  team: Medewerker[];
  /** Vanaf vandaag. */
  dates: string[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  behoefte: Record<string, NbdDag>;
  p: NbdParameters;
  training?: TakenInstelling | null;
  klachten?: KlachtenInstelling | null;
}

interface Geplaatst { soort: TaakSoort; mid: string; datum: string; taak: Taak; kost: number }
interface NietGelukt { soort: TaakSoort; mid: string | null; week: string; uren: number }

interface TakenPlan {
  wijzigingen: NbdWijziging[];
  geplaatst: Geplaatst[];
  nietGelukt: NietGelukt[];
  /** Uren aan de telefoon te weinig erbij door de nieuwe taken (per kwartier opgeteld). */
  extraTekort: number;
  slVoor: number;
  slNa: number;
}

const telt = (m: Medewerker) => m.actief && !m.extern;
const magDag = (d: string, werkdagen: boolean) => !werkdagen || (weekday(toDay(d)) >= 1 && weekday(toDay(d)) <= 5);

/** Ook buiten de periode. */
function urenInWeek(o: Pick<TakenInvoer, 'cellen' | 'tijden'>, mids: string[], maandag: number, soort: TaakSoort): Map<string, number> {
  const uit = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = fromDay(maandag + i);
    for (const mid of mids) {
      const x = nbdDienst(o.cellen, o.tijden, mid, d);
      const u = (x?.taken ?? []).filter((k) => k.soort === soort).reduce((a, k) => a + taakUren(k), 0);
      if (u) uit.set(mid, (uit.get(mid) ?? 0) + u);
    }
  }
  return uit;
}

/** Wat er al staat telt mee: opnieuw draaien vult alleen aan. Een week die deels in de periode valt, krijgt naar rato. */
export function planTaken(o: TakenInvoer): TakenPlan {
  const { p } = o;
  const team = o.team.filter(telt);
  const dagen = new Map(o.dates.map((d) => [d, dagStaat({ ...o, team }, d)]));
  const voor = new Map([...dagen.values()].map((d) => [d.datum, [...d.cov]]));
  const geplaatst: Geplaatst[] = [], nietGelukt: NietGelukt[] = [];
  const weken = new Map<number, string[]>();
  for (const d of o.dates) { const w = weekVan(d); weken.set(w, [...(weken.get(w) ?? []), d]); }

  const kies = (soort: TaakSoort, uren: number, ins: TakenInstelling, wie: Medewerker[], ds: string[], extraScore: (mid: string, d: string) => number[]) => {
    let beste: { mid: string; dag: Dag; k: Taak; score: number[]; kost: number } | null = null;
    for (const d of ds) {
      const dag = dagen.get(d)!;
      for (const m of wie) {
        const x = dag.diensten.get(m.id);
        if (!x) continue;
        for (const t of begintijden(x, uren, ins.van, ins.tot)) {
          const k: Taak = { soort, van: t, tot: t + uren };
          if (!pastTaak(x, k)) continue;
          const { kost, ruimte } = kosten(p, dag, x, k);
          const score = [kost, ...extraScore(m.id, d), -ruimte, t];
          if (!beste || vergelijk(score, beste.score) < 0) beste = { mid: m.id, dag, k, score, kost };
        }
      }
    }
    if (!beste) return false;
    plaats(p, beste.dag, beste.mid, beste.k);
    geplaatst.push({ soort, mid: beste.mid, datum: beste.dag.datum, taak: beste.k, kost: beste.kost });
    return true;
  };

  for (const [maandag, ds] of weken) {
    const week = fromDay(maandag);
    const tr = o.training;
    if (tr && tr.uren > EPS) {
      const toegestaan = ds.filter((d) => magDag(d, tr.werkdagen));
      const deel = toegestaan.length / (tr.werkdagen ? 5 : 7);
      const al = urenInWeek(o, team.map((m) => m.id), maandag, 'training');
      // wie de minste diensten heeft eerst: die heeft de minste keus
      const volgorde = [...team].sort((a, b) => toegestaan.filter((d) => dagen.get(d)!.diensten.has(a.id)).length - toegestaan.filter((d) => dagen.get(d)!.diensten.has(b.id)).length || a.naam.localeCompare(b.naam));
      for (const m of volgorde) {
        const nodig = Math.round((tr.uren * deel - (al.get(m.id) ?? 0)) * 4) / 4;
        if (nodig < 0.25 - EPS) continue;
        if (!toegestaan.some((d) => dagen.get(d)!.diensten.has(m.id))) { nietGelukt.push({ soort: 'training', mid: m.id, week, uren: nodig }); continue; }
        for (const u of inBlokken(nodig, tr.blok)) {
          // liefst niet twee trainingen op één dag
          const zelfdeDag = (mid: string, d: string) => [(dagen.get(d)!.diensten.get(mid)?.taken ?? []).filter((k) => k.soort === 'training').length];
          if (!kies('training', u, tr, [m], toegestaan, zelfdeDag)) nietGelukt.push({ soort: 'training', mid: m.id, week, uren: u });
        }
      }
    }
    const kl = o.klachten;
    if (kl && kl.uren > EPS) {
      const toegestaan = ds.filter((d) => magDag(d, kl.werkdagen));
      const deel = toegestaan.length / (kl.werkdagen ? 5 : 7);
      const wie = kl.wie.length ? team.filter((m) => kl.wie.includes(m.id)) : team;
      const al = urenInWeek(o, team.map((m) => m.id), maandag, 'klachten');
      const nodig = Math.round((kl.uren * deel - [...al.values()].reduce((a, u) => a + u, 0)) * 4) / 4;
      if (nodig >= 0.25 - EPS) {
        const perDag = new Map<string, number>(), perMw = new Map<string, number>(al);
        for (const u of inBlokken(nodig, kl.blok)) {
          const spreiding = (mid: string, d: string) => [perDag.get(d) ?? 0, perMw.get(mid) ?? 0];
          if (kies('klachten', u, kl, wie, toegestaan, spreiding)) {
            const g = geplaatst[geplaatst.length - 1];
            perDag.set(g.datum, (perDag.get(g.datum) ?? 0) + u);
            perMw.set(g.mid, (perMw.get(g.mid) ?? 0) + u);
          } else nietGelukt.push({ soort: 'klachten', mid: null, week, uren: u });
        }
      }
    }
  }

  const alle = [...dagen.values()];
  const wijzigingen: NbdWijziging[] = alle.flatMap((d) => [...d.gewijzigd].map((mid): NbdWijziging => [mid, d.datum, 'N', d.diensten.get(mid)!]));
  const extraTekort = alle.reduce((a, d) => a + d.nodig.reduce((b, n, i) => b + Math.max(0, n - d.cov[i]) - Math.max(0, n - voor.get(d.datum)![i]), 0), 0) / 4;
  return { wijzigingen, geplaatst, nietGelukt, extraTekort, slVoor: slVan(p, alle, (d) => voor.get(d.datum)!), slNa: slVan(p, alle, (d) => d.cov) };
}

export function takenWeg(o: Pick<TakenInvoer, 'team' | 'dates' | 'cellen' | 'tijden'>, soorten: TaakSoort[]): NbdWijziging[] {
  const uit: NbdWijziging[] = [];
  for (const d of o.dates) for (const m of o.team) {
    const x = nbdDienst(o.cellen, o.tijden, m.id, d);
    if (!x?.taken?.some((k) => soorten.includes(k.soort))) continue;
    const rest = x.taken.filter((k) => !soorten.includes(k.soort));
    const y: NbdDienst = { ...x };
    if (rest.length) y.taken = rest; else delete y.taken;
    uit.push([m.id, d, 'N', y]);
  }
  return uit;
}

export function takenOverzicht(o: Pick<TakenInvoer, 'team' | 'dates' | 'cellen' | 'tijden'>): Record<TaakSoort, { blokken: number; uren: number; mids: Set<string> }> {
  const uit = Object.fromEntries(TAAK_SOORTEN.map((s) => [s, { blokken: 0, uren: 0, mids: new Set<string>() }])) as Record<TaakSoort, { blokken: number; uren: number; mids: Set<string> }>;
  for (const d of o.dates) for (const m of o.team) for (const k of nbdDienst(o.cellen, o.tijden, m.id, d)?.taken ?? []) {
    const r = uit[k.soort];
    r.blokken++; r.uren += taakUren(k); r.mids.add(m.id);
  }
  return uit;
}

interface MaandstartInvoer {
  team: Medewerker[];
  /** Bijvoorbeeld de eerste week van de maand. */
  dagen: string[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  behoefte: Record<string, NbdDag>;
  p: NbdParameters;
  /** In uren. */
  duur: number;
  groepen: number;
  van: Uur;
  tot: Uur;
  /** Deze maand al geweest. */
  al?: string[];
  /** Wie in geen groep past maar wel werkt: de dienst verschuiven (zelfde lengte, getoetst). Standaard aan. */
  verschuiven?: boolean;
  /** Voor de toets van een verschoven dienst. */
  minVrijeWeekenden?: number;
  /** Een dienst schuift niet naar uren die de medewerker niet kan. */
  profielen?: Record<string, Voorkeurprofiel>;
}

export interface Verschuiving { mid: string; datum: string; was: NbdDienst; wordt: NbdDienst }

export interface MaandstartGroep {
  datum: string;
  van: Uur;
  tot: Uur;
  leden: string[];
  extraTekort: number;
  slVoor: number;
  slNa: number;
}

export interface MaandstartPlan {
  groepen: MaandstartGroep[];
  /** Wie al is geweest, telt niet mee. */
  aantal: number;
  /** Geen dienst op die dagen of tijden. */
  zonder: string[];
  verschoven: Verschuiving[];
  wijzigingen: NbdWijziging[];
  extraTekort: number;
}

/** null als hij buiten de openingstijden valt. */
function schuifDienst(p: Pick<NbdParameters, 'open' | 'sluit'>, x: NbdDienst, delta: number): NbdDienst | null {
  const y: NbdDienst = { ...x, start: x.start + delta, eind: x.eind + delta };
  if (y.start < p.open - EPS || y.eind > p.sluit + EPS) return null;
  if (x.pauzeStart != null) y.pauzeStart = x.pauzeStart + delta;
  if (x.taken?.length) y.taken = x.taken.map((k) => ({ ...k, van: k.van + delta, tot: k.tot + delta }));
  return y;
}

interface Moment { dag: Dag; van: Uur; tot: Uur; kw: number[]; leden: Set<string>; index: number }

/** Iedereen in één groep, zo min mogelijk tekort aan de telefoon, gelijke groepen, vroeg in de maand. Gretig, dan verbeterd. */
export function zoekMaandstart(o: MaandstartInvoer): MaandstartPlan {
  const { p } = o;
  const al = new Set(o.al ?? []);
  const team = o.team.filter(telt);
  const doel = team.filter((m) => !al.has(m.id)).map((m) => m.id);
  const dagen = o.dagen.map((d) => dagStaat({ ...o, team }, d));
  const duur = Math.max(0.25, Math.round(o.duur * 4) / 4);

  const momenten: Moment[] = [];
  for (const dag of dagen) {
    for (let t = Math.max(o.van, p.open); t + duur <= Math.min(o.tot, p.sluit) + EPS; t += 0.25) {
      const k: Taak = { soort: 'maandstart', van: t, tot: t + duur };
      const leden = new Set(doel.filter((mid) => { const x = dag.diensten.get(mid); return !!x && pastTaak(x, k); }));
      if (leden.size) momenten.push({ dag, van: t, tot: t + duur, kw: kwartierenVan(p, t, t + duur), leden, index: momenten.length });
    }
  }

  const dagIndex = new Map(dagen.map((d, i) => [d.datum, i]));
  /** score: [zonder groep, tekort, verschil in grootte, dag, tijd] */
  const beoordeel = (S: Moment[]): { score: number[]; groep: Map<string, number>; g: number[] } => {
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      if (S[i].dag === S[j].dag && S[i].van < S[j].tot - EPS && S[j].van < S[i].tot - EPS) return { score: [Infinity], groep: new Map(), g: [] };
    }
    const g = S.map(() => 0), groep = new Map<string, number>();
    const opties = doel.map((mid) => ({ mid, s: S.map((x, i) => (x.leden.has(mid) ? i : -1)).filter((i) => i >= 0) })).filter((x) => x.s.length);
    opties.sort((a, b) => a.s.length - b.s.length || a.mid.localeCompare(b.mid));
    const marginaal = (i: number) => S[i].kw.reduce((a, q) => a + extra(S[i].dag, q, g[i] + 1) - extra(S[i].dag, q, g[i]), 0);
    for (const { mid, s } of opties) {
      let best = s[0];
      for (const i of s.slice(1)) {
        const d = marginaal(i) - marginaal(best);
        if (d < -EPS || (Math.abs(d) <= EPS && g[i] < g[best])) best = i;
      }
      g[best]++;
      groep.set(mid, best);
    }
    const tekort = S.reduce((a, x, i) => a + x.kw.reduce((b, q) => b + extra(x.dag, q, g[i]), 0), 0);
    const gebruikt = g.filter((n) => n > 0);
    const verschil = gebruikt.length ? Math.max(...gebruikt) - Math.min(...gebruikt) : 0;
    return { score: [doel.length - groep.size, tekort, verschil, S.reduce((a, x) => a + dagIndex.get(x.dag.datum)!, 0), S.reduce((a, x) => a + x.van, 0)], groep, g };
  };

  let S: Moment[] = [];
  for (let k = 0; k < Math.max(1, o.groepen) && momenten.length; k++) {
    let beste: Moment | null = null, bs: number[] | null = null;
    for (const m of momenten) {
      if (S.includes(m)) continue;
      const sc = beoordeel([...S, m]).score;
      if (!bs || vergelijk(sc, bs) < 0) { beste = m; bs = sc; }
    }
    if (!beste || bs![0] === Infinity) break;
    S.push(beste);
  }
  let huidig = beoordeel(S).score;
  for (let ronde = 0; ronde < 12 && S.length; ronde++) {
    let beter = false;
    for (let i = 0; i < S.length; i++) {
      for (const m of momenten) {
        if (S.includes(m)) continue;
        const T = S.map((x, j) => (j === i ? m : x));
        const sc = beoordeel(T).score;
        if (vergelijk(sc, huidig) < 0) { S = T; huidig = sc; beter = true; }
      }
    }
    if (!beter) break;
  }

  const { groep, g } = beoordeel(S);
  const volgorde = S.map((_, i) => i).filter((i) => g[i] > 0).sort((a, b) => dagIndex.get(S[a].dag.datum)! - dagIndex.get(S[b].dag.datum)! || S[a].van - S[b].van);

  // wie overblijft maar op een van de dagen werkt: de dienst verschuiven
  const verschoven: Verschuiving[] = [];
  const voorDag = new Map(dagen.map((d) => [d.datum, [...d.cov]]));
  const tekortOp = (dag: Dag, cov: number[], groot: number[]) => {
    const minder = cov.map(() => 0);
    S.forEach((x, i) => { if (x.dag === dag) for (const q of x.kw) minder[q] += groot[i]; });
    return dag.nodig.reduce((a, n, q) => a + Math.max(0, n - (cov[q] - minder[q])), 0);
  };
  if (o.verschuiven !== false) {
    const deltas = Array.from({ length: 64 }, (_, i) => (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 1) / 4);
    for (const mid of doel.filter((x) => !groep.has(x))) {
      const kandidaten: { i: number; y: NbdDienst; kost: number; delta: number }[] = [];
      for (const i of S.map((_, j) => j)) {
        const x = S[i], oud = x.dag.diensten.get(mid);
        if (!oud) continue;
        const k: Taak = { soort: 'maandstart', van: x.van, tot: x.tot };
        const zonderMij = [...x.dag.diensten.entries()].filter(([id]) => id !== mid).map(([, d]) => d);
        const voorKost = tekortOp(x.dag, x.dag.cov, g);
        const uren = o.profielen?.[mid]?.uren;
        const nietVoor = uren ? dienstTegenVoorkeur(uren, x.dag.datum, oud.start, oud.eind).niet : 0;
        for (const delta of deltas) {
          const y = schuifDienst(p, oud, delta);
          if (!y || !pastTaak(y, k)) continue;
          if (uren && dienstTegenVoorkeur(uren, x.dag.datum, y.start, y.eind).niet > nietVoor) continue;
          const groot = g.map((n, j) => (j === i ? n + 1 : n));
          kandidaten.push({ i, y, kost: tekortOp(x.dag, dekking(p, [...zonderMij, y]), groot) - voorKost, delta });
        }
      }
      kandidaten.sort((a, b) => a.kost - b.kost || Math.abs(a.delta) - Math.abs(b.delta));
      for (const c of kandidaten.slice(0, 12)) {
        const x = S[c.i];
        const t = nbdRuilToets({ team, cellen: o.cellen, tijden: o.tijden, wijzigingen: [[mid, x.dag.datum, 'N', c.y]], p, minVrijeWeekenden: o.minVrijeWeekenden ?? 0 });
        if (!t.ok) continue;
        verschoven.push({ mid, datum: x.dag.datum, was: x.dag.diensten.get(mid)!, wordt: c.y });
        x.dag.diensten.set(mid, c.y);
        x.dag.cov = dekking(p, [...x.dag.diensten.values()]);
        g[c.i]++;
        groep.set(mid, c.i);
        break;
      }
    }
  }

  const wijzigingen: NbdWijziging[] = [];
  const groepen: MaandstartGroep[] = volgorde.concat(S.map((_, i) => i).filter((i) => g[i] > 0 && !volgorde.includes(i))).map((i) => {
    const x = S[i];
    const leden = doel.filter((mid) => groep.get(mid) === i);
    const covNa = [...x.dag.cov];
    for (const q of x.kw) covNa[q] -= g[i];
    const covDag = [...x.dag.cov];
    S.forEach((y, j) => { if (y.dag === x.dag) for (const q of y.kw) covDag[q] -= g[j]; });
    for (const mid of leden) {
      const d = x.dag.diensten.get(mid)!;
      wijzigingen.push([mid, x.dag.datum, 'N', { ...d, taken: [...(d.taken ?? []), { soort: 'maandstart' as const, van: x.van, tot: x.tot }].sort((a, b) => a.van - b.van) }]);
    }
    const voor = voorDag.get(x.dag.datum)!;
    return {
      datum: x.dag.datum, van: x.van, tot: x.tot, leden: [...leden].sort((a, b) => naam(team, a).localeCompare(naam(team, b))),
      extraTekort: x.kw.reduce((a, q) => a + Math.max(0, x.dag.nodig[q] - covNa[q]) - Math.max(0, x.dag.nodig[q] - voor[q]), 0) / 4,
      slVoor: x.dag.dag ? dagServiceLevel(p, x.dag.dag, voor) : 1, slNa: x.dag.dag ? dagServiceLevel(p, x.dag.dag, covDag) : 1,
    };
  });
  const extraTekort = dagen.reduce((a, d) => {
    const voor = voorDag.get(d.datum)!;
    return a + (tekortOp(d, d.cov, g) - d.nodig.reduce((b, n, q) => b + Math.max(0, n - voor[q]), 0)) / 4;
  }, 0);
  return { groepen, aantal: doel.length, zonder: doel.filter((mid) => !groep.has(mid)), verschoven, wijzigingen, extraTekort };
}

const naam = (team: Medewerker[], mid: string) => team.find((m) => m.id === mid)?.naam ?? '';

export function alBijMaandstart(o: Pick<TakenInvoer, 'team' | 'cellen' | 'tijden'>, maandDagen: string[]): string[] {
  return o.team.filter((m) => maandDagen.some((d) => nbdDienst(o.cellen, o.tijden, m.id, d)?.taken?.some((k) => k.soort === 'maandstart'))).map((m) => m.id);
}

export function maandstartDagen(maandDagen: string[], vanaf: string, aantal = 7): string[] {
  const eerste = maandDagen[0];
  if (!eerste) return [];
  const eind = addDays(eerste, aantal - 1);
  return maandDagen.filter((d) => d >= vanaf && d <= eind);
}

interface Behoud {
  wijzigingen: NbdWijziging[];
  /** Geen dienst die dag, of niet binnen de nieuwe tijden. */
  kwijt: { mid: string; datum: string; taak: Taak }[];
  mee: number;
}

/** Na opnieuw roosteren de taken terug in de nieuwe dienst; een maandstart desnoods op een ander moment. */
export function behoudTaken(o: { team: Medewerker[]; dates: string[]; oudCellen: Cellen; oudTijden: Tijden | undefined; cellen: Cellen; tijden: Tijden | undefined }): Behoud {
  const diensten = new Map<string, NbdDienst>();
  const sleutel = (mid: string, d: string) => `${mid}|${d}`;
  const dienst = (mid: string, d: string) => diensten.get(sleutel(mid, d)) ?? nbdDienst(o.cellen, o.tijden, mid, d);
  const zelfde = (a: Taak, b: Taak) => a.soort === b.soort && Math.abs(a.van - b.van) < EPS && Math.abs(a.tot - b.tot) < EPS;
  /** false als het niet past; de pauze gaat zo nodig opzij. */
  const zet = (mid: string, d: string, k: Taak): boolean => {
    const x = dienst(mid, d);
    if (!x) return false;
    if ((x.taken ?? []).some((t) => zelfde(t, k))) return true;
    let y: NbdDienst = { ...x, taken: [...(x.taken ?? []), { ...k }].sort((a, b) => a.van - b.van) };
    if (k.van < y.start - EPS || k.tot > y.eind + EPS || (x.taken ?? []).some((t) => k.van < t.tot - EPS && k.tot > t.van + EPS)) return false;
    if (!pastTaak({ ...y, taken: x.taken }, k)) {
      const z = pauzeBuitenTaken(y);
      if (!z) return false;
      y = z;
    }
    diensten.set(sleutel(mid, d), y);
    return true;
  };
  const momenten: { datum: string; van: Uur; tot: Uur }[] = [];
  const kwijt: Behoud['kwijt'] = [];
  let mee = 0;
  for (const m of o.team) {
    for (const d of o.dates) {
      for (const k of nbdDienst(o.oudCellen, o.oudTijden, m.id, d)?.taken ?? []) {
        if (k.soort === 'maandstart' && !momenten.some((x) => x.datum === d && x.van === k.van && x.tot === k.tot)) momenten.push({ datum: d, van: k.van, tot: k.tot });
        if (zet(m.id, d, k)) mee++;
        else kwijt.push({ mid: m.id, datum: d, taak: k });
      }
    }
  }
  const rest: Behoud['kwijt'] = [];
  for (const x of kwijt) {
    if (x.taak.soort !== 'maandstart') { rest.push(x); continue; }
    const ander = momenten.find((mo) => zet(x.mid, mo.datum, { soort: 'maandstart', van: mo.van, tot: mo.tot }));
    if (ander) mee++; else rest.push(x);
  }
  const wijzigingen: NbdWijziging[] = [...diensten.entries()].map(([k, y]) => {
    const [mid, d] = k.split('|');
    return [mid, d, 'N', y];
  });
  return { wijzigingen, kwijt: rest, mee };
}
