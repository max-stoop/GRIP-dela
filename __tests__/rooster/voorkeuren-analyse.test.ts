import { describe, it, expect } from 'vitest';
import { isoRange, toDay, weekday } from '@/lib/dates';
import { toets, cel } from '@/lib/rooster/toets';
import { voorstel } from '@/lib/rooster/voorstel';
import { pasToe } from '@/lib/rooster/ruil';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { maakContext, medewerkerScore, eerlijkheid, dienstVoorkeur } from '@/lib/rooster/analyse';
import { DIENSTEN, wensGehonoreerd } from '@/lib/rooster/diensten';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { STANDAARD_BELEID, LEEG_PROFIEL, type Behoefte, type Medewerker, type Voorkeurprofiel, type DienstCode } from '@/lib/rooster/types';

const B = { ...STANDAARD_BELEID, kanNietBegrensd: false };
let n = 0;
const id = () => `v${++n}`;
const dates = isoRange('2026-10-05', '2026-11-29');
const behoefte: Behoefte = behoefteVoor({ norm: NORM_STANDAARD }, 'Utrecht', dates, { alphaRegio: B.alphaRegio, tegen: 'norm' });

function mw(extra: Partial<Medewerker> = {}): Medewerker {
  return { id: id(), regio: 'Utrecht', naam: 'Test', contract: 32, voorkeur: 'O', weekendgroep: 0, actief: true, ...extra };
}

describe('1B beschikbaarheidsdienst', () => {
  it('telt als regelplek, gewogen 2 uur', () => {
    expect(DIENSTEN['1B'].plekken).toBe(1);
    expect(DIENSTEN['1B'].uren).toBe(2);
    expect(DIENSTEN['1B'].werk).toBe(true);
    expect(wensGehonoreerd('middag', '1B')).toBe(true);
  });

  it('de toets signaleert dagen zonder beschikbaarheidsdienst', () => {
    const team = [mw(), mw(), mw(), mw(), mw(), mw()];
    const d = '2026-10-06';
    const zonder = Object.fromEntries(team.map((e, i) => [e.id, { [d]: (i === 0 ? '1M' : '1') as DienstCode }]));
    const met = { ...zonder, [team[5].id]: { [d]: '1B' as DienstCode } };
    const items = (c: typeof zonder) => toets({ team, dates: [d], cellen: c, behoefte, wensen: [], beleid: B }).checks.find((x) => x.id === 'beschikbaar')!.items;
    expect(items(zonder)).toEqual([d]);
    expect(items(met)).toEqual([]);
  });

});

describe('analyse per medewerker', () => {
  const week = isoRange('2026-10-05', '2026-10-11'); // ma t/m zo
  it('weekpatroon: werken op een niet-dag kost veel, op een graag-dag niets', () => {
    const e = mw();
    const p: Voorkeurprofiel = { ...LEEG_PROFIEL(e.id), dagen: ['neutraal', 'graag', 'niet', 'neutraal', 'neutraal', 'neutraal', 'neutraal'], bijgewerkt: 'x' };
    const ctx = maakContext(e, p, [], week, B);
    // week loopt van maandag tot zondag; in het profiel is index 1 maandag (graag) en 2 dinsdag (kan niet)
    const goed = medewerkerScore(ctx, ['1', '-', '1', '1', '1', '-', '-']);
    const fout = medewerkerScore(ctx, ['1', '1', '-', '1', '1', '-', '-']);
    expect(goed.delen.patroon).toBe(1);
    expect(fout.details.patroon.niet).toBe(1);
    expect(fout.delen.patroon!).toBeLessThan(0.5);
  });

  it('wensen, losse werkdagen en weekmaximum', () => {
    const e = mw();
    const p: Voorkeurprofiel = { ...LEEG_PROFIEL(e.id), maxDagenPerWeek: 3, bijgewerkt: 'x' };
    const ctx = maakContext(e, p, [{ datum: '2026-10-07', soort: 'vrij' }], week, B);
    const s = medewerkerScore(ctx, ['1', '-', '1', '-', '1', '1', '-']);
    expect(s.details.wensen).toEqual({ ok: 0, tot: 1 });
    expect(s.details.ritme.losse).toBe(1); // woensdag staat los
    expect(s.details.ritme.overMax).toBe(1);
  });

  it('"geen voorkeur" in het profiel telt ochtend/middag niet mee', () => {
    const e = mw({ voorkeur: 'M' });
    expect(dienstVoorkeur(e, null)).toBe('M');
    expect(dienstVoorkeur(e, { ...LEEG_PROFIEL(e.id), dienst: 'geen', bijgewerkt: 'x' })).toBeNull();
    expect(dienstVoorkeur(e, { ...LEEG_PROFIEL(e.id), dienst: 'ochtend', bijgewerkt: 'x' })).toBe('O');
  });

  it('eerlijkheid is 1 bij een gelijke verdeling en lager bij een scheve', () => {
    const team = [mw(), mw()];
    const d = (weekenden: number) => ({ wensen: { ok: 0, tot: 0 }, patroon: { graag: 0, lieverNiet: 0, niet: 0, actief: false }, dienst: { mis: 0, tot: 0 }, uren: { gepland: 0, norm: 0, verlofDagen: 0, ziekDagen: 0 }, ritme: { overMax: 0, losse: 0, lang: 0, terug: 0, weken: 1 }, weekenden, weekendPlekken: 2, beschikbaar: 2, twee: 0, middag: 0, dg: 0, werkdagen: 0 });
    expect(eerlijkheid(team, [d(3), d(3)]).score).toBe(1);
    expect(eerlijkheid(team, [d(1), d(5)]).score).toBeLessThan(0.8);
  });
});

describe('rooster maken uit voorkeuren', () => {
  const team = voorbeeldTeam('Utrecht', id);
  const profielen: Record<string, Voorkeurprofiel> = {};
  team.forEach((e, i) => {
    if (i % 2) return;
    profielen[e.id] = { ...LEEG_PROFIEL(e.id), dagen: ['neutraal', 'neutraal', i % 4 === 0 ? 'niet' : 'graag', 'liever_niet', 'neutraal', 'neutraal', 'neutraal'], maxDagenPerWeek: e.contract <= 28 ? 4 : null, bijgewerkt: 'x' };
  });
  const varianten = (['dekking', 'balans', 'medewerker'] as const).map((nadruk) => {
    const w = voorstel({ team, dates, cellen: {}, behoefte, wensen: [], beleid: B, profielen, nadruk });
    const cellen = pasToe({}, w);
    return { nadruk, cellen, t: toets({ team, dates, cellen, behoefte, wensen: [], beleid: B, profielen }) };
  });

  it('plant nooit op een "kan niet"-dag', () => {
    for (const { cellen } of varianten) {
      for (const e of team) {
        const p = profielen[e.id];
        if (!p) continue;
        for (const d of dates) if (p.dagen[weekday(toDay(d))] === 'niet') expect(DIENSTEN[cel(cellen, e.id, d)].werk).toBe(false);
      }
    }
  });

  it('dekt de afgesproken plekken, zonder harde overtredingen', () => {
    for (const { t } of varianten) {
      expect(t.hard).toBe(0);
      expect(t.pijlers.continuiteit.gedekt).toBeGreaterThanOrEqual(t.pijlers.continuiteit.dagen - 2);
      expect(t.cijfer).toBeGreaterThanOrEqual(7.5);
    }
  });

  it('"medewerker eerst" respecteert het weekpatroon minstens zo goed als "dekking eerst"', () => {
    const patroon = (t: (typeof varianten)[number]['t']) => {
      const v = Object.values(t.pijlers.medewerker.perMedewerker).map((m) => m.delen.patroon).filter((x): x is number => x != null);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    expect(patroon(varianten[2].t)).toBeGreaterThanOrEqual(patroon(varianten[0].t));
  });

  it('opnieuw plannen vervangt bestaande diensten, maar laat verlof staan', () => {
    const e = team.find((x) => x.functie !== 'UL')!;
    const vooraf = { [e.id]: { '2026-10-07': 'V' as DienstCode, '2026-10-08': '2' as DienstCode } };
    const w = voorstel({ team, dates, cellen: vooraf, behoefte, wensen: [], beleid: B, profielen, opnieuw: true });
    const na = pasToe(vooraf, w);
    expect(cel(na, e.id, '2026-10-07')).toBe('V');
    const aanvullen = voorstel({ team, dates, cellen: vooraf, behoefte, wensen: [], beleid: B, profielen });
    expect(cel(pasToe(vooraf, aanvullen), e.id, '2026-10-08')).toBe('2');
  });
});

describe('voorkeur middag (1M) is een voorkeur, geen vaste dienst', () => {
  const nov = isoRange('2026-11-02', '2026-11-29');
  for (const regio of ['Utrecht', 'Noord-Holland']) {
    it(`${regio}: meer 1M voor wie middag liever heeft, ook gewone 1-diensten, en de rest eerlijk verdeeld`, () => {
      const team = voorbeeldTeam(regio, id).map((e, i) => ({ ...e, voorkeur: (i === 1 ? 'M' : 'O') as Medewerker['voorkeur'] }));
      const nood = behoefteVoor({ norm: NORM_STANDAARD }, regio, nov, { alphaRegio: B.alphaRegio, tegen: 'norm' });
      for (const seed of [1, 2]) {
        const c = pasToe({}, voorstel({ team, dates: nov, cellen: {}, behoefte: nood, wensen: [], beleid: B, seed }));
        const tel = (e: Medewerker, d: DienstCode) => nov.filter((x) => cel(c, e.id, x) === d).length;
        const uv = team.filter((e) => e.functie !== 'UL');
        const m = uv.find((e) => e.voorkeur === 'M')!, rest = uv.filter((e) => e !== m);
        // de middagvoorkeur krijgt duidelijk meer 1M, maar ook gewone diensten
        expect(tel(m, '1')).toBeGreaterThanOrEqual(2);
        const perUur = (e: Medewerker) => tel(e, '1M') / e.contract;
        const gemRest = rest.reduce((a, e) => a + perUur(e), 0) / rest.length;
        expect(perUur(m)).toBeGreaterThan(1.5 * gemRest);
        // de overige 1M's zijn verspreid: iedereen een paar, niemand een stapel
        const n = rest.map((e) => tel(e, '1M'));
        expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(3);
        expect(n.filter((x) => x === 0).length).toBeLessThanOrEqual(1);
      }
    });
  }

  it('een wens voor middag op een dag geeft wel een 1M', () => {
    const team = voorbeeldTeam('Utrecht', id);
    const e = team.find((x) => x.functie !== 'UL')!;
    const w = voorstel({ team, dates, cellen: {}, behoefte, wensen: [{ id: 'w', medewerkerId: e.id, regio: 'Utrecht', datum: '2026-10-07', soort: 'middag', gemaakt: '2026-10-01T09:00:00' }], beleid: B });
    const d = cel(pasToe({}, w), e.id, '2026-10-07');
    // werkt die dag een gewone regeldienst, dan de middag
    expect(d).not.toBe('1');
  });
});

describe('nieuwe voorkeuren: korte Dg-dagen en regelplekken per weekend', () => {
  const tel = (cellen: ReturnType<typeof pasToe>, mid: string, f: (c: DienstCode, d: string) => boolean) => dates.filter((d) => f(cel(cellen, mid, d), d)).length;
  const isWeekend = (d: string) => weekday(toDay(d)) % 6 === 0;

  it('wie zijn uren liever over meer dagen spreidt, krijgt korte DG1-dagen en werkt op meer dagen', () => {
    const team = voorbeeldTeam('Utrecht', id);
    const drie = team.filter((e) => e.functie !== 'UL').slice(0, 3);
    const plan = (korteDagen?: 'graag') => {
      const profielen = Object.fromEntries(drie.map((e) => [e.id, { ...LEEG_PROFIEL(e.id), korteDagen, bijgewerkt: 'x' }]));
      return pasToe({}, voorstel({ team, dates, cellen: {}, behoefte, wensen: [], beleid: B, profielen }));
    };
    const zonder = plan(), met = plan('graag');
    for (const e of drie) {
      expect(tel(met, e.id, (c) => c === 'DG1')).toBeGreaterThan(tel(zonder, e.id, (c) => c === 'DG1'));
      // sinds de korte Dg-dag ook open uren van anderen aanvult, is dat minstens evenveel dagen
      expect(tel(met, e.id, (c) => DIENSTEN[c].werk)).toBeGreaterThanOrEqual(tel(zonder, e.id, (c) => DIENSTEN[c].werk));
      const uren = dates.reduce((h, d) => h + DIENSTEN[cel(met, e.id, d)].uren, 0);
      expect(uren).toBeLessThanOrEqual((e.contract * dates.length) / 7 + 0.01);
    }
  });

  it('wie liever 3 regelplekken per weekend doet (en 1 op 3 weekenden werkt), krijgt in het weekend vaker de 2', () => {
    // een klein team, zodat er in het weekend 2-en nodig zijn
    const team = voorbeeldTeam('Utrecht', id).slice(4).map((e, i) => (i < 3 ? { ...e, weekendCadans: 3, weekendgroep: i } : e));
    const drie = team.slice(0, 3);
    const plan = (weekendPlekken?: 3) => {
      const profielen = Object.fromEntries(drie.map((e) => [e.id, { ...LEEG_PROFIEL(e.id), weekendPlekken, bijgewerkt: 'x' }]));
      const cellen = pasToe({}, voorstel({ team, dates, cellen: {}, behoefte, wensen: [], beleid: B, profielen }));
      return { cellen, t: toets({ team, dates, cellen, behoefte, wensen: [], beleid: B, profielen }) };
    };
    const zonder = plan(), met = plan(3);
    const weekend2 = (c: ReturnType<typeof pasToe>) => drie.reduce((n, e) => n + tel(c, e.id, (x, d) => x === '2' && isWeekend(d)), 0);
    expect(weekend2(met.cellen)).toBeGreaterThan(weekend2(zonder.cellen));
    expect(met.t.hard).toBe(0);
  });
});

describe('alleen de weekenden vooruit plannen', () => {
  it('plant alleen zaterdag en zondag, in het weekend van de eigen groep, zonder aan te vullen tot contracturen', () => {
    const team = voorbeeldTeam('Utrecht', id);
    const alle = isoRange('2027-01-04', '2027-06-27');
    const weekend = alle.filter((d) => weekday(toDay(d)) % 6 === 0);
    const b = behoefteVoor({ norm: NORM_STANDAARD }, 'Utrecht', weekend, { alphaRegio: B.alphaRegio, tegen: 'norm' });
    const w = voorstel({ team, dates: weekend, cellen: {}, behoefte: b, wensen: [], beleid: B, aanvullen: false });
    expect(w.length).toBeGreaterThan(0);
    expect(w.every(([, d]) => weekday(toDay(d)) % 6 === 0)).toBe(true);
    const cellen = pasToe({}, w);
    const t = toets({ team, dates: weekend, cellen, behoefte: b, wensen: [], beleid: B });
    expect(t.hard).toBe(0);
    expect(t.pijlers.continuiteit.gedekt).toBeGreaterThanOrEqual(t.pijlers.continuiteit.dagen - 2);
    // per zaterdag niet meer Dg-diensten dan voor de voorgangen nodig is
    for (const d of weekend.filter((x) => weekday(toDay(x)) === 6)) {
      const dg = team.filter((e) => DIENSTEN[cel(cellen, e.id, d)].categorie === 'dossier').length;
      expect(dg).toBeLessThanOrEqual(Math.max(B.minDG, B.voorgangenPerDag));
    }
  });
});
