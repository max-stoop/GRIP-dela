/** Coördinaten per PC4-gebied uit 4pp (Bob den Otter, MIT, https://github.com/bobdenotter/4pp). */
import type { Punt } from './types';
import { eilandVan, weg, type Weg } from './water';

export type PostcodeTabel = Map<string, [number, number, string]>;

let geladen: Promise<PostcodeTabel> | null = null;

/** 145 kB: pas laden als hij nodig is. */
export function laadPostcodes(): Promise<PostcodeTabel> {
  geladen ??= import('./pc4.json').then((m) => {
    const data = (m.default ?? m) as unknown as { pc: Record<string, [number, number, string]> };
    return new Map(Object.entries(data.pc));
  });
  return geladen;
}

/** De vier cijfers van een postcode ("3511 AB", "3511ab" en "3511" geven "3511"); null als het geen postcode is. */
export function pc4(postcode: string): string | null {
  const m = /^\s*([1-9]\d{3})/.exec(postcode);
  return m ? m[1] : null;
}

/** Bij een onbekende postcode het dichtstbijzijnde nummer. */
export function puntVan(tabel: PostcodeTabel, postcode: string): Punt | null {
  const p = pc4(postcode);
  if (!p) return null;
  const n = Number(p);
  for (let d = 0; d <= 10; d++) {
    for (const k of d ? [n - d, n + d] : [n]) {
      const r = tabel.get(String(k));
      if (r) return { postcode: postcode.trim().toUpperCase().replace(/\s+/g, ' '), lat: r[0], lng: r[1], plaats: r[2] };
    }
  }
  return null;
}

/** Hemelsbreed. */
export function afstandKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bij te stellen als er genoeg live reistijden zijn om mee te vergelijken. */
export const SCHATTING = {
  /** Weg / hemelsbreed. */
  omrijfactor: 1.3,
  /** Vaste tijd: parkeren, lopen, starten. */
  vast: 5,
  /**
   * De eerste kilometers gaan langzaam (bebouwde kom), dan sneller, daarna snelweg. Afgesteld op bekende ritten
   * (Amsterdam-Utrecht ~45 min, Den Haag-Rotterdam ~33, Maastricht-Eindhoven ~70); bij te stellen met live reistijden.
   */
  stukken: [[3, 25], [12, 55], [Infinity, 95]] as [number, number][],
  /** Spits: zoveel langer rijden bij vertrek in de ochtend- of avondspits. */
  spits: 1.15,
  spitsUren: [[7 * 60, 9.5 * 60], [16 * 60, 18.5 * 60]] as [number, number][],
};

export function wegVan(a: Punt, b: Punt): Weg {
  // dezelfde plekken komen in een verdeling heel vaak terug: per paar onthouden (op het object, dat is snel)
  let vanA = wegen.get(a);
  if (!vanA) { vanA = new WeakMap(); wegen.set(a, vanA); }
  const al = vanA.get(b);
  if (al) return al;
  const pa: [number, number] = [a.lat, a.lng], pb: [number, number] = [b.lat, b.lng];
  const w = weg(pa, pb, SCHATTING.omrijfactor, eilandVan(a.postcode, pa), eilandVan(b.postcode, pb));
  vanA.set(b, w);
  return w;
}

const wegen = new WeakMap<Punt, WeakMap<Punt, Weg>>();

/** Zonder spits. */
export function rijtijd(km: number): number {
  let rest = km, rij = 0;
  for (const [stuk, kmu] of SCHATTING.stukken) {
    const deel = Math.min(rest, stuk);
    rij += (deel / kmu) * 60;
    rest -= deel;
    if (rest <= 0) break;
  }
  return rij;
}

/** Zonder verkeersinformatie: over de weg om het water heen, plus veerboot en spits. */
export function schatReistijd(a: Punt, b: Punt, vertrek: number): number {
  const w = wegVan(a, b);
  if (!Number.isFinite(w.km)) return Infinity;
  const spits = SCHATTING.spitsUren.some(([v, t]) => vertrek >= v && vertrek < t) ? SCHATTING.spits : 1;
  return SCHATTING.vast + rijtijd(w.km) * spits + w.veer;
}
