'use client';
import { Suspense } from 'react';
import { Laden } from '@/components/ui';
import { NaarNbd } from '@/components/nbd/NaarNbd';
import { TeamOverzicht } from '@/components/team/TeamOverzicht';

/** Het team van een regio. De nabestaandendesk heeft een eigen module (/nbd/team). */
export default function TeamPagina() {
  return <Suspense fallback={<Laden />}><NaarNbd naar="/nbd/team"><TeamOverzicht /></NaarNbd></Suspense>;
}
