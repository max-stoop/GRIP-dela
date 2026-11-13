// @vitest-environment node
/**
 * Een database die (nog) niet is bijgewerkt: de app leest wat er is, maar bewaart niets. Geen terugval op losse
 * verzoeken of op weglaten wat de database nog niet kent: liever niet opslaan dan minder veilig opslaan. Na het
 * bijwerken gaat het vanzelf weer.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseVerouderd, SCHEMA_NODIG, databaseBijgewerkt, voerUit } from '@/lib/store/db/db';
import { maakOmgeving, pgDb, SCHEMA } from './pgdb';

const id = '11111111-1111-1111-1111-111111111111';
const mw = { id, regio: 'Utrecht', naam: 'Noor N.', contract: 24, voorkeur: 'O', weekendgroep: 0, functie: 'UV', afstandsverklaring: false, extern: false, email: null, actief: true };
const aantal = async (pg: Awaited<ReturnType<typeof maakOmgeving>>) => (await pg.query<{ n: number }>('select count(*)::int n from rp_medewerker')).rows[0].n;
const VERSIE = `rp_schema_versie() returns int\nlanguage sql immutable as $$ select ${SCHEMA_NODIG} $$`;

describe('een database die niet is bijgewerkt', () => {
  it('bewaart niets en zegt waarom; na het bijwerken gaat het weer', async () => {
    const pg = await maakOmgeving(SCHEMA.replace(VERSIE, () => VERSIE.replace(String(SCHEMA_NODIG), String(SCHEMA_NODIG - 1))));
    const db = pgDb(pg, null);
    expect(await databaseBijgewerkt(db)).toBe(false);
    await expect(voerUit(db, [{ soort: 'upsert', tabel: 'rp_medewerker', rijen: [mw] }], { rol: 'beheerder' })).rejects.toBeInstanceOf(DatabaseVerouderd);
    expect(await aantal(pg)).toBe(0);

    await pg.exec(SCHEMA);
    const na = pgDb(pg, null);
    expect(await databaseBijgewerkt(na)).toBe(true);
    await voerUit(na, [{ soort: 'upsert', tabel: 'rp_medewerker', rijen: [mw] }], { rol: 'beheerder' });
    expect(await aantal(pg)).toBe(1);
  }, 60_000);

  it('ook een database zonder rp_bewaar en rp_schema_versie krijgt niets', async () => {
    const pg = await maakOmgeving();
    await pg.exec('drop function rp_schema_versie(); drop function rp_bewaar_klaar(uuid, int); drop function rp_bewaar(jsonb);');
    const db = pgDb(pg, null);
    await expect(voerUit(db, [{ soort: 'upsert', tabel: 'rp_medewerker', rijen: [mw] }], { rol: 'beheerder' })).rejects.toBeInstanceOf(DatabaseVerouderd);
    expect(await aantal(pg)).toBe(0);
  }, 60_000);

  it('het schema zet precies de versie die de app nodig heeft', () => {
    expect(SCHEMA).toContain(VERSIE);
    expect([...SCHEMA.matchAll(/rp_schema_versie\(\) returns int/g)]).toHaveLength(1);
  });
});
