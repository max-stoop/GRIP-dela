/**
 * Voorspelling met bijsturing: één model, met per horizon andere informatie.
 *
 *     log λ(d | t) = log λ_basis(d | t) + Σ_k β_k · x_k(d | t)
 *
 * t = uitgiftedatum, d = doeldatum. Dichterbij komen weer, lucht, rioolwater, griep en momentum erbij.
 * Omgezet uit het Python-prototype en daartegen getoetst.
 */
import { toDay, fromDay, dayOfYear, weekdayMon, month, isHoliday, nowStamp, type Day } from '../dates';
import {
  REGIONS, PRIORS, FACTORS, DECAY, HORIZON_DAYS, SHORT_HORIZON, DECAY_HALFLIFE_DAYS, PM25_BASE,
  REGIO_NIVEAU_DAGEN, REGIO_NIVEAU_DEMPING, MIN_HISTORIE_DAGEN, type FactorKey,
} from './config';
import { fitPoisson, mapPoisson } from './glm';
import type { ExternData, HandmatigRij, Kalibratie, MeldingenData, ModelInput, Run, RunData, RunInfo } from './types';

const P = 12;
const TWO_PI = 2 * Math.PI;

/** Ontwerpmatrix-rij: constante, Fourier-seizoen (K = 2), weekdag (maandag is referentie), feestdag. */
function designRow(d: Day, out: Float64Array, o = 0): void {
  const doy = dayOfYear(d), wd = weekdayMon(d);
  out[o] = 1;
  out[o + 1] = Math.sin((TWO_PI * doy) / 365.25);
  out[o + 2] = Math.cos((TWO_PI * doy) / 365.25);
  out[o + 3] = Math.sin((2 * TWO_PI * doy) / 365.25);
  out[o + 4] = Math.cos((2 * TWO_PI * doy) / 365.25);
  for (let w = 1; w <= 6; w++) out[o + 4 + w] = wd === w ? 1 : 0;
  out[o + 11] = isHoliday(d) ? 1 : 0;
}

export class History {
  readonly start: Day;
  readonly n: number;
  readonly regions: string[];
  readonly vals: Record<string, Float64Array>;
  readonly present: Uint8Array;
  readonly first: Day | null;
  readonly last: Day | null;

  constructor(m: MeldingenData) {
    this.start = toDay(m.start);
    this.n = m.n;
    this.regions = REGIONS.filter((r) => m.regios[r]?.some((v) => v != null));
    this.vals = {};
    this.present = new Uint8Array(m.n);
    for (const r of this.regions) {
      const a = new Float64Array(m.n).fill(NaN);
      const src = m.regios[r];
      for (let i = 0; i < m.n; i++) {
        const v = src[i];
        if (v != null && Number.isFinite(v)) {
          a[i] = v;
          this.present[i] = 1;
        }
      }
      this.vals[r] = a;
    }
    let f = -1, l = -1;
    for (let i = 0; i < m.n; i++) if (this.present[i]) { if (f < 0) f = i; l = i; }
    this.first = f < 0 ? null : this.start + f;
    this.last = l < 0 ? null : this.start + l;
  }

  has(d: Day): boolean {
    const i = d - this.start;
    return i >= 0 && i < this.n && this.present[i] === 1;
  }
}

/**
 * Poisson-GLM per regio: Fourier-seizoen (K = 2), weekdag, feestdag, tijdsweging met halfwaardetijd 400 dagen.
 *
 * Een regio met minder dan een jaar meldingen krijgt geen model: met een halfjaar schat het seizoen een uitschieter
 * (een regiodag van 40 waar 5 normaal is). Lukt de schatting om een andere reden niet, dan valt alleen die regio af. Wie
 * geen model heeft, staat in `overgeslagen` en rekent verder met de vastgestelde regelplekken.
 */
export class BaseModel {
  readonly issue: Day;
  readonly params: Record<string, number[]> = {};
  readonly phi: Record<string, number> = {};
  /** Regio → waarom die geen model heeft. */
  readonly overgeslagen: Record<string, string> = {};
  readonly tableStart: Day;
  readonly tableEnd: Day;
  private readonly table: Record<string, Float64Array> = {};

  constructor(hist: History, issue: Day) {
    this.issue = issue;
    const row = new Float64Array(P);
    for (const r of hist.regions) {
      const v = hist.vals[r];
      const ys: number[] = [], days: Day[] = [];
      for (let i = 0; i < hist.n; i++) {
        const d = hist.start + i;
        if (d >= issue) break;
        if (!Number.isNaN(v[i])) { ys.push(v[i]); days.push(d); }
      }
      if (ys.length < MIN_HISTORIE_DAGEN) {
        this.overgeslagen[r] = `${r}: ${ys.length} dagen historie, minder dan een jaar; rekent met de vastgestelde regelplekken`;
        continue;
      }
      const n = ys.length, X = new Float64Array(n * P), y = Float64Array.from(ys), w = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        designRow(days[i], X, i * P);
        w[i] = Math.pow(0.5, (issue - days[i]) / DECAY_HALFLIFE_DAYS);
      }
      let fit: ReturnType<typeof fitPoisson>;
      try {
        fit = fitPoisson(X, n, P, y, w);
      } catch {
        this.overgeslagen[r] = `${r}: het seizoenmodel is niet te schatten (bijvoorbeeld alleen nullen); rekent met de vastgestelde regelplekken`;
        continue;
      }
      if (!fit.beta.every(Number.isFinite)) {
        this.overgeslagen[r] = `${r}: het seizoenmodel is niet te schatten; rekent met de vastgestelde regelplekken`;
        continue;
      }
      this.params[r] = fit.beta;
      this.phi[r] = fit.phi;
    }
    // tabel met verwachtingen voor de hele historie plus horizon, voor snelle opvraag
    this.tableStart = Math.min(hist.first ?? issue, issue - 60);
    this.tableEnd = issue + 120;
    const len = this.tableEnd - this.tableStart + 1;
    for (const r of Object.keys(this.params)) this.table[r] = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      designRow(this.tableStart + i, row);
      for (const r of Object.keys(this.params)) {
        const b = this.params[r];
        let e = 0;
        for (let j = 0; j < P; j++) e += row[j] * b[j];
        this.table[r][i] = Math.exp(e);
      }
    }
  }

  get regions(): string[] {
    return Object.keys(this.params);
  }

  predict(region: string, d: Day): number {
    if (d >= this.tableStart && d <= this.tableEnd) return this.table[region][d - this.tableStart];
    const row = new Float64Array(P);
    designRow(d, row);
    const b = this.params[region];
    let e = 0;
    for (let j = 0; j < P; j++) e += row[j] * b[j];
    return Math.exp(e);
  }
}

interface Series {
  days: Int32Array;
  vals: Float64Array;
  cum: Float64Array;
}

const EMPTY: Series = { days: new Int32Array(0), vals: new Float64Array(0), cum: new Float64Array(1) };

/** Eerste index met days[i] >= x. */
function lowerBound(a: Int32Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < x) lo = m + 1; else hi = m;
  }
  return lo;
}

/** Eerste index met days[i] > x. */
function upperBound(a: Int32Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= x) lo = m + 1; else hi = m;
  }
  return lo;
}

export class Ext {
  private cache = new Map<string, Series>();
  readonly flu: { day: Day; waarde: number }[];

  constructor(private readonly data: ExternData, handmatig: HandmatigRij[]) {
    this.flu = handmatig
      .filter((h) => h.variabele === 'flu_ili' && Number.isFinite(h.waarde))
      .map((h) => ({ day: toDay(h.datum), waarde: h.waarde }))
      .sort((a, b) => a.day - b.day);
  }

  series(bron: string, variabele: string, sleutel: string): Series {
    const k = `${bron}|${variabele}|${sleutel}`;
    let s = this.cache.get(k);
    if (s) return s;
    const obj = this.data[bron]?.[variabele]?.[sleutel];
    if (!obj) {
      this.cache.set(k, EMPTY);
      return EMPTY;
    }
    const entries = Object.entries(obj).filter(([, v]) => v != null && Number.isFinite(v)).map(([d, v]) => [toDay(d), v] as const).sort((a, b) => a[0] - b[0]);
    const days = Int32Array.from(entries.map((e) => e[0])), vals = Float64Array.from(entries.map((e) => e[1]));
    const cum = new Float64Array(vals.length + 1);
    for (let i = 0; i < vals.length; i++) cum[i + 1] = cum[i] + vals[i];
    s = { days, vals, cum };
    this.cache.set(k, s);
    return s;
  }
}

/** null als er geen waarden zijn. */
function meanWindow(s: Series, start: Day, end: Day): number | null {
  const i = lowerBound(s.days, start), j = upperBound(s.days, end);
  return j > i ? (s.cum[j] - s.cum[i]) / (j - i) : null;
}

function normalTmean(beta: number[] | null, d: Day): number | null {
  if (!beta || beta.length < 5) return null;
  const doy = dayOfYear(d), a = (TWO_PI * doy) / 365.25;
  return beta[0] + beta[1] * Math.sin(a) + beta[2] * Math.cos(a) + beta[3] * Math.sin(2 * a) + beta[4] * Math.cos(2 * a);
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type FeatureVector = Record<FactorKey, number>;

/**
 * Rioolwater verschijnt wekelijks: een meting is pas ongeveer een week later beschikbaar. Alleen in een terugblik, waar
 * de historie al alle metingen bevat; in de dagelijkse run is wat er staat vanzelf wat er bekend is.
 */
export const RIOOL_VERTRAGING = 7;

/**
 * Wat op t nog niet bekend is, telt als 0 (neutraal).
 *
 * terugblik: voor kalibratie en terugtest, die op de historie rekenen alsof het dag t is. Dan telt alleen wat op t
 * bekend was: weer en lucht tot en met gisteren (t − 1), rioolwater met publicatievertraging, en geen
 * seizoensverwachting (die van toen is niet bewaard). Zonder terugblik zouden gemeten waarden van na t de rol van een
 * verwachting spelen, en lijkt de voorspelling beter dan ze in het echt is.
 */
export class Features {
  readonly notes: string[] = [];
  readonly dataEnd: Day | null;
  readonly mom7: number;
  readonly level28: number;
  readonly cbs: number;
  readonly covid: number;
  readonly flu: number;

  constructor(
    private readonly ext: Ext,
    private readonly base: BaseModel,
    private readonly hist: History,
    readonly t: Day,
    private readonly normaal: number[] | null,
    private readonly terugblik = false,
  ) {
    this.dataEnd = hist.last == null ? null : Math.min(hist.last, t - 1);
    this.mom7 = this.ratio(7);
    this.level28 = this.ratio(28);
    this.cbs = this.cbsExcess();
    this.covid = this.covidWastewater();
    this.flu = this.fluSignal();
  }

  /**
   * Meldingen en verwachting over de regio's met een basismodel, alleen op regio-dagen met een aantal. Zo telt een regio
   * zonder model (te korte historie) of een ontbrekende dag niet als drukte of rust voor het hele land.
   */
  private samen(a: Day, b: Day): { obs: number; exp: number } {
    let obs = 0, exp = 0;
    const van = Math.max(a, this.hist.start), tot = Math.min(b, this.hist.start + this.hist.n - 1);
    for (const r of this.base.regions) {
      const v = this.hist.vals[r];
      if (!v) continue;
      for (let d = van; d <= tot; d++) {
        const y = v[d - this.hist.start];
        if (Number.isNaN(y)) continue;
        obs += y;
        exp += this.base.predict(r, d);
      }
    }
    return { obs, exp };
  }

  private ratio(n: number): number {
    if (this.dataEnd == null || this.t - this.dataEnd > 14) {
      this.notes.push(`Geen recente meldingen: ${n}-daags niveau niet gebruikt`);
      return 0;
    }
    const { obs, exp } = this.samen(this.dataEnd - n + 1, this.dataEnd);
    return exp > 0 ? Math.log(Math.max(obs, 1) / exp) : 0;
  }

  private readonly niveau = new Map<string, number>();
  private landNiveau: number | null = null;

  /** Het niveau van de regio over 16 weken ten opzichte van het land (log), gedempt naar 0 bij weinig meldingen. */
  regioNiveau(region: string): number {
    const c = this.niveau.get(region);
    if (c != null) return c;
    let uit = 0;
    const v = this.hist.vals[region];
    // een niveau over 16 weken blijft langer geldig dan de drukte van één week: tot twee maanden oude meldingen
    if (v && region in this.base.params && this.dataEnd != null && this.t - this.dataEnd <= 60) {
      const a = this.dataEnd - REGIO_NIVEAU_DAGEN + 1, b = this.dataEnd;
      if (this.landNiveau == null) {
        const { obs, exp } = this.samen(a, b);
        this.landNiveau = exp > 0 ? obs / exp : 1;
      }
      let obs = 0, exp = 0;
      for (let d = Math.max(a, this.hist.start); d <= b; d++) {
        const y = v[d - this.hist.start];
        if (Number.isNaN(y)) continue;
        obs += y;
        exp += this.base.predict(region, d);
      }
      uit = Math.log((obs + REGIO_NIVEAU_DEMPING) / (exp * this.landNiveau + REGIO_NIVEAU_DEMPING));
    }
    this.niveau.set(region, uit);
    return uit;
  }

  private cbsExcess(): number {
    const s = this.ext.series('cbs', 'overledenen', 'NL');
    const end = lowerBound(s.days, this.t - 7); // publicatievertraging
    if (end < 4 * 52) return 0;
    const last4 = [end - 4, end - 3, end - 2, end - 1];
    const ref: number[] = [];
    for (const y of [1, 2, 3]) {
      for (const i of last4) {
        const d = s.days[i];
        const k = upperBound(s.days, d - (7 * 52 * y + 4));
        if (k < end && s.days[k] < d - (7 * 52 * y - 4)) ref.push(s.vals[k]);
      }
    }
    if (ref.length < 6) return 0;
    const sum4 = last4.reduce((acc, i) => acc + s.vals[i], 0);
    const mean = ref.reduce((a, b) => a + b, 0) / ref.length;
    return Math.log(sum4 / (mean * 4));
  }

  private covidWastewater(): number {
    const s = this.ext.series('riool', 'covid_rna', 'NL');
    const end = upperBound(s.days, this.terugblik ? this.t - RIOOL_VERTRAGING : this.t);
    if (end < 20) return 0;
    const max = s.days[end - 1];
    const recent: number[] = [], year: number[] = [];
    for (let i = 0; i < end; i++) {
      if (s.days[i] > max - 10) recent.push(s.vals[i]);
      if (s.days[i] > max - 365) year.push(s.vals[i]);
    }
    const r = recent.reduce((a, b) => a + b, 0) / recent.length, b = median(year);
    return r > 0 && b > 0 ? Math.log2(r / b) : 0;
  }

  private fluSignal(): number {
    const rows = this.ext.flu.filter((f) => f.day <= this.t && f.day > this.t - 14);
    return rows.length ? Math.max(0, (rows[rows.length - 1].waarde - 50) / 50) : 0;
  }

  /** In een terugblik alleen tot en met gisteren: het weer van t en later was toen nog niet gemeten. */
  private tot(b: Day): Day {
    return this.terugblik ? Math.min(b, this.t - 1) : b;
  }

  private weather(region: string, v: string, a: Day, b: Day): number | null {
    return meanWindow(this.ext.series('weer', v, region), a, this.tot(b));
  }

  x(region: string, d: Day): FeatureVector {
    const h = d - this.t;
    const out = Object.fromEntries(FACTORS.map((k) => [k, 0])) as FeatureVector;
    out.level28 = this.level28 * Math.exp(-h / DECAY.level28);
    out.cbs_exc = this.cbs * Math.exp(-h / DECAY.cbs_exc);
    out.mom7 = this.mom7 * Math.exp(-h / DECAY.mom7);
    out.covid_ww = this.covid * Math.exp(-h / DECAY.covid_ww);
    out.flu_ili = this.flu * Math.exp(-h / DECAY.flu_ili);
    out.niveau_regio = this.regioNiveau(region);
    if (h <= SHORT_HORIZON) {
      const tmax = this.weather(region, 'tmax', d - 2, d);
      const tmean = this.weather(region, 'tmean', d - 14, d - 1);
      if (tmax != null) out.heat = Math.max(0, tmax - 25);
      if (tmean != null) out.cold = Math.max(0, 5 - tmean);
      const pm = meanWindow(this.ext.series('lucht', 'pm25', region), d - 2, this.tot(d));
      const oz = meanWindow(this.ext.series('lucht', 'ozone', region), d, this.tot(d));
      if (pm != null) out.pm25 = (pm - PM25_BASE) / 10;
      if (oz != null) out.ozone = Math.max(0, oz - 100) / 10;
    } else {
      const anom = this.seasonalAnomaly(d);
      if (anom != null) {
        const m = month(d);
        if ([11, 12, 1, 2, 3].includes(m)) out.seas_tw = anom;
        else if ([6, 7, 8].includes(m)) out.seas_ts = anom;
      }
    }
    return out;
  }

  private seasonalAnomaly(d: Day): number | null {
    // de seizoensverwachting van toen is niet bewaard; gemeten weer is geen verwachting
    if (this.terugblik) return null;
    const v = meanWindow(this.ext.series('seizoen', 'tmean_ens', 'NL'), d - 3, d + 3);
    if (v == null) return null;
    const n = normalTmean(this.normaal, d);
    return n == null ? null : v - n;
  }
}

export function coefs(est: Partial<Record<FactorKey, number>>): Record<FactorKey, number> {
  return Object.fromEntries(FACTORS.map((k) => [k, est[k] ?? PRIORS[k].prior])) as Record<FactorKey, number>;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

interface RunOptions {
  issue: string;
  soort: string;
  id?: string;
  now?: Date;
  /** Scheelt rekenwerk bij meerdere runs. */
  hist?: History;
}

export function runForecast(input: ModelInput, opt: RunOptions): Run {
  const issue = toDay(opt.issue);
  const hist = opt.hist ?? new History(input.meldingen);
  if (hist.last == null) throw new Error('Er zijn nog geen meldingen. Lees eerst de meldingenhistorie in.');
  const base = new BaseModel(hist, issue);
  if (!base.regions.length) throw new Error('Nog geen regio met een jaar meldingenhistorie. De voorspelling rekent pas met een jaar; tot dan gelden de vastgestelde regelplekken.');
  const ext = new Ext(input.extern, input.handmatig);
  const feats = new Features(ext, base, hist, issue, input.normaal);
  feats.notes.push(...Object.values(base.overgeslagen));
  const beta = coefs(input.coef);
  const days = Array.from({ length: HORIZON_DAYS }, (_, i) => issue + 1 + i);
  const now = opt.now ?? new Date();
  const stamp = nowStamp(now);
  const id = opt.id ?? `${opt.issue}_${stamp.slice(11).replace(/:/g, '')}`;
  const regios = base.regions;
  const data: RunData = { id, dates: days.map(fromDay), regios, lam: [], base: [], fac: {} };
  for (const r of regios) {
    const lamRow: number[] = [], baseRow: number[] = [];
    const fac: Partial<Record<FactorKey, number[]>> = {};
    days.forEach((d, i) => {
      const l0 = base.predict(r, d);
      const x = feats.x(r, d);
      let s = 0;
      for (const k of FACTORS) {
        if (Math.abs(x[k]) <= 1e-9) continue;
        const c = beta[k] * x[k];
        s += c;
        if (c !== 0) (fac[k] ??= new Array<number>(days.length).fill(0))[i] = r5(c);
      }
      lamRow.push(r4(l0 * Math.exp(s)));
      baseRow.push(r4(l0));
    });
    data.lam.push(lamRow);
    data.base.push(baseRow);
    data.fac[r] = fac;
  }
  const info: RunInfo = {
    notes: feats.notes, mom7: feats.mom7, level28: feats.level28, cbs: feats.cbs, covid: feats.covid, flu: feats.flu,
    data_end: feats.dataEnd == null ? null : fromDay(feats.dataEnd), coef: beta,
  };
  return { meta: { id, soort: opt.soort, uitgegeven: opt.issue, gemaakt: stamp, info }, data };
}

/** Landelijke dagreeks met features zoals ze op t = d − h bekend waren (terugblik). */
function buildDataset(hist: History, ext: Ext, base: BaseModel, normaal: number[] | null, h: number, start: Day, end: Day) {
  const ys: number[] = [], offs: number[] = [], Xs: number[][] = [], dates: Day[] = [];
  const regions = base.regions;
  for (let d = start; d <= end; d++) {
    if (!hist.has(d)) continue;
    const f = new Features(ext, base, hist, d - h, normaal, true);
    const lam0 = regions.map((r) => base.predict(r, d));
    const tot0 = lam0.reduce((a, b) => a + b, 0);
    const xr = regions.map((r) => f.x(r, d));
    Xs.push(FACTORS.map((k) => xr.reduce((s, x, i) => s + lam0[i] * x[k], 0) / tot0));
    // alleen de regio's waarvoor het basismodel rekent: anders telt een regio zonder model mee in de factoren
    ys.push(regions.reduce((s, r) => { const v = hist.vals[r]?.[d - hist.start]; return s + (v != null && Number.isFinite(v) ? v : 0); }, 0));
    offs.push(Math.log(tot0));
    dates.push(d);
  }
  return { y: ys, off: offs, X: Xs, dates };
}

/**
 * De factoren schatten op de eigen historie (MAP, startwaarden als prior) en het laatste jaar terugtesten op 4 en 45
 * dagen, met alleen wat op de dag van de voorspelling bekend was (terugblik). Een factor die zo nergens een waarde
 * heeft (hitte, fijnstof en ozon op 4 dagen, de seizoensverwachting), wordt niet geschat en houdt zijn startwaarde.
 */
export function calibrate(input: ModelInput, testDays = 365, now: Date = new Date()): Kalibratie {
  const hist = new History(input.meldingen);
  if (hist.last == null || hist.first == null) throw new Error('Geen meldingen om op te kalibreren.');
  const ext = new Ext(input.extern, input.handmatig);
  const end = hist.last, cut = end - testDays, start = hist.first + 60;
  if (cut - start < 120) throw new Error('Te weinig historie om te kalibreren: minimaal ruim anderhalf jaar nodig.');
  const baseTr = new BaseModel(hist, cut);
  if (!baseTr.regions.length) throw new Error('Te weinig historie om te kalibreren: vóór het testjaar is minstens een jaar meldingen nodig, samen ruim twee jaar.');
  const m = FACTORS.map((k) => PRIORS[k].prior), s = FACTORS.map((k) => PRIORS[k].sd);
  const out: Partial<Record<FactorKey, { waarde: number; se: number; dagen: number }>> = {};
  for (const h of [4, 45]) {
    const ds = buildDataset(hist, ext, baseTr, input.normaal, h, start, cut - 1);
    // het eigen niveau per regio telt landelijk op tot ongeveer nul: op de landelijke reeks is het niet te schatten
    const idx = FACTORS.map((k, i) => [k, i] as const).filter(([k]) => k !== 'niveau_regio' && ((PRIORS[k].horizon === 'kort') === (h === 4) || k === 'level28')).map(([, i]) => i);
    const { b, se } = mapPoisson(ds.y, ds.off, ds.X.map((row) => idx.map((i) => row[i])), idx.map((i) => m[i]), idx.map((i) => s[i]));
    idx.forEach((i, j) => {
      const k = FACTORS[i];
      const dagen = ds.X.filter((row) => Math.abs(row[i]) > 1e-9).length;
      if (!dagen) return;
      if (!(k in out) || (h === 4 && PRIORS[k].horizon === 'kort') || (h === 45 && PRIORS[k].horizon === 'lang')) {
        out[k] = { waarde: b[j], se: se[j], dagen };
      }
    });
  }
  const resultaat = {} as Kalibratie['backtest']['resultaat'];
  for (const h of [4, 45] as const) {
    const ds = buildDataset(hist, ext, baseTr, input.normaal, h, cut, end);
    const bvec = FACTORS.map((k) => out[k]?.waarde ?? 0);
    let maeB = 0, maeA = 0, biasB = 0, biasA = 0;
    ds.y.forEach((y, i) => {
      const l0 = Math.exp(ds.off[i]);
      const l1 = Math.exp(ds.off[i] + ds.X[i].reduce((acc, x, j) => acc + x * bvec[j], 0));
      maeB += Math.abs(y - l0); maeA += Math.abs(y - l1); biasB += y - l0; biasA += y - l1;
    });
    const n = Math.max(1, ds.y.length);
    resultaat[`h${h}`] = { dagen: ds.y.length, mae_basis: maeB / n, mae_bijgestuurd: maeA / n, bias_basis: biasB / n, bias_bijgestuurd: biasA / n };
  }
  return { coef: out, backtest: { knippunt: fromDay(cut), resultaat, datum: nowStamp(now) } };
}
