import { describe, it, expect } from 'vitest';
import { feestdagStand } from '@/lib/rooster/feestdagen';
import type { Verlof } from '@/lib/store/types';

describe('feestdagen per medewerker', () => {
  it('gewerkt, verlof (in het rooster of goedgekeurd), vrij of nog geen rooster', () => {
    const cellen = { a: { '2026-12-25': '1' as const, '2026-12-26': '-' as const }, b: { '2026-12-25': 'V' as const } };
    const verlof = [{ id: 'v', medewerkerId: 'c', regio: 'Utrecht', van: '2026-12-24', tot: '2026-12-27', status: 'goedgekeurd' }] as Verlof[];
    expect(feestdagStand({ id: 'a' }, cellen, verlof, '2026-12-25')).toEqual({ soort: 'gewerkt', code: '1' });
    expect(feestdagStand({ id: 'a' }, cellen, verlof, '2026-12-26').soort).toBe('vrij');
    expect(feestdagStand({ id: 'b' }, cellen, verlof, '2026-12-25').soort).toBe('verlof');
    expect(feestdagStand({ id: 'c' }, cellen, verlof, '2026-12-25').soort).toBe('verlof');
    expect(feestdagStand({ id: 'd' }, cellen, verlof, '2026-12-25').soort).toBe('leeg');
  });
});
