import { Client, Pool } from 'pg';
import { werkBij } from '../../lib/server/postgres';

/** Een lege database met het schema en vijf werkaccounts die al in GRIP staan (een regiomanager zonder regio's). */
export default async function opzet() {
  const url = new URL(process.env.GRIP_E2E_DATABASE!);
  const beheer = new URL(url);
  beheer.pathname = '/postgres';
  const b = new Client({ connectionString: beheer.toString() });
  await b.connect();
  await b.query(`drop database if exists ${url.pathname.slice(1)} with (force)`);
  await b.query(`create database ${url.pathname.slice(1)}`);
  await b.end();
  const pool = new Pool({ connectionString: url.toString() });
  await werkBij(pool);
  await pool.query(`insert into users (email, naam, rol, regios) values
    ('beheer@voorbeeld.nl', 'Bea Beheer', 'Planner', '{}'),
    ('plan@voorbeeld.nl', 'Piet Plan', 'Regio Planner', '{}'),
    ('mw@voorbeeld.nl', 'Mia Medewerker', 'Uitvaartverzorger/Leider', array[(select id from regios where naam = 'Utrecht')]),
    ('rm@voorbeeld.nl', 'Rob Regiomanager', 'Regio Manager', array[(select id from regios where naam = 'Utrecht')]),
    ('rmleeg@voorbeeld.nl', 'Rik Zonder Regio', 'Regio Manager', '{}')`);
  await pool.end();
}
