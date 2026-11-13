import { describe, it, expect } from 'vitest';
import { jaarplan, jaarWeken, mijlpalen, zomerDeadline } from '@/lib/capaciteit/jaarplan';
import { STANDAARD_SCHOOLVAKANTIES, verlofRuimte, vulSchoolvakantiesAan, type Schoolvakantie, type VerlofItem } from '@/lib/capaciteit/verlof';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { STANDAARD_BELEID } from '@/lib/rooster/types';
import { addDays, feestdagenVan } from '@/lib/dates';

let n = 0;
const regio = 'Zuid Limburg';
const team = voorbeeldTeam(regio, () => `j${++n}`);
const [a, b, c] = team;
const v = (m: typeof a, van: string, tot: string, extra: Partial<VerlofItem> = {}): VerlofItem => ({ id: `v${++n}`, medewerkerId: m.id, regio, van, tot, status: 'goedgekeurd', aangevraagd: '2026-01-01', soort: 'vakantie', ...extra });
const ctx = (verlof: VerlofItem[], schoolvakanties: Schoolvakantie[] = STANDAARD_SCHOOLVAKANTIES) => ({ normen: NORM_STANDAARD, beleid: STANDAARD_BELEID, medewerkers: team, verlof, schoolvakanties });

describe('jaar in weken en feestdagen', () => {
  it('ISO-weken: 2026 heeft er 53 en begint op 29 december, 2027 heeft er 52', () => {
    expect(jaarWeken(2026)).toEqual({ eerste: '2025-12-29', aantal: 53 });
    expect(jaarWeken(2027)).toEqual({ eerste: '2027-01-04', aantal: 52 });
  });

  it('feestdagen met naam', () => {
    const f = feestdagenVan(2026);
    expect(f.find((x) => x.naam === 'Koningsdag')!.datum).toBe('2026-04-27');
    expect(f.find((x) => x.naam === 'Hemelvaartsdag')!.datum).toBe('2026-05-14');
    expect(f.find((x) => x.naam === 'Tweede pinksterdag')!.datum).toBe('2026-05-25');
    expect(f.some((x) => x.naam === 'Bevrijdingsdag')).toBe(false);
    expect(feestdagenVan(2025).some((x) => x.naam === 'Bevrijdingsdag')).toBe(true);
  });
});

describe('jaarplanning per regio', () => {
  const vandaag = '2026-10-06';

  it('per medewerker per week de werkdagen verlof; een aanvraag kleurt de week', () => {
    const p = jaarplan({ ctx: ctx([v(a, '2026-03-02', '2026-03-08'), v(a, '2026-11-11', '2026-11-12', { status: 'aangevraagd' }), v(a, '2026-11-09', '2026-11-10')]), regio, jaar: 2026, vandaag });
    const r = p.rijen.find((x) => x.m.id === a.id)!;
    // het weekend telt niet mee
    expect(r.weken['2026-03-02']).toMatchObject({ dagen: 5, status: 'goedgekeurd' });
    expect(r.weken['2026-11-09']).toMatchObject({ dagen: 4, status: 'aangevraagd' });
    expect(r.weken['2026-11-09'].ids).toHaveLength(2);
    expect(p.weken.find((w) => w.maandag === '2026-11-09')!.weg).toBe(1);
  });

  it('per medewerker de open aanvragen; verlofrecht en saldo staan niet in GRIP', () => {
    const p = jaarplan({ ctx: ctx([v(a, '2026-03-02', '2026-03-06'), v(a, '2026-11-02', '2026-11-06', { status: 'aangevraagd' }), v(b, '2026-12-07', '2026-12-08', { status: 'aangevraagd' })]), regio, jaar: 2026, vandaag });
    const r = p.rijen.find((x) => x.m.id === a.id)!;
    expect(r.open).toBe(1);
    expect(p.totaal.open).toBe(2);
    for (const veld of ['recht', 'rest', 'opgenomen', 'achter']) expect(veld in r).toBe(false);
    expect(Object.keys(p.totaal).sort()).toEqual(['aangevraagd', 'goedgekeurd', 'norm', 'open', 'ruimte']);
    // ook wie nog geen verlof heeft, krijgt geen signaal over opnemen of recht
    expect(p.signalen.some((x) => /verlofrecht|verlof opnemen|opgenomen/i.test(x.tekst))).toBe(false);
  });

  it('weken met meer verlof dan ruimte worden knelpunten; rustige weken liggen buiten de schoolvakanties en na deze week', () => {
    const week = '2026-11-16';
    const ruimte = verlofRuimte(ctx([]), regio, week, 1)[0].ruimte;
    const weg: VerlofItem[] = [];
    let uren = 0;
    for (const m of team) { if (uren > ruimte) break; weg.push(v(m, week, addDays(week, 4))); uren += m.contract; }
    const p = jaarplan({ ctx: ctx(weg), regio, jaar: 2026, vandaag });
    expect(p.knelpunten[0]).toMatchObject({ van: week, weken: 1, alleenGoedgekeurd: true });
    expect(p.knelpunten[0].uren).toBeCloseTo(uren - ruimte, 6);
    expect(p.weken.find((w) => w.maandag === week)!.status).toBe('vol');
    expect(p.signalen[0].ernst).toBe('bad');
    for (const r of p.rustig) {
      expect(r.van >= '2026-10-12').toBe(true);
      expect(p.weken.filter((w) => w.maandag >= r.van && w.maandag <= r.tot).every((w) => !w.ruimte.schoolvakantie)).toBe(true);
    }
  });

  it('zomervakantie dit jaar en vorig jaar, voor een eerlijke verdeling', () => {
    // Zuid Limburg valt in regio zuid: zomer 2026 van 11 juli t/m 23 augustus
    const p = jaarplan({ ctx: ctx([v(a, '2026-07-13', '2026-07-24'), v(a, '2027-07-26', '2027-08-06', { status: 'aangevraagd' }), v(b, '2027-07-26', '2027-07-30', { status: 'aangevraagd' })]), regio, jaar: 2027, vandaag });
    const ra = p.rijen.find((x) => x.m.id === a.id)!, rb = p.rijen.find((x) => x.m.id === b.id)!, rc = p.rijen.find((x) => x.m.id === c.id)!;
    expect([ra.zomer, ra.zomerVorigJaar]).toEqual([true, true]);
    expect([rb.zomer, rb.zomerVorigJaar]).toEqual([true, false]);
    expect([rc.zomer, rc.zomerVorigJaar]).toEqual([false, false]);
    expect(p.signalen.some((s) => s.tekst.includes('vorig jaar en dit jaar zomervakantie'))).toBe(true);
    // geen zomervakantie bekend voor 2025: dan weten we het niet
    expect(jaarplan({ ctx: ctx([]), regio, jaar: 2026, vandaag }).rijen[0].zomerVorigJaar).toBeNull();
  });
});

describe('mijlpalen van het vakantieproces (§ 4.1 en § 4.2)', () => {
  it('zonder rondes de data uit het beleid', () => {
    expect(mijlpalen(2027, [], 'O', 4).map((m) => m.datum)).toEqual(['2027-03-01', '2027-06-17', '2027-07-17', '2027-11-17', '2027-12-17']);
    expect([zomerDeadline(2027, 6), zomerDeadline(2027, 7), zomerDeadline(2027, 8)]).toEqual(['2027-01-01', '2026-12-01', '2026-11-01']);
  });

  it('een ronde in GRIP vervangt alleen de beleidsdata in de buurt', () => {
    const ronde = { naam: 'Zomer 2027', cluster: 'NL', van: '2027-06-01', tot: '2027-09-30', fase: 'planning', data: { aanvragen: '2026-11-20', analyse: '2026-11-27', advies: '2026-12-04', gesprek: '2026-12-11', besluit: '2026-12-18' } };
    const m = mijlpalen(2026, [ronde], 'O', 4);
    expect(m.map((x) => [x.datum, x.bron])).toEqual([['2026-03-01', 'beleid'], ['2026-06-17', 'beleid'], ['2026-07-17', 'beleid'], ['2026-11-20', 'ronde'], ['2026-12-18', 'ronde']]);
    // een ronde van een ander cluster telt niet
    expect(mijlpalen(2026, [{ ...ronde, cluster: 'W' }], 'O', 4).every((x) => x.bron === 'beleid')).toBe(true);
  });
});

describe('opslag', () => {
  it('schoolvakanties: nieuwe startwaarden erbij, zonder opgehaalde data te dubbelen of iets terug te zetten', () => {
    const oud = STANDAARD_SCHOOLVAKANTIES.filter((x) => x.van >= '2026-10-01' && x.van < '2027-10-01');
    const opgehaald: Schoolvakantie = { id: '2025-2026-zomervakantie-zuid', naam: 'Zomervakantie', regio: 'zuid', van: '2026-07-11', tot: '2026-08-23', bron: 'rijksoverheid' };
    const na = vulSchoolvakantiesAan([...oud, opgehaald]);
    expect(na.filter((x) => x.naam === 'Zomervakantie' && x.regio === 'zuid' && x.van.startsWith('2026'))).toEqual([opgehaald]);
    expect(na.some((x) => x.id === 'kv27')).toBe(true);
    // daarna verwijderd: blijft weg
    const zonder = na.filter((x) => x.id !== 'kv27');
    expect(vulSchoolvakantiesAan(zonder)).toBe(zonder);
  });

});
