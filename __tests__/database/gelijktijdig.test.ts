// @vitest-environment node
/**
 * Tegelijk opslaan, met twee echte, onafhankelijke databaseverbindingen (elk een eigen transactie). De ene verbinding
 * houdt een transactie open terwijl de andere dezelfde rij opslaat; zo overlappen de twee echt.
 *
 * Draait alleen met een echte Postgres-server (GRIP_TEST_PG, zie echtdb.ts); in de CI altijd.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Client } from 'pg';
import { addDays, todayIso } from '@/lib/dates';
import { BEHEER, PLANNER, SCHEMA } from './pgdb';
import { ECHT_PG, maakEchteDb, verbinding, wachtNog } from './echtdb';

const ANNA = '44444444-4444-4444-4444-444444444444';
const vandaag = todayIso();
const dag = (n: number) => addDays(vandaag, n);

const cel = (datum: string, dienst: string, controle: number) => [{
  tabel: 'rp_rooster', soort: 'upsert', sleutel: ['medewerker_id', 'datum'],
  rijen: [{ medewerker_id: ANNA, datum, regio: 'Utrecht', dienst }], controles: [controle],
}];
const weg = (datum: string, controle: number) => [{
  tabel: 'rp_rooster', soort: 'delete', sleutel: ['medewerker_id', 'datum'], rijen: [{ medewerker_id: ANNA, datum }], controles: [controle],
}];
const bewaar = (c: Client, stappen: unknown) => c.query('select rp_bewaar($1::jsonb) as uit', [JSON.stringify(stappen)]);

async function omgeving(schema = SCHEMA) {
  const db = await maakEchteDb(schema);
  const eigenaar = await verbinding(db.url, null);
  await eigenaar.query(
    `insert into rp_medewerker (id, regio, naam, contract, voorkeur, weekendgroep, functie, afstandsverklaring, extern, actief)
     values ($1, 'Utrecht', 'Anna A.', 32, 'O', 0, 'UV', false, false, true)`, [ANNA]);
  const nu = async (datum: string) => {
    const r = await eigenaar.query('select dienst, rij_versie from rp_rooster where medewerker_id = $1 and datum = $2', [ANNA, datum]);
    return r.rows[0] ? { dienst: r.rows[0].dienst as string, versie: Number(r.rows[0].rij_versie) } : null;
  };
  const zet = (datum: string, dienst: string) => eigenaar.query(`insert into rp_rooster (medewerker_id, datum, regio, dienst) values ($1, $2, 'Utrecht', $3)`, [ANNA, datum, dienst]);
  return { db, eigenaar, nu, zet };
}

describe.skipIf(!ECHT_PG)('tegelijk opslaan met twee verbindingen', () => {
  let o: Awaited<ReturnType<typeof omgeving>>;
  let a: Client, b: Client;
  beforeAll(async () => {
    o = await omgeving();
    a = await verbinding(o.db.url, PLANNER);
    b = await verbinding(o.db.url, PLANNER);
  }, 60_000);
  afterAll(async () => {
    for (const c of [a, b, o?.eigenaar]) await c?.end();
    await o?.db.weg();
  });
  // een mislukte test laat geen open transactie achter voor de volgende
  afterEach(async () => {
    for (const c of [a, b]) await c?.query('rollback').catch(() => undefined);
  });

  it('dezelfde rij: de tweede wacht op de eerste en krijgt dan een conflict', async () => {
    const d = dag(10);
    await o.zet(d, '1'); // beide planners kennen versie 1
    await a.query('begin');
    await bewaar(a, cel(d, '2', 1)); // de rij is vergrendeld, nog niet vastgelegd
    const tweede = bewaar(b, cel(d, 'O', 1));
    expect(await wachtNog(tweede)).toBe(true);
    await a.query('commit');
    await expect(tweede).rejects.toThrow(/GRIP_CONFLICT rp_rooster/);
    expect(await o.nu(d)).toEqual({ dienst: '2', versie: 2 });
  });

  it('dezelfde nieuwe rij: wie als tweede invoegt, krijgt een conflict', async () => {
    const d = dag(11);
    await a.query('begin');
    await bewaar(a, cel(d, 'DG1', 0));
    const tweede = bewaar(b, cel(d, '1', 0));
    expect(await wachtNog(tweede)).toBe(true);
    await a.query('commit');
    await expect(tweede).rejects.toThrow(/GRIP_CONFLICT rp_rooster/);
    expect(await o.nu(d)).toEqual({ dienst: 'DG1', versie: 1 });
  });

  it('weghalen terwijl een ander wijzigt: conflict, niets overschreven', async () => {
    const d = dag(12);
    await o.zet(d, '1');
    await a.query('begin');
    await bewaar(a, cel(d, '2', 1));
    const tweede = bewaar(b, weg(d, 1));
    expect(await wachtNog(tweede)).toBe(true);
    await a.query('commit');
    await expect(tweede).rejects.toThrow(/GRIP_CONFLICT rp_rooster/);
    expect(await o.nu(d)).toEqual({ dienst: '2', versie: 2 });
  });

  it('trekt de eerste zijn wijziging terug, dan gaat de tweede gewoon door', async () => {
    const d = dag(13);
    await o.zet(d, '1');
    await a.query('begin');
    await bewaar(a, cel(d, '2', 1));
    const tweede = bewaar(b, cel(d, 'O', 1));
    expect(await wachtNog(tweede)).toBe(true);
    await a.query('rollback');
    await tweede;
    expect(await o.nu(d)).toEqual({ dienst: 'O', versie: 2 });
  });

  it('verschillende rijen hinderen elkaar niet', async () => {
    const d1 = dag(14), d2 = dag(15);
    await a.query('begin');
    await bewaar(a, cel(d1, '1', 0));
    // b wacht niet op a: een andere rij
    await bewaar(b, cel(d2, '2', 0));
    await a.query('commit');
    expect(await o.nu(d1)).toEqual({ dienst: '1', versie: 1 });
    expect(await o.nu(d2)).toEqual({ dienst: '2', versie: 1 });
  });

  it('de dagelijkse voorspelling: van twee gelijktijdige starts krijgt er één de taak', async () => {
    const x = await verbinding(o.db.url, BEHEER), y = await verbinding(o.db.url, BEHEER);
    const status = { datum: vandaag, status: 'gestart', gestart: `${vandaag}T06:00:00`, waar: 'server' };
    const claim = (c: Client) => c.query('select * from rp_dagtaak_claim($1::jsonb, 20)', [JSON.stringify(status)]);
    try {
      await x.query('begin');
      const eerste = await claim(x);
      expect(eerste.rows).toHaveLength(1);
      const tweede = claim(y);
      expect(await wachtNog(tweede)).toBe(true);
      await x.query('commit');
      expect((await tweede).rows).toHaveLength(0);
      // ook daarna niet: hij loopt nog
      expect((await claim(y)).rows).toHaveLength(0);
    } finally {
      await x.end();
      await y.end();
    }
  });
});

describe.skipIf(!ECHT_PG)('controle van de test zelf: zonder vergrendeling gaat het mis', () => {
  it('de tweede overschrijft dan de eerste zonder dat iemand het merkt', async () => {
    const zonderSlot = SCHEMA.replace(' for update of d', '');
    expect(zonderSlot).not.toBe(SCHEMA);
    const o = await omgeving(zonderSlot);
    const a = await verbinding(o.db.url, PLANNER), b = await verbinding(o.db.url, PLANNER);
    try {
      const d = dag(10);
      await o.zet(d, '1');
      await a.query('begin');
      await bewaar(a, cel(d, '2', 1));
      const tweede = bewaar(b, cel(d, 'O', 1));
      expect(await wachtNog(tweede)).toBe(true);
      await a.query('commit');
      await tweede; // geen conflict ...
      expect((await o.nu(d))?.dienst).toBe('O'); // ... en de wijziging van a is weg
    } finally {
      for (const c of [a, b, o.eigenaar]) await c.end();
      await o.db.weg();
    }
  }, 60_000);
});
