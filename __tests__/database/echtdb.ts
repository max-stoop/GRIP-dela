/** Een echte Postgres voor wat PGlite niet kan: verbindingen die echt tegelijk werken. Alleen met GRIP_TEST_PG, anders slaan de tests zich over. */
import { Client } from 'pg';
import { SCHEMA, USERS_EN_REGIOS, uid } from './pgdb';

export const ECHT_PG = process.env.GRIP_TEST_PG ?? '';

interface EchteDb {
  url: string;
  weg: () => Promise<void>;
}

export async function maakEchteDb(schema = SCHEMA): Promise<EchteDb> {
  const naam = `grip_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const beheer = new Client({ connectionString: ECHT_PG });
  await beheer.connect();
  await beheer.query(`create database ${naam}`);
  await beheer.end();
  const u = new URL(ECHT_PG);
  u.pathname = `/${naam}`;
  const url = u.toString();
  const c = new Client({ connectionString: url });
  await c.connect();
  // auth.uid() per verbinding, uit een instelling van de sessie (zoals in Azure)
  await c.query(`
    do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('grip.uid', true), '')::uuid $$;
    ${USERS_EN_REGIOS}
  `);
  await c.query(schema);
  await c.query('grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated;');
  await c.end();
  return {
    url,
    weg: async () => {
      const b = new Client({ connectionString: ECHT_PG });
      await b.connect();
      await b.query(`drop database if exists ${naam} with (force)`);
      await b.end();
    },
  };
}

/** Een eigen verbinding: als deze gebruiker (met RLS), of als eigenaar zonder RLS (wie null, zoals de service role). */
export async function verbinding(url: string, wie: number | null): Promise<Client> {
  const c = new Client({ connectionString: url });
  await c.connect();
  if (wie) await c.query(`set grip.uid = '${uid(wie)}'; set role authenticated;`);
  return c;
}

/** Zolang wacht een verzoek nog: lost de belofte binnen `ms` niet op, dan staat hij te wachten (op een slot). */
export async function wachtNog(p: Promise<unknown>, ms = 400): Promise<boolean> {
  const nog = Symbol('nog');
  const r = await Promise.race([p.then(() => 'klaar', () => 'fout'), new Promise((k) => setTimeout(() => k(nog), ms))]);
  return r === nog;
}
