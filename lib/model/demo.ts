import { toDay, fromDay, dayOfYear, weekdayMon, isHoliday, year, type Day } from '../dates';
import { REGIONS, DEMO_LEVEL } from './config';
import type { MeldingenData } from './types';

/** mulberry32, met vaste seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mu = 0, sd = 1) => {
    const u = Math.max(uniform(), 1e-12), v = uniform();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const poisson = (lam: number) => {
    if (lam > 60) return Math.max(0, Math.round(normal(lam, Math.sqrt(lam))));
    const L = Math.exp(-lam);
    let k = 0, p = 1;
    do { k++; p *= uniform(); } while (p > L);
    return k - 1;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(uniform() * (hi - lo + 1));
  const pick = <T,>(a: T[]) => a[Math.floor(uniform() * a.length)];
  return { uniform, normal, poisson, int, pick };
}

/** Synthetische historie met seizoen, weekdag, feestdagen, een trage schommeling en griepgolven. */
export function makeDemoHistory(today: string, start = '2022-07-01', seed = 7): MeldingenData {
  const R = rng(seed);
  const s = toDay(start), e = toDay(today) - 1, n = e - s + 1;
  const days: Day[] = Array.from({ length: n }, (_, i) => s + i);
  const wdF = [1.02, 1.01, 1.0, 1.01, 1.05, 0.99, 0.91];
  const ar = new Float64Array(n);
  for (let i = 1; i < n; i++) ar[i] = 0.97 * ar[i - 1] + R.normal(0, 0.012);
  const flu = new Float64Array(n);
  for (let y = year(s); y <= year(e); y++) {
    const peak = toDay(`${y}-02-01`) + R.int(-25, 24);
    days.forEach((d, i) => { flu[i] += 0.1 * Math.exp(-0.5 * ((d - peak) / 14) ** 2); });
  }
  const common = days.map((d, i) => {
    const season = 1 + 0.12 * Math.cos((2 * Math.PI * (dayOfYear(d) - 15)) / 365.25);
    return season * wdF[weekdayMon(d)] * (isHoliday(d) ? 0.94 : 1) * Math.exp(ar[i] + flu[i]);
  });
  const regios: Record<string, number[]> = {};
  for (const r of REGIONS) regios[r] = common.map((c) => R.poisson(DEMO_LEVEL[r] * c));
  return { start: fromDay(s), n, regios };
}

/** Uitgiftedata (dagen terug) voor terugwerkende demoruns: zo is zichtbaar hoe een verwachting verschuift. */
export const DEMO_TERUG = [56, 49, 42, 35, 28, 21, 14, 10, 7, 6, 5, 4, 3, 2, 1];
