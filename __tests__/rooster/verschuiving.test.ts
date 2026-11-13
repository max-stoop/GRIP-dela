import { describe, it, expect } from 'vitest';
import { isoRange } from '@/lib/dates';
import { behoefteVoor, verschovenOp } from '@/lib/store/afgeleid';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { dagAnalyse } from '@/lib/rooster/analyse';
import type { Verschuiving } from '@/lib/store/types';

const dates = isoRange('2027-02-01', '2027-02-14');
const afspraak: Verschuiving = { id: 'v1', vanRegio: 'Kempenland', naarRegio: 'Oost Brabant', van: '2027-02-03', tot: '2027-02-09', plekken: 1, door: 'Plan', gemaakt: '' };
const zonder = (r: string) => behoefteVoor({ norm: NORM_STANDAARD }, r, dates, { alphaRegio: 0.8, tegen: 'norm' });
const met = (r: string, v: Verschuiving[] = [afspraak]) => behoefteVoor({ norm: NORM_STANDAARD, verschuivingen: v }, r, dates, { alphaRegio: 0.8, tegen: 'norm' });

describe('regelplekken verschuiven in het cluster', () => {
  it('de ene regio doet in de periode een plek minder, de andere een meer; het cluster blijft gelijk', () => {
    const kl0 = zonder('Kempenland'), ob0 = zonder('Oost Brabant'), kl = met('Kempenland'), ob = met('Oost Brabant');
    for (const d of dates) {
      const binnen = d >= afspraak.van && d <= afspraak.tot;
      expect(kl[d]!.k).toBe(kl0[d]!.k - (binnen ? 1 : 0));
      expect(ob[d]!.k).toBe(ob0[d]!.k + (binnen ? 1 : 0));
      expect(kl[d]!.verschoven).toBe(binnen ? -1 : undefined);
      expect(kl[d]!.k + ob[d]!.k).toBe(kl0[d]!.k + ob0[d]!.k);
      // de meldingen blijven die van de regio zelf
      expect(kl[d]!.lam).toBe(kl0[d]!.lam);
    }
    expect(met('Nijmegen')).toEqual(zonder('Nijmegen'));
  });

  it('nooit minder dan nul plekken, en afspraken tellen op', () => {
    expect(verschovenOp([afspraak, { ...afspraak, id: 'v2', plekken: 2 }], 'Kempenland', '2027-02-05')).toBe(-3);
    const veel = met('Kempenland', [{ ...afspraak, plekken: 5 }, { ...afspraak, id: 'v3', plekken: 5 }]);
    for (const d of dates) expect(veel[d]!.k).toBeGreaterThanOrEqual(0);
  });

  it('de dekking van de eigen meldingen telt de plek mee die de andere regio doet, en niet de plek voor een ander', () => {
    const d = '2027-02-04';
    const kl0 = zonder('Kempenland')[d]!, kl = met('Kempenland')[d]!, ob0 = zonder('Oost Brabant')[d]!, ob = met('Oost Brabant')[d]!;
    // precies volgens de afspraak gepland: dezelfde dekking als zonder afspraak
    expect(dagAnalyse(d, kl.k, 1, kl).cov).toBeCloseTo(dagAnalyse(d, kl0.k, 1, kl0).cov!, 10);
    expect(dagAnalyse(d, ob.k, 1, ob).cov).toBeCloseTo(dagAnalyse(d, ob0.k, 1, ob0).cov!, 10);
  });
});

describe('Dg-diensten per regio', () => {
  it('een regio met een eigen minimum rekent daarmee; de rest met het algemene', async () => {
    const { beleidVoor, STANDAARD_BELEID } = await import('@/lib/rooster/types');
    const b = { ...STANDAARD_BELEID, dgPerRegio: { Nijmegen: 3 } };
    expect(beleidVoor(b, 'Nijmegen').minDG).toBe(3);
    expect(beleidVoor(b, 'Utrecht')).toBe(b);
    expect(beleidVoor(STANDAARD_BELEID, 'Nijmegen')).toBe(STANDAARD_BELEID);
  });
});
