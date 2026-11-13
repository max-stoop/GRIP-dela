/**
 * De nabestaandendesk (NBD): een losse module die niet meetelt in de regelplekken, het dashboard of de verdeling.
 * De rekenwijze volgt de capaciteitsplanning NBD 2026: gesprekken per weekdag en uur die meebewegen met de
 * overlijdens, Erlang C per uur (90% binnen 90 s, 700 s per gesprek), per uur afgerond op hele mensen.
 */
import { NORM_STANDAARD } from '../capaciteit/parameters';
import { REGIONS } from '../model/config';

export const NBD = 'NBD';
export const NBD_NAAM = 'Nabestaandendesk';

export function isNbd(regio: string | null | undefined): boolean {
  return regio === NBD;
}

export const WERKREGIOS: string[] = [...REGIONS, NBD];

/** 7.5 = 7:30, op een kwartier. */
export type Uur = number;

export const NBD_OPEN: Uur = 7;
export const NBD_SLUIT: Uur = 22.5;

export interface NbdParameters {
  // volume (landelijk)
  /** Natura-uitvaarten per jaar. */
  natura: number;
  /** Overlijdens per jaar (CBS). */
  overlijdens: number;
  /** Aandeel vrije markt van de overlijdens (0..1). */
  vrijeMarkt: number;
  /** Gesprekken in een gewone week: [weekdag, 0 = zondag][tijdvak vanaf 7:00]. */
  gesprekken: number[][];
  // Erlang C
  /** Gemiddelde gespreksduur inclusief nawerk, in seconden. */
  aht: number;
  /** Service level: dit deel van de gesprekken... */
  serviceLevel: number;
  /** ...binnen zoveel seconden opgenomen. */
  wachttijd: number;
  /** Minimaal zoveel mensen aan de telefoon zolang de desk open is. */
  minBezetting: number;
  /** De capaciteitsplanning rekent met dit deel van de Erlang-uren als benodigd (92%). */
  correctie: number;
  // openingstijden, vast 7:00-22:30
  open: Uur;
  sluit: Uur;
  // diensten
  /** Werktijd per dienst (zonder pauze), in uren. */
  minDienst: number;
  maxDienst: number;
  /** ATW: bij meer dan zoveel uur werk een pauze... */
  pauzeNa: number;
  /** ...van minstens zoveel minuten. Pauze telt niet als werktijd. */
  pauzeMinuten: number;
  // ATW, CAO en teamafspraken
  /** Minimale rust tussen twee diensten (ATW: 11 uur). */
  minRust: number;
  /** Minimale aaneengesloten rust per week (ATW: 36 uur, of 72 uur per twee weken in delen van 32). */
  weekRust: number;
  /** Maximale werktijd per week (ATW: 60 uur). */
  maxWeekUren: number;
  /** Teamafspraak: maximaal zoveel dagen achter elkaar werken. */
  maxAchtereen: number;
  /** Plannen tot de contracturen (meer mensen dan Erlang vraagt, op de drukste momenten). */
  aanvullenTotContract: boolean;
  // capaciteit per week
  /** Ziekte, als deel van de bruto uren. */
  ziek: number;
  /** Overig verlof en langdurig verzuim, uren per week. */
  overigVerzuim: number;
  /** Training, uren per medewerker per week. */
  training: number;
  /** Pauze, als deel van de bruto uren. */
  pauzeDeel: number;
  /** Afspraken, weekly en monthly: uren per week. */
  afspraken: number;
  /** Taken (dagcoördinator en dergelijke): uren per week. */
  taken: number;
  /** Klachten: uren per week. */
  klachten: number;
  /** Bij een variabel rooster: zoveel uren boven het contract (maximale inzet), als startwaarde. */
  extraInzet: number;
}

/** Uit de capaciteitsplanning NBD 2026 (Benodigde uren), samen 1.703. */
export const NBD_GESPREKKEN_STANDAARD: number[][] = [
  [6.68, 11.19, 20.24, 20.67, 19.82, 17.16, 15.3, 14.94, 13.71, 11.76, 10.38, 8.98, 8.78, 9.04, 8.39, 3.96],
  [7.67, 19.97, 33.53, 29.2, 25.64, 22.34, 21.81, 19.83, 20, 18.51, 15.02, 9.97, 9.9, 9.86, 9.07, 4.95],
  [7.84, 17.9, 28.63, 25.73, 24.14, 20.26, 19.26, 20.65, 19.27, 18.5, 14.68, 9.33, 9.4, 10.28, 8.99, 4.5],
  [7.82, 17.99, 26.83, 24.55, 21.63, 18.59, 18.7, 19.04, 17.08, 17.58, 13.94, 10.26, 10.13, 9.77, 8.99, 4.86],
  [7.86, 17.72, 26.11, 23.38, 19.94, 18.71, 18.31, 18.62, 17.04, 17.71, 14.34, 10.05, 8.96, 9.88, 8.69, 4.43],
  [6.87, 18.1, 26.6, 22.94, 21.31, 18.99, 18.91, 18.62, 18.63, 17.32, 14.81, 10.26, 9.26, 9.73, 8.92, 4.65],
  [7.5, 14.42, 23.83, 24.54, 21.59, 19.64, 17.49, 17.12, 15.97, 13.86, 11.61, 10.56, 9.68, 9.07, 8.73, 4.56],
];

/** [van, tot) in uren; elk heel uur, het laatste tot sluitingstijd. */
interface Tijdvak { van: Uur; tot: Uur }

export function tijdvakken(p: Pick<NbdParameters, 'open' | 'sluit'> = { open: NBD_OPEN, sluit: NBD_SLUIT }): Tijdvak[] {
  const uit: Tijdvak[] = [];
  for (let u = p.open; u < p.sluit - 1e-9; u = Math.floor(u) + 1) uit.push({ van: u, tot: Math.min(Math.floor(u) + 1, p.sluit) });
  return uit;
}

/** -1 buiten de openingstijden. */
export function tijdvakVan(t: Uur, p: Pick<NbdParameters, 'open' | 'sluit'> = { open: NBD_OPEN, sluit: NBD_SLUIT }): number {
  if (t < p.open - 1e-9 || t >= p.sluit - 1e-9) return -1;
  return Math.floor(t + 1e-9) - Math.floor(p.open);
}

const regios = Object.values(NORM_STANDAARD.regios);
const somNatura = regios.reduce((a, r) => a + r.natura, 0);
const somCbs = regios.reduce((a, r) => a + r.cbs, 0);
const somVrij = regios.reduce((a, r) => a + r.cbs * r.vrijeMarkt, 0);

/** Uit de capaciteitsplanning NBD 2026. Met deze week doet de NBD ruim twee gesprekken per uitvaart. */
export const NBD_STANDAARD: NbdParameters = {
  natura: Math.round(somNatura),
  overlijdens: Math.round(somCbs),
  vrijeMarkt: Math.round((somVrij / somCbs) * 1e6) / 1e6,
  gesprekken: NBD_GESPREKKEN_STANDAARD,
  aht: 700,
  serviceLevel: 0.9,
  wachttijd: 90,
  minBezetting: 2,
  correctie: 0.92,
  open: NBD_OPEN,
  sluit: NBD_SLUIT,
  minDienst: 3,
  maxDienst: 9,
  pauzeNa: 5.5,
  pauzeMinuten: 30,
  minRust: 11,
  weekRust: 36,
  maxWeekUren: 60,
  maxAchtereen: 5,
  aanvullenTotContract: true,
  ziek: 0.05,
  overigVerzuim: 32,
  training: 0.5,
  pauzeDeel: 0.02,
  afspraken: 40,
  taken: 40,
  klachten: 0,
  extraInzet: 4,
};

/** Natura plus het vrije-marktdeel van de overlijdens. */
export function uitvaartenPerJaar(p: Pick<NbdParameters, 'natura' | 'overlijdens' | 'vrijeMarkt'>): number {
  return p.natura + p.overlijdens * p.vrijeMarkt;
}

export function gesprekkenPerWeek(p: Pick<NbdParameters, 'gesprekken'>): number {
  return p.gesprekken.reduce((a, rij) => a + rij.reduce((b, x) => b + x, 0), 0);
}

function geldigeTabel(x: unknown): x is number[][] {
  const n = tijdvakken().length;
  return Array.isArray(x) && x.length === 7 && x.every((r) => Array.isArray(r) && r.length === n && r.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0));
}

export function nbdParameters(x: Partial<NbdParameters> | null | undefined): NbdParameters {
  const p = { ...NBD_STANDAARD, ...(x ?? {}) } as NbdParameters;
  for (const k of Object.keys(NBD_STANDAARD) as (keyof NbdParameters)[]) {
    const s = NBD_STANDAARD[k];
    if (typeof s === 'number' && !(typeof p[k] === 'number' && Number.isFinite(p[k] as number))) (p as unknown as Record<string, unknown>)[k] = s;
    if (typeof s === 'boolean' && typeof p[k] !== 'boolean') (p as unknown as Record<string, unknown>)[k] = s;
  }
  if (!geldigeTabel(p.gesprekken)) p.gesprekken = NBD_GESPREKKEN_STANDAARD;
  p.open = NBD_OPEN;
  p.sluit = NBD_SLUIT;
  if (p.maxDienst < p.minDienst) p.maxDienst = p.minDienst;
  p.serviceLevel = Math.min(0.999, Math.max(0.01, p.serviceLevel));
  p.correctie = Math.min(1.5, Math.max(0.1, p.correctie));
  return p;
}
