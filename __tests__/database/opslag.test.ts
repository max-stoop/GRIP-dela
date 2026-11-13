// @vitest-environment node
/** De opslag op PGlite met het echte schema: wegschrijven als verschil, teruglezen per rol, en wat de RLS tegenhoudt. */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  beoordeelRooster, beoordeelVerlof, bewaarMedewerker, bewaarNu, bewaarProfiel, dienVoorkeurenIn, getState, koppelDb, laad, leesFoutNu, leesOpnieuw, maakRuil, meldZiek, vulAan, openRonde,
  openVakantieronde, opslagFoutNu, opslagwijze, publiceer, roosterVersie, startTest, stopTest, voorbeeldTeamToevoegen, vraagGoedkeuring, vraagVerlofAan, zetBeleid, zetCellen, zetGebruiker, zetNbd,
  zetNbdDiensten, zetNormRegio, zetTijd, zetWens, voegVerschuivingToe,
} from '@/lib/store/store';
import { NBD } from '@/lib/nbd/parameters';
import { AANTAL_VAKKEN, leegUren, metDienst } from '@/lib/nbd/voorkeuren';
import { laadDelenVeilig } from '@/lib/store/db/laden';
import type { Db } from '@/lib/store/db/db';
import { verschil } from '@/lib/store/db/verschil';
import { voerUit } from '@/lib/store/db/db';
import { pasToe } from '@/lib/rooster/ruil';
import { opVolgorde, roosterGroep, schuif } from '@/lib/rooster/types';
import { addDays, nowStamp, todayIso } from '@/lib/dates';
import { maandEind, maandStart, maandVan, volgendeMaand } from '@/lib/rooster/maand';
import type { AppState, Goedkeuring } from '@/lib/store/types';
import { BEHEER, MEDEWERKER, PLANNER, REGIOMANAGER, maakOmgeving, pgDb } from './pgdb';

beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });

const vandaag = todayIso();
const M0 = maandVan(vandaag), M1 = volgendeMaand(M0), M2 = volgendeMaand(M0, 2);
const leeg = getState();
let pg: PGlite;
let s: AppState;
const ids: Record<string, string> = {};
/** Voorkeuren per uur van een NBD-medewerker: in even weken graag de avond op maandag, in oneven weken nooit op zondag. */
const ninaUren = leegUren();
ninaUren.even[1] = metDienst(ninaUren.even[1], 17, 22.5);
ninaUren.oneven[0] = 'n'.repeat(AANTAL_VAKKEN);
const d = (n: number) => addDays(maandStart(M1), n);
const lees = async (wie: number | null) => {
  const g = await laadDelenVeilig(pgDb(pg, wie), vandaag);
  expect(g.mislukt).toEqual([]);
  return vulAan({ ...leeg, ...g.staat, geladen: true });
};
const opId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));

beforeAll(async () => {
  pg = await maakOmgeving();
  // een staat met van alles erin, gemaakt met de gewone acties (lokale modus)
  ids.anouk = bewaarMedewerker({ regio: 'Utrecht', naam: 'Anouk A.', contract: 32, voorkeur: 'O', weekendgroep: 0 });
  ids.tessa = bewaarMedewerker({ regio: 'Utrecht', naam: 'Tessa J.', contract: 28, voorkeur: 'M', weekendgroep: 1, email: 'tessa@voorbeeld.nl' });
  ids.karin = bewaarMedewerker({ regio: 'Amsterdam', naam: 'Karin P.', contract: 36, voorkeur: 'O', weekendgroep: 0, functie: 'UL' });
  zetCellen('Utrecht', [[ids.anouk, d(1), '1'], [ids.anouk, d(2), 'DG2'], [ids.tessa, d(1), '1M'], [ids.tessa, d(3), '1B']]);
  zetCellen('Amsterdam', [[ids.karin, d(1), 'DG1']]);
  // de nabestaandendesk: diensten met eigen tijden en pauze, en eigen instellingen
  ids.nina = bewaarMedewerker({ regio: NBD, naam: 'Nina N.', contract: 24, maxUren: 28, voorkeur: 'O', weekendgroep: 0 });
  zetNbdDiensten([[ids.nina, d(1), 'N', { start: 8.5, eind: 17, pauze: 30, pauzeStart: 12.75 }], [ids.nina, d(2), 'N', { start: 17, eind: 22, pauze: 0 }]]);
  zetNbd({ aht: 320, vrijeMarkt: 0.2 });
  bewaarProfiel(ids.nina, { dagen: ['niet', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'liever_niet'], dienst: 'avond', maxDagenPerWeek: 4, uren: ninaUren });
  zetWens(ids.nina, d(5), 'avond');
  zetTijd('Utrecht', ids.anouk, d(2), { start: 9.5, eind: 17.5 }, 'Plan');
  const v = vraagVerlofAan({ medewerkerId: ids.anouk, van: d(10), tot: d(12), soort: 'vakantie', opmerking: 'Weekje weg' }, 'Anouk');
  beoordeelVerlof(v.id, 'goedgekeurd', 'Rianne');
  vraagVerlofAan({ medewerkerId: ids.tessa, van: d(15), tot: d(15), soort: 'adv' }, 'Tessa');
  zetWens(ids.tessa, d(4), 'vrij', 'verjaardag');
  // de collega van Tessa: geen voorkeur op dezelfde dag, en een dag later graag werken
  zetWens(ids.anouk, d(4), 'neutraal');
  zetWens(ids.anouk, d(5), 'werken', 'oppas geregeld');
  bewaarProfiel(ids.tessa, { dagen: ['niet', 'graag', 'neutraal', 'neutraal', 'liever_niet', 'neutraal', 'niet'], dienst: 'middag', maxDagenPerWeek: 4, korteDagen: 'graag', weekend: 'oneven', weekendPlekken: 3 });
  voegVerschuivingToe({ vanRegio: 'Utrecht', naarRegio: 'Arnhem', van: d(3), tot: d(9), plekken: 1, opmerking: 'twee collega\'s ziek', door: 'Plan' });
  const ronde = openRonde({ regio: 'Utrecht', van: maandStart(M2), tot: maandEind(M2), deadline: addDays(vandaag, 7) }, 'Plan');
  dienVoorkeurenIn(ronde.id, ids.tessa);
  ids.ruil = maakRuil({ soort: 'aanbieden', aanbiederId: ids.anouk, datum: d(1), dienst: '1' } as never, 'Anouk').id;
  meldZiek(ids.karin, d(1), d(1), 'Plan');
  openVakantieronde({ naam: 'Kerst', cluster: 'O', van: maandStart(M2), tot: maandEind(M2), data: { aanvragen: addDays(vandaag, 10), analyse: addDays(vandaag, 12), advies: addDays(vandaag, 14), gesprek: addDays(vandaag, 16), besluit: addDays(vandaag, 20) } }, 'Plan');
  for (const m of [M0, M1]) {
    vraagGoedkeuring('Utrecht', m, { cijfer: 8.4, hard: 0 }, 'Plan', { kleur: 'oranje', toelichting: 'Twee krappe dagen, 1B als achtervang' });
    beoordeelRooster('Utrecht', m, 'goedgekeurd', 'Rianne');
  }
  publiceer('Utrecht', vandaag, maandEind(M1), 'Plan');
  zetBeleid({ ruilAutomatisch: true });
  zetNormRegio('Utrecht', { correctie: 1.05 });
  // de dagelijkse voorspelling legt de datum vast als JSON-tekst ("2026-10-08"); die moet ook terug te lezen zijn
  s = { ...getState(), laatsteAuto: vandaag };
  // de beheerder zet alles in de database (zoals een eerste keer overzetten)
  await voerUit(pgDb(pg, null), verschil(leeg, s, 'beheerder'), { rol: 'beheerder' });
}, 60_000);

describe('opslag met de gedeelde database', () => {
  it('wat erin gaat, komt er voor de beheerder precies zo weer uit', async () => {
    const t = await lees(BEHEER);
    // functie ontbreekt in de staat als die standaard is (uitvaartverzorger); de database vult hem in
    expect(opId(t.medewerkers)).toEqual(opId(s.medewerkers.map((m) => ({ functie: 'UV' as const, ...m }))));
    expect(t.rooster).toEqual(s.rooster);
    expect(t.tijden).toEqual(s.tijden);
    expect(opId(t.verlof)).toEqual(opId(s.verlof));
    expect(opId(t.wensen)).toEqual(opId(s.wensen));
    expect(t.profielen).toEqual(s.profielen);
    expect(t.rondes).toEqual(s.rondes);
    expect(opId(t.ruil)).toEqual(opId(s.ruil));
    expect(opId(t.ziekmeldingen)).toEqual(opId(s.ziekmeldingen));
    expect(t.verschuivingen).toEqual(s.verschuivingen);
    expect(t.verschuivingen).toHaveLength(1);
    expect(t.vakantierondes).toEqual(s.vakantierondes);
    expect(t.publicaties).toEqual(s.publicaties);
    expect(opId(t.activiteit)).toEqual(opId(s.activiteit));
    expect(t.beleid).toEqual(s.beleid);
    expect(t.normen).toEqual(s.normen);
    expect(t.schoolvakanties).toEqual(s.schoolvakanties);
    expect(t.nbd).toEqual(s.nbd);
    expect(t.laatsteAuto).toBe(vandaag);
    expect(t.nbd.aht).toBe(320);
    expect(t.tijden[NBD][ids.nina][d(1)]).toEqual({ start: 8.5, eind: 17, code: 'N', pauze: 30, pauzeStart: 12.75 });
    expect(t.profielen[ids.nina].dienst).toBe('avond');
    // maximale inzet en voorkeuren per uur (NBD)
    expect(t.medewerkers.find((m) => m.id === ids.nina)?.maxUren).toBe(28);
    expect(t.medewerkers.find((m) => m.id === ids.anouk)).not.toHaveProperty('maxUren');
    expect(t.profielen[ids.nina].uren).toEqual(ninaUren);
    expect(t.profielen[ids.tessa]).not.toHaveProperty('uren');
    // de goedkeuring zelf; de geschiedenis houdt de database bij (hier alleen het besluit, want het ging in één keer)
    for (const m of [M0, M1]) {
      const { geschiedenis: _a, ...db } = t.goedkeuringen.Utrecht[m];
      const { geschiedenis: _b, ...app } = s.goedkeuringen.Utrecht[m];
      expect(db).toEqual(app);
    }
  });

  it('nog een keer wegschrijven verandert niets: het verschil is leeg', async () => {
    const t = await lees(BEHEER);
    expect(verschil(t, t, 'beheerder')).toEqual([]);
    expect(verschil(s, t, 'beheerder').filter((o) => o.tabel !== 'rp_goedkeuring')).toEqual([]);
  });

  it('een planner ziet alle regio’s, een regiomanager de eigen, een medewerker alleen wat bij die hoort', async () => {
    const p = await lees(PLANNER);
    expect(new Set(p.medewerkers.map((m) => m.regio))).toEqual(new Set(['Utrecht', 'Amsterdam', NBD]));
    expect(Object.keys(p.rooster).sort()).toEqual(['Amsterdam', NBD, 'Utrecht']);
    expect(p.tijden[NBD]).toEqual(s.tijden[NBD]);
    expect(p.ziekmeldingen.map((z) => z.medewerkerId)).toEqual([ids.karin]);
    const rm = await lees(REGIOMANAGER);
    expect(rm.medewerkers.map((m) => m.regio).every((r) => r === 'Utrecht')).toBe(true);
    expect(Object.keys(rm.rooster)).toEqual(['Utrecht']);
    expect(rm.ziekmeldingen).toEqual([]);
    const m = await lees(MEDEWERKER);
    expect(m.rooster).toEqual({});
    expect(m.publicaties.Utrecht.cellen[ids.tessa]).toEqual(s.publicaties.Utrecht.cellen[ids.tessa]);
    // het eigen verlof helemaal, van collega's alleen wie en wanneer (zonder opmerking)
    expect(m.verlof.filter((v) => v.medewerkerId === ids.tessa).length).toBeGreaterThan(0);
    expect(m.verlof.filter((v) => v.medewerkerId !== ids.tessa).every((v) => !v.opmerking && v.regio === 'Utrecht')).toBe(true);
    expect(m.meldingen).toBeNull();
    // wensen: de eigen wens helemaal, van het team alleen de aantallen per dag (zonder de eigen wens)
    expect(m.wensen.map((w) => [w.medewerkerId, w.soort])).toEqual([[ids.tessa, 'vrij']]);
    expect(m.wensenTeam).toEqual({ [d(4)]: { werken: 0, vrij: 0, neutraal: 1, overig: 0 }, [d(5)]: { werken: 1, vrij: 0, neutraal: 0, overig: 0 } });
    // wie plant, leest de wensen zelf en krijgt geen aantallen
    expect(p.wensen.length).toBe(4);
    expect(p.wensenTeam).toEqual({});
    expect(m.goedkeuringen).toEqual({});
  });

  it('een wijziging van de planner gaat als verschil de database in', async () => {
    const p0 = await lees(PLANNER);
    const p1: AppState = {
      ...p0,
      rooster: { ...p0.rooster, Utrecht: pasToe(p0.rooster.Utrecht, [[ids.anouk, d(1), '2'], [ids.tessa, d(3), '-'], [ids.tessa, d(5), 'O']]) },
    };
    const ops = verschil(p0, p1, 'planner');
    expect(ops.map((o) => `${o.tabel}:${o.soort}`).sort()).toEqual(['rp_rooster:delete', 'rp_rooster:upsert']);
    await voerUit(pgDb(pg, PLANNER), ops, { rol: 'planner' });
    expect((await lees(PLANNER)).rooster.Utrecht).toEqual(p1.rooster.Utrecht);
  });

  it('de planner schuift een naam: de volgorde gaat de database in en komt zo terug', async () => {
    const p0 = await lees(PLANNER);
    const team = p0.medewerkers.filter((m) => m.regio === 'Utrecht' && m.actief).sort(opVolgorde);
    const laatste = team.filter((m) => roosterGroep(m) === roosterGroep(team[0])).at(-1)!;
    const plek = schuif(team, laatste.id, -1)!;
    const p1: AppState = { ...p0, medewerkers: p0.medewerkers.map((m) => (plek[m.id] != null ? { ...m, volgorde: plek[m.id] } : m)) };
    const ops = verschil(p0, p1, 'planner');
    expect(ops.map((o) => `${o.tabel}:${o.soort}`)).toEqual(['rp_medewerker:upsert']);
    await voerUit(pgDb(pg, PLANNER), ops, { rol: 'planner' });
    const terug = (await lees(PLANNER)).medewerkers.filter((m) => m.regio === 'Utrecht' && m.actief).sort(opVolgorde).map((m) => m.id);
    expect(terug).toEqual(p1.medewerkers.filter((m) => m.regio === 'Utrecht' && m.actief).sort(opVolgorde).map((m) => m.id));
    expect(terug.indexOf(laatste.id)).toBe(team.indexOf(laatste) - 1);
  });

  it('de medewerker zet de eigen stap in een ruil, maar wijzigt het rooster niet en keurt niet goed', async () => {
    const m0 = await lees(MEDEWERKER);
    const r = m0.ruil.find((x) => x.id === ids.ruil)!;
    const m1: AppState = { ...m0, ruil: m0.ruil.map((x) => (x.id === r.id ? { ...x, status: 'wacht_planner', ontvangerId: ids.tessa, geaccepteerd: nowStamp() } : x)) };
    const ops = verschil(m0, m1, 'medewerker');
    expect(ops).toEqual([expect.objectContaining({ tabel: 'rp_ruil', soort: 'update' })]);
    await voerUit(pgDb(pg, MEDEWERKER), ops, { rol: 'medewerker' });
    expect((await lees(MEDEWERKER)).ruil.find((x) => x.id === r.id)).toMatchObject({ status: 'wacht_planner', ontvangerId: ids.tessa });
    // zelf goedkeuren of het rooster aanpassen kan niet
    const m2 = await lees(MEDEWERKER);
    const goed: AppState = { ...m2, ruil: m2.ruil.map((x) => (x.id === r.id ? { ...x, status: 'goedgekeurd' } : x)) };
    await expect(voerUit(pgDb(pg, MEDEWERKER), verschil(m2, goed, 'medewerker'), { rol: 'medewerker' })).rejects.toThrow(/mag je niet|row-level security/);
    const rooster: AppState = { ...m2, rooster: { Utrecht: { [ids.tessa]: { [d(6)]: '1' } } } };
    await expect(voerUit(pgDb(pg, MEDEWERKER), verschil(m2, rooster, 'medewerker'), { rol: 'medewerker' })).rejects.toThrow(/row-level security/);
  });

  it('de planner biedt een maand aan, de regiomanager keurt goed: de database houdt de geschiedenis bij', async () => {
    const p0 = await lees(PLANNER);
    const op = nowStamp();
    const g: Goedkeuring = { regio: 'Utrecht', maand: M2, status: 'ter_goedkeuring', versie: 'v', cijfer: 8.6, hard: 0, aangevraagd: op, door: 'Plan', advies: { kleur: 'groen', door: 'Plan', op }, geschiedenis: [] };
    const p1: AppState = { ...p0, goedkeuringen: { ...p0.goedkeuringen, Utrecht: { ...p0.goedkeuringen.Utrecht, [M2]: g } } };
    await voerUit(pgDb(pg, PLANNER), verschil(p0, p1, 'planner'), { rol: 'planner' });
    const r0 = await lees(REGIOMANAGER);
    const r1: AppState = { ...r0, goedkeuringen: { ...r0.goedkeuringen, Utrecht: { ...r0.goedkeuringen.Utrecht, [M2]: { ...r0.goedkeuringen.Utrecht[M2], status: 'goedgekeurd', beoordeeld: nowStamp(), beoordeelaar: 'Rianne' } } } };
    const ops = verschil(r0, r1, 'regiomanager');
    // bijwerken, geen upsert: de RLS voor invoegen is alleen voor de planner
    expect(ops).toEqual([expect.objectContaining({ tabel: 'rp_goedkeuring', soort: 'update' })]);
    await voerUit(pgDb(pg, REGIOMANAGER), ops, { rol: 'regiomanager' });
    const na = (await lees(REGIOMANAGER)).goedkeuringen.Utrecht[M2];
    expect(na.status).toBe('goedgekeurd');
    expect(na.geschiedenis.map((x) => x.soort)).toEqual(['advies', 'goedgekeurd']);
  });

  it('de opslag zelf: laden, een actie en bewaren gaat naar de database; wat de RLS weigert, wordt teruggedraaid', async () => {
    koppelDb(pgDb(pg, PLANNER));
    zetGebruiker('planner');
    await laad();
    expect(getState().medewerkers.some((m) => m.regio === 'Amsterdam')).toBe(true);
    zetCellen('Utrecht', [[ids.tessa, d(7), 'DG2']]);
    await bewaarNu();
    expect(opslagFoutNu()).toBeNull();
    expect((await lees(BEHEER)).rooster.Utrecht[ids.tessa][d(7)]).toBe('DG2');

    koppelDb(pgDb(pg, MEDEWERKER));
    zetGebruiker('medewerker');
    await laad();
    zetCellen('Utrecht', [[ids.tessa, d(8), '1']]);
    await bewaarNu();
    expect(opslagFoutNu()).toMatch(/mag je niet wijzigen/);
    // opnieuw gelezen: de medewerker ziet geen (ongepubliceerd) rooster, en de dienst staat er niet
    expect(getState().rooster).toEqual({});
    expect((await lees(BEHEER)).rooster.Utrecht[ids.tessa][d(8)]).toBeUndefined();
    koppelDb(null);
  });
});

describe('een onderdeel dat niet kan worden gelezen', () => {
  it('de rest staat er toch, dat onderdeel wordt niet overschreven, en opnieuw proberen haalt het alsnog op', async () => {
    const echt = pgDb(pg, BEHEER);
    let kapot = true;
    const db: Db = { ...echt, lees: (t, o) => (kapot && t === 'rp_medewerker' ? Promise.reject(new Error('rp_medewerker: time-out')) : echt.lees(t, o)) };
    const { staat, mislukt } = await laadDelenVeilig(db, vandaag, undefined, 0);
    expect(mislukt).toEqual([{ deel: 'medewerkers', fout: 'rp_medewerker: time-out' }]);
    expect(staat.medewerkers).toBeUndefined();
    expect(Object.keys(staat.rooster ?? {}).length).toBeGreaterThan(0);
    expect(staat.meldingen).toBeDefined();

    koppelDb(db);
    zetGebruiker('beheerder');
    await laad();
    expect(leesFoutNu().map((x) => x.deel)).toEqual(['medewerkers']);
    expect(getState().medewerkers).toEqual([]);
    // geen testomgeving met een halve kopie: eerst opnieuw proberen
    await expect(startTest()).rejects.toThrow(/Niet alles kon worden opgehaald/);
    expect(opslagwijze()).toBe('database');
    expect(Object.keys(getState().rooster).length).toBeGreaterThan(0);
    // een nieuwe medewerker wordt niet bewaard zolang de teams niet zijn gelezen (dat zou de rest overschrijven)
    bewaarMedewerker({ regio: 'Utrecht', naam: 'Tijdens storing', contract: 24, voorkeur: 'O', weekendgroep: 0 });
    await bewaarNu();
    expect(opslagFoutNu()).toMatch(/Niet bewaard: wijzigingen in de teams/);
    expect((await lees(BEHEER)).medewerkers.some((m) => m.naam === 'Tijdens storing')).toBe(false);

    kapot = false;
    await leesOpnieuw();
    expect(leesFoutNu()).toEqual([]);
    expect(getState().medewerkers.map((m) => m.id).sort()).toEqual((await lees(BEHEER)).medewerkers.map((m) => m.id).sort());
    koppelDb(null);
  });
});

describe('uitproberen zonder de echte gegevens', () => {
  it('in de gedeelde database geen voorbeeldteam: uitproberen doe je in de testomgeving', async () => {
    koppelDb(pgDb(pg, BEHEER));
    zetGebruiker('beheerder');
    await laad();
    const voor = getState().medewerkers.length;
    expect(() => voorbeeldTeamToevoegen('Utrecht')).toThrow(/testomgeving/);
    expect(getState().medewerkers).toHaveLength(voor);
    koppelDb(null);
  });

  it('de testomgeving: een kopie om mee te spelen; er gaat niets naar de database, en terug naar echt haalt die weer op', async () => {
    koppelDb(pgDb(pg, PLANNER));
    zetGebruiker('planner');
    await laad();
    expect(opslagwijze()).toBe('database');
    const voor = await lees(BEHEER);
    const was = getState().rooster.Utrecht?.[ids.anouk]?.[d(1)];
    await startTest();
    expect(opslagwijze()).toBe('test');
    // in de test: een medewerker erbij, een dienst anders, een verlofaanvraag en een NBD-dienst met een taak
    const id = bewaarMedewerker({ regio: 'Utrecht', naam: 'Test T.', contract: 24, voorkeur: 'O', weekendgroep: 0 });
    zetCellen('Utrecht', [[ids.anouk, d(1), 'V']]);
    vraagVerlofAan({ medewerkerId: ids.tessa, van: d(20), tot: d(21), soort: 'vakantie' }, 'Tessa');
    zetNbdDiensten([[ids.nina, d(3), 'N', { start: 9, eind: 17.5, pauze: 30, taken: [{ soort: 'training', van: 10, tot: 10.5 }] }]]);
    await bewaarNu();
    expect(getState().medewerkers.some((m) => m.id === id)).toBe(true);
    expect(getState().rooster.Utrecht[ids.anouk][d(1)]).toBe('V');
    // de database is niet veranderd
    expect(await lees(BEHEER)).toEqual(voor);
    // terug naar echt: de test is weg, de echte gegevens staan er weer
    await stopTest();
    expect(opslagwijze()).toBe('database');
    expect(opslagFoutNu()).toBeNull();
    expect(getState().medewerkers.some((m) => m.id === id)).toBe(false);
    expect(getState().rooster.Utrecht?.[ids.anouk]?.[d(1)]).toBe(was);
    expect(await lees(BEHEER)).toEqual(voor);
    koppelDb(null);
  });

  it('de vingerafdruk van het NBD-rooster: ook de taken tellen mee, zonder taken blijft hij gelijk', () => {
    const v = roosterVersie(NBD, d(1), d(3));
    zetNbdDiensten([[ids.nina, d(1), 'N', { start: 8.5, eind: 17, pauze: 30, pauzeStart: 12.75 }]]);
    expect(roosterVersie(NBD, d(1), d(3))).toBe(v);
    zetNbdDiensten([[ids.nina, d(1), 'N', { start: 8.5, eind: 17, pauze: 30, pauzeStart: 12.75, taken: [{ soort: 'training', van: 9, tot: 9.5 }] }]]);
    expect(roosterVersie(NBD, d(1), d(3))).not.toBe(v);
  });
});
