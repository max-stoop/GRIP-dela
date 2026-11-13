// @vitest-environment node
/** De dagelijkse voorspelling op de server: status, alles of niets, en niet twee keer op een dag. */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { voerDagtaakUit, leesDagtaak, type DagtaakOpties } from '@/lib/taken/dagelijks';
import { dagtaakOverslaan } from '@/lib/taken/status';
import { voerUit, type Db } from '@/lib/store/db/db';
import { verschil } from '@/lib/store/db/verschil';
import { TABELLEN } from '@/lib/store/db/tabellen';
import { makeDemoHistory } from '@/lib/model/demo';
import { addDays, todayIso } from '@/lib/dates';
import type { AppState } from '@/lib/store/types';
import type { BronAntwoord } from '@/lib/model/bijhouden';
import { maakOmgeving, pgDb } from '../database/pgdb';

beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });

const vandaag = todayIso();
let klok = 0;
const nu = () => `${vandaag}T06:${String(Math.floor(klok / 60) % 60).padStart(2, '0')}:${String(klok++ % 60).padStart(2, '0')}`;
/** Riool niet bereikbaar, en alle andere reeksen maar drie dagen lang. */
const kapotRiool = async (bron: string): Promise<BronAntwoord> => {
  if (bron === 'riool') throw new Error('Niet bereikbaar');
  if (bron === 'normalen') return { bron, reeksen: [], rijen: 0, normaal: [1, 0.5, 0.2] };
  return { bron, reeksen: [{ sleutel: 'NL', variabele: 'proef', start: vandaag, v: [1, 2, 3] }], rijen: 3 };
};
/** Zoals de echte bronnen: verwachtingen lopen vooruit, metingen komen met vertraging. */
const BEREIK: Record<string, [number, number]> = { weer: [-14, 15], lucht: [-14, 4], seizoen: [0, 89], riool: [-60, -10], cbs: [-90, -17] };
const echt = (overslaan: string[] = [], verschuif = 0) => async (bron: string): Promise<BronAntwoord> => {
  if (overslaan.includes(bron)) throw new Error('Niet bereikbaar');
  if (bron === 'normalen') return { bron, reeksen: [], rijen: 0, normaal: [1, 0.5, 0.2] };
  const [van, tot] = BEREIK[bron];
  const n = tot - van + 1;
  return { bron, reeksen: [{ sleutel: 'NL', variabele: 'proef', start: addDays(vandaag, van + verschuif), v: Array(n).fill(1) }], rijen: n };
};
const haal = echt();
const opties = (o: Partial<DagtaakOpties> = {}): DagtaakOpties => ({ vandaag, nu, haal, ...o });
const instelling = async (pg: PGlite, sleutel: string) => (await pg.query<{ waarde: unknown }>('select waarde from rp_instelling where sleutel = $1', [sleutel])).rows[0]?.waarde;
const tel = async (pg: PGlite, tabel: string) => (await pg.query<{ n: number }>(`select count(*)::int n from ${tabel}`)).rows[0].n;

describe('de dagelijkse voorspelling op de server', () => {
  let pg: PGlite, db: Db;
  beforeAll(async () => { pg = await maakOmgeving(); db = pgDb(pg, null); }, 60_000);

  it('zonder meldingen: de bronnen verversen, een fout bij één bron blokkeert de rest niet (beperkt, niet volledig)', async () => {
    const u = await voerDagtaakUit(db, opties({ haal: kapotRiool }));
    expect(u).toMatchObject({ status: 'beperkt', datum: vandaag, waar: 'server', bronnen: { ok: 5, fout: 1 } });
    // riool is niet opgehaald; de rest liep maar drie dagen (verwachtingen te kort, metingen wel recent)
    expect(u.gebreken!.map((g) => `${g.bron}:${g.reden}`)).toEqual(['weer:verouderd', 'seizoen:verouderd', 'riool:geen gegevens']);
    expect(u.run).toBeUndefined();
    expect(await instelling(pg, 'laatsteAuto')).toBe(vandaag);
    expect(await instelling(pg, 'normaal')).toEqual([1, 0.5, 0.2]);
    expect(await leesDagtaak(db)).toMatchObject({ status: 'beperkt' });
    const st = (await pg.query<{ bron: string; ok: boolean }>('select bron, ok from rp_bron_status order by bron')).rows;
    expect(st.find((x) => x.bron === 'riool')!.ok).toBe(false);
    expect(st.filter((x) => x.ok)).toHaveLength(5);
    expect(await tel(pg, 'rp_extern')).toBe(4);
    expect((await pg.query<{ tekst: string }>('select tekst from rp_activiteit')).rows[0].tekst).toMatch(/bronnen 5 van 6 gelukt/);
  }, 60_000);

  it('niet twee keer op een dag, ook niet na een beperkte', async () => {
    const u = await voerDagtaakUit(db, opties());
    expect(u.overgeslagen).toMatch(/Vandaag al gedaan/);
    expect(await tel(pg, 'rp_activiteit')).toBe(1);
  });

  it('volledig geslaagd: alle bronnen opgehaald en actueel', async () => {
    const pg6 = await maakOmgeving();
    const u = await voerDagtaakUit(pgDb(pg6, null), opties({ haal: echt() }));
    expect(u.status).toBe('geslaagd');
    expect(u.gebreken).toBeUndefined();
    expect((await pg6.query<{ tekst: string }>('select tekst from rp_activiteit')).rows[0].tekst).toMatch(/alle bronnen actueel/);
  }, 60_000);

  it('beperkt: een bron die niet is opgehaald, of gegevens die niet ver genoeg lopen, staan erbij', async () => {
    const pg7 = await maakOmgeving();
    const db7 = pgDb(pg7, null);
    // eerst volledig (gisteren), dan vandaag: CBS niet bereikbaar, en de weersverwachting loopt maar tot morgen
    await voerDagtaakUit(db7, opties({ vandaag: addDays(vandaag, -1), haal: echt([], -1) }));
    const haalVandaag = async (bron: string): Promise<BronAntwoord> => {
      if (bron === 'weer') return { bron, reeksen: [{ sleutel: 'NL', variabele: 'proef', start: addDays(vandaag, -40), v: Array(30).fill(1) }], rijen: 30 };
      return echt(['cbs'])(bron);
    };
    const u = await voerDagtaakUit(db7, opties({ haal: haalVandaag }));
    expect(u.status).toBe('beperkt');
    // de weersverwachting van gisteren liep tot vandaag + 14: nog actueel; CBS heeft oudere gegevens
    expect(u.gebreken).toEqual([{ bron: 'cbs', label: 'CBS-sterfte', reden: 'niet opgehaald', tot: addDays(vandaag, -18) }]);
    expect(await leesDagtaak(db7)).toMatchObject({ status: 'beperkt', gebreken: [{ bron: 'cbs' }] });
  }, 60_000);

  it('met meldingen: een nieuwe voorspelling, met de gegevens erbij', async () => {
    const pg2 = await maakOmgeving();
    const db2 = pgDb(pg2, null);
    // de meldingenhistorie zoals de app die wegschrijft
    const meldingen = makeDemoHistory(addDays(vandaag, -1));
    const ops = verschil({ meldingen: null } as unknown as AppState, { meldingen } as unknown as AppState, 'beheerder', TABELLEN.filter((t) => t.naam === 'rp_meldingen'));
    await voerUit(db2, ops, { rol: 'beheerder' });
    const u = await voerDagtaakUit(db2, opties());
    expect(u.status).toBe('geslaagd');
    expect(u.run).toMatch(new RegExp(`^${vandaag}_`));
    const run = (await pg2.query<{ id: string; soort: string; heeft: boolean }>('select id, soort, data is not null as heeft from rp_run')).rows;
    expect(run).toEqual([{ id: u.run, soort: 'dagelijks', heeft: true }]);
  }, 180_000);

  it('mislukt het, dan staat dat er met de reden; de datum van de voorspelling blijft staan', async () => {
    const pg3 = await maakOmgeving();
    const db3 = pgDb(pg3, null);
    const kapot: Db = { ...db3, rpc: async (f, a, o) => { if (f === 'rp_meldingen_per_regio') throw new Error('Verbinding verbroken'); return db3.rpc(f, a, o); } };
    const u = await voerDagtaakUit(kapot, opties());
    expect(u).toMatchObject({ status: 'mislukt' });
    expect(u.melding).toMatch(/meldingen/);
    expect(await leesDagtaak(db3)).toMatchObject({ status: 'mislukt' });
    expect(await instelling(pg3, 'laatsteAuto')).toBeUndefined();
    // een volgende poging mag gewoon
    expect((await voerDagtaakUit(db3, opties())).status).toBe('geslaagd');
  }, 60_000);

  it('twee tegelijk: de tweede krijgt de taak niet en doet niets', async () => {
    const pg4 = await maakOmgeving();
    const db4 = pgDb(pg4, null);
    // de eerste wacht bij het ophalen van de eerste bron, terwijl de tweede start
    let los!: () => void;
    const wacht = new Promise<void>((k) => { los = k; });
    let gehaald = 0;
    const eerste = voerDagtaakUit(db4, opties({ haal: async (b) => { gehaald++; await wacht; return haal(b); } }));
    await vi.waitFor(() => expect(gehaald).toBe(1));
    const tweede = await voerDagtaakUit(db4, opties({ haal: async () => { throw new Error('mag niet worden aangeroepen'); } }));
    expect(tweede.overgeslagen).toBeTruthy();
    expect(tweede.status).toBe('gestart');
    los();
    expect((await eerste).status).toBe('geslaagd');
    expect(await tel(pg4, 'rp_activiteit')).toBe(1);
  }, 60_000);

  it('neemt een tweede het over (de eerste duurt te lang), dan schrijft de eerste niets meer', async () => {
    const pg5 = await maakOmgeving();
    const db5 = pgDb(pg5, null);
    let los!: () => void;
    const wacht = new Promise<void>((k) => { los = k; });
    let gehaald = 0;
    const traag = voerDagtaakUit(db5, opties({ haal: async (b) => { gehaald++; await wacht; return haal(b); } }));
    await vi.waitFor(() => expect(gehaald).toBe(1));
    // looptijd 0: de eerste geldt als vastgelopen, de tweede neemt het over en maakt het af
    expect((await voerDagtaakUit(db5, opties({ looptijd: 0 }))).status).toBe('geslaagd');
    los();
    expect((await traag).overgeslagen).toMatch(/overgenomen/);
    expect(await tel(pg5, 'rp_activiteit')).toBe(1);
    expect(await leesDagtaak(db5)).toMatchObject({ status: 'geslaagd' });
  }, 60_000);

  it('was een bron niet bereikbaar, dan straks nog een poging; die vervangt de dagelijkse run van eerder die dag', async () => {
    const pg8 = await maakOmgeving();
    const db8 = pgDb(pg8, null);
    const meldingen = makeDemoHistory(addDays(vandaag, -1));
    await voerUit(db8, verschil({ meldingen: null } as unknown as AppState, { meldingen } as unknown as AppState, 'beheerder', TABELLEN.filter((t) => t.naam === 'rp_meldingen')), { rol: 'beheerder' });
    // gisteren, zodat de klok van de test altijd achter de echte klok ligt (de database vergelijkt met now())
    const dag = addDays(vandaag, -1);
    const om = (t: string): DagtaakOpties => ({ vandaag: dag, nu: () => `${dag}T${t}`, haal: echt([], -1) });
    const eerste = await voerDagtaakUit(db8, { ...om('06:00:00'), haal: echt(['weer'], -1) });
    expect(eerste).toMatchObject({ status: 'beperkt', bronnen: { fout: 1 } });
    expect(eerste.opnieuwNa).toBeTruthy();
    // na een half uur nog niet; na een uur wel
    expect((await voerDagtaakUit(db8, om('06:30:00'))).overgeslagen).toMatch(/straks nog een poging/);
    const tweede = await voerDagtaakUit(db8, om('07:00:00'));
    expect(tweede.status).toBe('geslaagd');
    expect(tweede.opnieuwNa).toBeUndefined();
    const runs = (await pg8.query<{ id: string }>(`select id from rp_run where soort = 'dagelijks' and uitgegeven = '${dag}'`)).rows.map((r) => r.id);
    expect(runs).toEqual([tweede.run]);
    expect((await voerDagtaakUit(db8, om('08:00:00'))).overgeslagen).toMatch(/al geslaagd/);
  }, 180_000);

  it('alleen verouderde gegevens (wel opgehaald): vandaag geen nieuwe poging', async () => {
    const pg9 = await maakOmgeving();
    const db9 = pgDb(pg9, null);
    const kort = async (bron: string): Promise<BronAntwoord> => (bron === 'seizoen'
      ? { bron, reeksen: [{ sleutel: 'NL', variabele: 'proef', start: addDays(vandaag, -40), v: Array(5).fill(1) }], rijen: 5 }
      : echt()(bron));
    const u = await voerDagtaakUit(db9, opties({ haal: kort }));
    expect(u.status).toBe('beperkt');
    expect(u.opnieuwNa).toBeUndefined();
    expect(dagtaakOverslaan(u, vandaag, `${vandaag}T23:00:00`)).toMatch(/Vandaag al gedaan/);
  }, 60_000);

  it('een taak die net is gestart, loopt nog; na twintig minuten mag het opnieuw', () => {
    const gestart = { datum: vandaag, status: 'gestart' as const, gestart: `${vandaag}T06:00:00`, waar: 'server' as const };
    expect(dagtaakOverslaan(gestart, vandaag, `${vandaag}T06:10:00`)).toBe('Loopt al');
    expect(dagtaakOverslaan(gestart, vandaag, `${vandaag}T06:25:00`)).toBeNull();
    expect(dagtaakOverslaan({ ...gestart, status: 'geslaagd' }, vandaag, `${vandaag}T09:00:00`)).toBe('Vandaag al geslaagd');
    expect(dagtaakOverslaan({ ...gestart, status: 'geslaagd', datum: addDays(vandaag, -1) }, vandaag, `${vandaag}T06:00:00`)).toBeNull();
    expect(dagtaakOverslaan({ ...gestart, status: 'mislukt' }, vandaag, `${vandaag}T06:01:00`)).toBeNull();
  });
});
