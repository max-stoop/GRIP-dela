// @vitest-environment node
/** Het schema op PGlite, met de Row Level Security per rol. */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from './pgdb';
const BEHEER = 1, PLANNER = 2, MEDEWERKER = 3, REGIOMANAGER = 4;
let db: PGlite;

async function als<T = Record<string, unknown>>(wie: number, sql: string): Promise<T[]> {
  await db.exec(`reset role; update auth.sessie set uid = '00000000-0000-0000-0000-00000000000${wie}'; set role authenticated;`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

beforeAll(async () => {
  db = new PGlite();
  // minimale omgeving: auth.uid(), rol authenticated en de tabellen users en regios
  await db.exec(`
    create schema auth;
    create table auth.sessie (uid uuid);
    insert into auth.sessie values (null);
    create function auth.uid() returns uuid language sql stable as $$ select uid from auth.sessie $$;
    create type user_role as enum ('Planner','Uitvaart Planner','Regio Planner','Regio Manager','Uitvaartverzorger/Leider','NBD Planner','NBD Manager','NBD Medewerker','UVD Planner','UVD Manager','UVD Medewerker');
    create table regios (id bigint generated always as identity primary key, naam text unique);
    create table users (id uuid primary key default gen_random_uuid(), auth_id uuid unique, email text unique, naam text, rol user_role, regios bigint[] default '{}');
    insert into regios (naam) values ('Utrecht'), ('Amsterdam');
    insert into users (auth_id, email, naam, rol, regios) values
      ('00000000-0000-0000-0000-000000000001', 'beheer@voorbeeld.nl', 'Beheer', 'Planner', '{}'),
      ('00000000-0000-0000-0000-000000000002', 'plan@voorbeeld.nl', 'Plan', 'Regio Planner', '{1}'),
      ('00000000-0000-0000-0000-000000000003', 'tessa@voorbeeld.nl', 'Tessa', 'Uitvaartverzorger/Leider', '{1}'),
      ('00000000-0000-0000-0000-000000000004', 'rm@voorbeeld.nl', 'Rianne', 'Regio Manager', '{1}');
    create role authenticated;
  `);
  await db.exec(SCHEMA);
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    grant select on auth.sessie to authenticated;
    insert into rp_medewerker (regio, naam, contract, email) values ('Utrecht', 'Tessa J.', 32, 'tessa@voorbeeld.nl'), ('Utrecht', 'Bas O.', 24, null), ('Amsterdam', 'Karin P.', 32, null);
    insert into rp_norm_regio (regio, cluster, natura, cbs, vrije_markt, amplitude, fte) values
      ('Utrecht', 'O', 1003.9, 6764, 0.065, 0.962, '{11.61,11.61,11.61,11.61}'), ('Amsterdam', 'NW', 1100, 7000, 0.06, 0.78, '{12.8,12.8,12.8,12.8}');
    insert into rp_rooster (medewerker_id, datum, regio, dienst) select id, '2026-10-06', regio, '1' from rp_medewerker;
    insert into rp_rooster_gepubliceerd select medewerker_id, datum, regio, dienst from rp_rooster;
  `);
}, 60_000);

describe('het datamodel', () => {
  it('rollen en regio’s uit de bestaande tabel users', async () => {
    expect((await als<{ r: string }>(BEHEER, 'select rp_rol() r'))[0].r).toBe('beheerder');
    // een planner plant landelijk: alle regio's (leeg), ook al staat er in users.regios alleen Utrecht
    expect((await als<{ r: string; g: string[] }>(PLANNER, 'select rp_rol() r, rp_regios() g'))[0]).toEqual({ r: 'planner', g: [] });
    expect((await als<{ r: string; g: string }>(MEDEWERKER, 'select rp_rol() r, rp_mijn_regio() g'))[0]).toEqual({ r: 'medewerker', g: 'Utrecht' });
    expect((await als<{ r: string; g: string[] }>(REGIOMANAGER, 'select rp_rol() r, rp_regios() g'))[0]).toEqual({ r: 'regiomanager', g: ['Utrecht'] });
  });

  it('een planner werkt in alle regio’s; een regiomanager alleen in de eigen', async () => {
    expect((await als<{ n: number }>(BEHEER, 'select count(*)::int n from rp_rooster'))[0].n).toBe(3);
    expect((await als<{ n: number }>(PLANNER, 'select count(*)::int n from rp_rooster'))[0].n).toBe(3);
    expect(await als(PLANNER, "update rp_rooster set dienst = dienst where regio = 'Amsterdam' returning regio")).toEqual([{ regio: 'Amsterdam' }]);
    expect((await als<{ n: number }>(REGIOMANAGER, 'select count(*)::int n from rp_rooster'))[0].n).toBe(2);
    expect(await als(REGIOMANAGER, "update rp_rooster set dienst = 'DG2' where regio = 'Amsterdam' returning dienst")).toEqual([]);
  });

  it('medewerkers zien alleen het gepubliceerde rooster van hun regio', async () => {
    expect((await als<{ n: number }>(MEDEWERKER, 'select count(*)::int n from rp_rooster'))[0].n).toBe(0);
    expect((await als<{ n: number }>(MEDEWERKER, 'select count(*)::int n from rp_rooster_gepubliceerd'))[0].n).toBe(2);
    // de eigen regel uit de tabel; de collega's uit rp_collegas(), zonder e-mailadres
    expect((await als<{ naam: string }>(MEDEWERKER, 'select naam from rp_medewerker order by naam')).map((r) => r.naam)).toEqual(['Tessa J.']);
    const collegas = await als<Record<string, unknown>>(MEDEWERKER, 'select * from rp_collegas()');
    expect(collegas.map((r) => r.naam)).toEqual(['Bas O.']);
    expect(collegas[0]).not.toHaveProperty('email');
    // een planner heeft geen eigen regel: geen collega's via de functie (die leest de tabel)
    expect(await als(PLANNER, 'select * from rp_collegas()')).toEqual([]);
  });

  it('medewerker vraagt verlof aan, maar keurt het niet zelf goed', async () => {
    const ok = await als<{ status: string }>(MEDEWERKER, "insert into rp_verlof (medewerker_id, regio, van, tot, soort) values (rp_mijn_medewerker(), 'Utrecht', '2026-11-01', '2026-11-03', 'vakantie') returning status");
    expect(ok[0].status).toBe('aangevraagd');
    await expect(als(MEDEWERKER, "insert into rp_verlof (medewerker_id, regio, van, tot, soort, status) values (rp_mijn_medewerker(), 'Utrecht', '2026-12-01', '2026-12-03', 'vakantie', 'goedgekeurd')")).rejects.toThrow(/row-level security/);
    // de planner voert in als aanvraag, maar besluit niet: dat doet de regiomanager (§ 4.1, § 5.1)
    expect(await als(PLANNER, "insert into rp_verlof (medewerker_id, regio, van, tot, soort) select id, regio, '2026-11-09', '2026-11-10', 'adv' from rp_medewerker where naam = 'Bas O.' returning status")).toEqual([{ status: 'aangevraagd' }]);
    await expect(als(PLANNER, "update rp_verlof set status = 'goedgekeurd' where status = 'aangevraagd' returning status")).rejects.toThrow(/row-level security/);
    const goed = await als<{ status: string }>(REGIOMANAGER, "update rp_verlof set status = 'goedgekeurd' where status = 'aangevraagd' returning status");
    expect(goed).toEqual([{ status: 'goedgekeurd' }, { status: 'goedgekeurd' }]);
  });

  // een maand als 'JJJJ-MM', n maanden na deze maand
  const maand = (n: number) => `to_char(current_date + interval '${n} month', 'YYYY-MM')`;
  const maandEind = (n: number) => `(date_trunc('month', current_date) + interval '${n + 1} month' - interval '1 day')::date`;

  it('vaststellen per maand: alleen de planner geeft advies en biedt aan, alleen de regiomanager keurt goed (§ 5.1)', async () => {
    const aanbieden = (regio: string, advies: string, toelichting: string | null, n = 1) => `insert into rp_goedkeuring (regio, maand, status, versie, cijfer, door, advies, advies_toelichting, advies_door) values ('${regio}', ${maand(n)}, 'ter_goedkeuring', 'v1', 8.7, 'Plan', '${advies}', ${toelichting ? `'${toelichting}'` : 'null'}, 'Plan') returning status, advies`;
    const deze = `regio = 'Utrecht' and maand = ${maand(1)}`;
    // de planner biedt in elke regio aan; de regiomanager van Utrecht keurt Amsterdam niet goed
    expect(await als(PLANNER, aanbieden('Amsterdam', 'groen', null))).toEqual([{ status: 'ter_goedkeuring', advies: 'groen' }]);
    expect(await als(REGIOMANAGER, `update rp_goedkeuring set status = 'goedgekeurd', beoordeelaar = 'Rianne' where regio = 'Amsterdam' returning status`)).toEqual([]);
    // zonder advies, of oranje en rood zonder toelichting: niet
    await expect(als(PLANNER, `insert into rp_goedkeuring (regio, maand, status, versie, cijfer, door) values ('Utrecht', ${maand(1)}, 'ter_goedkeuring', 'v1', 8.7, 'Plan')`)).rejects.toThrow(/not-null|null value|advies/);
    await expect(als(PLANNER, aanbieden('Utrecht', 'oranje', null))).rejects.toThrow(/check constraint/);
    // een maand is 'JJJJ-MM', en een voorbije maand bied je niet aan
    await expect(als(PLANNER, "insert into rp_goedkeuring (regio, maand, status, versie, cijfer, door, advies, advies_door) values ('Utrecht', '2026-13', 'ter_goedkeuring', 'v1', 8.7, 'Plan', 'groen', 'Plan')")).rejects.toThrow(/check constraint/);
    await expect(als(PLANNER, aanbieden('Utrecht', 'groen', null, -1))).rejects.toThrow(/voorbij/);
    // de regiomanager en de beheerder bieden niet aan: het advies is van de planner
    await expect(als(REGIOMANAGER, aanbieden('Utrecht', 'groen', null))).rejects.toThrow(/row-level security/);
    expect(await als(PLANNER, aanbieden('Utrecht', 'rood', 'Drie dagen niet te dekken in week 46'))).toEqual([{ status: 'ter_goedkeuring', advies: 'rood' }]);
    // de planner keurt niet goed: niet als planner, en niet wie het advies gaf (vier ogen)
    await expect(als(PLANNER, `update rp_goedkeuring set status = 'goedgekeurd', beoordeelaar = 'Plan' where ${deze}`)).rejects.toThrow(/row-level security|GRIP_VIER_OGEN/);
    // de regiomanager past het advies niet aan; afkeuren en tegen rood in goedkeuren vragen een toelichting
    await expect(als(REGIOMANAGER, `update rp_goedkeuring set advies = 'groen' where ${deze}`)).rejects.toThrow(/Alleen de planner/);
    await expect(als(REGIOMANAGER, `update rp_goedkeuring set status = 'afgekeurd', beoordeelaar = 'Rianne' where ${deze}`)).rejects.toThrow(/check constraint/);
    expect(await als(REGIOMANAGER, `update rp_goedkeuring set status = 'afgekeurd', beoordeelaar = 'Rianne', reden = 'Eerst week 46 oplossen' where ${deze} returning status`)).toEqual([{ status: 'afgekeurd' }]);
    expect(await als(PLANNER, `update rp_goedkeuring set status = 'ter_goedkeuring', advies_toelichting = 'Week 46 blijft krap, externe gevraagd', advies_op = now() + interval '1 second', reden = null where ${deze} returning status`)).toEqual([{ status: 'ter_goedkeuring' }]);
    await expect(als(REGIOMANAGER, `update rp_goedkeuring set status = 'goedgekeurd', beoordeelaar = 'Rianne' where ${deze}`)).rejects.toThrow(/check constraint/);
    expect(await als(REGIOMANAGER, `update rp_goedkeuring set status = 'goedgekeurd', beoordeelaar = 'Rianne', reden = 'Externe geregeld voor week 46' where ${deze} returning status`)).toEqual([{ status: 'goedgekeurd' }]);
    // vastgesteld blijft vastgesteld: niemand past het nog aan of haalt het weg
    expect(await als(PLANNER, `update rp_goedkeuring set status = 'ter_goedkeuring', advies = 'groen', advies_toelichting = null, reden = null where ${deze} returning status`)).toEqual([]);
    expect(await als(REGIOMANAGER, `update rp_goedkeuring set status = 'afgekeurd' where ${deze} returning status`)).toEqual([]);
    expect(await als(BEHEER, `delete from rp_goedkeuring where ${deze} returning regio`)).toEqual([]);
    // de geschiedenis legt de database zelf vast; aanpassen of weghalen kan niemand
    expect(await als(PLANNER, `select soort, kleur, door from rp_goedkeuring_stap where ${deze} order by id`)).toEqual([
      { soort: 'advies', kleur: 'rood', door: 'Plan' }, { soort: 'afgekeurd', kleur: null, door: 'Rianne' },
      { soort: 'advies', kleur: 'rood', door: 'Plan' }, { soort: 'goedgekeurd', kleur: null, door: 'Rianne' },
    ]);
    await expect(als(PLANNER, `insert into rp_goedkeuring_stap (regio, maand, soort, door) values ('Utrecht', ${maand(1)}, 'goedgekeurd', 'Plan')`)).rejects.toThrow(/row-level security/);
    expect(await als(REGIOMANAGER, `delete from rp_goedkeuring_stap where ${deze} returning id`)).toEqual([]);
    expect(await als(MEDEWERKER, 'select * from rp_goedkeuring_stap')).toEqual([]);
  });

  it('publiceren verder vooruit alleen van vastgestelde maanden', async () => {
    // deze maand vastgesteld (zoals na de invoering), volgende maand is in de vorige test vastgesteld
    await db.exec(`update auth.sessie set uid = null; insert into rp_goedkeuring (regio, maand, status, versie, cijfer, door, advies, advies_door, beoordeelaar) values ('Utrecht', ${maand(0)}, 'goedgekeurd', 'v0', 8.5, 'Plan', 'groen', 'Plan', 'Rianne')`);
    await expect(als(PLANNER, `insert into rp_publicatie (regio, door, van, tot) values ('Utrecht', 'Plan', current_date, ${maandEind(2)})`)).rejects.toThrow(/nog niet vastgesteld/);
    expect(await als(PLANNER, `insert into rp_publicatie (regio, door, van, tot) values ('Utrecht', 'Plan', current_date, ${maandEind(1)}) returning regio`)).toEqual([{ regio: 'Utrecht' }]);
    // opnieuw publiceren binnen wat al online stond kan altijd (ziekte, ruilen, aanpassingen)
    expect(await als(PLANNER, "update rp_publicatie set op = now(), door = 'Plan' where regio = 'Utrecht' returning regio")).toEqual([{ regio: 'Utrecht' }]);
    await expect(als(PLANNER, `update rp_publicatie set tot = ${maandEind(2)} where regio = 'Utrecht'`)).rejects.toThrow(/nog niet vastgesteld/);
    // zonder verplichte goedkeuring (instelling van de beheerder) wel
    await db.exec(`insert into rp_instelling (sleutel, waarde) values ('beleid', '{"goedkeuringVerplicht": false}')`);
    expect(await als(PLANNER, `update rp_publicatie set tot = ${maandEind(2)} where regio = 'Utrecht' returning regio`)).toEqual([{ regio: 'Utrecht' }]);
    await db.exec("delete from rp_instelling where sleutel = 'beleid'; delete from rp_publicatie where regio = 'Utrecht'");
  });

  it('het besluit in de vakantieronde: alleen de regiomanager; verlofrecht staat niet in GRIP', async () => {
    expect(await als(PLANNER, "update rp_medewerker set contract = 28 where naam = 'Bas O.' returning contract")).toEqual([{ contract: '28.0' }]);
    await expect(als(REGIOMANAGER, "update rp_medewerker set verlofrecht = 250 where naam = 'Bas O.'")).rejects.toThrow(/column "verlofrecht"/);
    const data = "current_date + 30, current_date + 40, current_date + 45, current_date + 50, current_date + 60";
    await als(PLANNER, `insert into rp_vakantieronde (naam, cluster, van, tot, datum_aanvragen, datum_analyse, datum_advies, datum_gesprek, datum_besluit, door) values ('Kerst', 'O', '2026-12-19', '2027-01-03', ${data}, 'Plan')`);
    expect(await als(PLANNER, "update rp_vakantieronde set fase = 'gesprek' where naam = 'Kerst' returning fase")).toEqual([{ fase: 'gesprek' }]);
    await expect(als(PLANNER, "update rp_vakantieronde set fase = 'besloten' where naam = 'Kerst'")).rejects.toThrow(/row-level security/);
    expect(await als(REGIOMANAGER, "update rp_vakantieronde set fase = 'besloten' where naam = 'Kerst' returning fase")).toEqual([{ fase: 'besloten' }]);
  });

  it('logboek: schrijven binnen de eigen regio, niet aanpassen of weghalen', async () => {
    expect(await als(MEDEWERKER, "insert into rp_activiteit (soort, tekst, regio, voor) values ('ruil', 'Tessa biedt een dienst aan', 'Utrecht', rp_mijn_medewerker()) returning soort")).toEqual([{ soort: 'ruil' }]);
    await expect(als(MEDEWERKER, "insert into rp_activiteit (soort, tekst, regio) values ('ruil', 'elders', 'Amsterdam')")).rejects.toThrow(/row-level security/);
    await expect(als(MEDEWERKER, "insert into rp_activiteit (soort, tekst) values ('systeem', 'zonder regio')")).rejects.toThrow(/row-level security/);
    expect(await als(PLANNER, "insert into rp_activiteit (soort, tekst, regio) values ('rooster', 'Rooster gepubliceerd', 'Utrecht') returning soort")).toEqual([{ soort: 'rooster' }]);
    expect(await als(PLANNER, "update rp_activiteit set tekst = 'anders' where regio = 'Utrecht' returning id")).toEqual([]);
    expect(await als(PLANNER, "delete from rp_activiteit where regio = 'Utrecht' returning id")).toEqual([]);
    expect((await als<{ n: number }>(MEDEWERKER, "select count(*)::int n from rp_activiteit"))[0].n).toBe(1);
  });

  it('modelgegevens zijn niet zichtbaar voor medewerkers', async () => {
    await db.exec(`insert into rp_run (id, soort, uitgegeven, info, data) values ('2026-10-05_060000', 'dagelijks', '2026-10-05', '{}', '{}')`);
    expect((await als<{ n: number }>(PLANNER, 'select count(*)::int n from rp_run'))[0].n).toBe(1);
    expect((await als<{ n: number }>(MEDEWERKER, 'select count(*)::int n from rp_run'))[0].n).toBe(0);
  });

  it('voorkeuren: eigen profiel invullen en indienen in een open ronde van de eigen regio', async () => {
    const ronde = await als<{ id: string }>(PLANNER, "insert into rp_voorkeurronde (regio, van, tot, deadline, door) values ('Utrecht', '2026-11-02', '2026-12-06', '2026-10-20', 'Plan') returning id");
    expect(ronde).toHaveLength(1);
    await expect(als(REGIOMANAGER, "insert into rp_voorkeurronde (regio, van, tot, deadline, door) values ('Amsterdam', '2026-11-02', '2026-12-06', '2026-10-20', 'Rianne')")).rejects.toThrow(/row-level security/);
    const p = await als<{ dienst: string }>(MEDEWERKER, "insert into rp_voorkeurprofiel (medewerker_id, dagen, dienst) values (rp_mijn_medewerker(), '{neutraal,graag,niet,neutraal,neutraal,neutraal,neutraal}', 'middag') returning dienst");
    expect(p).toEqual([{ dienst: 'middag' }]);
    const bas = (await db.query<{ id: string }>("select id from rp_medewerker where naam = 'Bas O.'")).rows[0].id;
    await expect(als(MEDEWERKER, `insert into rp_voorkeurprofiel (medewerker_id, dagen) values ('${bas}', '{neutraal,neutraal,neutraal,neutraal,neutraal,neutraal,neutraal}')`)).rejects.toThrow(/row-level security/);
    const ing = await als<{ n: number }>(MEDEWERKER, `insert into rp_voorkeurronde_ingediend (ronde_id, medewerker_id) values ('${ronde[0].id}', rp_mijn_medewerker()) returning 1 as n`);
    expect(ing).toHaveLength(1);
    expect((await als<{ n: number }>(PLANNER, 'select count(*)::int n from rp_voorkeurronde_ingediend'))[0].n).toBe(1);
    expect((await als<{ n: number }>(PLANNER, 'select count(*)::int n from rp_voorkeurprofiel'))[0].n).toBe(1);
  });

  it('"kan niet" bij de dubbele dienst zet alleen de planner; de nieuwe voorkeuren slaat iedereen op', async () => {
    const zet = (twee: string) => `insert into rp_voorkeurprofiel (medewerker_id, twee, korte_dagen, weekend, weekend_plekken) values (rp_mijn_medewerker(), '${twee}', 'graag', 'even', 3)
      on conflict (medewerker_id) do update set twee = excluded.twee, korte_dagen = excluded.korte_dagen, weekend = excluded.weekend, weekend_plekken = excluded.weekend_plekken returning twee, korte_dagen, weekend, weekend_plekken`;
    await expect(als(MEDEWERKER, zet('niet'))).rejects.toThrow(/planner/);
    expect(await als(MEDEWERKER, zet('liever_niet'))).toEqual([{ twee: 'liever_niet', korte_dagen: 'graag', weekend: 'even', weekend_plekken: 3 }]);
    const mijn = (await als<{ id: string }>(MEDEWERKER, 'select rp_mijn_medewerker() as id'))[0].id;
    expect(await als(PLANNER, `update rp_voorkeurprofiel set twee = 'niet' where medewerker_id = '${mijn}' returning twee`)).toEqual([{ twee: 'niet' }]);
    // de medewerker slaat het eigen profiel opnieuw op: "kan niet" blijft, weghalen mag niet
    expect((await als<{ twee: string }>(MEDEWERKER, zet('niet')))[0].twee).toBe('niet');
    await expect(als(MEDEWERKER, zet('graag'))).rejects.toThrow(/planner/);
    await expect(als(MEDEWERKER, "update rp_voorkeurprofiel set weekend = 'midden' where medewerker_id = rp_mijn_medewerker()")).rejects.toThrow(/check constraint/);
  });

  it('dienstcodes volgens het roosterbeleid worden gecontroleerd', async () => {
    for (const [i, c] of ['1B', 'DG1', 'DG2', 'O', 'OR', 'VMS', 'Z'].entries()) {
      await db.exec(`insert into rp_rooster (medewerker_id, datum, regio, dienst) select id, '2026-10-${String(10 + i).padStart(2, '0')}', regio, '${c}' from rp_medewerker limit 1`);
    }
    // oude codes (B, DG) en onzin worden geweigerd
    for (const c of ['B', 'DG', 'X']) {
      await expect(db.exec(`insert into rp_rooster (medewerker_id, datum, regio, dienst) select id, '2026-10-09', regio, '${c}' from rp_medewerker limit 1`)).rejects.toThrow(/check constraint/);
    }
    await expect(db.exec("update rp_medewerker set functie = 'XX' where naam = 'Bas O.'")).rejects.toThrow(/check constraint/);
    await db.exec("update rp_medewerker set functie = 'UL', afstandsverklaring = true where naam = 'Bas O.'");
  });

  it('verlof ruilen: alleen eigen goedgekeurd verlof, en van collega’s alleen wie en wanneer', async () => {
    await db.exec(`
      insert into rp_verlof (medewerker_id, regio, van, tot, soort, status, opmerking)
        select id, regio, current_date + 30, current_date + 34, 'vakantie', 'goedgekeurd', 'privé' from rp_medewerker where naam = 'Tessa J.';
      insert into rp_verlof (medewerker_id, regio, van, tot, soort, status, opmerking)
        select id, regio, current_date + 60, current_date + 64, 'vakantie', 'goedgekeurd', 'geheim' from rp_medewerker where naam = 'Bas O.';
      insert into rp_verlof (medewerker_id, regio, van, tot, soort, status)
        select id, regio, current_date + 60, current_date + 64, 'vakantie', 'goedgekeurd' from rp_medewerker where naam = 'Karin P.';
    `);
    const id = async (naam: string) => (await als<{ id: string }>(BEHEER, `select id from rp_medewerker where naam = '${naam}'`))[0].id;
    const [tessa, bas, karin] = [await id('Tessa J.'), await id('Bas O.'), await id('Karin P.')];
    const team = await als<{ id: string; medewerker_id: string; van: string }>(MEDEWERKER, 'select * from rp_verlof_team() order by van');
    // het verlof van de collega's (het eigen staat in de tabel), niet van Karin uit Amsterdam
    expect(new Set(team.map((t) => t.medewerker_id))).toEqual(new Set([bas]));
    expect(team.some((t) => t.medewerker_id === karin || t.medewerker_id === tessa)).toBe(false);
    expect(Object.keys(team[0]).sort()).toEqual(['id', 'medewerker_id', 'regio', 'status', 'tot', 'van']);
    // het verlof van Bas zelf (met opmerking) is niet leesbaar
    expect((await als<{ n: number }>(MEDEWERKER, "select count(*)::int n from rp_verlof where opmerking = 'geheim'"))[0].n).toBe(0);
    // het eigen verlof uit de tabel, dat van de collega's uit de functie
    const sql = (eigen: string) => `with alles as (select id, medewerker_id from rp_verlof where status = 'goedgekeurd' union all select id, medewerker_id from rp_verlof_team() where status = 'goedgekeurd')
      insert into rp_ruil (regio, soort, aanbieder_id, datum, dienst, ontvanger_id, verlof_id, tegen_verlof_id)
      select 'Utrecht', 'verlof', rp_mijn_medewerker(), current_date + 30, 'V', b.medewerker_id, a.id, b.id
      from alles a, alles b where a.medewerker_id ${eigen} rp_mijn_medewerker() and b.medewerker_id <> a.medewerker_id limit 1 returning soort`;
    expect(await als(MEDEWERKER, sql('='))).toEqual([{ soort: 'verlof' }]);
    await expect(als(MEDEWERKER, sql('<>'))).rejects.toThrow(/row-level security/);
    await expect(db.exec("insert into rp_ruil (regio, soort, aanbieder_id, datum, dienst) select regio, 'verlof', id, current_date, 'V' from rp_medewerker limit 1")).rejects.toThrow(/check constraint/);
  });

  it('vakantierondes per cluster, ziekmeldingen per regio', async () => {
    const data = "current_date + 30, current_date + 40, current_date + 45, current_date + 50, current_date + 60";
    const r = await als<{ fase: string }>(PLANNER, `insert into rp_vakantieronde (naam, cluster, van, tot, datum_aanvragen, datum_analyse, datum_advies, datum_gesprek, datum_besluit, door) values ('Zomer', 'O', '2027-07-01', '2027-08-31', ${data}, 'Plan') returning fase`);
    expect(r).toEqual([{ fase: 'planning' }]);
    await expect(als(REGIOMANAGER, `insert into rp_vakantieronde (naam, cluster, van, tot, datum_aanvragen, datum_analyse, datum_advies, datum_gesprek, datum_besluit, door) values ('Zomer', 'NW', '2027-07-01', '2027-08-31', ${data}, 'Rianne')`)).rejects.toThrow(/row-level security/);
    expect((await als<{ n: number }>(MEDEWERKER, "select count(*)::int n from rp_vakantieronde where naam = 'Zomer'"))[0].n).toBe(1);

    expect(await als(PLANNER, "insert into rp_ziekmelding (medewerker_id, regio, van, door) select id, regio, current_date, 'Plan' from rp_medewerker where regio = 'Utrecht' returning regio")).toHaveLength(2);
    const karin = (await als<{ id: string }>(BEHEER, "select id from rp_medewerker where naam = 'Karin P.'"))[0].id;
    await expect(als(REGIOMANAGER, `insert into rp_ziekmelding (medewerker_id, regio, van, door) values ('${karin}', 'Amsterdam', current_date, 'Rianne')`)).rejects.toThrow(/row-level security/);
    expect((await als<{ n: number }>(MEDEWERKER, 'select count(*)::int n from rp_ziekmelding'))[0].n).toBe(1); // alleen de eigen melding
  });

  it('diensttijden: eigen tijden binnen de kaders, en de goedkeuring van het rooster', async () => {
    // eigen tijden bij een eigen gepubliceerde dienst
    await db.exec("insert into rp_rooster_gepubliceerd (medewerker_id, datum, regio, dienst) select id, current_date + 5, regio, 'DG2' from rp_medewerker where naam = 'Tessa J.'");
    expect(await als(MEDEWERKER, "insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur) values (rp_mijn_medewerker(), current_date + 5, 'Utrecht', 'DG2', 9.5, 17.5) returning dienst")).toEqual([{ dienst: 'DG2' }]);
    await expect(db.exec("insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur) select id, current_date + 6, regio, 'DG2', 7, 20 from rp_medewerker limit 1")).rejects.toThrow(/check constraint/);
    const bas = (await als<{ id: string }>(BEHEER, "select id from rp_medewerker where naam = 'Bas O.'"))[0].id;
    await expect(als(MEDEWERKER, `insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur) values ('${bas}', current_date + 5, 'Utrecht', 'DG1', 9, 13)`)).rejects.toThrow(/row-level security/);
    // een rooster met harde overtredingen kan niet ter goedkeuring
    await expect(als(PLANNER, `insert into rp_goedkeuring (regio, maand, status, versie, cijfer, hard, door, advies, advies_door) values ('Utrecht', ${maand(2)}, 'ter_goedkeuring', 'v1', 5.4, 2, 'Plan', 'groen', 'Plan')`)).rejects.toThrow(/check constraint/);
    expect(await als(PLANNER, `insert into rp_goedkeuring (regio, maand, status, versie, cijfer, door, advies, advies_door) values ('Utrecht', ${maand(2)}, 'ter_goedkeuring', 'v1', 8.7, 'Plan', 'groen', 'Plan') returning status`)).toEqual([{ status: 'ter_goedkeuring' }]);
    expect(await als(MEDEWERKER, 'select * from rp_goedkeuring')).toEqual([]);
  });

  it('een medewerker wijzigt geen team, rooster of instellingen, en ziet geen rooster in de maak van collega\'s', async () => {
    // het eigen contract of het team aanpassen: niets
    expect(await als(MEDEWERKER, 'update rp_medewerker set contract = 40 returning id')).toEqual([]);
    await expect(als(MEDEWERKER, "insert into rp_medewerker (regio, naam, contract) values ('Utrecht', 'Nep', 24)")).rejects.toThrow(/row-level security/);
    expect(await als(MEDEWERKER, 'delete from rp_medewerker returning id')).toEqual([]);
    // het rooster in de maak: niet lezen, niet zetten
    await expect(als(MEDEWERKER, "insert into rp_rooster (medewerker_id, datum, regio, dienst) values (rp_mijn_medewerker(), current_date + 20, 'Utrecht', '1')")).rejects.toThrow(/row-level security/);
    expect(await als(MEDEWERKER, "update rp_rooster set dienst = 'V' returning dienst")).toEqual([]);
    // instellingen en roosterbasis: alleen beheerder en planners
    await expect(als(MEDEWERKER, "insert into rp_instelling (sleutel, waarde) values ('beleid', '{}')")).rejects.toThrow(/row-level security/);
    await expect(als(MEDEWERKER, "insert into rp_instelling (sleutel, waarde) values ('roosterbasis', '{}')")).rejects.toThrow(/row-level security/);
    // diensttijden van een collega: pas zichtbaar als die dag is gepubliceerd
    const bas = (await db.query<{ id: string }>("select id from rp_medewerker where naam = 'Bas O.'")).rows[0].id;
    await db.exec(`insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur) values ('${bas}', current_date + 30, 'Utrecht', 'DG1', 9, 17), ('${bas}', '2026-10-06', 'Utrecht', '1', 9, 17) on conflict do nothing`);
    const zicht = await als<{ datum: string }>(MEDEWERKER, `select datum::text from rp_tijd where medewerker_id = '${bas}' order by datum`);
    expect(zicht.map((r) => r.datum)).toEqual(['2026-10-06']);
    // de publicatie (met de vorige versie van het rooster) van een andere regio: niet zichtbaar
    await db.exec("update auth.sessie set uid = null; insert into rp_publicatie (regio, door, van, tot) values ('Amsterdam', 'Plan', '2026-10-01', '2026-10-31') on conflict do nothing");
    expect((await als<{ regio: string }>(MEDEWERKER, 'select regio from rp_publicatie')).every((r) => r.regio === 'Utrecht')).toBe(true);
    expect((await als<{ regio: string }>(PLANNER, "select regio from rp_publicatie where regio = 'Amsterdam'"))).toHaveLength(1);
  });

  it('normen en schoolvakanties: iedereen leest, alleen de beheerder wijzigt', async () => {
    expect((await als<{ n: number }>(MEDEWERKER, 'select count(*)::int n from rp_norm_regio'))[0].n).toBe(2);
    expect(await als(PLANNER, "update rp_norm_regio set correctie = 1.1 returning regio")).toEqual([]);
    expect(await als(BEHEER, "update rp_norm_regio set correctie = 1.1 where regio = 'Utrecht' returning regio")).toEqual([{ regio: 'Utrecht' }]);
    await als(BEHEER, "insert into rp_schoolvakantie (id, naam, regio, van, tot, bron) values ('zv27m', 'Zomervakantie', 'midden', '2027-07-17', '2027-08-29', 'indicatief')");
    await expect(als(PLANNER, "insert into rp_schoolvakantie (id, naam, regio, van, tot) values ('x', 'X', 'noord', '2027-01-01', '2027-01-02')")).rejects.toThrow(/row-level security/);
    expect((await als<{ n: number }>(MEDEWERKER, 'select count(*)::int n from rp_schoolvakantie'))[0].n).toBe(1);
  });
});

describe('nabestaandendesk (NBD)', () => {
  const NBD_RM = 5;
  beforeAll(async () => {
    await db.exec(`
      reset role;
      update auth.sessie set uid = null;
      insert into users (auth_id, email, naam, rol, regios) select '00000000-0000-0000-0000-000000000005', 'nbd@voorbeeld.nl', 'Nora', 'Regio Manager', array[id] from regios where naam = 'NBD';
      insert into rp_medewerker (regio, naam, contract) values ('NBD', 'Noah V.', 32);
    `);
  });

  it('de werkregio NBD staat in de tabel regios (één keer, ook als het schema opnieuw draait)', async () => {
    await db.exec(SCHEMA);
    expect((await db.query<{ n: number }>("select count(*)::int n from regios where naam = 'NBD'")).rows[0].n).toBe(1);
    expect((await als<{ g: string[] }>(NBD_RM, 'select rp_regios() g'))[0].g).toEqual(['NBD']);
  });

  it('een NBD-dienst met tijden en pauze; de pauze moet binnen de dienst vallen', async () => {
    const mid = "(select id from rp_medewerker where naam = 'Noah V.')";
    expect(await als(PLANNER, `insert into rp_rooster (medewerker_id, datum, regio, dienst) values (${mid}, '2026-11-02', 'NBD', 'N') returning dienst`)).toEqual([{ dienst: 'N' }]);
    expect(await als(PLANNER, `insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur, pauze_min, pauze_begin) values (${mid}, '2026-11-02', 'NBD', 'N', 8, 16.5, 30, 12) returning pauze_min`)).toEqual([{ pauze_min: 30 }]);
    await expect(als(PLANNER, `update rp_tijd set pauze_begin = 16.25 where medewerker_id = ${mid}`)).rejects.toThrow(/check constraint/);
    await expect(als(PLANNER, `update rp_tijd set pauze_min = 200 where medewerker_id = ${mid}`)).rejects.toThrow(/check constraint/);
    // een onbekende dienst blijft geweigerd
    await expect(als(PLANNER, `insert into rp_rooster (medewerker_id, datum, regio, dienst) values (${mid}, '2026-11-03', 'NBD', 'X')`)).rejects.toThrow(/check constraint/);
  });

  it('voorkeur en wens voor de avond', async () => {
    const mid = "(select id from rp_medewerker where naam = 'Noah V.')";
    expect(await als(PLANNER, `insert into rp_voorkeurprofiel (medewerker_id, dienst) values (${mid}, 'avond') returning dienst`)).toEqual([{ dienst: 'avond' }]);
    // wensen voert de medewerker zelf in; hier zonder RLS, om de controle op de soort te toetsen
    await db.exec('reset role');
    expect((await db.query(`insert into rp_wens (medewerker_id, regio, datum, soort) values (${mid}, 'NBD', '2026-11-04', 'avond') returning soort`)).rows).toEqual([{ soort: 'avond' }]);
    await expect(db.query(`insert into rp_wens (medewerker_id, regio, datum, soort) values (${mid}, 'NBD', '2026-11-05', 'nacht')`)).rejects.toThrow(/check constraint/);
  });

  it('maximale inzet en voorkeuren per uur (NBD-module)', async () => {
    const mid = "(select id from rp_medewerker where naam = 'Noah V.')";
    expect(await als(PLANNER, `update rp_medewerker set max_uren = 36 where id = ${mid} returning max_uren`)).toEqual([{ max_uren: '36.0' }]);
    await expect(als(PLANNER, `update rp_medewerker set max_uren = 80 where id = ${mid}`)).rejects.toThrow(/check constraint/);
    const uren = JSON.stringify({ even: Array(7).fill('g'.repeat(16)), oneven: Array(7).fill('.'.repeat(16)) });
    expect(await als(PLANNER, `update rp_voorkeurprofiel set uren = '${uren}' where medewerker_id = ${mid} returning uren->'even'->>0 as ma`)).toEqual([{ ma: 'g'.repeat(16) }]);
    await expect(als(PLANNER, `update rp_voorkeurprofiel set uren = '[1, 2]' where medewerker_id = ${mid}`)).rejects.toThrow(/check constraint/);
  });

  it('een medewerker van de NBD verandert de eigen diensttijden niet (dat doet de planner), maar ziet ze wel', async () => {
    await db.exec(`
      reset role;
      update auth.sessie set uid = null;
      insert into users (auth_id, email, naam, rol, regios) select '00000000-0000-0000-0000-000000000006', 'nina@voorbeeld.nl', 'Nina', 'Uitvaartverzorger/Leider', array[id] from regios where naam = 'NBD';
      insert into rp_medewerker (regio, naam, contract, email) values ('NBD', 'Nina N.', 24, 'nina@voorbeeld.nl');
      insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur, pauze_min) select id, '2026-11-09', 'NBD', 'N', 9, 17.5, 30 from rp_medewerker where naam = 'Nina N.';
    `);
    const NINA = 6;
    expect(await als(NINA, "select dienst from rp_tijd where regio = 'NBD' and medewerker_id = rp_mijn_medewerker()")).toEqual([{ dienst: 'N' }]);
    expect(await als(NINA, 'update rp_tijd set eind_uur = 20 returning eind_uur')).toEqual([]);
    await expect(als(NINA, "insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur) values (rp_mijn_medewerker(), '2026-11-10', 'NBD', 'N', 9, 17)")).rejects.toThrow(/row-level security/);
    // taken in een dienst: een lijst met blokken
    const nina = "(select id from rp_medewerker where naam = 'Nina N.')";
    await expect(db.exec(`update rp_tijd set taken = '{"soort": "training"}' where medewerker_id = ${nina}`)).rejects.toThrow(/check constraint/);
    await db.exec(`update rp_tijd set taken = '[{"soort": "training", "van": 13, "tot": 13.5}]' where medewerker_id = ${nina}`);
    await db.exec(`delete from rp_tijd where medewerker_id = ${nina}`);
  });

  it('een regiomanager van de NBD werkt alleen in de NBD; die van Utrecht niet in de NBD', async () => {
    expect((await als<{ n: number }>(NBD_RM, "select count(*)::int n from rp_rooster where regio = 'NBD'"))[0].n).toBe(1);
    expect((await als<{ n: number }>(NBD_RM, "select count(*)::int n from rp_rooster where regio <> 'NBD'"))[0].n).toBe(0);
    expect(await als(NBD_RM, "update rp_tijd set eind_uur = 17 where regio = 'NBD' returning eind_uur")).toEqual([{ eind_uur: '17.00' }]);
    expect(await als(REGIOMANAGER, "update rp_rooster set dienst = 'V' where regio = 'NBD' returning dienst")).toEqual([]);
  });
});
