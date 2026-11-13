/**
 * Terugtest van de voorspelling voor morgen: elke dag van het afgelopen halfjaar alsof het die ochtend is, met
 * hetzelfde model als de dagelijkse run, vergeleken met wat er werkelijk binnenkwam. Alleen met wat die ochtend bekend
 * was (Features met terugblik): de verwachtingen van toen zijn niet bewaard, dus het weer telt tot en met de dag ervoor.
 */
import { BaseModel, Ext, Features, History, coefs } from './forecast';
import { CLUSTERS, FACTORS, MIN_HISTORIE_DAGEN } from './config';
import { bandDekking, poissonBand } from './poisson';
import { fromDay } from '../dates';
import type { ModelInput } from './types';

export interface TerugtestRegel {
  dagen: number;
  gem: number;
  /** Gemiddeld verschil tussen voorspeld en werkelijk. */
  ernaast: number;
  /** Wat een model dat de verwachting precies kent gemiddeld ernaast zou zitten: lager kan niet. */
  toeval: number;
  /** Aandeel dagen binnen de 80%-band, en wat dat hoort te zijn als de verwachting klopt. */
  binnen: number;
  binnenVerwacht: number;
  /** Gemiddeld werkelijk min voorspeld, als aandeel van voorspeld (+ is te laag voorspeld). */
  scheef: number;
  /** Σ(werkelijk − voorspeld)² / Σ voorspeld: rond 1 is puur toeval. */
  schommeling: number;
}

export interface Terugtest {
  van: string;
  tot: string;
  regios: Record<string, TerugtestRegel>;
  clusters: Record<string, TerugtestRegel>;
  landelijk: TerugtestRegel | null;
}

/** Zoveel dagen historie heeft het basismodel minstens nodig voor de eerste testdag. */
const AANLOOP = MIN_HISTORIE_DAGEN;

/** E|X − λ| voor X ~ Poisson(λ): 2·e^(−λ)·λ^(⌊λ⌋+1) / ⌊λ⌋!. */
export function poissonAfwijking(lam: number): number {
  if (lam <= 0) return 0;
  const f = Math.floor(lam);
  let lf = 0;
  for (let i = 2; i <= f; i++) lf += Math.log(i);
  return Math.exp(Math.log(2) - lam + (f + 1) * Math.log(lam) - lf);
}

export function terugtestMorgen(input: ModelInput, dagen = 182): Terugtest | null {
  const hist = new History(input.meldingen);
  if (hist.last == null || hist.first == null) return null;
  const eind = hist.last;
  const begin = Math.max(hist.first + AANLOOP, eind - dagen + 1);
  if (eind - begin < 27) return null;
  const ext = new Ext(input.extern, input.handmatig);
  const beta = coefs(input.coef);
  const perDag: Map<string, [number, number]>[] = [];
  let base: BaseModel | null = null;
  for (let d = begin; d <= eind; d++) {
    const issue = d - 1;
    // het basismodel elke week opnieuw schatten scheelt veel rekenwerk en verandert in een week nauwelijks
    if (!base || issue - base.issue >= 7) base = new BaseModel(hist, issue);
    // alleen wat die ochtend bekend was: geen gemeten weer van morgen als 'verwachting'
    const f = new Features(ext, base, hist, issue, input.normaal, true);
    const dag = new Map<string, [number, number]>();
    for (const r of base.regions) {
      const y = hist.vals[r][d - hist.start];
      if (Number.isNaN(y)) continue;
      const x = f.x(r, d);
      let s = 0;
      for (const k of FACTORS) s += beta[k] * x[k];
      dag.set(r, [y, base.predict(r, d) * Math.exp(s)]);
    }
    perDag.push(dag);
  }
  const regel = (regios: string[]): TerugtestRegel | null => {
    let n = 0, y = 0, abs = 0, toeval = 0, binnen = 0, verwacht = 0, rel = 0, kw = 0, lsom = 0;
    for (const dag of perDag) {
      if (!regios.every((r) => dag.has(r))) continue;
      let w = 0, l = 0;
      for (const r of regios) { const [a, b] = dag.get(r)!; w += a; l += b; }
      n++; y += w; abs += Math.abs(w - l); toeval += poissonAfwijking(l); verwacht += bandDekking(l);
      if (w >= poissonBand(0.1, l) && w <= poissonBand(0.9, l)) binnen++;
      if (l > 0) rel += (w - l) / l;
      kw += (w - l) ** 2; lsom += l;
    }
    return n ? { dagen: n, gem: y / n, ernaast: abs / n, toeval: toeval / n, binnen: binnen / n, binnenVerwacht: verwacht / n, scheef: rel / n, schommeling: lsom > 0 ? kw / lsom : 1 } : null;
  };
  const metModel = new Set(perDag.flatMap((d) => [...d.keys()]));
  const regios: Record<string, TerugtestRegel> = {};
  for (const r of metModel) { const x = regel([r]); if (x) regios[r] = x; }
  const clusters: Record<string, TerugtestRegel> = {};
  for (const [c, rs] of Object.entries(CLUSTERS)) {
    if (!rs.every((r) => metModel.has(r))) continue;
    const x = regel(rs);
    if (x) clusters[c] = x;
  }
  return { van: fromDay(begin), tot: fromDay(eind), regios, clusters, landelijk: metModel.size ? regel([...metModel]) : null };
}

interface Nauwkeurigheid {
  gem: number;
  ernaast: number;
  toeval: number;
}

/** null als er geen terugtest voor is. */
export function gemiddeldOver(regels: (TerugtestRegel | undefined)[]): Nauwkeurigheid | null {
  const xs = regels.filter((x): x is TerugtestRegel => !!x);
  if (!xs.length) return null;
  const g = (f: (x: TerugtestRegel) => number) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
  return { gem: g((x) => x.gem), ernaast: g((x) => x.ernaast), toeval: g((x) => x.toeval) };
}

export function inzicht(regio: Nauwkeurigheid | null, cluster: Nauwkeurigheid | null): string[] {
  if (!regio) return [];
  const nl1 = (x: number) => x.toFixed(1).replace('.', ',');
  const pctR = (x: Nauwkeurigheid) => `±${Math.round((x.ernaast / x.gem) * 100)}%`;
  const uit: string[] = [];
  const zo = regio.ernaast <= regio.toeval * 1.05
    ? `Dat is zo goed als het kan: ook een perfecte voorspelling zit gemiddeld ${nl1(regio.toeval)} ernaast, omdat het per dag voor een groot deel toeval is hoeveel meldingen er komen.`
    : `Een perfecte voorspelling zou gemiddeld ${nl1(regio.toeval)} ernaast zitten; het verschil is wat er nog te winnen valt.`;
  uit.push(`Per regio zat de voorspelling voor morgen het afgelopen halfjaar gemiddeld ${nl1(regio.ernaast)} meldingen ernaast, bij ${nl1(regio.gem)} per dag (${pctR(regio)}). ${zo}`);
  if (cluster) uit.push(`Per cluster middelt het toeval uit: ${nl1(cluster.ernaast)} ernaast bij ${nl1(cluster.gem)} per dag (${pctR(cluster)}). Daarom vangen de regio's in een cluster elkaar op.`);
  return uit;
}

/** Vanaf deze schommeling noemen we een cluster onrustiger dan toeval. */
const ONRUSTIG = 1.15;

export function schommelTekst(clusters: { naam: string; schommeling: number }[]): string | null {
  const druk = clusters.filter((c) => c.schommeling >= ONRUSTIG).sort((a, b) => b.schommeling - a.schommeling);
  if (!druk.length) return null;
  const namen = druk.map((c) => c.naam);
  const lijst = namen.length === 1 ? namen[0] : `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`;
  return `In ${druk.length === 1 ? 'cluster' : 'de clusters'} ${lijst} schommelt het meer dan toeval: de regio's zijn daar vaker tegelijk druk of rustig. "Hoogstens" houdt daar rekening mee.`;
}
