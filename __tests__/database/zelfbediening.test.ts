// @vitest-environment node
/**
 * Zelfbediening en rechten op Postgres (PGlite): wat een medewerker zelf mag, wat de planner bij iemand die uit het
 * team gaat, lopende zaken in een aangeboden maand, en een vakantieronde die per regiomanager wordt besloten.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { maakOmgeving, uid, BEHEER, PLANNER, MEDEWERKER, REGIOMANAGER } from './pgdb';

let db: PGlite;

async function als<T = Record<string, unknown>>(wie: number | null, sql: string): Promise<T[]> {
  await db.exec(`reset role; update auth.sessie set uid = ${wie ? `'${uid(wie)}'` : 'null'};${wie ? ' set role authenticated;' : ''}`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const idVan = async (naam: string) => (await als<{ id: string }>(null, `select id from rp_medewerker where naam = '${naam}'`))[0].id;

beforeAll(async () => {
  db = await maakOmgeving();
  await db.exec(`
    insert into rp_medewerker (regio, naam, contract, email) values
      ('Utrecht', 'Tessa J.', 32, 'tessa@voorbeeld.nl'), ('Utrecht', 'Bas O.', 24, null), ('Utrecht', 'Ruud K.', 28, null), ('Amsterdam', 'Karin P.', 32, null);
    insert into rp_norm_regio (regio, cluster, natura, cbs, vrije_markt, amplitude, fte) values
      ('Utrecht', 'O', 1003.9, 6764, 0.065, 0.962, '{11.61,11.61,11.61,11.61}'), ('Amsterdam', 'NW', 1100, 7000, 0.06, 0.78, '{12.8,12.8,12.8,12.8}');
  `);
}, 60_000);

describe('wie ben ik', () => {
  it('altijd dezelfde regel: eerst de koppeling via het account, dan het e-mailadres', async () => {
    const tessa = await idVan('Tessa J.');
    expect((await als<{ m: string }>(MEDEWERKER, 'select rp_mijn_medewerker() m'))[0].m).toBe(tessa);
    // een tweede regel met hetzelfde e-mailadres: steeds dezelfde keuze
    await als(null, "insert into rp_medewerker (regio, naam, contract, email) values ('Amsterdam', 'Tessa J. (2)', 32, 'tessa@voorbeeld.nl')");
    const keuzes = new Set<string>();
    for (let i = 0; i < 5; i++) keuzes.add((await als<{ m: string }>(MEDEWERKER, 'select rp_mijn_medewerker() m'))[0].m);
    expect(keuzes.size).toBe(1);
    // gekoppeld via het account gaat voor
    const tweede = await idVan('Tessa J. (2)');
    await als(null, `update rp_medewerker set user_id = (select id from users where auth_id = '${uid(MEDEWERKER)}') where id = '${tweede}'`);
    expect((await als<{ m: string }>(MEDEWERKER, 'select rp_mijn_medewerker() m'))[0].m).toBe(tweede);
    await als(null, `delete from rp_medewerker where id = '${tweede}'`);
    expect((await als<{ m: string }>(MEDEWERKER, 'select rp_mijn_medewerker() m'))[0].m).toBe(tessa);
  });
});

describe('verlof', () => {
  it("van collega's: wie en wanneer, goedgekeurd en aangevraagd, alleen in de eigen regio", async () => {
    const [bas, karin] = [await idVan('Bas O.'), await idVan('Karin P.')];
    await als(null, `
      insert into rp_verlof (medewerker_id, regio, van, tot, soort, status, opmerking) values
        ('${bas}', 'Utrecht', current_date + 40, current_date + 44, 'vakantie', 'goedgekeurd', 'privé'),
        ('${bas}', 'Utrecht', current_date + 70, current_date + 71, 'adv', 'aangevraagd', null),
        ('${bas}', 'Utrecht', current_date + 80, current_date + 81, 'adv', 'afgewezen', null),
        ('${bas}', 'Utrecht', make_date(extract(year from current_date)::int - 2, 6, 1), make_date(extract(year from current_date)::int - 2, 6, 5), 'vakantie', 'goedgekeurd', null),
        ('${karin}', 'Amsterdam', current_date + 40, current_date + 44, 'vakantie', 'goedgekeurd', null);
    `);
    const team = await als<Record<string, unknown>>(MEDEWERKER, 'select * from rp_verlof_team() order by van');
    expect(team.map((t) => [t.medewerker_id, t.status])).toEqual([[bas, 'goedgekeurd'], [bas, 'aangevraagd']]);
    expect(Object.keys(team[0]).sort()).toEqual(['id', 'medewerker_id', 'regio', 'status', 'tot', 'van']);
    // wie plant, leest de tabel; de functie geeft dan niets
    expect(await als(PLANNER, 'select * from rp_verlof_team()')).toEqual([]);
  });

  it('een medewerker vraagt aan in de eigen regio en trekt alleen een eigen aanvraag in', async () => {
    const aanvraag = (extra = '', regio = 'Utrecht') => `insert into rp_verlof (medewerker_id, regio, van, tot, soort${extra ? ', beoordeelaar' : ''}) values (rp_mijn_medewerker(), '${regio}', current_date + 20, current_date + 21, 'adv'${extra ? `, '${extra}'` : ''}) returning id`;
    await expect(als(MEDEWERKER, aanvraag('', 'Amsterdam'))).rejects.toThrow(/row-level security/);
    await expect(als(MEDEWERKER, aanvraag('Rianne'))).rejects.toThrow(/row-level security/);
    const [{ id }] = await als<{ id: string }>(MEDEWERKER, aanvraag());
    // alleen intrekken: niet de periode verschuiven of het verlof aan een ander geven
    await expect(als(MEDEWERKER, `update rp_verlof set status = 'ingetrokken', tot = current_date + 30 where id = '${id}'`)).rejects.toThrow(/alleen intrekken/);
    await expect(als(MEDEWERKER, `update rp_verlof set status = 'ingetrokken', medewerker_id = '${await idVan('Bas O.')}' where id = '${id}'`)).rejects.toThrow(/alleen intrekken|row-level security/);
    expect(await als(MEDEWERKER, `update rp_verlof set status = 'ingetrokken', beoordeelaar = 'Tessa' where id = '${id}' returning status`)).toEqual([{ status: 'ingetrokken' }]);
    // goedgekeurd verlof trekt de regiomanager in, niet de medewerker zelf
    const [{ id: goed }] = await als<{ id: string }>(null, "insert into rp_verlof (medewerker_id, regio, van, tot, soort, status) select id, regio, current_date + 50, current_date + 54, 'vakantie', 'goedgekeurd' from rp_medewerker where naam = 'Tessa J.' returning id");
    expect(await als(MEDEWERKER, `update rp_verlof set status = 'ingetrokken' where id = '${goed}' returning id`)).toEqual([]);
    expect((await als<{ status: string }>(null, `select status from rp_verlof where id = '${goed}'`))[0].status).toBe('goedgekeurd');
  });

  it('wie uit het team gaat: de planner laat open aanvragen en toekomstig verlof vervallen', async () => {
    const ruud = await idVan('Ruud K.');
    const [{ id: open }] = await als<{ id: string }>(null, `insert into rp_verlof (medewerker_id, regio, van, tot, soort) values ('${ruud}', 'Utrecht', current_date + 10, current_date + 12, 'adv') returning id`);
    const [{ id: goed }] = await als<{ id: string }>(null, `insert into rp_verlof (medewerker_id, regio, van, tot, soort, status) values ('${ruud}', 'Utrecht', current_date - 2, current_date + 12, 'vakantie', 'goedgekeurd') returning id`);
    // zolang Ruud in het team zit, besluit de regiomanager
    await expect(als(PLANNER, `update rp_verlof set status = 'ingetrokken' where id = '${open}'`)).rejects.toThrow(/row-level security/);
    expect(await als(PLANNER, `update rp_medewerker set actief = false where id = '${ruud}' returning actief`)).toEqual([{ actief: false }]);
    expect(await als(PLANNER, `update rp_verlof set status = 'ingetrokken', beoordeelaar = 'systeem' where id = '${open}' returning status`)).toEqual([{ status: 'ingetrokken' }]);
    expect(await als(PLANNER, `update rp_verlof set tot = current_date where id = '${goed}' returning status`)).toEqual([{ status: 'goedgekeurd' }]);
  });
});

describe('verlof goedkeuren door de planner', () => {
  it('standaard besluit de regiomanager; zet de beheerder het aan, dan ook de planner', async () => {
    const bas = await idVan('Bas O.');
    const aanvraag = async () => (await als<{ id: string }>(null, `insert into rp_verlof (medewerker_id, regio, van, tot, soort) values ('${bas}', 'Utrecht', current_date + 90, current_date + 91, 'adv') returning id`))[0].id;
    const besluit = (id: string, status: string) => `update rp_verlof set status = '${status}', beoordeelaar = 'Planner' where id = '${id}' returning status`;
    const ronde = async () => (await als<{ id: string }>(null, `insert into rp_vakantieronde (naam, cluster, van, tot, datum_aanvragen, datum_analyse, datum_advies, datum_gesprek, datum_besluit, door)
      values ('Zomer', 'O', current_date + 200, current_date + 260, current_date + 10, current_date + 20, current_date + 30, current_date + 40, current_date + 50, 'Planner') returning id`))[0].id;
    // standaard niet
    const eerste = await aanvraag();
    await expect(als(PLANNER, besluit(eerste, 'goedgekeurd'))).rejects.toThrow(/row-level security/);
    const r1 = await ronde();
    await expect(als(PLANNER, `update rp_vakantieronde set fase = 'besloten' where id = '${r1}'`)).rejects.toThrow(/row-level security/);
    // de planner zet de instelling niet zelf aan
    await expect(als(PLANNER, `insert into rp_instelling (sleutel, waarde) values ('beleid', '{"plannerBesluitVerlof": true}') on conflict (sleutel) do update set waarde = excluded.waarde`)).rejects.toThrow(/row-level security/);
    // de beheerder zet het aan: dan mag de planner goedkeuren, afwijzen, intrekken en de vakantieronde besluiten
    await als(BEHEER, `insert into rp_instelling (sleutel, waarde) values ('beleid', '{"plannerBesluitVerlof": true, "omHetWeekend": true}') on conflict (sleutel) do update set waarde = excluded.waarde`);
    expect(await als(PLANNER, besluit(eerste, 'goedgekeurd'))).toEqual([{ status: 'goedgekeurd' }]);
    expect(await als(PLANNER, besluit(await aanvraag(), 'afgewezen'))).toEqual([{ status: 'afgewezen' }]);
    expect(await als(PLANNER, besluit(eerste, 'ingetrokken'))).toEqual([{ status: 'ingetrokken' }]);
    expect(await als(PLANNER, `update rp_vakantieronde set fase = 'besloten' where id = '${r1}' returning fase`)).toEqual([{ fase: 'besloten' }]);
    // een medewerker nog steeds niet
    expect(await als(MEDEWERKER, besluit(await aanvraag(), 'goedgekeurd'))).toEqual([]);
    // en weer uit: dan weer alleen de regiomanager
    await als(BEHEER, `update rp_instelling set waarde = '{"plannerBesluitVerlof": false}' where sleutel = 'beleid'`);
    const derde = await aanvraag();
    await expect(als(PLANNER, besluit(derde, 'goedgekeurd'))).rejects.toThrow(/row-level security/);
    expect(await als(REGIOMANAGER, besluit(derde, 'goedgekeurd'))).toEqual([{ status: 'goedgekeurd' }]);
    await als(null, "delete from rp_instelling where sleutel = 'beleid'");
  });
});

describe('logboek', () => {
  it('een medewerker schrijft op eigen naam, binnen de eigen regio en niet voor de hele regio', async () => {
    const [bas, karin] = [await idVan('Bas O.'), await idVan('Karin P.')];
    // zonder returning, zoals de app: een regel voor een collega kan de schrijver zelf niet teruglezen
    const regel = (tekst: string, o: { regio?: string; voor?: string; breed?: boolean }) => `insert into rp_activiteit (soort, tekst, regio, voor, regio_breed, door, moment)
      values ('ruil', '${tekst}', '${o.regio ?? 'Utrecht'}', ${o.voor ? `'${o.voor}'` : 'null'}, ${o.breed ? 'true' : 'false'}, 'Regiomanager', now() - interval '30 days')`;
    const opgeslagen = async (tekst: string) => als<{ door: string; nu: boolean }>(null, `select door, moment > now() - interval '1 minute' as nu from rp_activiteit where tekst = '${tekst}'`);
    await als(MEDEWERKER, regel('voor Bas', { voor: bas }));
    expect(await opgeslagen('voor Bas')).toEqual([{ door: 'Tessa', nu: true }]);
    await als(MEDEWERKER, regel('zonder voor', {}));
    expect(await opgeslagen('zonder voor')).toEqual([{ door: 'Tessa', nu: true }]);
    await expect(als(MEDEWERKER, regel('hele regio', { breed: true }))).rejects.toThrow(/row-level security/);
    await expect(als(MEDEWERKER, regel('voor Karin', { voor: karin }))).rejects.toThrow(/row-level security/);
    await expect(als(MEDEWERKER, regel('Amsterdam', { regio: 'Amsterdam' }))).rejects.toThrow(/row-level security/);
    // wie plant, schrijft wat de app meegeeft
    await als(PLANNER, regel('planner', { breed: true }));
    expect((await opgeslagen('planner'))[0].door).toBe('Regiomanager');
  });
});

describe('ruilen', () => {
  it('een medewerker zet alleen de eigen stap, met de eigen naam erbij', async () => {
    const [tessa, bas] = [await idVan('Tessa J.'), await idVan('Bas O.')];
    const ruil = async (aanbieder: string, ontvanger: string) => (await als<{ id: string }>(null, `insert into rp_ruil (regio, soort, aanbieder_id, datum, dienst, ontvanger_id, tegen_datum, tegen_dienst)
      values ('Utrecht', 'ruilen', '${aanbieder}', current_date + 9, '1', '${ontvanger}', current_date + 9, '1M') returning id`))[0].id;
    const weigeren = await ruil(bas, tessa);
    expect(await als(MEDEWERKER, `update rp_ruil set status = 'afgewezen', beoordeelaar = 'Planner', reden = 'Afgewezen door de planner' where id = '${weigeren}' returning beoordeelaar, reden`))
      .toEqual([{ beoordeelaar: 'Tessa J.', reden: 'Geweigerd door Tessa J.' }]);
    const akkoord = await ruil(bas, tessa);
    expect(await als(MEDEWERKER, `update rp_ruil set status = 'wacht_planner', beoordeelaar = 'planner', toets = '{"ok": true}' where id = '${akkoord}' returning beoordeelaar, geaccepteerd is not null as geaccepteerd`))
      .toEqual([{ beoordeelaar: null, geaccepteerd: true }]);
    const intrekken = await ruil(tessa, bas);
    await als(null, `update rp_ruil set toets = '{"ok": false}' where id = '${intrekken}'`);
    expect(await als(MEDEWERKER, `update rp_ruil set status = 'ingetrokken', toets = '{"ok": true}' where id = '${intrekken}' returning beoordeelaar, toets ->> 'ok' as ok`))
      .toEqual([{ beoordeelaar: 'Tessa J.', ok: 'false' }]);
    // verlopen zetten doet de planner (of het onderhoud in de app van de planner)
    const verlopen = await ruil(bas, tessa);
    await expect(als(MEDEWERKER, `update rp_ruil set status = 'verlopen' where id = '${verlopen}'`)).rejects.toThrow(/mag je niet zetten/);
  });
});

describe('diensttijden', () => {
  it('eigen tijden vanaf vandaag, alleen bij een eigen dienst in het gepubliceerde rooster', async () => {
    const tessa = await idVan('Tessa J.');
    await als(null, `insert into rp_rooster_gepubliceerd (medewerker_id, datum, regio, dienst) values ('${tessa}', current_date + 5, 'Utrecht', 'DG2'), ('${tessa}', current_date - 1, 'Utrecht', 'DG1')`);
    const tijd = (dag: number, dienst: string) => `insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur) values (rp_mijn_medewerker(), current_date + ${dag}, 'Utrecht', '${dienst}', 9.5, 17.5) returning dienst`;
    expect(await als(MEDEWERKER, tijd(5, 'DG2'))).toEqual([{ dienst: 'DG2' }]);
    await expect(als(MEDEWERKER, tijd(6, 'DG2'))).rejects.toThrow(/row-level security/);     // geen gepubliceerde dienst
    await expect(als(MEDEWERKER, tijd(-1, 'DG1'))).rejects.toThrow(/row-level security/);    // voorbij
    await expect(als(MEDEWERKER, `update rp_tijd set dienst = 'DG1' where datum = current_date + 5 returning dienst`)).rejects.toThrow(/row-level security/);
    expect(await als(MEDEWERKER, 'update rp_tijd set eind_uur = 18 where datum = current_date + 5 returning eind_uur::float e')).toEqual([{ e: 18 }]);
    await als(null, `insert into rp_tijd (medewerker_id, datum, regio, dienst, begin_uur, eind_uur) values ('${tessa}', current_date - 1, 'Utrecht', 'DG1', 9, 13)`);
    expect(await als(MEDEWERKER, 'delete from rp_tijd where datum = current_date - 1 returning datum')).toEqual([]);
  });
});

describe('vaststelling en publicatie', () => {
  const maand = (n: number) => `to_char(current_date + interval '${n} month', 'YYYY-MM')`;

  it('het gepubliceerde rooster alleen binnen wat gepubliceerd is', async () => {
    const bas = await idVan('Bas O.');
    await als(null, "insert into rp_publicatie (regio, door, van, tot) values ('Utrecht', 'Plan', current_date - 3, current_date + 10) on conflict (regio) do update set van = excluded.van, tot = excluded.tot");
    expect(await als(PLANNER, `insert into rp_rooster_gepubliceerd (medewerker_id, datum, regio, dienst) values ('${bas}', current_date + 10, 'Utrecht', '1') returning dienst`)).toEqual([{ dienst: '1' }]);
    await expect(als(PLANNER, `insert into rp_rooster_gepubliceerd (medewerker_id, datum, regio, dienst) values ('${bas}', current_date + 11, 'Utrecht', '1')`)).rejects.toThrow(/row-level security/);
    expect(await als(PLANNER, `delete from rp_rooster_gepubliceerd where medewerker_id = '${bas}' and datum = current_date + 10 returning dienst`)).toEqual([{ dienst: '1' }]);
  });

  it('lopende zaken in een aangeboden maand: ook de regiomanager en de beheerder zetten de versie bij, maar alleen die', async () => {
    const deze = `regio = 'Utrecht' and maand = ${maand(1)}`;
    expect(await als(PLANNER, `insert into rp_goedkeuring (regio, maand, status, versie, cijfer, door, advies, advies_door) values ('Utrecht', ${maand(1)}, 'ter_goedkeuring', 'v1', 8.7, 'Plan', 'groen', 'Plan') returning status`)).toEqual([{ status: 'ter_goedkeuring' }]);
    expect(await als(REGIOMANAGER, `update rp_goedkeuring set versie = 'v2' where ${deze} returning versie`)).toEqual([{ versie: 'v2' }]);
    expect(await als(BEHEER, `update rp_goedkeuring set versie = 'v3' where ${deze} returning versie`)).toEqual([{ versie: 'v3' }]);
    await expect(als(REGIOMANAGER, `update rp_goedkeuring set versie = 'v4', door = 'Rianne' where ${deze}`)).rejects.toThrow(/Alleen de planner biedt/);
    await expect(als(REGIOMANAGER, `update rp_goedkeuring set versie = 'v4', advies = 'oranje', advies_toelichting = 'Twee dagen krap in week 3' where ${deze}`)).rejects.toThrow(/Alleen de planner geeft/);
    // afkeuren doet de regiomanager; opnieuw aanbieden alleen de planner
    expect(await als(REGIOMANAGER, `update rp_goedkeuring set status = 'afgekeurd', reden = 'Meer 1B in het weekend', beoordeelaar = 'Rianne' where ${deze} returning status`)).toEqual([{ status: 'afgekeurd' }]);
    await expect(als(REGIOMANAGER, `update rp_goedkeuring set status = 'ter_goedkeuring' where ${deze}`)).rejects.toThrow(/Alleen de planner biedt/);
    expect(await als(PLANNER, `update rp_goedkeuring set status = 'ter_goedkeuring', reden = null where ${deze} returning status`)).toEqual([{ status: 'ter_goedkeuring' }]);
  });
});

describe('vakantieronde', () => {
  it('besloten zodra er in de hele ronde niets meer open staat, ook als niemand alle regio’s ziet', async () => {
    const [tessa, karin] = [await idVan('Tessa J.'), await idVan('Karin P.')];
    const data = 'current_date + 30, current_date + 40, current_date + 45, current_date + 50, current_date + 60';
    const [{ id: ronde }] = await als<{ id: string }>(PLANNER, `insert into rp_vakantieronde (naam, cluster, van, tot, datum_aanvragen, datum_analyse, datum_advies, datum_gesprek, datum_besluit, door, fase)
      values ('Zomer', 'NL', current_date + 200, current_date + 260, ${data}, 'Plan', 'planning') returning id`);
    const aanvraag = async (mid: string, regio: string) => (await als<{ id: string }>(null, `insert into rp_verlof (medewerker_id, regio, van, tot, soort, ronde_id) values ('${mid}', '${regio}', current_date + 210, current_date + 223, 'vakantie', '${ronde}') returning id`))[0].id;
    const [a, b, c] = [await aanvraag(tessa, 'Utrecht'), await aanvraag(karin, 'Amsterdam'), await aanvraag(karin, 'Amsterdam')];
    const fase = async () => (await als<{ fase: string }>(null, `select fase from rp_vakantieronde where id = '${ronde}'`))[0].fase;
    // tijdens het aanvragen sluit een ingetrokken aanvraag de ronde niet
    await als(null, `update rp_verlof set status = 'ingetrokken' where id = '${c}'`);
    expect(await fase()).toBe('planning');
    await als(PLANNER, `update rp_vakantieronde set fase = 'gesprek' where id = '${ronde}'`);
    // de regiomanager van Utrecht besluit voor Utrecht: Amsterdam staat nog open
    expect(await als(REGIOMANAGER, `update rp_verlof set status = 'goedgekeurd' where id = '${a}' returning status`)).toEqual([{ status: 'goedgekeurd' }]);
    expect(await fase()).toBe('gesprek');
    await als(null, `update rp_verlof set status = 'afgewezen' where id = '${b}'`);
    expect(await fase()).toBe('besloten');
  });
});

describe('snel lezen', () => {
  it('het rooster per medewerker in een vaste volgorde', async () => {
    await als(null, `insert into rp_rooster (medewerker_id, datum, regio, dienst) select id, current_date + 3, regio, '1' from rp_medewerker on conflict do nothing`);
    const ids = (await als<{ medewerker_id: string }>(PLANNER, `select medewerker_id from rp_rooster_versies_vanaf(current_date)`)).map((r) => r.medewerker_id);
    expect(ids.length).toBeGreaterThan(2);
    expect(ids).toEqual([...ids].sort());
    const collegas = (await als<{ id: string }>(MEDEWERKER, 'select id from rp_collegas()')).map((r) => r.id);
    expect(collegas).toEqual([...collegas].sort());
  });
});

describe('verlof na een goedgekeurd rooster', () => {
  it('op een dag met een dienst in het gepubliceerde rooster vraagt een medewerker geen verlof meer aan; de planner voert het nog wel in', async () => {
    const tessa = await idVan('Tessa J.');
    await als(null, `insert into rp_rooster_gepubliceerd (medewerker_id, datum, regio, dienst) values ('${tessa}', current_date + 150, 'Utrecht', '1'), ('${tessa}', current_date + 152, 'Utrecht', 'V')`);
    const aanvraag = (van: number, tot: number) => `insert into rp_verlof (medewerker_id, regio, van, tot, soort) values ('${tessa}', 'Utrecht', current_date + ${van}, current_date + ${tot}, 'vakantie') returning status`;
    await expect(als(MEDEWERKER, aanvraag(149, 151))).rejects.toThrow(/row-level security/);
    // een dag zonder dienst (of met verlof) kan wel
    await expect(als(MEDEWERKER, aanvraag(151, 152))).resolves.toEqual([{ status: 'aangevraagd' }]);
    await expect(als(PLANNER, aanvraag(150, 150))).resolves.toEqual([{ status: 'aangevraagd' }]);
  });
});

describe('wensen van het team', () => {
  it("een medewerker krijgt per dag alleen aantallen uit de eigen regio, zonder de eigen wens", async () => {
    // Ruud is in een eerdere test uit het team gegaan: een nieuwe collega
    await als(null, "insert into rp_medewerker (regio, naam, contract) values ('Utrecht', 'Nina N.', 28)");
    const [tessa, bas, nina, karin] = [await idVan('Tessa J.'), await idVan('Bas O.'), await idVan('Nina N.'), await idVan('Karin P.')];
    await db.exec(`reset role;
      insert into rp_medewerker (regio, naam, contract, extern) values ('Utrecht', 'Zed ZZP', 24, true);
      insert into rp_medewerker (regio, naam, contract, actief) values ('Utrecht', 'Uit Dienst', 24, false);
      delete from rp_wens;
      insert into rp_wens (medewerker_id, regio, datum, soort, opmerking) values
        ('${tessa}', 'Utrecht', current_date + 5, 'werken', null),
        ('${bas}', 'Utrecht', current_date + 5, 'ochtend', 'tandarts om drie uur'),
        ('${nina}', 'Utrecht', current_date + 5, 'vrij', null),
        ('${bas}', 'Utrecht', current_date + 6, 'neutraal', null),
        ('${nina}', 'Utrecht', current_date + 6, 'neutraal', null),
        ('${bas}', 'Utrecht', current_date + 7, 'overig8', null),
        ('${nina}', 'Utrecht', current_date + 7, 'overig4', null),
        ('${bas}', 'Utrecht', current_date - 1, 'vrij', null),
        ('${karin}', 'Amsterdam', current_date + 5, 'vrij', null),
        ((select id from rp_medewerker where naam = 'Zed ZZP'), 'Utrecht', current_date + 5, 'vrij', null),
        ((select id from rp_medewerker where naam = 'Uit Dienst'), 'Utrecht', current_date + 5, 'vrij', null);
    `);
    const team = await als<Record<string, unknown>>(MEDEWERKER, `select (datum - current_date) as over, werken, vrij, neutraal, overig from rp_wensen_team()`);
    // de eigen wens (werken), Amsterdam, de ZZP'er, wie uit dienst is en gisteren tellen niet mee; een dagdeel is "wil werken"
    expect(team).toEqual([{ over: 5, werken: 1, vrij: 1, neutraal: 0, overig: 0 }, { over: 6, werken: 0, vrij: 0, neutraal: 2, overig: 0 }, { over: 7, werken: 0, vrij: 0, neutraal: 0, overig: 2 }]);
    // geen namen en geen opmerkingen: alleen de datum en de aantallen
    expect(Object.keys((await als(MEDEWERKER, 'select * from rp_wensen_team()'))[0]).sort()).toEqual(['datum', 'neutraal', 'overig', 'vrij', 'werken']);
    // uit de tabel zelf leest een medewerker alleen de eigen wens
    expect(await als(MEDEWERKER, 'select medewerker_id from rp_wens')).toEqual([{ medewerker_id: tessa }]);
    // wie plant (zonder eigen regel in een team) leest de tabel; de functie geeft dan niets
    expect(await als(PLANNER, 'select * from rp_wensen_team()')).toEqual([]);
    // niet ingelogd: geen regio, dus niets
    expect(await als(null, 'select * from rp_wensen_team()')).toEqual([]);
  });

  it('een korte overige dienst (O4) mag in het rooster', async () => {
    const tessa = await idVan('Tessa J.');
    await expect(als(PLANNER, `insert into rp_rooster (medewerker_id, datum, regio, dienst) values ('${tessa}', current_date + 12, 'Utrecht', 'O4') returning dienst`)).resolves.toEqual([{ dienst: 'O4' }]);
    await expect(als(PLANNER, `insert into rp_rooster (medewerker_id, datum, regio, dienst) values ('${tessa}', current_date + 13, 'Utrecht', 'O2')`)).rejects.toThrow(/rp_rooster_dienst_check/);
  });

  it('"geen voorkeur" is een geldige wens, iets anders niet', async () => {
    await expect(als(MEDEWERKER, `insert into rp_wens (medewerker_id, regio, datum, soort) values (rp_mijn_medewerker(), 'Utrecht', current_date + 9, 'neutraal') returning soort`)).resolves.toEqual([{ soort: 'neutraal' }]);
    await expect(als(MEDEWERKER, `insert into rp_wens (medewerker_id, regio, datum, soort) values (rp_mijn_medewerker(), 'Utrecht', current_date + 10, 'misschien')`)).rejects.toThrow(/rp_wens_soort_check/);
  });
});
