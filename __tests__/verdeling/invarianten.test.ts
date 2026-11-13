// @vitest-environment node
/**
 * Willekeurige gevallen, met een eigen (onafhankelijke) controle van elke dagroute. Wat er ook verdeeld wordt:
 * niets dubbel, alle harde eisen gehaald, toezeggingen gerespecteerd, en de boekhouding van het doel klopt.
 */
import { describe, it, expect } from 'vitest';
import { Plan, dichtstbij, verdeel } from '@/lib/verdeling/verdeel';
import { slotsVoor } from '@/lib/verdeling/invoer';
import { STANDAARD_PARAMETERS, type Afspraak, type Invoer, type Melding, type Persoon, type Punt, type ReistijdFn, type Uitkomst } from '@/lib/verdeling/types';
import { rng } from '@/lib/model/demo';
import type { DienstCode } from '@/lib/rooster/types';

const P = (x: number, y: number): Punt => ({ postcode: `${x},${y}`, lat: x, lng: y });
/** Reistijd in een vlak land, onafhankelijk van het vertrekmoment: dan is de controle exact. */
const vlak: ReistijdFn = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);
const EPS = 1e-6;

function geval(seed: number): Invoer {
  const R = rng(seed);
  const codes: DienstCode[] = ['1', '1M', '2', '1B', '1', '1M'];
  const regios = ['R1', 'R2', 'R3'];
  const cluster = (r: string) => (r === 'R3' ? 'C2' : 'C1');
  const personen: Persoon[] = Array.from({ length: R.int(2, 12) }, (_, i) => {
    const id = `p${i}`;
    const s = slotsVoor(id, R.pick(codes))!;
    const regio = R.pick(regios);
    const afspraken: Afspraak[] = R.uniform() < 0.3
      ? [{ id: `${id}:v`, start: R.pick([9, 9.5, 10, 12, 13, 14]) * 60, eind: 0, plek: P(R.int(0, 70), R.int(0, 70)), soort: 'voorgang' }]
      : [];
    for (const a of afspraken) a.eind = a.start + R.pick([60, 90, 120]);
    return {
      id, naam: id, regio, cluster: cluster(regio), contract: R.pick([16, 24, 32, 36]), thuis: P(R.int(0, 70), R.int(0, 70)),
      dienstStart: s.dienst[0], dienstEind: s.dienst[1], slots: s.slots, afspraken, belasting: R.int(0, 50) / 10, reeks: R.int(0, 4),
    };
  });
  const alleSlots = personen.flatMap((p) => p.slots.map((s) => s.id));
  const meldingen: Melding[] = Array.from({ length: R.int(1, 14) }, (_, i) => {
    const regio = R.pick(regios);
    const m: Melding = { id: `m${String(i).padStart(2, '0')}`, plek: P(R.int(0, 70), R.int(0, 70)), regio, cluster: cluster(regio), ontvangen: `2026-10-12T${String(10 + (i % 12)).padStart(2, '0')}:00` };
    if (R.uniform() < 0.5) m.uiterlijk = R.int(11 * 60, 24 * 60);
    if (R.uniform() < 0.2) m.voorkeurDagdeel = R.pick(['ochtend', 'middag'] as const);
    if (R.uniform() < 0.15) m.nietBij = [R.pick(personen).id];
    if (R.uniform() < 0.1) m.liefstBij = R.pick(personen).id;
    if (R.uniform() < 0.12) m.vast = { slotId: R.uniform() < 0.8 ? R.pick(alleSlots) : 'weg#0' };
    return m;
  });
  return { personen, meldingen, verwacht: { C1: R.int(0, 12), C2: R.int(0, 8) }, parameters: { ...STANDAARD_PARAMETERS, maxReistijd: R.pick([45, 60, 75]) } };
}

/** Controleert een uitkomst zonder de rekenkern te gebruiken; geeft de gevonden fouten terug. */
function controleer(inv: Invoer, u: Uitkomst): string[] {
  const fouten: string[] = [];
  const par = inv.parameters;
  const slots = new Map(inv.personen.flatMap((p) => p.slots.map((s) => [s.id, { s, p }] as const)));
  const meldingen = new Map(inv.meldingen.map((m) => [m.id, m]));
  const perSlot = new Set<string>(), perMelding = new Set<string>();
  // toezeggingen die de rekenkern moet respecteren: de eerste per bestaande plek
  const toegezegd = new Map<string, string>();
  for (const m of inv.meldingen) if (m.vast && slots.has(m.vast.slotId) && !toegezegd.has(m.vast.slotId)) toegezegd.set(m.vast.slotId, m.id);

  for (const t of u.toewijzingen) {
    if (perSlot.has(t.slotId)) fouten.push(`plek ${t.slotId} dubbel`);
    if (perMelding.has(t.meldingId)) fouten.push(`melding ${t.meldingId} dubbel`);
    perSlot.add(t.slotId); perMelding.add(t.meldingId);
    const m = meldingen.get(t.meldingId)!;
    const { p } = slots.get(t.slotId)!;
    if (t.persoonId !== p.id) fouten.push(`${t.meldingId}: persoon klopt niet bij de plek`);
    // een toezegging gaat voor (de familie weet het al), ook als die tegen een eerdere wens ingaat
    if (m.nietBij?.includes(p.id) && toegezegd.get(t.slotId) !== m.id) fouten.push(`${t.meldingId}: bij ${p.id}, die de familie niet wil`);
    if (!Number.isFinite(t.kosten.totaal) || Object.values(t.kosten).some((v) => Number.isNaN(v))) fouten.push(`${t.meldingId}: kosten niet eindig`);
  }
  for (const [sid, mid] of toegezegd) {
    const t = u.toewijzingen.find((x) => x.meldingId === mid);
    if (!t || t.slotId !== sid || !t.vast) fouten.push(`${mid}: toezegging op ${sid} niet gerespecteerd`);
  }
  for (const n of u.nietIngepland) if (perMelding.has(n.meldingId)) fouten.push(`${n.meldingId}: ingepland en niet ingepland`);
  if (perMelding.size + u.nietIngepland.length !== inv.meldingen.length) fouten.push('niet elke melding heeft een uitkomst');

  // per persoon de dag nalopen, op volgorde van de tijd
  for (const p of inv.personen) {
    const gs = u.toewijzingen.filter((t) => t.persoonId === p.id);
    if (!gs.length) continue;
    type G = { soort: 'gesprek' | 'afspraak'; start: number; eind: number; plek: Punt; id: string; vast?: boolean; reistijd?: number; vanaf?: string; tot?: number; van?: number; uiterlijk?: number };
    const lijst: G[] = [
      ...p.afspraken.map((a) => ({ soort: 'afspraak' as const, start: a.start, eind: a.eind, plek: a.plek, id: a.id })),
      ...gs.map((t) => {
        const s = slots.get(t.slotId)!.s, m = meldingen.get(t.meldingId)!;
        return { soort: 'gesprek' as const, start: t.start, eind: t.start + par.gesprekDuur, plek: m.plek, id: t.meldingId, vast: !!t.vast, reistijd: t.reistijd, vanaf: t.vanaf, van: s.van, tot: s.tot, uiterlijk: m.uiterlijk };
      }),
    ].sort((a, b) => a.start - b.start);
    let pos = p.thuis, eind = p.dienstStart, vorige: G | null = null;
    for (const g of lijst) {
      const r = vlak(pos, g.plek, 0);
      if (g.soort === 'gesprek') {
        if (Math.abs(r - g.reistijd!) > EPS) fouten.push(`${g.id}: reistijd ${g.reistijd} maar vanaf de vorige plek is het ${r}`);
        const verwacht = vorige ? (vorige.soort === 'gesprek' ? 'gesprek' : 'voorgang') : 'thuis';
        if (g.vanaf !== verwacht) fouten.push(`${g.id}: vanaf ${g.vanaf}, verwacht ${verwacht}`);
        if (!g.vast) {
          if (eind + r + par.marge > g.start + EPS) fouten.push(`${g.id}: niet op tijd (${eind} + ${r} + marge > ${g.start})`);
          if (g.start < g.van! - EPS || g.start > g.tot! + EPS) fouten.push(`${g.id}: begint buiten het tijdvak`);
          if (g.uiterlijk != null && g.start > g.uiterlijk + EPS) fouten.push(`${g.id}: na de 24-uursgrens`);
          if (r > par.maxReistijd + EPS) fouten.push(`${g.id}: reistijd boven de grens`);
          if (g.eind > p.dienstEind + EPS) fouten.push(`${g.id}: na het einde van de dienst`);
        }
      } else if (vorige?.soort === 'gesprek' && !vorige.vast && vorige.eind + r + par.marge > g.start + EPS) {
        fouten.push(`${vorige.id}: haalt de afspraak ${g.id} niet`);
      }
      pos = g.plek;
      eind = Math.max(eind, g.eind);
      vorige = g;
    }
  }
  return fouten;
}

describe('invarianten op willekeurige gevallen', () => {
  it('slim en dichtstbij houden zich altijd aan de harde eisen, en de boekhouding klopt', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const inv = geval(seed);
      for (const [naam, f] of [['slim', verdeel], ['dichtstbij', dichtstbij]] as const) {
        const { plan, uitkomst } = f(inv, vlak);
        const fouten = controleer(inv, uitkomst);
        expect(fouten, `${naam}, seed ${seed}`).toEqual([]);
        // het doel opnieuw berekend vanaf nul is gelijk aan de bijgehouden stand
        const vers = new Plan(inv, vlak);
        const w = uitkomst.toewijzingen.filter((t) => !vers.isVast(t.meldingId)).map((t) => [t.slotId, t.meldingId] as [string, string]);
        expect(vers.voerUit(w), `${naam}, seed ${seed}`).not.toBeNull();
        expect(vers.doel()).toBeCloseTo(plan.doel(), 6);
        expect(uitkomst.doel).toBeCloseTo(plan.doel(), 6);
      }
    }
  }, 60_000);

  it('slim is nooit duurder dan dichtstbij of dan alleen invoegen, en geeft elke keer hetzelfde', () => {
    for (let seed = 200; seed <= 260; seed++) {
      const inv = geval(seed);
      const a = verdeel(inv, vlak), b = dichtstbij(inv, vlak), c = verdeel(inv, vlak, { zonderVerbeteren: true });
      expect(a.uitkomst.doel, `seed ${seed}`).toBeLessThanOrEqual(c.uitkomst.doel + EPS);
      expect(a.uitkomst.nietIngepland.length, `seed ${seed}`).toBeLessThanOrEqual(b.uitkomst.nietIngepland.length);
      // minder meldingen zonder plek weegt zwaarder dan al het andere; bij gelijke aantallen is slim goedkoper
      if (a.uitkomst.nietIngepland.length === b.uitkomst.nietIngepland.length) expect(a.uitkomst.doel, `seed ${seed}`).toBeLessThanOrEqual(b.uitkomst.doel + EPS);
      const nog = verdeel(inv, vlak);
      expect(nog.uitkomst.toewijzingen.map((t) => `${t.meldingId}>${t.slotId}`)).toEqual(a.uitkomst.toewijzingen.map((t) => `${t.meldingId}>${t.slotId}`));
    }
  }, 60_000);

  it('een melding zonder plek past nergens meer, ook niet door een andere te laten opschuiven', () => {
    for (let seed = 300; seed <= 360; seed++) {
      const inv = geval(seed);
      const { plan, uitkomst } = verdeel(inv, vlak);
      for (const n of uitkomst.nietIngepland) {
        for (const sid of plan.slots.keys()) {
          const bezet = plan.inSlot.get(sid);
          if (!bezet) expect(plan.probeer([[sid, n.meldingId]]), `seed ${seed}: ${n.meldingId} past op vrije plek ${sid}`).toBeNull();
          else if (!plan.isVast(bezet) && plan.kandidaten.get(n.meldingId)!.includes(sid)) {
            for (const s2 of plan.kandidaten.get(bezet)!) {
              if (plan.inSlot.has(s2)) continue;
              const d = plan.probeer([[sid, n.meldingId], [s2, bezet]]);
              expect(d == null || d >= 0, `seed ${seed}: ${n.meldingId} past door ${bezet} naar ${s2} te schuiven`).toBe(true);
            }
          }
        }
      }
    }
  }, 60_000);
});

describe('toezeggingen', () => {
  const persoon = (id: string, code: DienstCode, thuis: Punt): Persoon => {
    const s = slotsVoor(id, code)!;
    return { id, naam: id, regio: 'R', cluster: 'C', contract: 36, thuis, dienstStart: s.dienst[0], dienstEind: s.dienst[1], slots: s.slots, afspraken: [], belasting: 0, reeks: 0 };
  };
  const inv = (personen: Persoon[], meldingen: Melding[]): Invoer => ({ personen, meldingen, verwacht: { C: 0 }, parameters: STANDAARD_PARAMETERS });

  it('een toegezegd gesprek blijft staan, ook als het volgens het model niet past, met een waarschuwing', () => {
    const u = verdeel(inv([persoon('ver', '1', P(0, 0)), persoon('dicht', '1', P(99, 0))], [
      { id: 'm1', plek: P(100, 0), regio: 'R', cluster: 'C', ontvangen: '', vast: { slotId: 'ver#0' } },
    ]), vlak).uitkomst;
    const t = u.toewijzingen[0];
    expect(t.slotId).toBe('ver#0');
    expect(t.vast).toBe(true);
    expect(t.waarschuwing).toMatch(/reistijd 100 min/);
  });

  it('is de toegezegde plek er niet meer (ziek), dan krijgt de melding een nieuwe plek en is dat te zien', () => {
    const u = verdeel(inv([persoon('a', '1', P(0, 0))], [
      { id: 'm1', plek: P(10, 0), regio: 'R', cluster: 'C', ontvangen: '', vast: { slotId: 'ziek#0' } },
      { id: 'm2', plek: P(500, 0), regio: 'R', cluster: 'C', ontvangen: '', vast: { slotId: 'ziek#1' } },
    ]), vlak).uitkomst;
    expect(u.toewijzingen[0]).toMatchObject({ meldingId: 'm1', slotId: 'a#0', herplaatst: true });
    expect(u.nietIngepland[0].reden).toMatch(/^toegezegde plek vervallen/);
  });

  it('een melding die alleen op een bezette plek past, krijgt die als de ander kan opschuiven', () => {
    // m-laat kan alleen bij A (de 1 begint om 10:00, de 1M pas om 12:00); m-vrij past bij allebei
    const a = persoon('A', '1', P(0, 0)), b = persoon('B', '1M', P(5, 0));
    const u = verdeel(inv([a, b], [
      { id: 'm-vrij', plek: P(1, 0), regio: 'R', cluster: 'C', ontvangen: '' },
      { id: 'm-laat', plek: P(2, 0), regio: 'R', cluster: 'C', ontvangen: '', uiterlijk: 11 * 60 },
    ]), vlak).uitkomst;
    expect(u.nietIngepland).toEqual([]);
    expect(u.toewijzingen.find((t) => t.meldingId === 'm-laat')!.persoonId).toBe('A');
  });
});

describe('randgevallen', () => {
  it('zonder meldingen, zonder mensen, of mensen zonder plekken: geen fouten', () => {
    const leeg: Invoer = { personen: [], meldingen: [], verwacht: {}, parameters: STANDAARD_PARAMETERS };
    expect(verdeel(leeg, vlak).uitkomst).toMatchObject({ toewijzingen: [], nietIngepland: [], clusters: [] });
    const zonderMensen: Invoer = { ...leeg, meldingen: [{ id: 'm', plek: P(0, 0), regio: 'R', cluster: 'C', ontvangen: '' }] };
    expect(verdeel(zonderMensen, vlak).uitkomst.nietIngepland[0].reden).toMatch(/niemand/);
    const zonderPlekken: Invoer = {
      ...zonderMensen,
      personen: [{ id: 'p', naam: 'p', regio: 'R', cluster: 'C', contract: 36, thuis: P(0, 0), dienstStart: 540, dienstEind: 1020, slots: [], afspraken: [], belasting: 0, reeks: 0 }],
    };
    expect(verdeel(zonderPlekken, vlak).uitkomst.nietIngepland).toHaveLength(1);
  });

  it('een cluster zonder verwachting en een onbekend cluster bij een melding', () => {
    const s = slotsVoor('p', '1')!;
    const inv: Invoer = {
      personen: [{ id: 'p', naam: 'p', regio: 'R', cluster: 'C', contract: 36, thuis: P(0, 0), dienstStart: s.dienst[0], dienstEind: s.dienst[1], slots: s.slots, afspraken: [], belasting: 0, reeks: 0 }],
      meldingen: [{ id: 'm', plek: P(3, 0), regio: 'Elders', cluster: 'Onbekend', ontvangen: '' }],
      verwacht: {}, parameters: STANDAARD_PARAMETERS,
    };
    const u = verdeel(inv, vlak).uitkomst;
    expect(u.toewijzingen).toHaveLength(1);
    expect(u.toewijzingen[0].kosten.regio).toBe(STANDAARD_PARAMETERS.buitenRegio + STANDAARD_PARAMETERS.buitenCluster);
  });
});
