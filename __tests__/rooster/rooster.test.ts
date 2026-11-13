import { describe, it, expect } from 'vitest';
import { addDays, isoRange, toDay, weekday, weekIndex, isWeekend } from '@/lib/dates';
import { toets, celOvertredingen, cel, REGELS } from '@/lib/rooster/toets';
import { voorstel } from '@/lib/rooster/voorstel';
import { ruilToets, pasToe } from '@/lib/rooster/ruil';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { STANDAARD_BELEID, beleidVoor, werktWeekend, type Behoefte, type Cellen, type DienstCode, type Medewerker, type Wens } from '@/lib/rooster/types';
import { DIENSTEN, magFunctie } from '@/lib/rooster/diensten';

const B = STANDAARD_BELEID;
const atwOvertredingen = (...a: Parameters<typeof celOvertredingen>) => celOvertredingen(...a).filter((o) => REGELS[o.regel].niveau === 'ATW en CAO');
let n = 0;
const id = () => `m${++n}`;

function mw(naam: string, extra: Partial<Medewerker> = {}): Medewerker {
  return { id: id(), regio: 'Utrecht', naam, contract: 32, voorkeur: 'O', weekendgroep: 0, actief: true, ...extra };
}

const dates = isoRange('2026-10-05', '2026-11-29'); // 8 weken, maandag t/m zondag
const vast: Behoefte = Object.fromEntries(dates.map((d) => [d, { k: weekday(toDay(d)) === 0 ? 3 : 5, lam: 4.3, bron: 'basis' as const }]));
const regels = (o: ReturnType<typeof celOvertredingen>, r: string) => o.filter((x) => x.regel === r).map((x) => x.datum);
const dag = (codes: DienstCode[]) => {
  const team = codes.map((_, i) => mw(`D${i}`));
  const cellen: Cellen = Object.fromEntries(team.map((e, i) => [e.id, { '2026-10-06': codes[i] }]));
  return { team, cellen };
};

describe('diensten volgens het roosterbeleid', () => {
  it('uren: een 1 is 8, een 2 is 10, DG1 4, DG2 8 en een 1B gewogen 2', () => {
    expect([DIENSTEN['1'].uren, DIENSTEN['2'].uren, DIENSTEN.DG1.uren, DIENSTEN.DG2.uren, DIENSTEN['1B'].uren]).toEqual([8, 10, 4, 8, 2]);
    expect(DIENSTEN['1B'].urenMax).toBe(8);
  });

  it('plekken en voorgangen', () => {
    expect([DIENSTEN['1'].plekken, DIENSTEN['1M'].plekken, DIENSTEN['2'].plekken, DIENSTEN['1B'].plekken]).toEqual([1, 1, 2, 1]);
    expect([DIENSTEN.DG1.voorgangen, DIENSTEN.DG2.voorgangen, DIENSTEN.DG2.plekken]).toEqual([1, 2, 0]);
  });

  it('Dg-tijden staan niet vast bij het maken van het rooster', () => {
    expect(DIENSTEN.DG1.tijdenVast).toBe(false);
    expect(DIENSTEN.DG2.tijdenVast).toBe(false);
    expect(DIENSTEN['1'].tijdenVast).toBe(true);
  });

  it('een uitvaartleider doet alleen Dg en overige diensten', () => {
    expect(magFunctie('UL', 'DG1')).toBe(true);
    expect(magFunctie('UL', 'DG2')).toBe(true);
    expect(magFunctie('UL', '1')).toBe(false);
    expect(magFunctie('UL', '1B')).toBe(false);
    expect(magFunctie('UV', '2')).toBe(true);
  });

  it('elke regel verwijst naar een paragraaf van het beleid', () => {
    for (const r of Object.values(REGELS)) expect(r.paragraaf).toBeTruthy();
  });
});

describe('ATW en CAO', () => {
  it('signaleert een 7e dienst op rij', () => {
    const e = mw('Anouk');
    const cellen: Cellen = { [e.id]: Object.fromEntries(isoRange('2026-10-05', '2026-10-11').map((d) => [d, '1'])) };
    expect(regels(atwOvertredingen([e], cellen, dates, B), 'achtereen')).toEqual(['2026-10-11']);
  });

  it('telt diensten van vóór de periode mee als aanloop', () => {
    const e = mw('Bas');
    const cellen: Cellen = { [e.id]: Object.fromEntries(isoRange('2026-09-30', '2026-10-06').map((d) => [d, 'DG2'])) };
    expect(atwOvertredingen([e], cellen, dates, B).map((x) => x.datum)).toEqual(['2026-10-06']);
  });

  it('controleert de rust tussen twee diensten', () => {
    const e = mw('Carlijn');
    const cellen: Cellen = { [e.id]: { '2026-10-06': '1M', '2026-10-07': '1' } };
    expect(regels(atwOvertredingen([e], cellen, dates, B), 'rust')).toEqual([]); // 19:00 tot 9:00 is 14 uur
    expect(regels(atwOvertredingen([e], cellen, dates, { ...B, minRustUren: 15 }), 'rust')).toEqual(['2026-10-07']);
  });

  it('maximaal 14 beschikbaarheidsdiensten per 28 dagen', () => {
    const e = mw('Daan', { afstandsverklaring: true });
    const om = isoRange('2026-10-05', '2026-11-01').filter((_, i) => i % 2 === 0); // 14 keer
    const cellen: Cellen = { [e.id]: Object.fromEntries(om.map((d) => [d, '1B'])) };
    expect(regels(celOvertredingen([e], cellen, dates, B), 'beschikbaar28')).toEqual([]);
    cellen[e.id]['2026-10-06'] = '1B'; // nummer 15 binnen 28 dagen
    expect(regels(celOvertredingen([e], cellen, dates, B), 'beschikbaar28').length).toBeGreaterThan(0);
  });

  it('minimaal 26 vrije weekenden per jaar, tenzij een afstandsverklaring', () => {
    const jaar = isoRange('2027-01-01', '2027-12-31').filter((d) => weekday(toDay(d)) === 6);
    // zaterdag en zondag gewerkt: 27 weekenden is er één te veel
    const rij = Object.fromEntries(jaar.slice(0, 27).flatMap((d) => [[d, '1' as DienstCode], [addDays(d, 1), '1' as DienstCode]]));
    const a = mw('Els'), b = mw('Femke', { afstandsverklaring: true });
    const periode = isoRange('2027-01-01', '2027-12-31');
    const o = celOvertredingen([a, b], { [a.id]: rij, [b.id]: rij }, periode, B);
    expect(o.filter((x) => x.regel === 'weekenden26' && x.mid === a.id).map((x) => x.datum)).toEqual([jaar[26], addDays(jaar[26], 1)]);
    expect(o.some((x) => x.regel === 'weekenden26' && x.mid === b.id)).toBe(false);
  });

  it('van een collega (in de browser van een medewerker) is de afstandsverklaring onbekend: dan toetst de planner', () => {
    const jaar = isoRange('2027-01-01', '2027-12-31').filter((d) => weekday(toDay(d)) === 6);
    const rij = Object.fromEntries(jaar.slice(0, 30).flatMap((d) => [[d, '1' as DienstCode], [addDays(d, 1), '1' as DienstCode]]));
    const collega = mw('Hans', { collega: true });
    expect(regels(celOvertredingen([collega], { [collega.id]: rij }, isoRange('2027-01-01', '2027-12-31'), B), 'weekenden26')).toEqual([]);
  });

  it('zondag en maandag vrij telt als vrij weekend, hoogstens 13 keer per jaar (CAO § 1.4)', () => {
    const jaar = isoRange('2027-01-01', '2027-12-31').filter((d) => weekday(toDay(d)) === 6);
    const periode = isoRange('2027-01-01', '2027-12-31');
    const a = mw('Gijs');
    // 39 zaterdagen gewerkt, zondag en maandag vrij: 13 tellen als vrij weekend, 26 niet: precies goed
    const zaterdagen = (n: number) => Object.fromEntries(jaar.slice(0, n).map((d) => [d, '1' as DienstCode]));
    expect(regels(celOvertredingen([a], { [a.id]: zaterdagen(39) }, periode, B), 'weekenden26')).toEqual([]);
    // 40: één te veel
    expect(regels(celOvertredingen([a], { [a.id]: zaterdagen(40) }, periode, B), 'weekenden26')).toEqual([jaar[39]]);
    // werkt die ook op de maandag erna, dan telt het weekend niet als vrij: 27 zulke weekenden zijn er één te veel
    const metMaandag = { ...zaterdagen(39), ...Object.fromEntries(jaar.slice(0, 27).map((d) => [addDays(d, 2), '1' as DienstCode])) };
    expect(regels(celOvertredingen([a], { [a.id]: metMaandag }, periode, B), 'weekenden26')).toEqual([jaar[26]]);
  });
});

describe('beleid per regio', () => {
  it('de voorgaansplekken per dag komen uit de vastgestelde regelplekken van de regio (§ 3.3)', () => {
    const normen = { ...NORM_STANDAARD, regios: { ...NORM_STANDAARD.regios, Nijmegen: { ...NORM_STANDAARD.regios.Nijmegen, voorgangen: 6 } } };
    expect(beleidVoor(B, 'Nijmegen', normen).voorgangenPerDag).toBe(6);
    expect(beleidVoor(B, 'Utrecht', normen).voorgangenPerDag).toBe(NORM_STANDAARD.regios.Utrecht.voorgangen);
    // zonder normen het landelijke getal, en het eigen minimum aan Dg-diensten blijft
    expect(beleidVoor({ ...B, dgPerRegio: { Nijmegen: 3 } }, 'Nijmegen', normen)).toMatchObject({ minDG: 3, voorgangenPerDag: 6 });
    expect(beleidVoor(B, 'Nijmegen').voorgangenPerDag).toBe(B.voorgangenPerDag);
    // een dag met 2 x DG2 (4 voorgangen) is in Nijmegen dan te weinig
    const a = mw('Ina'), b = mw('Jop');
    const d = '2026-10-06';
    const t = toets({ team: [a, b], dates: [d], cellen: { [a.id]: { [d]: 'DG2' }, [b.id]: { [d]: 'DG2' } }, behoefte: {}, wensen: [], beleid: beleidVoor(B, 'Nijmegen', normen) });
    expect(t.checks.find((c) => c.id === 'voorgangen')!.items).toEqual([d]);
  });
});

describe('roosterbeleid en teamafspraken (geen harde overtredingen)', () => {
  it('om het weekend werken, ook over de jaarwisseling', () => {
    const e = mw('Gerard');
    const cellen: Cellen = { [e.id]: { '2026-12-27': '1', '2027-01-02': '1' } };
    const periode = isoRange('2026-12-21', '2027-01-10');
    expect(celOvertredingen([e], cellen, periode, B)).toEqual([{ mid: e.id, datum: '2027-01-02', regel: 'omhetweekend' }]);
    expect(atwOvertredingen([e], cellen, periode, B)).toEqual([]);
  });

  it('weekendgroepen wisselen elk weekend, ook rond week 53', () => {
    const a = { weekendgroep: 0 }, week = (d: string) => weekIndex(toDay(d));
    expect(werktWeekend(a, week('2026-12-26'))).not.toBe(werktWeekend(a, week('2027-01-02')));
    expect(werktWeekend(a, week('2027-01-02'))).not.toBe(werktWeekend(a, week('2027-01-09')));
  });

  it('maximaal 3 regelplekken per persoon per weekend', () => {
    const e = mw('Hanneke');
    const ok: Cellen = { [e.id]: { '2026-10-10': '2', '2026-10-11': '1' } };
    const teVeel: Cellen = { [e.id]: { '2026-10-10': '2', '2026-10-11': '2' } };
    expect(regels(celOvertredingen([e], ok, dates, B), 'weekendplekken')).toEqual([]);
    expect(regels(celOvertredingen([e], teVeel, dates, B), 'weekendplekken')).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('een uitvaartleider op een regeldienst', () => {
    const e = mw('Ilse', { functie: 'UL' });
    const cellen: Cellen = { [e.id]: { '2026-10-06': '1', '2026-10-07': 'DG1' } };
    expect(regels(celOvertredingen([e], cellen, dates, B), 'functie')).toEqual(['2026-10-06']);
  });
});

describe('toets per dag', () => {
  const items = (t: ReturnType<typeof toets>, idr: string) => t.checks.find((c) => c.id === idr)?.items ?? [];
  const dagToets = (codes: DienstCode[], k = 5) => {
    const { team, cellen } = dag(codes);
    return toets({ team, dates: ['2026-10-06'], cellen, behoefte: { '2026-10-06': { k, lam: 4, bron: 'basis' } }, wensen: [], beleid: B });
  };

  it('maximaal twee keer een 2, en alleen met nog minstens twee enkele regeldiensten', () => {
    expect(items(dagToets(['2', '2', '1M', '1', '1B', 'DG2', 'DG2'], 7), 'twee')).toEqual([]);
    // de 1B telt niet als enkele regeldienst: die valt niet altijd
    expect(items(dagToets(['2', '2', '1M', '1B', 'DG2', 'DG2'], 6), 'twee')).toEqual(['2026-10-06']);
    expect(items(dagToets(['2', '2', '1M', 'DG2', 'DG2'], 5), 'twee')).toEqual(['2026-10-06']);
    expect(items(dagToets(['2', '2', '2', '1M', '1', '1B', 'DG2', 'DG2'], 9), 'twee')).toEqual(['2026-10-06']);
  });

  it('de 1B telt als regelplek; precies de afgesproken plekken', () => {
    const t = dagToets(['1', '1', '1M', '1B', '1', 'DG2', 'DG2'], 5);
    expect(t.perDag[0].p).toBe(5);
    expect(items(t, 'tekort')).toEqual([]);
    expect(items(t, 'teveel')).toEqual([]);
    expect(items(dagToets(['1', '1', '1M', '1B', '1', '1', 'DG2', 'DG2'], 5), 'teveel')).toEqual(['2026-10-06']);
    expect(items(dagToets(['1', '1M', '1B', 'DG2', 'DG2'], 5), 'tekort')).toEqual(['2026-10-06']);
  });

  it('middagdienst, beschikbaarheid, Dg en voorgangen', () => {
    const t = dagToets(['1', '1', '1', '1', '1', 'DG1'], 5);
    expect(items(t, 'middag')).toEqual(['2026-10-06']);
    expect(items(t, 'beschikbaar')).toEqual(['2026-10-06']);
    expect(items(t, 'dg')).toEqual(['2026-10-06']);
    expect(items(t, 'voorgangen')).toEqual(['2026-10-06']);
    const goed = dagToets(['1', '1', '1M', '1B', '1', 'DG2', 'DG2'], 5);
    for (const r of ['middag', 'beschikbaar', 'dg', 'voorgangen']) expect(items(goed, r)).toEqual([]);
  });

  it('geen Dg op zondag', () => {
    const team = [mw('J'), mw('K')];
    const cellen: Cellen = { [team[0].id]: { '2026-10-11': '1M' }, [team[1].id]: { '2026-10-11': 'DG2' } };
    const t = toets({ team, dates: ['2026-10-11'], cellen, behoefte: {}, wensen: [], beleid: B });
    expect(items(t, 'dgzondag')).toEqual(['2026-10-11']);
    expect(items(t, 'dg')).toEqual([]);
  });
});

describe('toets en cijfer', () => {
  it('leeg rooster krijgt een 1', () => {
    const team = [mw('A'), mw('B')];
    const t = toets({ team, dates, cellen: {}, behoefte: vast, wensen: [], beleid: B });
    expect(t.cijfer).toBe(1);
    expect(t.checks.find((c) => c.id === 'tekort')!.items.length).toBe(dates.length);
  });

  it('harde overtreding kapt het cijfer af op 5,4', () => {
    const team = voorbeeldTeam('Utrecht', id);
    const cellen = pasToe({}, voorstel({ team, dates, cellen: {}, behoefte: vast, wensen: [], beleid: B }));
    const e = team.find((x) => x.functie !== 'UL')!;
    const kapot = pasToe(cellen, dates.slice(0, 8).map((d) => [e.id, d, '1']));
    const t = toets({ team, dates, cellen: kapot, behoefte: vast, wensen: [], beleid: B });
    expect(t.hard).toBeGreaterThan(0);
    expect(t.cijfer).toBeLessThanOrEqual(5.4);
    expect(t.status[0]).toBe('bad');
  });

  it('verlof en ziekte verlagen de urennorm', () => {
    const e = mw('Daan', { contract: 40 });
    const week = isoRange('2026-10-05', '2026-10-11');
    const t = toets({ team: [e], dates: week, cellen: { [e.id]: { '2026-10-05': 'V', '2026-10-06': 'V', '2026-10-07': 'Z' } }, behoefte: {}, wensen: [], beleid: B });
    expect(t.uren[e.id].norm).toBeCloseTo(40 - 24, 6);
  });

  it('meer uren dan het contract is een aandachtspunt', () => {
    const e = mw('Eva', { contract: 24 });
    const cellen: Cellen = { [e.id]: Object.fromEntries(isoRange('2026-10-05', '2026-10-08').map((d) => [d, '1'])) };
    const t = toets({ team: [e], dates: isoRange('2026-10-05', '2026-10-11'), cellen, behoefte: {}, wensen: [], beleid: B });
    expect(t.checks.find((c) => c.id === 'contract')!.items.length).toBe(1);
  });

  it('meer plekken op een drukke dag helpt de klant', () => {
    const lam = 6;
    const team = Array.from({ length: 8 }, (_, i) => mw(`K${i}`));
    const met = (k: number) => {
      const cellen: Cellen = Object.fromEntries(team.slice(0, k).map((e) => [e.id, { '2026-10-06': '1' as DienstCode }]));
      return toets({ team, dates: ['2026-10-06'], cellen, behoefte: { '2026-10-06': { k: 7, lam, bron: 'basis' } }, wensen: [], beleid: B }).pijlers.klant;
    };
    expect(met(7).binnen24!).toBeGreaterThan(met(4).binnen24!);
    expect(met(7).binnen24!).toBeGreaterThan(0.9);
  });
});

describe('voorstel volgens het beleid', () => {
  const team = voorbeeldTeam('Utrecht', id);
  const behoefte = behoefteVoor({ norm: NORM_STANDAARD }, 'Utrecht', dates, { alphaRegio: B.alphaRegio, tegen: 'norm' });
  const uv = team.filter((e) => e.functie !== 'UL');
  const wensen: Wens[] = [
    { id: 'w1', medewerkerId: uv[0].id, regio: 'Utrecht', datum: '2026-10-07', soort: 'vrij', gemaakt: '' },
    { id: 'w2', medewerkerId: uv[1].id, regio: 'Utrecht', datum: '2026-10-08', soort: 'middag', gemaakt: '' },
  ];
  const verlof: Cellen = { [uv[2].id]: Object.fromEntries(isoRange('2026-10-12', '2026-10-16').map((d) => [d, 'V'])) };
  const w = voorstel({ team, dates, cellen: verlof, behoefte, wensen, beleid: B });
  const cellen = pasToe(verlof, w);
  const t = toets({ team, dates, cellen, behoefte, wensen, beleid: B });
  const items = (idr: string) => t.checks.find((c) => c.id === idr)?.items ?? [];

  it('het team volgt de formatie uit de vastgestelde regelplekken', () => {
    const fte = NORM_STANDAARD.regios.Utrecht.fte[0] * NORM_STANDAARD.urenPerFte;
    const uren = team.reduce((s, e) => s + e.contract, 0);
    expect(Math.abs(uren - fte)).toBeLessThanOrEqual(16);
    expect(team.some((e) => e.functie === 'UL')).toBe(true);
  });

  it('maakt een rooster zonder harde overtredingen met een voldoende', () => {
    expect(t.hard).toBe(0);
    expect(t.cijfer).toBeGreaterThanOrEqual(7.5);
  });

  it('plant precies de afgesproken plekken op (bijna) alle dagen', () => {
    expect(items('tekort').length).toBeLessThanOrEqual(2);
    expect(items('teveel').length).toBeLessThanOrEqual(2);
  });

  it('een 1B per dag, een middagdienst per dag, en de twee-regel', () => {
    expect(t.perDag.every((p) => p.b <= B.beschikbaarPerDag)).toBe(true);
    expect(items('middag').length).toBeLessThanOrEqual(1);
    expect(items('twee')).toEqual([]);
  });

  it('uitvaartleiders alleen op Dg en niemand boven het contract', () => {
    expect(items('functie')).toEqual([]);
    expect(items('contract')).toEqual([]);
  });

  it('geen Dg op zondag en geen weekend met meer dan 3 plekken', () => {
    expect(items('dgzondag')).toEqual([]);
    expect(items('weekendplekken')).toEqual([]);
  });

  it('raakt bestaande cellen (verlof) niet aan', () => {
    for (const d of isoRange('2026-10-12', '2026-10-16')) expect(cel(cellen, uv[2].id, d)).toBe('V');
    expect(w.some(([m, d]) => m === uv[2].id && verlof[uv[2].id][d])).toBe(false);
  });

  it('respecteert wensen waar dat kan', () => {
    expect(DIENSTEN[cel(cellen, uv[0].id, '2026-10-07')].werk).toBe(false);
    expect(['-', '1M', 'DG1', 'DG2', '1B']).toContain(cel(cellen, uv[1].id, '2026-10-08'));
  });

  it('roostert in het weekend alleen de werkende groep in', () => {
    for (const d of dates.filter((x) => isWeekend(toDay(x)))) {
      for (const e of team) if (DIENSTEN[cel(cellen, e.id, d)].werk) expect(werktWeekend(e, weekIndex(toDay(d)))).toBe(true);
    }
  });
});

describe('ruiltoets', () => {
  it('keurt een ruil af die een 7e dienst op rij oplevert', () => {
    const a = mw('Els'), b = mw('Femke');
    const cellen: Cellen = {
      [a.id]: { '2026-10-08': '1' },
      [b.id]: Object.fromEntries(isoRange('2026-10-02', '2026-10-07').map((d) => [d, 'DG2'])),
    };
    const r = ruilToets({ team: [a, b], cellen, wijzigingen: [[a.id, '2026-10-08', '-'], [b.id, '2026-10-08', '1']], beleid: B });
    expect(r.ok).toBe(false);
    expect(r.bevindingen[0].tekst).toContain('Femke');
  });

  it('meldt dalende dekking als een regeldienst vervalt', () => {
    const a = mw('Gerard'), b = mw('Hanneke');
    const cellen: Cellen = { [a.id]: { '2026-10-08': '1' } };
    const r = ruilToets({ team: [a, b], cellen, wijzigingen: [[a.id, '2026-10-08', '-'], [b.id, '2026-10-08', 'DG2']], beleid: B });
    expect(r.ok).toBe(true);
    expect(r.bevindingen.some((x) => x.soort === 'dekking')).toBe(true);
  });

  it('een uitvaartleider die een regeldienst overneemt is een aandachtspunt, geen harde fout', () => {
    const a = mw('Ilse'), b = mw('Jeroen', { functie: 'UL' });
    const cellen: Cellen = { [a.id]: { '2026-10-08': '1' } };
    const r = ruilToets({ team: [a, b], cellen, wijzigingen: [[a.id, '2026-10-08', '-'], [b.id, '2026-10-08', '1']], beleid: B });
    expect(r.ok).toBe(true);
    expect(r.bevindingen.some((x) => x.soort === 'beleid' && x.tekst.includes('uitvaartleider'))).toBe(true);
  });
});
