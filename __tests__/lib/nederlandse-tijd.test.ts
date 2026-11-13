import { describe, it, expect } from 'vitest';
import { nowStamp, todayIso, uitNederlandseTijd, uurNu } from '@/lib/dates';
import { naarTijdstip, uitTijdstip } from '@/lib/store/db/tijd';

describe('vandaag en nu in Nederlandse tijd', () => {
  it('server (UTC) en browser zien dezelfde dag, ook rond middernacht', () => {
    // 22:30 UTC in oktober is 00:30 in Nederland (zomertijd): al de volgende dag
    expect(todayIso(new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-10');
    expect(nowStamp(new Date('2026-10-09T22:30:05Z'))).toBe('2026-10-10T00:30:05');
    expect(uurNu(new Date('2026-10-09T22:30:00Z'))).toBe(0);
    // in de winter een uur verschil
    expect(nowStamp(new Date('2026-12-31T23:15:00Z'))).toBe('2027-01-01T00:15:00');
    expect(todayIso(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31');
  });

  it('een Nederlandse stempel wordt het juiste tijdstip, ook bij de omschakeling naar zomer- en wintertijd', () => {
    expect(uitNederlandseTijd('2026-10-10T00:30:05').toISOString()).toBe('2026-10-09T22:30:05.000Z');
    expect(uitNederlandseTijd('2027-01-01T00:15:00').toISOString()).toBe('2026-12-31T23:15:00.000Z');
    expect(uitNederlandseTijd('2026-10-25T12:00:00').toISOString()).toBe('2026-10-25T11:00:00.000Z');
    expect(uitNederlandseTijd('2026-03-29T12:00:00').toISOString()).toBe('2026-03-29T10:00:00.000Z');
    expect(uitNederlandseTijd('2026-07-01').toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(Number.isNaN(uitNederlandseTijd('geen datum').getTime())).toBe(true);
    for (const s of ['2026-10-10T00:30:05', '2026-03-28T23:59:59', '2026-10-25T03:00:00', '2026-06-15T13:45:00']) expect(uitTijdstip(naarTijdstip(s))).toBe(s);
    // met tijdzone erbij: zoals het er staat
    expect(naarTijdstip('2026-10-09T22:30:05Z')).toBe('2026-10-09T22:30:05.000Z');
    expect(naarTijdstip('2026-10-10T00:30:05+02:00')).toBe('2026-10-09T22:30:05.000Z');
  });
});
