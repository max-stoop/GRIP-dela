/** Per regio per dag gepland naast wat er moet, en het cluster samen: de plekken van de regio's plus de speling voor 95%. */
import { poissonQuantile } from '../model/poisson';
import { toDay, weekday } from '../dates';
import { DIENSTEN } from './diensten';
import { cel } from './toets';
import type { Cellen, Medewerker } from './types';

interface ClusterInvoer {
  regio: string;
  team: Medewerker[];
  cellen: Cellen;
  /** null als die er niet zijn. */
  behoefte: (datum: string) => { k: number; lam: number } | null;
}

interface ClusterOpties {
  /** 95% */
  alphaCluster: number;
  /** Beleid. */
  speling: boolean;
  /** Per regio per dag, behalve zondag. */
  minDG: number;
  /** Afwijkend per regio. */
  dgPerRegio?: Record<string, number>;
}

export interface ClusterRegel {
  regio: string;
  /** Per dag (zoals dates), inclusief 1B. */
  gepland: number[];
  beschikbaar: number[];
  afgesproken: (number | null)[];
  /** DG1 en DG2. */
  dg: number[];
  dgMoet: number[];
  totaalGepland: number;
  totaalAfgesproken: number;
  /** Minder gepland dan afgesproken. */
  tekort: number;
  /** Zonder team. */
  leeg: boolean;
}

export interface ClusterStand {
  regels: ClusterRegel[];
  gepland: number[];
  /** De regio's samen plus de speling; null zonder afspraak. */
  afgesproken: (number | null)[];
  speling: number[];
  /** null zonder afspraak. */
  verschil: (number | null)[];
  tekort: number;
  dg: number[];
  dgMoet: number[];
}

export function clusterStand(dates: string[], regios: ClusterInvoer[], o: ClusterOpties): ClusterStand {
  const zondag = dates.map((d) => weekday(toDay(d)) === 0);
  const behoeften = regios.map((r) => dates.map((d) => r.behoefte(d)));
  const regels = regios.map((r, ri): ClusterRegel => {
    const gepland: number[] = [], beschikbaar: number[] = [], dg: number[] = [];
    for (const d of dates) {
      let p = 0, b = 0, n = 0;
      for (const e of r.team) {
        const s = cel(r.cellen, e.id, d), def = DIENSTEN[s];
        p += def.plekken;
        if (s === '1B') b++;
        if (def.categorie === 'dossier') n++;
      }
      gepland.push(p);
      beschikbaar.push(b);
      dg.push(n);
    }
    const afgesproken = behoeften[ri].map((x) => x?.k ?? null);
    return {
      regio: r.regio, gepland, beschikbaar, afgesproken, dg, dgMoet: zondag.map((z) => (z ? 0 : o.dgPerRegio?.[r.regio] ?? o.minDG)),
      totaalGepland: gepland.reduce((a, x) => a + x, 0),
      totaalAfgesproken: afgesproken.reduce<number>((a, x) => a + (x ?? 0), 0),
      tekort: gepland.filter((p, i) => afgesproken[i] != null && p < afgesproken[i]!).length,
      leeg: !r.team.length,
    };
  });
  const som = (f: (r: ClusterRegel) => number) => regels.reduce((a, r) => a + f(r), 0);
  const gepland = dates.map((_, i) => som((r) => r.gepland[i]));
  const speling = dates.map((_, i) => {
    const bs = behoeften.map((b) => b[i]);
    if (!o.speling || !bs.length || bs.some((b) => b == null)) return 0;
    const k = bs.reduce((a, b) => a + b!.k, 0), lam = bs.reduce((a, b) => a + b!.lam, 0);
    return Math.max(0, poissonQuantile(o.alphaCluster, lam) - k);
  });
  const afgesproken = dates.map((_, i) => (regels.some((r) => r.afgesproken[i] != null) ? som((r) => r.afgesproken[i] ?? 0) + speling[i] : null));
  const verschil = dates.map((_, i) => (afgesproken[i] != null ? gepland[i] - afgesproken[i]! : null));
  return {
    regels, gepland, afgesproken, speling, verschil, tekort: verschil.filter((v) => v != null && v < 0).length,
    dg: dates.map((_, i) => som((r) => r.dg[i])), dgMoet: dates.map((_, i) => som((r) => r.dgMoet[i])),
  };
}
