// @vitest-environment node
/** Bewaartermijnen (AVG): de dagelijkse taak ruimt op; alleen de server mag dat. */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { maakOmgeving, uid, BEHEER, MEDEWERKER } from './pgdb';

let db: PGlite;
async function als<T = Record<string, unknown>>(wie: number | null, sql: string): Promise<T[]> {
  await db.exec(`reset role; update auth.sessie set uid = ${wie ? `'${uid(wie)}'` : 'null'};${wie ? ' set role authenticated;' : ''}`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const tel = async (tabel: string) => (await als<{ n: number }>(null, `select count(*)::int as n from ${tabel}`))[0].n;
const VANDAAG = '2027-06-15';

beforeAll(async () => {
  db = await maakOmgeving();
  await db.exec(`
    insert into rp_medewerker (id, regio, naam, contract, email, actief) values
      ('20000000-0000-0000-0000-000000000001', 'Utrecht', 'Tessa', 32, 'tessa@voorbeeld.nl', true),
      ('20000000-0000-0000-0000-000000000002', 'Utrecht', 'Oud', 32, null, false),
      ('20000000-0000-0000-0000-000000000003', 'Utrecht', 'Net weg', 32, null, false);
    insert into rp_rooster (medewerker_id, datum, regio, dienst) values
      ('20000000-0000-0000-0000-000000000001', '2025-12-31', 'Utrecht', 'Z'),
      ('20000000-0000-0000-0000-000000000001', '2026-01-02', 'Utrecht', '1'),
      ('20000000-0000-0000-0000-000000000002', '2025-06-01', 'Utrecht', '1'),
      ('20000000-0000-0000-0000-000000000003', '2027-06-01', 'Utrecht', '1');
    insert into rp_ziekmelding (medewerker_id, regio, van, tot, door, status) values
      ('20000000-0000-0000-0000-000000000001', 'Utrecht', '2026-03-01', '2026-03-05', 'Plan', 'hersteld'),
      ('20000000-0000-0000-0000-000000000001', 'Utrecht', '2027-05-01', '2027-05-03', 'Plan', 'hersteld'),
      ('20000000-0000-0000-0000-000000000001', 'Utrecht', '2025-01-01', null, 'Plan', 'ziek');
    insert into rp_verlof (medewerker_id, regio, van, tot, soort, status) values
      ('20000000-0000-0000-0000-000000000001', 'Utrecht', '2025-07-01', '2025-07-14', 'vakantie', 'goedgekeurd'),
      ('20000000-0000-0000-0000-000000000001', 'Utrecht', '2026-07-01', '2026-07-14', 'vakantie', 'goedgekeurd');
    insert into rp_activiteit (moment, soort, tekst, regio) values ('2026-01-01', 'ziek', 'Tessa ziek gemeld', 'Utrecht'), ('2027-06-01', 'ziek', 'Tessa ziek gemeld', 'Utrecht');
    insert into rp_verdeling (datum, data) values ('2027-01-01', '{}'), ('2027-06-01', '{}');
  `);
}, 60_000);

describe('bewaartermijnen', () => {
  it('alleen de server ruimt op, niet wie is ingelogd (ook de beheerder niet)', async () => {
    await expect(als(BEHEER, `select * from rp_opruimen('${VANDAAG}')`)).rejects.toThrow(/permission denied|server/);
    await expect(als(MEDEWERKER, `select * from rp_opruimen('${VANDAAG}')`)).rejects.toThrow(/permission denied|server/);
    expect(await tel('rp_rooster')).toBe(4);
  });

  it('weg wat ouder is dan de termijn; wat de app nog leest, blijft', async () => {
    const uit = Object.fromEntries((await als<{ tabel: string; weg: number }>(null, `select tabel, weg::int as weg from rp_opruimen('${VANDAAG}')`)).map((r) => [r.tabel, r.weg]));
    expect(uit).toMatchObject({ rp_activiteit: 1, rp_ziekmelding: 1, rp_rooster: 2, rp_verlof: 1, rp_verdeling: 1, rp_medewerker: 1 });
    // rooster en verlof: dit en vorig kalenderjaar blijven
    expect((await als<{ d: string }>(null, 'select datum::text as d from rp_rooster order by datum')).map((r) => r.d)).toEqual(['2026-01-02', '2027-06-01']);
    expect((await als<{ d: string }>(null, 'select van::text as d from rp_verlof')).map((r) => r.d)).toEqual(['2026-07-01']);
    // een lopende ziekmelding blijft, hoe oud ook; een recente herstelde ook
    expect(await tel('rp_ziekmelding')).toBe(2);
    // wie uit het team is en nergens meer in staat, is weg; wie nog een rooster heeft, blijft
    expect((await als<{ naam: string }>(null, 'select naam from rp_medewerker order by naam')).map((r) => r.naam)).toEqual(['Net weg', 'Tessa']);
  });

  it('een medewerker ziet van collega\'s geen afstandsverklaring', async () => {
    await als(null, "update rp_medewerker set afstandsverklaring = true");
    await als(null, `insert into rp_medewerker (regio, naam, contract, email) values ('Utrecht', 'Collega', 32, null)`);
    const c = await als<{ naam: string; afstandsverklaring: boolean | null }>(MEDEWERKER, 'select naam, afstandsverklaring from rp_collegas()');
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x.afstandsverklaring).toBeNull();
  });
});
