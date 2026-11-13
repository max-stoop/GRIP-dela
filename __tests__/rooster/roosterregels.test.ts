/**
 * Waar Rooster maken rekening mee houdt, nagelopen op echte voorstellen: in een aantal regio's, met een volledig en
 * een te klein team, met verlof, ziekte, aangevraagd verlof, wensen, vaste voorkeuren en een overige dienst.
 */
import { describe, it, expect } from 'vitest';
import { addDays, isoRange, isWeekend, toDay, weekday } from '@/lib/dates';
import { maakRooster } from '@/lib/rooster/maak';
import { pasToe } from '@/lib/rooster/ruil';
import { toets, cel } from '@/lib/rooster/toets';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { DIENSTEN, isEnkel } from '@/lib/rooster/diensten';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { rng } from '@/lib/model/demo';
import { REGIONS } from '@/lib/model/config';
import { STANDAARD_BELEID, LEEG_PROFIEL, beleidVoor, type Cellen, type DagVoorkeur, type DienstCode, type Medewerker, type Voorkeurprofiel, type Wens } from '@/lib/rooster/types';

const dates = isoRange('2027-03-01', '2027-03-28');
const som = (a: number[]) => a.reduce((x, y) => x + y, 0);

function geval(regio: string, klein: boolean) {
  const B = { ...beleidVoor(STANDAARD_BELEID, regio, NORM_STANDAARD), kanNietBegrensd: false };
  let n = 0;
  const alle = voorbeeldTeam(regio, () => `${regio}-${++n}`).filter((m) => !m.extern);
  const team = klein ? alle.slice(Math.ceil(alle.length * 0.25)) : alle;
  const behoefte = behoefteVoor({ norm: NORM_STANDAARD }, regio, dates, { alphaRegio: B.alphaRegio, tegen: 'norm' });
  const R = rng(regio.length * 7 + team.length);
  const profielen: Record<string, Voorkeurprofiel> = {};
  for (const m of team) profielen[m.id] = { ...LEEG_PROFIEL(m.id), dagen: Array.from({ length: 7 }, () => { const u = R.uniform(); return (u < 0.7 ? 'neutraal' : u < 0.82 ? 'graag' : u < 0.94 ? 'liever_niet' : 'niet') as DagVoorkeur; }), twee: R.uniform() < 0.15 ? 'niet' : 'neutraal', bijgewerkt: 'x' };
  const uv = team.filter((m) => (m.functie ?? 'UV') === 'UV');
  const start: Cellen = { [uv[0].id]: Object.fromEntries(isoRange('2027-03-08', '2027-03-14').map((d) => [d, 'V' as DienstCode])), [uv[1].id]: { '2027-03-16': 'Z', '2027-03-17': 'Z' } };
  const aanvragen = [{ medewerkerId: uv[2].id, van: '2027-03-22', tot: '2027-03-26' }];
  const wensen: Wens[] = [{ id: 'o', medewerkerId: uv[4].id, regio, datum: '2027-03-10', soort: 'overig4', gemaakt: '' }];
  const r = maakRooster({ team, dates, cellen: start, behoefte, wensen, profielen, beleid: B, opnieuw: true, aanvragen, pogingen: 2 });
  return { B, team, uv, behoefte, profielen, aanvragen, r, c: pasToe(start, r.wijzigingen) };
}

describe.each(REGIONS.filter((_, i) => i % 5 === 0).flatMap((regio) => [[regio, false], [regio, true]] as [string, boolean][]))('de regels van het roostervoorstel: %s, te klein team: %s', (regio, klein) => {
  const { B, team, uv, behoefte, profielen, aanvragen, r, c } = geval(regio, klein);
  const code = (m: Medewerker, d: string) => cel(c, m.id, d);

  it('geen overtreding van ATW of CAO, en wat vaststond staat er nog', () => {
    expect(r.toets.hard).toBe(0);
    for (const d of isoRange('2027-03-08', '2027-03-14')) expect(code(uv[0], d)).toBe('V');
    expect(code(uv[1], '2027-03-16')).toBe('Z');
    expect(code(uv[4], '2027-03-10')).toBe('O4');
  });

  it('de regelplekken: nooit meer dan afgesproken, altijd een middagdienst, en bij een volledig team geen lege plek', () => {
    for (const d of dates) {
      const codes = team.map((m) => code(m, d)), pl = som(codes.map((x) => DIENSTEN[x].plekken)), k = behoefte[d]!.k;
      expect(pl).toBeLessThanOrEqual(k);
      if (!klein) expect(pl).toBe(k);
      expect(codes.filter((x) => x === '1M').length).toBeGreaterThanOrEqual(B.minMiddag);
      const twee = codes.filter((x) => x === '2').length;
      expect(twee).toBeLessThanOrEqual(B.maxTwee);
      if (twee) expect(codes.filter(isEnkel).length).toBeGreaterThanOrEqual(B.minEnkelBijTwee);
      if (weekday(toDay(d)) === 0) expect(codes.filter((x) => DIENSTEN[x].categorie === 'dossier')).toEqual([]);
      expect(som(codes.map((x) => DIENSTEN[x].voorgangen))).toBeLessThanOrEqual(Math.max(B.voorgangenPerDag * 2, B.minDG * 2));
    }
    // een te klein team: hoogstens een enkele plek open, en dan met de reden erbij
    expect(som(r.tekorten.map((t) => t.tekort))).toBeLessThanOrEqual(3);
  });

  it('per medewerker: functie, kan niet, de 2, dagen achter elkaar, de 1B en de uren', () => {
    for (const m of team) {
      const p = profielen[m.id];
      let reeks = 0;
      for (const d of isoRange(dates[0], addDays(dates[dates.length - 1], 7))) {
        const x = code(m, d);
        reeks = DIENSTEN[x].werk ? reeks + 1 : 0;
        expect(reeks).toBeLessThanOrEqual(B.maxAchtereen);
        if (!DIENSTEN[x].werk) continue;
        if (m.functie === 'UL') expect(DIENSTEN[x].plekken).toBe(0);
        // een overige dienst die de medewerker zelf opgaf, staat er ook op een dag die anders niet kan
        if (DIENSTEN[x].categorie !== 'overig') expect(p.dagen[weekday(toDay(d))]).not.toBe('niet');
        if (p.twee === 'niet') expect(x).not.toBe('2');
        // een volledig team heeft niemand nodig die verlof heeft aangevraagd
        if (!klein) expect(aanvragen.some((a) => a.medewerkerId === m.id && a.van <= d && a.tot >= d)).toBe(false);
      }
      expect(dates.filter((d) => code(m, d) === '1B').length).toBeLessThanOrEqual(B.maxBeschikbaarPer28);
      // over de periode hoogstens 15% boven contract
      const weg = dates.filter((d) => (code(m, d) === 'V' && !isWeekend(toDay(d))) || code(m, d) === 'Z').length;
      expect(som(dates.map((d) => DIENSTEN[code(m, d)].uren))).toBeLessThanOrEqual(((m.contract * 28) / 7 - (weg * m.contract) / 5) * 1.15 + 0.01);
    }
  });
});

describe('de toets en uren boven contract', () => {
  const B = { ...STANDAARD_BELEID, kanNietBegrensd: false };
  const m: Medewerker = { id: 'a', regio: 'Utrecht', naam: 'A', contract: 28, voorkeur: 'O', weekendgroep: 0, actief: true };
  const behoefte = Object.fromEntries(dates.map((d) => [d, null]));
  const week = (n: number, diensten: number): Record<string, DienstCode> => Object.fromEntries(Array.from({ length: diensten }, (_, i) => [addDays(dates[0], n * 7 + i), 'DG2' as DienstCode]));
  const contract = (cellen: Cellen, beleid = B) => toets({ team: [m], dates, cellen, behoefte, wensen: [], beleid }).checks.find((x) => x.id === 'contract')!.items.length;

  it('boven contract mag, tot 15% over de periode (28 uur wordt 32)', () => {
    // drie weken 24 uur en één week 32: binnen de grens
    expect(contract({ a: { ...week(0, 4), ...week(1, 3), ...week(2, 3), ...week(3, 3) } })).toBe(0);
    // vier weken 32 uur is 128 uur op 112: net binnen de 15%
    expect(contract({ a: { ...week(0, 4), ...week(1, 4), ...week(2, 4), ...week(3, 4) } })).toBe(0);
    // één week 40 uur en verder weinig: over de periode nog binnen de grens, er is geen aparte grens per week
    expect(contract({ a: { ...week(0, 5), ...week(1, 3) } })).toBe(0);
    // vier weken 40 uur is 160 uur op 112: elke week is een afwijking
    expect(contract({ a: { ...week(0, 5), ...week(1, 5), ...week(2, 5), ...week(3, 5) } })).toBe(4);
    // staat de grens uit, dan is elke week boven contract een afwijking
    expect(contract({ a: { ...week(0, 4), ...week(1, 3) } }, { ...B, bovenContractPct: 0 })).toBe(1);
  });
});
