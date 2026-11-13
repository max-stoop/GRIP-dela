'use client';
import type { ReactNode } from 'react';
import { useSessie } from '@/components/sessie';
import { GeenToegang } from '@/components/ui';

/** De module van de nabestaandendesk: alleen voor planners, regiomanagers en de beheerder die bij de NBD horen. */
export default function NbdLayout({ children }: { children: ReactNode }) {
  const s = useSessie();
  if (!s.isPlanner || !s.nbd) return <GeenToegang />;
  return <>{children}</>;
}
