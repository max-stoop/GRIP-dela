/** Eén simulatie van de verdeling met uitleg, in een web worker zodat de pagina blijft reageren. */
import type { NormParameters } from '../capaciteit/parameters';
import type { Cellen, Medewerker } from '../rooster/types';
import { laadPostcodes, schatReistijd } from './geo';
import { simulatie } from './invoer';
import { Reistijden, benodigdeParen, haalLive } from './reistijd';
import { AL_TOEGEZEGD, uitleg, type Uitleg } from './uitleg';
import { dichtstbij, kengetallen, verdeel, type Kengetallen } from './verdeel';
import { dagInvoer, kans1BNa, vrijePlekken, type DagVerdeling, type KansNa, type VrijePlekken } from './dag';
import type { Melding, Parameters, Persoon, ReistijdFn, Uitkomst } from './types';

/** Per melding zoveel mensen met een live reistijd (de rest van het land valt af op de schatting). */
export const LIVE_K = 10;

export interface Opdracht {
  datum: string;
  normen: NormParameters;
  medewerkers: Medewerker[];
  rooster: Record<string, Cellen>;
  postcodes: Record<string, string>;
  /** Uit de laatste voorspelling; ontbreekt = de norm. */
  lam?: Record<string, number>;
  drukte: number;
  seed: number;
  parameters: Partial<Parameters>;
  bron: 'tabel' | 'live';
}

export interface Kant {
  uitkomst: Uitkomst;
  k: Kengetallen;
}

export interface Resultaat {
  datum: string;
  personen: Persoon[];
  meldingen: Melding[];
  echt: string[];
  aangevuld: string[];
  zonderPostcode: number;
  verwachting: 'voorspelling' | 'norm';
  slim: Kant;
  dicht: Kant;
  /** Per toegewezen melding: waarom, en wat het alternatief had gekost. */
  uitleg: Record<string, Uitleg>;
  plekken: number;
  ms: number;
  reistijd: { bron: 'tabel' | 'live'; live: number; factor: number; aanbieder: string | null; fout?: string };
}

/** Zolang de pagina of worker open is. */
const live = new Map<string, Reistijden>();

export async function rekenVerdeling(o: Opdracht): Promise<Resultaat> {
  const tabel = await laadPostcodes();
  const lam = o.lam && Object.keys(o.lam).length ? o.lam : undefined;
  const sim = simulatie({
    datum: o.datum, normen: o.normen, tabel, medewerkers: o.medewerkers, rooster: o.rooster, postcodes: o.postcodes,
    lam: lam ? (r) => lam[r] : undefined, drukte: o.drukte, seed: o.seed, parameters: o.parameters,
  });
  let reistijd: ReistijdFn = schatReistijd;
  const info: Resultaat['reistijd'] = { bron: o.bron, live: 0, factor: 1, aanbieder: null };
  if (o.bron === 'live') {
    const r = live.get(o.datum) ?? new Reistijden();
    live.set(o.datum, r);
    const paren = benodigdeParen(sim.invoer, LIVE_K).filter((p) => !r.heeft(p));
    if (paren.length) {
      const h = await haalLive(o.datum, paren, r);
      info.fout = h.fout;
      info.aanbieder = h.aanbieder;
    }
    info.live = r.aantalLive;
    info.factor = r.kalibratie;
    reistijd = r.reistijd;
  }
  const t0 = performance.now();
  const opties = { schatting: schatReistijd };
  const a = verdeel(sim.invoer, reistijd, opties);
  const ms = performance.now() - t0;
  const b = dichtstbij(sim.invoer, reistijd, opties);
  const u: Record<string, Uitleg> = {};
  for (const t of a.uitkomst.toewijzingen) {
    const x = uitleg(a.plan, t.meldingId);
    if (x) u[t.meldingId] = x;
  }
  return {
    datum: o.datum,
    personen: sim.invoer.personen,
    meldingen: sim.invoer.meldingen,
    echt: sim.echt,
    aangevuld: sim.aangevuld,
    zonderPostcode: sim.zonderPostcode,
    verwachting: lam ? 'voorspelling' : 'norm',
    slim: { uitkomst: a.uitkomst, k: kengetallen(a.plan, a.uitkomst) },
    dicht: { uitkomst: b.uitkomst, k: kengetallen(b.plan, b.uitkomst) },
    uitleg: u,
    plekken: a.plan.slots.size,
    ms,
    reistijd: info,
  };
}

export interface DagOpdracht {
  soort: 'dag';
  datum: string;
  medewerkers: Medewerker[];
  rooster: Record<string, Cellen>;
  /** Alle bewaarde verdelingen (werkdruk), ook die van deze dag. */
  verdelingen: Record<string, DagVerdeling>;
  verdeling: DagVerdeling;
  lam: Record<string, number>;
  parameters: Partial<Parameters>;
  bron: 'tabel' | 'live';
  /** Alleen de bewaarde verdeling bekijken: niets verschuift, en wat nog niet is verdeeld, telt niet mee. */
  bekijk?: boolean;
}

export interface ClusterNa extends KansNa {
  cluster: string;
  personen: number;
  vrij: VrijePlekken;
  /** Vroeg genoeg voor 10:00, en alleen nog voor 13:00. */
  nogOchtend: number;
  nogMiddag: number;
  /** Al bij het verdelen nodig. */
  ingezet1B: number;
  verdeeld: number;
}

export interface DagResultaat {
  datum: string;
  personen: Persoon[];
  meldingen: Melding[];
  uitkomst: Uitkomst;
  k: Kengetallen;
  uitleg: Record<string, Uitleg>;
  zonderPostcode: string[];
  onbekend: string[];
  clusters: ClusterNa[];
  reistijd: Resultaat['reistijd'];
}

export async function rekenDag(o: DagOpdracht): Promise<DagResultaat> {
  const tabel = await laadPostcodes();
  const doorgegeven = new Set(o.verdeling.toewijzingen.filter((t) => t.vast).map((t) => t.meldingId));
  const verdeeld = new Set(o.verdeling.toewijzingen.map((t) => t.meldingId));
  const verdeling = o.bekijk
    ? { ...o.verdeling, meldingen: o.verdeling.meldingen.filter((m) => verdeeld.has(m.id)), toewijzingen: o.verdeling.toewijzingen.map((t) => ({ ...t, vast: true })) }
    : o.verdeling;
  const d = dagInvoer({
    datum: o.datum, tabel, medewerkers: o.medewerkers, rooster: o.rooster, verdelingen: o.verdelingen, verdeling,
    lam: (r) => o.lam[r] ?? 0, parameters: o.parameters,
  });
  let reistijd: ReistijdFn = schatReistijd;
  const info: Resultaat['reistijd'] = { bron: o.bron, live: 0, factor: 1, aanbieder: null };
  if (o.bron === 'live' && d.invoer.meldingen.length) {
    const r = live.get(o.datum) ?? new Reistijden();
    live.set(o.datum, r);
    const paren = benodigdeParen(d.invoer, LIVE_K).filter((p) => !r.heeft(p));
    if (paren.length) {
      const h = await haalLive(o.datum, paren, r);
      info.fout = h.fout;
      info.aanbieder = h.aanbieder;
    }
    info.live = r.aantalLive;
    info.factor = r.kalibratie;
    reistijd = r.reistijd;
  }
  const a = verdeel(d.invoer, reistijd, { schatting: schatReistijd });
  const u: Record<string, Uitleg> = {};
  for (const t of a.uitkomst.toewijzingen) {
    const x = uitleg(a.plan, t.meldingId);
    // bij het bekijken staat alles vast, maar toegezegd is alleen wat is doorgegeven
    if (x && o.bekijk && !doorgegeven.has(t.meldingId)) x.regels = x.regels.filter((r) => r !== AL_TOEGEZEGD);
    if (x) u[t.meldingId] = x;
  }
  const bezet = new Set(a.uitkomst.toewijzingen.map((t) => t.slotId));
  const soort = new Map(d.invoer.personen.flatMap((p) => p.slots.map((s) => [s.id, s.soort] as const)));
  const clusterVan = new Map(d.invoer.personen.map((p) => [p.id, p.cluster]));
  const clusters: ClusterNa[] = a.uitkomst.clusters.map((c) => {
    const hier = a.uitkomst.toewijzingen.filter((t) => clusterVan.get(t.persoonId) === c.cluster);
    const mensen = d.invoer.personen.filter((p) => p.cluster === c.cluster);
    const vrij = vrijePlekken(mensen.flatMap((p) => p.slots).filter((s) => !bezet.has(s.id)));
    return {
      cluster: c.cluster, personen: mensen.length, vrij, nogOchtend: c.verwachtOchtend, nogMiddag: c.verwachtMiddag,
      ...kans1BNa(vrij, { ochtend: c.verwachtOchtend, middag: c.verwachtMiddag }),
      ingezet1B: hier.filter((t) => soort.get(t.slotId) === '1B').length,
      verdeeld: hier.length,
    };
  });
  return {
    datum: o.datum, personen: d.invoer.personen, meldingen: d.invoer.meldingen, uitkomst: a.uitkomst, k: kengetallen(a.plan, a.uitkomst),
    uitleg: u, zonderPostcode: d.zonderPostcode, onbekend: d.onbekend, clusters, reistijd: info,
  };
}
