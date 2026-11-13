/**
 * Water in de schatting van de reistijd. Kruist de rechte lijn tussen twee plekken een barrière (het midden van een
 * zeearm of rivier, of de oever van een meer), dan gaat de route over knopen en oversteken: bruggen, dammen, tunnels
 * en veerboten, met de kortste routes vooraf doorgerekend. Eilanden zijn alleen met de veerboot bereikbaar.
 *
 * De lijnen zijn met de hand getekend op ongeveer een kilometer nauwkeurig en getoetst op de middens van alle
 * postcodegebieden: geen woonkern aan de verkeerde kant van het water.
 */

/** [breedte, lengte] */
export type LL = [number, number];

interface Barriere {
  naam: string;
  /** Een gesloten lus (meer) heeft eerste punt = laatste punt. */
  lijn: LL[];
}

interface Oversteek {
  naam: string;
  van: LL;
  naar: LL;
  /** Over de weg (dam, brug, tunnel), of */
  km?: number;
  /** met de veerboot inclusief wachten, in minuten. */
  veer?: number;
}

interface Eiland {
  naam: string;
  /** PC4-gebieden op het eiland. */
  pc4: [number, number][];
  /** Voor plekken zonder postcode: [min breedte, max breedte, min lengte, max lengte]. */
  kader: [number, number, number, number];
  haven: LL;
  vasteland: LL;
  /** Inclusief wachten, in minuten. */
  veer: number;
}

export const BARRIERES: Barriere[] = [
  {
    naam: 'Westerschelde',
    lijn: [[51.430, 2.60], [51.430, 3.40], [51.420, 3.56], [51.400, 3.68], [51.375, 3.76], [51.362, 3.82], [51.368, 3.90], [51.405, 3.97], [51.400, 4.03], [51.393, 4.10], [51.388, 4.20], [51.375, 4.24]],
  },
  {
    naam: 'Oosterschelde',
    lijn: [[51.630, 3.30], [51.632, 3.69], [51.623, 3.78], [51.618, 3.88], [51.600, 3.95], [51.585, 3.99], [51.555, 4.02], [51.522, 4.05], [51.515, 4.10], [51.510, 4.15], [51.500, 4.20], [51.498, 4.235]],
  },
  {
    naam: 'Keeten, Krammer en Volkerak',
    lijn: [[51.585, 3.99], [51.600, 4.03], [51.620, 4.08], [51.638, 4.13], [51.655, 4.20], [51.660, 4.28], [51.668, 4.35], [51.680, 4.405]],
  },
  {
    naam: 'Grevelingen',
    lijn: [[51.750, 3.30], [51.752, 3.84], [51.752, 3.95], [51.735, 4.02], [51.700, 4.07], [51.685, 4.11]],
  },
  {
    naam: 'Haringvliet, Hollands Diep en Biesbosch',
    lijn: [[51.840, 3.30], [51.828, 4.03], [51.812, 4.10], [51.795, 4.20], [51.775, 4.28], [51.738, 4.36], [51.718, 4.42], [51.713, 4.47], [51.718, 4.55], [51.702, 4.59], [51.708, 4.625], [51.725, 4.68], [51.745, 4.76], [51.745, 4.84], [51.725, 4.885]],
  },
  {
    naam: 'Nieuwe Waterweg',
    lijn: [[51.990, 3.90], [51.978, 4.08], [51.972, 4.13], [51.945, 4.19], [51.915, 4.245], [51.903, 4.275], [51.893, 4.31], [51.890, 4.34], [51.892, 4.37]],
  },
  {
    naam: 'Waddenzee bij de Afsluitdijk',
    lijn: [[53.000, 4.65], [52.985, 4.80], [52.990, 5.00], [53.050, 5.20], [53.088, 5.30], [53.095, 5.322]],
  },
  {
    naam: 'IJsselmeer',
    lijn: [
      [52.925, 5.060], [52.900, 5.075], [52.840, 5.110], [52.780, 5.130], [52.755, 5.250], [52.725, 5.300], [52.705, 5.310],
      [52.545, 5.415], [52.548, 5.450], [52.572, 5.505], [52.584, 5.580], [52.595, 5.635], [52.620, 5.600], [52.660, 5.585],
      [52.750, 5.620], [52.800, 5.635], [52.835, 5.670], [52.820, 5.580], [52.830, 5.470], [52.860, 5.380], [52.885, 5.340],
      [52.940, 5.385], [52.980, 5.385], [53.045, 5.370], [52.925, 5.060],
    ],
  },
  {
    naam: 'Markermeer',
    lijn: [
      [52.685, 5.275], [52.535, 5.400], [52.500, 5.395], [52.440, 5.370], [52.440, 5.280], [52.420, 5.200], [52.400, 5.140],
      [52.388, 5.090], [52.392, 5.035], [52.410, 5.050], [52.420, 5.090], [52.450, 5.125], [52.470, 5.120], [52.495, 5.095],
      [52.540, 5.075], [52.600, 5.060], [52.625, 5.100], [52.625, 5.160], [52.632, 5.220], [52.665, 5.255], [52.685, 5.275],
    ],
  },
];

export const OVERSTEKEN: Oversteek[] = [
  { naam: 'Afsluitdijk', van: [52.935, 5.035], naar: [53.072, 5.342], km: 32 },
  { naam: 'Houtribdijk', van: [52.700, 5.283], naar: [52.528, 5.420], km: 26 },
  { naam: 'Westerscheldetunnel', van: [51.398, 3.792], naar: [51.333, 3.800], km: 10 },
  { naam: 'Zeelandbrug', van: [51.636, 3.912], naar: [51.597, 3.857], km: 6 },
  { naam: 'Oosterscheldekering', van: [51.655, 3.705], naar: [51.585, 3.668], km: 10 },
  { naam: 'Philipsdam', van: [51.655, 4.115], naar: [51.622, 4.150], km: 7 },
  { naam: 'Brouwersdam', van: [51.775, 3.865], naar: [51.728, 3.840], km: 7 },
  { naam: 'Haringvlietdam', van: [51.845, 4.045], naar: [51.812, 4.030], km: 5 },
  { naam: 'Haringvlietbrug', van: [51.733, 4.430], naar: [51.700, 4.420], km: 4 },
  { naam: 'Moerdijkbruggen', van: [51.722, 4.628], naar: [51.692, 4.628], km: 4 },
  { naam: 'Veerpont Maassluis–Rozenburg', van: [51.918, 4.250], naar: [51.908, 4.252], veer: 15 },
];

/** Punten waar je om een water heen rijdt: het einde van een barrière, of een dam tussen twee meren. */
export const KNOPEN: { naam: string; p: LL }[] = [
  { naam: 'Den Oever (Afsluitdijk)', p: [52.935, 5.035] },
  { naam: 'Kornwerderzand (Afsluitdijk)', p: [53.072, 5.342] },
  { naam: 'Enkhuizen (Houtribdijk)', p: [52.700, 5.283] },
  { naam: 'Lelystad (Houtribdijk)', p: [52.528, 5.420] },
  { naam: 'Medemblik', p: [52.770, 5.100] },
  { naam: 'Ketelbrug', p: [52.598, 5.668] },
  { naam: 'Lemmer', p: [52.850, 5.705] },
  { naam: 'Antwerpen-Noord', p: [51.370, 4.310] },
  { naam: 'Bergen op Zoom', p: [51.490, 4.282] },
  { naam: 'Bruinisse (Grevelingendam)', p: [51.665, 4.105] },
  { naam: 'Hellegatsplein', p: [51.700, 4.422] },
  { naam: 'Keizersveer', p: [51.715, 4.905] },
  { naam: 'Beneluxtunnel', p: [51.895, 4.390] },
];

export const EILANDEN: Eiland[] = [
  { naam: 'Texel', pc4: [[1790, 1797]], kader: [52.99, 53.19, 4.69, 4.93], haven: [53.002, 4.786], vasteland: [52.963, 4.785], veer: 35 },
  { naam: 'Vlieland', pc4: [[8899, 8899]], kader: [53.22, 53.32, 4.88, 5.12], haven: [53.296, 5.093], vasteland: [53.175, 5.412], veer: 120 },
  { naam: 'Terschelling', pc4: [[8881, 8897]], kader: [53.34, 53.46, 5.15, 5.56], haven: [53.360, 5.218], vasteland: [53.175, 5.412], veer: 150 },
  { naam: 'Ameland', pc4: [[9161, 9164]], kader: [53.42, 53.51, 5.60, 5.95], haven: [53.442, 5.775], vasteland: [53.405, 5.880], veer: 75 },
  { naam: 'Schiermonnikoog', pc4: [[9166, 9166]], kader: [53.46, 53.51, 6.07, 6.33], haven: [53.470, 6.200], vasteland: [53.408, 6.205], veer: 75 },
];

/** Vlakke benadering voor de kruisingstoets: lengte maal cos(52°), zodat een graad oost en noord vergelijkbaar zijn. */
const KX = 0.616;

interface Segment { ax: number; ay: number; bx: number; by: number }

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Echt snijden, niet alleen raken. */
function snijdt(s: Segment, t: Segment): boolean {
  const d1 = orient(t.ax, t.ay, t.bx, t.by, s.ax, s.ay);
  const d2 = orient(t.ax, t.ay, t.bx, t.by, s.bx, s.by);
  const d3 = orient(s.ax, s.ay, s.bx, s.by, t.ax, t.ay);
  const d4 = orient(s.ax, s.ay, s.bx, s.by, t.bx, t.by);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

const segmenten: Segment[] = BARRIERES.flatMap((b) => b.lijn.slice(1).map((p, i) => ({ ax: b.lijn[i][1] * KX, ay: b.lijn[i][0], bx: p[1] * KX, by: p[0] })));
const kader = segmenten.reduce(
  (k, s) => [Math.min(k[0], s.ay, s.by), Math.max(k[1], s.ay, s.by), Math.min(k[2], s.ax, s.bx), Math.max(k[3], s.ax, s.bx)],
  [Infinity, -Infinity, Infinity, -Infinity],
);

export function geblokkeerd(a: LL, b: LL): boolean {
  const s: Segment = { ax: a[1] * KX, ay: a[0], bx: b[1] * KX, by: b[0] };
  // snel: buiten het gebied van alle barrières
  if (Math.max(s.ay, s.by) < kader[0] || Math.min(s.ay, s.by) > kader[1] || Math.max(s.ax, s.bx) < kader[2] || Math.min(s.ax, s.bx) > kader[3]) return false;
  const lo = Math.min(s.ax, s.bx), hi = Math.max(s.ax, s.bx), yl = Math.min(s.ay, s.by), yh = Math.max(s.ay, s.by);
  for (const t of segmenten) {
    if (Math.max(t.ax, t.bx) < lo || Math.min(t.ax, t.bx) > hi || Math.max(t.ay, t.by) < yl || Math.min(t.ay, t.by) > yh) continue;
    if (snijdt(s, t)) return true;
  }
  return false;
}

/** Index in EILANDEN, of -1 voor het vasteland. */
export function eilandVan(postcode: string | undefined, p: LL): number {
  const n = postcode ? Number(/^\s*([1-9]\d{3})/.exec(postcode)?.[1]) : NaN;
  if (Number.isFinite(n)) return EILANDEN.findIndex((e) => e.pc4.some(([lo, hi]) => n >= lo && n <= hi));
  return EILANDEN.findIndex((e) => p[0] >= e.kader[0] && p[0] <= e.kader[1] && p[1] >= e.kader[2] && p[1] <= e.kader[3]);
}

export function hemelsbreed(a: LL, b: LL): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Graaf {
  punten: LL[];
  /** -1 = vasteland. */
  zone: number[];
  /** Kortste route: kosten (veerboot omgerekend naar km), km over de weg en minuten veer. */
  kosten: Float64Array;
  km: Float64Array;
  veer: Float64Array;
}

/** Minuten met de veerboot tellen in de routekeuze als zoveel km. */
const KM_PER_VEERMINUUT = 1.2;

let graaf: Graaf | null = null;

function bouwGraaf(omrij: number): Graaf {
  const punten: LL[] = [], zone: number[] = [];
  const voeg = (p: LL, z: number) => { punten.push(p); zone.push(z); return punten.length - 1; };
  for (const k of KNOPEN) voeg(k.p, -1);
  const extra: { i: number; j: number; km: number; veer: number }[] = [];
  for (const o of OVERSTEKEN) extra.push({ i: voeg(o.van, -1), j: voeg(o.naar, -1), km: o.km ?? 0, veer: o.veer ?? 0 });
  EILANDEN.forEach((e, z) => extra.push({ i: voeg(e.vasteland, -1), j: voeg(e.haven, z), km: 0, veer: e.veer }));
  const n = punten.length;
  const kosten = new Float64Array(n * n).fill(Infinity), km = new Float64Array(n * n).fill(Infinity), veer = new Float64Array(n * n).fill(0);
  const zet = (i: number, j: number, k: number, v: number) => {
    const c = k + v * KM_PER_VEERMINUUT;
    if (c < kosten[i * n + j]) { kosten[i * n + j] = c; km[i * n + j] = k; veer[i * n + j] = v; }
  };
  for (let i = 0; i < n; i++) {
    zet(i, i, 0, 0);
    for (let j = i + 1; j < n; j++) {
      if (zone[i] !== zone[j] || geblokkeerd(punten[i], punten[j])) continue;
      const k = hemelsbreed(punten[i], punten[j]) * omrij;
      zet(i, j, k, 0); zet(j, i, k, 0);
    }
  }
  for (const e of extra) { zet(e.i, e.j, e.km, e.veer); zet(e.j, e.i, e.km, e.veer); }
  // Floyd-Warshall: de graaf is klein (enkele tientallen punten)
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const ik = kosten[i * n + k];
      if (ik === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const c = ik + kosten[k * n + j];
        if (c < kosten[i * n + j]) {
          kosten[i * n + j] = c;
          km[i * n + j] = km[i * n + k] + km[k * n + j];
          veer[i * n + j] = veer[i * n + k] + veer[k * n + j];
        }
      }
    }
  }
  return { punten, zone, kosten, km, veer };
}

export interface Weg {
  /** Hemelsbreed × omrijfactor per stuk, plus dammen en bruggen. */
  km: number;
  /** Inclusief wachten. */
  veer: number;
  omweg: boolean;
}

const geheugen = new Map<string, Weg>();

/** Oneindig als het niet kan (komt in Nederland niet voor). */
export function weg(a: LL, b: LL, omrij: number, zoneA = -1, zoneB = -1): Weg {
  if (zoneA === zoneB && !geblokkeerd(a, b)) return { km: hemelsbreed(a, b) * omrij, veer: 0, omweg: false };
  const sleutel = `${a[0]},${a[1]},${zoneA}>${b[0]},${b[1]},${zoneB}|${omrij}`;
  const al = geheugen.get(sleutel);
  if (al) return al;
  graaf ??= bouwGraaf(omrij);
  const g = graaf, n = g.punten.length;
  const vanA: { i: number; k: number }[] = [], naarB: { j: number; k: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (g.zone[i] === zoneA && !geblokkeerd(a, g.punten[i])) vanA.push({ i, k: hemelsbreed(a, g.punten[i]) * omrij });
    if (g.zone[i] === zoneB && !geblokkeerd(g.punten[i], b)) naarB.push({ j: i, k: hemelsbreed(g.punten[i], b) * omrij });
  }
  let beste: Weg = { km: Infinity, veer: 0, omweg: true }, besteKosten = Infinity;
  for (const x of vanA) {
    for (const y of naarB) {
      const c = x.k + g.kosten[x.i * n + y.j] + y.k;
      if (c < besteKosten) {
        besteKosten = c;
        beste = { km: x.k + g.km[x.i * n + y.j] + y.k, veer: g.veer[x.i * n + y.j], omweg: true };
      }
    }
  }
  if (geheugen.size > 200_000) geheugen.clear();
  geheugen.set(sleutel, beste);
  return beste;
}
