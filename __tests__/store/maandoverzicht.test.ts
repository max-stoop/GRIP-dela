import { describe, it, expect } from 'vitest';
import { getState, vulAan } from '@/lib/store/store';
import { komendeMaanden, maandRegels } from '@/lib/store/overzicht';
import { vaststellingVan } from '@/lib/rooster/vaststelling';
import { maandDagen } from '@/lib/rooster/maand';
import type { AppState, Goedkeuring } from '@/lib/store/types';
import type { DienstCode, Medewerker } from '@/lib/rooster/types';

const vandaag = '2026-10-10';
const team: Medewerker[] = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, regio: 'Utrecht', naam: `Mw ${i}`, contract: 32, voorkeur: 'O', weekendgroep: i % 2, actief: true }));
const goed = (maand: string, extra: Partial<Goedkeuring> = {}): Goedkeuring => ({
  regio: 'Utrecht', maand, status: 'goedgekeurd', versie: 'v', cijfer: 7.4, hard: 0, aangevraagd: '2026-09-01T10:00:00', door: 'Plan',
  advies: { kleur: 'oranje', door: 'Plan', op: '2026-09-01T10:00:00' }, geschiedenis: [], ...extra,
});

describe('roosters per maand', () => {
  it('per maand het cijfer, de vaststelling met het advies, en of de maand online staat', () => {
    const [okt, nov, dec, jan] = komendeMaanden(vandaag);
    expect([okt, nov, dec, jan]).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    // oktober en november ingeroosterd, december en januari nog leeg
    const rij: Record<string, DienstCode> = {};
    for (const d of [...maandDagen(okt), ...maandDagen(nov)]) if (new Date(d).getUTCDay() % 6) rij[d] = '1';
    const state: AppState = {
      ...vulAan({ ...getState(), geladen: true }),
      medewerkers: team,
      rooster: { Utrecht: Object.fromEntries(team.map((m) => [m.id, rij])) },
      goedkeuringen: { Utrecht: { [okt]: goed(okt), [nov]: goed(nov, { status: 'afgekeurd', reden: 'te krap' }), [dec]: goed(dec, { status: 'ter_goedkeuring', advies: { kleur: 'rood', door: 'Plan', op: '2026-10-01T10:00:00' } }) } },
      publicaties: { Utrecht: { regio: 'Utrecht', van: '2026-10-01', tot: '2026-11-15', op: '2026-09-30T10:00:00', door: 'Plan', cellen: {} } },
    };
    const r = maandRegels(state, 'Utrecht', { norm: state.normen }, [okt, nov, dec, jan], vandaag);
    expect(r.map((x) => x.vaststelling)).toEqual(['goed', 'afgekeurd', 'wacht', 'geen']);
    expect(r.map((x) => x.advies)).toEqual(['oranje', null, 'rood', null]);
    expect(r.map((x) => x.publicatie)).toEqual(['ja', 'deels', 'nee', 'nee']);
    expect(r[0].toets?.cijfer).toBeGreaterThan(0);
    expect(r[1].toets).not.toBeNull();
    // zonder diensten geen cijfer
    expect(r[2].toets).toBeNull();
    expect(r[3].toets).toBeNull();
    expect(r[0].cijferBijAdvies).toBe(7.4);
  });

  it('vastgesteld is goedgekeurd mét advies; zonder advies is er eerst een advies nodig', () => {
    expect(vaststellingVan(undefined)).toBe('geen');
    expect(vaststellingVan(goed('2026-10'))).toBe('goed');
    expect(vaststellingVan(goed('2026-10', { advies: undefined }))).toBe('geen');
    expect(vaststellingVan(goed('2026-10', { status: 'ter_goedkeuring' }))).toBe('wacht');
    expect(vaststellingVan(goed('2026-10', { status: 'afgekeurd' }))).toBe('afgekeurd');
  });
});
