import { describe, expect, it } from 'vitest';
import { bronGebreken, gebrekTekst, isActueel, laatsteDatum } from '@/lib/bronnen/actualiteit';
import { addDays } from '@/lib/dates';
import type { ExternData } from '@/lib/model/types';

const vandaag = '2026-10-17';
const reeks = (van: number, tot: number) => Object.fromEntries(Array.from({ length: tot - van + 1 }, (_, i) => [addDays(vandaag, van + i), 1]));
const extern = (bereik: Record<string, [number, number]>): ExternData =>
  Object.fromEntries(Object.entries(bereik).map(([b, [van, tot]]) => [b, { proef: { NL: reeks(van, tot) } }]));
const actueel = extern({ weer: [-14, 15], lucht: [-14, 4], seizoen: [0, 89], riool: [-60, -10], cbs: [-90, -17] });
const allesOk = { weer: true, lucht: true, seizoen: true, riool: true, cbs: true };

describe('zijn de bronnen actueel?', () => {
  it('de laatste dag met gegevens, over alle reeksen', () => {
    expect(laatsteDatum({ a: { NL: { '2026-10-01': 1 } }, b: { X: { '2026-10-09': 2, '2026-10-03': 1 } } })).toBe('2026-10-09');
    expect(laatsteDatum(undefined)).toBeNull();
  });

  it('verwachtingen moeten vooruit kijken, metingen mogen wat achterlopen', () => {
    expect(isActueel('weer', addDays(vandaag, 3), vandaag)).toBe(true);
    expect(isActueel('weer', addDays(vandaag, 2), vandaag)).toBe(false);
    expect(isActueel('riool', addDays(vandaag, -21), vandaag)).toBe(true);
    expect(isActueel('riool', addDays(vandaag, -22), vandaag)).toBe(false);
    expect(isActueel('weer_archief', vandaag, vandaag)).toBeNull();
  });

  it('alles opgehaald en actueel: geen gebreken', () => {
    expect(bronGebreken({ extern: actueel, opgehaald: allesOk, vandaag, normaal: true })).toEqual([]);
  });

  it('niet opgehaald, verouderd en ontbrekend, elk met een eigen reden', () => {
    const e = { ...actueel, cbs: { proef: { NL: reeks(-120, -50) } } };
    delete (e as Partial<ExternData>).lucht;
    const g = bronGebreken({ extern: e, opgehaald: { ...allesOk, riool: false }, vandaag, normaal: false });
    expect(g.map((x) => `${x.bron}:${x.reden}`)).toEqual(['lucht:geen gegevens', 'riool:niet opgehaald', 'cbs:verouderd', 'normalen:geen gegevens']);
    expect(gebrekTekst(g[1], (d) => d)).toBe(`Rioolwater: vandaag niet opgehaald (gegevens tot ${addDays(vandaag, -10)})`);
    expect(gebrekTekst(g[2], (d) => d)).toBe(`CBS-sterfte: verouderd (gegevens tot ${addDays(vandaag, -50)})`);
    expect(gebrekTekst(g[0], (d) => d)).toBe('Luchtkwaliteit: ontbreekt');
  });
});
