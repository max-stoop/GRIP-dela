/**
 * Capaciteit van de NBD per week, zoals het tabblad Capaciteit NBD 2026:
 *
 *   bruto (contracturen) − verlof − ziek − overig verzuim = beschikbaar
 *   beschikbaar − training, pauze, afspraken, taken, klachten = netto
 *   netto − Erlang-uren × 92% = ruimte voor verlof
 */
import type { NormParameters } from '../capaciteit/parameters';
import { addDays, fromDay, isoWeek, mondayOf, toDay } from '../dates';
import type { Medewerker } from '../rooster/types';
import { nbdBehoefte } from './behoefte';
import type { NbdParameters } from './parameters';

export interface NbdCapaciteitWeek {
  maandag: string;
  week: number;
  /** Actief, geen externe kracht. */
  medewerkers: number;
  bruto: number;
  /** Bij een variabel rooster meer dan het contract. */
  brutoMax: number;
  /** Goedgekeurd en aangevraagd. */
  verlof: number;
  aangevraagd: number;
  ziek: number;
  overigVerzuim: number;
  beschikbaar: number;
  beschikbaarMax: number;
  training: number;
  pauze: number;
  afspraken: number;
  taken: number;
  klachten: number;
  overig: number;
  /** Voor de telefoon. */
  netto: number;
  nettoMax: number;
  erlangUren: number;
  /** erlangUren × correctie (92%). */
  benodigd: number;
  /** Zonder het verlof zelf mee te tellen. */
  ruimte: number;
  ruimteMax: number;
  /** Na het goedgekeurde verlof. */
  over: number;
  overMax: number;
}

interface NbdCapaciteitInvoer {
  p: NbdParameters;
  normen: NormParameters;
  /** Ook wie niet actief is; die telt niet mee. */
  team: Medewerker[];
  /** maandag → uren goedgekeurd en aangevraagd */
  verlofPerWeek?: Map<string, { goed: number; aan: number }>;
}

/** Het opgegeven maximum, anders het contract. */
export function maxUren(m: Pick<Medewerker, 'contract' | 'maxUren'>): number {
  return m.maxUren != null && m.maxUren > m.contract ? m.maxUren : m.contract;
}

const cache = new WeakMap<NbdParameters, WeakMap<NormParameters, Map<string, number>>>();

/** Volgens de norm, zonder voorspelling. */
export function nbdUrenPerWeek(p: NbdParameters, normen: NormParameters, maandag: string): number {
  let per = cache.get(p);
  if (!per) { per = new WeakMap(); cache.set(p, per); }
  let m = per.get(normen);
  if (!m) { m = new Map(); per.set(normen, m); }
  const ma = fromDay(mondayOf(toDay(maandag)));
  let u = m.get(ma);
  if (u == null) {
    const dagen = Array.from({ length: 7 }, (_, i) => addDays(ma, i));
    const b = nbdBehoefte({ norm: normen }, p, dagen, 'norm');
    u = dagen.reduce((a, d) => a + b[d].uren, 0);
    m.set(ma, u);
  }
  return u;
}

export function nbdCapaciteitWeek(inv: NbdCapaciteitInvoer, maandag: string): NbdCapaciteitWeek {
  const { p } = inv;
  const ma = fromDay(mondayOf(toDay(maandag)));
  const leden = inv.team.filter((m) => m.actief && !m.extern);
  const bruto = leden.reduce((a, m) => a + m.contract, 0);
  const brutoMax = leden.reduce((a, m) => a + maxUren(m), 0);
  const v = inv.verlofPerWeek?.get(ma) ?? { goed: 0, aan: 0 };
  const ziek = p.ziek * bruto;
  const beschikbaar = bruto - v.goed - ziek - p.overigVerzuim;
  const beschikbaarMax = brutoMax - v.goed - p.ziek * brutoMax - p.overigVerzuim;
  const training = p.training * leden.length;
  const pauze = p.pauzeDeel * bruto;
  const overig = training + pauze + p.afspraken + p.taken + p.klachten;
  const netto = beschikbaar - overig;
  const nettoMax = beschikbaarMax - overig;
  const erlangUren = nbdUrenPerWeek(p, inv.normen, ma);
  const benodigd = erlangUren * p.correctie;
  return {
    maandag: ma, week: isoWeek(toDay(ma)), medewerkers: leden.length, bruto, brutoMax, verlof: v.goed, aangevraagd: v.aan,
    ziek, overigVerzuim: p.overigVerzuim, beschikbaar, beschikbaarMax, training, pauze, afspraken: p.afspraken, taken: p.taken,
    klachten: p.klachten, overig, netto, nettoMax, erlangUren, benodigd,
    ruimte: netto + v.goed - benodigd, ruimteMax: nettoMax + v.goed - benodigd,
    over: netto - benodigd, overMax: nettoMax - benodigd,
  };
}
