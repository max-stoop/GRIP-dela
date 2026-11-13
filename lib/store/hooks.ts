'use client';
import { useEffect, useMemo, useState } from 'react';
import { getRun, getRunSync, terugtestMorgen, useApp } from './store';
import type { RunData, RunMeta } from '../model/types';
import type { Terugtest } from '../model/terugtest';
import type { Behoefte } from '../rooster/types';
import { behoefteVoor, type ToetsTegen } from './afgeleid';

/** Uit het geheugen of IndexedDB. */
export function useRunData(id: string | null | undefined): RunData | null {
  // de gegevens horen bij een id: na een wissel nooit de vorige tonen onder de nieuwe naam
  const [geladen, setGeladen] = useState<{ id: string; data: RunData | null } | null>(() => (id ? { id, data: getRunSync(id) } : null));
  useEffect(() => {
    let weg = false;
    if (!id) { setGeladen(null); return; }
    const c = getRunSync(id);
    if (c) { setGeladen({ id, data: c }); return; }
    getRun(id).then((d) => { if (!weg) setGeladen({ id, data: d }); }).catch((e) => { console.error('Voorspelling laden mislukt', e); if (!weg) setGeladen({ id, data: null }); });
    return () => { weg = true; };
  }, [id]);
  if (!id) return null;
  return geladen?.id === id ? geladen.data : getRunSync(id);
}

interface Runs {
  laatste: RunMeta | null;
  laatsteData: RunData | null;
  basis: RunMeta | null;
  basisData: RunData | null;
  klaar: boolean;
}

export function useRuns(): Runs {
  const runs = useApp((s) => s.runs);
  const rb = useApp((s) => s.roosterbasis);
  const laatste = runs[0] ?? null;
  const basis = rb ? runs.find((r) => r.id === rb.runId) ?? null : null;
  const laatsteData = useRunData(laatste?.id);
  const basisData = useRunData(basis?.id);
  const klaar = (!laatste || !!laatsteData) && (!basis || !!basisData);
  return { laatste, laatsteData, basis, basisData, klaar };
}

/** undefined zolang hij rekent, null als het niet kan. */
export function useTerugtest(): Terugtest | null | undefined {
  const meldingen = useApp((s) => s.meldingen);
  const extern = useApp((s) => s.extern);
  const handmatig = useApp((s) => s.handmatig);
  const coef = useApp((s) => s.coef);
  const normaal = useApp((s) => s.normaal);
  const [uit, setUit] = useState<{ bron: unknown; t: Terugtest | null } | null>(null);
  useEffect(() => {
    let weg = false;
    terugtestMorgen().then((t) => { if (!weg) setUit({ bron: meldingen, t }); }).catch((e) => { console.error('Terugtest mislukt', e); if (!weg) setUit({ bron: meldingen, t: null }); });
    return () => { weg = true; };
  }, [meldingen, extern, handmatig, coef, normaal]);
  if (!meldingen) return null;
  return uit?.bron === meldingen ? uit.t : undefined;
}

/** Voor de ontwikkeling per doeldatum. */
export function useAlleRuns(): Map<string, RunData> | null {
  const runs = useApp((s) => s.runs);
  const [data, setData] = useState<Map<string, RunData> | null>(null);
  useEffect(() => {
    let weg = false;
    Promise.all(runs.map((m) => getRun(m.id).then((d) => [m.id, d] as const))).then((l) => {
      if (!weg) setData(new Map(l.filter((x): x is readonly [string, RunData] => !!x[1])));
    });
    return () => { weg = true; };
  }, [runs]);
  return data;
}

/** tegen bepaalt waar het begint (roosterbasis of laatste voorspelling); daarna oudere runs en de norm. */
export function useBehoefte(regio: string, dates: string[], tegen: ToetsTegen = 'basis'): { behoefte: Behoefte; klaar: boolean } {
  const { laatsteData, basisData, klaar } = useRuns();
  const normen = useApp((s) => s.normen);
  const alpha = useApp((s) => s.beleid.alphaRegio);
  const verschuivingen = useApp((s) => s.verschuivingen);
  const behoefte = useMemo(
    () => behoefteVoor({ basis: basisData, laatste: laatsteData, norm: normen, verschuivingen }, regio, dates, { alphaRegio: alpha, tegen }),
    [basisData, laatsteData, normen, verschuivingen, regio, dates, alpha, tegen],
  );
  return { behoefte, klaar };
}
