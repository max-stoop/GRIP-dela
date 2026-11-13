'use client';
import { Suspense } from 'react';
import { GeenToegang, Laden } from '@/components/ui';
import { useSessie } from '@/components/sessie';
import { RuilenPlanner } from '@/components/ruil/RuilenPlanner';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';

export default function NbdRuilenPagina() {
  const s = useSessie();
  if (!s.isPlanner) return <GeenToegang />;
  return <Suspense fallback={<Laden />}><RuilenPlanner regios={[NBD]} boven={<>{NBD_NAAM} · landelijk</>} titel={<>Ruilen <em>NBD</em></>} /></Suspense>;
}
