import { describe, it, expect } from 'vitest';
import { toDay, fromDay, weekday, weekdayMon, isoWeek, weekIndex, dayOfYear, holidaysOf, addDays, mondayOf } from '@/lib/dates';
import { poissonCdf, poissonQuantile, poissonBand } from '@/lib/model/poisson';
import { makeDemoHistory } from '@/lib/model/demo';
import { REGIONS } from '@/lib/model/config';

describe('datums', () => {
  it('rekent heen en terug zonder tijdzonefouten', () => {
    for (const s of ['1970-01-01', '2024-02-29', '2026-03-29', '2026-10-25', '2027-01-01']) expect(fromDay(toDay(s))).toBe(s);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('weekdagen en weeknummers', () => {
    expect(weekday(toDay('2026-10-05'))).toBe(1); // maandag
    expect(weekdayMon(toDay('2026-10-11'))).toBe(6); // zondag
    expect(isoWeek(toDay('2026-12-28'))).toBe(53);
    expect(isoWeek(toDay('2027-01-04'))).toBe(1);
    expect(isoWeek(toDay('2026-01-01'))).toBe(1);
    expect(dayOfYear(toDay('2024-12-31'))).toBe(366);
    expect(fromDay(mondayOf(toDay('2026-10-11')))).toBe('2026-10-05');
  });

  it('doorlopende weken springen niet rond de jaarwisseling', () => {
    const a = weekIndex(toDay('2026-12-28')), b = weekIndex(toDay('2027-01-04'));
    expect(b - a).toBe(1);
    // ISO: week 53 en week 1 zijn allebei oneven; doorlopend wisselt de pariteit wel
    expect(a % 2).not.toBe(b % 2);
  });

  it('feestdagen gelijk aan de lijst van het prototype (2023 t/m 2027)', () => {
    const proto = [
      '2023-01-01', '2023-04-09', '2023-04-10', '2023-04-27', '2023-05-18', '2023-05-28', '2023-05-29', '2023-12-25', '2023-12-26',
      '2024-01-01', '2024-03-31', '2024-04-01', '2024-04-27', '2024-05-09', '2024-05-19', '2024-05-20', '2024-12-25', '2024-12-26',
      '2025-01-01', '2025-04-20', '2025-04-21', '2025-04-26', '2025-05-05', '2025-05-29', '2025-06-08', '2025-06-09', '2025-12-25', '2025-12-26',
      '2026-01-01', '2026-04-05', '2026-04-06', '2026-04-27', '2026-05-14', '2026-05-24', '2026-05-25', '2026-12-25', '2026-12-26',
      '2027-01-01', '2027-03-28', '2027-03-29', '2027-04-27', '2027-05-06', '2027-05-16', '2027-05-17', '2027-12-25', '2027-12-26',
    ];
    const mine = [2023, 2024, 2025, 2026, 2027].flatMap((y) => [...holidaysOf(y)].map(fromDay)).sort();
    expect(mine).toEqual([...proto].sort());
  });
});

describe('Poisson', () => {
  const brute = (k: number, lam: number) => {
    let s = 0;
    for (let i = 0; i <= k; i++) {
      let lp = -lam + i * Math.log(lam);
      for (let j = 2; j <= i; j++) lp -= Math.log(j);
      s += Math.exp(lp);
    }
    return s;
  };

  it('cdf klopt voor kleine en grote λ', () => {
    for (const [k, lam] of [[3, 4.3], [6, 4.3], [25, 22.1], [120, 110], [950, 900]]) expect(poissonCdf(k, lam)).toBeCloseTo(brute(k, lam), 9);
  });

  it('kwantiel is het kleinste k met cdf >= alpha', () => {
    for (const lam of [0.5, 2.5, 4.3, 5.5, 12, 30, 110]) {
      const k = poissonQuantile(0.8, lam);
      expect(poissonCdf(k, lam)).toBeGreaterThanOrEqual(0.8);
      if (k > 0) expect(poissonCdf(k - 1, lam)).toBeLessThan(0.8);
    }
  });

  it('band is symmetrisch rond grote λ', () => {
    const lo = poissonBand(0.1, 900), hi = poissonBand(0.9, 900);
    expect(900 - lo).toBe(hi - 900);
  });
});

describe('demodata', () => {
  it('maakt per regio een volledige reeks tot gisteren, reproduceerbaar', () => {
    const a = makeDemoHistory('2026-10-05'), b = makeDemoHistory('2026-10-05');
    expect(a.start).toBe('2022-07-01');
    expect(Object.keys(a.regios)).toEqual(REGIONS);
    expect(a.regios.Utrecht.length).toBe(a.n);
    expect(fromDay(toDay(a.start) + a.n - 1)).toBe('2026-10-04');
    expect(a.regios.Utrecht).toEqual(b.regios.Utrecht);
    const mean = a.regios['Zuid Limburg'].reduce((s: number, v) => s + (v ?? 0), 0) / a.n;
    expect(mean).toBeGreaterThan(4.5);
    expect(mean).toBeLessThan(7);
  });
});
