import { describe, it, expect } from 'vitest';
import { isoWeek, toDay, weekIndex } from '@/lib/dates';
import { eersteWeekend, groepOpties, groepVoorPariteit, heeftWeek53, isoJaar, pariteitIn, weekendNaam } from '@/lib/rooster/weekend';
import { werktWeekend } from '@/lib/rooster/types';

describe('weekendgroepen in even en oneven weken', () => {
  it('de groep voor even weken werkt in dat jaar precies de weekenden met een even weeknummer', () => {
    for (const jaar of [2026, 2027, 2028]) {
      const g = groepVoorPariteit('even', jaar);
      const m = { weekendCadans: 2, weekendgroep: g };
      expect(pariteitIn(m, jaar)).toBe('even');
      // alle zaterdagen van het ISO-jaar
      for (let n = toDay(`${jaar}-01-03`); n < toDay(`${jaar}-12-27`); n++) {
        if (new Date(n * 864e5).getUTCDay() !== 6 || isoJaar(new Date(n * 864e5).toISOString().slice(0, 10)) !== jaar) continue;
        expect(werktWeekend(m, weekIndex(n))).toBe(isoWeek(n) % 2 === 0);
      }
    }
  });

  it('na week 53 wisselen even en oneven, zodat het om het weekend blijft', () => {
    expect(heeftWeek53(2026)).toBe(true);
    expect(heeftWeek53(2027)).toBe(false);
    const m = { weekendCadans: 2, weekendgroep: groepVoorPariteit('even', 2026) };
    expect(pariteitIn(m, 2027)).toBe('oneven');
    // za 26 dec 2026 (week 52), za 2 jan 2027 (week 53), za 9 jan 2027 (week 1): werkt, vrij, werkt
    expect([werktWeekend(m, weekIndex(toDay('2026-12-26'))), werktWeekend(m, weekIndex(toDay('2027-01-02'))), werktWeekend(m, weekIndex(toDay('2027-01-09')))]).toEqual([true, false, true]);
    expect(weekendNaam(m, '2026-11-01')).toBe('even weekenden');
    expect(weekendNaam(m, '2027-03-01')).toBe('oneven weekenden');
  });

  it('keuzelijst en eerstvolgend weekend', () => {
    const o = groepOpties(2, '2026-10-31');
    expect(o.map((x) => x.naam.split(' · ')[0])).toEqual(expect.arrayContaining(['Even weken (in 2027 oneven)', 'Oneven weken (in 2027 even)']));
    expect(groepOpties(3, '2026-10-31').map((x) => x.naam.slice(0, 7))).toEqual(['Groep A', 'Groep B', 'Groep C']);
    const za = eersteWeekend({ weekendCadans: 3, weekendgroep: 1 }, '2026-10-31');
    expect(new Date(`${za}T00:00:00Z`).getUTCDay()).toBe(6);
    expect(werktWeekend({ weekendCadans: 3, weekendgroep: 1 }, weekIndex(toDay(za)))).toBe(true);
    expect(weekendNaam({ weekendCadans: 3, weekendgroep: 1 }, '2026-10-31')).toBe('1 op 3 weekenden (B)');
  });
});
