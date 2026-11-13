// @vitest-environment node
/**
 * De server-routes /api/db, /api/bronnen, /api/live en /api/gebruikers: wie erbij mag, van welke site, wat er wordt
 * gecontroleerd en wat er bij een fout terugkomt. De database, de bronnen, de sessie en Microsoft zijn nagebootst; het
 * sessiecookie is echt versleuteld.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Sessie } from '@/lib/sessie';

const sessie = vi.hoisted(() => ({ uitslag: { soort: 'niet_ingelogd' } as unknown }));
const jar = vi.hoisted(() => ({ waarden: {} as Record<string, string> }));
const db = vi.hoisted(() => ({ sql: [] as { oid: string; sql: string; params: unknown[] }[], fout: null as unknown, rijen: [] as unknown[] }));
const live = vi.hoisted(() => ({ wijziging: null as null | ((t: string) => void), gestopt: 0 }));
const bron = vi.hoisted(() => ({ fout: null as Error | null }));
const opslag = vi.hoisted(() => ({ bestaat: false, gemaakt: [] as unknown[], gewijzigd: [] as unknown[], email: 'ander@voorbeeld.nl' as string | null }));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (jar.waarden[n] ? { value: jar.waarden[n] } : undefined) }) }));
vi.mock('@/lib/sessie', () => ({ bepaalSessie: async () => sessie.uitslag }));
vi.mock('@/lib/server/postgres', () => ({
  database: async () => ({}),
  alsGebruiker: async (_p: unknown, oid: string, fn: (voer: (sql: string, params: unknown[]) => Promise<unknown[]>) => Promise<unknown>) => {
    if (db.fout) throw db.fout;
    return fn(async (sql, params) => { db.sql.push({ oid, sql, params }); return db.rijen; });
  },
}));
vi.mock('@/lib/server/live', () => ({
  luister: async (l: { wijziging: (t: string) => void }) => { live.wijziging = l.wijziging; return () => { live.gestopt++; }; },
}));
vi.mock('@/lib/bronnen/haal', () => ({
  haalBron: async (b: string) => { if (bron.fout) throw bron.fout; return { bron: b, reeksen: [], rijen: 0 }; },
}));
vi.mock('@/lib/bronnen/schoolvakanties', () => ({ schoolvakanties: async () => [] }));
vi.mock('@/lib/auth/uitnodigen', () => ({ nodigUit: async (email: string) => ({ verstuurd: true, email }) }));
vi.mock('@/lib/server/gebruikers', () => {
  class GebruikerFout extends Error { constructor(readonly status: number, tekst: string) { super(tekst); } }
  return {
    GebruikerFout,
    gebruikersopslag: () => ({
      lijst: async () => [{ id: 'u1', naam: 'Rob', email: 'rob@voorbeeld.nl', rol: 'regiomanager', profielRol: 'Regio Manager', regios: ['Utrecht'], gekoppeld: true }],
      bestaat: async () => opslag.bestaat,
      maak: async (g: unknown) => { opslag.gemaakt.push(g); return { id: 'u2', ...(g as object) }; },
      wijzig: async (id: string, rol: string, regios: string[]) => { opslag.gewijzigd.push({ id, rol, regios }); return { id, rol, regios }; },
      emailVan: async () => opslag.email,
      weg: async () => undefined,
    }),
  };
});

import { POST as dbPost } from '@/app/api/db/route';
import { POST as bronnenPost } from '@/app/api/bronnen/route';
import { GET as liveGet } from '@/app/api/live/route';
import { GET as gebruikersGet, POST as gebruikersPost } from '@/app/api/gebruikers/route';
import { PATCH as gebruikerPatch } from '@/app/api/gebruikers/[id]/route';
import { verzegel } from '@/lib/auth/zegel';
import { SESSIE_COOKIE } from '@/lib/auth/entra';
import { wisLimieten } from '@/lib/api/toegang';

const GEHEIM = 'een-geheim-van-minstens-tweeendertig-tekens';
const OID = '00000000-0000-0000-0000-0000000000aa';
const ik = (rol: Sessie['rol'], regios: string[] | null = null, email = 'ik@voorbeeld.nl') =>
  ({ soort: 'ok', sessie: { modus: 'azure', naam: 'Ik', email, rol, regios } });

function vraag(pad: string, o: { methode?: string; body?: unknown; herkomst?: string | null } = {}): Request {
  const headers: Record<string, string> = { 'x-forwarded-host': 'grip.voorbeeld.nl', 'content-type': 'application/json' };
  if (o.herkomst !== null) headers.origin = o.herkomst ?? 'https://grip.voorbeeld.nl';
  return new Request(`https://grip.voorbeeld.nl${pad}`, {
    method: o.methode ?? 'POST', headers, ...(o.body !== undefined ? { body: typeof o.body === 'string' ? o.body : JSON.stringify(o.body) } : {}),
  });
}
async function inloggen() {
  jar.waarden[SESSIE_COOKIE] = await verzegel({ oid: OID, tid: 't', email: 'ik@voorbeeld.nl', naam: 'Ik' }, Date.now() + 3_600_000, GEHEIM);
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', 'azure');
  vi.stubEnv('SESSIE_GEHEIM', GEHEIM);
  vi.stubEnv('GRIP_URL', '');
  jar.waarden = {};
  sessie.uitslag = { soort: 'niet_ingelogd' };
  db.sql = []; db.fout = null; db.rijen = [];
  bron.fout = null;
  opslag.bestaat = false; opslag.gemaakt = []; opslag.gewijzigd = []; opslag.email = 'ander@voorbeeld.nl';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); wisLimieten(); vi.restoreAllMocks(); });

describe('/api/db', () => {
  it('alleen in Azure, alleen van deze site en alleen met een geldige sessie', async () => {
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', '');
    expect((await dbPost(vraag('/api/db', { body: { op: 'schemaVersie' } }))).status).toBe(404);
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', 'azure');
    await inloggen();
    expect((await dbPost(vraag('/api/db', { body: { op: 'schemaVersie' }, herkomst: 'https://kwaad.example.com' }))).status).toBe(403);
    jar.waarden[SESSIE_COOKIE] = 'nep.cookie';
    expect((await dbPost(vraag('/api/db', { body: { op: 'schemaVersie' } }))).status).toBe(401);
    // een verlopen cookie geldt niet
    jar.waarden[SESSIE_COOKIE] = await verzegel({ oid: OID, tid: 't', email: 'x', naam: 'x' }, Date.now() - 1000, GEHEIM);
    expect((await dbPost(vraag('/api/db', { body: { op: 'schemaVersie' } }))).status).toBe(401);
    expect(db.sql).toEqual([]);
  });

  it('rekent met het werkaccount uit de sessie, met waarden als parameter', async () => {
    await inloggen();
    db.rijen = [{ j: [{ id: 1 }] }];
    const r = await dbPost(vraag('/api/db', { body: { op: 'lees', tabel: 'rp_medewerker', opties: { filters: [{ kolom: 'regio', op: 'eq', waarde: "Utrecht'; drop table users;--" }] } } }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ uit: [{ id: 1 }] });
    expect(db.sql[0].oid).toBe(OID);
    expect(db.sql[0].sql).not.toContain('drop table');
    expect(db.sql[0].params).toEqual(["Utrecht'; drop table users;--"]);
  });

  it('een onbekende tabel, kolom of bewerking, of geen JSON: 400, zonder de database te raken', async () => {
    await inloggen();
    for (const body of [{ op: 'lees', tabel: 'users' }, { op: 'lees', tabel: 'rp_medewerker', opties: { kolommen: 'naam; drop' } }, { op: 'rpc', functie: 'pg_sleep' }, { op: 'wis' }, 'geen json']) {
      expect((await dbPost(vraag('/api/db', { body }))).status).toBe(400);
    }
    expect(db.sql).toEqual([]);
  });

  it('een melding van Postgres gaat mee (409); een andere fout wordt een algemene melding (503)', async () => {
    await inloggen();
    db.fout = Object.assign(new Error('GRIP_VIER_OGEN Wie het advies gaf, keurt deze maand niet zelf goed of af'), { code: 'P0001' });
    const r = await dbPost(vraag('/api/db', { body: { op: 'schemaVersie' } }));
    expect(r.status).toBe(409);
    expect((await r.json()).fout).toMatch(/GRIP_VIER_OGEN/);
    db.fout = new Error('connect ECONNREFUSED 10.0.0.5:5432');
    const r2 = await dbPost(vraag('/api/db', { body: { op: 'schemaVersie' } }));
    expect(r2.status).toBe(503);
    expect((await r2.json()).fout).not.toMatch(/10\.0\.0\.5/);
  });
});

describe('/api/bronnen', () => {
  it('alleen voor wie plant, en van deze site', async () => {
    expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'weer' } }))).status).toBe(401);
    sessie.uitslag = { soort: 'geen_profiel', email: 'x@voorbeeld.nl', reden: 'geen_regios' };
    expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'weer' } }))).status).toBe(403);
    sessie.uitslag = ik('medewerker', ['Utrecht']);
    expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'weer' } }))).status).toBe(403);
    sessie.uitslag = ik('planner');
    expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'weer' }, herkomst: 'https://kwaad.example.com' }))).status).toBe(403);
    expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'weer' } }))).status).toBe(200);
  });

  it('controleert de bron en de periode', async () => {
    sessie.uitslag = ik('beheerder');
    expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'iets' } }))).status).toBe(400);
    expect((await bronnenPost(vraag('/api/bronnen', { body: 'geen json' }))).status).toBe(400);
    expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'weer_archief', van: '2026-02-01', tot: '2026-01-01' } }))).status).toBe(400);
    expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'weer_archief', van: '2026-01-01', tot: '2026-02-01' } }))).status).toBe(200);
  });

  it('valt een bron uit, dan een nette melding zonder details van de aanbieder', async () => {
    sessie.uitslag = ik('beheerder');
    bron.fout = new Error('503 Service Unavailable bij customer-api.open-meteo.com?apikey=geheim');
    const r = await bronnenPost(vraag('/api/bronnen', { body: { bron: 'weer' } }));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ fout: 'Niet bereikbaar' });
  });

  it('hoogstens 120 aanvragen per uur per gebruiker', async () => {
    sessie.uitslag = ik('planner');
    for (let i = 0; i < 120; i++) expect((await bronnenPost(vraag('/api/bronnen', { body: { bron: 'cbs' } }))).status).toBe(200);
    const r = await bronnenPost(vraag('/api/bronnen', { body: { bron: 'cbs' } }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('/api/live', () => {
  it('alleen in Azure en alleen voor wie in GRIP staat (ook een regiomanager zonder regio\'s niet)', async () => {
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', '');
    expect((await liveGet(vraag('/api/live', { methode: 'GET' }))).status).toBe(404);
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', 'azure');
    expect((await liveGet(vraag('/api/live', { methode: 'GET' }))).status).toBe(401);
    sessie.uitslag = { soort: 'geen_profiel', email: 'x@voorbeeld.nl' };
    expect((await liveGet(vraag('/api/live', { methode: 'GET' }))).status).toBe(403);
    sessie.uitslag = { soort: 'geen_profiel', email: 'rm@voorbeeld.nl', reden: 'geen_regios' };
    expect((await liveGet(vraag('/api/live', { methode: 'GET' }))).status).toBe(403);
  });

  it('stuurt per wijziging alleen de naam van de tabel, en stopt als de verbinding dichtgaat', async () => {
    sessie.uitslag = ik('medewerker', ['Utrecht']);
    const ctl = new AbortController();
    const r = await liveGet(new Request('https://grip.voorbeeld.nl/api/live', { signal: ctl.signal }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/event-stream');
    const lezer = r.body!.getReader();
    const dec = new TextDecoder();
    expect(dec.decode((await lezer.read()).value)).toBe('retry: 5000\n\n');
    live.wijziging!('rp_rooster');
    expect(dec.decode((await lezer.read()).value)).toBe('data: rp_rooster\n\n');
    ctl.abort();
    expect((await lezer.read()).done).toBe(true);
    expect(live.gestopt).toBe(1);
  });
});

describe('/api/gebruikers', () => {
  it('alleen de beheerder, alleen in Azure en van deze site', async () => {
    expect((await gebruikersGet()).status).toBe(401);
    sessie.uitslag = ik('planner');
    expect((await gebruikersGet()).status).toBe(403);
    sessie.uitslag = ik('regiomanager', ['Utrecht']);
    expect((await gebruikersGet()).status).toBe(403);
    sessie.uitslag = ik('beheerder');
    expect((await gebruikersGet()).status).toBe(200);
    expect((await gebruikersPost(vraag('/api/gebruikers', { body: { email: 'n@voorbeeld.nl', naam: 'Nina', rol: 'planner', regios: [] }, herkomst: 'https://kwaad.example.com' }))).status).toBe(403);
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', '');
    expect((await gebruikersGet()).status).toBe(404);
    expect(opslag.gemaakt).toEqual([]);
  });

  it('toevoegen: de invoer wordt gecontroleerd, een bestaand adres geweigerd, en Microsoft nodigt uit', async () => {
    sessie.uitslag = ik('beheerder');
    const r = await gebruikersPost(vraag('/api/gebruikers', { body: { email: 'rosa@voorbeeld.nl', naam: 'Rosa', rol: 'regiomanager', regios: [] } }));
    expect(r.status).toBe(400);
    expect((await r.json()).fout).toMatch(/regiomanager/);
    opslag.bestaat = true;
    expect((await gebruikersPost(vraag('/api/gebruikers', { body: { email: 'rosa@voorbeeld.nl', naam: 'Rosa', rol: 'regiomanager', regios: ['Utrecht'] } }))).status).toBe(409);
    opslag.bestaat = false;
    const ok = await gebruikersPost(vraag('/api/gebruikers', { body: { email: ' Rosa@Voorbeeld.nl ', naam: 'Rosa', rol: 'regiomanager', regios: ['Utrecht'] } }));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ uitnodiging: { verstuurd: true, email: 'rosa@voorbeeld.nl' } });
    expect(opslag.gemaakt).toEqual([{ email: 'rosa@voorbeeld.nl', naam: 'Rosa', rol: 'regiomanager', regios: ['Utrecht'] }]);
  });

  it('wijzigen: niet de eigen rol, niet zonder regio\'s voor een regiomanager', async () => {
    sessie.uitslag = ik('beheerder', null, 'ik@voorbeeld.nl');
    const ctx = { params: Promise.resolve({ id: 'u1' }) };
    opslag.email = 'IK@voorbeeld.nl';
    expect((await gebruikerPatch(vraag('/api/gebruikers/u1', { methode: 'PATCH', body: { rol: 'medewerker', regios: ['Utrecht'] } }), ctx)).status).toBe(400);
    opslag.email = 'rob@voorbeeld.nl';
    expect((await gebruikerPatch(vraag('/api/gebruikers/u1', { methode: 'PATCH', body: { rol: 'regiomanager', regios: [] } }), ctx)).status).toBe(400);
    opslag.email = null;
    expect((await gebruikerPatch(vraag('/api/gebruikers/u1', { methode: 'PATCH', body: { rol: 'regiomanager', regios: ['Utrecht'] } }), ctx)).status).toBe(404);
    opslag.email = 'rob@voorbeeld.nl';
    expect((await gebruikerPatch(vraag('/api/gebruikers/u1', { methode: 'PATCH', body: { rol: 'regiomanager', regios: ['Utrecht', 'Arnhem'] } }), ctx)).status).toBe(200);
    expect(opslag.gewijzigd).toEqual([{ id: 'u1', rol: 'regiomanager', regios: ['Utrecht', 'Arnhem'] }]);
  });
});
