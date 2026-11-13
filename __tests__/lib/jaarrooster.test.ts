import { describe, it, expect } from 'vitest';
import { codesTellen, jaarUitNaam, leesDagen, leesJaarrooster, weekendCadansUit, CODE_STANDAARD, type Cel } from '@/lib/jaarrooster';
import { addDays } from '@/lib/dates';
import { getState, importeerJaarrooster, zetCellen, bewaarMedewerker } from '@/lib/store/store';
import type { DienstCode } from '@/lib/rooster/types';

/** Een verzonnen jaarrooster: kop, datumrij met dagnummers vanaf maandag 29 december, drie medewerkers en een flexrij. */
function blad(naam: string, dagen = 28): { sheet: string; data: Cel[][] } {
  const nrs = Array.from({ length: dagen }, (_, i) => Number(addDays('2025-12-29', i).slice(8, 10)));
  const rij = (n: string, contract: Cel, f: (i: number) => string) => [n, contract, ...Array.from({ length: dagen }, (_, i) => f(i))];
  return {
    sheet: naam,
    data: [
      ['Planning', null], [null], [null], [null],
      [null, 'datum', ...nrs, 'totaal'],
      ['mw', 'contract-uren', ...nrs.map(() => 'm')],
      rij('Medewerker A', 32, (i) => (i % 7 < 4 ? '1' : 'vrij')),
      rij('Medewerker B', 28, (i) => (i % 7 === 5 || i % 7 === 6 ? (Math.floor(i / 7) % 2 === 0 ? 'DG' : 'vrij') : i === 2 ? 'RV' : 'z')),
      rij('Flex C', 'F', () => '1'),
      rij('Medewerker D', 36, (i) => (i === 3 ? 'S' : 'V0')),
      ['regelplekken gepland', null, ...nrs.map(() => 3)],
    ],
  };
}

describe('jaarrooster inlezen', () => {
  it('het jaar uit de bestandsnaam en de dagen vanaf maandag van week 1', () => {
    expect(jaarUitNaam('2026_Jaarrooster_NW.xlsx')).toBe(2026);
    expect(jaarUitNaam('rooster.xlsx')).toBeNull();
    expect(leesDagen([29, 30, 31, 1, 2, 'totaal'], 2026)).toEqual(['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    expect(leesDagen([1, 2, 3], 2026)?.[0]).toBe('2026-01-01');
    expect(leesDagen([5, 9], 2026)).toBeNull();
  });

  it('bladen per regio, rijen zonder namen, flex overgeslagen, varianten uit', () => {
    const uit = leesJaarrooster([blad('AMS'), blad('NHN (voorkeuren juni)'), blad('Instructie', 0), { sheet: 'Leeg', data: [[null]] }], '2026_Jaarrooster.xlsx');
    expect(uit.map((b) => [b.blad, b.regio, b.variant])).toEqual([['AMS', 'Amsterdam', false], ['NHN (voorkeuren juni)', 'Noord-Holland', true]]);
    const ams = uit[0];
    expect(ams.dagen).toHaveLength(28);
    expect(ams.rijen.map((r) => [r.nr, r.contract])).toEqual([[1, 32], [2, 28], [3, 36]]);
    expect(ams.overgeslagen).toBe(1);
    // nergens een naam
    expect(JSON.stringify(ams)).not.toMatch(/Medewerker|Flex/);
    expect([...codesTellen([ams]).keys()]).toEqual(expect.arrayContaining(['1', 'vrij', 'dg', 'z', 'rv', 's', 'v0']));
    expect(CODE_STANDAARD.dg).toBe('DG2');
    expect(CODE_STANDAARD.s).toBeUndefined();
  });

  it('de weekendcadans uit het rooster: om het weekend, elk weekend of nooit', () => {
    const dagen = Array.from({ length: 56 }, (_, i) => addDays('2026-01-05', i));
    const omHet = dagen.map((d, i) => ((new Date(d).getUTCDay() % 6 === 0) && Math.floor(i / 7) % 2 === 0 ? '1' : '-')) as DienstCode[];
    expect(weekendCadansUit(dagen, omHet).cadans).toBe(2);
    const elk = dagen.map((d) => (new Date(d).getUTCDay() % 6 === 0 ? '1' : '-')) as DienstCode[];
    expect(weekendCadansUit(dagen, elk).cadans).toBe(1);
    const eenOpDrie = dagen.map((d, i) => ((new Date(d).getUTCDay() % 6 === 0) && Math.floor(i / 7) % 3 === 0 ? '1' : '-')) as DienstCode[];
    expect(weekendCadansUit(dagen, eenOpDrie).cadans).toBe(3);
  });
});

describe('jaarrooster importeren', () => {
  it('nieuwe medewerkers als "AMS 01", verlof en ziekte blijven staan, opnieuw importeren gebruikt dezelfde', () => {
    const regio = 'Spaarne-Rijnland';
    const bestaand = bewaarMedewerker({ regio, naam: 'Bas O.', contract: 24, voorkeur: 'O', weekendgroep: 0 });
    zetCellen(regio, [[bestaand, '2026-02-02', 'V']]);
    const rij = (nr: number, id: string | null) => ({ nr, contract: 32, cadans: 3, groep: 1, medewerkerId: id, diensten: { '2026-02-02': '1' as DienstCode, '2026-02-03': 'DG2' as DienstCode }, wensVrij: ['2026-02-04'] });
    const r1 = importeerJaarrooster(regio, 'SR', [rij(1, null), rij(2, bestaand)], { alleenLeeg: false }, 'test');
    expect(r1).toEqual({ nieuw: 1, diensten: 3, wensen: 2 });
    const s = getState();
    const sr01 = s.medewerkers.find((m) => m.naam === 'SR 01')!;
    expect(sr01).toMatchObject({ regio, contract: 32, weekendCadans: 3, weekendgroep: 1 });
    expect(s.rooster[regio][bestaand]['2026-02-02']).toBe('V');
    expect(s.rooster[regio][sr01.id]['2026-02-03']).toBe('DG2');
    // tweede keer: dezelfde SR 01, alleen lege vakjes
    const r2 = importeerJaarrooster(regio, 'SR', [{ ...rij(1, null), diensten: { '2026-02-02': '2' as DienstCode, '2026-02-05': '1' as DienstCode } }], { alleenLeeg: true }, 'test');
    expect(r2).toEqual({ nieuw: 0, diensten: 1, wensen: 0 });
    expect(getState().rooster[regio][sr01.id]['2026-02-02']).toBe('1');
  });
});
