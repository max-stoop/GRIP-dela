/** Toets van het NBD-rooster: ATW, CAO, teamafspraken en voorkeuren, de dekking tegen Erlang C en een cijfer. */
import type { Cellen, Medewerker, Tijden, Voorkeurprofiel, Wens, Weging } from '../rooster/types';
import { STANDAARD_WEGING, dagVoorkeurOp } from '../rooster/types';
import type { Verlof } from '../store/types';
import { DAG_KORT, addDays, fmtD, toDay, weekday, year } from '../dates';
import { DIENSTEN } from '../rooster/diensten';
import { nietVrijeWeekenden } from '../rooster/toets';
import { serviceLevel } from './erlang';
import type { NbdDag } from './behoefte';
import { kwartierenOpen } from './behoefte';
import { aanTelefoon, dagdeel, netto, pauzeBegin, pauzeNodig, takenMeldingen, type NbdDienst } from './dienst';
import { dienstTegenVoorkeur } from './voorkeuren';
import { maxUren } from './capaciteit';
import { blokkenVan, nbdDienst, weekVan, weekrustOk, werkInWeek, type Blok } from './blokken';
import type { NbdParameters } from './parameters';

export type NbdNiveau = 'ATW en CAO' | 'Beleid' | 'Voorkeur';

export interface NbdBevinding {
  id: string;
  naam: string;
  niveau: NbdNiveau;
  /** Blokkeert het advies. */
  hard: boolean;
  uitleg: string;
  /** "Naam · ma 12 okt" */
  items: string[];
}

export interface NbdDagUitkomst {
  datum: string;
  gesprekken: number;
  /** Per open kwartier. */
  gepland: number[];
  nodig: number[];
  nodigUren: number;
  geplandUren: number;
  tekortUren: number;
  overUren: number;
  /** Deel van de gesprekken binnen de wachttijd. */
  sl: number;
  diensten: number;
}

export interface NbdMedewerkerUitkomst {
  /** Zonder pauzes. */
  uren: number;
  /** Naar rato van de periode. */
  norm: number;
  wensen: { ok: number; tot: number };
  dagdeel: { ok: number; tot: number };
  score: number;
}

export interface NbdToets {
  hard: number;
  checks: NbdBevinding[];
  perDag: NbdDagUitkomst[];
  perMedewerker: Record<string, NbdMedewerkerUitkomst>;
  /** Gewogen naar gesprekken. */
  sl: number;
  sub: { cont: number; eff: number; mw: number; klant: number };
  cijfer: number;
  wensen: { totaal: number; gehonoreerd: number };
  /** medewerker → datum → 'hard' of 'let' */
  markering: Record<string, Record<string, 'hard' | 'let'>>;
}

interface NbdToetsInvoer {
  team: Medewerker[];
  dates: string[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  behoefte: Record<string, NbdDag>;
  p: NbdParameters;
  profielen?: Record<string, Voorkeurprofiel>;
  wensen?: Wens[];
  aanvragen?: Verlof[];
  /** 0 = niet toetsen. */
  minVrijeWeekenden?: number;
  weging?: Weging;
}

const label = (m: Medewerker, d: string) => `${m.naam} · ${DAG_KORT[weekday(toDay(d))]} ${fmtD(d)}`;

/** null = niet van toepassing. */
export function nbdWensOk(soort: Wens['soort'], dienst: NbdDienst | null, werkt: boolean): boolean | null {
  // ochtend, middag of avond: alleen van toepassing als er een NBD-dienst met tijden staat
  switch (soort) {
    case 'vrij': return !werkt;
    case 'werken': return werkt;
    case 'neutraal': case 'overig8': case 'overig4': return null;
    default: return dienst ? dagdeel(dienst) === soort : null;
  }
}

export function gewerkteWeekenden(rij: Record<string, string> | undefined, jaar: number): Set<number> {
  const uit = new Set<number>();
  for (const [d, c] of Object.entries(rij ?? {})) {
    const dag = toDay(d);
    if (year(dag) !== jaar || !DIENSTEN[c as keyof typeof DIENSTEN]?.werk) continue;
    const wd = weekday(dag);
    if (wd === 6) uit.add(dag); else if (wd === 0) uit.add(dag - 1);
  }
  return uit;
}

export function dekking(p: NbdParameters, diensten: NbdDienst[]): number[] {
  const ks = kwartierenOpen(p);
  return ks.map((t) => diensten.reduce((a, d) => a + (aanTelefoon(d, t) ? 1 : 0), 0));
}

/** Gewogen naar gesprekken. */
export function dagServiceLevel(p: NbdParameters, dag: NbdDag, gepland: number[]): number {
  let g = 0, s = 0;
  dag.kwartieren.forEach((k, i) => {
    if (k.gesprekken <= 0) return;
    g += k.gesprekken;
    s += k.gesprekken * serviceLevel(k.gesprekken, p.aht, 900, gepland[i] ?? 0, p.wachttijd);
  });
  return g > 0 ? s / g : 1;
}

export function toetsNbd(inv: NbdToetsInvoer): NbdToets {
  const { team, dates, cellen, tijden, behoefte, p } = inv;
  const weging = inv.weging ?? STANDAARD_WEGING;
  const checks = new Map<string, NbdBevinding>();
  const markering: NbdToets['markering'] = {};
  const meld = (id: string, naam: string, niveau: NbdNiveau, hard: boolean, uitleg: string, m: Medewerker, d: string) => {
    let c = checks.get(id);
    if (!c) { c = { id, naam, niveau, hard, uitleg, items: [] }; checks.set(id, c); }
    c.items.push(label(m, d));
    const rij = (markering[m.id] ??= {});
    if (hard || rij[d] !== 'hard') rij[d] = hard ? 'hard' : 'let';
  };
  const datumSet = new Set(dates);
  const weken = [...new Set(dates.map(weekVan))];
  const perMedewerker: Record<string, NbdMedewerkerUitkomst> = {};
  const wensenPer = new Map<string, Wens[]>();
  for (const w of inv.wensen ?? []) {
    if (!datumSet.has(w.datum)) continue;
    const lijst = wensenPer.get(w.medewerkerId) ?? [];
    lijst.push(w);
    wensenPer.set(w.medewerkerId, lijst);
  }
  let wensTot = 0, wensOk = 0;

  for (const m of team) {
    const rij = cellen[m.id] ?? {};
    const blokken: Blok[] = blokkenVan(cellen, tijden, m.id);
    const profiel = inv.profielen?.[m.id];
    const wensOp = new Map((wensenPer.get(m.id) ?? []).map((w) => [w.datum, w.soort]));
    let uren = 0, ddOk = 0, ddTot = 0, voorkeurPunten = 0, voorkeurTot = 0;
    for (const d of dates) {
      const code = rij[d];
      if (!code || code === '-') continue;
      if (code === 'N') {
        const dienst = nbdDienst(cellen, tijden, m.id, d);
        if (!dienst) { meld('geen-tijden', 'Dienst zonder tijden', 'ATW en CAO', true, 'Bij elke NBD-dienst horen een begin- en eindtijd (ATW: werktijden staan vooraf vast).', m, d); continue; }
        const w = netto(dienst);
        uren += w;
        if (w < p.minDienst - 1e-9) meld('kort', `Dienst korter dan ${String(p.minDienst).replace('.', ',')} uur`, 'ATW en CAO', true, `Een dienst duurt minstens ${String(p.minDienst).replace('.', ',')} uur werktijd.`, m, d);
        if (w > p.maxDienst + 1e-9) meld('lang', `Dienst langer dan ${String(p.maxDienst).replace('.', ',')} uur`, 'ATW en CAO', true, `Een dienst duurt hoogstens ${String(p.maxDienst).replace('.', ',')} uur werktijd, zonder de pauze.`, m, d);
        const nodig = pauzeNodig(p, w);
        if (dienst.pauze < nodig) meld('pauze', 'Pauze ontbreekt of is te kort', 'ATW en CAO', true, `Bij meer dan ${String(p.pauzeNa).replace('.', ',')} uur werk hoort een pauze van minstens ${p.pauzeMinuten} minuten (ATW). De pauze telt niet als werktijd.`, m, d);
        const pb = pauzeBegin(dienst);
        if (pb != null && (pb < dienst.start + 1 - 1e-9 || pb + dienst.pauze / 60 > dienst.eind - 1 + 1e-9)) meld('pauze-rand', 'Pauze in het eerste of laatste uur', 'Beleid', false, 'Een pauze aan het begin of eind van de dienst helpt niet; plan die ergens in het midden.', m, d);
        if (dienst.start < p.open - 1e-9 || dienst.eind > p.sluit + 1e-9) meld('buiten', 'Dienst buiten de openingstijden', 'Beleid', false, 'De desk is alleen open tussen de openingstijden; daarbuiten telt de dienst niet mee in de bezetting.', m, d);
        if (takenMeldingen(dienst).length) meld('taak', 'Taak buiten de dienst, in de pauze of over een andere taak', 'Beleid', false, 'Training, klachten en de maandstart horen binnen de dienst, buiten de pauze en niet over elkaar heen.', m, d);
        if (profiel?.uren) {
          // voorkeuren per uur: uren die niet kunnen, en hoeveel van de dienst in de graag-uren valt
          const fit = dienstTegenVoorkeur(profiel.uren, d, dienst.start, dienst.eind);
          if (fit.niet > 0) meld('kan-niet-uur', 'Ingeroosterd op uren die niet kunnen', 'Voorkeur', false, 'De medewerker heeft aangegeven op deze uren niet te kunnen.', m, d);
          if (fit.heeftGraag && fit.totaal) { ddTot++; ddOk += fit.graag / fit.totaal; }
        } else if (profiel && profiel.dienst !== 'geen') { ddTot++; if (dagdeel(dienst) === profiel.dienst) ddOk++; }
      } else if (DIENSTEN[code]?.werk) {
        uren += DIENSTEN[code].uren;
      }
      if (DIENSTEN[code]?.werk) {
        // met voorkeuren per uur telt het uurpatroon; anders de voorkeur per weekdag
        // een wens voor deze datum gaat voor de vaste voorkeur van de weekdag
        const vk = profiel?.uren || !profiel ? undefined : dagVoorkeurOp(profiel.dagen[weekday(toDay(d))], wensOp.get(d));
        if (vk === 'niet') meld('kan-niet', 'Ingeroosterd op een dag die niet kan', 'Voorkeur', false, 'De medewerker heeft aangegeven op deze dag niet te kunnen.', m, d);
        if (vk) { voorkeurTot++; voorkeurPunten += vk === 'graag' ? 1 : vk === 'neutraal' ? 0.75 : vk === 'liever_niet' ? 0.25 : 0; }
        if (inv.aanvragen?.some((v) => v.medewerkerId === m.id && v.status === 'aangevraagd' && v.van <= d && v.tot >= d)) meld('aanvraag', 'Ingeroosterd tijdens aangevraagd verlof', 'Voorkeur', false, 'Er ligt een verlofaanvraag voor deze dag.', m, d);
      }
    }
    for (let i = 1; i < blokken.length; i++) {
      const rust = blokken[i].van - blokken[i - 1].tot;
      if (rust < p.minRust - 1e-9 && (datumSet.has(blokken[i].datum) || datumSet.has(blokken[i - 1].datum))) {
        meld('rust', `Minder dan ${p.minRust} uur rust tussen twee diensten`, 'ATW en CAO', true, `Tussen twee diensten zit minstens ${p.minRust} uur rust (ATW).`, m, blokken[i].datum);
      }
    }
    let reeks = 0;
    const eerste = dates[0];
    for (let i = p.maxAchtereen; i >= 1; i--) { if (DIENSTEN[rij[addDays(eerste, -i)] ?? '-']?.werk) reeks++; else reeks = 0; }
    for (const d of dates) {
      if (DIENSTEN[rij[d] ?? '-']?.werk) {
        reeks++;
        if (reeks > p.maxAchtereen) meld('achtereen', `Meer dan ${p.maxAchtereen} dagen achter elkaar`, 'Beleid', false, `Teamafspraak: niet meer dan ${p.maxAchtereen} dagen achter elkaar werken.`, m, d);
      } else reeks = 0;
    }
    for (const ma of weken) {
      const dagIn = dates.find((d) => weekVan(d) === ma)!;
      if (!weekrustOk(blokken, ma, p)) meld('weekrust', `Geen ${p.weekRust} uur aaneengesloten rust in de week`, 'ATW en CAO', true, `Elke week minstens ${p.weekRust} uur aaneengesloten rust, of 72 uur in twee weken in delen van minstens 32 uur (ATW).`, m, dagIn);
      const w = werkInWeek(blokken, ma);
      if (w > p.maxWeekUren + 1e-9) meld('weekuren', `Meer dan ${p.maxWeekUren} uur in een week`, 'ATW en CAO', true, `Hoogstens ${p.maxWeekUren} uur werk per week (ATW).`, m, dagIn);
      else if (!m.extern && w > maxUren(m) + 0.25 + 1e-9) meld('maxinzet', 'Meer uren dan de maximale inzet in een week', 'Beleid', false, 'Meer werktijd in een week dan de maximale inzet (contract plus de extra uren bij een variabel rooster).', m, dagIn);
      else if (!m.extern && w > m.contract + 0.25 + 1e-9) meld('contract', 'Meer uren dan het contract in een week', 'Beleid', false, 'Meer werktijd in een week dan de contracturen.', m, dagIn);
    }
    const minVrij = inv.minVrijeWeekenden ?? 0;
    if (minVrij > 0 && !m.afstandsverklaring && !m.collega) {
      for (const j of [...new Set(dates.map((d) => year(toDay(d))))]) {
        // zoals de regio's: een weekend met zondag en maandag vrij telt (13 keer) ook als vrij (CAO)
        if (nietVrijeWeekenden(rij, j).length > 52 - minVrij) {
          const d = dates.find((x) => year(toDay(x)) === j && [0, 6].includes(weekday(toDay(x))) && DIENSTEN[rij[x] ?? '-']?.werk) ?? dates[0];
          meld('weekenden', `Minder dan ${minVrij} vrije weekenden in ${j}`, 'ATW en CAO', true, `Minstens ${minVrij} weekenden per jaar vrij (CAO), tenzij er een afstandsverklaring is.`, m, d);
        }
      }
    }
    let wOk = 0, wTot = 0;
    for (const w of wensenPer.get(m.id) ?? []) {
      const code = rij[w.datum] ?? '-';
      const ok = nbdWensOk(w.soort, nbdDienst(cellen, tijden, m.id, w.datum), !!DIENSTEN[code]?.werk);
      if (ok == null) continue;
      wTot++; if (ok) wOk++;
    }
    wensTot += wTot; wensOk += wOk;
    const norm = m.extern ? 0 : (m.contract * dates.length) / 7;
    const delen = [wTot ? wOk / wTot : null, ddTot ? ddOk / ddTot : null, voorkeurTot ? voorkeurPunten / voorkeurTot : null].filter((x): x is number => x != null);
    perMedewerker[m.id] = { uren, norm, wensen: { ok: wOk, tot: wTot }, dagdeel: { ok: ddOk, tot: ddTot }, score: delen.length ? delen.reduce((a, x) => a + x, 0) / delen.length : 1 };
  }

  const perDag: NbdDagUitkomst[] = [];
  let gesprekken = 0, slSom = 0, nodigTot = 0, gedekt = 0, overTot = 0, geplandTot = 0;
  for (const d of dates) {
    const dag = behoefte[d];
    if (!dag) continue;
    const diensten = team.map((m) => nbdDienst(cellen, tijden, m.id, d)).filter((x): x is NbdDienst => !!x);
    const gepland = dekking(p, diensten);
    const nodig = dag.kwartieren.map((k) => k.nodig);
    let tekort = 0, over = 0;
    nodig.forEach((n, i) => { tekort += Math.max(0, n - gepland[i]); over += Math.max(0, gepland[i] - n); gedekt += Math.min(n, gepland[i]); });
    const sl = dagServiceLevel(p, dag, gepland);
    perDag.push({
      datum: d, gesprekken: dag.gesprekken, gepland, nodig, nodigUren: dag.uren, geplandUren: gepland.reduce((a, x) => a + x, 0) / 4,
      tekortUren: tekort / 4, overUren: over / 4, sl, diensten: diensten.length,
    });
    gesprekken += dag.gesprekken; slSom += dag.gesprekken * sl;
    nodigTot += nodig.reduce((a, x) => a + x, 0); overTot += over; geplandTot += gepland.reduce((a, x) => a + x, 0);
  }
  const sl = gesprekken > 0 ? slSom / gesprekken : 1;
  const cont = nodigTot > 0 ? gedekt / nodigTot : 1;
  const klant = p.serviceLevel > 0 ? Math.min(1, sl / p.serviceLevel) : 1;
  const leden = team.filter((m) => !m.extern && perMedewerker[m.id]?.norm > 0);
  const pasvorm = leden.length ? leden.reduce((a, m) => { const u = perMedewerker[m.id]; return a + Math.max(0, 1 - Math.abs(u.uren - u.norm) / u.norm); }, 0) / leden.length : 1;
  const eff = 0.6 * (geplandTot > 0 ? 1 - overTot / geplandTot : 1) + 0.4 * pasvorm;
  const mw = team.length ? team.reduce((a, m) => a + (perMedewerker[m.id]?.score ?? 1), 0) / team.length : 1;
  const somW = weging.continuiteit + weging.efficiency + weging.medewerker + weging.klant || 1;
  const totaal = (weging.continuiteit * cont + weging.efficiency * eff + weging.medewerker * mw + weging.klant * klant) / somW;
  const lijst = [...checks.values()].map((c) => ({ ...c, items: [...new Set(c.items)] }));
  const hard = lijst.filter((c) => c.hard).reduce((a, c) => a + c.items.length, 0);
  let cijfer = Math.round((1 + 9 * totaal) * 10) / 10;
  if (hard > 0) cijfer = Math.min(cijfer, 5.5);
  return {
    hard, checks: lijst.sort((a, b) => Number(b.hard) - Number(a.hard) || b.items.length - a.items.length), perDag, perMedewerker, sl,
    sub: { cont, eff, mw, klant }, cijfer, wensen: { totaal: wensTot, gehonoreerd: wensOk }, markering,
  };
}

/**
 * Rood bij ATW- of CAO-overtredingen, een dag meer dan 15 procentpunt onder het service level, drie of meer dagen
 * eronder of een cijfer onder de 6; oranje bij een of twee dagen eronder, punten uit beleid of voorkeuren, of onder
 * de 7,5.
 */
export function nbdAdviesVoorstel(t: NbdToets, p: Pick<NbdParameters, 'serviceLevel'>, vanaf?: string): { kleur: 'groen' | 'oranje' | 'rood'; redenen: string[] } {
  const rood: string[] = [], oranje: string[] = [];
  if (t.hard > 0) rood.push(`${t.hard} ${t.hard === 1 ? 'overtreding' : 'overtredingen'} van ATW of CAO`);
  const dagen = t.perDag.filter((d) => !vanaf || d.datum >= vanaf);
  const onder = dagen.filter((d) => d.sl < p.serviceLevel - 1e-9);
  const ver = onder.filter((d) => d.sl < p.serviceLevel - 0.15);
  const doel = `${Math.round(p.serviceLevel * 100)}%`;
  if (ver.length) rood.push(`${ver.length === 1 ? '1 dag' : `${ver.length} dagen`} ver onder het service level van ${doel}`);
  else if (onder.length >= 3) rood.push(`${onder.length} dagen onder het service level van ${doel}`);
  else if (onder.length) oranje.push(`${onder.length === 1 ? '1 dag' : `${onder.length} dagen`} onder het service level van ${doel}`);
  if (t.cijfer < 6) rood.push(`cijfer ${String(t.cijfer).replace('.', ',')}`);
  else if (t.cijfer < 7.5) oranje.push(`cijfer ${String(t.cijfer).replace('.', ',')}`);
  const zacht = t.checks.filter((c) => !c.hard && c.items.length);
  if (zacht.length) oranje.push(`aandachtspunten: ${zacht.slice(0, 3).map((c) => c.naam.toLowerCase()).join('; ')}${zacht.length > 3 ? ` en ${zacht.length - 3} meer` : ''}`);
  if (rood.length) return { kleur: 'rood', redenen: [...rood, ...oranje] };
  if (oranje.length) return { kleur: 'oranje', redenen: oranje };
  return { kleur: 'groen', redenen: [`voldoet aan ATW en CAO en haalt elke dag het service level van ${doel}`] };
}
