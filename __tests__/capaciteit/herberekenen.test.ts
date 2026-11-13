import { describe, expect, it } from 'vitest';
import { herberekenNorm, pasVoorstelToe } from '@/lib/capaciteit/herberekenen';
import { lamNorm, normWeek } from '@/lib/capaciteit/norm';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { makeDemoHistory } from '@/lib/model/demo';
import { addDays } from '@/lib/dates';
import type { MeldingenData } from '@/lib/model/types';

const n = NORM_STANDAARD;
// vier jaar demo-meldingen: seizoen met een top half januari (+12%) en een vaste weekdag
const demo = makeDemoHistory('2026-10-01');
const som = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('vastgestelde regelplekken opnieuw berekenen uit de eigen meldingen', () => {
  const v = herberekenNorm(n, demo)!;

  it('de periode: de laatste 52 weken met meldingen', () => {
    expect(v.tot).toBe('2026-09-30');
    expect(v.van).toBe(addDays('2026-09-30', -363));
    expect(v.zonder).toEqual([]);
  });

  it('het seizoen: gemiddeld 1, hoog in de winter en laag in de zomer, zoals de meldingen', () => {
    const s = v.seizoen!;
    expect(s).toHaveLength(52);
    expect(som(s) / 52).toBeCloseTo(1, 3);
    const jan = s[normWeek('2026-01-15') - 1], jul = s[normWeek('2026-07-15') - 1];
    expect(jan).toBeGreaterThan(1.08);
    expect(jul).toBeLessThan(0.92);
    // glad: van week tot week geen sprongen
    for (let w = 1; w < 52; w++) expect(Math.abs(s[w] - s[w - 1])).toBeLessThan(0.03);
  });

  it('de weekdag: zoals in de meldingen (vrijdag het drukst, zondag het rustigst)', () => {
    const d = v.dagIndex!;
    const verwacht = [1.02, 1.01, 1.0, 1.01, 1.05, 0.99, 0.91];
    const gem = som(verwacht) / 7;
    d.forEach((x, i) => expect(x).toBeCloseTo(verwacht[i] / gem, 1));
    expect(som(d) / 7).toBeCloseTo(1, 2);
  });

  it('per regio de correctie: over de 52 weken geeft de norm precies de meldingen', () => {
    const nieuw = pasVoorstelToe(n, v, 'herberekend');
    const dagen = Array.from({ length: 364 }, (_, i) => addDays(v.van, i));
    const begin = demo.n - 364;
    for (const r of Object.keys(n.regios)) {
      const echt = som(demo.regios[r].slice(begin) as number[]);
      const norm = som(dagen.map((d) => lamNorm(nieuw, r, d)!));
      expect(Math.abs(norm / echt - 1)).toBeLessThan(0.002);
      expect(v.regios[r].meldingen).toBeCloseTo(echt, 6);
      expect(v.regios[r].volume).toBeCloseTo((v.regios[r].volumeOud * v.regios[r].correctie) / v.regios[r].correctieOud, 6);
    }
  });

  it('overnemen verandert alleen seizoen, weekdag, correctie en de bron; de begroting blijft', () => {
    const nieuw = pasVoorstelToe(n, v, 'Vastgestelde regelplekken 2027 · herberekend');
    expect(nieuw.bron).toBe('Vastgestelde regelplekken 2027 · herberekend');
    expect(nieuw.seizoen).toEqual(v.seizoen);
    expect(nieuw.dagIndex).toEqual(v.dagIndex);
    for (const [r, x] of Object.entries(n.regios)) {
      expect(nieuw.regios[r]).toEqual({ ...x, correctie: v.regios[r].correctie });
    }
    expect({ ...nieuw, bron: n.bron, seizoen: n.seizoen, dagIndex: n.dagIndex, regios: n.regios }).toEqual(n);
  });

  it('met een jaar historie: weekdag en correctie, het seizoen blijft', () => {
    const jaar: MeldingenData = { start: addDays(demo.start, demo.n - 400), n: 400, regios: Object.fromEntries(Object.entries(demo.regios).map(([r, w]) => [r, w.slice(-400)])) };
    const x = herberekenNorm(n, jaar)!;
    expect(x.seizoen).toBeNull();
    expect(x.dagIndex).toHaveLength(7);
    expect(pasVoorstelToe(n, x, 'b').seizoen).toBe(n.seizoen);
  });

  it('een regio met te weinig meldingen houdt zijn correctie; met minder dan 52 weken geen voorstel', () => {
    const regios = { ...demo.regios, Utrecht: demo.regios.Utrecht.map((v, i) => (i >= demo.n - 100 ? null : v)) };
    const x = herberekenNorm(n, { ...demo, regios })!;
    expect(x.zonder).toEqual(['Utrecht']);
    expect(x.regios.Utrecht.correctie).toBe(n.regios.Utrecht.correctie);
    expect(herberekenNorm(n, { start: demo.start, n: 300, regios: Object.fromEntries(Object.entries(demo.regios).map(([r, w]) => [r, w.slice(0, 300)])) })).toBeNull();
    expect(herberekenNorm(n, null)).toBeNull();
  });
});
