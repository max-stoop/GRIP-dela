/** Postgres in het geheugen (PGlite) met hetzelfde schema en dezelfde RLS als de echte database. */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import type { Db } from '@/lib/store/db/db';
import type { Rij } from '@/lib/store/db/tabellen';
import { vraagDb } from '@/lib/store/db/vraag';
import { beantwoord, type Uitvoerder } from '@/lib/server/sql';

/** Het schema van GRIP, zonder wat Azure eromheen zet (azure/database/basis.sql en live.sql). */
export const SCHEMA = fs.readFileSync(path.join(__dirname, '../../azure/database/grip.sql'), 'utf8');

export const BEHEER = 1, PLANNER = 2, MEDEWERKER = 3, REGIOMANAGER = 4;
export const uid = (wie: number) => `00000000-0000-0000-0000-00000000000${wie}`;

/** De tabellen users en regios met vier accounts. */
export const USERS_EN_REGIOS = `
    create type user_role as enum ('Planner','Regio Planner','Regio Manager','Uitvaartverzorger/Leider');
    create table regios (id bigint generated always as identity primary key, naam text unique);
    create table users (id uuid primary key default gen_random_uuid(), auth_id uuid unique, email text unique, naam text, rol user_role, regios bigint[] default '{}');
    insert into regios (naam) values ('Utrecht'), ('Amsterdam');
    insert into users (auth_id, email, naam, rol, regios) values
      ('${uid(BEHEER)}', 'beheer@voorbeeld.nl', 'Beheer', 'Planner', '{}'),
      ('${uid(PLANNER)}', 'plan@voorbeeld.nl', 'Plan', 'Regio Planner', '{1}'),
      ('${uid(MEDEWERKER)}', 'tessa@voorbeeld.nl', 'Tessa', 'Uitvaartverzorger/Leider', '{1}'),
      ('${uid(REGIOMANAGER)}', 'rm@voorbeeld.nl', 'Rianne', 'Regio Manager', '{1}');
`;

/** Een lege database: auth.uid(), de rol authenticated, de tabellen users en regios, en het schema. */
export async function maakOmgeving(schema = SCHEMA): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(`
    create schema auth;
    create table auth.sessie (uid uuid);
    insert into auth.sessie values (null);
    create function auth.uid() returns uuid language sql stable as $$ select uid from auth.sessie $$;
    ${USERS_EN_REGIOS}
    create role authenticated;
  `);
  await pg.exec(schema);
  await pg.exec(`
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    grant select on auth.sessie to authenticated;
  `);
  return pg;
}

let rij: Promise<unknown> = Promise.resolve();

/** De database zoals een gebruiker die ziet (RLS), of zonder RLS als `wie` null is: dezelfde SQL als in Azure. */
export function pgDb(pg: PGlite, wie: number | null): Db {
  const als = <T>(fn: () => Promise<T>): Promise<T> => {
    const volgende = rij.then(async () => {
      await pg.exec(`reset role; update auth.sessie set uid = ${wie ? `'${uid(wie)}'` : 'null'};${wie ? ' set role authenticated;' : ''}`);
      try { return await fn(); } finally { await pg.exec('reset role;'); }
    });
    rij = volgende.catch(() => undefined);
    return volgende;
  };
  const voer: Uitvoerder = async (sql, params) => (await pg.query<Rij>(sql, params)).rows;
  return vraagDb((v) => als(() => beantwoord(v, voer)));
}
