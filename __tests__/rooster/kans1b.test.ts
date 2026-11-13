import { describe, it, expect } from 'vitest';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { clusterDag, normRegioDag, spelingOpDag } from '@/lib/capaciteit/beschikbaarheid';
import { lamNorm, normWeek, plekkenNorm, regiosVanCluster } from '@/lib/capaciteit/norm';
import { toDay, weekdayMon } from '@/lib/dates';
import { normRun, NORM_RUN_ID } from '@/lib/capaciteit/normrun';
import { kans1BPerDag, kans1BUitleg, plekkenUitRooster } from '@/lib/rooster/kans1b';
import { lam, plekken } from '@/lib/store/afgeleid';
import { HORIZON_DAYS, REGIONS } from '@/lib/model/config';
import type { Cellen } from '@/lib/rooster/types';

const n = NORM_STANDAARD;
const D = '2026-10-13';

describe('de vastgestelde regelplekken als voorspelling', () => {
  it('normRun geeft per regio de verwachting en de plekken op 80% van de norm, vanaf de dag na vandaag', () => {
    const r = normRun(n, '2026-10-07');
    expect(r.meta.id).toBe(NORM_RUN_ID);
    expect(r.data.dates).toHaveLength(HORIZON_DAYS);
    expect(r.data.dates[0]).toBe('2026-10-08');
    expect(r.data.regios).toEqual(REGIONS);
    for (const regio of ['Utrecht', 'Friesland', 'Zuid Limburg']) {
      expect(lam(r.data, regio, D)).toBeCloseTo(lamNorm(n, regio, D)!, 10);
      expect(plekken(r.data, regio, D, n.dekkingRegio)).toBe(plekkenNorm(n, regio, D));
    }
    expect(normRun(n, '2026-10-07')).toBe(r);
  });
});

describe('kans dat een 1B valt, uit het rooster', () => {
  it('telt regeldiensten met hun plekken; 1B apart; verlof, ziek en Dg tellen niet', () => {
    const c: Cellen = { a: { [D]: '1' }, b: { [D]: '2' }, c: { [D]: '1B' }, d: { [D]: 'Z' }, e: { [D]: 'DG2' }, f: { [D]: '1M' } };
    expect(plekkenUitRooster(c, ['a', 'b', 'c', 'd', 'e', 'f'], D)).toEqual({ diensten: [1, 2, 1], beschikbaar: 1 });
  });

  it('regio\'s zonder rooster rekenen met de vastgestelde plekken; met een rooster tellen de echte diensten', () => {
    const regios = regiosVanCluster(n, 'O');
    const zonder = kans1BPerDag({ normen: n, cluster: 'O', regios, dates: [D], lam: () => null, rooster: () => null })[0]!;
    const week = normWeek(D), dag = weekdayMon(toDay(D));
    expect(zonder).toEqual(clusterDag(regios.map((r) => normRegioDag(n, r, week, dag)!), n.uitval, spelingOpDag(n, 'O', week, dag)));
    expect(zonder.regios.every((r) => r.bron === 'norm')).toBe(true);

    // Utrecht met een krap rooster: minder plekken, dus een grotere kans dat een 1B valt
    const team = ['u1', 'u2', 'u3'];
    const cellen: Cellen = { u1: { [D]: '1' }, u2: { [D]: '1' }, u3: { [D]: '1B' } };
    const krap = kans1BPerDag({ normen: n, cluster: 'O', regios, dates: [D], lam: () => null, rooster: (r) => (r === 'Utrecht' ? { cellen, team } : null) })[0]!;
    expect(krap.regios.find((r) => r.regio === 'Utrecht')!.bron).toBe('rooster');
    expect(krap.cluster.regulier).toBeLessThan(zonder.cluster.regulier);
    expect(krap.cluster.gemiddeld).toBeGreaterThan(zonder.cluster.gemiddeld);
    expect(kans1BUitleg(krap, 'Utrecht', 'Oost', n.uitval)).toMatch(/eerst naar een vrije plek.*Als Utrecht alles zelf moest opvangen/);
  });

  it('een hogere voorspelling maakt de kans groter', () => {
    const regios = regiosVanCluster(n, 'O');
    const normaal = kans1BPerDag({ normen: n, cluster: 'O', regios, dates: [D], lam: () => null, rooster: () => null })[0]!;
    const druk = kans1BPerDag({ normen: n, cluster: 'O', regios, dates: [D], lam: (r, d) => lamNorm(n, r, d)! * 1.3, rooster: () => null })[0]!;
    expect(druk.cluster.gemiddeld).toBeGreaterThan(normaal.cluster.gemiddeld);
  });
});
