// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { SCHATTING, afstandKm, laadPostcodes, pc4, puntVan, schatReistijd } from '@/lib/verdeling/geo';
import { Reistijden, amsterdamIso, bandVan, benodigdeParen, haalLive, sleutel } from '@/lib/verdeling/reistijd';
import { aanbiederUitOmgeving, google, haalParen, inNederland, osrm, tomtom, toekomstig, type Aanbieder } from '@/lib/verdeling/aanbieders';
import { slotsVoor } from '@/lib/verdeling/invoer';
import { STANDAARD_PARAMETERS, type Invoer, type Persoon, type Punt } from '@/lib/verdeling/types';
import { POST, GET } from '@/app/api/reistijd/route';
import { wisLimieten } from '@/lib/api/toegang';
import type { DienstCode } from '@/lib/rooster/types';

const P = (lat: number, lng: number, postcode = `${lat},${lng}`): Punt => ({ postcode, lat, lng });

describe('postcodes en de schatting', () => {
  it('kent de postcodegebieden van Nederland', async () => {
    const t = await laadPostcodes();
    expect(t.size).toBeGreaterThan(4000);
    expect(pc4('3511 AB')).toBe('3511');
    expect(pc4('1234ab')).toBe('1234');
    expect(pc4('0123')).toBeNull();
    const utrecht = puntVan(t, '3511 AB')!;
    expect(utrecht.plaats).toMatch(/Utrecht/);
    expect(utrecht.lat).toBeCloseTo(52.09, 1);
    // een nummer dat niet bestaat valt terug op het dichtstbijzijnde nummer
    const nn = [...t.keys()].map(Number).sort((a, b) => a - b);
    const gat = nn.find((n, i) => i > 0 && n - nn[i - 1] > 1)! - 1;
    expect(puntVan(t, String(gat))).not.toBeNull();
  });

  it('schat Amsterdam - Utrecht op 35 tot 55 minuten, langer in de spits', async () => {
    const t = await laadPostcodes();
    const ams = puntVan(t, '1012')!, utr = puntVan(t, '3511')!;
    expect(afstandKm(ams, utr)).toBeGreaterThan(30);
    const dal = schatReistijd(ams, utr, 11 * 60), spits = schatReistijd(ams, utr, 8 * 60);
    expect(dal).toBeGreaterThan(35);
    expect(dal).toBeLessThan(55);
    expect(spits).toBeGreaterThan(dal);
    // in hetzelfde gebied: alleen de vaste tijd
    expect(schatReistijd(ams, ams, 11 * 60)).toBeCloseTo(SCHATTING.vast, 6);
  });
});

describe('reistijden: live met terugval', () => {
  it('gebruikt een live reistijd in hetzelfde tijdvak, anders de gekalibreerde schatting', () => {
    const a = P(52, 5), b = P(52.3, 5);
    const r = new Reistijden();
    expect(r.reistijd(a, b, 9 * 60)).toBeCloseTo(schatReistijd(a, b, 9 * 60), 6);
    r.zet({ van: a, naar: b, band: bandVan(9 * 60) }, 50);
    expect(r.reistijd(a, b, 9.5 * 60)).toBe(50);
    // ander tijdvak: nog de schatting
    expect(r.reistijd(a, b, 13 * 60)).toBeCloseTo(schatReistijd(a, b, 13 * 60), 6);
    expect(r.gebruikt).toEqual({ live: 1, schatting: 2 });
  });

  it('kalibreert de schatting op de mediaan van live / schatting, begrensd', () => {
    const r = new Reistijden();
    const paren = Array.from({ length: 12 }, (_, i) => ({ van: P(52, 4.5 + i * 0.1), naar: P(52.4, 5 + i * 0.05), band: 0 }));
    paren.forEach((p) => r.zet(p, schatReistijd(p.van, p.naar, 540) * 1.2));
    expect(r.kalibreer(paren)).toBeCloseTo(1.2, 6);
    const ander = { van: P(51, 4), naar: P(51.5, 5), band: 1 };
    expect(r.reistijd(ander.van, ander.naar, 12 * 60)).toBeCloseTo(schatReistijd(ander.van, ander.naar, 12 * 60) * 1.2, 6);
    paren.forEach((p) => r.zet(p, 1));
    expect(r.kalibreer(paren)).toBe(0.7);
  });

  it('vraagt alleen de reizen op die de verdeling kan maken', () => {
    const persoon = (id: string, code: DienstCode, thuis: Punt): Persoon => {
      const s = slotsVoor(id, code)!;
      return { id, naam: id, regio: 'R', cluster: 'C', contract: 36, thuis, dienstStart: s.dienst[0], dienstEind: s.dienst[1], slots: s.slots, afspraken: [], belasting: 0, reeks: 0 };
    };
    const invoer: Invoer = {
      personen: [persoon('dicht', '2', P(52, 5)), persoon('ook', '1M', P(52.05, 5)), persoon('ver', '1', P(53.5, 7))],
      meldingen: [
        { id: 'm1', plek: P(52.02, 5.02), regio: 'R', cluster: 'C', ontvangen: '' },
        { id: 'm2', plek: P(52.03, 4.98), regio: 'R', cluster: 'C', ontvangen: '' },
      ],
      verwacht: {}, parameters: STANDAARD_PARAMETERS,
    };
    const paren = benodigdeParen(invoer, 2);
    const heeft = (a: Punt, b: Punt, band: number) => paren.some((p) => sleutel(p.van, p.naar, p.band) === sleutel(a, b, band));
    const [dicht, ook, ver] = invoer.personen;
    const [m1, m2] = invoer.meldingen;
    expect(heeft(dicht.thuis, m1.plek, 0)).toBe(true);
    expect(heeft(ook.thuis, m1.plek, 1)).toBe(true);
    expect(heeft(m1.plek, m2.plek, 1)).toBe(true); // de 2: van het ochtend- naar het middaggesprek
    expect(heeft(m1.plek, dicht.thuis, 1)).toBe(true); // terug naar huis
    expect(paren.some((p) => p.van === ver.thuis)).toBe(false); // te ver: niet opvragen
  });

  it('zet Nederlandse tijd om met zomer- en wintertijd', () => {
    expect(amsterdamIso('2026-10-13', 540)).toBe('2026-10-13T09:00:00+02:00');
    expect(amsterdamIso('2026-12-01', 750)).toBe('2026-12-01T12:30:00+01:00');
    expect(amsterdamIso('2026-03-29', 60)).toBe('2026-03-29T01:00:00+01:00');
    expect(amsterdamIso('2026-03-29', 180)).toBe('2026-03-29T03:00:00+02:00');
    expect(amsterdamIso('2026-10-25', 60)).toBe('2026-10-25T01:00:00+02:00');
    expect(amsterdamIso('2026-10-25', 240)).toBe('2026-10-25T04:00:00+01:00');
    for (const [d, m] of [['2026-07-01', 540], ['2027-01-15', 990]] as [string, number][]) {
      const t = new Date(amsterdamIso(d, m));
      const lokaal = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
      expect(lokaal).toBe(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
  });

  it('haalt live reistijden op via de eigen server, in porties', async () => {
    const r = new Reistijden();
    const paren = Array.from({ length: 5 }, (_, i) => ({ van: P(52, 5 + i / 10), naar: P(52.2, 5), band: 0 }));
    const verzoeken: unknown[] = [];
    const f = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      verzoeken.push(body);
      return new Response(JSON.stringify({ aanbieder: 'osrm', minuten: body.paren.map((_: unknown, i: number) => (i === 0 ? null : 30)) }));
    }) as unknown as typeof fetch;
    const uit = await haalLive('2026-10-13', paren, r, { portie: 2, fetch: f });
    expect(verzoeken).toHaveLength(3);
    expect((verzoeken[0] as { paren: { vertrek: string }[] }).paren[0].vertrek).toBe('2026-10-13T09:00:00+02:00');
    // per portie is de eerste zonder route: 5 paren in porties van 2 geeft er 2 met een reistijd
    expect(uit).toEqual({ opgehaald: 2, aanbieder: 'osrm' });
    expect(r.aantalLive).toBe(2);
    const fout = await haalLive('2026-10-13', paren, new Reistijden(), { fetch: (async () => new Response(JSON.stringify({ fout: 'kapot' }), { status: 502 })) as unknown as typeof fetch });
    expect(fout.fout).toBe('kapot');
  });
});

describe('aanbieders', () => {
  const vertrek = new Date('2030-01-07T08:00:00Z');

  it('Google Routes: vraagt een kolom op met verkeer, en leest ook index 0 (die Google weglaat)', async () => {
    let req: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      req = { url, init };
      return new Response(JSON.stringify([
        { destinationIndex: 0, duration: '600s', condition: 'ROUTE_EXISTS' },
        { originIndex: 1, duration: '1230.5s', condition: 'ROUTE_EXISTS' },
        { originIndex: 2, condition: 'ROUTE_NOT_FOUND' },
      ]));
    }) as unknown as typeof fetch;
    const uit = await google('SLEUTEL').kolom([[52, 5], [52.1, 5], [52.2, 5]], [52.3, 5], vertrek, f);
    expect(uit).toEqual([10, 1230.5 / 60, null]);
    const r = req!;
    expect(r.url).toBe('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
    const h = r.init.headers as Record<string, string>;
    expect(h['x-goog-api-key']).toBe('SLEUTEL');
    expect(h['x-goog-fieldmask']).toContain('duration');
    const body = JSON.parse(String(r.init.body));
    expect(body.routingPreference).toBe('TRAFFIC_AWARE');
    expect(body.departureTime).toBe('2030-01-07T08:00:00.000Z');
    expect(body.origins[1].waypoint.location.latLng).toEqual({ latitude: 52.1, longitude: 5 });
  });

  it('TomTom: historisch verkeer vooruit, minuten uit de reistijd in seconden', async () => {
    let body: { options: { traffic: string; departAt: string } } | null = null;
    const f = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: [{ originIndex: 1, destinationIndex: 0, routeSummary: { travelTimeInSeconds: 900 } }] }));
    }) as unknown as typeof fetch;
    expect(await tomtom('k').kolom([[52, 5], [52.1, 5]], [52.3, 5], vertrek, f)).toEqual([null, 15]);
    expect(body!.options.traffic).toBe('historical');
  });

  it('OSRM: een tabel met één bestemming, met de spitsfactor erbovenop', async () => {
    let url = '';
    const f = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ code: 'Ok', durations: [[600], [null]] }));
    }) as unknown as typeof fetch;
    expect(await osrm('http://router:5000/', () => 1.15).kolom([[52, 5], [52.1, 5.1]], [52.3, 5.2], vertrek, f)).toEqual([11.5, null]);
    expect(url).toBe('http://router:5000/table/v1/driving/5.00000,52.00000;5.10000,52.10000;5.20000,52.30000?sources=0;1&destinations=2&annotations=duration');
  });

  it('groepeert per vertrekmoment en bestemming, in kolommen van hoogstens het maximum', async () => {
    const kolommen: number[] = [];
    const nep: Aanbieder = {
      naam: 'osrm', maxHerkomsten: 2,
      async kolom(h, b) {
        kolommen.push(h.length);
        if (b[0] === 53) throw new Error('stuk');
        return h.map((x) => x[0] * 100 + b[0]);
      },
    };
    const v = '2030-01-07T09:00:00+01:00';
    const paren = [
      { van: [1, 0], naar: [52, 0], vertrek: v }, { van: [2, 0], naar: [52, 0], vertrek: v }, { van: [3, 0], naar: [52, 0], vertrek: v },
      { van: [4, 0], naar: [53, 0], vertrek: v },
      { van: [5, 0], naar: [52, 0], vertrek: '2030-01-07T12:30:00+01:00' },
    ] as { van: [number, number]; naar: [number, number]; vertrek: string }[];
    const { minuten, fouten } = await haalParen(nep, paren, fetch, 1);
    expect(kolommen.sort()).toEqual([1, 1, 1, 2]);
    expect(minuten).toEqual([152, 252, 352, null, 552]);
    expect(fouten).toEqual(['stuk']);
  });

  it('alleen Nederland, en een vertrek in het verleden schuift een week op', () => {
    expect(inNederland([52.1, 5.1])).toBe(true);
    expect(inNederland([48.8, 2.3])).toBe(false);
    const nu = Date.parse('2026-10-07T12:00:00Z');
    const t = toekomstig(new Date('2026-10-06T07:00:00Z'), nu);
    expect(t.toISOString()).toBe('2026-10-13T07:00:00.000Z');
    expect(toekomstig(new Date('2026-10-08T07:00:00Z'), nu).toISOString()).toBe('2026-10-08T07:00:00.000Z');
  });

  it('kiest de aanbieder uit de omgeving', () => {
    expect(aanbiederUitOmgeving({}, () => 1)).toBeNull();
    expect(aanbiederUitOmgeving({ REISTIJD_AANBIEDER: 'google' }, () => 1)).toBeNull();
    expect(aanbiederUitOmgeving({ REISTIJD_AANBIEDER: 'Google', REISTIJD_SLEUTEL: 'x' }, () => 1)!.naam).toBe('google');
    expect(aanbiederUitOmgeving({ REISTIJD_AANBIEDER: 'tomtom', REISTIJD_SLEUTEL: 'x' }, () => 1)!.naam).toBe('tomtom');
    expect(aanbiederUitOmgeving({ REISTIJD_AANBIEDER: 'osrm', REISTIJD_URL: 'http://r' }, () => 1)!.naam).toBe('osrm');
  });
});

describe('de server-route /api/reistijd', () => {
  const bewaard = { ...process.env };
  const echteFetch = globalThis.fetch;
  afterEach(() => {
    process.env = { ...bewaard };
    globalThis.fetch = echteFetch;
    wisLimieten();
  });
  const post = (body: unknown) => new Request('http://localhost/api/reistijd', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const paar = { van: [52.1, 5.1], naar: [52.2, 5.2], vertrek: '2030-01-07T09:00:00+01:00' };

  it('zegt dat er geen aanbieder is als die niet is ingesteld', async () => {
    delete process.env.REISTIJD_AANBIEDER;
    expect(await (await GET(new Request('http://localhost/api/reistijd'))).json()).toEqual({ aanbieder: null });
    const res = await POST(post({ paren: [paar] }));
    expect(res.status).toBe(503);
  });

  it('weigert paren buiten Nederland en te grote aanvragen, en geeft minuten terug', async () => {
    process.env.REISTIJD_AANBIEDER = 'osrm';
    process.env.REISTIJD_URL = 'http://router';
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'Ok', durations: [[1200]] }))) as unknown as typeof fetch;
    expect((await POST(post({ paren: [{ ...paar, van: [40, 2] }] }))).status).toBe(400);
    expect((await POST(post({ paren: Array.from({ length: 1501 }, () => paar) }))).status).toBe(400);
    const res = await POST(post({ paren: [paar] }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.aanbieder).toBe('osrm');
    // 9:00 is spits: 20 minuten x 1,15
    expect(j.minuten[0]).toBeCloseTo(23, 6);
  });
});
