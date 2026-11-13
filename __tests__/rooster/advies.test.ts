import { describe, it, expect } from 'vitest';
import { adviesFout, adviesVoorstel } from '@/lib/rooster/advies';
import type { Check, DagStand } from '@/lib/rooster/toets';

const dag = (datum: string, p: number, k: number | null) => ({ datum, p, k }) as DagStand;
const check = (id: string, niveau: Check['niveau'], items: string[]): Check => ({ id: id as Check['id'], naam: id === 'twee' ? 'Max 2× een 2 als er 2× een 1 overblijft' : 'Regel', niveau, paragraaf: '3', items });
const basis = { hard: 0, cijfer: 8.6, checks: [] as Check[], perDag: [dag('2026-10-10', 5, 5), dag('2026-10-11', 6, 5)] };

describe('voorstel voor het advies van de planner', () => {
  it('groen als alles klopt', () => {
    expect(adviesVoorstel(basis).kleur).toBe('groen');
  });

  it('oranje bij een dag tekort, een punt uit het beleid of een matig cijfer', () => {
    expect(adviesVoorstel({ ...basis, perDag: [dag('2026-10-10', 4, 5)] }).kleur).toBe('oranje');
    const v = adviesVoorstel({ ...basis, checks: [check('twee', 'Roosterbeleid', ['2026-10-10'])] });
    expect(v.kleur).toBe('oranje');
    expect(v.redenen[0]).toContain('max 2× een 2');
    expect(adviesVoorstel({ ...basis, cijfer: 7.2 }).kleur).toBe('oranje');
  });

  it('rood bij ATW of CAO, een groot tekort, drie dagen tekort of een laag cijfer', () => {
    expect(adviesVoorstel({ ...basis, hard: 2 }).kleur).toBe('rood');
    expect(adviesVoorstel({ ...basis, perDag: [dag('2026-10-10', 3, 5)] }).kleur).toBe('rood');
    expect(adviesVoorstel({ ...basis, perDag: ['10', '11', '12'].map((d) => dag(`2026-10-${d}`, 4, 5)) }).kleur).toBe('rood');
    expect(adviesVoorstel({ ...basis, cijfer: 5.8 }).kleur).toBe('rood');
  });

  it('dagen voor de startdatum tellen niet mee', () => {
    expect(adviesVoorstel({ ...basis, perDag: [dag('2026-10-01', 2, 5), dag('2026-10-10', 5, 5)] }, '2026-10-06').kleur).toBe('groen');
  });

  it('oranje en rood vragen een toelichting', () => {
    expect(adviesFout(null, '')).toMatch(/Geef een advies/);
    expect(adviesFout('groen', '')).toBeNull();
    expect(adviesFout('oranje', 'kort')).toMatch(/toe/);
    expect(adviesFout('rood', 'Drie dagen niet te dekken')).toBeNull();
  });
});
