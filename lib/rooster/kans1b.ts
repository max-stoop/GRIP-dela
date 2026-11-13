/** De kans dat een 1B valt, per dag voor het cluster: uit het rooster waar dat er is, anders uit de norm. */
import { DIENSTEN, normaliseerDienst } from './diensten';
import type { Cellen } from './types';
import type { NormParameters } from '../capaciteit/parameters';
import { clusterDag, normRegioDag, spelingOpDag, type ClusterDag, type RegioDag } from '../capaciteit/beschikbaarheid';
import { lamNorm, normWeek } from '../capaciteit/norm';
import { plekKansen } from '../capaciteit/plekkans';
import { toDay, weekdayMon } from '../dates';

export function plekkenUitRooster(cellen: Cellen, teamIds: string[], datum: string): { diensten: number[]; beschikbaar: number } {
  const diensten: number[] = [];
  let beschikbaar = 0;
  for (const id of teamIds) {
    const c = cellen[id]?.[datum];
    if (!c) continue;
    const d = DIENSTEN[normaliseerDienst(c)];
    if (d.categorie === 'beschikbaar') beschikbaar += d.plekken;
    else if (d.plekken > 0) diensten.push(d.plekken);
  }
  return { diensten, beschikbaar };
}

interface Kans1BInvoer {
  normen: NormParameters;
  cluster: string;
  regios: string[];
  dates: string[];
  /** Zonder waarde telt de vastgestelde verwachting. */
  lam: (regio: string, datum: string) => number | null | undefined;
  /** Als dat er is en de gebruiker het mag zien. */
  rooster: (regio: string) => { cellen: Cellen; team: string[] } | null;
}

/** Regio's zonder rooster op die dag tellen met de vastgestelde plekken en hun aandeel in de speling. */
export function kans1BPerDag(o: Kans1BInvoer): (ClusterDag | null)[] {
  const roosters = new Map(o.regios.map((r) => [r, o.rooster(r)]));
  return o.dates.map((datum) => {
    const week = normWeek(datum), dag = weekdayMon(toDay(datum));
    const regioDagen: RegioDag[] = [];
    let normAandeel = 0, normTotaal = 0;
    for (const regio of o.regios) {
      const verwacht = o.lam(regio, datum) ?? lamNorm(o.normen, regio, datum);
      if (verwacht == null) return null;
      const ln = lamNorm(o.normen, regio, datum) ?? 0;
      normTotaal += ln;
      const r = roosters.get(regio);
      const p = r ? plekkenUitRooster(r.cellen, r.team, datum) : null;
      if (p && (p.diensten.length || p.beschikbaar)) {
        regioDagen.push({ regio, lam: verwacht, ...p, bron: 'rooster' });
      } else {
        const nd = normRegioDag(o.normen, regio, week, dag, verwacht);
        if (!nd) return null;
        regioDagen.push(nd);
        normAandeel += ln;
      }
    }
    const speling = normTotaal > 0 ? Math.round((spelingOpDag(o.normen, o.cluster, week, dag) * normAandeel) / normTotaal) : 0;
    return clusterDag(regioDagen, o.normen.uitval, speling);
  });
}

const procent = (x: number) => `${Math.round(x * 100)}%`;
const getal = (x: number) => x.toFixed(1).replace('.', ',');

export function kans1BUitleg(c: ClusterDag, regio: string, clusterNaam: string, uitval: number): string {
  const k = c.cluster;
  const eigen = c.regios.find((r) => r.regio === regio);
  const rangen = k.perPlek.map((p, i) => `${i + 1}e ${procent(p)}`).join(', ');
  const zonderRooster = c.regios.filter((r) => r.bron === 'norm').map((r) => r.regio);
  return [
    `Cluster ${clusterNaam}: ${getal(k.lam)} meldingen verwacht, ${k.regulier} reguliere plekken${c.speling ? ` (waarvan ${c.speling} clusterspeling)` : ''} en ${k.beschikbaar} 1B.`,
    uitval > 0 ? `Door ziekte (${getal(uitval * 100)}% per dienst) vallen er naar verwachting ${getal(k.uitval)} plekken uit.` : '',
    `Een melding gaat eerst naar een vrije plek ergens in het cluster; pas als alles bezet is, valt er een 1B.`,
    `Kans dat er in het cluster een 1B valt: ${procent(k.minstensEen)}. Gemiddeld per 1B: ${procent(k.gemiddeld)}${rangen ? ` (${rangen})` : ''}.`,
    k.tekort >= 0.005 ? `Kans dat ook alle 1B's samen niet genoeg zijn: ${procent(k.tekort)}.` : '',
    eigen ? `Als ${regio} alles zelf moest opvangen: ${procent(eigen.alleen)}.` : '',
    zonderRooster.length && zonderRooster.length < c.regios.length ? `Zonder rooster, dus met de vastgestelde plekken: ${zonderRooster.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

/** Hoe vaak de 1B van één regio naar verwachting valt in een periode, en voor wie. */
export interface Val1B {
  /** Dagen met een 1B in het rooster (of volgens de norm). */
  dagen: number;
  /** Gemiddelde kans per dag dat de 1B een melding krijgt: eigen + cluster. */
  valt: number;
  /** ...voor een melding uit de eigen regio. */
  eigen: number;
  /** ...voor een melding uit een andere regio in het cluster. */
  cluster: number;
  /** Verwacht aantal keer in de periode. */
  keer: number;
}

/** Een melding gaat eerst naar een vrije plek ergens in het cluster; pas als alles bezet is, valt er een 1B. */
export function val1B(dagen: (ClusterDag | null)[], regio: string, uitval: number, trekkingen = 4000): Val1B | null {
  let n = 0, valt = 0, eigen = 0, cluster = 0;
  for (const c of dagen) {
    if (!c) continue;
    const p = plekKansen(c.dagen, uitval, c.speling, trekkingen).regios.find((r) => r.regio === regio)?.plekken.filter((x) => x.soort === '1B') ?? [];
    if (!p.length) continue;
    n++;
    for (const x of p) { valt += x.valt; eigen += x.eigen; cluster += x.cluster; }
  }
  return n ? { dagen: n, valt: valt / n, eigen: eigen / n, cluster: cluster / n, keer: valt } : null;
}

/**
 * Het deel van de dagen waarop het cluster genoeg heeft: de kans dat alle regelplekken en 1B's in het cluster samen
 * alle meldingen van die dag aankunnen (met ziekte), gemiddeld over de dagen. Dit telt dagen, niet meldingen.
 */
export function clusterGenoeg(dagen: (ClusterDag | null)[]): number | null {
  const ok = dagen.filter((d): d is ClusterDag => !!d);
  return ok.length ? ok.reduce((a, d) => a + (1 - d.cluster.tekort), 0) / ok.length : null;
}

/** Welk deel van de meldingen binnen 24 uur een regelgesprek krijgt, en waar. De drie tellen op tot 1. */
export interface Binnen24 {
  /** Op een regelplek of de 1B van de eigen regio. */
  eigen: number;
  /** Op een vrije plek of 1B elders in het cluster. */
  cluster: number;
  /** Die dag nergens in het cluster een plek. */
  niet: number;
}

/**
 * Over de hele periode, met de plekken uit het rooster. De andere regio's in het cluster hebben het zelf ook druk: ze
 * vangen eerst hun eigen meldingen op, en alleen wat daar dan nog vrij is, kan helpen (zie plekkans.ts).
 */
export function binnen24Uur(dagen: (ClusterDag | null)[], regio: string, uitval: number, trekkingen = 4000): Binnen24 | null {
  let vraag = 0, eigen = 0, cluster = 0, niet = 0;
  for (const c of dagen) {
    if (!c) continue;
    const r = plekKansen(c.dagen, uitval, c.speling, trekkingen).regios.find((x) => x.regio === regio);
    if (!r) continue;
    vraag += r.binnen24.vraag; eigen += r.binnen24.eigen; cluster += r.binnen24.cluster; niet += r.binnen24.niet;
  }
  return vraag > 0 ? { eigen: eigen / vraag, cluster: cluster / vraag, niet: niet / vraag } : null;
}
