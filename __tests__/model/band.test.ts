import { describe, it, expect } from 'vitest';
import { band, bandUitleg, MIN_VERGELIJKINGEN } from '@/lib/model/band';
import { betrouwbaarheid, bucketVoor, type Bucket } from '@/lib/model/betrouwbaarheid';
import { bandDekking, poissonCdf } from '@/lib/model/poisson';
import { isoRange } from '@/lib/dates';
import type { RunData, RunMeta } from '@/lib/model/types';

const bucket = (binnenSom: number, punten: number, bias = 0, binnenSomVerwacht = 0.81): Bucket => ({ naam: '8 tot 16 dagen', van: 8, tot: 16, punten, mae: 5, bias, inBand: 0.8, inBandVerwacht: 0.86, regioDagen: punten * 25, binnenSom, binnenSomVerwacht });

describe('bandbreedte van één dag', () => {
  it('80% binnen 95%, rond de verwachting, en de kans klopt', () => {
    for (const lam of [0.7, 4.3, 22, 119.6, 450]) {
      const b = band(lam);
      expect(b.lo95).toBeLessThanOrEqual(b.lo80);
      expect(b.hi80).toBeLessThanOrEqual(b.hi95);
      expect(b.lo80).toBeLessThanOrEqual(lam);
      expect(b.hi80).toBeGreaterThanOrEqual(lam);
      if (lam < 300) {
        expect(poissonCdf(b.hi80, lam) - poissonCdf(b.lo80 - 1, lam)).toBeGreaterThanOrEqual(0.8);
        expect(poissonCdf(b.hi95, lam) - poissonCdf(b.lo95 - 1, lam)).toBeGreaterThanOrEqual(0.95);
      }
    }
    expect(band(119.6)).toEqual({ lo80: 106, hi80: 134, lo95: 99, hi95: 141 });
  });

  it('door hele aantallen dekt de band bij weinig meldingen meer dan 80%', () => {
    expect(bandDekking(3.9)).toBeCloseTo(poissonCdf(7, 3.9) - poissonCdf(1, 3.9), 12);
    expect(bandDekking(3.9)).toBeGreaterThan(0.85);
    expect(bandDekking(119.6)).toBeGreaterThanOrEqual(0.8);
    expect(bandDekking(119.6)).toBeLessThan(0.83);
    expect(bandUitleg(3.9, band(3.9), 'Utrecht', undefined, 0.8).wat).toContain('tussen 2 en 7 (door de hele aantallen hier zelfs op 86%), op 19 van de 20 tussen 1 en 8.');
    expect(bandUitleg(119.6, band(119.6), 'landelijk', undefined, 0.8).wat).not.toContain('hele aantallen');
  });

  it('zegt in gewone taal wat de band is en waarom hij zo breed is', () => {
    const u = bandUitleg(119.6, band(119.6), 'landelijk', undefined, 0.8);
    expect(u.wat).toBe('119,6 is een gemiddelde. Het werkelijke aantal meldingen landelijk schommelt van dag tot dag: op 8 van de 10 van zulke dagen ligt het tussen 106 en 134, op 19 van de 20 tussen 99 en 141.');
    expect(u.waarom).toContain('Hier is de band ongeveer ±12% rond de verwachting.');
    expect(u.plekken).toContain('Niet hetzelfde als de plekken op 80%');
    // zonder eigen voorspellingen geen terugblik
    expect(u.terug).toBeNull();
    expect(u.aanname).toBeNull();
    expect(bandUitleg(4.3, band(4.3), 'Utrecht', undefined, 0.8).wat).toContain('meldingen in Utrecht');
    // bij heel weinig meldingen geen procent rond de verwachting
    expect(bandUitleg(0.7, band(0.7), 'Utrecht', undefined, 0.8).waarom).not.toContain('±');
  });

  it('kijkt terug: goed, te smal, te ruim, nog weinig of nog niets', () => {
    const b = band(119.6);
    const oordeel = (x: Bucket | null) => bandUitleg(119.6, b, 'landelijk', x, 0.8);
    expect(oordeel(null).oordeel).toBe('geen');
    expect(oordeel(null).terug).toContain('zodra er genoeg voorspelde dagen voorbij zijn');
    expect(oordeel(bucket(3, MIN_VERGELIJKINGEN - 1)).oordeel).toBe('weinig');
    const goed = oordeel(bucket(24, 30));
    expect(goed.oordeel).toBe('goed');
    expect(goed.aanname).toContain('De band gaat ervan uit dat de verwachting klopt.');
    expect(goed.terug).toBe('Op 8 tot 16 dagen vooruit viel het werkelijke aantal landelijk 24 van de 30 keer binnen de band (80%). Als de verwachting klopt, hoort dat ongeveer 81% te zijn. De band klopt op deze afstand goed.');
    const smal = oordeel(bucket(21, 30, 0.042));
    expect(smal.oordeel).toBe('smal');
    expect(smal.terug).toContain('te smal: reken op meer uitschieters dan de band aangeeft.');
    expect(smal.terug).toContain('Gemiddeld kwamen er 4,2% meer meldingen dan voorspeld.');
    expect(oordeel(bucket(27, 30)).oordeel).toBe('ruim');
    // vergeleken met wat de band hoort te halen, niet met een vaste 80%: 88% is goed als 86% hoort
    expect(oordeel(bucket(26, 30, 0, 0.86)).oordeel).toBe('goed');
  });
});

describe('terugblik op de band van het totaal', () => {
  const dates = isoRange('2026-09-01', '2026-09-30');
  const meta = (uitgegeven: string): RunMeta => ({ id: uitgegeven, soort: 't', uitgegeven, gemaakt: `${uitgegeven}T06:00:00`, info: {} as never });
  const run: RunData = { id: 'r', dates, regios: ['Utrecht', 'Flevoland'], lam: [dates.map(() => 5), dates.map(() => 5)], base: [dates.map(() => 5), dates.map(() => 5)], fac: {} };

  it('telt per afstand hoe vaak het totaal binnen de band van het totaal viel', () => {
    // elke regio binnen haar eigen band (3 tot 8), maar samen 16 boven de band van het totaal (6 tot 14)
    const m = { start: '2026-09-01', n: 30, regios: { Utrecht: dates.map(() => 8), Flevoland: dates.map(() => 8) } };
    const b = betrouwbaarheid([{ meta: meta('2026-08-31'), data: run }], m, ['Utrecht', 'Flevoland']);
    for (const x of b.buckets) {
      expect(x.inBand).toBe(1);
      expect(x.binnenSom).toBe(0);
      expect(x.inBandVerwacht).toBeCloseTo(bandDekking(5), 12);
      expect(x.binnenSomVerwacht).toBeCloseTo(bandDekking(10), 12);
    }
    expect(bucketVoor(b.buckets, 10)?.naam).toBe('8 tot 16 dagen');
    expect(bucketVoor(b.buckets, 0)).toBeNull();
    const een = betrouwbaarheid([{ meta: meta('2026-08-31'), data: run }], m, ['Utrecht']);
    expect(een.buckets.every((x) => x.binnenSom === x.punten)).toBe(true);
  });
});
