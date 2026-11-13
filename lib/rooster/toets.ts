/**
 * Toets van een rooster tegen ATW en CAO (hard), het roosterbeleid en teamafspraken, met een cijfer uit de vierledige
 * doelstelling. Pure functies: dezelfde toets draait in het rooster, de ruiltoets en bij AI-voorstellen.
 */
import { toDay, fromDay, weekday, weekIndex, isWeekend, isoWeek, mondayOf, year } from '../dates';
import { DIENSTEN, isEnkel, magFunctie, afwezigVoorNorm } from './diensten';
import { continuiteit, dagAnalyse, eerlijkheid, efficiency, klant, maakContext, medewerkerScore, type Continuiteit, type DagAnalyse, type Efficiency, type Klant, type MwScore } from './analyse';
import { weekendCadans, type Behoefte, type Beleid, type Cellen, type DienstCode, type Medewerker, type Tijd, type Tijden, type Voorkeurprofiel, type Wens } from './types';

export const cel = (c: Cellen, mid: string, d: string): DienstCode => c[mid]?.[d] ?? '-';

/** De vastgelegde tijd, anders de standaardtijd van de dienst. */
export function tijdVan(code: DienstCode, vast?: Tijd): Tijd | null {
  if (vast && (!vast.code || vast.code === code)) return vast;
  const d = DIENSTEN[code];
  return d.start != null && d.eind != null ? { start: d.start, eind: d.eind } : null;
}

export type Niveau = 'ATW en CAO' | 'Roosterbeleid' | 'Teamafspraak';

export type RegelId =
  | 'rust' | 'dagduur' | 'achtereen' | 'beschikbaar28' | 'weekenden26'
  | 'tekort' | 'teveel' | 'minimum' | 'middag' | 'beschikbaar' | 'dg' | 'dgzondag' | 'voorgangen' | 'twee'
  | 'weekendplekken' | 'contract' | 'functie' | 'overigvakantie' | 'omhetweekend';

interface RegelDef {
  niveau: Niveau;
  paragraaf: string;
  /** Voor bij een cel of in een ruiltoets. */
  kort: string;
}

export const REGELS: Record<RegelId, RegelDef> = {
  rust: { niveau: 'ATW en CAO', paragraaf: '1.3', kort: 'te weinig rust tussen diensten' },
  dagduur: { niveau: 'ATW en CAO', paragraaf: '1.3', kort: 'dienst langer dan 12 uur' },
  achtereen: { niveau: 'ATW en CAO', paragraaf: '1.3', kort: 'te veel diensten achter elkaar' },
  beschikbaar28: { niveau: 'ATW en CAO', paragraaf: '1.2', kort: 'te veel beschikbaarheidsdiensten in 28 dagen' },
  weekenden26: { niveau: 'ATW en CAO', paragraaf: '1.4', kort: 'minder dan 26 vrije weekenden dit jaar' },
  tekort: { niveau: 'Roosterbeleid', paragraaf: '3.1', kort: 'minder regelplekken dan afgesproken' },
  teveel: { niveau: 'Roosterbeleid', paragraaf: '3.1', kort: 'meer regelplekken dan afgesproken' },
  middag: { niveau: 'Roosterbeleid', paragraaf: '3.2', kort: 'geen middag/avonddienst' },
  minimum: { niveau: 'Teamafspraak', paragraaf: '—', kort: 'te weinig medewerkers' },
  beschikbaar: { niveau: 'Roosterbeleid', paragraaf: '3.2', kort: 'geen beschikbaarheidsdienst' },
  dg: { niveau: 'Roosterbeleid', paragraaf: '3.3', kort: 'te weinig Dg-diensten' },
  dgzondag: { niveau: 'Roosterbeleid', paragraaf: '3.3', kort: 'Dg-dienst op zondag' },
  voorgangen: { niveau: 'Roosterbeleid', paragraaf: '3.3', kort: 'te weinig voorgaansplekken' },
  twee: { niveau: 'Roosterbeleid', paragraaf: '3.1', kort: 'te veel keer een 2' },
  weekendplekken: { niveau: 'Roosterbeleid', paragraaf: '3.1', kort: 'meer dan 3 regelplekken in een weekend' },
  contract: { niveau: 'Roosterbeleid', paragraaf: '3.6', kort: 'meer uren dan het contract' },
  functie: { niveau: 'Roosterbeleid', paragraaf: '3.3', kort: 'uitvaartleider op een regeldienst' },
  overigvakantie: { niveau: 'Roosterbeleid', paragraaf: '4.2', kort: 'overige dienst in de schoolvakantie' },
  omhetweekend: { niveau: 'Teamafspraak', paragraaf: '—', kort: 'twee weekenden achter elkaar' },
};

export interface Overtreding {
  mid: string;
  datum: string;
  regel: RegelId;
}

export interface Check {
  id: RegelId;
  naam: string;
  niveau: Niveau;
  paragraaf: string;
  /** Datums (ISO) of omschrijvingen. */
  items: string[];
}

export interface DagStand extends DagAnalyse {
  middag: number;
  /** Dg-diensten en voorgaansplekken. */
  dg: number;
  voorgangen: number;
  twee: number;
  /** 1 en 1M. */
  enkel: number;
  zondag: boolean;
}

export interface Uren {
  gepland: number;
  norm: number;
  verlofDagen: number;
}

export interface Tevredenheid {
  score: number;
  gemiddeld: number;
  eerlijkheid: number;
  spreiding: { weekenden: number; beschikbaar: number; twee: number };
  perMedewerker: Record<string, MwScore>;
}

export interface Toets {
  checks: Check[];
  pijlers: { continuiteit: Continuiteit; efficiency: Efficiency; medewerker: Tevredenheid; klant: Klant };
  /** 0..1 */
  sub: { cont: number; eff: number; mw: number; klant: number };
  cijfer: number;
  status: ['ok' | 'warn' | 'bad', string];
  perDag: DagStand[];
  /** ATW en CAO: `${mid}|${datum}`. */
  fout: Set<string>;
  /** Beleid of teamafspraak. */
  aandacht: Set<string>;
  overtredingen: Overtreding[];
  surplus: number;
  gepland: number;
  nodig: number;
  /** ATW en CAO. */
  hard: number;
  beleid: number;
  uren: Record<string, Uren>;
  wensen: { totaal: number; gehonoreerd: number };
}

/**
 * Dagen met minder regelplekken dan afgesproken. Ernstig (zoals het advies rood): een dag met 2 of meer te weinig, of 3
 * of meer dagen met een tekort. Dagen voor vanaf tellen niet.
 */
export function tekortStand(perDag: Pick<DagAnalyse, 'datum' | 'p' | 'k'>[], vanaf?: string) {
  const dagen = perDag.filter((d) => d.k != null && (!vanaf || d.datum >= vanaf));
  const tekort = dagen.filter((d) => d.p < d.k!);
  const groot = tekort.filter((d) => d.k! - d.p >= 2);
  return { tekort, groot, ernstig: groot.length > 0 || tekort.length >= 3 };
}

/** CAO: voor hoogstens zoveel van de vrije weekenden per jaar mogen zondag en maandag vrij zijn in plaats van zaterdag en zondag. */
export const MAX_ZONDAG_MAANDAG = 13;

/** Zaterdag van een doorlopende week (weekIndex). */
const zaterdagVan = (w: number) => w * 7 + 2;

/**
 * De weekenden (doorlopende weken, oplopend) in een kalenderjaar die volgens de CAO niet vrij zijn: op zaterdag of
 * zondag gewerkt, tenzij zondag en maandag vrij zijn; dat telt voor hoogstens 13 weekenden als vrij weekend (§ 1.4).
 */
export function nietVrijeWeekenden(eigen: Record<string, DienstCode>, jaar: number): number[] {
  const begin = toDay(`${jaar}-01-01`), eind = toDay(`${jaar}-12-31`);
  const werkt = (d: number) => DIENSTEN[eigen[fromDay(d)] ?? '-'].werk;
  const weken = new Set<number>();
  for (const [d, c] of Object.entries(eigen)) {
    const n = toDay(d);
    if (n >= begin && n <= eind && isWeekend(n) && DIENSTEN[c].werk) weken.add(weekIndex(n));
  }
  let zoMa = MAX_ZONDAG_MAANDAG;
  const uit: number[] = [];
  for (const w of [...weken].sort((a, b) => a - b)) {
    const za = zaterdagVan(w);
    if (zoMa > 0 && !werkt(za + 1) && !werkt(za + 2)) { zoMa--; continue; }
    uit.push(w);
  }
  return uit;
}

/** cellen mag datums buiten de periode bevatten; die tellen mee als aanloop en voor het jaartotaal. */
export function celOvertredingen(team: Medewerker[], cellen: Cellen, dates: string[], beleid: Beleid, tijden?: Tijden): Overtreding[] {
  if (!dates.length) return [];
  const out: Overtreding[] = [];
  const first = toDay(dates[0]), last = toDay(dates[dates.length - 1]);
  const inPeriode = (d: number) => d >= first && d <= last;
  const maxWerkWeekenden = 52 - beleid.minVrijeWeekenden;
  for (const e of team) {
    const own = cellen[e.id] ?? {};
    const code = (d: number) => own[fromDay(d)] ?? '-';
    let run = 0;
    const weekenden = new Set<number>();
    const weekendPlek = new Map<number, number>();
    for (let d = first - 28; d <= last; d++) {
      const s = code(d), def = DIENSTEN[s];
      if (def.werk) {
        run++;
        if (inPeriode(d)) {
          if (run > beleid.maxAchtereen) out.push({ mid: e.id, datum: fromDay(d), regel: 'achtereen' });
          // rust tussen het eind van gisteren en het begin van vandaag, met de vastgelegde tijden als die er zijn
          const t = tijdVan(s, tijden?.[e.id]?.[fromDay(d)]), tp = tijdVan(code(d - 1), tijden?.[e.id]?.[fromDay(d - 1)]);
          if (tp && t && DIENSTEN[code(d - 1)].werk && 24 - tp.eind + t.start < beleid.minRustUren) {
            out.push({ mid: e.id, datum: fromDay(d), regel: 'rust' });
          }
          if (t && t.eind - t.start > beleid.maxDagUren) out.push({ mid: e.id, datum: fromDay(d), regel: 'dagduur' });
          if (!magFunctie(e.functie, s)) out.push({ mid: e.id, datum: fromDay(d), regel: 'functie' });
          if (s === '1B') {
            let n = 0;
            for (let j = d - 27; j <= d; j++) if (code(j) === '1B') n++;
            if (n > beleid.maxBeschikbaarPer28) out.push({ mid: e.id, datum: fromDay(d), regel: 'beschikbaar28' });
          }
        }
        if (isWeekend(d)) {
          const w = weekIndex(d);
          weekenden.add(w);
          weekendPlek.set(w, (weekendPlek.get(w) ?? 0) + def.plekken);
        }
      } else run = 0;
    }
    const weekendDagen = (w: number) => { const zat = zaterdagVan(w); return [zat, zat + 1]; };
    for (const [w, n] of weekendPlek) {
      if (n <= beleid.maxWeekendPlekken) continue;
      for (const d of weekendDagen(w)) if (inPeriode(d) && DIENSTEN[code(d)].plekken) out.push({ mid: e.id, datum: fromDay(d), regel: 'weekendplekken' });
    }
    // wie elk weekend werkt (cadans 1), werkt bewust twee weekenden achter elkaar
    if (beleid.omHetWeekend && weekendCadans(e) > 1) {
      for (const w of weekenden) {
        if (!weekenden.has(w + 1)) continue;
        for (const d of weekendDagen(w + 1)) if (inPeriode(d) && DIENSTEN[code(d)].werk) out.push({ mid: e.id, datum: fromDay(d), regel: 'omhetweekend' });
      }
    }
    // CAO: minimaal 26 weekenden per kalenderjaar vrij (tenzij afstandsverklaring). Van een collega kent een medewerker
    // de afstandsverklaring niet (privé); dan toetst de planner het bij het goedkeuren van de ruil
    if (!e.afstandsverklaring && !e.collega) {
      for (let y = year(first); y <= year(last); y++) {
        const nietVrij = nietVrijeWeekenden(own, y);
        if (nietVrij.length <= maxWerkWeekenden) continue;
        for (const w of nietVrij.slice(maxWerkWeekenden)) for (const d of weekendDagen(w)) if (inPeriode(d) && DIENSTEN[code(d)].werk) out.push({ mid: e.id, datum: fromDay(d), regel: 'weekenden26' });
      }
    }
  }
  return out;
}

export function toets(opts: {
  team: Medewerker[];
  dates: string[];
  cellen: Cellen;
  behoefte: Behoefte;
  wensen: Wens[];
  beleid: Beleid;
  profielen?: Record<string, Voorkeurprofiel>;
  /** Voor rust en dagduur. */
  tijden?: Tijden;
  /** § 4.2 */
  schoolvakantie?: (datum: string) => boolean;
}): Toets {
  const { team, dates, cellen, behoefte, wensen, beleid } = opts;
  const profielen = opts.profielen ?? {};
  const fout = new Set<string>(), aandacht = new Set<string>();
  const dag: Record<'tekort' | 'teveel' | 'minimum' | 'middag' | 'beschikbaar' | 'dg' | 'dgzondag' | 'voorgangen' | 'twee', string[]> = {
    tekort: [], teveel: [], minimum: [], middag: [], beschikbaar: [], dg: [], dgzondag: [], voorgangen: [], twee: [],
  };

  const perDag: DagStand[] = dates.map((d) => {
    let p = 0, b = 0, n1m = 0, ndg = 0, vg = 0, n2 = 0, enkel = 0, nw = 0;
    for (const e of team) {
      const s = cel(cellen, e.id, d), def = DIENSTEN[s];
      p += def.plekken;
      if (s === '1B') b++;
      if (s === '1M') n1m++;
      if (def.categorie === 'dossier') { ndg++; vg += def.voorgangen; }
      if (s === '2') n2++;
      if (isEnkel(s)) enkel++;
      if (def.werk) nw++;
    }
    const need = behoefte[d] ?? null;
    const a = dagAnalyse(d, p, b, need);
    const zondag = weekday(toDay(d)) === 0;
    if (need) {
      if (p < need.k) dag.tekort.push(d);
      if (beleid.exactePlekken && p > need.k) dag.teveel.push(d);
    }
    if (p > 0 && n1m < beleid.minMiddag) dag.middag.push(d);
    if (beleid.minMedewerkers > 0 && nw < beleid.minMedewerkers) dag.minimum.push(d);
    if ((p > 0 || need) && b < Math.min(beleid.beschikbaarPerDag, need?.k ?? beleid.beschikbaarPerDag)) dag.beschikbaar.push(d);
    if (!zondag && ndg < beleid.minDG) dag.dg.push(d);
    if (zondag && ndg > 0) dag.dgzondag.push(d);
    if (!zondag && vg < beleid.voorgangenPerDag) dag.voorgangen.push(d);
    if (n2 > beleid.maxTwee || (n2 > 0 && enkel < beleid.minEnkelBijTwee)) dag.twee.push(d);
    return { ...a, middag: n1m, dg: ndg, voorgangen: vg, twee: n2, enkel, zondag };
  });

  const overtredingen = celOvertredingen(team, cellen, dates, beleid, opts.tijden);
  // § 4.2: geen planbare overige diensten in de schoolvakanties (behalve het opleiden van nieuwe medewerkers)
  const overigVakantie: string[] = [];
  if (beleid.geenOverigInVakantie && opts.schoolvakantie) {
    for (const d of dates) {
      if (!opts.schoolvakantie(d)) continue;
      for (const e of team) {
        if (DIENSTEN[cel(cellen, e.id, d)].categorie !== 'overig') continue;
        overigVakantie.push(`${e.naam}, ${d}`);
        aandacht.add(`${e.id}|${d}`);
      }
    }
  }
  const naam = Object.fromEntries(team.map((e) => [e.id, e.naam]));
  for (const o of overtredingen) (REGELS[o.regel].niveau === 'ATW en CAO' ? fout : aandacht).add(`${o.mid}|${o.datum}`);
  const per = (r: RegelId) => overtredingen.filter((o) => o.regel === r);
  const uniek = (r: RegelId, f: (o: Overtreding) => string) => [...new Set(per(r).map(f))];
  const weekendTekst = (o: Overtreding) => `${naam[o.mid]}, weekend week ${isoWeek(toDay(o.datum))}`;

  const contract: string[] = [];
  if (beleid.maxContract) {
    const weken = [...new Set(dates.map((d) => mondayOf(toDay(d))))];
    // om de regelplekken te borgen mag iemand boven zijn contract: per week hoogstens één dienst extra en over de
    // periode hoogstens het percentage uit het beleid (15% is 28 uur die 32 uur wordt). Pas daarboven is het een afwijking.
    const pct = beleid.bovenContractPct ?? 0;
    for (const e of team) {
      let gepland = 0, weg = 0;
      for (const d of dates) {
        const c = cel(cellen, e.id, d);
        gepland += DIENSTEN[c].uren;
        if (afwezigVoorNorm(c, isWeekend(toDay(d)))) weg++;
      }
      const binnenGrens = pct > 0 && gepland <= ((e.contract * dates.length) / 7 - (weg * e.contract) / 5) * (1 + pct / 100) + 0.01;
      for (const m of weken) {
        let h = 0;
        for (let i = 0; i < 7; i++) h += DIENSTEN[cel(cellen, e.id, fromDay(m + i))].uren;
        if (h > e.contract + 0.01 && !binnenGrens) {
          contract.push(`${naam[e.id]}, week ${isoWeek(m)}: ${Math.round(h * 10) / 10} uur (contract ${e.contract})`);
          for (let i = 0; i < 7; i++) if (DIENSTEN[cel(cellen, e.id, fromDay(m + i))].werk) aandacht.add(`${e.id}|${fromDay(m + i)}`);
        }
      }
    }
  }

  const perMedewerker: Record<string, MwScore> = {};
  const uren: Record<string, Uren> = {};
  let wensTot = 0, wensOk = 0, urenGepland = 0, urenContract = 0, urenWerk = 0;
  for (const e of team) {
    const ctx = maakContext(e, profielen[e.id] ?? null, wensen.filter((w) => w.medewerkerId === e.id), dates, beleid);
    const rij = dates.map((d) => cel(cellen, e.id, d));
    const sc = medewerkerScore(ctx, rij);
    uren[e.id] = { gepland: sc.details.uren.gepland, norm: sc.details.uren.norm, verlofDagen: sc.details.uren.verlofDagen };
    // externen (ZZP) tellen mee in de dekking, maar niet in de tevredenheid en de benutting van de formatie
    if (e.extern) continue;
    perMedewerker[e.id] = sc;
    wensTot += sc.details.wensen.tot;
    wensOk += sc.details.wensen.ok;
    urenGepland += sc.details.uren.gepland;
    urenContract += sc.details.uren.norm;
    for (const s of rij) if (['regel', 'beschikbaar', 'dossier'].includes(DIENSTEN[s].categorie)) urenWerk += DIENSTEN[s].uren;
  }
  const mwLijst = team.filter((e) => !e.extern).map((e) => perMedewerker[e.id]);
  const gemiddeld = mwLijst.length ? mwLijst.reduce((a, m) => a + m.score, 0) / mwLijst.length : 0;
  const eerlijk = eerlijkheid(team.filter((e) => !e.extern), mwLijst.map((m) => m.details));
  const medewerker: Tevredenheid = {
    score: mwLijst.length ? 0.75 * gemiddeld + 0.25 * eerlijk.score : 0,
    gemiddeld,
    eerlijkheid: eerlijk.score,
    spreiding: eerlijk.spreiding,
    perMedewerker,
  };

  const R = (id: RegelId, naamTekst: string, items: string[]): Check => ({ id, naam: naamTekst, niveau: REGELS[id].niveau, paragraaf: REGELS[id].paragraaf, items });
  const een = (n: number) => (n === 1 ? 'één' : String(n));
  const checks: Check[] = [
    R('rust', `Minimaal ${beleid.minRustUren} uur rust tussen twee diensten`, per('rust').map((o) => o.datum)),
    R('dagduur', `Een dienst duurt maximaal ${beleid.maxDagUren} uur`, uniek('dagduur', (o) => `${naam[o.mid]}, ${o.datum}`)),
    R('achtereen', `Wekelijkse rust: maximaal ${beleid.maxAchtereen} diensten achter elkaar`, per('achtereen').map((o) => o.datum)),
    R('beschikbaar28', `Maximaal ${beleid.maxBeschikbaarPer28} beschikbaarheidsdiensten per 28 dagen`, uniek('beschikbaar28', (o) => `${naam[o.mid]}, ${o.datum}`)),
    R('weekenden26', `Minimaal ${beleid.minVrijeWeekenden} vrije weekenden per jaar`, uniek('weekenden26', weekendTekst)),
    R('tekort', 'Niet minder regelplekken dan afgesproken', dag.tekort),
    ...(beleid.exactePlekken ? [R('teveel', 'Niet meer regelplekken dan afgesproken', dag.teveel)] : []),
    R('middag', `Minimaal ${een(beleid.minMiddag)} middag/avonddienst per dag`, dag.middag),
    ...(beleid.minMedewerkers > 0 ? [R('minimum', `Minimaal ${beleid.minMedewerkers} medewerkers per dag aan het werk`, dag.minimum)] : []),
    R('beschikbaar', `${beleid.beschikbaarPerDag === 1 ? 'Eén beschikbaarheidsdienst' : `${beleid.beschikbaarPerDag} beschikbaarheidsdiensten`} per dag`, dag.beschikbaar),
    R('dg', `Minimaal ${beleid.minDG} Dg-diensten per dag, behalve zondag`, dag.dg),
    R('voorgangen', `${beleid.voorgangenPerDag} voorgaansplekken per dag, behalve zondag`, dag.voorgangen),
    R('dgzondag', 'Geen Dg-diensten op zondag', dag.dgzondag),
    R('twee', `Maximaal ${een(beleid.maxTwee)} keer een 2 per dag, met nog minstens ${beleid.minEnkelBijTwee} enkele regeldiensten`, dag.twee),
    R('weekendplekken', `Maximaal ${beleid.maxWeekendPlekken} regelplekken per persoon per weekend`, uniek('weekendplekken', weekendTekst)),
    ...(beleid.maxContract ? [R('contract', beleid.bovenContractPct > 0 ? `Op contracturen ingepland (om regelplekken en voorgaansplekken te borgen over de periode hoogstens ${beleid.bovenContractPct}% erboven)` : 'Maximaal op contracturen ingepland', contract)] : []),
    R('functie', 'Uitvaartleiders alleen op Dg-diensten', uniek('functie', (o) => `${naam[o.mid]}, ${o.datum}`)),
    ...(beleid.geenOverigInVakantie && opts.schoolvakantie ? [R('overigvakantie', 'Geen overige diensten in de schoolvakantie (behalve opleiden van nieuwe medewerkers)', overigVakantie)] : []),
    ...(beleid.omHetWeekend ? [R('omhetweekend', 'Om het weekend werken', uniek('omhetweekend', weekendTekst))] : []),
  ];
  const hard = checks.filter((c) => c.niveau === 'ATW en CAO').reduce((s, c) => s + c.items.length, 0);
  const pol = checks.filter((c) => c.niveau !== 'ATW en CAO').reduce((s, c) => s + c.items.length, 0);

  const cont = continuiteit(perDag, beleid, pol);
  const eff = efficiency(perDag, { gepland: urenGepland, contract: urenContract, dossierRegel: urenWerk }, beleid);
  const kl = klant(perDag);
  const sub = { cont: cont.score, eff: eff.score, mw: medewerker.score, klant: kl.score };

  const w = beleid.weging;
  const totW = Math.max(1, w.continuiteit + w.efficiency + w.medewerker + w.klant);
  const gepland = perDag.reduce((a, d) => a + d.p, 0);
  let cijfer = 1 + (9 * (w.continuiteit * sub.cont + w.efficiency * sub.eff + w.medewerker * sub.mw + w.klant * sub.klant)) / totW;
  // een harde overtreding, of structureel te weinig regelplekken (zoals het advies rood), is nooit een voldoende
  const tekortErnstig = tekortStand(perDag).ernstig;
  if (hard || tekortErnstig) cijfer = Math.min(cijfer, 5.4);
  if (gepland === 0) cijfer = 1;
  cijfer = Math.round(cijfer * 10) / 10;
  const status: Toets['status'] = hard
    ? ['bad', 'Overtreding ATW/CAO']
    : tekortErnstig ? ['bad', 'Te weinig regelplekken']
    : pol || cijfer < 7.5 ? ['warn', 'Voldoet, met aandachtspunten'] : ['ok', 'Voldoet'];
  return {
    checks,
    pijlers: { continuiteit: cont, efficiency: eff, medewerker, klant: kl },
    sub, cijfer, status, perDag, fout, aandacht, overtredingen,
    surplus: eff.surplus, gepland, nodig: eff.nodig, hard, beleid: pol, uren,
    wensen: { totaal: wensTot, gehonoreerd: wensOk },
  };
}
