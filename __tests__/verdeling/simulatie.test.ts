// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { laadPostcodes, schatReistijd } from '@/lib/verdeling/geo';
import { belastingUitRooster, dienstenUitNorm, postcodesPerRegio, reeksVoor, simulatie } from '@/lib/verdeling/invoer';
import { dichtstbij, kengetallen, verdeel } from '@/lib/verdeling/verdeel';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { plekkenNorm } from '@/lib/capaciteit/norm';
import { spelingOpDag } from '@/lib/capaciteit/beschikbaarheid';
import { CLUSTERS, REGIONS } from '@/lib/model/config';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { addDays, toDay, weekdayMon } from '@/lib/dates';
import { normWeek } from '@/lib/capaciteit/norm';
import type { Cellen } from '@/lib/rooster/types';

const DATUM = '2026-10-13';

describe('van rooster naar regelplekken', () => {
  it('vult een regio zonder rooster met 1B, minstens één 1M en een 2 bij veel plekken', () => {
    expect(dienstenUitNorm(1, 1)).toEqual(['1B']);
    expect(dienstenUitNorm(3, 1)).toEqual(['1B', '1M', '1']);
    const veel = dienstenUitNorm(9, 1);
    expect(veel.filter((c) => c === '2')).toHaveLength(1);
    expect(veel.reduce((s, c) => s + (c === '2' ? 2 : 1), 0)).toBe(9);
  });

  it('telt dagen achter elkaar en recente belasting uit het rooster', () => {
    const c: Cellen = { a: { [addDays(DATUM, -1)]: '1', [addDays(DATUM, -2)]: '2', [addDays(DATUM, -3)]: '-', [addDays(DATUM, -4)]: '1M' } };
    expect(reeksVoor(c, 'a', DATUM)).toBe(2);
    // gisteren 1 plek, eergisteren 2, vier dagen terug 1, met afnemend gewicht
    const b = belastingUitRooster(c, 'a', DATUM, 1, 4);
    expect(b).toBeCloseTo(1 + 2 * 0.5 ** 0.25 + 0.5 ** 0.75, 6);
  });

  it('elk postcodegebied hoort bij een regio, en elke regio heeft gebieden', async () => {
    const t = await laadPostcodes();
    const p = postcodesPerRegio(t);
    expect([...p.values()].reduce((s, l) => s + l.length, 0)).toBe(t.size);
    for (const r of REGIONS) expect(p.get(r)!.length).toBeGreaterThan(20);
    expect(p.get('Utrecht')).toContain('3511');
    expect(p.get('Amsterdam')).toContain('1012');
  });
});

describe('simulatie van een landelijke dag', () => {
  it('zonder roosters: alle regio\'s uit de norm, met de clusterspeling erbij', async () => {
    const tabel = await laadPostcodes();
    const s = simulatie({ datum: DATUM, normen: NORM_STANDAARD, tabel, medewerkers: [], rooster: {}, seed: 3 });
    expect(s.aangevuld).toHaveLength(REGIONS.length);
    expect(s.echt).toEqual([]);
    const week = normWeek(DATUM), dag = weekdayMon(toDay(DATUM));
    const plekken = REGIONS.reduce((t, r) => t + plekkenNorm(NORM_STANDAARD, r, DATUM)!, 0)
      + Object.keys(CLUSTERS).reduce((t, c) => t + spelingOpDag(NORM_STANDAARD, c, week, dag), 0);
    expect(s.invoer.personen.reduce((t, p) => t + p.slots.length, 0)).toBe(plekken);
    expect(s.invoer.personen.every((p) => p.fictief)).toBe(true);
    expect(s.invoer.meldingen.length).toBeGreaterThan(20);
    for (const m of s.invoer.meldingen) {
      expect(m.uiterlijk).toBeGreaterThanOrEqual(12 * 60);
      expect(m.ontvangen.startsWith(addDays(DATUM, -1))).toBe(true);
    }
    // herhaalbaar
    const t = simulatie({ datum: DATUM, normen: NORM_STANDAARD, tabel, medewerkers: [], rooster: {}, seed: 3 });
    expect(t.invoer.meldingen.map((m) => m.plek.postcode)).toEqual(s.invoer.meldingen.map((m) => m.plek.postcode));
  });

  it('met een echt rooster: de regeldiensten van dat team, zonder uitvaartleiders, met de ingevulde postcode', async () => {
    const tabel = await laadPostcodes();
    let n = 0;
    const team = voorbeeldTeam('Utrecht', () => `u${n++}`);
    const uv = team.filter((m) => m.functie === 'UV');
    const ul = team.find((m) => m.functie === 'UL')!;
    const cellen: Cellen = {
      [uv[0].id]: { [DATUM]: '1' }, [uv[1].id]: { [DATUM]: '2' }, [uv[2].id]: { [DATUM]: '1B' }, [uv[3].id]: { [DATUM]: 'DG2' },
      [ul.id]: { [DATUM]: '1' },
    };
    const s = simulatie({ datum: DATUM, normen: NORM_STANDAARD, tabel, medewerkers: team, rooster: { Utrecht: cellen }, postcodes: { [uv[0].id]: '3584 CS' }, seed: 1 });
    expect(s.echt).toEqual(['Utrecht']);
    const utrecht = s.invoer.personen.filter((p) => p.regio === 'Utrecht');
    expect(utrecht.map((p) => p.id).sort()).toEqual([uv[0].id, uv[1].id, uv[2].id].sort());
    expect(utrecht.find((p) => p.id === uv[0].id)!.thuis.postcode).toBe('3584 CS');
    expect(utrecht.find((p) => p.id === uv[1].id)!.slots).toHaveLength(2);
    expect(utrecht.find((p) => p.id === uv[2].id)!.slots[0].soort).toBe('1B');
    expect(s.zonderPostcode).toBe(2);
  });

  it('slim verdeelt landelijk binnen enkele seconden, en beter dan dichtstbij op het model', async () => {
    const tabel = await laadPostcodes();
    let middagSlim = 0, middagDicht = 0, buitenSlim = 0, buitenDicht = 0;
    for (const seed of [1, 2]) {
      const s = simulatie({ datum: DATUM, normen: NORM_STANDAARD, tabel, medewerkers: [], rooster: {}, seed, drukte: 1.3 });
      const t0 = performance.now();
      const a = verdeel(s.invoer, schatReistijd);
      expect(performance.now() - t0).toBeLessThan(5000);
      const b = dichtstbij(s.invoer, schatReistijd);
      expect(a.uitkomst.doel).toBeLessThan(b.uitkomst.doel);
      const ka = kengetallen(a.plan, a.uitkomst), kb = kengetallen(b.plan, b.uitkomst);
      expect(ka.ingepland).toBeGreaterThanOrEqual(kb.ingepland);
      expect(ka.verwachtTekort).toBeLessThanOrEqual(kb.verwachtTekort);
      middagSlim += ka.middag; middagDicht += kb.middag;
      buitenSlim += ka.buitenRegio; buitenDicht += kb.buitenRegio;
      // elke toewijzing past in de eisen
      for (const t of a.uitkomst.toewijzingen) {
        const sl = a.plan.slots.get(t.slotId)!;
        expect(t.start).toBeGreaterThanOrEqual(sl.van);
        expect(t.start).toBeLessThanOrEqual(sl.tot);
        expect(t.reistijd).toBeLessThanOrEqual(s.invoer.parameters.maxReistijd);
        const m = a.plan.meldingen.get(t.meldingId)!;
        if (m.uiterlijk != null) expect(t.start).toBeLessThanOrEqual(m.uiterlijk);
      }
    }
    expect(middagSlim).toBeLessThan(middagDicht);
    expect(buitenSlim).toBeLessThan(buitenDicht);
  }, 30_000);
});
