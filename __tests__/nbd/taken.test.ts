import { describe, expect, it } from 'vitest';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { NBD, NBD_STANDAARD } from '@/lib/nbd/parameters';
import { nbdBehoefte } from '@/lib/nbd/behoefte';
import { aanTelefoon, maakDienst, naarTijd, netto, pastTaak, pauzeBuitenTaken, takenMeldingen, uitTijd, type NbdDienst } from '@/lib/nbd/dienst';
import { nbdDienst, weekVan } from '@/lib/nbd/blokken';
import { alBijMaandstart, behoudTaken, inBlokken, klachtenStandaard, planTaken, takenOverzicht, takenWeg, trainingStandaard, zoekMaandstart } from '@/lib/nbd/taken';
import { nbdNa } from '@/lib/nbd/ruil';
import { maakNbdRooster, type NbdWijziging } from '@/lib/nbd/voorstel';
import { dekking, toetsNbd } from '@/lib/nbd/toets';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { isoRange, toDay, weekday } from '@/lib/dates';
import type { Cellen, Tijden } from '@/lib/rooster/types';

const P = NBD_STANDAARD;
let n = 0;
const maakId = () => `t${++n}`;

function pasToe(cellen: Cellen, tijden: Tijden, w: NbdWijziging[]) {
  for (const [mid, d, code, x] of w) {
    (cellen[mid] ??= {})[d] = code;
    if (code === 'N' && x) (tijden[mid] ??= {})[d] = naarTijd(x);
  }
}

describe('een taak in de dienst: niet aan de telefoon, wel werktijd', () => {
  const x: NbdDienst = { ...maakDienst(P, 9, 8), pauzeStart: 13 };
  const k = { soort: 'training' as const, van: 10, tot: 11 };

  it('telt als werktijd maar haalt de medewerker van de telefoon', () => {
    const y: NbdDienst = { ...x, taken: [k] };
    expect(netto(y)).toBe(netto(x));
    expect(aanTelefoon(y, 10.5)).toBe(false);
    expect(aanTelefoon(y, 11)).toBe(true);
    expect(dekking(P, [y]).reduce((a, v) => a + v, 0)).toBe(dekking(P, [x]).reduce((a, v) => a + v, 0) - 4);
  });

  it('past alleen binnen de dienst, buiten de pauze en niet over een andere taak', () => {
    expect(pastTaak(x, k)).toBe(true);
    expect(pastTaak(x, { ...k, van: 8.5, tot: 9.5 })).toBe(false);
    expect(pastTaak(x, { ...k, van: 12.75, tot: 13.25 })).toBe(false);
    expect(pastTaak({ ...x, taken: [k] }, { soort: 'klachten', van: 10.5, tot: 11.5 })).toBe(false);
    expect(takenMeldingen({ ...x, taken: [{ soort: 'klachten', van: 13, tot: 14 }] })).toEqual(['Klachten 13:00–14:00 valt in de pauze of over een andere taak.']);
  });

  it('blijft bewaard via de opslag', () => {
    const y: NbdDienst = { ...x, taken: [k, { soort: 'klachten', van: 15, tot: 16 }] };
    expect(uitTijd(naarTijd(y))).toEqual(y);
  });

  it('blokken van hoogstens een uur, op een kwartier', () => {
    expect(inBlokken(0.5, 1)).toEqual([0.5]);
    expect(inBlokken(2.5, 1)).toEqual([1, 1, 0.5]);
    expect(inBlokken(0.1, 1)).toEqual([]);
  });
});

describe('training en klachten inplannen op de rustigste momenten', () => {
  const team = voorbeeldTeam(NBD, maakId);
  const dates = isoRange('2026-11-02', '2026-11-29');
  const behoefte = nbdBehoefte({ norm: NORM_STANDAARD }, P, dates, 'norm');
  const v = maakNbdRooster({ team, dates, cellen: {}, tijden: {}, behoefte, p: P, modus: 'opnieuw', minVrijeWeekenden: 0, totContract: false });
  const cellen: Cellen = {}, tijden: Tijden = {};
  pasToe(cellen, tijden, v.wijzigingen);
  const basis = { team, dates, cellen, tijden, behoefte, p: P };
  const plan = planTaken({ ...basis, training: trainingStandaard(P), klachten: { ...klachtenStandaard(P), uren: 6 } });

  it('elke medewerker met diensten op werkdagen krijgt een half uur training per week, binnen kantoortijd', () => {
    const per = new Map<string, number>();
    for (const g of plan.geplaatst.filter((x) => x.soort === 'training')) {
      const w = `${g.mid}|${weekVan(g.datum)}`;
      per.set(w, (per.get(w) ?? 0) + g.taak.tot - g.taak.van);
      expect(g.taak.van).toBeGreaterThanOrEqual(9);
      expect(g.taak.tot).toBeLessThanOrEqual(17);
      expect([1, 2, 3, 4, 5]).toContain(weekday(toDay(g.datum)));
    }
    expect(per.size).toBeGreaterThan(team.length * 3);
    for (const u of per.values()) expect(u).toBe(0.5);
    // wie niet lukt, staat in de lijst (geen dienst op een werkdag)
    for (const x of plan.nietGelukt) expect(x.soort).toBe('training');
  });

  it('klachten: 6 uur per week voor het team, verdeeld over de dagen', () => {
    const kl = plan.geplaatst.filter((x) => x.soort === 'klachten');
    const perWeek = new Map<number, number>();
    for (const g of kl) perWeek.set(weekVan(g.datum), (perWeek.get(weekVan(g.datum)) ?? 0) + g.taak.tot - g.taak.van);
    expect([...perWeek.values()]).toEqual([6, 6, 6, 6]);
    // eerst waar het de desk het minst kost, dan zo veel mogelijk verspreid over de dagen en de mensen
    expect(new Set(kl.map((g) => g.datum)).size).toBeGreaterThanOrEqual(12);
    expect(new Set(kl.map((g) => g.mid)).size).toBeGreaterThan(5);
  });

  it('de taken passen in de diensten en kosten zo min mogelijk aan de telefoon', () => {
    for (const [, , code, x] of plan.wijzigingen) {
      expect(code).toBe('N');
      expect(takenMeldingen(x!)).toEqual([]);
    }
    // de meeste blokken vallen waar zonder de medewerker nog genoeg mensen aan de telefoon zitten
    expect(plan.geplaatst.filter((g) => g.kost === 0).length / plan.geplaatst.length).toBeGreaterThan(0.6);
    expect(plan.slNa).toBeLessThanOrEqual(plan.slVoor + 1e-9);
    expect(plan.slVoor - plan.slNa).toBeLessThan(0.02);
    // de werktijd verandert niet: de toets geeft dezelfde uren
    const c2 = structuredClone(cellen), t2 = structuredClone(tijden);
    pasToe(c2, t2, plan.wijzigingen);
    const voor = toetsNbd({ team, dates, cellen, tijden, behoefte, p: P }), na = toetsNbd({ team, dates, cellen: c2, tijden: t2, behoefte, p: P });
    for (const m of team) expect(na.perMedewerker[m.id].uren).toBeCloseTo(voor.perMedewerker[m.id].uren, 6);
    expect(na.perDag.reduce((a, d) => a + d.geplandUren, 0)).toBeLessThan(voor.perDag.reduce((a, d) => a + d.geplandUren, 0));
  });

  it('opnieuw draaien vult alleen aan; weghalen haalt alleen die soort weg', () => {
    const c2 = structuredClone(cellen), t2 = structuredClone(tijden);
    pasToe(c2, t2, plan.wijzigingen);
    const nog = planTaken({ ...basis, cellen: c2, tijden: t2, training: trainingStandaard(P), klachten: { ...klachtenStandaard(P), uren: 6 } });
    expect(nog.geplaatst).toEqual([]);
    const o = takenOverzicht({ team, dates, cellen: c2, tijden: t2 });
    expect(o.klachten.uren).toBe(24);
    const weg = takenWeg({ team, dates, cellen: c2, tijden: t2 }, ['klachten']);
    pasToe(c2, t2, weg);
    const o2 = takenOverzicht({ team, dates, cellen: c2, tijden: t2 });
    expect(o2.klachten.uren).toBe(0);
    expect(o2.training.uren).toBe(o.training.uren);
  });

  it('klachten alleen bij wie ze behandelt', () => {
    const wie = team.slice(0, 4).map((m) => m.id);
    const p2 = planTaken({ ...basis, klachten: { ...klachtenStandaard(P), uren: 4, wie } });
    expect(p2.geplaatst.length).toBeGreaterThan(0);
    for (const g of p2.geplaatst) expect(wie).toContain(g.mid);
  });
});

describe('maandstart in drie groepen', () => {
  const team = voorbeeldTeam(NBD, maakId);
  const dates = isoRange('2026-12-01', '2026-12-31');
  const behoefte = nbdBehoefte({ norm: NORM_STANDAARD }, P, dates, 'norm');
  const v = maakNbdRooster({ team, dates, cellen: {}, tijden: {}, behoefte, p: P, modus: 'opnieuw', minVrijeWeekenden: 0, totContract: false });
  const cellen: Cellen = {}, tijden: Tijden = {};
  pasToe(cellen, tijden, v.wijzigingen);
  const dagen = dates.slice(0, 7);
  const plan = zoekMaandstart({ team, dagen, cellen, tijden, behoefte, p: P, duur: 1, groepen: 3, van: 8, tot: 20 });
  const metDienst = team.filter((m) => dagen.some((d) => nbdDienst(cellen, tijden, m.id, d)));

  it('iedereen zit in precies één groep; wie anders niet kan, krijgt een verschoven dienst', () => {
    expect(plan.groepen).toHaveLength(3);
    const alle = plan.groepen.flatMap((g) => g.leden);
    expect(new Set(alle).size).toBe(alle.length);
    expect(alle.length + plan.zonder.length).toBe(team.length);
    expect(alle.length).toBeGreaterThanOrEqual(metDienst.length - 2);
    // zonder verschuiven passen er minder mensen in drie groepen
    const zonder = zoekMaandstart({ team, dagen, cellen, tijden, behoefte, p: P, duur: 1, groepen: 3, van: 8, tot: 20, verschuiven: false });
    expect(zonder.verschoven).toEqual([]);
    expect(zonder.groepen.flatMap((g) => g.leden).length).toBeLessThan(alle.length);
    expect(plan.verschoven.length).toBe(alle.length - zonder.groepen.flatMap((g) => g.leden).length);
    // een verschoven dienst houdt dezelfde lengte en pauze, en de maandstart past erin
    for (const v of plan.verschoven) {
      expect(netto(v.wordt)).toBe(netto(v.was));
      expect(v.wordt.pauze).toBe(v.was.pauze);
      const g = plan.groepen.find((x) => x.leden.includes(v.mid))!;
      expect(g.datum).toBe(v.datum);
      expect(pastTaak(v.wordt, { soort: 'maandstart', van: g.van, tot: g.tot })).toBe(true);
    }
  });

  it('elke groep zit binnen de diensten, buiten de pauzes, binnen het venster', () => {
    const c2 = structuredClone(cellen), t2 = structuredClone(tijden);
    pasToe(c2, t2, plan.wijzigingen);
    for (const g of plan.groepen) {
      expect(g.van).toBeGreaterThanOrEqual(8);
      expect(g.tot).toBeLessThanOrEqual(20);
      expect(g.tot - g.van).toBe(1);
      for (const mid of g.leden) {
        const x = nbdDienst(c2, t2, mid, g.datum)!;
        expect(x.taken).toContainEqual({ soort: 'maandstart', van: g.van, tot: g.tot });
        expect(takenMeldingen(x)).toEqual([]);
      }
      expect(g.slNa).toBeLessThanOrEqual(g.slVoor + 1e-9);
    }
    // de groepen zijn ongeveer even groot
    const n = plan.groepen.map((g) => g.leden.length);
    expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(Math.ceil(team.length / 3));
  });

  it('ingepland: iedereen is geweest, en een tweede zoektocht laat hen weg', () => {
    const c2 = structuredClone(cellen), t2 = structuredClone(tijden);
    pasToe(c2, t2, plan.wijzigingen);
    const al = alBijMaandstart({ team, cellen: c2, tijden: t2 }, dates);
    expect(al.length).toBe(plan.groepen.reduce((a, g) => a + g.leden.length, 0));
    const nog = zoekMaandstart({ team, dagen, cellen: c2, tijden: t2, behoefte, p: P, duur: 1, groepen: 3, van: 8, tot: 20, al });
    expect(nog.groepen.flatMap((g) => g.leden)).toEqual([]);
  });
});

describe('opnieuw roosteren: de taken gaan mee', () => {
  const team = voorbeeldTeam(NBD, maakId);
  const dates = isoRange('2027-02-01', '2027-02-28');
  const behoefte = nbdBehoefte({ norm: NORM_STANDAARD }, P, dates, 'norm');
  const v = maakNbdRooster({ team, dates, cellen: {}, tijden: {}, behoefte, p: P, modus: 'opnieuw', minVrijeWeekenden: 0, totContract: false });
  let na = nbdNa({}, {}, v.wijzigingen);
  na = nbdNa(na.cellen, na.tijden, zoekMaandstart({ team, dagen: dates.slice(0, 7), cellen: na.cellen, tijden: na.tijden, behoefte, p: P, duur: 1, groepen: 3, van: 8, tot: 20 }).wijzigingen);
  na = nbdNa(na.cellen, na.tijden, planTaken({ team, dates, cellen: na.cellen, tijden: na.tijden, behoefte, p: P, training: trainingStandaard(P) }).wijzigingen);
  const telMaandstart = (c: Cellen, t: Tijden) => team.filter((m) => dates.some((d) => nbdDienst(c, t, m.id, d)?.taken?.some((k) => k.soort === 'maandstart'))).length;
  const voor = telMaandstart(na.cellen, na.tijden);

  it('een drukkere voorspelling: na opnieuw plannen houdt (bijna) iedereen zijn maandstart', () => {
    const drukker = Object.fromEntries(Object.entries(behoefte).map(([d, x]) => [d, { ...x, kwartieren: x.kwartieren.map((k) => ({ ...k, nodig: k.nodig + 1 })) }]));
    const w = maakNbdRooster({ team, dates, cellen: na.cellen, tijden: na.tijden, behoefte: drukker, p: P, modus: 'opnieuw', minVrijeWeekenden: 0, totContract: false });
    const nieuw = nbdNa(na.cellen, na.tijden, w.wijzigingen);
    const zonder = telMaandstart(nieuw.cellen, nieuw.tijden);
    const b = behoudTaken({ team, dates, oudCellen: na.cellen, oudTijden: na.tijden, cellen: nieuw.cellen, tijden: nieuw.tijden });
    const met = nbdNa(nieuw.cellen, nieuw.tijden, b.wijzigingen);
    const na2 = telMaandstart(met.cellen, met.tijden);
    expect(voor).toBeGreaterThan(25);
    expect(na2).toBeGreaterThan(zonder);
    expect(na2 + new Set(b.kwijt.filter((x) => x.taak.soort === 'maandstart').map((x) => x.mid)).size).toBeGreaterThanOrEqual(voor);
    // alles past, en niemand heeft twee keer een maandstart
    for (const m of team) {
      let n = 0;
      for (const d of dates) {
        const x = nbdDienst(met.cellen, met.tijden, m.id, d);
        if (!x) continue;
        expect(takenMeldingen(x)).toEqual([]);
        n += (x.taken ?? []).filter((k) => k.soort === 'maandstart').length;
      }
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('de pauze gaat opzij voor een taak, niet in het eerste of laatste uur', () => {
    const x: NbdDienst = { ...maakDienst(P, 9, 8), taken: [{ soort: 'maandstart', van: 13, tot: 14 }] };
    const y = pauzeBuitenTaken(x)!;
    expect(takenMeldingen(y)).toEqual([]);
    expect(y.pauzeStart!).toBeGreaterThanOrEqual(10);
    expect(y.pauzeStart! + 0.5).toBeLessThanOrEqual(16.5);
  });
});

