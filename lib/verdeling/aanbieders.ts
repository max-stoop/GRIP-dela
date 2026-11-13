/**
 * Live reistijden bij een aanbieder, alleen op de server. Er gaan alleen coördinaten van postcodegebieden heen.
 *
 *   REISTIJD_AANBIEDER = google | tomtom | osrm
 *   REISTIJD_SLEUTEL   = de API-sleutel (google, tomtom)
 *   REISTIJD_URL       = adres van een eigen OSRM-server (osrm)
 */

export type AanbiederNaam = 'google' | 'tomtom' | 'osrm';

export interface LivePaar {
  van: [number, number];
  naar: [number, number];
  /** ISO met tijdzone. */
  vertrek: string;
}

export interface Aanbieder {
  naam: AanbiederNaam;
  maxHerkomsten: number;
  /** Minuten per herkomst; null als er geen route is. */
  kolom(herkomsten: [number, number][], bestemming: [number, number], vertrek: Date, f: typeof fetch): Promise<(number | null)[]>;
}

const TIMEOUT = 15_000;

async function json(res: Response, wie: string): Promise<unknown> {
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${wie} gaf ${res.status}${t ? `: ${t.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

/** Google Routes API, computeRouteMatrix, met verwacht verkeer op het vertrekmoment. */
export function google(sleutel: string): Aanbieder {
  return {
    naam: 'google',
    maxHerkomsten: 25,
    async kolom(herkomsten, bestemming, vertrek, f) {
      const wp = ([lat, lng]: [number, number]) => ({ waypoint: { location: { latLng: { latitude: lat, longitude: lng } } } });
      const res = await f('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': sleutel,
          'x-goog-fieldmask': 'originIndex,destinationIndex,duration,condition,status',
        },
        body: JSON.stringify({
          origins: herkomsten.map(wp),
          destinations: [wp(bestemming)],
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          departureTime: vertrek.toISOString(),
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = (await json(res, 'Google Routes')) as { originIndex?: number; duration?: string; condition?: string; status?: { code?: number } }[];
      const uit: (number | null)[] = herkomsten.map(() => null);
      for (const e of Array.isArray(data) ? data : []) {
        // index 0 laat Google weg (standaardwaarde)
        const i = e.originIndex ?? 0;
        if ((e.status?.code ?? 0) !== 0 || (e.condition && e.condition !== 'ROUTE_EXISTS')) continue;
        const s = /^(\d+(?:\.\d+)?)s$/.exec(e.duration ?? '');
        if (s && i < uit.length) uit[i] = Number(s[1]) / 60;
      }
      return uit;
    },
  };
}

/** TomTom Matrix Routing v2 (synchroon, tot 100 cellen): historisch verkeer vooruit, live verkeer voor nu. */
export function tomtom(sleutel: string): Aanbieder {
  return {
    naam: 'tomtom',
    maxHerkomsten: 100,
    async kolom(herkomsten, bestemming, vertrek, f) {
      const pt = ([lat, lng]: [number, number]) => ({ point: { latitude: lat, longitude: lng } });
      const binnenkort = vertrek.getTime() - Date.now() < 3_600_000;
      const res = await f(`https://api.tomtom.com/routing/matrix/2?key=${encodeURIComponent(sleutel)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origins: herkomsten.map(pt),
          destinations: [pt(bestemming)],
          options: { departAt: vertrek.toISOString(), routeType: 'fastest', traffic: binnenkort ? 'live' : 'historical', travelMode: 'car' },
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = (await json(res, 'TomTom')) as { data?: { originIndex: number; routeSummary?: { travelTimeInSeconds?: number } }[] };
      const uit: (number | null)[] = herkomsten.map(() => null);
      for (const c of data.data ?? []) {
        const s = c.routeSummary?.travelTimeInSeconds;
        if (typeof s === 'number' && c.originIndex < uit.length) uit[c.originIndex] = s / 60;
      }
      return uit;
    },
  };
}

/** Een eigen OSRM-server: geen kosten en niets naar buiten, maar zonder verkeer; daarom de spitsfactor erbovenop. */
export function osrm(url: string, spits: (vertrek: Date) => number): Aanbieder {
  const basis = url.replace(/\/+$/, '');
  return {
    naam: 'osrm',
    maxHerkomsten: 100,
    async kolom(herkomsten, bestemming, vertrek, f) {
      const punten = [...herkomsten, bestemming].map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';');
      const bronnen = herkomsten.map((_, i) => i).join(';');
      const res = await f(`${basis}/table/v1/driving/${punten}?sources=${bronnen}&destinations=${herkomsten.length}&annotations=duration`, {
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = (await json(res, 'OSRM')) as { code?: string; durations?: (number | null)[][] };
      if (data.code !== 'Ok' || !data.durations) throw new Error(`OSRM: ${data.code ?? 'geen antwoord'}`);
      const factor = spits(vertrek);
      return herkomsten.map((_, i) => {
        const s = data.durations![i]?.[0];
        return typeof s === 'number' ? (s / 60) * factor : null;
      });
    },
  };
}

export function aanbiederUitOmgeving(env: Record<string, string | undefined>, spits: (vertrek: Date) => number): Aanbieder | null {
  const naam = (env.REISTIJD_AANBIEDER ?? '').trim().toLowerCase();
  if (naam === 'google' && env.REISTIJD_SLEUTEL) return google(env.REISTIJD_SLEUTEL);
  if (naam === 'tomtom' && env.REISTIJD_SLEUTEL) return tomtom(env.REISTIJD_SLEUTEL);
  if (naam === 'osrm' && env.REISTIJD_URL) return osrm(env.REISTIJD_URL, spits);
  return null;
}

/** Ruim, zodat de route geen doorgeefluik wordt voor willekeurige reistijden. */
export function inNederland([lat, lng]: [number, number]): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 50.6 && lat <= 53.7 && lng >= 3.2 && lng <= 7.3;
}

/** Een vertrekmoment in het verleden kan niet; neem dan dezelfde dag en tijd een of meer weken later (zelfde verkeerspatroon). */
export function toekomstig(vertrek: Date, nu = Date.now()): Date {
  let t = vertrek.getTime();
  while (t < nu + 60_000) t += 7 * 86_400_000;
  return new Date(t);
}

/** Per vertrekmoment en bestemming in kolommen, een paar tegelijk. Een mislukte kolom geeft null (de schatting vult aan). */
export async function haalParen(a: Aanbieder, paren: LivePaar[], f: typeof fetch = fetch, gelijktijdig = 4): Promise<{ minuten: (number | null)[]; fouten: string[] }> {
  const minuten: (number | null)[] = paren.map(() => null);
  const groepen = new Map<string, { vertrek: Date; naar: [number, number]; idx: number[] }>();
  paren.forEach((p, i) => {
    const k = `${p.vertrek}|${p.naar[0]},${p.naar[1]}`;
    let g = groepen.get(k);
    if (!g) { g = { vertrek: toekomstig(new Date(p.vertrek)), naar: p.naar, idx: [] }; groepen.set(k, g); }
    g.idx.push(i);
  });
  const taken: { vertrek: Date; naar: [number, number]; idx: number[] }[] = [];
  for (const g of groepen.values()) {
    for (let i = 0; i < g.idx.length; i += a.maxHerkomsten) taken.push({ ...g, idx: g.idx.slice(i, i + a.maxHerkomsten) });
  }
  const fouten: string[] = [];
  let volgende = 0;
  const werker = async () => {
    while (volgende < taken.length) {
      const t = taken[volgende++];
      try {
        const r = await a.kolom(t.idx.map((i) => paren[i].van), t.naar, t.vertrek, f);
        t.idx.forEach((i, k) => { minuten[i] = r[k] ?? null; });
      } catch (e) {
        if (fouten.length < 5) fouten.push(e instanceof Error ? e.message : String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(gelijktijdig, taken.length) }, werker));
  return { minuten, fouten };
}
