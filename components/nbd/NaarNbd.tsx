'use client';
import { useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSessie } from '@/components/sessie';
import { Laden } from '@/components/ui';
import { NBD } from '@/lib/nbd/parameters';

/** Een oude link met ?regio=NBD, of een planner die alleen bij de NBD hoort: door naar de module van de NBD. */
export function NaarNbd({ naar, children }: { naar: string; children: ReactNode }) {
  const s = useSessie();
  const params = useSearchParams();
  const router = useRouter();
  const door = s.isPlanner && (params.get('regio') === NBD || (s.nbd && !s.regios.length));
  useEffect(() => { if (door) router.replace(naar); }, [door, naar, router]);
  return door ? <Laden /> : <>{children}</>;
}
