/**
 * Eén roostervoorstel volgens het roosterbeleid. De volgorde is die van het beleid: eerst de continuïteit, dan het
 * dossierwerk, dan de uren, tot slot tevredenheid en eerlijkheid.
 *
 * 1. Regelplekken voor de hele periode, de weekenden eerst (daar kunnen de minste mensen). Laag voor laag: elke dag
 *    krijgt zijn eerste plek voordat een dag zijn tweede krijgt, zodat een tekort zich spreidt en niet op één dag valt.
 *    In het weekend liever een 2, dan werken er minder mensen.
 * 2. Dg-diensten tot het minimum en de voorgangen, ook laag voor laag.
 * 3. Aanvullen tot de uren met Dg-diensten, telkens op de dag met de minste: gelijkmatig over de dagen.
 * 4. Verschuiven en wisselen op dezelfde dag: de dekking blijft gelijk, tevredenheid en eerlijkheid gaan omhoog,
 *    zonder dat iemand verder onder zijn uren komt.
 *
 * Wie een dienst krijgt: wie het verst achterloopt op zijn uren (in de week, in de periode en uit de vorige vier
 * weken), met een eerlijk aandeel regeldiensten, 1B's en middagen naar contract, en met de voorkeuren en wensen.
 */
import { toDay, fromDay, weekday, weekIndex, isWeekend, year } from '../dates';
import { rng } from '../model/demo';
import { DIENSTEN, afwezigVoorNorm, dossierVoor, isEnkel, magFunctie } from './diensten';
import { dienstVoorkeur, eerlijkheid, maakContext, medewerkerScore, type MwContext, type MwDetails } from './analyse';
import { WENS_JAARROOSTER, WENS_OVERIG, dagVoorkeurOp, maxKanNiet, weekendCadans, werktWeekend, type Behoefte, type Beleid, type Cellen, type DienstCode, type Medewerker, type Tijden, type Voorkeurprofiel, type Wens, type WensSoort } from './types';
import { tijdVan } from './toets';

export type Wijziging = [mid: string, datum: string, dienst: DienstCode];

/** Hoe zwaar voorkeuren wegen; het beleid is "balans". */
export type Nadruk = 'dekking' | 'balans' | 'medewerker';

export const GEWICHT: Record<Nadruk, number> = { dekking: 0.5, balans: 1, medewerker: 2 };

/** Een dag waarop regelplekken leeg blijven, met per reden hoeveel collega's daardoor niet konden. */
export interface Tekort { datum: string; tekort: number; redenen: [string, number][] }

export interface Voorstel { wijzigingen: Wijziging[]; tekorten: Tekort[] }

/** Wie middag liever heeft, krijgt er per contractuur twee keer zoveel. */
function middagGewicht(voorkeur: 'O' | 'M' | null): number {
  return voorkeur === 'M' ? 2 : 1;
}

/** Zoveel 1M per fulltimer mag de verdeling bij het verbeteren uit elkaar lopen. */
const MIDDAG_SPELING = 1;
/** Kleine willekeur in de keuze tussen gelijkwaardige kandidaten: een ander zaadje geeft een ander, even geldig rooster. */
const RUIS = 0.5;
/** Zoveel dagen "graag" of "liever niet" wegen vol; wie er meer opgeeft, verdeelt dat gewicht over meer dagen. */
export const VOLLE_VOORKEUREN = 2;

export interface VoorstelOpties {
  team: Medewerker[];
  /** Oplopend. */
  dates: string[];
  cellen: Cellen;
  behoefte: Behoefte;
  wensen: Wens[];
  beleid: Beleid;
  profielen?: Record<string, Voorkeurprofiel>;
  /** Hoe zwaar voorkeuren wegen: 1 is het beleid, 0,5 lichter, 2 zwaarder. Gaat voor nadruk. */
  gewicht?: number;
  nadruk?: Nadruk;
  /** Bestaande diensten (behalve verlof en ziekte) eerst weghalen. */
  opnieuw?: boolean;
  /** Zodat de rust ook klopt naast een Dg-dienst met een late eindtijd. */
  tijden?: Tijden;
  /** Na de dekking aanvullen tot contracturen; niet als alleen de weekenden vooruit worden gepland. */
  aanvullen?: boolean;
  /** Verlof dat is aangevraagd en nog niet beoordeeld: daar alleen inroosteren als er echt niemand anders is. */
  aanvragen?: { medewerkerId: string; van: string; tot: string }[];
  seed?: number;
}

const VAST: DienstCode[] = ['V', 'Z'];

export function voorstel(o: VoorstelOpties): Wijziging[] {
  return voorstelMetUitleg(o).wijzigingen;
}

export function voorstelMetUitleg(o: VoorstelOpties): Voorstel {
  const { team, dates, behoefte, beleid } = o;
  if (!dates.length || !team.length) return { wijzigingen: [], tekorten: [] };
  const lp = o.gewicht ?? GEWICHT[o.nadruk ?? 'balans'];
  const profielen = o.profielen ?? {};
  const R = rng(o.seed ?? 1);

  // aanloop van 4 weken (28-dagenregel en het urensaldo), uitloop van 1 week
  const AANLOOP = 28;
  const eerste = toDay(dates[0]) - AANLOOP, laatste = toDay(dates[dates.length - 1]) + 7;
  const N = laatste - eerste + 1;
  const iso = Array.from({ length: N }, (_, i) => fromDay(eerste + i));
  const wd = iso.map((_, i) => weekday(eerste + i));
  const wk = iso.map((_, i) => weekIndex(eerste + i));
  const we = iso.map((_, i) => isWeekend(eerste + i));
  const jr = iso.map((_, i) => year(eerste + i));
  const planIdx = dates.map((d) => toDay(d) - eerste);
  const inPlan = new Uint8Array(N);
  for (const i of planIdx) inPlan[i] = 1;

  const E = team.length;
  const codes: DienstCode[][] = team.map((e) => iso.map((d) => o.cellen[e.id]?.[d] ?? '-'));
  const vast: Uint8Array[] = team.map(() => new Uint8Array(N));
  for (let x = 0; x < E; x++) {
    for (let i = 0; i < N; i++) {
      // externen (ZZP) plant de planner zelf in; hun diensten tellen wel mee voor de dekking
      if (!inPlan[i] || team[x].extern) { vast[x][i] = 1; continue; }
      const c = codes[x][i];
      if (VAST.includes(c)) vast[x][i] = 1;
      else if (c !== '-') {
        if (o.opnieuw) codes[x][i] = '-';
        else vast[x][i] = 1;
      }
    }
  }
  const origineel = team.map((e) => iso.map((d) => o.cellen[e.id]?.[d] ?? '-'));
  const idxVan = new Map(iso.map((d, i) => [d, i]));
  const teamIdx = new Map(team.map((e, x) => [e.id, x]));
  const prof = team.map((e) => profielen[e.id] ?? null);
  const pref = team.map((e, x) => dienstVoorkeur(e, prof[x]));
  const isUL = team.map((e) => e.functie === 'UL');
  const telt = (x: number) => !isUL[x] && !team[x].extern;

  // wensen per datum. "Liever vrij" is er in drie sterktes: zeker (alleen bij nood ervan af), bevestigd (gelijk aan
  // het vaste "liever niet" van die weekdag: weegt als die voorkeur) en boven het aantal zekere wensen per vier weken
  // (weegt als sterke voorkeur). Zo krijgt wie het meest vraagt niet vanzelf alles.
  const wens: Map<number, WensSoort>[] = team.map(() => new Map());
  const vrijZeker: Uint8Array[] = team.map(() => new Uint8Array(N));
  const vrijExtra: Uint8Array[] = team.map(() => new Uint8Array(N));
  const afspraak: Uint8Array[] = team.map(() => new Uint8Array(N));
  for (const w of o.wensen) {
    const x = teamIdx.get(w.medewerkerId), i = idxVan.get(w.datum);
    if (x == null || i == null) continue;
    wens[x].set(i, w.soort);
    if (w.soort === 'vrij' && w.opmerking === WENS_JAARROOSTER) afspraak[x][i] = 1;
    // de medewerker heeft die dag al ander werk: dat staat er als overige dienst (8 of 4 uur) en telt mee in de uren
    const overig = WENS_OVERIG[w.soort];
    if (overig && inPlan[i] && !team[x].extern && !vast[x][i] && codes[x][i] === '-') { codes[x][i] = overig; vast[x][i] = 1; }
  }
  for (let x = 0; x < E; x++) {
    const zeker: number[] = [];
    for (const i of [...wens[x].keys()].sort((a, b) => a - b)) {
      if (wens[x].get(i) !== 'vrij') continue;
      const patroon = prof[x]?.dagen[wd[i]];
      if (patroon === 'niet' || patroon === 'liever_niet') continue;
      if (afspraak[x][i]) { vrijZeker[x][i] = 1; continue; }
      const recent = zeker.filter((j) => i - j < 28).length;
      if (!beleid.wensenZeker || recent < beleid.wensenZeker) { vrijZeker[x][i] = 1; zeker.push(i); } else vrijExtra[x][i] = 1;
    }
  }
  const aanvraag: Uint8Array[] = team.map(() => new Uint8Array(N));
  for (const v of o.aanvragen ?? []) {
    const x = teamIdx.get(v.medewerkerId);
    if (x == null) continue;
    for (let i = Math.max(0, toDay(v.van) - eerste); i <= Math.min(N - 1, toDay(v.tot) - eerste); i++) aanvraag[x][i] = 1;
  }

  // gewerkte weekenden per jaar buiten de tijdlijn (voor de CAO-regel van 26 vrije weekenden)
  const maxWerkWeekenden = 52 - beleid.minVrijeWeekenden;
  const buiten: Map<number, number>[] = team.map((e) => {
    const m = new Map<number, Set<number>>();
    for (const [d, s] of Object.entries(o.cellen[e.id] ?? {})) {
      const n = toDay(d);
      if (n >= eerste && n <= laatste) continue;
      if (!isWeekend(n) || !DIENSTEN[s].werk) continue;
      const y = year(n);
      if (!m.has(y)) m.set(y, new Set());
      m.get(y)!.add(weekIndex(n));
    }
    return new Map([...m].map(([y, s]) => [y, s.size]));
  });

  const werk = (x: number, i: number) => i >= 0 && i < N && DIENSTEN[codes[x][i]].werk;
  const reeks = (x: number, i: number) => {
    let r = 1;
    for (let j = i - 1; werk(x, j); j--) r++;
    for (let j = i + 1; werk(x, j); j++) r++;
    return r;
  };
  const tijdOp = (x: number, i: number) => (i >= 0 && i < N && DIENSTEN[codes[x][i]].werk ? tijdVan(codes[x][i], o.tijden?.[team[x].id]?.[iso[i]]) : null);
  const rustOk = (x: number, i: number) => {
    const t = tijdOp(x, i), tp = tijdOp(x, i - 1), tn = tijdOp(x, i + 1);
    if (tp && t && 24 - tp.eind + t.start < beleid.minRustUren) return false;
    if (t && tn && 24 - t.eind + tn.start < beleid.minRustUren) return false;
    return true;
  };
  const maandagIdx = (i: number) => i - ((wd[i] + 6) % 7);
  const weekUren = (x: number, i: number) => {
    let h = 0;
    const m = maandagIdx(i);
    for (let j = Math.max(0, m); j < Math.min(N, m + 7); j++) h += DIENSTEN[codes[x][j]].uren;
    return h;
  };
  /** Indexen mogen buiten de tijdlijn vallen. */
  const weekendIdx = (i: number) => { const m = maandagIdx(i); return [m + 5, m + 6]; };
  const weekendGewerkt = (x: number, za: number) => werk(x, za) || werk(x, za + 1);
  const weekendPlekken = (x: number, i: number) => weekendIdx(i).reduce((s, j) => s + (j >= 0 && j < N ? DIENSTEN[codes[x][j]].plekken : 0), 0);
  const beschikbaarIn28 = (x: number, i: number) => {
    let n = 0;
    for (let j = Math.max(0, i - 27); j <= Math.min(N - 1, i + 27); j++) if (codes[x][j] === '1B') n++;
    return n;
  };
  const weekendenInJaar = (x: number, y: number) => {
    const s = new Set<number>();
    for (let i = 0; i < N; i++) if (jr[i] === y && we[i] && werk(x, i)) s.add(wk[i]);
    return s.size + (buiten[x].get(y) ?? 0);
  };
  /** De vaste voorkeur van de weekdag, tenzij er voor die datum een wens ligt: die gaat voor. */
  const dagVk = (x: number, i: number) => dagVoorkeurOp(nietTeVeel[x][i] ? 'liever_niet' : prof[x]?.dagen[wd[i]], wens[x].get(i));
  // "kan niet" heeft een maximum per maand, naar contract: de eerste werkdagen van de maand tellen als "kan niet", wat
  // daarboven komt weegt als "liever niet". Het weekend telt niet mee: dat regelt de weekendbeurt.
  const nietTeVeel: Uint8Array[] = team.map((e, x) => {
    const uit = new Uint8Array(N);
    if (!beleid.kanNietBegrensd || !prof[x]) return uit;
    const max = maxKanNiet(e.contract), perMaand = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      if (we[i] || prof[x]!.dagen[wd[i]] !== 'niet') continue;
      const m = iso[i].slice(0, 7), n = (perMaand.get(m) ?? 0) + 1;
      perMaand.set(m, n);
      if (n > max) uit[i] = 1;
    }
    return uit;
  });

  /**
   * Alleen aan om een regelplek of de eerste voorgaansplek van een dag te borgen: dan mag iemand boven zijn contract,
   * per week hoogstens één dienst en over de periode hoogstens het percentage uit het beleid.
   */
  let boven = false;
  let grensAan = false;
  /** Alleen aan als een regelplek anders leeg blijft: dan ook buiten de eigen weekendbeurt (een teamafspraak, geen wet). */
  let buitenBeurt = false;
  /**
   * Waarom deze dienst hier niet kan, of null. Niveau 0 is het beleid met alle wensen; 1 laat "liever vrij" en het
   * weekmaximum los; 2 ook aangevraagd verlof. De regels van ATW, CAO en beleid gelden op elk niveau.
   */
  const reden = (x: number, i: number, niveau: 0 | 1 | 2): string | null => {
    const s = codes[x][i], e = team[x], def = DIENSTEN[s];
    if (!def.werk) return null;
    if (!magFunctie(e.functie, s)) return 'andere functie';
    if (dagVk(x, i) === 'niet') return 'kan niet op deze weekdag';
    // kan niet is een harde grens, ook bij ruilen
    if (s === '2' && prof[x]?.twee === 'niet') return 'doet geen 2';
    // een halve dag (4 uur) alleen bij wie dat zelf heeft aangegeven, ook bij een uitvaartleider
    if (s === 'DG1' && prof[x]?.korteDagen !== 'graag') return 'werkt geen halve dagen';
    if (we[i]) {
      if (beleid.omHetWeekend && !buitenBeurt && !werktWeekend(e, wk[i])) return 'niet aan de beurt dit weekend';
      if (beleid.omHetWeekend && !buitenBeurt && weekendCadans(e) > 1) {
        const [za] = weekendIdx(i);
        if (weekendGewerkt(x, za - 7) || weekendGewerkt(x, za + 7)) return 'werkt het weekend ervoor of erna';
      }
      if (def.plekken && weekendPlekken(x, i) > beleid.maxWeekendPlekken) return 'heeft het maximum aan regelplekken dit weekend';
      if (!e.afstandsverklaring && weekendenInJaar(x, jr[i]) > maxWerkWeekenden) return 'vrije weekenden per jaar (CAO)';
    }
    if (reeks(x, i) > beleid.maxAchtereen) return 'te veel dagen achter elkaar';
    if (!rustOk(x, i)) return 'te weinig rust tussen twee diensten';
    if (s === '1B' && beschikbaarIn28(x, i) > beleid.maxBeschikbaarPer28) return 'te veel 1B in 28 dagen';
    const week = weekUren(x, i);
    if (week > e.contract + (beleid.maxContract ? 0 : 4) + 0.01) {
      if (!boven || beleid.bovenContractPct <= 0) return 'weekuren zijn op';
      if (geplandeUren[x] + def.uren > norm[x] * (1 + beleid.bovenContractPct / 100) + 0.01) return 'te ver boven contract deze periode';
    }
    if (niveau < 2 && aanvraag[x][i]) return 'verlof aangevraagd';
    if (niveau < 1 && vrijZeker[x][i]) return 'wil die dag vrij';
    return null;
  };
  const geldig = (x: number, i: number, niveau: 0 | 1 | 2) => reden(x, i, niveau) === null;
  /** aftrek: uren van een dienst die dezelfde medewerker hiervoor inlevert (een dienst verplaatsen). */
  const mag = (x: number, i: number, s: DienstCode, niveau: 0 | 1 | 2, aftrek = 0) => {
    if (vast[x][i] || codes[x][i] !== '-') return false;
    // is er eenmaal boven contract gepland, dan komt niemand meer over de grens van de periode
    if (grensAan && geplandeUren[x] - aftrek + DIENSTEN[s].uren > norm[x] * (1 + beleid.bovenContractPct / 100) + 0.01) return false;
    codes[x][i] = s;
    const ok = geldig(x, i, niveau);
    codes[x][i] = '-';
    return ok;
  };

  /** Dagen die de urennorm verlagen (verlof op werkdagen, ziekte). */
  const afwezig = (x: number, i: number) => afwezigVoorNorm(codes[x][i], we[i]);
  // de uren van de periode: contract naar rato, min verlof en ziekte, en wat er de vier weken ervoor te weinig of te
  // veel is ingeroosterd (als daar een rooster stond): wie toen tekortkwam, gaat nu voor
  const roosterVooraf = team.some((e, x) => !e.extern && origineel[x].slice(0, AANLOOP).some((c) => DIENSTEN[c].werk));
  const saldo = team.map((e, x) => {
    if (!roosterVooraf || e.extern) return 0;
    let h = 0, weg = 0, iets = false;
    for (let i = 0; i < AANLOOP; i++) {
      const c = origineel[x][i];
      h += DIENSTEN[c].uren;
      if (afwezigVoorNorm(c, we[i])) weg++;
      if (c !== '-') iets = true;
    }
    // wie er toen nog niet was, heeft niets in te halen
    return iets ? h - ((e.contract * AANLOOP) / 7 - (weg * e.contract) / 5) : 0;
  });
  const norm = team.map((e, x) => (e.contract * dates.length) / 7 - (planIdx.filter((i) => afwezig(x, i)).length * e.contract) / 5);
  const doel = norm.map((n, x) => Math.max(0, n - saldo[x]));
  const geplandeUren = new Float64Array(E);
  for (let x = 0; x < E; x++) for (const i of planIdx) geplandeUren[x] += DIENSTEN[codes[x][i]].uren;
  /** Wat er deze week (de dagen in de periode) hoort te staan en wat er staat. */
  const weekStand = (x: number, i: number) => {
    const m = maandagIdx(i);
    let dagen = 0, weg = 0, h = 0;
    for (let j = Math.max(0, m); j < Math.min(N, m + 7); j++) {
      if (!inPlan[j]) continue;
      dagen++;
      if (afwezig(x, j)) weg++;
      h += DIENSTEN[codes[x][j]].uren;
    }
    return { doel: (team[x].contract * dagen) / 7 - (weg * team[x].contract) / 5, uren: h };
  };

  // eerlijke verdeling van regelplekken en Dg-dagen: wie tot nu toe minder regeldiensten kreeg dan zijn
  // aandeel (naar contract), gaat voor. Zo krijgt niet de een alleen Dg en de ander alleen regelgesprekken.
  const isRegel = (c: DienstCode) => DIENSTEN[c].plekken > 0;
  const regelN = new Float64Array(E);
  let regelTot = 0;
  for (let x = 0; x < E; x++) for (const i of planIdx) if (isRegel(codes[x][i])) { regelN[x]++; if (telt(x)) regelTot++; }
  const uvContract = team.reduce((a, e, x) => a + (telt(x) ? e.contract : 0), 0) || 1;
  const balans = (x: number) => (telt(x) ? 4 * (((regelTot + 1) * team[x].contract) / uvContract - regelN[x]) : 0);
  // ook de 1B's eerlijk naar contract: een 1B levert weinig uren op, dus wie er veel heeft, loopt achter op zijn
  // uren en zou op uren alleen steeds weer de volgende 1B krijgen (en daarna aangevuld worden met Dg)
  const bN = new Float64Array(E);
  let bTot = 0;
  for (let x = 0; x < E; x++) for (const i of planIdx) if (codes[x][i] === '1B') { bN[x]++; if (telt(x)) bTot++; }
  const balansB = (x: number) => (telt(x) ? 12 * (((bTot + 1) * team[x].contract) / uvContract - bN[x]) : 0);
  // ook de 1M's eerlijk naar contract, wie middag liever heeft ongeveer twee keer zoveel
  const mN = new Float64Array(E);
  let mTot = 0;
  for (let x = 0; x < E; x++) for (const i of planIdx) if (codes[x][i] === '1M') { mN[x]++; if (telt(x)) mTot++; }
  const mGewicht = team.map((e, x) => (telt(x) ? middagGewicht(pref[x]) * e.contract : 0));
  const mGewichtTot = mGewicht.reduce((a, b) => a + b, 0) || 1;
  const balansM = (x: number) => (telt(x) ? 5 * (((mTot + 1) * mGewicht[x]) / mGewichtTot - mN[x]) : 0);
  const zet = (x: number, i: number, s: DienstCode) => {
    geplandeUren[x] += DIENSTEN[s].uren - DIENSTEN[codes[x][i]].uren;
    const d = Number(isRegel(s)) - Number(isRegel(codes[x][i]));
    regelN[x] += d;
    if (telt(x)) regelTot += d;
    const db = Number(s === '1B') - Number(codes[x][i] === '1B');
    bN[x] += db;
    if (telt(x)) bTot += db;
    const dm = Number(s === '1M') - Number(codes[x][i] === '1M');
    mN[x] += dm;
    if (telt(x)) mTot += dm;
    codes[x][i] = s;
  };

  /**
   * Hoe graag deze medewerker deze dag erbij krijgt, in uren: het deel van de week en van de periode dat nog open
   * staat (naar verhouding, zodat een klein contract niet achteraan sluit), plus de voorkeuren.
   */
  const score = (x: number, i: number, extra = 0) => {
    const w = weekStand(x, i);
    let s = (w.doel > 0 ? 24 * (1 - w.uren / w.doel) : -24) + (doel[x] > 0 ? 12 * (1 - geplandeUren[x] / doel[x]) : -12) + extra;
    const ws = wens[x].get(i), dv = dagVk(x, i);
    if (ws === 'werken') s += 8;
    // meer voorkeuren is niet beter: wie meer dagen "graag" of "liever niet" opgeeft, verdeelt hetzelfde gewicht over meer dagen
    if (dv === 'graag') s += 4 * lp * gewichtGraag[x];
    if (dv === 'liever_niet') s -= 6 * lp * gewichtLiever[x];
    if (we[i]) {
      // weekenden eerlijk over het jaar: wie dit jaar al meer weekenden was ingeroosterd dan het team, sluit achteraan
      s += 3 * (gemWeekenden - eerderWeekenden[x]);
      // zaterdag en zondag samen: wie de andere dag van dit weekend al werkt, gaat voor
      const [za, zo] = weekendIdx(i);
      if (werk(x, i === za ? zo : za)) s += 8;
    }
    // "liever vrij" dat het vaste "liever niet" bevestigt, weegt iets zwaarder; boven het aantal zekere wensen zwaar
    if (ws === 'vrij' && dv === 'liever_niet') s -= 3 * lp;
    if (vrijExtra[x][i]) s -= 12 * lp;
    return s + R.uniform() * RUIS;
  };
  // eigen melding voorgaan: wie een melding aannam (1, 1M of 2), werkt zoveel dagen later liefst weer (een regeldienst
  // of een Dg-dienst), dan kan hij die uitvaart zelf voorgaan
  const NA = Math.max(0, beleid.voorgaanNaDagen);
  const isMelding = (c: DienstCode) => c === '1' || c === '1M' || c === '2';
  const isVervolg = (c: DienstCode) => isMelding(c) || DIENSTEN[c].categorie === 'dossier';
  const codeOp = (x: number, i: number): DienstCode => (i >= 0 && i < N ? codes[x][i] : '-');
  /** Punten voor deze dienst op deze dag: hij sluit aan op een melding van zoveel dagen eerder, of er volgt er al een. */
  const vervolg = (x: number, i: number, s: DienstCode) => {
    if (NA === 0) return 0;
    let v = 0;
    // de dag van de uitvaart is een werkdag; na een 2 (twee meldingen) liefst een hele Dg-dag
    if (!we[i] && isVervolg(s) && isMelding(codeOp(x, i - NA))) v += codeOp(x, i - NA) === '2' && s === 'DG1' ? 3 : 6;
    if (isMelding(s) && i + NA < N && !we[i + NA] && isVervolg(codeOp(x, i + NA))) v += 3;
    return v;
  };
  /** Hoe vaak deze medewerker zijn eigen melding kan voorgaan. */
  const volgt = (x: number) => { let n = 0; if (NA > 0) for (let j = 0; j + NA < N; j++) if (inPlan[j + NA] && !we[j + NA] && isMelding(codes[x][j]) && isVervolg(codes[x][j + NA])) n++; return n; };
  /** Twee dagen wegen vol; bij meer dagen weegt elke dag naar verhouding minder. */
  const verdun = (x: number, v: 'graag' | 'liever_niet') => { const n = (prof[x]?.dagen ?? []).filter((d) => d === v).length; return n > VOLLE_VOORKEUREN ? VOLLE_VOORKEUREN / n : 1; };
  const gewichtGraag = team.map((_, x) => verdun(x, 'graag')), gewichtLiever = team.map((_, x) => verdun(x, 'liever_niet'));
  // de weekenden waarin iemand dit kalenderjaar al was ingeroosterd, vóór de periode die nu wordt gepland
  const jaar = jr[planIdx[0]];
  const eerderWeekenden = team.map((e, x) => {
    const w = new Set<number>();
    for (let i = 0; i < planIdx[0]; i++) if (jr[i] === jaar && we[i] && DIENSTEN[origineel[x][i]].werk) w.add(wk[i]);
    return w.size + (buiten[x].get(jaar) ?? 0);
  });
  const metWeekend = team.map((_, x) => x).filter(telt);
  const gemWeekenden = metWeekend.length ? metWeekend.reduce((a, x) => a + eerderWeekenden[x], 0) / metWeekend.length : 0;
  /** Korte Dg-dagen (DG1) bij wie zijn uren liever over meer dagen spreidt. */
  const korteDag = (x: number) => (prof[x]?.korteDagen === 'graag' ? 4 * lp : prof[x]?.korteDagen === 'liever_niet' ? -6 * lp : 0);
  const tel = (i: number) => {
    let pl = 0, b = 0, n1m = 0, ndg = 0, vg = 0, n2 = 0, enkel = 0, mensen = 0;
    for (let x = 0; x < E; x++) {
      const c = codes[x][i], def = DIENSTEN[c];
      pl += def.plekken;
      if (def.werk) mensen++;
      if (c === '1B') b++;
      if (c === '1M') n1m++;
      if (c === '2') n2++;
      if (isEnkel(c)) enkel++;
      if (def.categorie === 'dossier') { ndg++; vg += def.voorgangen; }
    }
    return { pl, b, n1m, ndg, vg, n2, enkel, mensen };
  };
  /** Eerst met alle wensen, dan zonder "liever vrij"; aangevraagd verlof (2) komt er pas bij als boven contract niet genoeg is. */
  const NIVEAUS: (0 | 1 | 2)[] = [0, 1];
  /** De beste kandidaat voor deze dienst: eerst met alle wensen, dan zonder, dan ook tijdens aangevraagd verlof. */
  const kies = (i: number, s: DienstCode | ((x: number) => DienstCode), extra: (x: number) => number = () => 0, niveaus: (0 | 1 | 2)[] = NIVEAUS, wie: (x: number) => boolean = () => true): [number, DienstCode] | null => {
    for (const niveau of niveaus) {
      let beste: [number, DienstCode] | null = null, bs = -Infinity;
      for (let x = 0; x < E; x++) {
        if (!wie(x)) continue;
        const d = typeof s === 'function' ? s(x) : s;
        if (!mag(x, i, d, niveau)) continue;
        const sc = score(x, i, extra(x)) + vervolg(x, i, d);
        if (sc > bs) { bs = sc; beste = [x, d]; }
      }
      if (beste) return beste;
    }
    return null;
  };
  const tweeVoorkeur = (x: number, i: number) => {
    const tw = prof[x]?.twee, wp = prof[x]?.weekendPlekken;
    // wie liever 3 regelplekken per weekend doet (en minder weekenden), krijgt in het weekend de 2
    return (tw === 'graag' ? 6 * lp : tw === 'liever_niet' ? -8 * lp : 0) + (we[i] ? (wp === 3 ? 6 * lp : wp === 2 ? -6 * lp : 0) : 0);
  };

  // ── 1. regelplekken ──────────────────────────────────────────────────────────
  /** Eén regeldienst erbij op deze dag, in de volgorde 1M, (weekend: 2), 1, 1B. Geeft false als er niets bij kan. */
  const regelStap = (i: number): boolean => {
    const need = behoefte[iso[i]];
    if (!need || need.k <= 0) return false;
    const t = tel(i);
    if (t.pl >= need.k) return false;
    const bDoel = Math.min(beleid.beschikbaarPerDag, need.k), vastDoel = need.k - bDoel, open = vastDoel - (t.pl - t.b);
    if (open > 0) {
      if (t.n1m < beleid.minMiddag) {
        const r = kies(i, '1M', (y) => balans(y) + balansM(y) + (wens[y].get(i) === 'middag' ? 10 : wens[y].get(i) === 'ochtend' ? -10 : pref[y] === 'M' ? 2 : 0));
        if (r) { zet(r[0], i, '1M'); return true; }
      }
      // in het weekend liever een 2: dezelfde plekken met minder mensen, zolang er genoeg enkele diensten blijven
      if (we[i] && beleid.tweeInWeekend && open >= 2 && t.n2 < beleid.maxTwee && t.enkel >= beleid.minEnkelBijTwee) {
        const r = kies(i, '2', (y) => balans(y) + tweeVoorkeur(y, i), [0, 1], (y) => prof[y]?.twee !== 'niet');
        if (r) { zet(r[0], i, '2'); return true; }
      }
      const r = kies(i, '1', balans);
      if (r) {
        const x = r[0];
        // een wens voor middag als dat kan (andere tijden, dus opnieuw toetsen)
        zet(x, i, wens[x].get(i) === 'middag' && mag(x, i, '1M', 1) ? '1M' : '1');
        return true;
      }
    }
    if (t.b < bDoel) {
      const r = kies(i, '1B', (y) => balans(y) + balansB(y) + (wens[y].get(i) === 'ochtend' ? -6 : 0));
      if (r) { zet(r[0], i, '1B'); return true; }
    }
    return false;
  };
  /** Laag voor laag: de dag die het verst achterloopt eerst, en per ronde hoogstens één dienst per dag. */
  const lagen = (dagen: number[], stap: (i: number) => boolean, stand: (i: number) => number) => {
    let open = dagen;
    while (open.length) {
      const volgorde = open.map((i) => ({ i, v: stand(i), r: R.uniform() })).sort((a, b) => a.v - b.v || a.r - b.r);
      open = volgorde.filter(({ i }) => stap(i)).map(({ i }) => i);
    }
  };
  const vulgraad = (i: number) => tel(i).pl / Math.max(1, behoefte[iso[i]]?.k ?? 1);
  const regelVullen = () => {
    lagen(planIdx.filter((i) => we[i]), regelStap, vulgraad);
    lagen(planIdx.filter((i) => !we[i]), regelStap, vulgraad);
    // nog plekken open: van een enkele dienst een 2 maken, als het beleid dat toelaat
    for (const i of planIdx) {
      const need = behoefte[iso[i]];
      if (!need) continue;
      let t = tel(i);
      while (t.pl < need.k && t.n2 < beleid.maxTwee && t.enkel - 1 >= beleid.minEnkelBijTwee) {
        let beste = -1, bs = -Infinity;
        for (let x = 0; x < E; x++) {
          const c = codes[x][i];
          // kan niet is een harde grens
          if (vast[x][i] || !isEnkel(c) || prof[x]?.twee === 'niet') continue;
          // een 2 is twee uur langer: ook dan niet over de grens van de periode
          if (grensAan && geplandeUren[x] + DIENSTEN['2'].uren - DIENSTEN[c].uren > norm[x] * (1 + beleid.bovenContractPct / 100) + 0.01) continue;
          codes[x][i] = '2';
          const ok = geldig(x, i, 1);
          codes[x][i] = c;
          if (!ok) continue;
          const sc = score(x, i, balans(x)) + (c === '1' ? 1 : 0) + tweeVoorkeur(x, i);
          if (sc > bs) { bs = sc; beste = x; }
        }
        if (beste < 0) break;
        zet(beste, i, '2'); t = tel(i);
      }
    }
  };
  const regelTekort = () => planIdx.some((i) => tel(i).pl < (behoefte[iso[i]]?.k ?? 0));
  regelVullen();
  // de regelplekken staan er altijd. Blijft er een open, dan eerst boven het contract (tot de grens uit het beleid),
  // en als laatste ook buiten de eigen weekendbeurt. Wet en CAO (rust, vrije weekenden, dagen achter elkaar) blijven.
  if (regelTekort() && beleid.bovenContractPct > 0) { boven = true; grensAan = true; regelVullen(); }
  if (regelTekort()) { NIVEAUS.push(2); regelVullen(); }
  if (regelTekort() && beleid.omHetWeekend) { buitenBeurt = true; regelVullen(); buitenBeurt = false; }
  boven = false;
  // de samenstelling: staan de plekken er, maar ontbreekt de 1B of de middagdienst (er was op dat moment niemand voor),
  // dan wordt een gewone 1 de 1B of de 1M als dat bij die medewerker kan
  for (const i of planIdx) {
    const need = behoefte[iso[i]];
    if (!need || need.k <= 0) continue;
    const wissel = (naar: DienstCode, extra: (x: number) => number) => {
      // wie al werkt, wisselt alleen van dienst: dat maakt van zijn weekend geen extra weekend
      buitenBeurt = true;
      let beste = -1, bs = -Infinity;
      for (let x = 0; x < E; x++) {
        if (vast[x][i] || codes[x][i] !== '1') continue;
        codes[x][i] = naar;
        const ok = geldig(x, i, 1);
        codes[x][i] = '1';
        if (!ok) continue;
        const sc = extra(x) + R.uniform() * RUIS;
        if (sc > bs) { bs = sc; beste = x; }
      }
      buitenBeurt = false;
      if (beste >= 0) zet(beste, i, naar);
    };
    let t = tel(i);
    if (t.n1m < beleid.minMiddag) { wissel('1M', (y) => balansM(y) + (wens[y].get(i) === 'middag' ? 10 : wens[y].get(i) === 'ochtend' ? -10 : 0)); t = tel(i); }
    // de 1B telt niet als enkele dienst: alleen als er naast een 2 genoeg enkele diensten blijven
    if (t.b < Math.min(beleid.beschikbaarPerDag, need.k) && (t.n2 === 0 || t.enkel - 1 >= beleid.minEnkelBijTwee)) wissel('1B', (y) => balansB(y) + (wens[y].get(i) === 'ochtend' ? -6 : 0));
  }

  // ── 2. Dg-diensten tot het minimum en de voorgangen (niet op zondag) ─────────
  const dgDagen = planIdx.filter((i) => wd[i] !== 0);
  const dgStap = (i: number): boolean => {
    const t = tel(i);
    if (t.ndg >= beleid.minDG && t.vg >= beleid.voorgangenPerDag) return false;
    const r = kies(i, (x) => dossierVoor(team[x].functie), (y) => (isUL[y] ? 3 : 0), [0])
      // past een DG2 nergens meer, dan een korte DG1 (4 uur) bij wie nog een paar uur over heeft
      ?? kies(i, 'DG1', korteDag, [0]);
    // voor het minimum aan Dg-diensten gaan we niet tegen een wens "liever vrij" in: dat gebeurt alleen voor een
    // regelplek, de eerste voorgaansplek van een dag en de DG2 op zaterdag
    if (!r) return false;
    zet(r[0], i, r[1]);
    return true;
  };
  // op zaterdag minstens zoveel keer een DG2 (in te stellen): eerst binnen contract, dan erboven, dan buiten de weekendbeurt
  const zaterdagen = dgDagen.filter((i) => wd[i] === 6);
  const dg2Op = (i: number) => team.filter((_, x) => codes[x][i] === 'DG2').length;
  const zaterdagDG2 = () => {
    for (const i of zaterdagen) {
      for (let n = dg2Op(i); n < beleid.zaterdagDG2; n++) {
        const r = kies(i, 'DG2', undefined, [0, 1]);
        if (!r) break;
        zet(r[0], i, 'DG2');
      }
    }
  };
  const zaterdagTekort = () => zaterdagen.some((i) => dg2Op(i) < beleid.zaterdagDG2);
  if (beleid.zaterdagDG2 > 0) {
    zaterdagDG2();
    if (zaterdagTekort() && beleid.bovenContractPct > 0) { boven = true; grensAan = true; zaterdagDG2(); boven = false; }
    if (zaterdagTekort() && beleid.omHetWeekend) { boven = beleid.bovenContractPct > 0; grensAan = grensAan || boven; buitenBeurt = true; zaterdagDG2(); buitenBeurt = false; boven = false; }
  }
  lagen(dgDagen, dgStap, (i) => tel(i).vg);
  // elke dag (ma-za) minstens één voorgaansplek: waar er nog geen staat, mag het boven het contract, en op zaterdag
  // als laatste ook buiten de eigen weekendbeurt
  const eersteVoorgang = () => {
    for (const i of dgDagen) {
      if (tel(i).vg > 0) continue;
      const r = kies(i, (x) => dossierVoor(team[x].functie), (y) => (isUL[y] ? 3 : 0), [0, 1]) ?? kies(i, 'DG1', korteDag, [0, 1]);
      if (r) zet(r[0], i, r[1]);
    }
  };
  if (beleid.bovenContractPct > 0 && dgDagen.some((i) => tel(i).vg === 0)) { boven = true; grensAan = true; eersteVoorgang(); }
  if (beleid.omHetWeekend && dgDagen.some((i) => tel(i).vg === 0)) { buitenBeurt = true; eersteVoorgang(); buitenBeurt = false; }
  // ook de tweede Dg-plek van een dag mag boven contract, binnen dezelfde grens over de periode
  if (beleid.bovenContractPct > 0 && dgDagen.some((i) => tel(i).ndg < Math.min(2, beleid.minDG))) {
    boven = true; grensAan = true;
    lagen(dgDagen, (i) => {
      if (tel(i).ndg >= Math.min(2, beleid.minDG)) return false;
      const r = kies(i, (x) => dossierVoor(team[x].functie), (y) => (isUL[y] ? 3 : 0), [0]) ?? kies(i, 'DG1', korteDag, [0]);
      if (r) zet(r[0], i, r[1]);
      return !!r;
    }, (i) => tel(i).vg);
  }
  boven = false;
  // minimaal aantal medewerkers: aanvullen met een Dg-dienst, op zondag een regeldienst
  if (beleid.minMedewerkers > 0) {
    for (const i of planIdx) {
      while (tel(i).mensen < beleid.minMedewerkers) {
        const r = wd[i] !== 0 ? kies(i, dossierVoor(), undefined, [0, 1]) ?? kies(i, 'DG1', korteDag, [0, 1]) : beleid.exactePlekken ? null : kies(i, '1', undefined, [0, 1]);
        if (!r) break;
        zet(r[0], i, r[1]);
      }
    }
  }

  // ── 3. aanvullen tot de uren, gelijkmatig over de dagen ──────────────────────
  // telkens één Dg-dienst voor wie het verst onder zijn uren zit, op de dag met de minste Dg-diensten (tot twee keer
  // de voorgaansplekken). Een "liever niet"-dag pas als iemand anders een hele dienst onder zijn uren blijft.
  if (o.aanvullen !== false) {
    const vgMax = Math.max(beleid.voorgangenMaxPerDag, beleid.voorgangenPerDag);
    const vgOp = new Map(dgDagen.map((i) => [i, tel(i).vg]));
    const rang = (x: number, i: number) => (vrijExtra[x][i] || dagVk(x, i) === 'liever_niet' ? 2 : dagVk(x, i) === 'graag' || wens[x].get(i) === 'werken' ? 0 : 1);
    const vulAan = (dienstVoor: (x: number) => DienstCode | null, deel = 1) => {
      const klaar = new Uint8Array(E);
      for (;;) {
        let x = -1, meest = 0;
        for (let y = 0; y < E; y++) {
          if (klaar[y] || team[y].extern || doel[y] <= 0) continue;
          const rest = (doel[y] - geplandeUren[y]) / doel[y] + R.uniform() * 1e-3;
          if (rest > meest) { meest = rest; x = y; }
        }
        if (x < 0) break;
        const dg = dienstVoor(x), rest = doel[x] - geplandeUren[x];
        let beste = -1, bs = Infinity;
        if (dg && rest >= DIENSTEN[dg].uren * deel - 0.01) {
          for (const i of dgDagen) {
            const v = vgOp.get(i)!;
            if (v + DIENSTEN[dg].voorgangen > vgMax) continue;
            const r = rang(x, i);
            if (r === 2 && rest < DIENSTEN[dg].uren + 8 * lp - 0.01) continue;
            if (!mag(x, i, dg, 0)) continue;
            // gelijkmatig over de dagen, dan de voorkeur, dan aansluitend op een werkdag (geen losse dagen)
            // en bij gelijke voorgaansplekken liever op de dag waarop hij een eigen melding kan voorgaan
            const sleutel = v * 100 + r * 10 + (werk(x, i - 1) || werk(x, i + 1) ? 0 : 3) - (NA > 0 && !we[i] && isMelding(codeOp(x, i - NA)) ? 60 : 0) + R.uniform();
            if (sleutel < bs) { bs = sleutel; beste = i; }
          }
        }
        if (beste < 0 || !dg) { klaar[x] = 1; continue; }
        zet(x, beste, dg);
        vgOp.set(beste, vgOp.get(beste)! + DIENSTEN[dg].voorgangen);
      }
    };
    // wie zijn uren liever over meer dagen spreidt (32 uur in 5 dagen), vult aan met korte DG1-dagen
    vulAan((x) => (prof[x]?.korteDagen === 'graag' && !isUL[x] ? 'DG1' : dossierVoor(team[x].functie)));
    // een contract is zelden een veelvoud van 8 uur: wat dan nog open staat, wordt een korte Dg-dag van 4 uur,
    // behalve bij wie dat liever niet heeft
    if (beleid.korteDagAanvullen) vulAan((x) => (prof[x]?.korteDagen === 'graag' ? 'DG1' : null));
    // liever een hele dag en af en toe boven contract dan uren die open blijven: staat er nog minstens een halve dienst
    // open, dan komt er een hele Dg-dienst bij, binnen de grens over de periode. Over de periode komt iemand zo op zijn uren.
    if (beleid.bovenContractPct > 0) { boven = true; grensAan = true; vulAan((x) => dossierVoor(team[x].functie), 0.5); boven = false; }
  }

  // ── 3b. gelijk trekken ───────────────────────────────────────────────────────
  // is er meer bezetting dan werk, dan haalt niemand zijn uren: dan krijgt iedereen ongeveer hetzelfde deel van zijn
  // contract. Een Dg-dienst gaat van wie het grootste deel heeft naar wie het kleinste heeft, zolang dat het verschil
  // kleiner maakt. Regeldiensten en 1B's blijven staan: die zijn al naar contract verdeeld.
  if (o.aanvullen !== false) {
    const wie = team.map((_, x) => x).filter((x) => !team[x].extern && doel[x] > 0);
    const deel = (x: number) => geplandeUren[x] / doel[x];
    for (let ronde = 0; ronde < 400; ronde++) {
      const op = [...wie].sort((a, b) => deel(b) - deel(a));
      const dagen = [...planIdx].sort(() => R.uniform() - 0.5);
      let gedaan = false;
      zoek: for (const hi of op) {
        for (let k = op.length - 1; k >= 0; k--) {
          const lo = op[k];
          // van groot naar klein verschil; onder de 4 procentpunt is het gelijk genoeg
          if (hi === lo || deel(hi) - deel(lo) < 0.04) break;
          for (const i of dagen) {
            const c = codes[hi][i];
            if (vast[hi][i] || DIENSTEN[c].categorie !== 'dossier' || vast[lo][i] || codes[lo][i] !== '-') continue;
            if (NA > 0 && isMelding(codeOp(hi, i - NA))) continue;
            const c1 = dossierVoor(team[lo].functie);
            const a = (geplandeUren[hi] - DIENSTEN[c].uren) / doel[hi], b = (geplandeUren[lo] + DIENSTEN[c1].uren) / doel[lo];
            if (a * a + b * b > deel(hi) ** 2 + deel(lo) ** 2 - 1e-9) continue;
            if (dagVk(lo, i) === 'liever_niet' || vrijExtra[lo][i]) continue;
            // de voorgangen van de dag blijven op peil
            if (tel(i).vg - DIENSTEN[c].voorgangen + DIENSTEN[c1].voorgangen < beleid.voorgangenPerDag) continue;
            if (!mag(lo, i, c1, 0)) continue;
            zet(hi, i, '-'); zet(lo, i, c1);
            gedaan = true;
            break zoek;
          }
        }
      }
      if (!gedaan) break;
    }
  }

  // ── 3c. de Dg-diensten gelijk over de werkdagen ────────────────────────────
  // binnen een week mag het aantal Dg-diensten per werkdag hoogstens één verschillen. Een Dg-dienst gaat van de dag met
  // de meeste naar de dag met de minste, bij dezelfde medewerker. Eerst zonder een dienst te verplaatsen waarmee iemand
  // zijn eigen melding kan voorgaan; lukt het dan nog niet, dan gaat de gelijke verdeling voor. De zaterdag telt niet
  // mee: daar kunnen alleen wie dat weekend werken.
  {
    const weken = new Map<number, number[]>();
    for (const i of dgDagen) if (!we[i]) weken.set(maandagIdx(i), [...(weken.get(maandagIdx(i)) ?? []), i]);
    for (const dagen of weken.values()) {
      for (const streng of [true, false]) {
        for (let ronde = 0; ronde < 60; ronde++) {
          const n = new Map(dagen.map((i) => [i, tel(i).ndg]));
          const op = [...dagen].sort((a, b) => n.get(b)! - n.get(a)!);
          let gedaan = false;
          zoek: for (const van of op) {
            for (let k = op.length - 1; k >= 0; k--) {
              const naar = op[k];
              if (n.get(van)! - n.get(naar)! < 2) break;
              for (let x = 0; x < E; x++) {
                const c = codes[x][van];
                if (vast[x][van] || DIENSTEN[c].categorie !== 'dossier' || vast[x][naar] || codes[x][naar] !== '-') continue;
                if (streng && NA > 0 && isMelding(codeOp(x, van - NA)) && !isMelding(codeOp(x, naar - NA))) continue;
                if (dagVk(x, naar) === 'liever_niet' || vrijExtra[x][naar]) continue;
                codes[x][van] = '-';
                const ok = mag(x, naar, c, 0, DIENSTEN[c].uren);
                codes[x][van] = c;
                if (!ok) continue;
                zet(x, van, '-'); zet(x, naar, c);
                gedaan = true;
                break zoek;
              }
            }
          }
          if (!gedaan) break;
        }
      }
    }
  }

  // ── 4. verschuiven en wisselen ───────────────────────────────────────────────
  if (E > 1) verbeter();

  function verbeter() {
    const periode = planIdx.map((i) => iso[i]);
    const ctx: MwContext[] = team.map((e, x) => maakContext(e, prof[x], [...wens[x].entries()].map(([i, s]) => ({ datum: iso[i], soort: s })), periode, beleid));
    const rij = (x: number) => planIdx.map((i) => codes[x][i]);
    const sc = team.map((_, x) => medewerkerScore(ctx[x], rij(x)));
    const details: MwDetails[] = sc.map((s) => s.details);
    const doelwaarde = (scores: number[], det: MwDetails[]) => 0.75 * (scores.reduce((a, b) => a + b, 0) / E) + 0.25 * eerlijkheid(team, det).score;
    let huidig = doelwaarde(sc.map((s) => s.score), details);
    // een ruil mag de verdeling van 1B's (naar contract) en Dg-dagen over de uitvaartverzorgers niet verder uit
    // elkaar trekken dan nu, of dan 2 1B's per fulltimer en 15% Dg-aandeel; anders wint passen op uren het van eerlijkheid
    const fte = (x: number) => Math.max(0.3, team[x].contract / 36);
    const uv = team.map((_, x) => x).filter(telt);
    const spreiding = (det: MwDetails[]) => {
      let bMin = Infinity, bMax = -Infinity, gMin = Infinity, gMax = -Infinity, mMin = Infinity, mMax = -Infinity;
      for (const x of uv) {
        const b = det[x].beschikbaar / fte(x), g = det[x].werkdagen ? det[x].dg / det[x].werkdagen : 0;
        const m = det[x].middag / (fte(x) * middagGewicht(pref[x]));
        bMin = Math.min(bMin, b); bMax = Math.max(bMax, b); gMin = Math.min(gMin, g); gMax = Math.max(gMax, g);
        mMin = Math.min(mMin, m); mMax = Math.max(mMax, m);
      }
      return uv.length ? { b: bMax - bMin, g: gMax - gMin, m: mMax - mMin } : { b: 0, g: 0, m: 0 };
    };
    let huidigeSpreiding = spreiding(details);
    /** Het deel van de uren van de periode dat nog open staat. */
    const onder = (x: number, uren: number) => (doel[x] > 0 ? Math.max(0, 1 - uren / doel[x]) : 0);
    const probeer = (x1: number, x2: number, volgtWas: number): boolean => {
      // een ruil mag er niet voor zorgen dat iemand zijn eigen melding minder vaak kan voorgaan
      if (volgt(x1) + volgt(x2) < volgtWas) return false;
      const n1 = medewerkerScore(ctx[x1], rij(x1)), n2 = medewerkerScore(ctx[x2], rij(x2));
      // niemand komt door een ruil verder onder zijn uren (naar verhouding) dan de slechtste van de twee al zat, met
      // een halve dienst speling: zo blijft ook bij te veel bezetting ieders deel van het contract ongeveer gelijk
      const was = Math.max(onder(x1, details[x1].uren.gepland), onder(x2, details[x2].uren.gepland));
      for (const [x, n] of [[x1, n1], [x2, n2]] as const) {
        // en niemand komt door een ruil over de grens boven contract
        if (grensAan && n.details.uren.gepland > details[x].uren.gepland && n.details.uren.gepland > norm[x] * (1 + beleid.bovenContractPct / 100) + 0.01) return false;
        if (onder(x, n.details.uren.gepland) > Math.max(was, doel[x] > 0 ? 4 / doel[x] : 0) + 1e-9) return false;
      }
      const scores = sc.map((v, x) => (x === x1 ? n1.score : x === x2 ? n2.score : v.score));
      const det = details.map((d, x) => (x === x1 ? n1.details : x === x2 ? n2.details : d));
      const sp = spreiding(det);
      if (sp.b > Math.max(2, huidigeSpreiding.b) + 1e-9 || sp.g > Math.max(0.15, huidigeSpreiding.g) + 1e-9) return false;
      // ook de middagdiensten niet verder uit elkaar trekken (ruilen ochtend/middag duwt ze anders allemaal naar
      // wie middag liever heeft)
      if (sp.m > Math.max(MIDDAG_SPELING, huidigeSpreiding.m) + 1e-9) return false;
      const nieuw = doelwaarde(scores, det);
      if (nieuw > huidig + 1e-6) {
        huidig = nieuw;
        huidigeSpreiding = sp;
        sc[x1] = n1; sc[x2] = n2; details[x1] = n1.details; details[x2] = n2.details;
        geplandeUren[x1] = n1.details.uren.gepland; geplandeUren[x2] = n2.details.uren.gepland;
        return true;
      }
      return false;
    };

    for (let pass = 0; pass < 6; pass++) {
      let verbeterd = false;
      const volgorde = [...planIdx].sort(() => R.uniform() - 0.5);
      for (const i of volgorde) {
        for (let x1 = 0; x1 < E; x1++) {
          const s = codes[x1][i];
          if (vast[x1][i] || !DIENSTEN[s].werk) continue;
          for (let x2 = 0; x2 < E; x2++) {
            if (x2 === x1 || vast[x2][i]) continue;
            const s2 = codes[x2][i];
            if (s2 === '-') {
              // een Dg-dienst wordt de Dg-dienst van de nieuwe functie
              const s1 = DIENSTEN[s].categorie === 'dossier' ? dossierVoor(team[x2].functie) : s;
              // de voorgaansplekken van de dag blijven gelijk
              if (DIENSTEN[s1].voorgangen !== DIENSTEN[s].voorgangen) continue;
              const was = volgt(x1) + volgt(x2);
              codes[x1][i] = '-'; codes[x2][i] = s1;
              if (geldig(x2, i, 0) && probeer(x1, x2, was)) { verbeterd = true; break; }
              codes[x1][i] = s; codes[x2][i] = '-';
            } else if (DIENSTEN[s2].werk && s2 !== s) {
              const was = volgt(x1) + volgt(x2);
              codes[x1][i] = s2; codes[x2][i] = s;
              if (geldig(x1, i, 1) && geldig(x2, i, 1) && probeer(x1, x2, was)) { verbeterd = true; break; }
              codes[x1][i] = s; codes[x2][i] = s2;
            }
          }
        }
      }
      // kruisruil: x1 geeft een dag waar hij liever niet werkt aan x2, en neemt een dag van x2 terug
      for (const i of volgorde) {
        for (let x1 = 0; x1 < E; x1++) {
          const s = codes[x1][i];
          if (vast[x1][i] || !DIENSTEN[s].werk) continue;
          const ongunstig = dagVk(x1, i) === 'liever_niet' || wens[x1].get(i) === 'vrij' || aanvraag[x1][i] === 1 || (!werk(x1, i - 1) && !werk(x1, i + 1));
          if (!ongunstig) continue;
          zoek: for (let x2 = 0; x2 < E; x2++) {
            if (x2 === x1 || codes[x2][i] !== '-' || vast[x2][i] || team[x2].functie !== team[x1].functie) continue;
            for (const j of planIdx) {
              if (j === i || codes[x2][j] !== s || vast[x2][j] || codes[x1][j] !== '-' || vast[x1][j]) continue;
              const was = volgt(x1) + volgt(x2);
              codes[x1][i] = '-'; codes[x2][j] = '-'; codes[x2][i] = s; codes[x1][j] = s;
              const ok = geldig(x2, i, 0) && geldig(x1, j, 0) && geldig(x2, j, 0) && geldig(x1, i, 0);
              if (ok && probeer(x1, x2, was)) { verbeterd = true; break zoek; }
              codes[x2][i] = '-'; codes[x1][j] = '-'; codes[x1][i] = s; codes[x2][j] = s;
            }
          }
        }
      }
      if (!verbeterd) break;
    }
  }

  // ── wat er leeg bleef, en waarom ─────────────────────────────────────────────
  const tekorten: Tekort[] = [];
  // de reden is wat er na alle stappen nog in de weg staat: de grens boven contract, of wet en CAO
  boven = beleid.bovenContractPct > 0;
  buitenBeurt = true;
  for (const i of planIdx) {
    const need = behoefte[iso[i]];
    const t = tel(i);
    if (!need || t.pl >= need.k) continue;
    const redenen = new Map<string, number>();
    for (let x = 0; x < E; x++) {
      if (team[x].extern || werk(x, i)) continue;
      let r: string | null;
      if (codes[x][i] !== '-') r = codes[x][i] === 'Z' ? 'ziek' : codes[x][i] === 'V' ? 'verlof' : 'afwezig';
      else {
        codes[x][i] = magFunctie(team[x].functie, '1') ? '1' : dossierVoor(team[x].functie);
        r = magFunctie(team[x].functie, '1') ? reden(x, i, 2) : 'andere functie';
        codes[x][i] = '-';
      }
      if (r) redenen.set(r, (redenen.get(r) ?? 0) + 1);
    }
    tekorten.push({ datum: iso[i], tekort: need.k - t.pl, redenen: [...redenen].sort((a, b) => b[1] - a[1]) });
  }
  boven = false;
  buitenBeurt = false;

  const wijzigingen: Wijziging[] = [];
  for (let x = 0; x < E; x++) {
    for (const i of planIdx) {
      if (codes[x][i] !== origineel[x][i]) wijzigingen.push([team[x].id, iso[i], codes[x][i]]);
    }
  }
  return { wijzigingen, tekorten };
}
