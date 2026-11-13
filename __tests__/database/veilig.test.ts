// @vitest-environment node
/**
 * Veilig opslaan: alles of niets in één transactie, versiecontrole tussen twee planners, en de rechten op verlof en
 * publiceren zoals de database ze afdwingt.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { getState, vulAan } from '@/lib/store/store';
import { laadDelenVeilig, type Deel } from '@/lib/store/db/laden';
import { verschil } from '@/lib/store/db/verschil';
import { conflictTabel, voerUit, type Db } from '@/lib/store/db/db';
import { Versies } from '@/lib/store/db/versies';
import { addDays, todayIso } from '@/lib/dates';
import { maandEind, maandStart, maandVan, volgendeMaand } from '@/lib/rooster/maand';
import type { AppState } from '@/lib/store/types';
import { BEHEER, PLANNER, REGIOMANAGER, maakOmgeving, pgDb } from './pgdb';

beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });

const vandaag = todayIso();
const leeg = getState();
const ANNA = '44444444-4444-4444-4444-444444444444', BRAM = '55555555-5555-5555-5555-555555555555';
const mw = (id: string, naam: string) => ({ id, regio: 'Utrecht', naam, contract: 32, voorkeur: 'O', weekendgroep: 0, functie: 'UV', afstandsverklaring: false, extern: false, email: null, actief: true });
const D = addDays(vandaag, 10), E = addDays(vandaag, 11), F = addDays(vandaag, 12);

/** Een gebruiker met een eigen kijk op de database: de staat zoals gelezen, en de versies die erbij horen. */
async function sessie(pg: PGlite, wie: number, delen: Deel[] = ['medewerkers', 'rooster', 'verlof']) {
  const db: Db = pgDb(pg, wie);
  const versies = new Versies();
  const { staat, perDeel } = await laadDelenVeilig(db, vandaag, delen);
  for (const x of Object.values(perDeel)) versies.vervang(x.ronde);
  let basis: AppState = vulAan({ ...leeg, ...staat, geladen: true });
  return {
    get staat() { return basis; },
    /** Wijzig de staat en bewaar het verschil, met versiecontrole. */
    async bewaar(wijzig: (s: AppState) => AppState, rol: 'planner' | 'regiomanager' | 'beheerder' = 'planner') {
      const nieuw = wijzig(basis);
      const ops = verschil(basis, nieuw, rol);
      const v = await voerUit(db, ops, { rol, controle: (t, r, n) => versies.controle(t, r, n) });
      versies.naSchrijven(v, ops);
      basis = nieuw;
    },
  };
}

const metCel = (s: AppState, mid: string, datum: string, dienst: string): AppState => ({
  ...s,
  rooster: { ...s.rooster, Utrecht: { ...(s.rooster.Utrecht ?? {}), [mid]: { ...(s.rooster.Utrecht?.[mid] ?? {}), [datum]: dienst as never } } },
});
const cel = async (pg: PGlite, mid: string, datum: string) =>
  (await pg.query<{ dienst: string }>('select dienst from rp_rooster where medewerker_id = $1 and datum = $2', [mid, datum])).rows[0]?.dienst ?? null;

describe('alles of niets', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await maakOmgeving();
    await voerUit(pgDb(pg, null), [{ soort: 'upsert', tabel: 'rp_medewerker', rijen: [mw(ANNA, 'Anna A.')] }], { rol: 'beheerder' });
  }, 60_000);

  it('mislukt één onderdeel, dan blijft er niets van staan', async () => {
    const m1 = volgendeMaand(maandVan(vandaag));
    // eerst een dienst, daarna een publicatie van een maand die nog niet is vastgesteld: die weigert de database
    await expect(voerUit(pgDb(pg, PLANNER), [
      { soort: 'upsert', tabel: 'rp_rooster', rijen: [{ medewerker_id: ANNA, datum: D, regio: 'Utrecht', dienst: '1' }] },
      { soort: 'upsert', tabel: 'rp_publicatie', rijen: [{ regio: 'Utrecht', door: 'Plan', van: maandStart(m1), tot: maandEind(m1), vorige: null }] },
    ], { rol: 'planner' })).rejects.toThrow(/nog niet vastgesteld/);
    expect(await cel(pg, ANNA, D)).toBeNull();
    // zonder de publicatie gaat het wel
    await voerUit(pgDb(pg, PLANNER), [{ soort: 'upsert', tabel: 'rp_rooster', rijen: [{ medewerker_id: ANNA, datum: D, regio: 'Utrecht', dienst: '1' }] }], { rol: 'planner' });
    expect(await cel(pg, ANNA, D)).toBe('1');
  });

  it('een bijwerking of verwijdering die de rechten stil overslaan, wordt een fout', async () => {
    const id = '66666666-6666-6666-6666-666666666666';
    await voerUit(pgDb(pg, null), [{ soort: 'upsert', tabel: 'rp_verlof', rijen: [{ id, medewerker_id: ANNA, regio: 'Utrecht', van: E, tot: F, soort: 'vakantie', status: 'goedgekeurd' }] }], { rol: 'beheerder' });
    await expect(voerUit(pgDb(pg, PLANNER), [{ soort: 'delete', tabel: 'rp_verlof', sleutels: [{ id }] }], { rol: 'planner' })).rejects.toThrow(/permission denied/);
    expect((await pg.query('select 1 from rp_verlof where id = $1', [id])).rows).toHaveLength(1);
  });
});

describe('twee planners tegelijk', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await maakOmgeving();
    await voerUit(pgDb(pg, null), [
      { soort: 'upsert', tabel: 'rp_medewerker', rijen: [mw(ANNA, 'Anna A.'), mw(BRAM, 'Bram B.')] },
      { soort: 'upsert', tabel: 'rp_rooster', rijen: [{ medewerker_id: ANNA, datum: D, regio: 'Utrecht', dienst: '1' }, { medewerker_id: BRAM, datum: D, regio: 'Utrecht', dienst: '1M' }] },
    ], { rol: 'beheerder' });
  }, 60_000);

  it('wie een verouderde dienst wijzigt, krijgt een conflict; de dienst van de ander blijft staan', async () => {
    const a = await sessie(pg, PLANNER), b = await sessie(pg, BEHEER);
    await a.bewaar((s) => metCel(s, ANNA, D, '2'));
    expect(await cel(pg, ANNA, D)).toBe('2');
    const fout = await b.bewaar((s) => metCel(s, ANNA, D, 'DG2'), 'beheerder').catch((e) => e);
    expect(conflictTabel(fout)).toBe('rp_rooster');
    expect(await cel(pg, ANNA, D)).toBe('2');
    // wie het net zelf wijzigde, kan meteen weer verder (de nieuwe versie is bekend)
    await a.bewaar((s) => metCel(s, ANNA, D, 'DG1'));
    expect(await cel(pg, ANNA, D)).toBe('DG1');
    // een andere dienst wijzigen kan wel, ook met een oudere stand
    const c = await sessie(pg, BEHEER);
    await a.bewaar((s) => metCel(s, ANNA, D, '1'));
    await c.bewaar((s) => metCel(s, BRAM, D, 'DG2'), 'beheerder');
    expect(await cel(pg, BRAM, D)).toBe('DG2');
  });

  it('twee planners vullen dezelfde lege dag: de tweede krijgt een conflict', async () => {
    const a = await sessie(pg, PLANNER), b = await sessie(pg, BEHEER);
    await a.bewaar((s) => metCel(s, ANNA, E, '1'));
    const fout = await b.bewaar((s) => metCel(s, ANNA, E, '1M'), 'beheerder').catch((e) => e);
    expect(conflictTabel(fout)).toBe('rp_rooster');
    expect(await cel(pg, ANNA, E)).toBe('1');
  });

  it('een dag die de app niet heeft ingeladen (ver terug), controleren we niet', async () => {
    const oud = addDays(vandaag, -400);
    await voerUit(pgDb(pg, null), [{ soort: 'upsert', tabel: 'rp_rooster', rijen: [{ medewerker_id: BRAM, datum: oud, regio: 'Utrecht', dienst: '1' }] }], { rol: 'beheerder' });
    const a = await sessie(pg, PLANNER);
    await a.bewaar((s) => metCel(s, BRAM, oud, '1M'));
    expect(await cel(pg, BRAM, oud)).toBe('1M');
  });

  it('verlof dat intussen is besloten, wordt niet overschreven', async () => {
    const id = '77777777-7777-7777-7777-777777777777';
    await voerUit(pgDb(pg, null), [{ soort: 'upsert', tabel: 'rp_verlof', rijen: [{ id, medewerker_id: BRAM, regio: 'Utrecht', van: E, tot: F, soort: 'vakantie', status: 'aangevraagd' }] }], { rol: 'beheerder' });
    const planner = await sessie(pg, PLANNER), rm = await sessie(pg, REGIOMANAGER);
    await rm.bewaar((s) => ({ ...s, verlof: s.verlof.map((v) => (v.id === id ? { ...v, status: 'goedgekeurd', beoordeelaar: 'Rianne' } : v)) }), 'regiomanager');
    const fout = await planner.bewaar((s) => ({ ...s, verlof: s.verlof.map((v) => (v.id === id ? { ...v, opmerking: 'toch korter' } : v)) })).catch((e) => e);
    expect(conflictTabel(fout)).toBe('rp_verlof');
    expect((await pg.query<{ status: string; opmerking: string | null }>('select status, opmerking from rp_verlof where id = $1', [id])).rows[0]).toEqual({ status: 'goedgekeurd', opmerking: null });
  });
});

describe('rechten op verlof per bewerking', () => {
  let pg: PGlite;
  const id = '88888888-8888-8888-8888-888888888888';
  beforeAll(async () => {
    pg = await maakOmgeving();
    await voerUit(pgDb(pg, null), [
      { soort: 'upsert', tabel: 'rp_medewerker', rijen: [mw(ANNA, 'Anna A.')] },
      { soort: 'upsert', tabel: 'rp_verlof', rijen: [{ id, medewerker_id: ANNA, regio: 'Utrecht', van: E, tot: F, soort: 'vakantie', status: 'goedgekeurd' }] },
    ], { rol: 'beheerder' });
  }, 60_000);

  it('wie niet besluit, zet goedgekeurd verlof niet terug naar een aanvraag en haalt het niet weg', async () => {
    await expect(voerUit(pgDb(pg, PLANNER), [{ soort: 'update', tabel: 'rp_verlof', sleutel: { id }, waarden: { status: 'aangevraagd' } }], { rol: 'planner' })).rejects.toThrow(/permission denied/);
    await expect(voerUit(pgDb(pg, PLANNER), [{ soort: 'delete', tabel: 'rp_verlof', sleutels: [{ id }] }], { rol: 'planner' })).rejects.toThrow(/permission denied/);
    expect((await pg.query<{ status: string }>('select status from rp_verlof where id = $1', [id])).rows[0].status).toBe('goedgekeurd');
  });

  it('een aanvraag invoeren en wijzigen kan de planner wel; weghalen alleen wie besluit', async () => {
    const nieuw = '99999999-9999-9999-9999-999999999999';
    await voerUit(pgDb(pg, PLANNER), [{ soort: 'insert', tabel: 'rp_verlof', rijen: [{ id: nieuw, medewerker_id: ANNA, regio: 'Utrecht', van: E, tot: E, soort: 'adv', status: 'aangevraagd' }] }], { rol: 'planner' });
    await voerUit(pgDb(pg, PLANNER), [{ soort: 'update', tabel: 'rp_verlof', sleutel: { id: nieuw }, waarden: { opmerking: 'halve dag' } }], { rol: 'planner' });
    await expect(voerUit(pgDb(pg, PLANNER), [{ soort: 'insert', tabel: 'rp_verlof', rijen: [{ medewerker_id: ANNA, regio: 'Utrecht', van: F, tot: F, soort: 'adv', status: 'goedgekeurd' }] }], { rol: 'planner' })).rejects.toThrow(/row-level security/);
    await voerUit(pgDb(pg, REGIOMANAGER), [{ soort: 'delete', tabel: 'rp_verlof', sleutels: [{ id: nieuw }] }], { rol: 'regiomanager' });
    expect((await pg.query('select 1 from rp_verlof where id = $1', [nieuw])).rows).toHaveLength(0);
  });
});

describe('publiceren: elke nieuwe maand vastgesteld', () => {
  let pg: PGlite;
  const m1 = volgendeMaand(maandVan(vandaag)), m2 = volgendeMaand(maandVan(vandaag), 2);
  const goedkeuring = (maand: string) => ({ regio: 'Utrecht', maand, status: 'goedgekeurd', versie: 'x', cijfer: 8, door: 'Plan', advies: 'groen', advies_door: 'Plan' });
  beforeAll(async () => {
    pg = await maakOmgeving();
    await voerUit(pgDb(pg, null), [
      { soort: 'insert', tabel: 'rp_goedkeuring', rijen: [goedkeuring(m2)] },
      { soort: 'upsert', tabel: 'rp_publicatie', rijen: [{ regio: 'Utrecht', door: 'Plan', van: maandStart(m2), tot: maandEind(m2), vorige: null }] },
    ], { rol: 'beheerder' });
  }, 60_000);

  it('uitbreiden aan het begin met een maand die niet is vastgesteld, kan niet', async () => {
    await expect(voerUit(pgDb(pg, PLANNER), [{ soort: 'update', tabel: 'rp_publicatie', sleutel: { regio: 'Utrecht' }, waarden: { van: maandStart(m1) } }], { rol: 'planner' })).rejects.toThrow(new RegExp(`${m1} is nog niet vastgesteld`));
    expect((await pg.query<{ van: string }>("select van::text from rp_publicatie where regio = 'Utrecht'")).rows[0].van).toBe(maandStart(m2));
  });

  it('is die maand wel vastgesteld, dan kan het', async () => {
    await voerUit(pgDb(pg, null), [{ soort: 'insert', tabel: 'rp_goedkeuring', rijen: [goedkeuring(m1)] }], { rol: 'beheerder' });
    await voerUit(pgDb(pg, PLANNER), [{ soort: 'update', tabel: 'rp_publicatie', sleutel: { regio: 'Utrecht' }, waarden: { van: maandStart(m1) } }], { rol: 'planner' });
    expect((await pg.query<{ van: string }>("select van::text from rp_publicatie where regio = 'Utrecht'")).rows[0].van).toBe(maandStart(m1));
  });
});
