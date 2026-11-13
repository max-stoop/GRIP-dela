// @vitest-environment node
/** Meldingen van een dag verdelen: invoer, vaste tijden (10:00 en 13:00), werkdruk en de kans dat de 1B nog valt. */
import { describe, expect, it } from 'vitest';
import { dagInvoer, kans1BNa, leesLijst, leesTijd, recenteDossiers, regioVanPostcode, stapVan, tweedeGesprekken, vrijePlekken, DAG_PARAMETERS, DAG_PLEKTIJDEN, type DagVerdeling } from '@/lib/verdeling/dag';
import { laadPostcodes } from '@/lib/verdeling/geo';
import { rekenDag, type DagOpdracht } from '@/lib/verdeling/werk';
import { AL_TOEGEZEGD } from '@/lib/verdeling/uitleg';
import { addDays } from '@/lib/dates';
import type { Cellen, Medewerker } from '@/lib/rooster/types';
import type { Slot } from '@/lib/verdeling/types';

const DATUM = '2026-10-20';
const mw = (id: string, o: Partial<Medewerker> = {}): Medewerker => ({ id, regio: 'Utrecht', naam: `Medewerker ${id}`, contract: 32, voorkeur: 'O', weekendgroep: 0, actief: true, ...o });
const leeg = (datum = DATUM): DagVerdeling => ({ datum, meldingen: [], toewijzingen: [] });

describe('invoer van de planner', () => {
  it('leest tijden', () => {
    expect(leesTijd('10:00')).toBe(600);
    expect(leesTijd('13.30')).toBe(810);
    expect(leesTijd('1030')).toBe(630);
    expect(leesTijd('9')).toBe(540);
    expect(leesTijd('25:00')).toBeNull();
    expect(leesTijd('morgen')).toBeNull();
  });

  it('leest een geplakte lijst: alleen de 4 cijfers, met of zonder tijd; fouten met het regelnummer', () => {
    const { meldingen, fouten } = leesLijst('3511 AB\n1012;13:00\n\ngeen postcode\n6211 ab 10.30');
    expect(meldingen).toEqual([{ postcode: '3511' }, { postcode: '1012', tijd: 780 }, { postcode: '6211', tijd: 630 }]);
    expect(fouten).toEqual(['Regel 4: geen postcode']);
  });

  it('vindt de regio bij een postcode', async () => {
    const tabel = await laadPostcodes();
    expect(regioVanPostcode(tabel, '3511')).toBe('Utrecht');
    expect(regioVanPostcode(tabel, '1012 AB')).toBe('Amsterdam');
    expect(regioVanPostcode(tabel, '6211')).toBe('Zuid Limburg');
    expect(regioVanPostcode(tabel, 'abc')).toBeNull();
  });
});

describe('de plekken van een dag', () => {
  it('per dienst het tijdvak en de vaste tijden: een 1 om 10:00 of 13:00, een 1M en 1B om 13:00, een 2 allebei', async () => {
    const tabel = await laadPostcodes();
    const team = [mw('a', { postcode: '3511' }), mw('b'), mw('c'), mw('d'), mw('e', { functie: 'UL' }), mw('f')];
    const rooster: Record<string, Cellen> = { Utrecht: { a: { [DATUM]: '1' }, b: { [DATUM]: '1M' }, c: { [DATUM]: '2' }, d: { [DATUM]: '1B' }, e: { [DATUM]: '1' }, f: { [DATUM]: 'DG2' } } };
    const d = dagInvoer({ datum: DATUM, tabel, medewerkers: team, rooster, verdelingen: {}, verdeling: leeg(), lam: () => 4 });
    const slots = Object.fromEntries(d.invoer.personen.map((p) => [p.id, p.slots.map((s) => ({ van: s.van, tot: s.tot, tijden: s.tijden, soort: s.soort }))]));
    // de uitvaartleider en de Dg-dienst doen geen regelgesprek
    expect(Object.keys(slots).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(slots.a).toEqual([{ van: 600, tot: 780, tijden: [600, 780], soort: 'regel' }]);
    expect(slots.b).toEqual([{ van: 720, tot: 900, tijden: [780], soort: 'regel' }]);
    expect(slots.c.map((s) => s.tijden)).toEqual([[600], [780]]);
    expect(slots.d).toEqual([{ van: 720, tot: 900, tijden: [780], soort: '1B' }]);
    // wie geen woonplaats heeft, begint in het midden van de regio
    expect(d.zonderPostcode.sort()).toEqual(['b', 'c', 'd']);
    expect(d.invoer.personen.find((p) => p.id === 'a')!.thuis.plaats).not.toMatch(/midden/);
    // de verwachting per cluster: de regio's samen
    expect(d.invoer.verwacht.O).toBe(16);
  });

  it('telt vrije plekken naar wanneer ze kunnen', () => {
    const slot = (code: '1' | '1M' | '2' | '1B', i = 0): Slot => ({ id: `${code}#${i}`, persoonId: code, ...DAG_PLEKTIJDEN[code]!.plekken[i] });
    expect(vrijePlekken([slot('1'), slot('1M'), slot('2', 0), slot('2', 1), slot('1B')])).toEqual({ tien: 1, beide: 1, dertien: 2, b: 1 });
  });

  it('recente dossiers: uit de bewaarde verdelingen, en zonder verdeling geschat uit het rooster', () => {
    const gisteren = addDays(DATUM, -1), eergisteren = addDays(DATUM, -2);
    const verdelingen: Record<string, DagVerdeling> = {
      [gisteren]: { ...leeg(gisteren), toewijzingen: [{ meldingId: 'M1', persoonId: 'a', slotId: 'a#0', start: 600, reistijd: 10 }, { meldingId: 'M2', persoonId: 'a', slotId: 'a#1', start: 780, reistijd: 10 }, { meldingId: 'M3', persoonId: 'b', slotId: 'b#0', start: 780, reistijd: 10 }] },
    };
    expect(recenteDossiers('a', DATUM, {}, verdelingen)).toBe(2);
    // eergisteren een 1 in het rooster, zonder verdeling: 0,8 dossier, met het gewicht van twee dagen terug
    const cellen: Cellen = { a: { [eergisteren]: '1' } };
    expect(recenteDossiers('a', DATUM, cellen, verdelingen)).toBeCloseTo(2 + 0.8 * 0.5 ** 0.25, 6);
    expect(recenteDossiers('c', DATUM, {}, verdelingen)).toBe(0);
  });
});

describe('kans dat de 1B nog valt', () => {
  const poisson = (lam: number, k: number) => { let p = Math.exp(-lam); for (let i = 1; i <= k; i++) p *= lam / i; return p; };
  const minstens = (lam: number, k: number) => 1 - Array.from({ length: k }, (_, i) => poisson(lam, i)).reduce((a, b) => a + b, 0);

  it('zonder wat er nog komt, valt de 1B niet', () => {
    expect(kans1BNa({ tien: 0, beide: 0, dertien: 0, b: 1 }, { ochtend: 0, middag: 0 }).minstensEen).toBe(0);
  });

  it('zonder vrije gewone plekken valt de 1B bij de eerste melding die nog komt', () => {
    const k = kans1BNa({ tien: 0, beide: 0, dertien: 0, b: 1 }, { ochtend: 0.3, middag: 1.2 });
    expect(k.minstensEen).toBeCloseTo(1 - Math.exp(-1.5), 9);
    expect(k.nogVerwacht).toBeCloseTo(1.5, 9);
  });

  it('een plek die om 10:00 of 13:00 kan, vangt ook een late melding op; een plek alleen om 10:00 niet', () => {
    const beide = kans1BNa({ tien: 0, beide: 1, dertien: 0, b: 1 }, { ochtend: 0, middag: 1 });
    expect(beide.minstensEen).toBeCloseTo(minstens(1, 2), 9);
    const tien = kans1BNa({ tien: 1, beide: 0, dertien: 0, b: 1 }, { ochtend: 0, middag: 1 });
    expect(tien.minstensEen).toBeCloseTo(minstens(1, 1), 9);
    // een vroege melding kan juist wel om 10:00
    expect(kans1BNa({ tien: 1, beide: 0, dertien: 0, b: 1 }, { ochtend: 1, middag: 0 }).minstensEen).toBeCloseTo(minstens(1, 2), 9);
  });

  it('meer vrije plekken, kleinere kans; de gemiddelde kans per 1B is nooit groter dan de kans dat er een valt', () => {
    const vraag = { ochtend: 0.4, middag: 2.5 };
    const a = kans1BNa({ tien: 0, beide: 1, dertien: 1, b: 2 }, vraag);
    const b = kans1BNa({ tien: 0, beide: 1, dertien: 3, b: 2 }, vraag);
    expect(b.minstensEen).toBeLessThan(a.minstensEen);
    expect(a.gemiddeld).toBeLessThanOrEqual(a.minstensEen + 1e-12);
  });
});

describe('een dag verdelen', () => {
  // vier mensen in Utrecht met een woonplaats; de meldingen in en om de stad
  const team = [mw('a', { postcode: '3511' }), mw('b', { postcode: '3521' }), mw('c', { postcode: '3581' }), mw('d', { postcode: '3431' })];
  const rooster: Record<string, Cellen> = { Utrecht: { a: { [DATUM]: '1' }, b: { [DATUM]: '1M' }, c: { [DATUM]: '2' }, d: { [DATUM]: '1B' } } };
  const opdracht = (verdeling: DagVerdeling, o: Partial<DagOpdracht> = {}): DagOpdracht => ({
    soort: 'dag', datum: DATUM, medewerkers: team, rooster, verdelingen: {}, verdeling, lam: { Utrecht: 6 }, parameters: {}, bron: 'tabel', ...o,
  });
  const melding = (id: string, postcode: string, tijd?: number) => ({ id, postcode, regio: 'Utrecht', ...(tijd != null ? { tijd } : {}) });

  it('alle meldingen in één keer, om 10:00 of 13:00, en de 1B als laatste', async () => {
    const v: DagVerdeling = { ...leeg(), meldingen: [melding('M1', '3512'), melding('M2', '3523'), melding('M3', '3583')] };
    const r = await rekenDag(opdracht(v));
    expect(() => structuredClone(r)).not.toThrow();
    expect(r.uitkomst.toewijzingen).toHaveLength(3);
    expect(r.uitkomst.nietIngepland).toEqual([]);
    for (const t of r.uitkomst.toewijzingen) {
      expect([600, 780]).toContain(t.start);
      expect(t.persoonId).not.toBe('d');
      expect(r.uitleg[t.meldingId]?.kop).toBeTruthy();
    }
    // per cluster: de vrije 1B en een kans tussen 0 en 1
    const o = r.clusters.find((c) => c.cluster === 'O')!;
    expect(o).toMatchObject({ personen: 4, verdeeld: 3, ingezet1B: 0 });
    expect(o.vrij.b).toBe(1);
    expect(o.minstensEen).toBeGreaterThan(0);
    expect(o.minstensEen).toBeLessThan(1);
    expect(o.nogVerwacht).toBeCloseTo(6 * (0.05 + 0.1), 9);
    // iedereen één gesprek: geen tweede gesprek van de 2 nodig
    expect(new Set(r.uitkomst.toewijzingen.map((t) => t.persoonId)).size).toBe(3);
  }, 30_000);

  it('een afgesproken tijd: alleen een plek waar die in past', async () => {
    const v: DagVerdeling = { ...leeg(), meldingen: [melding('M1', '3512', 690), melding('M2', '3523', 840)] };
    const r = await rekenDag(opdracht(v));
    const t = Object.fromEntries(r.uitkomst.toewijzingen.map((x) => [x.meldingId, x]));
    // 11:30 kan alleen bij de 1 (10:00 tot 13:00); 14:00 niet bij de 1
    expect(t.M1).toMatchObject({ persoonId: 'a', start: 690 });
    expect(t.M2.start).toBe(840);
    expect(t.M2.persoonId).not.toBe('a');
  }, 30_000);

  it('wat is doorgegeven, blijft staan; bekijken verschuift niets', async () => {
    const v: DagVerdeling = { ...leeg(), meldingen: [melding('M1', '3512'), melding('M2', '3523')] };
    const eerst = await rekenDag(opdracht(v));
    // M1 doorgegeven aan iemand anders dan de verdeling koos: die blijft staan
    const ander = eerst.personen.find((p) => p.id !== eerst.uitkomst.toewijzingen.find((t) => t.meldingId === 'M1')!.persoonId && p.slots.some((s) => s.soort === 'regel'))!;
    const toewijzingen = [{ meldingId: 'M1', persoonId: ander.id, slotId: ander.slots[ander.slots.length - 1].id, start: 780, reistijd: 15, vast: true }];
    const opnieuw = await rekenDag(opdracht({ ...v, toewijzingen }));
    expect(opnieuw.uitkomst.toewijzingen.find((t) => t.meldingId === 'M1')!.slotId).toBe(toewijzingen[0].slotId);
    expect(opnieuw.uitleg.M1.regels).toContain(AL_TOEGEZEGD);

    // bekijken: alleen wat al verdeeld is, alles op zijn plek; toegezegd alleen wat is doorgegeven
    const bewaard = eerst.uitkomst.toewijzingen.map(({ meldingId, persoonId, slotId, start, reistijd }) => ({ meldingId, persoonId, slotId, start, reistijd }));
    const metNieuw: DagVerdeling = { ...v, meldingen: [...v.meldingen, melding('M3', '3583')], toewijzingen: bewaard };
    const bekeken = await rekenDag(opdracht(metNieuw, { bekijk: true }));
    expect(bekeken.uitkomst.toewijzingen.map((t) => `${t.meldingId}@${t.slotId}`).sort()).toEqual(bewaard.map((t) => `${t.meldingId}@${t.slotId}`).sort());
    expect(bekeken.meldingen.map((m) => m.id).sort()).toEqual(['M1', 'M2']);
    for (const id of ['M1', 'M2']) expect(bekeken.uitleg[id].regels).not.toContain(AL_TOEGEZEGD);
  }, 30_000);

  it('werkdruk: wie de laatste dagen veel dossiers had, krijgt bij gelijke reis minder snel een gesprek', async () => {
    // twee mensen met een 1 op dezelfde plek; de melding ligt er precies tussenin
    const twee = [mw('x', { postcode: '3511' }), mw('y', { postcode: '3511' })];
    const r2: Record<string, Cellen> = { Utrecht: { x: { [DATUM]: '1' }, y: { [DATUM]: '1' } } };
    const druk: Record<string, DagVerdeling> = {};
    for (let i = 1; i <= 3; i++) {
      const dag = addDays(DATUM, -i);
      druk[dag] = { ...leeg(dag), toewijzingen: [{ meldingId: 'M1', persoonId: 'x', slotId: 'x#0', start: 600, reistijd: 10 }, { meldingId: 'M2', persoonId: 'x', slotId: 'x#1', start: 780, reistijd: 10 }] };
    }
    const v: DagVerdeling = { ...leeg(), meldingen: [melding('M1', '3512')] };
    const r = await rekenDag(opdracht(v, { medewerkers: twee, rooster: r2, verdelingen: druk }));
    expect(r.uitkomst.toewijzingen[0].persoonId).toBe('y');
  }, 30_000);
});

describe('de volgorde van plekken', () => {
  // in Utrecht iemand met een 2 en een 1B, vlak bij de meldingen; in Midden Nederland (zelfde cluster) iemand met een 1;
  // en iemand uit een ander cluster die in Utrecht woont
  const team = [
    mw('twee', { postcode: '3511' }), mw('b1', { postcode: '3511' }),
    mw('mn', { regio: 'Midden Nederland', postcode: '3811' }),
    mw('rdam', { regio: 'Rotterdam', postcode: '3511' }),
  ];
  const rooster = (metAnder: boolean): Record<string, Cellen> => ({
    Utrecht: { twee: { [DATUM]: '2' }, b1: { [DATUM]: '1B' } },
    'Midden Nederland': { mn: { [DATUM]: '1' } },
    Rotterdam: metAnder ? { rdam: { [DATUM]: '1' } } : {},
  });
  const meldingen = (n: number) => ['3512', '3513', '3514', '3515', '3521'].slice(0, n).map((pc, i) => ({ id: `M${i + 1}`, postcode: pc, regio: 'Utrecht' }));
  const per = async (n: number, metAnder = false) => {
    const r = await rekenDag({ soort: 'dag', datum: DATUM, medewerkers: team, rooster: rooster(metAnder), verdelingen: {}, verdeling: { ...leeg(), meldingen: meldingen(n) }, lam: { Utrecht: 4 }, parameters: {}, bron: 'tabel' });
    expect(r.uitkomst.nietIngepland).toEqual([]);
    const tel: Record<string, number> = {};
    for (const t of r.uitkomst.toewijzingen) tel[t.persoonId] = (tel[t.persoonId] ?? 0) + 1;
    return { tel, r };
  };

  it('de standaard: 5% en 10% komt nog, en elke stap kost meer dan de langste reis in de stap ervoor', () => {
    expect(DAG_PARAMETERS).toMatchObject({ aandeelOchtend: 0.05, aandeelMiddag: 0.1 });
    const p = { buitenRegio: 15, maxReistijd: 75, ...DAG_PARAMETERS };
    expect(p.tweedeGesprek!).toBeGreaterThan(p.maxReistijd + p.buitenRegio);
    expect(p.inzet1B!).toBeGreaterThan(p.tweedeGesprek! + p.maxReistijd + p.buitenRegio);
    expect(p.buitenCluster!).toBeGreaterThan(p.inzet1B! + p.maxReistijd + p.buitenRegio);
  });

  it('eerst een eerste plek elders in het cluster, dan pas het tweede gesprek van de 2', async () => {
    const { tel } = await per(2);
    expect(tel).toEqual({ twee: 1, mn: 1 });
  }, 30_000);

  it('dan het tweede gesprek van de 2, en pas daarna de 1B', async () => {
    expect((await per(3)).tel).toEqual({ twee: 2, mn: 1 });
    const { tel, r } = await per(4);
    expect(tel).toEqual({ twee: 2, mn: 1, b1: 1 });
    // de uitleg zegt het erbij
    const bijB = r.uitkomst.toewijzingen.find((t) => t.persoonId === 'b1')!;
    expect(r.uitleg[bijB.meldingId].regels.join(' ')).toMatch(/ook geen tweede gesprek van een 2/);
    const tweede = [...tweedeGesprekken(r.uitkomst.toewijzingen)];
    expect(tweede).toHaveLength(1);
    expect(r.uitleg[tweede[0]].regels.join(' ')).toMatch(/tweede gesprek van/);
    expect(bijB.kosten.inzet1B).toBe(300);
    expect(r.uitkomst.toewijzingen.find((t) => t.meldingId === tweede[0])!.kosten.tweede).toBe(150);
  }, 30_000);

  it('een ander cluster pas als er in het cluster niets meer past, ook geen 1B', async () => {
    expect((await per(4, true)).tel).toEqual({ twee: 2, mn: 1, b1: 1 });
    expect((await per(5, true)).tel).toEqual({ twee: 2, mn: 1, b1: 1, rdam: 1 });
  }, 30_000);

  it('een vrije plek in het cluster telt mee, ook als er veel mensen uit een ander cluster dichterbij wonen', async () => {
    // 35 mensen uit Amsterdam (ander cluster) wonen in Utrecht; iemand uit Arnhem (zelfde cluster) woont verder weg
    const veel = [...Array.from({ length: 35 }, (_, i) => mw(`ams${i}`, { regio: 'Amsterdam', postcode: '3511' })), mw('arn', { regio: 'Arnhem', postcode: '6811' })];
    const r = await rekenDag({
      soort: 'dag', datum: DATUM, medewerkers: veel, verdelingen: {}, lam: { Utrecht: 4 }, parameters: {}, bron: 'tabel',
      rooster: { Amsterdam: Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`ams${i}`, { [DATUM]: '1' }])), Arnhem: { arn: { [DATUM]: '1' } } },
      verdeling: { ...leeg(), meldingen: [{ id: 'M1', postcode: '3512', regio: 'Utrecht' }] },
    });
    expect(r.uitkomst.toewijzingen.map((t) => t.persoonId)).toEqual(['arn']);
  }, 30_000);

  it('benoemt de stap van elke toewijzing', () => {
    expect(stapVan({ meldingRegio: 'Utrecht', persoonRegio: 'Utrecht', soort: 'regel', tweede: false })).toBe('eigen');
    expect(stapVan({ meldingRegio: 'Utrecht', persoonRegio: 'Arnhem', soort: 'regel', tweede: false })).toBe('cluster');
    expect(stapVan({ meldingRegio: 'Utrecht', persoonRegio: 'Utrecht', soort: 'regel', tweede: true })).toBe('tweede');
    expect(stapVan({ meldingRegio: 'Utrecht', persoonRegio: 'Arnhem', soort: '1B', tweede: false })).toBe('1B');
    expect(stapVan({ meldingRegio: 'Utrecht', persoonRegio: 'Rotterdam', soort: '1B', tweede: false })).toBe('ander');
    expect([...tweedeGesprekken([
      { meldingId: 'M1', persoonId: 'a', start: 780 }, { meldingId: 'M2', persoonId: 'a', start: 600 }, { meldingId: 'M3', persoonId: 'b', start: 600 },
    ])]).toEqual(['M1']);
  });
});
