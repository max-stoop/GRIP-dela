/**
 * Postgres in Azure. De app verbindt als eigenaar van de tabellen; voor wie is ingelogd gaat elke aanvraag in een
 * eigen transactie als de rol authenticated, met grip.uid op het werkaccount, zodat de RLS per gebruiker geldt.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool, type PoolClient } from 'pg';
import type { Rij } from '../store/db/tabellen';
import type { Uitvoerder } from './sql';

const BESTANDEN = ['azure/database/basis.sql', 'azure/database/grip.sql', 'azure/database/live.sql'];
/** Voor pg_advisory_lock: bijwerken gebeurt maar in één proces tegelijk. */
const SLOT = 7_310_421;

let pool: Pool | null = null;
let bijgewerkt: Promise<void> | null = null;

export function schemaSql(map = process.cwd()): string {
  return BESTANDEN.map((b) => fs.readFileSync(path.join(map, b), 'utf8')).join('\n');
}

/** Voert het schema uit als het is veranderd sinds de vorige keer; daarna niets meer. */
export async function werkBij(p: Pool, sql = schemaSql()): Promise<boolean> {
  const hash = createHash('sha256').update(sql).digest('hex');
  const c = await p.connect();
  try {
    await c.query('select pg_advisory_lock($1)', [SLOT]);
    const er = (await c.query(`select to_regclass('grip_installatie') is not null as er`)).rows[0].er;
    const huidig = er ? (await c.query('select sql_hash from grip_installatie')).rows[0]?.sql_hash : null;
    if (huidig === hash) return false;
    await c.query(sql);
    await c.query(`insert into grip_installatie (id, sql_hash) values (1, $1)
      on conflict (id) do update set sql_hash = excluded.sql_hash, bijgewerkt = now()`, [hash]);
    return true;
  } finally {
    await c.query('select pg_advisory_unlock($1)', [SLOT]).catch(() => undefined);
    c.release();
  }
}

export async function database(): Promise<Pool> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ontbreekt');
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 60_000 });
  bijgewerkt ??= werkBij(pool).then(() => undefined, (e) => { bijgewerkt = null; throw e; });
  await bijgewerkt;
  return pool;
}

async function inTransactie<T>(p: Pool, oid: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await p.connect();
  try {
    await c.query('begin');
    await c.query(`set local statement_timeout = '120s'`);
    if (oid) {
      await c.query(`select set_config('grip.uid', $1, true)`, [oid]);
      await c.query('set local role authenticated');
    }
    const uit = await fn(c);
    await c.query('commit');
    return uit;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const uitvoerder = (c: PoolClient): Uitvoerder => async (sql, params) => (await c.query(sql, params)).rows as Rij[];

/** Met de rechten van het werkaccount (oid uit Entra ID). */
export const alsGebruiker = <T>(p: Pool, oid: string, fn: (voer: Uitvoerder) => Promise<T>) => inTransactie(p, oid, (c) => fn(uitvoerder(c)));

/** Zonder ingelogde gebruiker, zoals de service role: de dagelijkse taak en het gebruikersbeheer. */
export const alsServer = <T>(p: Pool, fn: (voer: Uitvoerder) => Promise<T>) => inTransactie(p, null, (c) => fn(uitvoerder(c)));
