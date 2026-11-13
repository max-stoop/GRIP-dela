import { describe, expect, it } from 'vitest';
import { nbdDemo } from '@/lib/nbd/demo';
import { NBD_STANDAARD } from '@/lib/nbd/parameters';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { nbdBehoefte } from '@/lib/nbd/behoefte';
import { toetsNbd } from '@/lib/nbd/toets';
import { isoRange } from '@/lib/dates';

describe('NBD-demo', () => {
  it('maakt een team en een rooster zonder ATW- of CAO-overtredingen', () => {
    let n = 0;
    // zoals in de demo: van het begin van deze maand tot het eind van de maand over twee maanden
    const vandaag = '2026-10-08', van = '2026-10-01', tot = '2026-12-31';
    const t0 = Date.now();
    const d = nbdDemo({ vandaag, van, tot, p: NBD_STANDAARD, normen: NORM_STANDAARD, maakId: () => `m${++n}`, minVrijeWeekenden: 26, stempel: `${vandaag}T08:00:00` });
    const duur = Date.now() - t0;
    expect(d.team.length).toBeGreaterThan(12);
    expect(d.verlof.length).toBeGreaterThan(0);
    const dates = isoRange(vandaag, tot);
    const behoefte = nbdBehoefte({ norm: NORM_STANDAARD }, NBD_STANDAARD, dates, 'basis');
    const t = toetsNbd({ team: d.team, dates, cellen: d.cellen, tijden: d.tijden, behoefte, p: NBD_STANDAARD, profielen: d.profielen, wensen: d.wensen, minVrijeWeekenden: 26 });
    expect(t.hard).toBe(0);
    expect(t.sl).toBeGreaterThan(0.75);
    // verlof blijft verlof
    for (const v of d.verlof) expect(d.cellen[v.medewerkerId][v.van]).toBe('V');
    expect(duur).toBeLessThan(15000);
  }, 30_000);
});
