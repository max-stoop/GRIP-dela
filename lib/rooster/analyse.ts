/**
 * Roosteranalyse volgens de vierledige doelstelling: continuïteit, efficiency, medewerker- en klanttevredenheid.
 * Elke score komt met de cijfers waar hij uit volgt.
 */
import { toDay, weekday, weekIndex, isWeekend } from '../dates';
import { poissonCdf } from '../model/poisson';
import { DIENSTEN, afwezigVoorNorm, isEnkel, wensGehonoreerd } from './diensten';
import { dagVoorkeurOp, type Beleid, type BehoefteBron, type DagBehoefte, type DienstCode, type Medewerker, type Voorkeurprofiel, type WensSoort } from './types';

export interface MwContext {
  e: Medewerker;
  profiel: Voorkeurprofiel | null;
  /** Index in de periode → wens. */
  wensen: Map<number, WensSoort>;
  /** Weekdag (0 = zondag) en doorlopend weeknummer per dag in de periode. */
  wd: number[];
  week: number[];
  weekend: boolean[];
  beleid: Beleid;
}

export interface MwDetails {
  wensen: { ok: number; tot: number };
  patroon: { graag: number; lieverNiet: number; niet: number; actief: boolean };
  dienst: { mis: number; tot: number };
  uren: { gepland: number; norm: number; verlofDagen: number; ziekDagen: number };
  ritme: { overMax: number; losse: number; lang: number; terug: number; weken: number };
  weekenden: number;
  /** Meeste regelplekken in één weekend. */
  weekendPlekken: number;
  beschikbaar: number;
  twee: number;
  /** 1M-diensten. */
  middag: number;
  /** Dossiergebonden dagen. */
  dg: number;
  werkdagen: number;
}

export interface MwScore {
  score: number;
  delen: { wensen: number | null; patroon: number | null; dienst: number; uren: number; ritme: number };
  details: MwDetails;
}

export const MW_GEWICHT = { wensen: 0.3, patroon: 0.2, dienst: 0.15, uren: 0.2, ritme: 0.15 };

export function maakContext(e: Medewerker, profiel: Voorkeurprofiel | null, wensen: { datum: string; soort: WensSoort }[], dates: string[], beleid: Beleid): MwContext {
  const idx = new Map(dates.map((d, i) => [d, i]));
  const w = new Map<number, WensSoort>();
  for (const x of wensen) { const i = idx.get(x.datum); if (i != null) w.set(i, x.soort); }
  const days = dates.map(toDay);
  return { e, profiel, wensen: w, wd: days.map(weekday), week: days.map(weekIndex), weekend: days.map(isWeekend), beleid };
}

/** Uit het profiel als ingevuld, anders van de medewerker. */
export function dienstVoorkeur(e: Medewerker, p: Voorkeurprofiel | null): 'O' | 'M' | null {
  if (p?.dienst === 'ochtend') return 'O';
  if (p?.dienst === 'middag') return 'M';
  // zelf "geen voorkeur" opgegeven: dan telt ochtend of middag niet mee
  if (p && p.bijgewerkt && p.dienst === 'geen') return null;
  return e.voorkeur ?? null;
}

/** Late dienst (eind 19:00) gevolgd door een vroege: tegen de voorwaartse rotatie in. */
function terugwaarts(a: DienstCode, b: DienstCode): boolean {
  const x = DIENSTEN[a], y = DIENSTEN[b];
  return x.werk && y.werk && x.eind != null && y.start != null && x.eind >= 19 && y.start <= 9;
}

/** 0..1 over de periode; codes is de dienst per dag. */
export function medewerkerScore(ctx: MwContext, codes: DienstCode[]): MwScore {
  const { e, profiel: p, wensen, wd, week, weekend } = ctx;
  const n = codes.length;
  let h = 0, v = 0, z = 0, werkdagen = 0, wOk = 0, wTot = 0, graag = 0, lieverNiet = 0, niet = 0, mis = 0, dTot = 0, b1 = 0, twee = 0, terug = 0, dg = 0, middag = 0;
  const pref = dienstVoorkeur(e, p);
  const weekendWeken = new Map<number, number>();
  const perWeek = new Map<number, number>();
  let lang = 0, losse = 0, reeks = 0;
  for (let i = 0; i < n; i++) {
    const c = codes[i], def = DIENSTEN[c];
    h += def.uren;
    // alleen wat de norm verlaagt: verlof op werkdagen, ziekte op elke dag met een dienst
    if (c === 'V' && afwezigVoorNorm(c, weekend[i])) v++;
    if (c === 'Z') z++;
    if (def.werk) {
      werkdagen++;
      perWeek.set(week[i], (perWeek.get(week[i]) ?? 0) + 1);
      if (weekend[i]) weekendWeken.set(week[i], (weekendWeken.get(week[i]) ?? 0) + def.plekken);
      if (p) {
        const dv = dagVoorkeurOp(p.dagen[wd[i]], wensen.get(i));
        if (dv === 'graag') graag++;
        else if (dv === 'liever_niet') lieverNiet++;
        else if (dv === 'niet') niet++;
      }
      if (isEnkel(c)) {
        dTot++;
        if ((c === '1' && pref === 'M') || (c === '1M' && pref === 'O')) mis++;
      }
      if (c === '1B') {
        b1++;
      }
      if (c === '2') twee++;
      if (c === '1M') middag++;
      if (def.categorie === 'dossier') dg++;
      if (i > 0 && terugwaarts(codes[i - 1], c)) terug++;
      reeks++;
      if (reeks === 6) lang++;
      const vorige = i > 0 ? DIENSTEN[codes[i - 1]].werk : true, volgende = i < n - 1 ? DIENSTEN[codes[i + 1]].werk : true;
      if (!vorige && !volgende) losse++;
    } else reeks = 0;
    const w = wensen.get(i);
    if (w) {
      const ok = wensGehonoreerd(w, c);
      if (ok != null) { wTot++; if (ok) wOk++; }
    }
  }
  const max = p?.maxDagenPerWeek ?? null;
  let overMax = 0;
  if (max != null) for (const k of perWeek.values()) if (k > max) overMax += k - max;
  const weken = Math.max(1, n / 7);
  const norm = Math.max(0, (e.contract * n) / 7 - ((v + z) * e.contract) / 5);

  const patroonActief = !!p && p.dagen.some((d) => d !== 'neutraal');
  const delen = {
    wensen: wTot ? wOk / wTot : null,
    patroon: patroonActief ? 1 - Math.min(1, (lieverNiet + 3 * niet) / Math.max(1, werkdagen)) : null,
    dienst: dTot ? 1 - mis / dTot : 1,
    uren: norm > 0 ? 1 - Math.min(1, Math.abs(h - norm) / (0.25 * norm)) : h === 0 ? 1 : 0,
    ritme: 1 - Math.min(1, (overMax * 0.5 + losse * 0.25 + lang * 0.5 + terug * 0.25) / weken),
  };
  let som = 0, gew = 0;
  for (const [k, g] of Object.entries(MW_GEWICHT) as [keyof typeof MW_GEWICHT, number][]) {
    const s = delen[k];
    if (s == null) continue;
    som += g * s;
    gew += g;
  }
  return {
    score: gew ? som / gew : 1,
    delen,
    details: {
      wensen: { ok: wOk, tot: wTot },
      patroon: { graag, lieverNiet, niet, actief: patroonActief },
      dienst: { mis, tot: dTot },
      uren: { gepland: h, norm, verlofDagen: v, ziekDagen: z },
      ritme: { overMax, losse, lang, terug, weken: Math.round(weken) },
      weekenden: weekendWeken.size,
      weekendPlekken: Math.max(0, ...weekendWeken.values()),
      beschikbaar: b1,
      dg,
      twee,
      middag,
      werkdagen,
    },
  };
}

/** Per contracturen: hoe gelijk zijn weekenden, 1B's en 2-diensten verdeeld. */
export function eerlijkheid(team: Medewerker[], details: MwDetails[]): { score: number; spreiding: { weekenden: number; beschikbaar: number; twee: number; dg: number } } {
  const cv = (vals: number[]) => {
    const m = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    if (m <= 0.001) return 0;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, vals.length));
    return sd / m;
  };
  // alleen uitvaartverzorgers doen regelplekken en beschikbaarheid
  const uv = team.map((e, i) => [e, details[i]] as const).filter(([e]) => e.functie !== 'UL');
  const fte = uv.map(([e]) => Math.max(0.3, e.contract / 36));
  const per = (f: (d: MwDetails) => number) => uv.map(([, d], i) => f(d) / fte[i]);
  // Dg als aandeel van de werkdagen: wie meer werkt, doet ook meer Dg
  const dgAandeel = uv.map(([, d]) => (d.werkdagen ? d.dg / d.werkdagen : 0));
  const spreiding = { weekenden: cv(per((d) => d.weekenden)), beschikbaar: cv(per((d) => d.beschikbaar)), twee: cv(per((d) => d.twee)), dg: cv(dgAandeel) };
  const actief = Object.values(spreiding).filter((x) => x > 0);
  const gem = actief.length ? actief.reduce((a, b) => a + b, 0) / actief.length : 0;
  return { score: 1 - Math.min(1, gem), spreiding };
}

export interface DagAnalyse {
  datum: string;
  /** Inclusief 1B. */
  p: number;
  b: number;
  k: number | null;
  kNorm: number | null;
  lam: number | null;
  bron: BehoefteBron | null;
  /** Afgesproken in het cluster (zit al in k). */
  verschoven: number;
  /** Kans dat alle meldingen van de dag passen. */
  cov: number | null;
}

export function dagAnalyse(datum: string, p: number, b: number, need: DagBehoefte | null): DagAnalyse {
  return {
    datum, p, b,
    k: need?.k ?? null,
    kNorm: need?.kNorm ?? null,
    lam: need?.lam ?? null,
    bron: need?.bron ?? null,
    verschoven: need?.verschoven ?? 0,
    // een plek die een andere regio in het cluster voor ons doet, dekt onze meldingen; een plek die wij voor een
    // ander doen niet
    cov: need ? poissonCdf(Math.max(0, p - (need.verschoven ?? 0)), need.lam) : null,
  };
}

export interface Continuiteit {
  score: number;
  /** Dekking (0..1) en naleving van wet en beleid (0..1). */
  dekking: number;
  naleving: number;
  dagen: number;
  gedekt: number;
  gemKans: number | null;
  risico: DagAnalyse[];
}

export function continuiteit(dagen: DagAnalyse[], beleid: Beleid, beleidItems: number): Continuiteit {
  const met = dagen.filter((d) => d.k != null && d.lam != null);
  let som = 0, kans = 0, gedekt = 0;
  for (const d of met) {
    const r = Math.min(d.cov!, beleid.alphaRegio) / beleid.alphaRegio;
    som += d.p >= d.k! ? Math.max(r, 0.95) : r;
    kans += d.cov!;
    if (d.p >= d.k!) gedekt++;
  }
  const risico = met.filter((d) => d.p < d.k! || d.cov! < beleid.alphaRegio - 0.1).sort((a, b) => a.cov! - b.cov!);
  const dekking = met.length ? som / met.length : 0;
  const naleving = Math.exp(-0.04 * beleidItems);
  return {
    score: met.length ? 0.7 * dekking + 0.3 * naleving : 0,
    dekking, naleving,
    dagen: met.length,
    gedekt,
    gemKans: met.length ? kans / met.length : null,
    risico,
  };
}

export interface Efficiency {
  score: number;
  surplus: number;
  tekort: number;
  nodig: number;
  /** Boven het afgesproken aantal per dag. */
  extraB: number;
  /** Uren volgens de norm (borging) en gepland voor dossiergebonden werk en regelplekken. */
  urenNorm: number;
  urenGepland: number;
  verhouding: number;
  /** Gepland / contract na verlof en ziekte. */
  benutting: number;
  urenContract: number;
  urenTotaal: number;
}

/** Niet meer plekken en 1B's dan afgesproken, geen uren boven het contract, geen onbenutte uren bij een tekort. */
export function efficiency(dagen: (DagAnalyse & { voorgangen: number; dg: number; zondag: boolean })[], uren: { gepland: number; contract: number; dossierRegel: number }, beleid: Beleid): Efficiency {
  let surplus = 0, tekort = 0, nodig = 0, extraB = 0, urenNorm = 0;
  for (const d of dagen) {
    extraB += Math.max(0, d.b - beleid.beschikbaarPerDag);
    if (!d.zondag) urenNorm += beleid.voorgangenPerDag * DIENSTEN.DG1.uren;
    if (d.k == null) continue;
    surplus += Math.max(0, d.p - d.k);
    tekort += Math.max(0, d.k - d.p);
    nodig += d.k;
    const nb = Math.min(beleid.beschikbaarPerDag, d.k);
    urenNorm += (d.k - nb) * DIENSTEN['1'].uren + nb * DIENSTEN['1B'].uren;
  }
  const verhouding = urenNorm > 0 ? uren.dossierRegel / urenNorm : 1;
  const benutting = uren.contract > 0 ? uren.gepland / uren.contract : 1;
  const sPlek = 1 - Math.min(1, (3 * surplus) / Math.max(1, nodig));
  const sB = 1 - Math.min(1, (2 * extraB) / Math.max(1, dagen.length));
  // uren boven het contract kosten extra; uren die onbenut blijven terwijl er plekken tekort zijn ook.
  // Uren boven de norm binnen het contract zijn ruimte in de formatie, geen extra kosten (zie Capaciteit).
  const onbenut = tekort > 0 ? 0.5 * Math.min(1, Math.max(0, 0.9 - benutting) * 5) : 0;
  const sUren = Math.max(0, 1 - Math.min(1, Math.max(0, benutting - 1) * 4) - onbenut);
  return {
    score: 0.5 * sPlek + 0.2 * sB + 0.3 * sUren,
    surplus, tekort, nodig, extraB, urenNorm, urenGepland: uren.dossierRegel, verhouding, benutting,
    urenContract: uren.contract, urenTotaal: uren.gepland,
  };
}

export interface Klant {
  score: number;
  /** Verwacht aandeel meldingen dat op de dag zelf een regelgesprek krijgt. */
  zelfdeDag: number | null;
  /** De dag zelf of de volgende dag. */
  binnen24: number | null;
  laat: number;
  meldingen: number;
}

function pmf(lam: number, max: number): number[] {
  const out = new Array(max + 1).fill(0);
  let p = Math.exp(-lam);
  out[0] = p;
  for (let k = 1; k <= max; k++) { p *= lam / k; out[k] = p; }
  return out;
}

/** Meldingen die niet op de dag passen, schuiven naar de volgende dag als daar plekken over zijn. */
export function klant(dagen: DagAnalyse[]): Klant {
  let lamTot = 0, overTot = 0, laat = 0;
  for (let i = 0; i < dagen.length; i++) {
    const d = dagen[i];
    if (d.lam == null) continue;
    const max = Math.ceil(d.lam + 10 * Math.sqrt(d.lam) + 20);
    const px = pmf(d.lam, max);
    // overloop vandaag: U = max(0, X - p)
    const u = new Array(max + 1).fill(0);
    for (let x = 0; x <= max; x++) u[Math.max(0, x - d.p)] += px[x];
    const eu = u.reduce((s, p, k) => s + p * k, 0);
    // ruimte morgen: S = max(0, p' - X')
    const m = dagen[i + 1];
    let el = eu;
    if (m && m.lam != null) {
      const py = pmf(m.lam, m.p);
      const s = new Array(m.p + 1).fill(0);
      let rest = 1;
      for (let y = 0; y < m.p; y++) { s[m.p - y] += py[y]; rest -= py[y]; }
      s[0] += Math.max(0, rest);
      el = 0;
      for (let k = 1; k <= max; k++) {
        if (u[k] < 1e-12) continue;
        for (let r = 0; r < s.length && r < k; r++) el += u[k] * s[r] * (k - r);
      }
    }
    lamTot += d.lam;
    overTot += eu;
    laat += el;
  }
  if (!lamTot) return { score: 0, zelfdeDag: null, binnen24: null, laat: 0, meldingen: 0 };
  const zelfdeDag = 1 - overTot / lamTot, binnen24 = 1 - laat / lamTot;
  // bij de afgesproken plekken (80%) krijgt zo'n 93% een gesprek op de dag zelf en is zo'n 97,5% binnen
  // 24 uur geholpen; dat scoort rond de 0,9. Minder plekken zakt snel weg.
  const schaal = (x: number, laag: number, hoog: number) => Math.max(0, Math.min(1, (x - laag) / (hoog - laag)));
  const sZelf = schaal(zelfdeDag, 0.8, 0.95);
  const s24 = schaal(binnen24, 0.9, 0.985);
  return { score: 0.4 * sZelf + 0.6 * s24, zelfdeDag, binnen24, laat, meldingen: lamTot };
}
