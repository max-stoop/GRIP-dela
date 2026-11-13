// @vitest-environment node
/**
 * Ondeelbaar opslaan: een grote wijziging (meer dan één verzoek) gaat in delen naar de klaarzettabel en wordt in één
 * transactie verwerkt; grote stappen houden de versiecontrole; de snellere regels laten de rechten gelijk; de
 * dagelijkse voorspelling wordt in één handeling geclaimd.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { MAX_TRANSACTIE, voerUit, type Voortgang } from '@/lib/store/db/db';
import { addDays, todayIso } from '@/lib/dates';
import { BEHEER, PLANNER, SCHEMA, maakOmgeving, pgDb } from './pgdb';

beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });

const vandaag = todayIso();
const REGIOS = Array.from({ length: 16 }, (_, i) => `R${i}`);
const meldingen = (n: number, aantal = 1) => Array.from({ length: n }, (_, i) => ({ datum: addDays('2015-01-01', Math.floor(i / REGIOS.length)), regio: REGIOS[i % REGIOS.length], aantal }));
const tel = async (pg: PGlite, tabel: string) => (await pg.query<{ n: number }>(`select count(*)::int n from ${tabel}`)).rows[0].n;

describe('een grote wijziging: in delen klaarzetten, in één keer verwerken', () => {
  let pg: PGlite;
  beforeAll(async () => { pg = await maakOmgeving(); }, 60_000);

  it(`${MAX_TRANSACTIE + 1} rijen met een fout in het tweede deel: er is niets veranderd`, async () => {
    const rijen = meldingen(MAX_TRANSACTIE + 1);
    rijen[rijen.length - 1].aantal = -1; // mag niet (aantal >= 0)
    const stappen: Voortgang[] = [];
    await expect(voerUit(pgDb(pg, BEHEER), [{ soort: 'upsert', tabel: 'rp_meldingen', rijen }], { rol: 'beheerder', voortgang: (v) => stappen.push(v) }))
      .rejects.toThrow(/aantal_check/);
    expect(await tel(pg, 'rp_meldingen')).toBe(0);
    // klaargezet in twee delen, daarna samen verwerkt; wat klaarstond is opgeruimd
    expect(stappen.map((v) => `${v.fase} ${v.deel}/${v.van}`)).toEqual(['klaarzetten 1/2', 'klaarzetten 2/2', 'verwerken 2/2']);
    expect(await tel(pg, 'rp_bewaar_deel')).toBe(0);
  }, 120_000);

  it('zonder fout staat alles er in één keer', async () => {
    await voerUit(pgDb(pg, BEHEER), [{ soort: 'upsert', tabel: 'rp_meldingen', rijen: meldingen(MAX_TRANSACTIE + 1) }], { rol: 'beheerder' });
    expect(await tel(pg, 'rp_meldingen')).toBe(MAX_TRANSACTIE + 1);
    expect(await tel(pg, 'rp_bewaar_deel')).toBe(0);
  }, 120_000);

  it('klaargezette delen zijn van wie ze klaarzette; onvolledig wordt niet verwerkt', async () => {
    const id = '99999999-9999-9999-9999-999999999999';
    const stap = [{ tabel: 'rp_meldingen', soort: 'upsert', sleutel: ['datum', 'regio'], rijen: [{ datum: '2014-01-01', regio: 'R0', aantal: 3 }] }];
    await pgDb(pg, BEHEER).klaarzetten(id, 0, stap as never);
    // een ander ziet ze niet
    await expect(pgDb(pg, PLANNER).bewaarKlaar(id, 1)).rejects.toThrow(/niet alle delen/);
    // een deel ontbreekt
    await expect(pgDb(pg, BEHEER).bewaarKlaar(id, 2)).rejects.toThrow(/niet alle delen/);
    expect((await pg.query("select 1 from rp_meldingen where datum = '2014-01-01'")).rows).toHaveLength(0);
    await pgDb(pg, BEHEER).bewaarKlaar(id, 1);
    expect((await pg.query("select 1 from rp_meldingen where datum = '2014-01-01'")).rows).toHaveLength(1);
  });
});

describe('versiecontrole bij een grote stap', () => {
  let pg: PGlite;
  const MW = Array.from({ length: 5 }, (_, i) => `0000000${i + 1}-0000-0000-0000-000000000000`);
  beforeAll(async () => {
    pg = await maakOmgeving();
    await pg.query(`insert into rp_medewerker (id, regio, naam, contract, voorkeur, weekendgroep, functie, afstandsverklaring, extern, actief)
      select x, 'Utrecht', 'M', 32, 'O', 0, 'UV', false, false, true from unnest($1::uuid[]) x`, [MW]);
    await pg.query(`insert into rp_rooster (medewerker_id, datum, regio, dienst) select m, d::date, 'Utrecht', '1' from unnest($1::uuid[]) m, generate_series($2::date, $2::date + 299, '1 day') d`, [MW, addDays(vandaag, 1)]);
    await pg.query(`update rp_rooster set dienst = '2' where medewerker_id = $1 and datum = $2`, [MW[0], addDays(vandaag, 5)]); // versie 2
  }, 60_000);

  it('1500 rijen, één is intussen gewijzigd: conflict en niets bewaard', async () => {
    const r = await pg.query<{ medewerker_id: string; datum: string; rij_versie: string }>("select medewerker_id, to_char(datum, 'YYYY-MM-DD') datum, rij_versie from rp_rooster order by 1, 2");
    expect(r.rows).toHaveLength(1500);
    const stap = (alles: boolean) => [{
      tabel: 'rp_rooster', soort: 'upsert', sleutel: ['medewerker_id', 'datum'],
      rijen: r.rows.map((x) => ({ medewerker_id: x.medewerker_id, datum: x.datum, regio: 'Utrecht', dienst: 'O' })),
      // de app kent van alles versie 1 (fout voor die ene rij), of de echte versies
      controles: r.rows.map((x) => (alles ? 1 : Number(x.rij_versie))),
    }];
    await expect(pgDb(pg, PLANNER).bewaar(stap(true) as never)).rejects.toThrow(/GRIP_CONFLICT rp_rooster/);
    expect((await pg.query("select 1 from rp_rooster where dienst = 'O'")).rows).toHaveLength(0);
    const versies = await pgDb(pg, PLANNER).bewaar(stap(false) as never);
    expect(versies).toHaveLength(1500);
    expect((await pg.query("select 1 from rp_rooster where dienst = 'O'")).rows).toHaveLength(1500);
  }, 60_000);
});

describe('de snellere regels', () => {
  it('controleren de rechten één keer per opdracht, en het schema mag nog eens', async () => {
    const pg = await maakOmgeving();
    const regels = async () => (await pg.query<{ r: string }>("select tablename || '.' || policyname || ': ' || coalesce(qual, '') || ' | ' || coalesce(with_check, '') r from pg_policies where schemaname = 'public' order by 1")).rows.map((x) => x.r);
    const voor = await regels();
    // elke functie over wie is ingelogd staat er als deelvraag in ("( SELECT rp_rol() AS rp_rol)"), niet per rij
    expect(voor.filter((r) => /(?<!SELECT )\b(rp_rol|rp_besluit_verlof|rp_mijn_medewerker|rp_mijn_regio|rp_mag_alle|rp_regios_mag|auth\.uid)\(\)/.test(r))).toEqual([]);
    expect(voor.some((r) => r.startsWith('rp_rooster.rp_rooster_planner') && r.includes('SELECT rp_mag_alle()'))).toBe(true);
    await pg.exec(SCHEMA);
    expect(await regels()).toEqual(voor);
  }, 60_000);
});

describe('de dagelijkse voorspelling claimen', () => {
  let pg: PGlite;
  beforeAll(async () => { pg = await maakOmgeving(); }, 60_000);
  const status = (datum = vandaag) => ({ datum, status: 'gestart', gestart: `${datum}T06:00:00`, waar: 'server' });
  const claim = (wie: number, looptijd = 20) => pgDb(pg, wie).rpc('rp_dagtaak_claim', { p_status: JSON.stringify(status()), p_looptijd: looptijd });

  it('één keer: een tweede claim terwijl hij loopt of als hij vandaag al is gelukt, krijgt niets', async () => {
    expect(await claim(BEHEER)).toHaveLength(1);
    expect(await claim(BEHEER)).toHaveLength(0);
    // loopt langer dan de looptijd: dan mag een nieuwe poging
    expect(await claim(BEHEER, 0)).toHaveLength(1);
    await pg.query(`update rp_instelling set waarde = jsonb_build_object('datum', $1::text, 'status', 'geslaagd') where sleutel = 'dagtaak'`, [vandaag]);
    expect(await claim(BEHEER, 0)).toHaveLength(0);
    // ook gedaan als hij beperkt is gelukt (met verouderde of ontbrekende bronnen)
    await pg.query(`update rp_instelling set waarde = jsonb_build_object('datum', $1::text, 'status', 'beperkt') where sleutel = 'dagtaak'`, [vandaag]);
    expect(await claim(BEHEER, 0)).toHaveLength(0);
  });

  it('alleen wie de instellingen mag wijzigen', async () => {
    await expect(claim(PLANNER, 0)).rejects.toThrow(/row-level security/);
  });
});
