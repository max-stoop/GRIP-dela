import { describe, expect, it } from 'vitest';
import { aanbod, nodigErlang, serviceLevel, wachtkans } from '@/lib/nbd/erlang';

/** De berekening uit de oude GRIP (met faculteiten), als referentie voor kleine aantallen. */
function oudeGrip(calls: number, aht: number, interval = 3600, doel = 0.8, wacht = 20): number {
  if (calls <= 0) return 0;
  const fac = (n: number) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  const c = (a: number, n: number) => {
    if (n <= a) return 1;
    const teller = (a ** n / fac(n)) * (n / (n - a));
    let som = 0;
    for (let k = 0; k < n; k++) som += a ** k / fac(k);
    return teller / (som + teller);
  };
  const a = (calls * aht) / interval;
  let n = Math.max(1, Math.ceil(a));
  for (let i = 0; i < 100; i++, n++) if (1 - c(a, n) * Math.exp(-((n - a) * wacht) / aht) >= doel) return n;
  return n;
}

describe('Erlang C', () => {
  it('geeft de bekende wachtkansen bij 10 erlang', () => {
    expect(wachtkans(10, 11)).toBeCloseTo(0.6821, 3);
    expect(wachtkans(10, 12)).toBeCloseTo(0.4494, 3);
    expect(wachtkans(10, 13)).toBeCloseTo(0.2853, 3);
    expect(wachtkans(10, 14)).toBeCloseTo(0.1741, 3);
    expect(wachtkans(10, 10)).toBe(1);
    expect(wachtkans(0, 3)).toBe(0);
  });

  it('rekent het service level en het aantal mensen uit (100 gesprekken per half uur, 3 minuten, 80% in 20 seconden)', () => {
    expect(aanbod(100, 180, 1800)).toBeCloseTo(10, 9);
    expect(serviceLevel(100, 180, 1800, 13, 20)).toBeCloseTo(0.7956, 3);
    expect(serviceLevel(100, 180, 1800, 14, 20)).toBeCloseTo(0.8884, 3);
    expect(nodigErlang(100, 180, 1800, 0.8, 20)).toBe(14);
  });

  it('geeft dezelfde uitkomst als de oude GRIP', () => {
    for (const calls of [1, 5, 12, 30, 45, 80, 120]) {
      for (const [doel, wacht] of [[0.8, 20], [0.7, 30], [0.9, 15]] as const) {
        expect(nodigErlang(calls, 300, 3600, doel, wacht)).toBe(oudeGrip(calls, 300, 3600, doel, wacht));
      }
    }
  });

  it('blijft werken bij grote aantallen (geen faculteiten die overlopen)', () => {
    const n = nodigErlang(5000, 300, 3600, 0.8, 20);
    expect(n).toBeGreaterThan(5000 * 300 / 3600);
    expect(Number.isFinite(n)).toBe(true);
    expect(serviceLevel(5000, 300, 3600, n, 20)).toBeGreaterThanOrEqual(0.8);
    expect(serviceLevel(5000, 300, 3600, n - 1, 20)).toBeLessThan(0.8);
  });

  it('meer gesprekken of een strenger doel vraagt meer mensen; zonder gesprekken niemand', () => {
    expect(nodigErlang(0, 300, 3600, 0.8, 20)).toBe(0);
    expect(nodigErlang(100, 300, 3600, 0.8, 20)).toBeGreaterThan(nodigErlang(10, 300, 3600, 0.8, 20));
    expect(nodigErlang(50, 300, 3600, 0.95, 10)).toBeGreaterThan(nodigErlang(50, 300, 3600, 0.7, 30));
    // een kwartier met een kwart van de gesprekken geeft hetzelfde aanbod als een heel uur
    expect(nodigErlang(10, 300, 900, 0.8, 20)).toBe(nodigErlang(40, 300, 3600, 0.8, 20));
  });
});
