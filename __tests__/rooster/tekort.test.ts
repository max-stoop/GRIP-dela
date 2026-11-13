/** Status en cijfer bij te weinig regelplekken: zoals het advies rood is, voldoet het rooster ook niet. */
import { describe, it, expect } from 'vitest';
import { isoRange } from '@/lib/dates';
import { toets, tekortStand } from '@/lib/rooster/toets';
import { voorstel } from '@/lib/rooster/voorstel';
import { adviesVoorstel } from '@/lib/rooster/advies';
import { poissonQuantile } from '@/lib/model/poisson';
import { STANDAARD_BELEID, type Behoefte, type Cellen, type DienstCode, type Medewerker } from '@/lib/rooster/types';

const dates = isoRange('2027-03-01', '2027-03-31');
const mk = (i: number, contract = 36, functie: 'UV' | 'UL' = 'UV'): Medewerker => ({ id: `m${i}`, regio: 'Utrecht', naam: `M${i}`, contract, voorkeur: 'O', weekendgroep: i % 2, functie, actief: true });
const team: Medewerker[] = [...Array.from({ length: 14 }, (_, i) => mk(i)), mk(14, 32, 'UL'), mk(15, 32, 'UL')];
const behoefte: Behoefte = Object.fromEntries(dates.map((d) => [d, { k: poissonQuantile(0.8, 4.5), lam: 4.5, bron: 'basis' as const }]));
const vol = (() => {
  const c: Cellen = {};
  for (const [m, d, s] of voorstel({ team, dates, cellen: {}, behoefte, wensen: [], beleid: STANDAARD_BELEID, opnieuw: true })) (c[m] ??= {})[d] = s;
  return c;
})();
/** Op de gekozen dagen `n` enkele regeldiensten weg. */
const zonder = (n: number, dagen = dates): Cellen => {
  const c: Cellen = JSON.parse(JSON.stringify(vol));
  for (const d of dagen) for (const e of team.filter((x) => ['1', '1M'].includes(vol[x.id]?.[d] ?? '-')).slice(0, n)) delete c[e.id][d];
  return c;
};
const t = (c: Cellen) => toets({ team, dates, cellen: c, behoefte, wensen: [], beleid: STANDAARD_BELEID });

describe('te weinig regelplekken', () => {
  it('het voorstel zelf voldoet', () => {
    expect(t(vol).status[0]).toBe('ok');
    expect(t(vol).cijfer).toBeGreaterThan(7.5);
  });

  it('elke dag een, twee of drie plekken te weinig: status "Te weinig regelplekken" en nooit een voldoende', () => {
    for (const n of [1, 2, 3]) {
      const x = t(zonder(n));
      expect(x.status).toEqual(['bad', 'Te weinig regelplekken']);
      expect(x.cijfer).toBeLessThanOrEqual(5.4);
      expect(adviesVoorstel(x).kleur).toBe('rood');
    }
  });

  it('één of twee dagen met één plek te weinig: aandachtspunt (oranje), geen afkeuring', () => {
    const x = t(zonder(1, dates.slice(0, 2)));
    expect(x.status[0]).toBe('warn');
    expect(tekortStand(x.perDag).ernstig).toBe(false);
    expect(adviesVoorstel(x).kleur).toBe('oranje');
  });

  it('één dag met twee plekken te weinig is al ernstig, net als drie dagen met één', () => {
    expect(t(zonder(2, dates.slice(0, 1))).status[1]).toBe('Te weinig regelplekken');
    expect(t(zonder(1, dates.slice(0, 3))).status[1]).toBe('Te weinig regelplekken');
  });

  it('een overtreding van ATW of CAO gaat voor', () => {
    const c: Cellen = JSON.parse(JSON.stringify(zonder(1)));
    // zeven dagen achter elkaar werken
    for (const d of dates.slice(0, 7)) c.m0[d] = '1' as DienstCode;
    expect(t(c).status[1]).toBe('Overtreding ATW/CAO');
  });
});
