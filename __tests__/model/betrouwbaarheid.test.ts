import { describe, it, expect } from 'vitest';
import { betrouwbaarheid, poissonPmf, verdeling } from '@/lib/model/betrouwbaarheid';
import { isoRange } from '@/lib/dates';
import type { RunData, RunMeta } from '@/lib/model/types';

describe('kansverdeling', () => {
  it('telt op tot (bijna) 1 en piekt rond λ', () => {
    for (const lam of [0.7, 4.3, 22, 110]) {
      const d = verdeling(lam);
      expect(d.reduce((a, x) => a + x.p, 0)).toBeGreaterThan(0.999);
      const top = d.reduce((a, x) => (x.p > a.p ? x : a));
      expect(Math.abs(top.k - lam)).toBeLessThanOrEqual(1);
    }
    expect(poissonPmf(0, 2)).toBeCloseTo(Math.exp(-2), 12);
  });
});

describe('betrouwbaarheid', () => {
  const dates = isoRange('2026-09-01', '2026-09-30');
  const meta = (uitgegeven: string): RunMeta => ({ id: uitgegeven, soort: 't', uitgegeven, gemaakt: `${uitgegeven}T06:00:00`, info: {} as never });
  const run = (uitgegeven: string, lam: number): RunData => ({ id: uitgegeven, dates, regios: ['Utrecht'], lam: [dates.map(() => lam)], base: [dates.map(() => lam)], fac: {} });
  const meldingen = { start: '2026-09-01', n: 30, regios: { Utrecht: dates.map((_, i) => (i % 2 ? 4 : 6)) } };

  it('meet afwijking, scheefheid en band per afstand', () => {
    const b = betrouwbaarheid([{ meta: meta('2026-08-31'), data: run('2026-08-31', 5) }], meldingen, ['Utrecht']);
    expect(b.buckets.map((x) => x.naam)).toEqual(['1 tot 7 dagen', '8 tot 16 dagen', '17 tot 30 dagen']);
    for (const x of b.buckets) {
      expect(x.mae).toBeCloseTo(1, 6);
      expect(Math.abs(x.bias)).toBeLessThan(0.05);
      expect(x.inBand).toBe(1);
    }
    expect(b.reeks.length).toBe(27); // vanaf 4 dagen vooruit
    expect(b.dataEind).toBe('2026-09-30');
  });

  it('kiest per dag de meest recente run die minstens 4 dagen vooruit was', () => {
    const b = betrouwbaarheid([
      { meta: meta('2026-08-31'), data: run('2026-08-31', 5) },
      { meta: meta('2026-09-10'), data: run('2026-09-10', 9) },
    ], meldingen, ['Utrecht']);
    const p13 = b.reeks.find((p) => p.datum === '2026-09-13')!, p14 = b.reeks.find((p) => p.datum === '2026-09-14')!;
    expect(p13.verwacht).toBe(5);
    expect(p14.verwacht).toBe(9);
  });
});
