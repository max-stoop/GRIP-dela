// @vitest-environment node
/**
 * De database in Azure: het schema zet de app zelf neer, de RLS geldt per werkaccount, de server werkt zonder RLS, en
 * elke wijziging geeft een seintje. Op PGlite altijd; met een echte Postgres (GRIP_TEST_PG) ook de verbindingen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Client, Pool } from 'pg';
import { alsGebruiker, alsServer, schemaSql, werkBij } from '@/lib/server/postgres';
import { beantwoord } from '@/lib/server/sql';
import { vraagDb } from '@/lib/store/db/vraag';
import { voerUit } from '@/lib/store/db/db';
import { voerDagtaakUit } from '@/lib/taken/dagelijks';
import { ECHT_PG } from '../database/echtdb';

const BEHEER = '00000000-0000-4000-8000-000000000001', PLANNER = '00000000-0000-4000-8000-000000000002', MW = '00000000-0000-4000-8000-000000000003';
const mw = { id: '11111111-1111-4111-8111-111111111111', regio: 'Utrecht', naam: 'Noor N.', contract: 24, voorkeur: 'O', weekendgroep: 0, functie: 'UV', afstandsverklaring: false, extern: false, email: null, actief: true };

describe('het schema voor Azure op PGlite', () => {
  it('basis, schema en live samen; twee keer achter elkaar kan ook', async () => {
    const pg = new PGlite();
    await pg.exec(schemaSql());
    await pg.exec(schemaSql());
    const r = await pg.query<{ n: number; nbd: boolean; v: number }>(`select (select count(*)::int from regios) n, exists(select 1 from regios where naam = 'NBD') nbd, rp_schema_versie() v`);
    expect(r.rows[0]).toEqual({ n: 26, nbd: true, v: 20261111 });
    const triggers = await pg.query<{ n: number }>(`select count(*)::int n from pg_trigger where tgname = 'grip_meld_wijziging'`);
    expect(triggers.rows[0].n).toBe(24);
  });
});

describe.skipIf(!ECHT_PG)('Azure op een echte Postgres', () => {
  let pool: Pool, naam: string;

  beforeAll(async () => {
    naam = `grip_azure_${Date.now()}`;
    const b = new Client({ connectionString: ECHT_PG });
    await b.connect();
    await b.query(`create database ${naam}`);
    await b.end();
    const u = new URL(ECHT_PG);
    u.pathname = `/${naam}`;
    pool = new Pool({ connectionString: u.toString() });
  });

  afterAll(async () => {
    await pool?.end();
    const b = new Client({ connectionString: ECHT_PG });
    await b.connect();
    await b.query(`drop database if exists ${naam} with (force)`);
    await b.end();
  });

  it('de app zet het schema neer, en daarna niet opnieuw zolang het niet verandert', async () => {
    expect(await werkBij(pool)).toBe(true);
    expect(await werkBij(pool)).toBe(false);
    const [a, b] = await Promise.all([werkBij(pool, `${schemaSql()}\n-- nieuw`), werkBij(pool, `${schemaSql()}\n-- nieuw`)]);
    expect([a, b].sort()).toEqual([false, true]);
    await pool.query(`insert into users (auth_id, email, naam, rol, regios) values
      ('${BEHEER}', 'beheer@voorbeeld.nl', 'Beheer', 'Planner', '{}'),
      ('${PLANNER}', 'plan@voorbeeld.nl', 'Plan', 'Regio Planner', '{}'),
      ('${MW}', 'mw@voorbeeld.nl', 'Mw', 'Uitvaartverzorger/Leider', array[(select id from regios where naam = 'Utrecht')])`);
  });

  it('per werkaccount de RLS: de eigen rij in users, en wat de rol mag', async () => {
    const db = (oid: string) => vraagDb((v) => alsGebruiker(pool, oid, (voer) => beantwoord(v, voer)));
    await voerUit(db(PLANNER), [{ soort: 'upsert', tabel: 'rp_medewerker', rijen: [mw] }], { rol: 'planner' });
    expect(await db(PLANNER).lees('rp_medewerker')).toHaveLength(1);
    await expect(voerUit(db(MW), [{ soort: 'upsert', tabel: 'rp_medewerker', rijen: [{ ...mw, contract: 36 }] }], { rol: 'medewerker' })).rejects.toThrow();
    const users = await alsGebruiker(pool, MW, (voer) => voer('select email from users', []));
    expect(users).toEqual([{ email: 'mw@voorbeeld.nl' }]);
    await expect(alsGebruiker(pool, MW, (voer) => voer(`update users set rol = 'Planner'`, []))).resolves.toEqual([]);
    expect((await pool.query(`select rol from users where auth_id = '${MW}'`)).rows[0].rol).toBe('Uitvaartverzorger/Leider');
    await expect(alsGebruiker(pool, MW, (voer) => voer('select * from grip_installatie', []))).rejects.toThrow(/permission/);
  });

  it('zonder ingelogde gebruiker werkt de server zonder RLS, zoals de service role', async () => {
    const server = vraagDb((v) => alsServer(pool, (voer) => beantwoord(v, voer)));
    expect(await server.lees('rp_medewerker')).toHaveLength(1);
    expect(await server.schemaVersie()).toBe(20261111);
  });

  it('elke wijziging geeft een seintje met de naam van de tabel', async () => {
    const luister = new Client({ connectionString: (pool as unknown as { options: { connectionString: string } }).options.connectionString });
    await luister.connect();
    await luister.query('listen grip_wijziging');
    const seintjes: string[] = [];
    luister.on('notification', (n) => seintjes.push(n.payload ?? ''));
    await alsGebruiker(pool, PLANNER, (voer) => voer(`update rp_medewerker set contract = 32 where id = $1`, [mw.id]));
    for (let i = 0; i < 50 && !seintjes.length; i++) await new Promise((k) => setTimeout(k, 40));
    await luister.end();
    expect(seintjes).toEqual(['rp_medewerker']);
  });

  it('de dagelijkse taak claimt en bewaart via dezelfde weg als de app', async () => {
    const server = vraagDb((v) => alsServer(pool, (voer) => beantwoord(v, voer)));
    const uit = await voerDagtaakUit(server, { vandaag: '2026-10-29', nu: () => '2026-10-29T06:00:00', haal: async () => { throw new Error('geen netwerk in de test'); } });
    expect(['geslaagd', 'beperkt', 'mislukt']).toContain(uit.status);
    const status = (await pool.query(`select waarde from rp_instelling where sleutel = 'dagtaak'`)).rows[0]?.waarde;
    expect(status?.datum).toBe('2026-10-29');
  });
});
