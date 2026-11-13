'use client';
/**
 * Invoer die blijft staan tot je opslaat. Bijlezen geeft de opgeslagen gegevens nieuwe objecten, ook als er voor dit
 * formulier niets veranderde; alleen als de inhoud echt verandert en je zelf niets wijzigde, neemt de invoer die over.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Dezelfde inhoud geeft altijd dezelfde tekst, hoe het object ook is gemaakt. */
export function vasteJson(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, w]) => w !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v));
}

export function useConcept<T>(bron: T, sleutel: (x: T) => string = vasteJson) {
  const [waarde, setWaarde] = useState<T>(bron);
  const [versie, setVersie] = useState(0);
  const nu = sleutel(bron);
  const basis = useRef(nu);
  const laatst = useRef({ bron, waarde, sleutel });
  laatst.current = { bron, waarde, sleutel };
  useEffect(() => {
    if (nu === basis.current) return;
    const vorige = basis.current;
    basis.current = nu;
    const { bron: b, waarde: w, sleutel: s } = laatst.current;
    if (s(w) === vorige) {
      setWaarde(b);
      setVersie((v) => v + 1);
    }
  }, [nu]);
  const zet = useCallback((x: T | ((v: T) => T)) => setWaarde(x), []);
  return { waarde, zet, gewijzigd: sleutel(waarde) !== nu, versie };
}
