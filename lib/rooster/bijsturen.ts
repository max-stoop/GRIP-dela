/**
 * Bijsturen: per dag het verschil tussen de roosterbasis en de laatste voorspelling, met acties in de volgorde van het
 * stroomschema dagsturing. Te weinig: Dg opschalen of een extra regeling, een vrije medewerker, buurregio's, een
 * ZZP'er, de melding naar de volgende dag. Te veel: omzetten naar Dg, of een 2 terug naar een 1. Elke actie met
 * roosterwijzigingen gaat eerst door de ruiltoets.
 */
import { diffDays, fmtDag, fromDay, mondayOf, toDay, weekday } from '../dates';
import { DIENSTEN, dossierVoor, isEnkel, magFunctie } from './diensten';
import { cel } from './toets';
import { ruilToets, type RuilBevinding } from './ruil';
import type { Wijziging } from './voorstel';
import { ZZP_IN_ROOSTER, dagVoorkeurOp, type Behoefte, type Beleid, type Cellen, type DienstCode, type Medewerker, type Tijden, type Voorkeurprofiel, type Wens } from './types';
import type { Verlof } from '../store/types';

export type ActieSoort = 'opschalen' | 'extra-regeling' | 'inplannen' | 'buurregio' | 'zzp' | 'verplaatsen' | 'afschalen' | 'naar-1b' | 'twee-terug' | 'voorgang';

export const ACTIE_LABEL: Record<ActieSoort, string> = {
  opschalen: 'Dg opschalen',
  'extra-regeling': 'Extra regeling',
  inplannen: 'Inplannen',
  buurregio: 'Buurregio',
  zzp: 'ZZP',
  verplaatsen: 'Verplaatsen',
  afschalen: 'Naar Dg',
  'naar-1b': 'Naar 1B',
  'twee-terug': '2 naar 1',
  voorgang: 'Voorgang',
};

export interface Actie {
  soort: ActieSoort;
  tekst: string;
  wijzigingen: Wijziging[];
  /** Een vrije dag binnen 28 dagen, of andere tijden binnen 4 dagen. */
  overleg: boolean;
  bevindingen: RuilBevinding[];
}

export interface BijstuurDag {
  datum: string;
  lamBasis: number | null;
  lamNu: number | null;
  kBasis: number | null;
  kNu: number | null;
  kNorm: number | null;
  /** Inclusief 1B. */
  p: number;
  voorgangen: number;
  status: 'ok' | 'tekort' | 'teveel';
  ziek: string[];
  acties: Actie[];
  /** Binnen 28 dagen. */
  binnenVast: boolean;
  /** Binnen 4 dagen. */
  binnenTijden: boolean;
}

export interface Bijsturing {
  dagen: BijstuurDag[];
  samenvatting: {
    tekortDagen: number;
    teveelDagen: number;
    /** Ander aantal plekken dan de roosterbasis. */
    kVeranderd: number;
    kOmhoog: number;
    kOmlaag: number;
    /** Laatste ten opzichte van de basis. */
    lamVerschil: number | null;
    ziekDagen: number;
    voorgangTekort: number;
  };
}

export interface BijstuurOpties {
  team: Medewerker[];
  cellen: Cellen;
  dates: string[];
  /** Waarop het rooster is gemaakt (roosterbasis). */
  basis: Behoefte;
  nu: Behoefte;
  beleid: Beleid;
  vandaag: string;
  /** Plekken over in andere regio's van het cluster. */
  buren?: (datum: string) => { regio: string; over: number }[];
  maxActies?: number;
  /** Voor de rust in de toets van elke actie. */
  tijden?: Tijden;
  /** Standaard ZZP_IN_ROOSTER. */
  zzp?: boolean;
  /** Vaste voorkeuren: "kan niet" op een weekdag of voor een dubbele dienst stelt GRIP niet voor. */
  profielen?: Record<string, Voorkeurprofiel>;
  /** Wensen in de regio: wie die dag vrij wil, krijgt geen extra werk voorgesteld. */
  wensen?: Wens[];
  /** Verlofaanvragen: wie voor die dag verlof heeft aangevraagd, krijgt geen extra werk voorgesteld. */
  aanvragen?: Verlof[];
}

/** null: niets bekend. */
export function geenExtraWerk(o: Pick<BijstuurOpties, 'profielen' | 'wensen' | 'aanvragen'>, mid: string, d: string): string | null {
  if (o.aanvragen?.some((v) => v.medewerkerId === mid && v.status === 'aangevraagd' && v.van <= d && v.tot >= d)) return 'verlof aangevraagd';
  const wens = o.wensen?.find((w) => w.medewerkerId === mid && w.datum === d)?.soort;
  if (wens === 'vrij') return 'wil die dag vrij';
  // een wens om die dag te werken gaat voor de vaste voorkeur van de weekdag
  if (dagVoorkeurOp(o.profielen?.[mid]?.dagen?.[weekday(toDay(d))], wens) === 'niet') return 'kan niet op deze weekdag';
  return null;
}

function overlegNodig(cellen: Cellen, w: Wijziging[], vandaag: string, beleid: Beleid): boolean {
  return w.some(([m, d, s]) => {
    const dagen = diffDays(d, vandaag);
    const oud = cel(cellen, m, d);
    if (dagen < beleid.vastDagen && !DIENSTEN[oud].werk && DIENSTEN[s].werk) return true;
    if (dagen < beleid.tijdenDagen && (DIENSTEN[oud].start !== DIENSTEN[s].start || DIENSTEN[oud].eind !== DIENSTEN[s].eind)) return true;
    return false;
  });
}

export function bijsturen(o: BijstuurOpties): Bijsturing {
  const { team, cellen, dates, basis, nu, beleid, vandaag } = o;
  const maxActies = o.maxActies ?? 4;
  const actief = team.filter((e) => e.actief);
  const telDag = (c: Cellen, d: string) => {
    let p = 0, vg = 0, n2 = 0, enkel = 0, n1m = 0;
    for (const e of actief) {
      const s = cel(c, e.id, d), def = DIENSTEN[s];
      p += def.plekken; vg += def.voorgangen;
      if (s === '2') n2++;
      if (s === '1M') n1m++;
      if (isEnkel(s)) enkel++;
    }
    return { p, vg, n2, enkel, n1m };
  };
  const maak = (soort: ActieSoort, tekst: string, w: Wijziging[]): Actie | null => {
    const t = w.length ? ruilToets({ team: actief, cellen, wijzigingen: w, beleid, tijden: o.tijden }) : { ok: true, bevindingen: [] };
    if (!t.ok) return null;
    return { soort, tekst, wijzigingen: w, overleg: overlegNodig(cellen, w, vandaag, beleid), bevindingen: t.bevindingen };
  };
  const weekUren = (mid: string, d: string) => {
    const m = mondayOf(toDay(d));
    let h = 0;
    for (let i = 0; i < 7; i++) h += DIENSTEN[cel(cellen, mid, fromDay(m + i))].uren;
    return h;
  };
  const isZondag = (d: string) => weekday(toDay(d)) === 0;

  const dagen: BijstuurDag[] = dates.map((d, idx) => {
    const b = basis[d] ?? null, n = nu[d] ?? null;
    const t = telDag(cellen, d);
    const kNu = n?.k ?? null;
    const status: BijstuurDag['status'] = kNu == null ? 'ok' : t.p < kNu ? 'tekort' : beleid.exactePlekken && t.p > kNu ? 'teveel' : 'ok';
    const ziek = actief.filter((e) => cel(cellen, e.id, d) === 'Z').map((e) => e.naam);
    const acties: Actie[] = [];
    const voeg = (a: Actie | null) => { if (a && acties.length < maxActies) acties.push(a); };
    // liefst wie onder het contract zit; wie liever niet werkt op deze weekdag, komt achteraan
    const lieverNiet = (e: Medewerker) => (o.profielen?.[e.id]?.dagen?.[weekday(toDay(d))] === 'liever_niet' ? 1 : 0);
    const sorteer = (ids: Medewerker[]) => [...ids].sort((a, c) => lieverNiet(a) - lieverNiet(c) || (weekUren(a.id, d) - a.contract) - (weekUren(c.id, d) - c.contract));
    const eerste = (kandidaten: Medewerker[], actie: (e: Medewerker) => Actie | null) => {
      for (const e of kandidaten) {
        const a = actie(e);
        if (a) { voeg(a); return; }
      }
    };

    if (status === 'tekort') {
      const tekort = kNu! - t.p;
      // 1a. Dg opschalen naar een regeldienst
      for (const e of sorteer(actief.filter((x) => cel(cellen, x.id, d) === 'DG2' && magFunctie(x.functie, '1')))) {
        const s: DienstCode = t.n1m < beleid.minMiddag ? '1M' : '1';
        voeg(maak('opschalen', `${e.naam}: Dg opschalen naar ${s === '1M' ? 'middag/avonddienst' : 'regeldienst'}`, [[e.id, d, s]]));
        if (acties.length >= 2) break;
      }
      // 1b. een 1 wordt een 2, liefst bij wie dat graag doet
      if (t.n2 < beleid.maxTwee && t.enkel - 1 >= beleid.minEnkelBijTwee) {
        const twee = (e: Medewerker) => ({ graag: 0, neutraal: 1, liever_niet: 2, niet: 3 })[o.profielen?.[e.id]?.twee ?? 'neutraal'];
        const enen = sorteer(actief.filter((x) => cel(cellen, x.id, d) === '1' && twee(x) < 3)).sort((a, c) => twee(a) - twee(c));
        eerste(enen, (e) => maak('extra-regeling', `${e.naam}: extra regeling (1 wordt 2, tot 19:00)${twee(e) === 2 ? '; doet liever geen dubbele dienst' : ''}`, [[e.id, d, '2']]));
      }
      // 2. een vrije medewerker
      const regel: DienstCode = t.n1m < beleid.minMiddag ? '1M' : '1';
      eerste(sorteer(actief.filter((x) => !x.extern && cel(cellen, x.id, d) === '-' && magFunctie(x.functie, '1')
        && weekUren(x.id, d) + DIENSTEN[regel].uren <= x.contract && !geenExtraWerk(o, x.id, d))),
      (e) => maak('inplannen', `${e.naam} inplannen voor een regeldienst${lieverNiet(e) ? '; werkt liever niet op deze dag' : ''}`, [[e.id, d, regel]]));
      // 3. buurregio's
      const buren = (o.buren?.(d) ?? []).filter((x) => x.over > 0).sort((a, c) => c.over - a.over);
      if (buren.length) voeg({ soort: 'buurregio', tekst: `Vraag ${buren.slice(0, 2).map((x) => `${x.regio} (${x.over} over)`).join(' of ')} om ${tekort === 1 ? 'een melding' : `${tekort} meldingen`} over te nemen`, wijzigingen: [], overleg: false, bevindingen: [] });
      // 4. een ZZP'er, anders een notitie
      if (o.zzp ?? ZZP_IN_ROOSTER) {
        const zzp = actief.find((x) => x.extern && cel(cellen, x.id, d) === '-' && weekUren(x.id, d) + 8 <= x.contract);
        const zzpActie = zzp ? maak('zzp', `${zzp.naam} (extern) inzetten voor een meldplek`, [[zzp.id, d, '1']]) : null;
        voeg(zzpActie ?? { soort: 'zzp', tekst: `Zet een ZZP'er in voor ${tekort === 1 ? 'een meldplek' : `${tekort} meldplekken`}`, wijzigingen: [], overleg: false, bevindingen: [] });
      }
      // 5. naar de volgende dag als daar plekken over zijn
      const volgende = dates[idx + 1];
      if (volgende && nu[volgende]) {
        const tv = telDag(cellen, volgende);
        const over = tv.p - nu[volgende]!.k;
        if (over > 0) voeg({ soort: 'verplaatsen', tekst: `Melding naar ${fmtDag(volgende)} verplaatsen (daar ${over} plek${over > 1 ? 'ken' : ''} over)`, wijzigingen: [], overleg: false, bevindingen: [] });
      }
    } else if (status === 'teveel') {
      // een 2 terug naar een 1, of een regeldienst omzetten naar Dg (voorgaan en uitwerken). Een 1B helpt hier
      // niet: die telt in de vastgestelde regelplekken gewoon als regelplek.
      const twee = actief.find((x) => cel(cellen, x.id, d) === '2');
      if (twee) voeg(maak('twee-terug', `${twee.naam}: 2 terug naar een 1`, [[twee.id, d, '1']]));
      const enkele = sorteer(actief.filter((x) => cel(cellen, x.id, d) === '1' || (cel(cellen, x.id, d) === '1M' && t.n1m > beleid.minMiddag))).reverse();
      if (!isZondag(d)) for (const e of enkele.slice(0, 2)) voeg(maak('afschalen', `${e.naam}: regeldienst wordt Dg-dienst`, [[e.id, d, dossierVoor(e.functie)]]));
    }
    // voorgangen: te weinig Dg op een werkdag (bijvoorbeeld door ziekte)
    if (!isZondag(d) && t.vg < beleid.voorgangenPerDag && acties.length < maxActies) {
      const kandidaten = sorteer(actief.filter((x) => {
        const c = cel(cellen, x.id, d);
        if (c === '-') return weekUren(x.id, d) + DIENSTEN[dossierVoor(x.functie)].uren <= x.contract && !geenExtraWerk(o, x.id, d);
        return c === 'O' || c === 'O4' || c === 'TD';
      }));
      eerste(kandidaten, (e) => {
        const s = dossierVoor(e.functie), was = cel(cellen, e.id, d);
        return maak('voorgang', `${e.naam} op ${s} voor voorgangen (${t.vg} van ${beleid.voorgangenPerDag})${was !== '-' ? `, in plaats van ${DIENSTEN[was].naam.toLowerCase()}` : ''}`, [[e.id, d, s]]);
      });
    }
    return {
      datum: d,
      lamBasis: b?.lam ?? null, lamNu: n?.lam ?? null,
      kBasis: b?.k ?? null, kNu, kNorm: n?.kNorm ?? b?.kNorm ?? null,
      p: t.p, voorgangen: t.vg, status, ziek, acties,
      binnenVast: diffDays(d, vandaag) < beleid.vastDagen,
      binnenTijden: diffDays(d, vandaag) < beleid.tijdenDagen,
    };
  });

  let lb = 0, ln = 0, nl = 0;
  for (const x of dagen) if (x.lamBasis != null && x.lamNu != null) { lb += x.lamBasis; ln += x.lamNu; nl++; }
  return {
    dagen,
    samenvatting: {
      tekortDagen: dagen.filter((x) => x.status === 'tekort').length,
      teveelDagen: dagen.filter((x) => x.status === 'teveel').length,
      kVeranderd: dagen.filter((x) => x.kBasis != null && x.kNu != null && x.kBasis !== x.kNu).length,
      kOmhoog: dagen.filter((x) => x.kBasis != null && x.kNu != null && x.kNu > x.kBasis).length,
      kOmlaag: dagen.filter((x) => x.kBasis != null && x.kNu != null && x.kNu < x.kBasis).length,
      lamVerschil: nl && lb > 0 ? ln / lb - 1 : null,
      ziekDagen: dagen.reduce((s, x) => s + x.ziek.length, 0),
      voorgangTekort: dagen.filter((x) => weekday(toDay(x.datum)) !== 0 && x.voorgangen < beleid.voorgangenPerDag).length,
    },
  };
}
