// @vitest-environment node
/** Vaststelling per maand: vier ogen (§ 5.1), en lopende zaken in een voorbije maand die nog bij de regiomanager ligt. */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { maakOmgeving, uid, BEHEER, PLANNER, REGIOMANAGER } from './pgdb';

let db: PGlite;
async function als<T = Record<string, unknown>>(wie: number | null, sql: string): Promise<T[]> {
  await db.exec(`reset role; update auth.sessie set uid = ${wie ? `'${uid(wie)}'` : 'null'};${wie ? ' set role authenticated;' : ''}`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const maand = async (k: number) => (await als<{ m: string }>(null, `select to_char(current_date + interval '${k} month', 'YYYY-MM') as m`))[0].m;
const aanbieden = (m: string, door: string) => `insert into rp_goedkeuring (regio, maand, status, versie, cijfer, door, advies, advies_door) values ('Utrecht', '${m}', 'ter_goedkeuring', 'v1', 8, '${door}', 'groen', '${door}')`;
const besluit = (m: string, status: string, door: string) => `update rp_goedkeuring set status = '${status}', beoordeelaar = '${door}', reden = 'Toelichting bij het besluit' where regio = 'Utrecht' and maand = '${m}' returning status`;

beforeAll(async () => { db = await maakOmgeving(); }, 60_000);

describe('vier ogen', () => {
  it('de beheerder die het advies gaf, keurt die maand niet zelf goed of af', async () => {
    const m = await maand(1);
    await als(BEHEER, aanbieden(m, 'Beheer'));
    await expect(als(BEHEER, besluit(m, 'goedgekeurd', 'Beheer'))).rejects.toThrow(/GRIP_VIER_OGEN/);
    await expect(als(BEHEER, besluit(m, 'afgekeurd', 'Beheer'))).rejects.toThrow(/GRIP_VIER_OGEN/);
    // een ander (de regiomanager van de regio) wel
    expect(await als(REGIOMANAGER, besluit(m, 'goedgekeurd', 'Rianne'))).toEqual([{ status: 'goedgekeurd' }]);
  });

  it('wie het advies gaf, legt de database zelf vast: de app kan het niet invullen of overschrijven', async () => {
    const m = await maand(2);
    await als(PLANNER, `${aanbieden(m, 'Plan').replace('advies_door)', 'advies_door, advies_uid)').replace("'Plan')", `'Plan', '${uid(REGIOMANAGER)}')`)}`);
    expect((await als<{ a: string }>(null, `select advies_uid::text as a from rp_goedkeuring where maand = '${m}'`))[0].a).toBe(uid(PLANNER));
    await als(REGIOMANAGER, `update rp_goedkeuring set versie = 'v2', advies_uid = '${uid(REGIOMANAGER)}' where maand = '${m}'`);
    expect((await als<{ a: string }>(null, `select advies_uid::text as a from rp_goedkeuring where maand = '${m}'`))[0].a).toBe(uid(PLANNER));
    // de beheerder mag als achtervang goedkeuren als een ander het advies gaf
    expect(await als(BEHEER, besluit(m, 'goedgekeurd', 'Beheer'))).toEqual([{ status: 'goedgekeurd' }]);
  });

  it('een nieuw advies na afkeuren legt de nieuwe adviseur vast', async () => {
    const m = await maand(3);
    await als(PLANNER, aanbieden(m, 'Plan'));
    await als(REGIOMANAGER, besluit(m, 'afgekeurd', 'Rianne'));
    await als(BEHEER, `update rp_goedkeuring set status = 'ter_goedkeuring', advies_op = now() + interval '1 second', advies_door = 'Beheer', reden = null where maand = '${m}'`);
    await expect(als(BEHEER, besluit(m, 'goedgekeurd', 'Beheer'))).rejects.toThrow(/GRIP_VIER_OGEN/);
    expect(await als(REGIOMANAGER, besluit(m, 'goedgekeurd', 'Rianne'))).toEqual([{ status: 'goedgekeurd' }]);
  });
});

describe('een voorbije maand die nog bij de regiomanager ligt', () => {
  it('lopende zaken (de versie) gaan door; opnieuw aanbieden niet; beoordelen wel', async () => {
    const vorige = await maand(-1);
    // nog door de server aangeboden, toen de maand nog niet voorbij was
    await als(null, aanbieden(vorige, 'Plan'));
    expect(await als(PLANNER, `update rp_goedkeuring set versie = 'v2' where maand = '${vorige}' returning versie`)).toEqual([{ versie: 'v2' }]);
    expect(await als(REGIOMANAGER, `update rp_goedkeuring set versie = 'v3' where maand = '${vorige}' returning versie`)).toEqual([{ versie: 'v3' }]);
    await expect(als(PLANNER, `update rp_goedkeuring set advies = 'oranje', advies_toelichting = 'Toch krapper dan gedacht' where maand = '${vorige}'`)).rejects.toThrow(/al voorbij/);
    await expect(als(PLANNER, aanbieden(await maand(-2), 'Plan'))).rejects.toThrow(/al voorbij/);
    expect(await als(REGIOMANAGER, besluit(vorige, 'goedgekeurd', 'Rianne'))).toEqual([{ status: 'goedgekeurd' }]);
  });
});
