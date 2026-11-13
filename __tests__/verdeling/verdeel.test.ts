// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Tekorten } from '@/lib/verdeling/optie';
import { Plan, dichtstbij, kengetallen, verdeel } from '@/lib/verdeling/verdeel';
import { uitleg } from '@/lib/verdeling/uitleg';
import { slotsVoor } from '@/lib/verdeling/invoer';
import { STANDAARD_PARAMETERS, type Afspraak, type Invoer, type Melding, type Parameters, type Persoon, type Punt, type ReistijdFn } from '@/lib/verdeling/types';
import { poissonVerdeling } from '@/lib/capaciteit/beschikbaarheid';
import { rng } from '@/lib/model/demo';
import type { DienstCode } from '@/lib/rooster/types';

/** Een vlak land: x en y in minuten rijden. */
const P = (x: number, y = 0): Punt => ({ postcode: `${x},${y}`, lat: x, lng: y });
const vlak: ReistijdFn = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);

function persoon(id: string, code: DienstCode, thuis: Punt, extra: Partial<Persoon> = {}): Persoon {
  const s = slotsVoor(id, code)!;
  return {
    id, naam: id, regio: 'R1', cluster: 'C', contract: 36, thuis,
    dienstStart: s.dienst[0], dienstEind: s.dienst[1], slots: s.slots, afspraken: [], belasting: 0, reeks: 0, ...extra,
  };
}

function melding(id: string, plek: Punt, extra: Partial<Melding> = {}): Melding {
  return { id, plek, regio: 'R1', cluster: 'C', ontvangen: '2026-10-12T18:00', ...extra };
}

function invoer(personen: Persoon[], meldingen: Melding[], verwacht = 0, par: Partial<Parameters> = {}): Invoer {
  return { personen, meldingen, verwacht: { C: verwacht }, parameters: { ...STANDAARD_PARAMETERS, ...par } };
}

const plek = (u: ReturnType<typeof verdeel>['uitkomst'], mid: string) => u.toewijzingen.find((t) => t.meldingId === mid);

describe('de waarde van een vrije plek (verwacht tekort later op de dag)', () => {
  it('is exact: gelijk aan de som over beide Poisson-verdelingen', () => {
    const t = new Tekorten({ ochtend: 1.2, middag: 2.5 });
    const po = poissonVerdeling(1.2), pm = poissonVerdeling(2.5);
    for (const [fo, fm] of [[0, 0], [1, 0], [0, 2], [2, 3], [1, 1]]) {
      let e = 0;
      po.forEach((a, no) => pm.forEach((b, nm) => {
        // vroege meldingen eerst in de ochtend, dan de middag; late alleen in de middag
        const restM = Math.max(0, fm - Math.max(0, no - fo));
        e += a * b * (Math.max(0, no - fo - fm) + Math.max(0, nm - restM));
      }));
      expect(t.verwacht(fo, fm)).toBeCloseTo(e, 10);
    }
    expect(t.verwacht(0, 0)).toBeCloseTo(1.2 + 2.5, 6);
  });

  it('daalt met elke vrije plek, en een middagplek is minstens zo waardevol als een ochtendplek', () => {
    const t = new Tekorten({ ochtend: 1, middag: 3 });
    for (let fo = 0; fo < 6; fo++) {
      for (let fm = 0; fm < 6; fm++) {
        expect(t.verwacht(fo + 1, fm)).toBeLessThanOrEqual(t.verwacht(fo, fm) + 1e-12);
        expect(t.verwacht(fo, fm + 1)).toBeLessThanOrEqual(t.verwacht(fo, fm) + 1e-12);
        if (fo > 0 && fm > 0) expect(t.marginaal(fo, fm, 'middag')).toBeGreaterThanOrEqual(t.marginaal(fo, fm, 'ochtend') - 1e-12);
      }
    }
  });

  it('kost niets als er niets meer verwacht wordt', () => {
    const t = new Tekorten({ ochtend: 0, middag: 0 });
    expect(t.marginaal(1, 1, 'middag')).toBe(0);
    expect(t.marginaal(1, 1, 'ochtend')).toBe(0);
  });
});

describe('verdelen', () => {
  it('kiest liever iemand in de ochtend die iets verder weg is, als de middagplek later nog nodig is', () => {
    const personen = [persoon('ochtend', '1', P(25)), persoon('middag', '1M', P(15))];
    const m = [melding('M1', P(0))];
    const druk = verdeel(invoer(personen, m, 6), vlak).uitkomst;
    expect(plek(druk, 'M1')!.persoonId).toBe('ochtend');
    // dichtstbij neemt de middag
    expect(plek(dichtstbij(invoer(personen, m, 6), vlak).uitkomst, 'M1')!.persoonId).toBe('middag');
    // wordt er later niets meer verwacht, dan wint de kortste reis
    expect(plek(verdeel(invoer(personen, m, 0), vlak).uitkomst, 'M1')!.persoonId).toBe('middag');
  });

  it('spreidt de werkdruk: iemand met veel recente dossiers krijgt het niet als een ander bijna even dichtbij is', () => {
    const personen = [persoon('druk', '1', P(10), { belasting: 5 }), persoon('rustig', '1', P(14))];
    const u = verdeel(invoer(personen, [melding('M1', P(0))]), vlak).uitkomst;
    expect(plek(u, 'M1')!.persoonId).toBe('rustig');
    // met een veel kleiner contract weegt dezelfde belasting zwaarder
    const w = new Plan(invoer(personen, []), vlak);
    expect(w.werkdrukKosten({ ...personen[0], contract: 18 }, 1)).toBeGreaterThan(w.werkdrukKosten(personen[0], 1) * 3.9);
  });

  it('houdt zich aan de harde eisen: maximale reistijd, niet bij, de 24-uursgrens', () => {
    const personen = [persoon('A', '1', P(0)), persoon('B', '1M', P(5))];
    const u = verdeel(invoer(personen, [
      melding('ver', P(200)),
      melding('nietA', P(1), { nietBij: ['A'] }),
      melding('vroeg', P(6), { uiterlijk: 11 * 60 }),
    ]), vlak).uitkomst;
    expect(u.nietIngepland.find((n) => n.meldingId === 'ver')!.reden).toMatch(/75 minuten/);
    expect(plek(u, 'nietA')!.persoonId).toBe('B');
    // de 1M begint pas om 12:00; alleen de 1 van A haalt 11:00
    expect(plek(u, 'vroeg')!.persoonId).toBe('A');
    expect(plek(u, 'vroeg')!.start).toBeLessThanOrEqual(11 * 60);
  });

  it('een middaggesprek begint waar het ochtendgesprek was', () => {
    const personen = [persoon('twee', '2', P(0))];
    const u = verdeel(invoer(personen, [melding('M1', P(20)), melding('M2', P(30))]), vlak).uitkomst;
    const mid = u.toewijzingen.find((t) => t.dagdeel === 'middag')!;
    const och = u.toewijzingen.find((t) => t.dagdeel === 'ochtend')!;
    expect(mid.vanaf).toBe('gesprek');
    expect(mid.reistijd).toBeCloseTo(10, 6);
    expect(och.vanaf).toBe('thuis');
    // de route: eerst de dichtste, dan door
    expect(och.meldingId).toBe('M1');
  });

  it('na een voorgang rijdt iemand vanaf de voorgang, en een gesprek mag de voorgang niet in de weg zitten', () => {
    const voorgang: Afspraak = { id: 'v', start: 9.5 * 60, eind: 11 * 60, plek: P(40), soort: 'voorgang' };
    const personen = [persoon('V', '1M', P(0), { afspraken: [voorgang] })];
    const u = verdeel(invoer(personen, [melding('M1', P(45))]), vlak).uitkomst;
    expect(plek(u, 'M1')!.vanaf).toBe('voorgang');
    expect(plek(u, 'M1')!.reistijd).toBeCloseTo(5, 6);

    // een 1 met een voorgang om 12:00: het gesprek (2 uur) past er niet voor, en de 1 sluit om 13:00
    const krap: Afspraak = { id: 'k', start: 12 * 60, eind: 13.5 * 60, plek: P(0), soort: 'voorgang' };
    const u2 = verdeel(invoer([persoon('K', '1', P(0), { afspraken: [krap] })], [melding('M1', P(30))]), vlak).uitkomst;
    expect(u2.nietIngepland).toHaveLength(1);
  });

  it('zet een 1B pas in als er geen gewone plek is', () => {
    const personen = [persoon('B', '1B', P(5)), persoon('gewoon', '1M', P(30))];
    expect(plek(verdeel(invoer(personen, [melding('M1', P(0))]), vlak).uitkomst, 'M1')!.persoonId).toBe('gewoon');
    const u = verdeel(invoer(personen, [melding('M1', P(0)), melding('M2', P(1))]), vlak).uitkomst;
    expect(u.toewijzingen).toHaveLength(2);
    expect(u.toewijzingen.filter((t) => t.slotId.startsWith('B#'))).toHaveLength(1);
  });

  it('laat toegezegde gesprekken staan, ook als het anders goedkoper was', () => {
    const personen = [persoon('ver', '1', P(40)), persoon('dicht', '1', P(2))];
    const u = verdeel(invoer(personen, [melding('M1', P(0), { vast: { slotId: 'ver#0' } })]), vlak).uitkomst;
    expect(plek(u, 'M1')!.persoonId).toBe('ver');
    expect(plek(u, 'M1')!.vast).toBe(true);
  });

  it('liever in de eigen regio, dan het eigen cluster', () => {
    const personen = [
      persoon('eigen', '1', P(20)),
      persoon('regio', '1', P(10), { regio: 'R2' }),
      persoon('cluster', '1', P(1), { regio: 'R9', cluster: 'X' }),
    ];
    const u = verdeel({ ...invoer(personen, [melding('M1', P(0))]), verwacht: { C: 0, X: 0 } }, vlak).uitkomst;
    // 20 min + 10 terug vs 10 + 5 + 15 buiten de regio: gelijk; het cluster kost 45 extra
    expect(['eigen', 'regio']).toContain(plek(u, 'M1')!.persoonId);
  });

  it('vindt op kleine gevallen (bijna altijd) het optimum, en anders iets wat er dicht bij zit', () => {
    let gelijk = 0, slechtste = 1;
    const N = 100;
    for (let seed = 1; seed <= N; seed++) {
      const R = rng(seed);
      const codes: DienstCode[] = ['1', '1M', '2', '1B'];
      const personen = Array.from({ length: 5 }, (_, i) => persoon(`p${i}`, R.pick(codes), P(R.int(0, 50), R.int(0, 50)), { belasting: R.int(0, 4), reeks: R.int(0, 3) }));
      const meldingen = Array.from({ length: 4 }, (_, i) => melding(`m${i}`, P(R.int(0, 50), R.int(0, 50)), R.uniform() < 0.3 ? { voorkeurDagdeel: 'ochtend' } : {}));
      const inv = invoer(personen, meldingen, R.int(0, 6));
      const doel = verdeel(inv, vlak).plan.doel();
      const beste = bruteForce(inv);
      expect(doel).toBeGreaterThanOrEqual(beste - 1e-6);
      if (doel <= beste + 1e-6) gelijk++;
      slechtste = Math.max(slechtste, doel / beste);
    }
    expect(gelijk / N).toBeGreaterThanOrEqual(0.95);
    expect(slechtste).toBeLessThan(1.1);
  }, 30_000);

  it('legt uit waarom, met het alternatief', () => {
    const personen = [persoon('ochtend', '1', P(25)), persoon('middag', '1M', P(15))];
    const { plan } = verdeel(invoer(personen, [melding('M1', P(0))], 6), vlak);
    const u = uitleg(plan, 'M1')!;
    expect(u.kop).toMatch(/^ochtend/);
    expect(u.vergelijking).toMatch(/middag/);
    expect(u.verschil!.find((v) => v.label === 'Reistijd')!.delta).toBeLessThan(0);
    expect(u.verschil!.find((v) => v.label === 'Ruimte later op de dag')!.delta).toBeGreaterThan(0);
    // de uitleg laat het plan zoals het was
    expect(plan.slotVan.get('M1')).toBe('ochtend#0');
  });

  it('kengetallen tellen wat er gebeurd is', () => {
    const personen = [persoon('A', '2', P(0)), persoon('B', '1B', P(3), { regio: 'R2' })];
    const { plan, uitkomst } = verdeel(invoer(personen, [melding('M1', P(5)), melding('M2', P(6)), melding('M3', P(7))]), vlak);
    const k = kengetallen(plan, uitkomst);
    expect(k.ingepland).toBe(3);
    expect(k.inzet1B).toBe(1);
    expect(k.buitenRegio).toBe(1);
    expect(k.middag).toBe(2);
  });
});

/** Alle toewijzingen proberen (elke melding naar een plek of geen plek) en de laagste kosten teruggeven. */
function bruteForce(inv: Invoer): number {
  const plan = new Plan(inv, vlak);
  const slots = [...plan.slots.keys()];
  const mids = inv.meldingen.map((m) => m.id);
  let beste = Infinity;
  const kies = (i: number, gebruikt: Set<string>, keuze: (string | null)[]) => {
    if (i === mids.length) {
      const leeg = [...plan.inSlot.keys()].map((s) => [s, null] as [string, string | null]);
      plan.voerUit(leeg);
      const ok = plan.voerUit(keuze.flatMap((s, k) => (s ? [[s, mids[k]] as [string, string]] : [])));
      if (ok != null) beste = Math.min(beste, plan.doel());
      return;
    }
    kies(i + 1, gebruikt, [...keuze, null]);
    for (const s of slots) {
      if (gebruikt.has(s)) continue;
      gebruikt.add(s);
      kies(i + 1, gebruikt, [...keuze, s]);
      gebruikt.delete(s);
    }
  };
  kies(0, new Set(), []);
  return beste;
}
