'use client';
import { useMemo } from 'react';
import { useApp } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import { todayIso } from '@/lib/dates';
import { nbdBehoefte } from '@/lib/nbd/behoefte';

/** De gesprekken die de nabestaandendesk vandaag verwacht (met de overlijdens uit de voorspelling), of null. */
export function useNbdVandaag(aan: boolean): { gesprekken: number; factor: number } | null {
  const p = useApp((x) => x.nbd);
  const normen = useApp((x) => x.normen);
  const { laatsteData, basisData, klaar } = useRuns();
  return useMemo(() => {
    if (!aan || !klaar) return null;
    const d = todayIso();
    const dag = nbdBehoefte({ basis: basisData, laatste: laatsteData, norm: normen }, p, [d], 'laatste')[d];
    return dag ? { gesprekken: dag.gesprekken, factor: dag.factor } : null;
  }, [aan, klaar, basisData, laatsteData, normen, p]);
}
