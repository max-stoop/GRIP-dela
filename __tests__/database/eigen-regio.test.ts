// @vitest-environment node
/**
 * Ruilen en wensen in de eigen regio, en wensen bij het importeren van een jaarrooster, op Postgres (PGlite).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { maakOmgeving, pgDb, uid, MEDEWERKER, PLANNER, REGIOMANAGER } from './pgdb';
import { bewaarNu, getState, importeerJaarrooster, koppelDb, laad, opslagFoutNu, zetGebruiker } from '@/lib/store/store';
import { addDays, todayIso } from '@/lib/dates';
import type { DienstCode } from '@/lib/rooster/types';

let db: PGlite;

async function als<T = Record<string, unknown>>(wie: number | null, sql: string): Promise<T[]> {
  await db.exec(`reset role; update auth.sessie set uid = ${wie ? `'${uid(wie)}'` : 'null'};${wie ? ' set role authenticated;' : ''}`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const idVan = async (naam: string) => (await als<{ id: string }>(null, `select id from rp_medewerker where naam = '${naam}'`))[0].id;

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  db = await maakOmgeving();
  await db.exec(`
    insert into rp_medewerker (regio, naam, contract, email) values
      ('Utrecht', 'Tessa J.', 32, 'tessa@voorbeeld.nl'), ('Utrecht', 'Bas O.', 24, null), ('Amsterdam', 'Karin P.', 32, null);
  `);
}, 60_000);

describe('ruilen in de eigen regio', () => {
  it('aanbieden en ruilen alleen in de eigen regio, met een collega uit die regio en zonder besluit erbij', async () => {
    const [bas, karin] = [await idVan('Bas O.'), await idVan('Karin P.')];
    const ruil = (regio: string, ontvanger: string | null, extra = '') => `insert into rp_ruil (regio, soort, aanbieder_id, datum, dienst, ontvanger_id${extra ? ', beoordeelaar' : ''})
      values ('${regio}', '${ontvanger ? 'ruilen' : 'aanbieden'}', rp_mijn_medewerker(), current_date + 9, '1', ${ontvanger ? `'${ontvanger}'` : 'null'}${extra ? `, '${extra}'` : ''})`;
    await expect(als(MEDEWERKER, ruil('Amsterdam', null))).rejects.toThrow(/row-level security/);
    await expect(als(MEDEWERKER, ruil('Utrecht', karin))).rejects.toThrow(/row-level security/);
    await expect(als(MEDEWERKER, ruil('Utrecht', null, 'Planner'))).rejects.toThrow(/row-level security/);
    await als(MEDEWERKER, ruil('Utrecht', null));
    await als(MEDEWERKER, ruil('Utrecht', bas));
    expect((await als<{ n: number }>(null, "select count(*)::int n from rp_ruil where regio = 'Utrecht'"))[0].n).toBe(2);
  });
});

describe('regelplekken verschuiven', () => {
  it('wie in beide regio\'s plant, legt het vast; iedereen met een rol leest het', async () => {
    const rij = (van: string, naar: string) => `insert into rp_verschuiving (van_regio, naar_regio, van, tot, plekken, door) values ('${van}', '${naar}', current_date, current_date + 6, 1, 'Plan') returning id`;
    // de regiomanager heeft alleen de eigen regio
    await expect(als(REGIOMANAGER, rij('Utrecht', 'Arnhem'))).rejects.toThrow(/row-level security/);
    const [{ id }] = await als<{ id: string }>(PLANNER, rij('Utrecht', 'Arnhem'));
    await expect(als(PLANNER, rij('Utrecht', 'Utrecht'))).rejects.toThrow(/check constraint/);
    expect((await als<{ n: number }>(MEDEWERKER, 'select count(*)::int n from rp_verschuiving'))[0].n).toBe(1);
    expect(await als(MEDEWERKER, `delete from rp_verschuiving where id = '${id}' returning id`)).toEqual([]);
    expect(await als(PLANNER, `delete from rp_verschuiving where id = '${id}' returning id`)).toEqual([{ id }]);
  });
});

describe('wensen', () => {
  it('een medewerker zet een wens alleen in de eigen regio', async () => {
    const wens = (regio: string) => `insert into rp_wens (medewerker_id, regio, datum, soort) values (rp_mijn_medewerker(), '${regio}', current_date + 12, 'vrij')`;
    await expect(als(MEDEWERKER, wens('Amsterdam'))).rejects.toThrow(/row-level security/);
    await als(MEDEWERKER, wens('Utrecht'));
  });

  it('wie plant, beheert de wensen in de eigen regio(s): toevoegen, wijzigen en weghalen (ook bij meekijken als medewerker)', async () => {
    const [bas, karin] = [await idVan('Bas O.'), await idVan('Karin P.')];
    await als(PLANNER, `insert into rp_wens (medewerker_id, regio, datum, soort, opmerking) values ('${bas}', 'Utrecht', current_date + 20, 'vrij', 'uit het jaarrooster')`);
    // een planner heeft alle regio's; een regiomanager alleen de eigen
    await expect(als(REGIOMANAGER, `insert into rp_wens (medewerker_id, regio, datum, soort) values ('${karin}', 'Amsterdam', current_date + 20, 'vrij')`)).rejects.toThrow(/row-level security/);
    // niet een medewerker uit een andere regio onder de eigen regio
    await expect(als(PLANNER, `insert into rp_wens (medewerker_id, regio, datum, soort) values ('${karin}', 'Utrecht', current_date + 20, 'vrij')`)).rejects.toThrow(/row-level security/);
    await als(null, `insert into rp_wens (medewerker_id, regio, datum, soort) values ('${karin}', 'Amsterdam', current_date + 21, 'vrij')`);
    expect(await als(REGIOMANAGER, `update rp_wens set soort = 'werken' where medewerker_id = '${karin}' returning id`)).toEqual([]);
    expect(await als(REGIOMANAGER, `delete from rp_wens where medewerker_id = '${karin}' returning id`)).toEqual([]);
    expect(await als(PLANNER, `update rp_wens set soort = 'werken' where medewerker_id = '${bas}' returning soort`)).toEqual([{ soort: 'werken' }]);
    await expect(als(PLANNER, `update rp_wens set medewerker_id = '${karin}' where medewerker_id = '${bas}'`)).rejects.toThrow(/row-level security/);
    expect(await als(PLANNER, `delete from rp_wens where medewerker_id = '${bas}' returning soort`)).toEqual([{ soort: 'werken' }]);
  });

  it('een jaarrooster importeren met RV en NB als wens: alles wordt bewaard', async () => {
    koppelDb(pgDb(db, PLANNER));
    zetGebruiker('planner', 'plan@voorbeeld.nl', ['Utrecht']);
    await laad();
    const d = (n: number) => addDays(todayIso(), n);
    const r = importeerJaarrooster('Utrecht', 'UT', [{ nr: 1, contract: 32, cadans: 2, groep: 0, medewerkerId: null, diensten: { [d(30)]: '1' as DienstCode, [d(31)]: 'DG2' as DienstCode }, wensVrij: [d(32)] }], { alleenLeeg: false }, 'Plan');
    expect(r).toEqual({ nieuw: 1, diensten: 2, wensen: 1 });
    await bewaarNu();
    expect(opslagFoutNu()).toBeNull();
    const ut01 = getState().medewerkers.find((m) => m.naam === 'UT 01')!;
    expect((await als<{ soort: string }>(null, `select soort from rp_wens where medewerker_id = '${ut01.id}'`)).map((x) => x.soort)).toEqual(['vrij']);
    expect((await als<{ n: number }>(null, `select count(*)::int n from rp_rooster where medewerker_id = '${ut01.id}'`))[0].n).toBe(2);
    koppelDb(null);
  });
});

describe('een regiomanager ziet alleen de eigen regio\'s', () => {
  const zetRegios = (regios: string) => als(null, `update users set regios = '${regios}' where auth_id = '${uid(REGIOMANAGER)}'`);

  it('zonder regio\'s, of met een id die nergens naar wijst: niets, niet alles', async () => {
    await als(null, `insert into rp_rooster (medewerker_id, datum, regio, dienst) select id, current_date + 3, regio, '1' from rp_medewerker on conflict do nothing`);
    try {
      for (const regios of ['{}', '{99}']) {
        await zetRegios(regios);
        expect((await als<{ m: boolean }>(REGIOMANAGER, 'select rp_mag_alle() as m'))[0].m).toBe(false);
        expect(await als(REGIOMANAGER, 'select regio from rp_rooster')).toEqual([]);
        expect(await als(REGIOMANAGER, 'select email from rp_medewerker')).toEqual([]);
        expect(await als(REGIOMANAGER, "update rp_rooster set dienst = '2' where regio = 'Amsterdam' returning regio")).toEqual([]);
        expect((await als<{ m: boolean }>(REGIOMANAGER, "select rp_mag_cluster('NW') as m"))[0].m).toBe(false);
      }
      // met de eigen regio: alleen die
      await zetRegios('{1}');
      expect((await als<{ regio: string }>(REGIOMANAGER, 'select distinct regio from rp_rooster')).map((r) => r.regio)).toEqual(['Utrecht']);
      // een planner werkt landelijk, ook met één regio in users
      expect((await als<{ m: boolean }>(PLANNER, 'select rp_mag_alle() as m'))[0].m).toBe(true);
    } finally {
      await zetRegios('{1}');
    }
  });
});
