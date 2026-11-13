import { describe, expect, it } from 'vitest';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { maxUren, nbdCapaciteitWeek, nbdUrenPerWeek } from '@/lib/nbd/capaciteit';
import { addDays } from '@/lib/dates';
import { NBD, NBD_STANDAARD } from '@/lib/nbd/parameters';
import type { Medewerker } from '@/lib/rooster/types';

const P = NBD_STANDAARD;
const mw = (i: number, contract: number, extra: Partial<Medewerker> = {}): Medewerker => ({ id: `m${i}`, regio: NBD, naam: `M${i}`, contract, voorkeur: 'O', weekendgroep: 0, actief: true, ...extra });

describe('capaciteit van de NBD per week (tabblad Capaciteit NBD 2026)', () => {
  // 40 medewerkers, samen 935,2 contracturen; 33 van hen met een variabel rooster (4 uur extra): 1.067,2
  const team = Array.from({ length: 40 }, (_, i) => mw(i, 23.38, i < 33 ? { maxUren: 27.38 } : {}));

  it('rekent van bruto naar netto zoals de capaciteitsplanning', () => {
    const w = nbdCapaciteitWeek({ p: P, normen: NORM_STANDAARD, team }, '2026-11-11');
    expect(w.maandag).toBe('2026-11-09');
    expect(w.medewerkers).toBe(40);
    expect(w.bruto).toBeCloseTo(935.2, 6);
    expect(w.brutoMax).toBeCloseTo(1067.2, 6);
    expect(w.ziek).toBeCloseTo(46.76, 6);
    expect(w.overigVerzuim).toBe(32);
    expect(w.beschikbaar).toBeCloseTo(856.44, 6);
    expect(w.training).toBe(20);
    expect(w.pauze).toBeCloseTo(18.704, 6);
    expect(w.overig).toBeCloseTo(118.704, 6);
    expect(w.netto).toBeCloseTo(737.736, 6);
    // netto benodigd: 92% van de Erlang-uren van die week
    expect(w.erlangUren).toBeCloseTo(nbdUrenPerWeek(P, NORM_STANDAARD, '2026-11-09'), 9);
    expect(w.benodigd).toBeCloseTo(w.erlangUren * 0.92, 9);
    expect(w.ruimte).toBeCloseTo(w.netto - w.benodigd, 9);
    expect(w.ruimteMax).toBeGreaterThan(w.ruimte + 100);
  });

  it('verlof gaat van de beschikbare uren af, niet van de ruimte die er voor verlof is', () => {
    const zonder = nbdCapaciteitWeek({ p: P, normen: NORM_STANDAARD, team }, '2026-11-09');
    const verlofPerWeek = new Map([['2026-11-09', { goed: 46.76, aan: 10 }]]);
    const met = nbdCapaciteitWeek({ p: P, normen: NORM_STANDAARD, team, verlofPerWeek }, '2026-11-09');
    expect(met.verlof).toBeCloseTo(46.76, 6);
    expect(met.aangevraagd).toBe(10);
    expect(met.beschikbaar).toBeCloseTo(zonder.beschikbaar - 46.76, 6);
    expect(met.ruimte).toBeCloseTo(zonder.ruimte, 6);
    expect(met.over).toBeCloseTo(zonder.over - 46.76, 6);
  });

  it('telt alleen actieve medewerkers in de bezetting, geen externe krachten', () => {
    const w = nbdCapaciteitWeek({ p: P, normen: NORM_STANDAARD, team: [...team, mw(90, 24, { extern: true }), mw(91, 36, { actief: false })] }, '2026-11-09');
    expect(w.medewerkers).toBe(40);
    expect(w.bruto).toBeCloseTo(935.2, 6);
  });

  it('volgt de overlijdens: in de winter meer uren nodig dan in de zomer', () => {
    const jaar = Array.from({ length: 52 }, (_, w) => nbdCapaciteitWeek({ p: P, normen: NORM_STANDAARD, team }, addDays('2026-01-05', 7 * w)));
    expect(jaar).toHaveLength(52);
    const februari = jaar.find((w) => w.maandag === '2026-02-02')!;
    const september = jaar.find((w) => w.maandag === '2026-09-07')!;
    expect(februari.erlangUren).toBeGreaterThan(september.erlangUren);
    // gemiddeld over het jaar ongeveer een gewone week (663,5 uur)
    const gem = jaar.reduce((a, w) => a + w.erlangUren, 0) / jaar.length;
    expect(gem).toBeGreaterThan(640);
    expect(gem).toBeLessThan(700);
  });

  it('maximale inzet: het opgegeven maximum, anders het contract', () => {
    expect(maxUren({ contract: 24 })).toBe(24);
    expect(maxUren({ contract: 24, maxUren: 28 })).toBe(28);
    expect(maxUren({ contract: 24, maxUren: 20 })).toBe(24);
  });
});
