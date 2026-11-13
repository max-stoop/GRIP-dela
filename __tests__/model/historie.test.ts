/** Korte of ongelijke historie: een regio zonder een jaar meldingen krijgt geen seizoenmodel en breekt de rest niet. */
import { describe, it, expect } from 'vitest';
import { BaseModel, History, runForecast, calibrate } from '@/lib/model/forecast';
import { makeDemoHistory } from '@/lib/model/demo';
import { MIN_HISTORIE_DAGEN } from '@/lib/model/config';
import { toDay } from '@/lib/dates';
import type { MeldingenData } from '@/lib/model/types';

const VANDAAG = '2026-11-09';
const vol = makeDemoHistory(VANDAAG);
const knip = (m: MeldingenData, van: string): MeldingenData => {
  const i = toDay(van) - toDay(m.start);
  return { start: van, n: m.n - i, regios: Object.fromEntries(Object.entries(m.regios).map(([r, w]) => [r, w.slice(i)])) };
};
const run = (m: MeldingenData) => runForecast({ meldingen: m, extern: {}, handmatig: [], coef: {}, normaal: null }, { issue: VANDAAG, soort: 'test' });

describe('korte of ongelijke historie', () => {
  it('één regio met 60 dagen historie: die regio valt af met een notitie, de rest wordt gewoon voorspeld', () => {
    const begin = vol.n - 60;
    const m = { ...vol, regios: { ...vol.regios, Tilburg: vol.regios.Tilburg.map((v, i) => (i < begin ? null : v)) } };
    const r = run(m);
    expect(r.data.regios).not.toContain('Tilburg');
    expect(r.data.regios).toHaveLength(24);
    expect(r.meta.info.notes.join(' ')).toMatch(/Tilburg: 60 dagen historie/);
  });

  it('een regio met alleen nullen breekt de voorspelling niet', () => {
    const m = { ...vol, regios: { ...vol.regios, Tilburg: vol.regios.Tilburg.map(() => 0) } };
    const r = run(m);
    expect(r.data.regios).not.toContain('Tilburg');
    expect(r.data.regios).toHaveLength(24);
  });

  it('een halfjaar historie (zonder feestdag) geeft geen uitschieters maar een duidelijke melding', () => {
    expect(() => run(knip(vol, '2026-06-01'))).toThrow(/jaar meldingenhistorie/);
    expect(() => run(knip(vol, '2026-05-01'))).toThrow(/jaar meldingenhistorie/);
  });

  it('vanaf een jaar historie: een gewone voorspelling, dicht bij die met de hele historie', () => {
    const jaar = knip(vol, '2025-11-01');
    expect(new BaseModel(new History(jaar), toDay(VANDAAG)).regions).toHaveLength(25);
    const som = (m: MeldingenData) => run(m).data.lam.reduce((a, rij) => a + rij.reduce((x, y) => x + y, 0), 0);
    expect(Math.abs(som(jaar) / som(vol) - 1)).toBeLessThan(0.06);
    expect(MIN_HISTORIE_DAGEN).toBe(365);
  });

  it('een regio zonder model telt niet mee in de landelijke drukte van de andere regio\'s', () => {
    // Tilburg heeft een halfjaar historie, met drie keer zoveel meldingen: dat mag de rest niet drukker maken
    const begin = vol.n - 180;
    const m = { ...vol, regios: { ...vol.regios, Tilburg: vol.regios.Tilburg.map((v, i) => (i < begin ? null : (v ?? 0) * 3)) } };
    const zonder = { ...vol, regios: Object.fromEntries(Object.entries(vol.regios).filter(([r]) => r !== 'Tilburg')) };
    const a = run(m), b = run(zonder);
    expect(a.meta.info.mom7).toBeCloseTo(b.meta.info.mom7, 10);
    expect(a.meta.info.level28).toBeCloseTo(b.meta.info.level28, 10);
  });

  it('kalibreren vraagt een jaar historie vóór het testjaar', () => {
    expect(() => calibrate({ meldingen: knip(vol, '2025-01-01'), extern: {}, handmatig: [], coef: {}, normaal: null })).toThrow(/Te weinig historie/);
  });
});
