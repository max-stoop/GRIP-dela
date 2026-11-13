import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/regelplekken2027.json';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { borgingWeek, capaciteitWeek, lamNormWeek, normWeek, plekkenNormWeek, regioJaar, WEKEN } from '@/lib/capaciteit/norm';

type Regio = { plekken: number[][]; meldingen: number[][]; borging: number[]; speling: number[]; ruimte: number[]; gemiddeld: { plekkenPerWeek: number; borging: number; ruimte: number } };
const F = fixture as { regios: Record<string, Regio> };
// de Excel rekende de 1B als 37,5% van een dienst (3 uur); de app gebruikt nu 2 uur, de rekenwijze blijft gelijk
const n = { ...NORM_STANDAARD, beschikbaarKans: 0.375 };

describe('vastgestelde regelplekken: zelfde getallen als de Excel', () => {
  it('heeft alle 25 regio\'s', () => {
    expect(Object.keys(F.regios).sort()).toEqual(Object.keys(n.regios).sort());
  });

  for (const [regio, x] of Object.entries(F.regios)) {
    it(`${regio}: meldingen, plekken, borging, speling en ruimte per week`, () => {
      for (let w = 1; w <= WEKEN; w++) {
        for (let d = 0; d < 7; d++) {
          expect(lamNormWeek(n, regio, w, d)).toBeCloseTo(x.meldingen[w - 1][d], 5);
          expect(plekkenNormWeek(n, regio, w, d)).toBe(x.plekken[w - 1][d]);
        }
        const b = borgingWeek(n, regio, w)!;
        expect(b.urenSpeling).toBeCloseTo(x.speling[w - 1], 4);
        expect(b.totaal).toBeCloseTo(x.borging[w - 1], 4);
        expect(capaciteitWeek(n, regio, w)!.ruimte).toBeCloseTo(x.ruimte[w - 1], 4);
      }
      const j = regioJaar(n, regio)!;
      expect(j.plekkenPerWeek).toBeCloseTo(x.gemiddeld.plekkenPerWeek, 6);
      expect(j.borging).toBeCloseTo(x.gemiddeld.borging, 6);
      expect(j.ruimte).toBeCloseTo(x.gemiddeld.ruimte, 6);
    });
  }

  it('rekent de beschikbaarheidsdienst als 2 uur en voorgangen als 4 uur', () => {
    expect(NORM_STANDAARD.beschikbaarKans * NORM_STANDAARD.dienstUren).toBe(2);
    const b = borgingWeek(NORM_STANDAARD, 'Utrecht', 10)!;
    expect(b.urenBeschikbaar).toBe(7 * 2);
    expect(b.urenVoorgangen).toBe(4 * 6 * 4);
    expect(b.urenRegulier).toBe(b.regulier * 8);
  });

  it('normweek: ISO-week, week 53 telt als 52', () => {
    expect(normWeek('2027-01-04')).toBe(1);
    expect(normWeek('2026-12-31')).toBe(52);
  });
});
