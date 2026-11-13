/**
 * De waarde van een vrije plek: wat het kost als hij nu wordt gevuld en later op de dag ontbreekt. Per cluster komen
 * na de nachtverdeling nog No ~ Poisson(verwacht × aandeelOchtend) meldingen die een ochtendplek halen en
 * Nm ~ Poisson(verwacht × aandeelMiddag) die alleen een middagplek halen. Een plek vullen kost de prijs van een tekort
 * × (E[tekort] met een plek minder − E[tekort] nu). Een lege ochtendplek is meestal verloren, een middagplek niet:
 * daarom kost een middagplek vullen vaak meer.
 */
import { poissonVerdeling } from '../capaciteit/beschikbaarheid';

interface Vraag {
  ochtend: number;
  middag: number;
}

export class Tekorten {
  private readonly po: number[];
  private readonly pm: number[];
  private readonly cache = new Map<number, number>();

  constructor(readonly vraag: Vraag) {
    this.po = poissonVerdeling(Math.max(0, vraag.ochtend));
    this.pm = poissonVerdeling(Math.max(0, vraag.middag));
  }

  /** Later op de dag zonder plek. */
  verwacht(fo: number, fm: number): number {
    fo = Math.max(0, fo); fm = Math.max(0, fm);
    const sleutel = fo * 10000 + fm;
    const al = this.cache.get(sleutel);
    if (al != null) return al;
    let e = 0;
    for (let no = 0; no < this.po.length; no++) {
      const pno = this.po[no];
      if (pno < 1e-12) continue;
      const over = Math.max(0, no - fo);              // vroege meldingen zonder ochtendplek
      const u1 = Math.max(0, over - fm);              // ook geen middagplek meer
      const rest = Math.max(0, fm - over);            // middagplekken die overblijven
      for (let nm = 0; nm < this.pm.length; nm++) {
        const p = pno * this.pm[nm];
        if (p < 1e-14) continue;
        e += p * (u1 + Math.max(0, nm - rest));
      }
    }
    this.cache.set(sleutel, e);
    return e;
  }

  /** Als er een plek van dit dagdeel wordt gevuld. */
  marginaal(fo: number, fm: number, dagdeel: 'ochtend' | 'middag'): number {
    return dagdeel === 'ochtend' ? this.verwacht(fo - 1, fm) - this.verwacht(fo, fm) : this.verwacht(fo, fm - 1) - this.verwacht(fo, fm);
  }
}
