// @vitest-environment node
/**
 * Rollen bewaakt op Postgres (PGlite): niemand geeft zichzelf een andere rol, zonder profiel lees je niets, en een
 * maand gaat alleen met een advies ter goedkeuring.
 * In de testomgeving staat er geen RLS op users: dat is het ergste geval (iedereen mag de tabel bijwerken).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { maakOmgeving, uid, BEHEER, MEDEWERKER, PLANNER } from './pgdb';

let db: PGlite;
const ONBEKEND = 9;

async function als<T = Record<string, unknown>>(wie: number | null, sql: string): Promise<T[]> {
  await db.exec(`reset role; update auth.sessie set uid = ${wie ? `'${uid(wie)}'` : 'null'};${wie ? ' set role authenticated;' : ''}`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

beforeAll(async () => {
  db = await maakOmgeving();
  await db.exec(`insert into rp_instelling (sleutel, waarde) values ('beleid', '{"goedkeuringVerplicht": true}')`);
}, 60_000);

describe('de rol in users', () => {
  it('een medewerker maakt zichzelf geen beheerder en geeft zich geen andere regio of account', async () => {
    await expect(als(MEDEWERKER, `update users set rol = 'Planner' where auth_id = '${uid(MEDEWERKER)}'`)).rejects.toThrow(/alleen de beheerder/);
    await expect(als(MEDEWERKER, `update users set regios = '{1,2}' where auth_id = '${uid(MEDEWERKER)}'`)).rejects.toThrow(/alleen de beheerder/);
    await expect(als(MEDEWERKER, `update users set email = 'plan@voorbeeld.nl.x' where auth_id = '${uid(MEDEWERKER)}'`)).rejects.toThrow(/alleen de beheerder/);
    await expect(als(MEDEWERKER, `insert into users (auth_id, email, naam, rol) values ('${uid(ONBEKEND)}', 'x@voorbeeld.nl', 'X', 'Planner')`)).rejects.toThrow(/beheerder/);
    // een planner ook niet
    await expect(als(PLANNER, `update users set rol = 'Planner' where auth_id = '${uid(PLANNER)}'`)).rejects.toThrow(/alleen de beheerder/);
    expect((await als<{ rol: string }>(null, `select rol::text from users where auth_id = '${uid(MEDEWERKER)}'`))[0].rol).toBe('Uitvaartverzorger/Leider');
    // de eigen naam wel
    await als(MEDEWERKER, `update users set naam = 'Tessa J.' where auth_id = '${uid(MEDEWERKER)}'`);
  });

  it('de beheerder en de server wijzigen rollen wel', async () => {
    await als(BEHEER, `update users set rol = 'Regio Planner' where auth_id = '${uid(MEDEWERKER)}'`);
    await als(null, `update users set rol = 'Uitvaartverzorger/Leider' where auth_id = '${uid(MEDEWERKER)}'`);
    expect((await als<{ r: string }>(MEDEWERKER, 'select rp_rol() r'))[0].r).toBe('medewerker');
  });
});

describe('zonder profiel', () => {
  it('een account dat niet in GRIP staat, leest geen instellingen, normen, schoolvakanties of vakantierondes', async () => {
    await als(null, `insert into rp_schoolvakantie (id, naam, regio, van, tot) values ('kv', 'Kerstvakantie', 'alle', '2026-12-19', '2027-01-03')`);
    for (const t of ['rp_instelling', 'rp_norm_regio', 'rp_schoolvakantie', 'rp_vakantieronde']) expect(await als(ONBEKEND, `select * from ${t}`)).toEqual([]);
    expect((await als(MEDEWERKER, 'select * from rp_instelling')).length).toBe(1);
    expect((await als(MEDEWERKER, 'select * from rp_schoolvakantie')).length).toBe(1);
  });
});

describe('zonder profiel: geen klaargezette delen', () => {
  it('een account dat niet in GRIP staat, kan rp_bewaar_deel niet vullen; wie er wel in staat, wel', async () => {
    const deel = (wie: number) => `insert into rp_bewaar_deel (id, nr, stappen, eigenaar) values (gen_random_uuid(), 0, '[]', '${uid(wie)}')`;
    await expect(als(ONBEKEND, deel(ONBEKEND))).rejects.toThrow(/row-level security/);
    await als(MEDEWERKER, deel(MEDEWERKER));
  });
});

describe('vaststelling', () => {
  it('een maand gaat alleen met een advies ter goedkeuring', async () => {
    const maand = "to_char(current_date + interval '1 month', 'YYYY-MM')";
    await expect(als(PLANNER, `insert into rp_goedkeuring (regio, maand, status, versie, cijfer, hard, door) values ('Utrecht', ${maand}, 'ter_goedkeuring', 'v', 8, 0, 'Plan')`)).rejects.toThrow(/advies/);
    await als(PLANNER, `insert into rp_goedkeuring (regio, maand, status, versie, cijfer, hard, door, advies, advies_door) values ('Utrecht', ${maand}, 'ter_goedkeuring', 'v', 8, 0, 'Plan', 'groen', 'Plan')`);
  });
});
