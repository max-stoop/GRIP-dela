'use client';
import { Suspense } from 'react';
import { Laden } from '@/components/ui';
import { NaarNbd } from '@/components/nbd/NaarNbd';
import { Jaarplanning } from '@/components/verlof/Jaarplanning';

/** De jaarplanning van het verlof in de regio's. De nabestaandendesk heeft die in de eigen module (/nbd/jaarplanning). */
export default function JaarplanningPagina() {
  return <Suspense fallback={<Laden />}><NaarNbd naar="/nbd/jaarplanning"><Jaarplanning /></NaarNbd></Suspense>;
}
