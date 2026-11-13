import { describe, it, expect } from 'vitest';
import { getState, LOGBOEK, vulAan, snoeiLog } from '@/lib/store/store';
import type { AppState } from '@/lib/store/types';

describe('een lege of gedeeltelijke staat aanvullen', () => {
  it('ontbrekende onderdelen krijgen hun standaardwaarde; wat er is, blijft', () => {
    const s = vulAan({ medewerkers: [{ id: 'm1', regio: 'Utrecht', naam: 'A', contract: 32, voorkeur: 'O', weekendgroep: 0, functie: 'UV' }], beleid: { publicatieMaanden: 3 } } as unknown as AppState);
    expect(s.medewerkers).toHaveLength(1);
    expect(s.beleid.publicatieMaanden).toBe(3);
    expect(s.beleid.weging).toEqual(getState().beleid.weging);
    expect(s.goedkeuringen).toEqual({});
    expect(s.schoolvakanties.length).toBeGreaterThan(0);
    expect(s.dagtaak).toBeNull();
  });
});

describe('logboek', () => {
  it('bewaart ruim een jaar, met een bovengrens', () => {
    const regel = (moment: string, i = 0) => ({ id: `${moment}-${i}`, moment, soort: 'rooster' as const, tekst: 't' });
    const log = [regel('2026-10-06T10:00:00'), regel('2025-09-01T10:00:00'), regel('2025-08-01T10:00:00')];
    expect(snoeiLog(log, '2026-10-06').map((x) => x.moment)).toEqual(['2026-10-06T10:00:00', '2025-09-01T10:00:00']);
    const veel = Array.from({ length: LOGBOEK.max + 50 }, (_, i) => regel('2026-10-06T10:00:00', i));
    expect(snoeiLog(veel, '2026-10-06')).toHaveLength(LOGBOEK.max);
  });
});
