import type { FactorKey } from './config';

/** Meldingenhistorie: per regio een reeks aantallen per dag vanaf `start` (null = geen gegevens). */
export interface MeldingenData {
  start: string;
  n: number;
  regios: Record<string, (number | null)[]>;
}

/** Externe bronnen: bron -> variabele -> sleutel (regio of NL) -> datum -> waarde. */
export type ExternData = Record<string, Record<string, Record<string, Record<string, number>>>>;

export interface HandmatigRij {
  variabele: string;
  datum: string;
  waarde: number;
}

export interface ModelInput {
  meldingen: MeldingenData;
  extern: ExternData;
  handmatig: HandmatigRij[];
  /** Geschatte coëfficiënten; ontbrekende factoren gebruiken de startwaarde. */
  coef: Partial<Record<FactorKey, number>>;
  /** Fourier-coëfficiënten van de klimaatnormaal (De Bilt), of null als die nog niet is opgehaald. */
  normaal: number[] | null;
}

export interface RunInfo {
  notes: string[];
  mom7: number;
  level28: number;
  cbs: number;
  covid: number;
  flu: number;
  data_end: string | null;
  coef: Record<FactorKey, number>;
}

export interface RunMeta {
  id: string;
  soort: string;
  uitgegeven: string;
  gemaakt: string;
  info: RunInfo;
}

/** Eén run: per regio (rij) en dag (kolom) de verwachting nu (lam) en volgens het basismodel (base). */
export interface RunData {
  id: string;
  dates: string[];
  regios: string[];
  lam: number[][];
  base: number[][];
  /** Bijdrage per factor op log-schaal, alleen factoren die ergens niet nul zijn. */
  fac: Record<string, Partial<Record<FactorKey, number[]>>>;
}

export interface Run {
  meta: RunMeta;
  data: RunData;
}

export interface CoefSchatting {
  waarde: number;
  se: number;
  dagen: number;
}

export interface BacktestRegel {
  dagen: number;
  mae_basis: number;
  mae_bijgestuurd: number;
  bias_basis: number;
  bias_bijgestuurd: number;
}

export interface Kalibratie {
  coef: Partial<Record<FactorKey, CoefSchatting>>;
  backtest: { knippunt: string; resultaat: Record<'h4' | 'h45', BacktestRegel>; datum: string };
}
