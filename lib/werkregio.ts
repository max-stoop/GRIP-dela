'use client';
/** De regio waar de planner nu mee bezig is; bewaard in deze browser. */
import { useEffect, useSyncExternalStore } from 'react';

const SLEUTEL = 'grip-werkregio';
let waarde: string | null = null;
let gelezen = false;
const luisteraars = new Set<() => void>();

function lees(): string | null {
  if (!gelezen) {
    gelezen = true;
    try { waarde = localStorage.getItem(SLEUTEL); } catch { /* geen opslag */ }
  }
  return waarde;
}

function abonneer(f: () => void) {
  luisteraars.add(f);
  return () => { luisteraars.delete(f); };
}

export function zetWerkregio(regio: string) {
  if (waarde === regio) return;
  waarde = regio;
  gelezen = true;
  try { localStorage.setItem(SLEUTEL, regio); } catch { /* geen opslag */ }
  luisteraars.forEach((f) => f());
}

/** Binnen de regio's waar de gebruiker bij mag; anders de eerste daarvan. */
export function useWerkregio(regios: string[]): [string, (regio: string) => void] {
  const w = useSyncExternalStore(abonneer, lees, () => null);
  return [w && regios.includes(w) ? w : regios[0] ?? '', zetWerkregio];
}

// Landelijk: het dashboard van de regiomanager toont dan het hele land. De werkregio blijft voor de pagina's per regio.
const LANDELIJK = 'grip-landelijk';
let landelijk = false;
let landelijkGelezen = false;
const landelijkLuisteraars = new Set<() => void>();

function leesLandelijk(): boolean {
  if (!landelijkGelezen) {
    landelijkGelezen = true;
    try { landelijk = localStorage.getItem(LANDELIJK) === '1'; } catch { /* geen opslag */ }
  }
  return landelijk;
}

export function zetLandelijk(aan: boolean) {
  if (leesLandelijk() === aan) return;
  landelijk = aan;
  try { if (aan) localStorage.setItem(LANDELIJK, '1'); else localStorage.removeItem(LANDELIJK); } catch { /* geen opslag */ }
  landelijkLuisteraars.forEach((f) => f());
}

export function useLandelijk(): boolean {
  return useSyncExternalStore((f) => { landelijkLuisteraars.add(f); return () => { landelijkLuisteraars.delete(f); }; }, leesLandelijk, () => false);
}

/** ?regio= in de adresbalk wint en wordt meteen de werkregio. */
export function useRegioUitAdres(param: string | null, regios: string[]): string {
  const [werk] = useWerkregio(regios);
  const regio = param && regios.includes(param) ? param : werk;
  useEffect(() => { if (param && regios.includes(param)) zetWerkregio(param); }, [param, regios]);
  return regio;
}
