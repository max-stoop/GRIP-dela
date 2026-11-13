import { describe, it, expect } from 'vitest';
import { ADVIES_SCHEMA, gebruikersBericht, isAdviesAntwoord, maakVraag, systeemPrompt } from '@/lib/ai/advies';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { voorstel } from '@/lib/rooster/voorstel';
import { pasToe } from '@/lib/rooster/ruil';
import { toets } from '@/lib/rooster/toets';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { STANDAARD_BELEID } from '@/lib/rooster/types';
import { isoRange } from '@/lib/dates';

let n = 0;
const team = voorbeeldTeam('Utrecht', () => `a${++n}`);
const dates = isoRange('2026-10-12', '2026-11-08');
const behoefte = behoefteVoor({ norm: NORM_STANDAARD }, 'Utrecht', dates, { alphaRegio: 0.8, tegen: 'norm' });
const cellen = pasToe({}, voorstel({ team, dates, cellen: {}, behoefte, wensen: [], beleid: STANDAARD_BELEID }));
// een fout erin, zodat de toets voorbeelden met namen heeft
const e = team.find((x) => x.functie === 'UL') ?? team[0];
const fout = pasToe(cellen, [[e.id, dates[1], '1']]);
const t = toets({ team, dates, cellen: fout, behoefte, wensen: [{ id: 'w', medewerkerId: team[0].id, regio: 'Utrecht', datum: dates[2], soort: 'vrij', gemaakt: '' }], beleid: STANDAARD_BELEID });
const { vraag, codes } = maakVraag({
  regio: 'Utrecht', vandaag: '2026-10-06', team, dates, cellen: fout, behoefte,
  wensen: [{ id: 'w', medewerkerId: team[0].id, regio: 'Utrecht', datum: dates[2], soort: 'vrij', gemaakt: '' }],
  profielen: {}, beleid: STANDAARD_BELEID, toets: t,
});

describe('AI-roosterassistent: de vraag', () => {
  it('bevat geen namen of ids van medewerkers, alleen codes', () => {
    const tekst = gebruikersBericht(vraag);
    for (const m of team) {
      expect(tekst).not.toContain(m.naam);
      expect(tekst).not.toContain(`"${m.id}"`);
    }
    expect(vraag.medewerkers.map((m) => m.code)).toEqual(team.map((_, i) => `M${i + 1}`));
    expect(codes.get('M1')).toBe(team[0].id);
  });

  it('geeft het rooster per code, de afgesproken plekken per dag en de bevindingen van de toets', () => {
    expect(Object.keys(vraag.rooster)).toHaveLength(team.length);
    expect(vraag.rooster.M1).toHaveLength(dates.length);
    expect(vraag.dagen[0].afgesproken).toBe(behoefte[dates[0]]!.k);
    expect(vraag.toets.regels.some((r) => r.paragraaf === '3.3')).toBe(true);
    expect(vraag.wensen).toEqual([{ medewerker: 'M1', datum: dates[2], wens: 'vrij' }]);
  });

  it('de systeemprompt noemt de diensten en de harde regels, en is stabiel (cache)', () => {
    const p = systeemPrompt();
    expect(p).toContain('DG2');
    expect(p).toContain('ATW en CAO');
    expect(p).toBe(systeemPrompt());
  });
});

describe('AI-roosterassistent: het antwoord', () => {
  it('het schema staat geen extra velden toe en kent geen V of Z als voorstel', () => {
    expect(ADVIES_SCHEMA.additionalProperties).toBe(false);
    expect(ADVIES_SCHEMA.properties.voorstellen.items.additionalProperties).toBe(false);
    expect(ADVIES_SCHEMA.properties.voorstellen.items.properties.dienst.enum).not.toContain('V');
    expect(ADVIES_SCHEMA.properties.voorstellen.items.properties.dienst.enum).not.toContain('Z');
  });

  it('controleert de vorm van het antwoord', () => {
    const goed = { samenvatting: 'Prima.', sterk: [], risicos: [], voorstellen: [{ medewerker: 'M2', datum: '2026-10-13', dienst: '1M', reden: 'middag' }] };
    expect(isAdviesAntwoord(goed)).toBe(true);
    expect(isAdviesAntwoord({ ...goed, voorstellen: [{ ...goed.voorstellen[0], dienst: 'X' }] })).toBe(false);
    expect(isAdviesAntwoord({ ...goed, voorstellen: [{ ...goed.voorstellen[0], datum: '13-10' }] })).toBe(false);
    expect(isAdviesAntwoord(null)).toBe(false);
  });
});
