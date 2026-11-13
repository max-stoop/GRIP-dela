/**
 * Bijsturen bij de NBD zoals bij de regio's: per dag het verschil in uren aan de telefoon tussen de roosterbasis en de
 * laatste voorspelling, met acties in vaste volgorde, eerst wat het minst vraagt van de medewerkers. Te weinig: pauze
 * of taak verschuiven, dienst verlengen, een vrije medewerker, een externe kracht, terugbellen. Te veel: een dienst
 * inkorten, iemand vrij geven. Een actie met een harde ATW- of CAO-overtreding valt af.
 */
import type { RuilBevinding } from '../rooster/ruil';
import { ZZP_IN_ROOSTER, type Beleid, type Cellen, type Medewerker, type Taak, type Tijden, type Voorkeurprofiel, type Wens } from '../rooster/types';
import type { Verlof } from '../store/types';
import { uurTekst } from '../rooster/tijden';
import { diffDays, toDay, weekday } from '../dates';
import { kwartierIndex, kwartierenOpen, type NbdDag } from './behoefte';
import { aanTelefoon, bruto, dienstTekst, kwartier, maakDienst, netto, pastTaak, pauzeBegin, pauzeNodig, pauzeTekst, TAAK_LABEL, type NbdDienst } from './dienst';
import { dienstTegenVoorkeur } from './voorkeuren';
import { absoluut, blokkenVan, nbdDienst, weekVan, werkInWeek } from './blokken';
import { maxUren } from './capaciteit';
import { dagServiceLevel, dekking } from './toets';
import { nbdRuilToets } from './ruil';
import { maakNbdRooster, type NbdWijziging } from './voorstel';
import type { NbdParameters } from './parameters';

export type NbdActieSoort = 'pauze' | 'taak' | 'verlengen' | 'inplannen' | 'extern' | 'terugbellen' | 'inkorten' | 'vrijgeven';

export const NBD_ACTIE_LABEL: Record<NbdActieSoort, string> = {
  pauze: 'Pauze verschuiven',
  taak: 'Taak verschuiven',
  verlengen: 'Verlengen',
  inplannen: 'Inplannen',
  extern: 'Extern',
  terugbellen: 'Terugbellen',
  inkorten: 'Inkorten',
  vrijgeven: 'Vrij geven',
};

export interface NbdActie {
  soort: NbdActieSoort;
  tekst: string;
  wijzigingen: NbdWijziging[];
  /** Een vrije dag binnen 28 dagen, of andere tijden binnen 4 dagen. */
  overleg: boolean;
  bevindingen: RuilBevinding[];
  /** null bij een notitie. */
  slNa: number | null;
  /** Negatief: minder. */
  uren: number;
}

export interface NbdBijstuurDag {
  datum: string;
  gesprekkenBasis: number | null;
  gesprekkenNu: number | null;
  /** Volgens de roosterbasis en volgens de laatste voorspelling. */
  urenBasis: number | null;
  urenNu: number | null;
  /** Zonder pauzes. */
  gepland: number;
  /** Per open kwartier. */
  dekking: number[];
  /** Tegenover de laatste voorspelling, per kwartier opgeteld. */
  tekort: number;
  over: number;
  sl: number;
  status: 'ok' | 'tekort' | 'teveel';
  ziek: string[];
  acties: NbdActie[];
  /** Binnen 28 dagen. */
  binnenVast: boolean;
  /** Binnen 4 dagen. */
  binnenTijden: boolean;
}

interface NbdBijsturing {
  dagen: NbdBijstuurDag[];
  samenvatting: {
    tekortDagen: number;
    teveelDagen: number;
    /** Minstens een uur verschil met de basis. */
    urenOmhoog: number;
    urenOmlaag: number;
    /** Laatste ten opzichte van de basis. */
    gesprekkenVerschil: number | null;
    ziekDagen: number;
  };
}

interface NbdBijstuurOpties {
  team: Medewerker[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  dates: string[];
  /** Waarop het rooster is gemaakt (roosterbasis). */
  basis: Record<string, NbdDag>;
  nu: Record<string, NbdDag>;
  p: NbdParameters;
  beleid: Pick<Beleid, 'vastDagen' | 'tijdenDagen' | 'minVrijeWeekenden'>;
  vandaag: string;
  profielen?: Record<string, Voorkeurprofiel>;
  wensen?: Wens[];
  aanvragen?: Verlof[];
  maxActies?: number;
  /** Standaard ZZP_IN_ROOSTER. */
  zzp?: boolean;
}

const EPS = 1e-9;

export function nbdBijsturen(o: NbdBijstuurOpties): NbdBijsturing {
  const { cellen, tijden, dates, basis, nu, p, beleid, vandaag } = o;
  const maxActies = o.maxActies ?? 7;
  const team = o.team.filter((m) => m.actief);
  const ks = kwartierenOpen(p);
  const naam = (mid: string) => team.find((m) => m.id === mid)?.naam ?? '';
  // een externe kracht werkt hoogstens zijn opgegeven uren per week
  const externCap = (m: Medewerker) => Math.min(p.maxWeekUren, m.contract);
  const weekRuimte = (m: Medewerker, d: string) => Math.min(maxUren(m), p.maxWeekUren) - werkInWeek(blokkenVan(cellen, tijden, m.id), weekVan(d));
  const toets = (w: NbdWijziging[]) => nbdRuilToets({ team, cellen, tijden, wijzigingen: w, p, minVrijeWeekenden: beleid.minVrijeWeekenden, profielen: o.profielen, aanvragen: o.aanvragen });
  /** Kwartieren van een dienst in uren die de medewerker niet kan en in uren die hij of zij graag werkt. */
  const voorkeur = (mid: string, d: string, x: NbdDienst) => {
    const u = o.profielen?.[mid]?.uren;
    return u ? dienstTegenVoorkeur(u, d, x.start, x.eind) : { graag: 0, niet: 0, totaal: 0, heeftGraag: false };
  };
  /** Een verlofaanvraag die nog niet is beoordeeld: dan geen extra werk voorstellen. */
  const aanvraag = (mid: string, d: string) => !!o.aanvragen?.some((v) => v.medewerkerId === mid && v.status === 'aangevraagd' && v.van <= d && v.tot >= d);

  /** Met de pauze die de ATW vraagt, op het opgegeven moment als dat kan. */
  const venster = (start: number, eind: number, pauzeStart?: number | null): NbdDienst => {
    const b = eind - start;
    const pauze = b > p.pauzeNa + EPS ? Math.max(p.pauzeMinuten, pauzeNodig(p, b - p.pauzeMinuten / 60)) : 0;
    const x: NbdDienst = { start: kwartier(start), eind: kwartier(eind), pauze };
    if (pauze && pauzeStart != null && pauzeStart >= x.start + 1 - EPS && pauzeStart + pauze / 60 <= x.eind - 1 + EPS) x.pauzeStart = kwartier(pauzeStart);
    return x;
  };

  const dagen: NbdBijstuurDag[] = dates.map((d) => {
    const dag = nu[d], was = basis[d];
    const diensten = new Map<string, NbdDienst>();
    for (const m of team) {
      const x = nbdDienst(cellen, tijden, m.id, d);
      if (x) diensten.set(m.id, x);
    }
    const nodig = dag ? dag.kwartieren.map((k) => k.nodig) : ks.map(() => 0);
    const cov = dekking(p, [...diensten.values()]);
    const tekortVan = (c: number[]) => nodig.reduce((a, n, i) => a + Math.max(0, n - c[i]), 0) / 4;
    const overVan = (c: number[]) => nodig.reduce((a, n, i) => a + Math.max(0, c[i] - n), 0) / 4;
    const slVan = (c: number[]) => (dag ? dagServiceLevel(p, dag, c) : 1);
    const tekort = tekortVan(cov), over = overVan(cov), sl = slVan(cov);
    const gepland = cov.reduce((a, x) => a + x, 0) / 4;
    const status: NbdBijstuurDag['status'] = !dag ? 'ok'
      : sl < p.serviceLevel - EPS || tekort > 1 + EPS ? 'tekort'
        // te veel alleen als de bijvoorspelling minder vraagt dan de basis: de ruimte tot de contracturen is
        // bewust (verzuim, verlof), net als bij de regio's
        : over >= p.minDienst - EPS && gepland - dag.uren >= p.minDienst - EPS && (!was || was.uren - dag.uren >= 1 - EPS) ? 'teveel' : 'ok';
    const ziek = team.filter((m) => cellen[m.id]?.[d] === 'Z').map((m) => m.naam);
    const binnenVast = diffDays(d, vandaag) < beleid.vastDagen, binnenTijden = diffDays(d, vandaag) < beleid.tijdenDagen;

    /** null: geen dienst meer. */
    const covMet = (anders: [string, NbdDienst | null][]) => {
      const m = new Map(diensten);
      for (const [mid, x] of anders) if (x) m.set(mid, x); else m.delete(mid);
      return dekking(p, [...m.values()]);
    };
    const acties: NbdActie[] = [];
    const voeg = (soort: NbdActieSoort, tekst: string, w: NbdWijziging[], overleg: boolean): boolean => {
      if (acties.length >= maxActies) return false;
      if (!w.length) { acties.push({ soort, tekst, wijzigingen: [], overleg: false, bevindingen: [], slNa: null, uren: 0 }); return true; }
      const t = toets(w);
      if (!t.ok) return false;
      const c = covMet(w.filter(([, dd]) => dd === d).map(([mid, , code, x]) => [mid, code === 'N' ? x : null]));
      acties.push({ soort, tekst, wijzigingen: w, overleg, bevindingen: t.bevindingen, slNa: slVan(c), uren: (c.reduce((a, x) => a + x, 0) - cov.reduce((a, x) => a + x, 0)) / 4 });
      return true;
    };
    /** De pauze op het moment met het minste tekort, liefst in het midden. */
    const bestePauze = (x: NbdDienst, zonder: number[]): NbdDienst => {
      if (!x.pauze) return x;
      const duur = x.pauze / 60, midden = x.start + (bruto(x) - duur) / 2;
      let beste: number | null = null, kost = Infinity;
      for (let pb = x.start + 1; pb + duur <= x.eind - 1 + EPS; pb += 0.25) {
        if ((x.taken ?? []).some((t) => pb < t.tot - EPS && pb + duur > t.van + EPS)) continue;
        let k = Math.abs(pb - midden) * 0.01;
        for (let q = pb; q < pb + duur - EPS; q += 0.25) {
          const i = kwartierIndex(p, q);
          if (i >= 0 && i < ks.length) k += Math.max(0, nodig[i] - (zonder[i] - 1));
        }
        if (k < kost - EPS) { kost = k; beste = pb; }
      }
      return beste == null ? x : { ...x, pauzeStart: kwartier(beste) };
    };
    const zonderPauze = (mid: string, x: NbdDienst) => covMet([[mid, { start: x.start, eind: x.eind, pauze: 0, ...(x.taken ? { taken: x.taken } : {}) }]]);
    const botst = (z: NbdDienst) => (z.taken ?? []).some((k) => !pastTaak({ ...z, taken: (z.taken ?? []).filter((t) => t !== k) }, k));
    /** De pauze komt op het rustigste moment buiten de taken; een taak die niet meer past, vervalt. */
    const metTakenVan = (mid: string, oud: NbdDienst, y: NbdDienst): { y: NbdDienst; weg: Taak[] } => {
      let z: NbdDienst = { ...y };
      delete z.taken;
      const binnen = (oud.taken ?? []).filter((k) => k.van >= y.start - EPS && k.tot <= y.eind + EPS).map((k) => ({ ...k }));
      if (binnen.length) z.taken = binnen;
      if (z.pauze && (z.pauzeStart == null || botst(z))) z = bestePauze({ ...z, pauzeStart: undefined }, zonderPauze(mid, z));
      const blijft = (z.taken ?? []).filter((k) => pastTaak({ ...z, taken: (z.taken ?? []).filter((t) => t !== k) }, k));
      if (blijft.length) z.taken = blijft; else delete z.taken;
      const weg = (oud.taken ?? []).filter((k) => !blijft.some((b) => b.soort === k.soort && Math.abs(b.van - k.van) < EPS && Math.abs(b.tot - k.tot) < EPS));
      return { y: z, weg };
    };
    const vervalt = (weg: Taak[]) => (weg.length ? `; ${[...new Set(weg.map((k) => TAAK_LABEL[k.soort].toLowerCase()))].join(' en ')} vervalt` : '');

    if (status === 'tekort' && dag) {
      // 1. een pauze naar een rustiger moment
      let pauzeBest: { mid: string; x: NbdDienst; winst: number } | null = null;
      for (const [mid, x] of diensten) {
        if (!x.pauze) continue;
        const y = bestePauze(x, zonderPauze(mid, x));
        if (y.pauzeStart == null || pauzeBegin(y) === pauzeBegin(x)) continue;
        const winst = tekort - tekortVan(covMet([[mid, y]]));
        if (winst >= 0.25 - EPS && (!pauzeBest || winst > pauzeBest.winst + EPS)) pauzeBest = { mid, x: y, winst };
      }
      if (pauzeBest) {
        const b = pauzeBegin(pauzeBest.x)!;
        voeg('pauze', `${naam(pauzeBest.mid)}: pauze naar ${uurTekst(b)}–${uurTekst(b + pauzeBest.x.pauze / 60)} (was ${pauzeTekst(diensten.get(pauzeBest.mid)!).replace('pauze ', '')})`, [[pauzeBest.mid, d, 'N', pauzeBest.x]], binnenTijden);
      }

      // 1b. een training of klachtenblok verschuiven (de maandstart ligt vast)
      const taakOpties: { mid: string; y: NbdDienst; winst: number; tekst: string }[] = [];
      for (const [mid, x] of diensten) {
        for (const k of x.taken ?? []) {
          if (k.soort === 'maandstart') continue;
          const rest: NbdDienst = { ...x, taken: (x.taken ?? []).filter((t) => t !== k) };
          let beste: { y: NbdDienst; winst: number } | null = null;
          for (let van = x.start; van + (k.tot - k.van) <= x.eind + EPS; van += 0.25) {
            const nieuw = { ...k, van, tot: van + (k.tot - k.van) };
            if (Math.abs(van - k.van) < EPS || !pastTaak(rest, nieuw)) continue;
            const y: NbdDienst = { ...x, taken: [...(rest.taken ?? []), nieuw].sort((a, b) => a.van - b.van) };
            const winst = tekort - tekortVan(covMet([[mid, y]]));
            if (winst >= 0.25 - EPS && (!beste || winst > beste.winst + EPS)) beste = { y, winst };
          }
          if (beste) {
            const nieuw = beste.y.taken!.find((t) => t.soort === k.soort && !(x.taken ?? []).includes(t))!;
            taakOpties.push({ mid, y: beste.y, winst: beste.winst, tekst: `${naam(mid)}: ${TAAK_LABEL[k.soort].toLowerCase()} naar ${uurTekst(nieuw.van)}–${uurTekst(nieuw.tot)} (was ${uurTekst(k.van)}–${uurTekst(k.tot)})` });
          }
        }
      }
      taakOpties.sort((a, b) => b.winst - a.winst);
      for (const t of taakOpties.slice(0, 2)) voeg('taak', t.tekst, [[t.mid, d, 'N', t.y]], false);

      // 2. verlengen, zolang de rust tot de dienst ervoor en erna het toelaat
      const verlengingen: { m: Medewerker; opties: { y: NbdDienst; weg: Taak[] }[]; erbij: number; ruimte: number }[] = [];
      for (const m of team) {
        const x = diensten.get(m.id);
        if (!x || aanvraag(m.id, d)) continue;
        const max = Math.floor((p.maxDienst - netto(x)) * 4 + EPS);
        if (max < 2) continue;
        const nul = absoluut(d, 0), bl = blokkenVan(cellen, tijden, m.id);
        const ervoor = bl.filter((y) => y.tot <= nul + x.start + EPS && y.datum !== d).at(-1);
        const erna = bl.find((y) => y.van >= nul + x.eind - EPS && y.datum !== d);
        const laatst = erna ? erna.van - p.minRust - nul : Infinity, vroegst = ervoor ? ervoor.tot + p.minRust - nul : -Infinity;
        let na = 0, voor = 0;
        for (let i = kwartierIndex(p, x.eind); i < ks.length && na < max && nodig[i] > cov[i] && ks[i] + 0.25 <= laatst + EPS; i++) na++;
        for (let i = kwartierIndex(p, x.start) - 1; i >= 0 && voor < max && nodig[i] > cov[i] && ks[i] >= vroegst - EPS; i--) voor++;
        const opties: { y: NbdDienst; weg: Taak[] }[] = [];
        for (const [kant, k] of [['na', na], ['voor', voor]] as const) {
          if (k < 2) continue;
          let y = kant === 'na' ? venster(x.start, x.eind + k / 4, pauzeBegin(x)) : venster(x.start - k / 4, x.eind, pauzeBegin(x));
          // past de werktijd niet meer door een langere pauze, dan een kwartier minder
          while (netto(y) > p.maxDienst + EPS) y = kant === 'na' ? venster(y.start, y.eind - 0.25, y.pauzeStart) : venster(y.start + 0.25, y.eind, y.pauzeStart);
          // niet verlengen in uren die de medewerker niet kan: dan zoveel korter als nodig
          while (netto(y) > netto(x) + 0.25 + EPS && voorkeur(m.id, d, y).niet > voorkeur(m.id, d, x).niet) y = kant === 'na' ? venster(y.start, y.eind - 0.25, y.pauzeStart) : venster(y.start + 0.25, y.eind, y.pauzeStart);
          if (netto(y) <= netto(x) + 0.25 + EPS) continue;
          opties.push(metTakenVan(m.id, x, y));
        }
        if (!opties.length) continue;
        // eerst zonder taken die vervallen, dan liefst in uren die de medewerker graag werkt, dan zo veel mogelijk erbij
        opties.sort((a1, a2) => a1.weg.length - a2.weg.length || voorkeur(m.id, d, a2.y).graag - voorkeur(m.id, d, a1.y).graag || netto(a2.y) - netto(a1.y));
        verlengingen.push({ m, opties, erbij: netto(opties[0].y) - netto(x), ruimte: weekRuimte(m, d) });
      }
      verlengingen.sort((a1, a2) => Number(a2.ruimte >= a2.erbij) - Number(a1.ruimte >= a1.erbij) || a2.erbij - a1.erbij || a2.ruimte - a1.ruimte);
      let n = 0;
      for (const v of verlengingen.slice(0, 8)) {
        if (n >= 2) break;
        const oud = diensten.get(v.m.id)!;
        for (const { y, weg } of v.opties) {
          const erbij = netto(y) - netto(oud);
          const wat = y.start < oud.start ? `eerder beginnen om ${uurTekst(y.start)}` : `langer tot ${uurTekst(y.eind)}`;
          if (voeg('verlengen', `${v.m.naam}: ${wat} (${dienstTekst(y)}, ${String(Math.round(erbij * 100) / 100).replace('.', ',')} uur erbij${vervalt(weg)})`, [[v.m.id, d, 'N', y]], binnenTijden)) { n++; break; }
        }
      }

      // 3. een vrije medewerker
      const v = maakNbdRooster({
        team: team.filter((m) => !m.extern), dates: [d], cellen, tijden, behoefte: { [d]: dag }, p,
        profielen: o.profielen, wensen: o.wensen, aanvragen: o.aanvragen, modus: 'aanvullen', minVrijeWeekenden: beleid.minVrijeWeekenden, totContract: false,
      });
      n = 0;
      for (const [mid, dd, code, x] of v.wijzigingen) {
        if (n >= 2 || dd !== d || code !== 'N' || !x || diensten.has(mid)) continue;
        if (voeg('inplannen', `${naam(mid)} inplannen: ${dienstTekst(x)}, ${pauzeTekst(x)}`, [[mid, d, 'N', x]], binnenVast)) n++;
      }

      // 4. een externe kracht
      let q0 = -1, lengte = 0;
      for (let i = 0; i < ks.length;) {
        if (nodig[i] <= cov[i]) { i++; continue; }
        let j = i;
        while (j < ks.length && nodig[j] > cov[j]) j++;
        if (j - i > lengte) { q0 = i; lengte = j - i; }
        i = j;
      }
      if (q0 >= 0) {
        if (o.zzp ?? ZZP_IN_ROOSTER) {
          const werk = Math.min(p.maxDienst, Math.max(p.minDienst, lengte / 4));
          let gedaan = false;
          for (const m of team.filter((x) => x.extern && (cellen[x.id]?.[d] ?? '-') === '-' && o.profielen?.[x.id]?.dagen[weekday(toDay(d))] !== 'niet')) {
            const w = Math.floor(Math.min(werk, externCap(m) - werkInWeek(blokkenVan(cellen, tijden, m.id), weekVan(d))) * 4) / 4;
            if (w < p.minDienst - EPS) continue;
            let x = maakDienst(p, ks[q0], w);
            if (x.eind > p.sluit + EPS) x = maakDienst(p, Math.max(p.open, p.sluit - bruto(x)), w);
            x = bestePauze(x, zonderPauze(m.id, x));
            if (voeg('extern', `${m.naam} (extern) inzetten: ${dienstTekst(x)}, ${pauzeTekst(x)}`, [[m.id, d, 'N', x]], binnenVast)) { gedaan = true; break; }
          }
          if (!gedaan) {
            const van = ks[q0], tot = Math.min(p.sluit, van + Math.max(lengte / 4, p.minDienst));
            voeg('extern', `Zet een externe kracht in van ${uurTekst(van)} tot ${uurTekst(tot)}`, [], false);
          }
        }
        // 5. terugbellen: verderop op de dag staan meer mensen dan nodig
        const vanaf = q0 + lengte;
        for (let i = vanaf; i < ks.length - 1; i++) {
          if (cov[i] > nodig[i] && cov[i + 1] > nodig[i + 1]) {
            voeg('terugbellen', `Neem terugbelverzoeken aan en bel terug vanaf ${uurTekst(ks[i])}: dan staan er meer mensen dan nodig`, [], false);
            break;
          }
        }
      }
    } else if (status === 'teveel' && dag) {
      // te veel, 1. inkorten waar zonder deze medewerker genoeg mensen staan
      const volgorde = [...diensten.entries()].map(([mid, x]) => {
        const m = team.find((y) => y.id === mid)!;
        return { m, x, boven: werkInWeek(blokkenVan(cellen, tijden, mid), weekVan(d)) - m.contract };
      }).sort((a, b) => b.boven - a.boven || netto(b.x) - netto(a.x));
      let n = 0;
      for (const { m, x } of volgorde) {
        if (n >= 2) break;
        const max = Math.floor((netto(x) - p.minDienst) * 4 + EPS);
        if (max < 4) continue;
        const genoeg = (i: number) => i >= 0 && i < ks.length && cov[i] - 1 >= nodig[i];
        let eind = 0, begin = 0;
        for (let i = kwartierIndex(p, x.eind) - 1; eind < max && genoeg(i) && aanTelefoon(x, ks[i]); i--) eind++;
        for (let i = kwartierIndex(p, x.start); begin < max && genoeg(i) && aanTelefoon(x, ks[i]); i++) begin++;
        if (Math.max(eind, begin) < 4) continue;
        const kort = eind >= begin ? venster(x.start, x.eind - eind / 4, pauzeBegin(x)) : venster(x.start + begin / 4, x.eind, pauzeBegin(x));
        if (netto(kort) < p.minDienst - EPS) continue;
        const { y, weg } = metTakenVan(m.id, x, kort);
        // de maandstart laten we niet vallen voor een kortere dienst
        if (weg.some((k) => k.soort === 'maandstart')) continue;
        const minder = netto(x) - netto(y);
        const wat = y.eind < x.eind ? `eerder naar huis om ${uurTekst(y.eind)}` : `later beginnen om ${uurTekst(y.start)}`;
        if (voeg('inkorten', `${m.naam}: ${wat} (${dienstTekst(y)}, ${String(Math.round(minder * 100) / 100).replace('.', ',')} uur minder${vervalt(weg)})`, [[m.id, d, 'N', y]], binnenTijden)) n++;
      }
      // 2. iemand vrij geven als de dekking zonder kan
      for (const { m, x } of volgorde) {
        if (x.taken?.some((k) => k.soort === 'maandstart')) continue;
        const kan = ks.every((t, i) => !aanTelefoon(x, t) || cov[i] - 1 >= nodig[i]);
        if (!kan) continue;
        if (voeg('vrijgeven', `${m.naam} vrij geven (de dienst ${dienstTekst(x)} vervalt${vervalt(x.taken ?? [])})`, [[m.id, d, '-', null]], binnenVast)) break;
      }
    }

    return {
      datum: d,
      gesprekkenBasis: was?.gesprekken ?? null, gesprekkenNu: dag?.gesprekken ?? null,
      urenBasis: was?.uren ?? null, urenNu: dag?.uren ?? null,
      gepland, dekking: cov, tekort, over, sl, status, ziek, acties, binnenVast, binnenTijden,
    };
  });

  let gb = 0, gn = 0;
  for (const x of dagen) if (x.gesprekkenBasis != null && x.gesprekkenNu != null) { gb += x.gesprekkenBasis; gn += x.gesprekkenNu; }
  return {
    dagen,
    samenvatting: {
      tekortDagen: dagen.filter((x) => x.status === 'tekort').length,
      teveelDagen: dagen.filter((x) => x.status === 'teveel').length,
      urenOmhoog: dagen.filter((x) => x.urenBasis != null && x.urenNu != null && x.urenNu - x.urenBasis >= 1).length,
      urenOmlaag: dagen.filter((x) => x.urenBasis != null && x.urenNu != null && x.urenBasis - x.urenNu >= 1).length,
      gesprekkenVerschil: gb > 0 ? gn / gb - 1 : null,
      ziekDagen: dagen.reduce((a, x) => a + x.ziek.length, 0),
    },
  };
}
