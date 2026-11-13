// @vitest-environment node
/** Meldingen verdelen in de gedeelde database: bewaren en teruglezen, en wie erbij mag. */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { getState, vulAan } from '@/lib/store/store';
import { laadDelenVeilig } from '@/lib/store/db/laden';
import { verschil } from '@/lib/store/db/verschil';
import { voerUit } from '@/lib/store/db/db';
import { todayIso } from '@/lib/dates';
import type { AppState } from '@/lib/store/types';
import type { DagVerdeling } from '@/lib/verdeling/dag';
import { MEDEWERKER, PLANNER, maakOmgeving, pgDb } from './pgdb';

beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });

const vandaag = todayIso();
const leeg = getState();
const ID = '33333333-3333-3333-3333-333333333333';
const medewerker = { id: ID, regio: 'Utrecht', naam: 'Anna A.', contract: 32, voorkeur: 'O', weekendgroep: 0, functie: 'UV', afstandsverklaring: false, extern: false, email: null, actief: true };
const verdeling: DagVerdeling = {
  datum: vandaag,
  meldingen: [{ id: 'M1', postcode: '3511', regio: 'Utrecht' }, { id: 'M2', postcode: '3521', regio: 'Utrecht', tijd: 780 }],
  toewijzingen: [{ meldingId: 'M1', persoonId: ID, slotId: `${ID}#0`, start: 600, reistijd: 12, vast: true }],
  verdeeld: `${vandaag}T07:02:00`, door: 'Plan',
};
const lees = async (pg: PGlite, wie: number | null) => {
  const g = await laadDelenVeilig(pgDb(pg, wie), vandaag);
  expect(g.mislukt).toEqual([]);
  return vulAan({ ...leeg, ...g.staat, geladen: true });
};

describe('de verdeling in de database', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await maakOmgeving();
    await voerUit(pgDb(pg, null), [{ soort: 'upsert', tabel: 'rp_medewerker', rijen: [medewerker] }], { rol: 'beheerder' });
  }, 60_000);

  it('de planner bewaart de meldingen, de verdeling en een woonplaats; die komen zo terug', async () => {
    const p0 = await lees(pg, PLANNER);
    expect(p0.verdelingen).toEqual({});
    const p1: AppState = { ...p0, verdelingen: { [vandaag]: verdeling }, medewerkers: p0.medewerkers.map((m) => (m.id === ID ? { ...m, postcode: '3511' } : m)) };
    const ops = verschil(p0, p1, 'planner');
    expect(ops.map((o) => `${o.tabel}:${o.soort}`).sort()).toEqual(['rp_medewerker:upsert', 'rp_verdeling:upsert']);
    await voerUit(pgDb(pg, PLANNER), ops, { rol: 'planner' });
    const terug = await lees(pg, PLANNER);
    expect(terug.verdelingen[vandaag]).toEqual(verdeling);
    expect(terug.medewerkers.find((m) => m.id === ID)!.postcode).toBe('3511');
    // nog eens verdeeld: dezelfde rij, bijgewerkt
    const p2: AppState = { ...terug, verdelingen: { [vandaag]: { ...verdeling, toewijzingen: [] } } };
    await voerUit(pgDb(pg, PLANNER), verschil(terug, p2, 'planner'), { rol: 'planner' });
    expect((await lees(pg, PLANNER)).verdelingen[vandaag].toewijzingen).toEqual([]);
    expect((await pg.query<{ n: number }>('select count(*)::int n from rp_verdeling')).rows[0].n).toBe(1);
  });

  it('een medewerker ziet de verdeling niet en kan hem niet wijzigen', async () => {
    const m0 = await lees(pg, MEDEWERKER);
    expect(m0.verdelingen).toEqual({});
    await expect(voerUit(pgDb(pg, MEDEWERKER), [{ soort: 'upsert', tabel: 'rp_verdeling', rijen: [{ datum: vandaag, data: verdeling }] }], { rol: 'medewerker' })).rejects.toThrow(/row-level security/);
  });

  it('een woonplaats is alleen een postcode van 4 cijfers', async () => {
    await expect(pg.query(`update rp_medewerker set postcode = '3511 AB' where id = '${ID}'`)).rejects.toThrow(/postcode_check/);
    await expect(pg.query(`update rp_medewerker set postcode = '0123' where id = '${ID}'`)).rejects.toThrow(/postcode_check/);
  });
});
