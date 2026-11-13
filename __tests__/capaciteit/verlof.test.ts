import { describe, it, expect } from 'vitest';
import { verlofAdvies, verlofRuimte, verlofUrenPerWeek, schoolvakantieIn, STANDAARD_SCHOOLVAKANTIES, type VerlofContext, type VerlofItem } from '@/lib/capaciteit/verlof';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { borgingWeek, normWeek } from '@/lib/capaciteit/norm';
import { STANDAARD_BELEID, type Medewerker } from '@/lib/rooster/types';
import { NBD, NBD_STANDAARD } from '@/lib/nbd/parameters';
import { nbdUrenPerWeek } from '@/lib/nbd/capaciteit';

let n = 0;
const mw = (regio: string, contract = 36): Medewerker => ({ id: `l${++n}`, regio, naam: `L${n}`, contract, voorkeur: 'O', weekendgroep: 0, actief: true });
const team = (regio: string, uren: number) => Array.from({ length: Math.round(uren / 36) }, () => mw(regio));
const item = (m: Medewerker, van: string, tot: string, status: VerlofItem['status'] = 'aangevraagd', aangevraagd = '2026-10-01T10:00:00'): VerlofItem =>
  ({ id: `v${++n}`, medewerkerId: m.id, regio: m.regio, van, tot, status, aangevraagd });

describe('verlofuren', () => {
  it('een week verlof kost de contracturen, alleen op werkdagen', () => {
    const m = mw('Utrecht', 32);
    const uren = verlofUrenPerWeek(item(m, '2026-11-09', '2026-11-15'), m.contract);
    expect([...uren.entries()]).toEqual([['2026-11-09', 32]]);
    const over = verlofUrenPerWeek(item(m, '2026-11-12', '2026-11-17'), m.contract);
    expect([...over.values()].map((x) => Math.round(x * 10) / 10)).toEqual([12.8, 12.8]);
  });
});

describe('verlofruimte uit de vastgestelde regelplekken', () => {
  const leden = team('Utrecht', 504);
  const ctx: VerlofContext = { normen: NORM_STANDAARD, beleid: STANDAARD_BELEID, medewerkers: leden, verlof: [], schoolvakanties: STANDAARD_SCHOOLVAKANTIES };

  it('ruimte = bezetting min verzuim min te borgen uren', () => {
    const [w] = verlofRuimte(ctx, 'Utrecht', '2026-11-09', 1);
    const bezetting = leden.reduce((s, m) => s + m.contract, 0);
    const borging = borgingWeek(NORM_STANDAARD, 'Utrecht', normWeek('2026-11-09'), true)!.totaal;
    expect(w.bezetting).toBe(bezetting);
    expect(w.ruimte).toBeCloseTo(bezetting * (1 - STANDAARD_BELEID.verzuimNorm) - borging, 6);
    expect(w.over).toBeCloseTo(w.ruimte, 6);
  });

  it('goedgekeurd verlof gaat af van de ruimte, een aanvraag nog niet', () => {
    const v1 = item(leden[0], '2026-11-09', '2026-11-13', 'goedgekeurd');
    const v2 = item(leden[1], '2026-11-09', '2026-11-13');
    const [w] = verlofRuimte({ ...ctx, verlof: [v1, v2] }, 'Utrecht', '2026-11-09', 1);
    expect(w.goedgekeurd).toBe(36);
    expect(w.aangevraagd).toBe(36);
    expect(w.over).toBeCloseTo(w.ruimte - 36, 6);
  });

  it('begroting: de formatie uit de Excel (fte x 40) in plaats van het team', () => {
    const [w] = verlofRuimte({ ...ctx, bezetting: 'begroting' }, 'Utrecht', '2026-11-09', 1);
    expect(w.bezetting).toBeCloseTo(NORM_STANDAARD.regios.Utrecht.fte[3] * 40, 6);
  });
});

describe('verlofadvies', () => {
  it('past, krap en past niet, in volgorde van aanvragen', () => {
    // een team dat precies genoeg heeft voor de borging plus 50 uur
    const nw = normWeek('2026-11-09');
    const borging = borgingWeek(NORM_STANDAARD, 'Utrecht', nw, true)!.totaal;
    const nodig = (borging + 50) / (1 - STANDAARD_BELEID.verzuimNorm);
    const leden = Array.from({ length: Math.floor(nodig / 36) }, () => mw('Utrecht'));
    leden.push(mw('Utrecht', Math.round((nodig - leden.length * 36) * 10) / 10));
    const a = item(leden[0], '2026-11-09', '2026-11-13', 'aangevraagd', '2026-10-01T09:00:00');
    const b = item(leden[1], '2026-11-11', '2026-11-11', 'aangevraagd', '2026-10-01T10:00:00');
    const c = item(leden[2], '2026-11-09', '2026-11-13', 'aangevraagd', '2026-10-01T11:00:00');
    const advies = verlofAdvies({ normen: NORM_STANDAARD, beleid: STANDAARD_BELEID, medewerkers: leden, verlof: [a, b, c], schoolvakanties: [] }, 'O');
    expect(advies.get(a.id)!.soort).toBe('past'); // 50 - 36 = 14 over
    expect(advies.get(b.id)!.soort).toBe('krap'); // 14 - 7,2 = 6,8 over, minder dan 8
    expect(advies.get(c.id)!.soort).toBe('past_niet');
  });

  it('wie al verlof in een schoolvakantie had, komt later aan de beurt', () => {
    const leden = team('Utrecht', 360);
    const nw = normWeek('2027-07-19');
    const borging = borgingWeek(NORM_STANDAARD, 'Utrecht', nw, true)!.totaal;
    const extra = Math.ceil((borging + 40) / (1 - STANDAARD_BELEID.verzuimNorm) / 36) - leden.length;
    for (let i = 0; i < extra; i++) leden.push(mw('Utrecht'));
    const zomer = { id: 'z', naam: 'Zomer', regio: 'midden' as const, van: '2027-07-17', tot: '2027-08-29', bron: 'handmatig' as const };
    const eerder = item(leden[0], '2026-10-19', '2026-10-23', 'goedgekeurd');
    const herfst = { ...zomer, id: 'h', van: '2026-10-17', tot: '2026-10-25' };
    const a = item(leden[0], '2027-07-19', '2027-07-23', 'aangevraagd', '2026-10-01T09:00:00');
    const b = item(leden[1], '2027-07-19', '2027-07-23', 'aangevraagd', '2026-10-01T10:00:00');
    const ctx: VerlofContext = { normen: NORM_STANDAARD, beleid: STANDAARD_BELEID, medewerkers: leden, verlof: [eerder, a, b], schoolvakanties: [zomer, herfst] };
    const advies = verlofAdvies(ctx, 'O');
    expect(schoolvakantieIn(ctx.schoolvakanties, 'Utrecht', '2027-07-19')?.id).toBe('z');
    expect(advies.get(b.id)!.soort).not.toBe('past_niet');
    expect(['krap', 'past_niet', 'cluster']).toContain(advies.get(a.id)!.soort);
  });
});

describe('verlofruimte bij de nabestaandendesk', () => {
  it('de ruimte volgt de capaciteitsplanning van de NBD: netto uren min 92% van wat Erlang C vraagt', () => {
    const leden = Array.from({ length: 40 }, () => mw(NBD, 32));
    const ctx: VerlofContext = { normen: NORM_STANDAARD, beleid: STANDAARD_BELEID, medewerkers: leden, verlof: [], schoolvakanties: STANDAARD_SCHOOLVAKANTIES, nbd: NBD_STANDAARD };
    const [w] = verlofRuimte(ctx, NBD, '2026-11-09', 1);
    expect(w.bezetting).toBe(40 * 32);
    // verzuim: 5% ziek en 32 uur overig verlof en langdurig verzuim
    expect(w.verzuim).toBeCloseTo(0.05 * 1280 + 32, 6);
    // te borgen: 92% van de Erlang-uren, plus training (een half uur per medewerker), pauze (2%), afspraken en taken
    const erlang = nbdUrenPerWeek(NBD_STANDAARD, NORM_STANDAARD, '2026-11-09');
    expect(erlang).toBeGreaterThan(600);
    expect(w.borging).toBeCloseTo(0.92 * erlang + 20 + 0.02 * 1280 + 40 + 40, 6);
    expect(w.ruimte).toBeCloseTo(w.bezetting - w.verzuim - w.borging, 6);
    // goedgekeurd verlof gaat van de ruimte af; korter afhandelen per gesprek geeft meer ruimte
    const v = item(leden[0], '2026-11-09', '2026-11-15', 'goedgekeurd');
    expect(verlofRuimte({ ...ctx, verlof: [v] }, NBD, '2026-11-09', 1)[0].over).toBeCloseTo(w.over - 32, 6);
    expect(verlofRuimte({ ...ctx, nbd: { ...NBD_STANDAARD, aht: 240 } }, NBD, '2026-11-09', 1)[0].ruimte).toBeGreaterThan(w.ruimte);
    // de NBD hoort bij geen cluster: verlof bij de NBD wordt alleen tegen de NBD zelf gewogen
    const aanvraag = { ...ctx, verlof: [item(leden[1], '2026-11-16', '2026-11-20')] };
    expect(verlofAdvies(aanvraag, NBD).get(aanvraag.verlof[0].id)?.soort).toBe('past');
    expect(verlofAdvies(aanvraag, 'NL').size).toBe(0);
  });
});
