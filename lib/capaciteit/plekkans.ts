/**
 * Per plek de kans dat hij valt voor een eigen melding of voor een andere regio in het cluster, en hetzelfde voor de
 * 1B. Elke regio vult eerst zijn eigen plekken; wat niet past, gaat naar een vrije plek elders in het cluster; pas als
 * alles bezet is, valt een 1B, eerst die van de eigen regio. Ziekte telt als extra werk.
 *
 * De eigen kansen zijn exact. Hoe hulp en 1B's over de regio's verdeeld worden, wordt nageteld op een vaste reeks
 * nagebootste dagen, dus dezelfde invoer geeft dezelfde uitkomst.
 */
import { convolutie, kans1B, poissonVerdeling, uitvalVerdeling, type RegioDag } from './beschikbaarheid';
import { poissonQuantile } from '../model/poisson';

export interface PlekKans {
  /** Eerst de reguliere plekken, daarna de 1B('s). */
  nr: number;
  soort: 'regulier' | '1B';
  /** Kans dat de plek een melding uit de eigen regio krijgt. */
  eigen: number;
  /** Kans dat de plek een melding uit een andere regio in het cluster krijgt. */
  cluster: number;
  /** eigen + cluster */
  valt: number;
}

export interface RegioPlekken {
  regio: string;
  lam: number;
  /** Een 2 telt voor twee. */
  regulier: number;
  beschikbaar: number;
  bron: RegioDag['bron'];
  /** Kans dat de eigen plekken, met de 1B, genoeg zijn als de regio alles zelf opvangt. */
  genoeg: number;
  /** Kans dat de reguliere plekken genoeg zijn als de regio alles zelf opvangt (de 1B niet nodig). */
  genoegZonder1B: number;
  plekken: PlekKans[];
  /** Gemiddeld aantal meldingen per dag uit andere regio's op de reguliere plekken van deze regio. */
  helpt: number;
  /** Gemiddeld aantal meldingen per dag uit deze regio op een reguliere plek elders in het cluster. */
  geholpen: number;
  /**
   * Waar de vraag van deze regio (meldingen, en plekken die door ziekte uitvallen) terechtkomt, gemiddeld per dag:
   * op een eigen plek of de eigen 1B, op een vrije plek of 1B elders in het cluster (de andere regio's vangen eerst
   * hun eigen vraag op), of nergens.
   */
  binnen24: { vraag: number; eigen: number; cluster: number; niet: number };
}

export interface ClusterPlekken {
  lam: number;
  /** Met de clusterspeling. */
  regulier: number;
  speling: number;
  beschikbaar: number;
  /** Kans dat alle plekken in het cluster samen, met de 1B's, genoeg zijn. */
  genoeg: number;
  /** Kans dat de reguliere plekken in het cluster genoeg zijn: er valt geen 1B. */
  genoegZonder1B: number;
  regios: RegioPlekken[];
}

/** Zoveel nagebootste dagen: de kansen liggen daarmee op een paar tienden van een procent nauwkeurig. */
const TREKKINGEN = 40_000;
const ZAAD = 20_261_009;

/** mulberry32: met hetzelfde zaad steeds dezelfde reeks. */
function toeval(zaad: number): () => number {
  let a = zaad >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** P(X >= x) en P(X <= x) uit een verdeling. */
const vanaf = (v: number[], x: number) => { let s = 0; for (let i = Math.max(0, x); i < v.length; i++) s += v[i]; return Math.min(1, s); };
const hoogstens = (v: number[], x: number) => { let s = 0; for (let i = 0; i <= Math.min(x, v.length - 1); i++) s += v[i]; return Math.min(1, s); };

function cumulatief(v: number[]): Float64Array {
  const c = new Float64Array(v.length);
  let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; c[i] = s; }
  return c;
}

/** Het kleinste aantal k met P(X <= k) > u. */
function trek(c: Float64Array, u: number): number {
  let lo = 0, hi = c.length - 1;
  if (u >= c[hi]) return hi;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (c[m] > u) hi = m; else lo = m + 1;
  }
  return lo;
}

/** Trek n eenheden zonder terugleggen uit groepen met `pot[i]` eenheden; `uit[i]` wordt het aantal uit groep i. */
function zonderTerugleggen(pot: Int32Array, n: number, uit: Int32Array, werk: Int32Array, rnd: () => number): void {
  let totaal = 0;
  for (let i = 0; i < pot.length; i++) { werk[i] = pot[i]; totaal += pot[i]; uit[i] = 0; }
  for (let k = 0; k < n && totaal > 0; k++) {
    let x = Math.floor(rnd() * totaal), i = 0;
    while (x >= werk[i]) { x -= werk[i]; i++; }
    werk[i]--; uit[i]++; totaal--;
  }
}

// dezelfde dag wordt vaak vaker gevraagd (opnieuw tekenen, een venster openen): de laatste uitkomsten bewaren
const bewaard = new Map<string, ClusterPlekken>();
const BEWAAR = 60;

/** speling: extra plekken van het cluster zelf, alleen voor wat elders niet past. De uitkomst wordt gedeeld: niet aanpassen. */
export function plekKansen(regios: RegioDag[], uitval: number, speling = 0, trekkingen = TREKKINGEN): ClusterPlekken {
  const sleutel = JSON.stringify([regios.map((r) => [r.regio, r.lam, r.diensten, r.beschikbaar, r.bron]), uitval, speling, trekkingen]);
  const al = bewaard.get(sleutel);
  if (al) return al;
  const uit = berekenPlekKansen(regios, uitval, speling, trekkingen);
  if (bewaard.size >= BEWAAR) bewaard.delete(bewaard.keys().next().value!);
  bewaard.set(sleutel, uit);
  return uit;
}

/** Zonder de bewaarde uitkomsten. */
export function berekenPlekKansen(regios: RegioDag[], uitval: number, speling: number, trekkingen: number): ClusterPlekken {
  const groepen = [
    ...regios.map((r) => ({ lam: Math.max(0, r.lam), diensten: r.diensten.filter((d) => d > 0), b: Math.max(0, r.beschikbaar) })),
    ...(speling > 0 ? [{ lam: 0, diensten: Array.from({ length: speling }, () => 1), b: 0 }] : []),
  ];
  const G = groepen.length;
  const p = groepen.map((g) => g.diensten.reduce((a, b) => a + b, 0));
  const b = groepen.map((g) => g.b);
  // de vraag per regio: meldingen plus de plekken die door ziekte uitvallen
  const vraag = groepen.map((g) => convolutie(poissonVerdeling(g.lam), uitvalVerdeling(g.diensten, uitval)));
  const cdf = groepen.map((g) => cumulatief(poissonVerdeling(g.lam)));

  const hulp = p.map((n) => new Float64Array(n));
  const bEigen = b.map((n) => new Float64Array(n)), bAnder = b.map((n) => new Float64Array(n));
  const helpt = new Float64Array(G), geholpen = new Float64Array(G);
  const vraagR = new Float64Array(G), eigenR = new Float64Array(G), clusterR = new Float64Array(G), nietR = new Float64Array(G);
  const eigen = new Int32Array(G), over = new Int32Array(G), vrij = new Int32Array(G), hulpNu = new Int32Array(G);
  const rest = new Int32Array(G), b1 = new Int32Array(G), vrij1B = new Int32Array(G), ander = new Int32Array(G), werk = new Int32Array(G);
  const rnd = toeval(ZAAD);

  for (let t = 0; t < trekkingen; t++) {
    let somOver = 0, somVrij = 0;
    for (let i = 0; i < G; i++) {
      let a = trek(cdf[i], rnd());
      if (uitval > 0) for (const d of groepen[i].diensten) if (rnd() < uitval) a += d;
      eigen[i] = Math.min(a, p[i]);
      over[i] = a - eigen[i];
      vrij[i] = p[i] - eigen[i];
      somOver += over[i]; somVrij += vrij[i];
    }
    // 2. wat niet past naar willekeurige vrije plekken in het cluster
    const geplaatst = Math.min(somOver, somVrij);
    if (geplaatst === somVrij) hulpNu.set(vrij);
    else zonderTerugleggen(vrij, geplaatst, hulpNu, werk, rnd);
    // wie er niet meer op een reguliere plek past: een willekeurig deel van wat over was
    const niet = somOver - geplaatst;
    if (niet === 0) rest.fill(0);
    else if (niet === somOver) rest.set(over);
    else zonderTerugleggen(over, niet, rest, werk, rnd);
    // 3. de 1B's: eerst de eigen, dan een vrije 1B elders
    let teVeel = 0, vrijeB = 0;
    for (let i = 0; i < G; i++) {
      b1[i] = Math.min(rest[i], b[i]);
      teVeel += rest[i] - b1[i];
      vrij1B[i] = b[i] - b1[i];
      vrijeB += vrij1B[i];
    }
    if (teVeel > 0 && vrijeB > 0) zonderTerugleggen(vrij1B, Math.min(teVeel, vrijeB), ander, werk, rnd);
    else ander.fill(0);
    // van wat ook op de eigen 1B niet past, vindt dit deel een vrije 1B elders; de rest vindt die dag geen plek
    const elders = teVeel > 0 ? Math.min(1, vrijeB / teVeel) : 0;
    for (let i = 0; i < G; i++) {
      for (let j = eigen[i]; j < eigen[i] + hulpNu[i]; j++) hulp[i][j]++;
      for (let j = 0; j < b1[i]; j++) bEigen[i][j]++;
      for (let j = b1[i]; j < b1[i] + ander[i]; j++) bAnder[i][j]++;
      helpt[i] += hulpNu[i];
      geholpen[i] += over[i] - rest[i];
      const zonder = rest[i] - b1[i];
      vraagR[i] += eigen[i] + over[i];
      eigenR[i] += eigen[i] + b1[i];
      clusterR[i] += over[i] - rest[i] + zonder * elders;
      nietR[i] += zonder * (1 - elders);
    }
  }

  const n = Math.max(1, trekkingen);
  const diensten = groepen.flatMap((g) => g.diensten);
  const k = kans1B({ lam: groepen.reduce((a, g) => a + g.lam, 0), diensten, beschikbaar: b.reduce((a, x) => a + x, 0), uitval });
  // de 1B's samen vallen gemiddeld precies k.gemiddeld x het aantal: de nagebootste verdeling daarop gelijkzetten
  let geteld = 0;
  for (let i = 0; i < G; i++) for (let j = 0; j < b[i]; j++) geteld += bEigen[i][j] + bAnder[i][j];
  const schaal = geteld > 0 ? (k.gemiddeld * k.beschikbaar * n) / geteld : 1;
  const uit: RegioPlekken[] = regios.map((r, i) => {
    const v = vraag[i];
    const plekken: PlekKans[] = [];
    for (let j = 1; j <= p[i]; j++) {
      const e = vanaf(v, j);
      const c = Math.min(hulp[i][j - 1] / n, 1 - e);
      plekken.push({ nr: j, soort: 'regulier', eigen: e, cluster: c, valt: e + c });
    }
    for (let j = 1; j <= b[i]; j++) {
      const e = (bEigen[i][j - 1] * schaal) / n, c = (bAnder[i][j - 1] * schaal) / n, m = Math.max(1, e + c);
      plekken.push({ nr: p[i] + j, soort: '1B', eigen: e / m, cluster: c / m, valt: (e + c) / m });
    }
    return {
      regio: r.regio, lam: r.lam, regulier: p[i], beschikbaar: b[i], bron: r.bron,
      genoeg: hoogstens(v, p[i] + b[i]), genoegZonder1B: hoogstens(v, p[i]),
      plekken, helpt: helpt[i] / n, geholpen: geholpen[i] / n,
      binnen24: { vraag: vraagR[i] / n, eigen: eigenR[i] / n, cluster: clusterR[i] / n, niet: nietR[i] / n },
    };
  });
  return {
    lam: k.lam, regulier: k.regulier, speling: Math.max(0, speling), beschikbaar: k.beschikbaar,
    genoeg: 1 - k.tekort, genoegZonder1B: 1 - k.minstensEen, regios: uit,
  };
}

/** Per regio de plekken op de dekkingsgraad (de 1B als laatste); speling brengt het cluster samen op zijn dekkingsgraad. */
export function clusterVoorspeld(
  regios: string[],
  lamVan: (regio: string) => number | null | undefined,
  o: { alphaRegio: number; alphaCluster: number; beschikbaarPerDag: number; speling: boolean },
): { dagen: RegioDag[]; speling: number } | null {
  const dagen: RegioDag[] = [];
  for (const regio of regios) {
    const lam = lamVan(regio);
    if (lam == null) return null;
    const k = poissonQuantile(o.alphaRegio, lam);
    const beschikbaar = Math.min(Math.max(0, o.beschikbaarPerDag), k);
    dagen.push({ regio, lam, diensten: Array.from({ length: k - beschikbaar }, () => 1), beschikbaar, bron: 'voorspelling' });
  }
  if (!dagen.length) return null;
  const totaal = dagen.reduce((a, d) => a + d.diensten.length + d.beschikbaar, 0);
  const speling = o.speling ? Math.max(0, poissonQuantile(o.alphaCluster, dagen.reduce((a, d) => a + d.lam, 0)) - totaal) : 0;
  return { dagen, speling };
}

/** Hele procenten waarvan de delen optellen tot het totaal: eigen + cluster = valt (grootste rest). */
export function procenten(p: Pick<PlekKans, 'valt' | 'eigen' | 'cluster'>): { valt: string; eigen: string; cluster: string } {
  const tot = Math.round(p.valt * 100), e = p.eigen * 100, c = p.cluster * 100;
  let ee = Math.floor(e), cc = Math.floor(c), rest = tot - ee - cc;
  for (const deel of e - ee >= c - cc ? ['e', 'c'] : ['c', 'e']) {
    if (rest <= 0) break;
    if (deel === 'e') ee++; else cc++;
    rest--;
  }
  return { valt: `${tot}%`, eigen: `${ee}%`, cluster: `${cc}%` };
}
