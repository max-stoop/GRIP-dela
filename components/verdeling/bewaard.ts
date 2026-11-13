'use client';
import { useCallback, useEffect, useState } from 'react';

/** Per kijker bewaard in deze browser (gewichten en instellingen); werkt ook zonder opslag. */
export function useBewaard<T>(sleutel: string, start: T): [T, (v: T) => void, boolean] {
  const [w, setW] = useState<T>(start);
  const [geladen, setGeladen] = useState(false);
  useEffect(() => {
    try {
      const r = localStorage.getItem(sleutel);
      if (r) setW(JSON.parse(r) as T);
    } catch { /* geen opslag: standaard */ }
    setGeladen(true);
  }, [sleutel]);
  const zet = useCallback((v: T) => {
    setW(v);
    try { localStorage.setItem(sleutel, JSON.stringify(v)); } catch { /* geen opslag */ }
  }, [sleutel]);
  return [w, zet, geladen];
}
