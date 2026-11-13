import { describe, it, expect } from 'vitest';
import { teamOverzicht } from '@/lib/rooster/team';
import { openTijden, tijdBevindingen, leesUur, uurTekst } from '@/lib/rooster/tijden';
import { toets, celOvertredingen } from '@/lib/rooster/toets';
import { voorstel } from '@/lib/rooster/voorstel';
import { bijsturen } from '@/lib/rooster/bijsturen';
import { pasToe } from '@/lib/rooster/ruil';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { STANDAARD_BELEID, type Cellen, type DienstCode, type Medewerker } from '@/lib/rooster/types';
import { addDays, isoRange, toDay, weekday } from '@/lib/dates';

const B = STANDAARD_BELEID;
let n = 0;
const mw = (extra: Partial<Medewerker> = {}): Medewerker => ({ id: `t${++n}`, regio: 'Utrecht', naam: `T${n}`, contract: 32, voorkeur: 'O', weekendgroep: 0, actief: true, ...extra });

describe('teamoverzicht', () => {
  const vandaag = '2026-10-06';
  it('telt weekenden per kalenderjaar, 1B per 28 dagen en feestdagen', () => {
    const a = mw(), b = mw({ afstandsverklaring: true }), x = mw({ extern: true });
    const zaterdagen = isoRange('2026-01-01', '2026-12-31').filter((d) => weekday(toDay(d)) === 6);
    const cellen: Cellen = {
      // zaterdag en zondag: een weekend met zondag en maandag vrij telt volgens de CAO (13 keer) nog als vrij
      [a.id]: { ...Object.fromEntries(zaterdagen.slice(0, 25).flatMap((d) => [[d, '1' as DienstCode], [addDays(d, 1), '1' as DienstCode]])), '2026-12-25': 'DG2', '2026-10-07': '1B', '2026-10-09': '1B' },
      [b.id]: Object.fromEntries(zaterdagen.slice(0, 30).map((d) => [d, '1' as DienstCode])),
      [x.id]: { '2026-10-08': '1' },
    };
    const o = teamOverzicht({ team: [a, b, x], cellen, verlof: [], profielen: {}, beleid: B, vandaag });
    const ra = o.rijen.find((r) => r.m.id === a.id)!, rb = o.rijen.find((r) => r.m.id === b.id)!;
    expect(ra.weekenden).toEqual({ aantal: 25, max: 26 });
    expect(ra.signalen.some((s) => s.ernst === 'warn' && s.tekst.includes('weekenden'))).toBe(true);
    // alleen zaterdagen, met zondag en maandag vrij: 13 daarvan tellen als vrij weekend, dus geen signaal
    const c = mw();
    const alleenZa = teamOverzicht({ team: [c], cellen: { [c.id]: Object.fromEntries(zaterdagen.slice(0, 25).map((d) => [d, '1' as DienstCode])) }, verlof: [], profielen: {}, beleid: B, vandaag });
    expect(alleenZa.rijen[0].signalen.some((s) => s.tekst.includes('weekenden'))).toBe(false);
    // eerste kerstdag, en de zondagen met Pasen en Pinksteren
    expect(ra.feestdagen).toBe(3);
    expect(ra.b28).toBe(2);
    // met een afstandsverklaring geldt het maximum niet
    expect(rb.weekenden.max).toBeNull();
    expect(rb.signalen.some((s) => s.tekst.includes('weekenden'))).toBe(false);
    // externen tellen niet mee in de contracturen en de spreiding
    expect(o.contract).toBe(64);
    expect(o.extern).toBe(1);
    expect(o.spreiding.weekenden).toEqual([25, 30]);
  });

  it('uren tegenover contract in de komende vier weken', () => {
    const a = mw({ contract: 24 });
    const cellen: Cellen = { [a.id]: Object.fromEntries(isoRange(vandaag, addDays(vandaag, 27)).filter((d) => weekday(toDay(d)) % 6 !== 0).slice(0, 14).map((d) => [d, '1' as DienstCode])) };
    const o = teamOverzicht({ team: [a], cellen, verlof: [], profielen: {}, beleid: B, vandaag });
    const r = o.rijen[0];
    expect(r.uren4).toEqual({ gepland: 112, norm: 96 });
    expect(r.signalen.some((s) => s.tekst === '16 uur boven contract (4 weken)')).toBe(true);
  });
});

describe('diensttijden', () => {
  const vandaag = '2026-10-06';
  const a = mw(), b = mw();
  const cellen: Cellen = { [a.id]: { '2026-10-07': 'DG2', '2026-10-12': 'DG1', '2026-10-08': '1' }, [b.id]: { '2026-10-09': 'DG2' } };

  it('Dg-diensten zonder vaste tijden: te laat binnen 4 dagen, anders met de uiterste datum', () => {
    const o = openTijden([a, b], cellen, { [b.id]: { '2026-10-09': { start: 9, eind: 17, code: 'DG2' } } }, vandaag, B);
    expect(o.map((x) => [x.datum, x.teLaat, x.uiterlijk])).toEqual([['2026-10-07', true, '2026-10-03'], ['2026-10-12', false, '2026-10-08']]);
  });

  it('een vastgelegde tijd voor een andere dienst telt niet', () => {
    const o = openTijden([b], cellen, { [b.id]: { '2026-10-09': { start: 9, eind: 13, code: 'DG1' } } }, vandaag, B);
    expect(o.map((x) => x.datum)).toEqual(['2026-10-09']);
  });

  it('kaders: niet langer dan 12 uur en genoeg rust rond de dag', () => {
    expect(tijdBevindingen(cellen, undefined, a.id, '2026-10-07', { start: 8, eind: 21 }, B).some((x) => x.includes('12 uur'))).toBe(true);
    // de dag erna begint een 1 om 9:00: eindigen om 22:00 laat 11 uur rust
    expect(tijdBevindingen(cellen, undefined, a.id, '2026-10-07', { start: 13, eind: 22 }, B).some((x) => x.includes('rust'))).toBe(true);
    expect(tijdBevindingen(cellen, undefined, a.id, '2026-10-07', { start: 9, eind: 17 }, B)).toEqual([]);
  });

  it('uren als tekst en terug', () => {
    expect(uurTekst(9.5)).toBe('9:30');
    expect(leesUur('13:15')).toBe(13.25);
    expect(leesUur('8')).toBe(8);
    expect(leesUur('25:00')).toBeNull();
    expect(leesUur('abc')).toBeNull();
  });

  it('de toets gebruikt vastgelegde tijden voor rust en dagduur', () => {
    const c: Cellen = { [a.id]: { '2026-10-07': 'DG2', '2026-10-08': '1' } };
    const tijden = { [a.id]: { '2026-10-07': { start: 9, eind: 22, code: 'DG2' as DienstCode } } };
    const o = celOvertredingen([a], c, ['2026-10-07', '2026-10-08'], B, tijden);
    expect(o.map((x) => x.regel).sort()).toEqual(['dagduur', 'rust']);
    expect(celOvertredingen([a], c, ['2026-10-07', '2026-10-08'], B)).toEqual([]);
  });
});

describe('schoolvakanties en externen in de toets', () => {
  it('overige diensten in de schoolvakantie zijn een aandachtspunt (§ 4.2)', () => {
    const a = mw();
    const c: Cellen = { [a.id]: { '2026-10-19': 'TD', '2026-10-27': 'O' } };
    const t = toets({ team: [a], dates: isoRange('2026-10-19', '2026-10-27'), cellen: c, behoefte: {}, wensen: [], beleid: B, schoolvakantie: (d) => d <= '2026-10-25' });
    expect(t.checks.find((x) => x.id === 'overigvakantie')!.items).toEqual([`${a.naam}, 2026-10-19`]);
    expect(t.hard).toBe(0);
  });

  it('een extern telt mee in de plekken maar niet in de medewerkertevredenheid', () => {
    const a = mw(), x = mw({ extern: true });
    const c: Cellen = { [a.id]: { '2026-10-07': '1' }, [x.id]: { '2026-10-07': '1' } };
    const t = toets({ team: [a, x], dates: ['2026-10-07'], cellen: c, behoefte: { '2026-10-07': { k: 2, lam: 2, bron: 'basis' } }, wensen: [], beleid: B });
    expect(t.perDag[0].p).toBe(2);
    expect(Object.keys(t.pijlers.medewerker.perMedewerker)).toEqual([a.id]);
    expect(t.uren[x.id].gepland).toBe(8);
  });
});

describe('rooster maken: externen en een eerlijke verdeling', () => {
  const team = voorbeeldTeam('Friesland', () => `f${++n}`);
  const ext = mw({ regio: 'Friesland', extern: true, contract: 24 });
  const dates = isoRange('2026-10-12', '2026-12-06');
  const behoefte = behoefteVoor({ norm: NORM_STANDAARD }, 'Friesland', dates, { alphaRegio: B.alphaRegio, tegen: 'norm' });
  const vooraf: Cellen = { [ext.id]: { '2026-10-14': '1' } };
  const c = pasToe(vooraf, voorstel({ team: [...team, ext], dates, cellen: vooraf, behoefte, wensen: [], beleid: B, seed: 3 }));

  it('plant externen niet zelf in, maar telt hun diensten wel mee', () => {
    expect(c[ext.id]).toEqual({ '2026-10-14': '1' });
    const p = [...team, ext].reduce((a, m) => a + DIENSTEN[c[m.id]?.['2026-10-14'] ?? '-'].plekken, 0);
    expect(p).toBe(behoefte['2026-10-14']!.k);
  });

  it('verdeelt regelplekken en Dg-dagen eerlijk over de uitvaartverzorgers', () => {
    const aandeel = team.filter((m) => m.functie !== 'UL').map((m) => {
      const rij = dates.map((d) => c[m.id]?.[d] ?? '-');
      const werk = rij.filter((s) => DIENSTEN[s].werk).length;
      return rij.filter((s) => DIENSTEN[s].categorie === 'dossier').length / werk;
    });
    expect(Math.max(...aandeel) - Math.min(...aandeel)).toBeLessThan(0.2);
  });

  it('blijft eerlijk bij elke seed: 1B\'s en Dg-dagen niet bij een paar mensen', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = pasToe(vooraf, voorstel({ team: [...team, ext], dates, cellen: vooraf, behoefte, wensen: [], beleid: B, seed }));
      const uv = team.filter((m) => m.functie !== 'UL').map((m) => dates.map((d) => r[m.id]?.[d] ?? '-'));
      const dg = uv.map((rij) => rij.filter((s) => DIENSTEN[s].categorie === 'dossier').length / rij.filter((s) => DIENSTEN[s].werk).length);
      const b = uv.map((rij) => rij.filter((s) => s === '1B').length);
      expect(Math.max(...dg) - Math.min(...dg), `Dg bij seed ${seed}`).toBeLessThan(0.2);
      expect(Math.max(...b) - Math.min(...b), `1B bij seed ${seed}`).toBeLessThanOrEqual(4);
    }
  });

  it('bijsturen zet bij een tekort een vrije externe kracht in', () => {
    const d = '2026-10-20';
    const k = behoefte[d]!.k;
    const cel: Cellen = { [team[0].id]: { [d]: '1M' } };
    const b = bijsturen({ team: [...team, ext], cellen: cel, dates: [d], basis: { [d]: { k, lam: 4, bron: 'basis' } }, nu: { [d]: { k, lam: 4, bron: 'laatste' } }, beleid: B, vandaag: '2026-10-06', maxActies: 10, zzp: true });
    const zzp = b.dagen[0].acties.find((a) => a.soort === 'zzp')!;
    expect(zzp.wijzigingen).toEqual([[ext.id, d, '1']]);
    // voorlopig staan ZZP'ers niet in het rooster: dan geen ZZP-stap
    const zonder = bijsturen({ team: [...team, ext], cellen: cel, dates: [d], basis: { [d]: { k, lam: 4, bron: 'basis' } }, nu: { [d]: { k, lam: 4, bron: 'laatste' } }, beleid: B, vandaag: '2026-10-06', maxActies: 10 });
    expect(zonder.dagen[0].acties.some((a) => a.soort === 'zzp')).toBe(false);
  });
});
