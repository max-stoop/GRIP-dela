import { describe, it, expect } from 'vitest';
import { mag, plant, RECHTEN } from '@/lib/rechten';
import { rolUitProfiel } from '@/lib/sessie';

describe('rollen en rechten (§ 5.1)', () => {
  it('de regiomanager (en de beheerder als achtervang) keurt het rooster goed en besluit over verlof', () => {
    expect(mag('beheerder', 'rooster.goedkeuren') && mag('beheerder', 'verlof.besluiten') && mag('beheerder', 'rooster.advies')).toBe(true);
    for (const rol of ['planner', 'medewerker'] as const) {
      expect(mag(rol, 'rooster.goedkeuren')).toBe(false);
      expect(mag(rol, 'verlof.besluiten')).toBe(false);
    }
    expect(mag('regiomanager', 'rooster.goedkeuren')).toBe(true);
    expect(mag('regiomanager', 'verlof.besluiten')).toBe(true);
  });

  it('de planner maakt, toetst, adviseert, biedt aan en publiceert; de beheerder richt in', () => {
    expect(['rooster.maken', 'rooster.advies', 'rooster.publiceren', 'verlof.invoeren', 'ruil.besluiten', 'bijsturen'].every((r) => mag('planner', r as never))).toBe(true);
    // de planner geeft het advies (groen, oranje, rood) en biedt aan; de regiomanager niet
    expect([mag('regiomanager', 'rooster.advies'), mag('medewerker', 'rooster.advies')]).toEqual([false, false]);
    // verlofrecht en saldo staan niet in GRIP
    expect(Object.values(RECHTEN).flat()).not.toContain('verlofrecht');
    expect(mag('beheerder', 'beheer')).toBe(true);
    expect(mag('regiomanager', 'beheer')).toBe(false);
    expect(RECHTEN.medewerker).toEqual([]);
    expect([plant('planner'), plant('regiomanager'), plant('beheerder'), plant('medewerker')]).toEqual([true, true, true, false]);
  });

  it('zo ingesteld besluit ook de planner over verlof; andere rechten veranderen niet', () => {
    const aan = { plannerBesluitVerlof: true }, uit = { plannerBesluitVerlof: false };
    expect([mag('planner', 'verlof.besluiten', uit), mag('planner', 'verlof.besluiten', aan)]).toEqual([false, true]);
    expect(mag('medewerker', 'verlof.besluiten', aan)).toBe(false);
    expect(mag('planner', 'rooster.goedkeuren', aan)).toBe(false);
    expect([mag('regiomanager', 'verlof.besluiten', uit), mag('beheerder', 'verlof.besluiten', uit)]).toEqual([true, true]);
  });

  it('rollen uit de bestaande tabel users', () => {
    expect(rolUitProfiel('Planner')).toBe('beheerder');
    expect(rolUitProfiel('Regio Manager')).toBe('regiomanager');
    expect(rolUitProfiel('Clustermanager')).toBe('regiomanager');
    expect(rolUitProfiel('Regio Planner')).toBe('planner');
    expect(rolUitProfiel('NBD Manager')).toBe('planner');
    expect(rolUitProfiel('Uitvaartverzorger/Leider')).toBe('medewerker');
    expect(rolUitProfiel(null)).toBe('medewerker');
  });
});
