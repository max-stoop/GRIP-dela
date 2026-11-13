/**
 * Open-Meteo: weersverwachting (16 d), historie (archief), luchtkwaliteit (CAMS) en seizoensverwachting (ECMWF).
 * Gratis gebruik is niet-commercieel. Met OPENMETEO_API_KEY gebruikt de app de zakelijke servers.
 */
import { COORDS, DE_BILT, REGIONS } from '../model/config';
import { solve } from '../model/linalg';
import { haal, naarReeksen, type BronResultaat } from './common';

type Rij = [string, string, string, number | null];
type OmReeks = Record<string, (number | null)[]> & { time: string[] };
interface OmAntwoord { daily?: OmReeks; hourly?: OmReeks; error?: boolean; reason?: string }

function host(sub: string) {
  const key = process.env.OPENMETEO_API_KEY;
  return { base: key ? `https://customer-${sub}.open-meteo.com` : `https://${sub}.open-meteo.com`, key };
}

async function multi(sub: string, path: string, params: Record<string, string | number>): Promise<OmAntwoord[]> {
  const { base, key } = host(sub);
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  if (key) q.set('apikey', key);
  const js = (await (await haal(`${base}${path}?${q}`, 120_000)).json()) as OmAntwoord | OmAntwoord[];
  if (!Array.isArray(js) && js?.error) throw new Error(js.reason ?? 'Open-Meteo gaf een fout');
  return Array.isArray(js) ? js : [js];
}

const locs = (names: string[]) => ({
  latitude: names.map((n) => COORDS[n][0]).join(','),
  longitude: names.map((n) => COORDS[n][1]).join(','),
});

const DAILY_T = 'temperature_2m_max,temperature_2m_min,temperature_2m_mean';
const T_FIELDS: Record<string, string> = { temperature_2m_max: 'tmax', temperature_2m_min: 'tmin', temperature_2m_mean: 'tmean' };

function dagelijks(bron: string, names: string[], res: OmAntwoord[]): BronResultaat {
  const rijen: Rij[] = [];
  names.forEach((name, i) => {
    const d = res[i]?.daily;
    if (!d) return;
    d.time.forEach((t: string, j: number) => {
      for (const [f, v] of Object.entries(T_FIELDS)) rijen.push([name, t, v, d[f]?.[j] ?? null]);
    });
  });
  return { bron, ...naarReeksen(rijen) };
}

export async function weersverwachting(): Promise<BronResultaat> {
  const res = await multi('api', '/v1/forecast', { ...locs(REGIONS), daily: DAILY_T, timezone: 'Europe/Amsterdam', past_days: 14, forecast_days: 16 });
  return dagelijks('weer', REGIONS, res);
}

export async function weerArchief(van: string, tot: string): Promise<BronResultaat> {
  const res = await multi('archive-api', '/v1/archive', { ...locs(REGIONS), daily: DAILY_T, timezone: 'Europe/Amsterdam', start_date: van, end_date: tot });
  return dagelijks('weer', REGIONS, res);
}

function lucht(res: OmAntwoord[]): BronResultaat {
  const rijen: Rij[] = [];
  REGIONS.forEach((name, i) => {
    const h = res[i]?.hourly;
    if (!h) return;
    const dag = new Map<string, { pm: number[]; oz: number[] }>();
    h.time.forEach((t: string, j: number) => {
      const k = t.slice(0, 10);
      let g = dag.get(k);
      if (!g) dag.set(k, (g = { pm: [], oz: [] }));
      const pm = h.pm2_5?.[j], oz = h.ozone?.[j];
      if (pm != null) g.pm.push(pm);
      if (oz != null) g.oz.push(oz);
    });
    for (const [d, g] of dag) {
      rijen.push([name, d, 'pm25', g.pm.length ? g.pm.reduce((a, b) => a + b, 0) / g.pm.length : null]);
      rijen.push([name, d, 'ozone', g.oz.length ? Math.max(...g.oz) : null]);
    }
  });
  return { bron: 'lucht', ...naarReeksen(rijen) };
}

export async function luchtVerwachting(): Promise<BronResultaat> {
  return lucht(await multi('air-quality-api', '/v1/air-quality', { ...locs(REGIONS), hourly: 'pm2_5,ozone', timezone: 'Europe/Amsterdam', past_days: 14, forecast_days: 5 }));
}

export async function luchtArchief(van: string, tot: string): Promise<BronResultaat> {
  return lucht(await multi('air-quality-api', '/v1/air-quality', { ...locs(REGIONS), hourly: 'pm2_5,ozone', timezone: 'Europe/Amsterdam', start_date: van, end_date: tot }));
}

/** 30 jaar De Bilt daggemiddelde -> normaal per dag van het jaar (glad met Fourier, K = 2). */
export async function klimaatNormalen(): Promise<BronResultaat> {
  const [js] = await multi('archive-api', '/v1/archive', {
    latitude: DE_BILT[0], longitude: DE_BILT[1], daily: 'temperature_2m_mean', timezone: 'Europe/Amsterdam', start_date: '1995-01-01', end_date: '2024-12-31',
  });
  if (!js?.daily) throw new Error('Open-Meteo gaf geen klimaatreeks');
  return { bron: 'normalen', reeksen: [], normaal: fourierFit(js.daily.time, js.daily.temperature_2m_mean), rijen: js.daily.time.length };
}

export function fourierFit(time: string[], vals: (number | null)[]): number[] {
  const XtX = Array.from({ length: 5 }, () => new Array<number>(5).fill(0)), Xty = new Array<number>(5).fill(0);
  time.forEach((t, i) => {
    const y = vals[i];
    if (y == null) return;
    const d = new Date(t + 'T00:00:00Z');
    const doy = Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
    const a = (2 * Math.PI * doy) / 365.25;
    const x = [1, Math.sin(a), Math.cos(a), Math.sin(2 * a), Math.cos(2 * a)];
    for (let j = 0; j < 5; j++) {
      Xty[j] += x[j] * y;
      for (let k = 0; k < 5; k++) XtX[j][k] += x[j] * x[k];
    }
  });
  return solve(XtX, Xty);
}

/** ECMWF-ensemblegemiddelde daggemiddelde temperatuur, De Bilt, ruim 3 maanden vooruit. */
export async function seizoensverwachting(): Promise<BronResultaat> {
  const [js] = await multi('seasonal-api', '/v1/seasonal', {
    latitude: DE_BILT[0], longitude: DE_BILT[1], daily: 'temperature_2m_mean', timezone: 'Europe/Amsterdam', forecast_days: 90,
  });
  if (!js?.daily) throw new Error('Open-Meteo gaf geen seizoensverwachting');
  return { bron: 'seizoen', ...naarReeksen(seizoenRijen(js.daily)) };
}

export function seizoenRijen(d: OmReeks): Rij[] {
  const leden = Object.keys(d).filter((k) => k.startsWith('temperature_2m_mean'));
  return d.time.map((t, i) => {
    const v = leden.map((k) => d[k][i]).filter((x): x is number => x != null && Number.isFinite(x));
    return ['NL', t, 'tmean_ens', v.length ? v.reduce((a, b) => a + b, 0) / v.length : null] as Rij;
  });
}
