import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accepteerRuil, beoordeelRuil, bewaarMedewerker, getState, maakRuil, toetsRuil, zetNbdDiensten } from '@/lib/store/store';
import { NBD, NBD_STANDAARD } from '@/lib/nbd/parameters';
import { maakDienst, naarTijd } from '@/lib/nbd/dienst';
import { nbdRuilToets, nbdRuilWijzigingen, nbdTijdenNa } from '@/lib/nbd/ruil';
import { addDays, fromDay, mondayOf, toDay, todayIso } from '@/lib/dates';
import type { Cellen, Medewerker, Tijden } from '@/lib/rooster/types';

// zonder IndexedDB (jsdom) mislukt het wegschrijven; de toestand in het geheugen is wat we testen
beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });

const P = NBD_STANDAARD;
const mw = (id: string, naam: string): Medewerker => ({ id, regio: NBD, naam, contract: 32, voorkeur: 'O', weekendgroep: 0, actief: true });

describe('ruilen bij de NBD', () => {
  const a = mw('a', 'Anna'), b = mw('b', 'Bart');
  const d = '2026-11-04', d2 = '2026-11-05';
  const avond = maakDienst(P, 16.5, 5.5); // 16:30-22:00
  const vroeg = maakDienst(P, 7, 6); // 07:00-13:30
  const cellen: Cellen = { a: { [d]: 'N' }, b: { [d2]: 'N' } };
  const tijden: Tijden = { a: { [d]: naarTijd(avond) }, b: { [d2]: naarTijd(vroeg) } };

  it('de tijden en de pauze gaan mee met de dienst', () => {
    const w = nbdRuilWijzigingen([['a', d, '-'], ['b', d, 'N']], cellen, tijden, 'a', 'b');
    expect(w).toEqual([['a', d, '-', null], ['b', d, 'N', avond]]);
    const na = nbdTijdenNa(tijden, w);
    expect(na.a[d]).toBeUndefined();
    expect(na.b[d]).toEqual(naarTijd(avond));
    expect(na.b[d2]).toEqual(naarTijd(vroeg));
    // onder verlof blijven de tijden bewaard (voor als het verlof wordt ingetrokken)
    expect(nbdTijdenNa(tijden, [['a', d, 'V', null]]).a[d]).toEqual(naarTijd(avond));
  });

  it('de toets ziet te weinig rust bij wie de dienst overneemt', () => {
    // Bart werkt de volgende ochtend om 7 uur: na een avonddienst tot 22:00 is dat 9 uur rust
    const t = nbdRuilToets({ team: [a, b], cellen, tijden, wijzigingen: nbdRuilWijzigingen([['a', d, '-'], ['b', d, 'N']], cellen, tijden, 'a', 'b'), p: P, minVrijeWeekenden: 0 });
    expect(t.ok).toBe(false);
    expect(t.bevindingen).toEqual([expect.objectContaining({ soort: 'atw', ernst: 'hard', tekst: expect.stringMatching(/^Bart: minder dan 11 uur rust/) })]);
    // zonder de vroege dienst is er geen bezwaar
    const zonder: Cellen = { a: cellen.a }, t2: Tijden = { a: tijden.a };
    const ok = nbdRuilToets({ team: [a, b], cellen: zonder, tijden: t2, wijzigingen: nbdRuilWijzigingen([['a', d, '-'], ['b', d, 'N']], zonder, t2, 'a', 'b'), p: P, minVrijeWeekenden: 0 });
    expect(ok).toEqual({ ok: true, bevindingen: [] });
  });

  it('in de app: aanbieden, overnemen en goedkeuren verhuist de dienst met de tijden', () => {
    const anna = bewaarMedewerker({ regio: NBD, naam: 'Anna', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const cor = bewaarMedewerker({ regio: NBD, naam: 'Cor', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const dag = addDays(fromDay(mondayOf(toDay(todayIso())) + 14), 2);
    const dienst = { start: 9, eind: 17.5, pauze: 30, pauzeStart: 13 };
    zetNbdDiensten([[anna, dag, 'N', dienst]]);
    const r = maakRuil({ soort: 'aanbieden', aanbiederId: anna, datum: dag, dienst: '-' }, 'Anna');
    expect(r.dienst).toBe('N');
    expect(toetsRuil(r, cor)).toEqual({ ok: true, bevindingen: [] });
    accepteerRuil(r.id, cor, 'Cor');
    beoordeelRuil(r.id, 'goedgekeurd', 'Planner');
    const s = getState();
    expect(s.rooster[NBD][anna]?.[dag]).toBeUndefined();
    expect(s.rooster[NBD][cor][dag]).toBe('N');
    expect(s.tijden[NBD][cor][dag]).toEqual({ start: 9, eind: 17.5, code: 'N', pauze: 30, pauzeStart: 13 });
    expect(s.tijden[NBD][anna]?.[dag]).toBeUndefined();
    expect(s.ruil.find((x) => x.id === r.id)?.status).toBe('goedgekeurd');
  });
});
