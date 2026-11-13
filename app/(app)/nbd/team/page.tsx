'use client';
import { Suspense } from 'react';
import { Laden } from '@/components/ui';
import { TeamOverzicht } from '@/components/team/TeamOverzicht';

export default function NbdTeamPagina() {
  return <Suspense fallback={<Laden />}><TeamOverzicht nbd /></Suspense>;
}
