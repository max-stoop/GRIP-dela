import { describe, it, expect } from 'vitest';
import { factorUitleg, somUitleg } from '@/lib/model/uitleg';
import { DECAY, PRIORS } from '@/lib/model/config';

const info = { mom7: Math.log(1.087), level28: Math.log(1.033), cbs: 0, covid: 1, flu: 1.4, data_end: '2026-10-09', coef: {} };

describe('hoe een factor tot zijn percentage komt', () => {
  it('drukte afgelopen week: 8,7% drukker, gewicht 0,40, op 4 dagen nog 83%: samen +2,8%', () => {
    const h = 4;
    const bijdrage = PRIORS.mom7.prior * info.mom7 * Math.exp(-h / DECAY.mom7);
    const u = factorUitleg('mom7', { bijdrage, h, info, eenRegio: false });
    expect(u.signaal).toBe('De afgelopen 7 dagen t/m 9 okt kwamen er landelijk 8,7% meer meldingen dan het basismodel verwachtte.');
    expect(u.berekening).toBe('Daarvan telt 0,40 mee (de startwaarde); op 4 dagen vooruit is daar nog 83% van over. Samen: +2,8%.');
  });

  it('niveau over vier weken, en een geschat gewicht', () => {
    const h = 4, beta = 0.62;
    const bijdrage = beta * info.level28 * Math.exp(-h / DECAY.level28);
    const u = factorUitleg('level28', { bijdrage, h, info: { ...info, coef: { level28: beta } }, eenRegio: true });
    expect(u.signaal).toContain('De afgelopen 28 dagen t/m 9 okt kwamen er landelijk 3,3% meer meldingen');
    expect(u.berekening).toContain('Daarvan telt 0,62 mee (geschat op de eigen meldingen); op 4 dagen vooruit is daar nog 91% van over.');
  });

  it('fijnstof onder het gewone niveau geeft een klein min', () => {
    const bijdrage = PRIORS.pm25.prior * (7.6 - 9) / 10;
    const u = factorUitleg('pm25', { bijdrage, h: 4, info, eenRegio: true });
    expect(u.signaal).toBe('Fijnstof rond deze dag (gemiddeld over drie dagen): 7,6 µg/m³, 1,4 onder het gewone niveau van 9.');
    expect(u.berekening).toBe('Per 10 µg/m³ 0,7% minder meldingen (de startwaarde). Samen: −0,1%.');
  });

  it('hitte en kou in graden, griep en rioolwater in hun eigen maat', () => {
    expect(factorUitleg('heat', { bijdrage: 0.02 * 3, h: 2, info, eenRegio: true }).signaal).toContain('gemiddeld 28,0 °C (over drie dagen): 3,0 graden boven 25 °C');
    expect(factorUitleg('heat', { bijdrage: 0.02 * 3, h: 2, info, eenRegio: true }).berekening).toBe('Per graad boven 25 °C 2,0% meer meldingen (de startwaarde). Samen: +6,2%.');
    expect(factorUitleg('cold', { bijdrage: 0.01 * 8, h: 2, info, eenRegio: true }).signaal).toContain('is -3,0 °C: 8,0 graden onder 5 °C');
    expect(factorUitleg('flu_ili', { bijdrage: 0.03 * 1.4, h: 0, info, eenRegio: false }).signaal).toContain('120 mensen met griepachtige klachten');
    expect(factorUitleg('covid_ww', { bijdrage: 0.015, h: 0, info, eenRegio: false }).signaal).toContain('2,0 keer zoveel coronavirus');
    const winter = factorUitleg('seas_tw', { bijdrage: -0.008 * 1.5, h: 30, info, eenRegio: false });
    expect(winter.signaal).toContain('1,5 graden warmer dan normaal');
    expect(winter.berekening).toContain('per graad warmer 0,8% minder');
  });

  it('samen: het basismodel keer elke factor', () => {
    expect(somUitleg(114.8, 119.6, [0.028, 0.015, -0.001])).toBe('114,8 (basismodel) × 1,028 × 1,015 × 0,999 ≈ 119,6');
  });
});
