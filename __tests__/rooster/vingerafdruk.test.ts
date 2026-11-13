import { describe, it, expect, vi, beforeAll } from 'vitest';
import { voorstelBasis } from '@/lib/rooster/vingerafdruk';
import { bewaarMedewerker, getState, pasBijsturingToe, zetCellen } from '@/lib/store/store';
import type { Cellen, Medewerker } from '@/lib/rooster/types';

// zonder IndexedDB (jsdom) mislukt het wegschrijven; de toestand in het geheugen is wat we testen
beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });

const team: Medewerker[] = [
  { id: 'a', regio: 'Utrecht', naam: 'Anna', contract: 32, voorkeur: 'O', weekendgroep: 0, actief: true },
  { id: 'b', regio: 'Utrecht', naam: 'Bram', contract: 32, voorkeur: 'M', weekendgroep: 1, actief: true },
];
const dates = ['2026-11-02', '2026-11-03', '2026-11-04'];

describe('vingerafdruk van een roostervoorstel', () => {
  const cellen: Cellen = { a: { '2026-11-02': '1', '2026-10-01': 'DG2' }, b: { '2026-11-03': '1M' } };

  it('dezelfde gegevens geven dezelfde vingerafdruk, ook in een andere volgorde of als nieuwe objecten', () => {
    const kopie: Cellen = { b: { '2026-11-03': '1M' }, a: { '2026-10-01': 'DG2', '2026-11-02': '1' } };
    expect(voorstelBasis({ team, dates, cellen: kopie, overig: [{ y: 1, x: 2 }] })).toBe(voorstelBasis({ team, dates, cellen, overig: [{ x: 2, y: 1 }] }));
  });

  it('een gewijzigde dienst, in de periode of vlak ervoor, maakt het voorstel verouderd; ver ervoor niet', () => {
    const basis = voorstelBasis({ team, dates, cellen });
    expect(voorstelBasis({ team, dates, cellen: { ...cellen, b: { ...cellen.b, '2026-11-04': '1' } } })).not.toBe(basis);
    expect(voorstelBasis({ team, dates, cellen: { ...cellen, b: { ...cellen.b, '2026-10-25': 'DG1' } } })).not.toBe(basis);
    expect(voorstelBasis({ team, dates, cellen: { ...cellen, b: { ...cellen.b, '2026-09-01': 'DG1' } } })).toBe(basis);
  });

  it('ook een ander team, contract of andere overige invoer (wensen, verlof, beleid) telt', () => {
    const basis = voorstelBasis({ team, dates, cellen, overig: [{ wens: 1 }] });
    expect(voorstelBasis({ team: [{ ...team[0], contract: 24 }, team[1]], dates, cellen, overig: [{ wens: 1 }] })).not.toBe(basis);
    expect(voorstelBasis({ team, dates, cellen, overig: [{ wens: 2 }] })).not.toBe(basis);
  });
});

describe('een bijsturing doorvoeren', () => {
  it('alleen als het rooster van die dag nog is zoals toen de actie werd berekend', () => {
    const a = bewaarMedewerker({ regio: 'Amsterdam', naam: 'Anna', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const b = bewaarMedewerker({ regio: 'Amsterdam', naam: 'Bram', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    zetCellen('Amsterdam', [[a, '2026-11-10', '1'], [b, '2026-11-10', 'DG2']]);
    const gezien = getState().rooster.Amsterdam;
    // intussen wijzigt een collega een andere dienst op dezelfde dag
    zetCellen('Amsterdam', [[b, '2026-11-10', '1']]);
    expect(() => pasBijsturingToe('Amsterdam', [[a, '2026-11-10', '2']], 'Extra regeling', 'Plan', gezien)).toThrow(/intussen gewijzigd/);
    expect(getState().rooster.Amsterdam[a]['2026-11-10']).toBe('1');
    // met de actuele stand gaat het wel; een wijziging op een andere dag doet er niet toe
    const opnieuw = getState().rooster.Amsterdam;
    zetCellen('Amsterdam', [[b, '2026-11-11', 'DG1']]);
    pasBijsturingToe('Amsterdam', [[a, '2026-11-10', '2']], 'Extra regeling', 'Plan', opnieuw);
    expect(getState().rooster.Amsterdam[a]['2026-11-10']).toBe('2');
  });
});
