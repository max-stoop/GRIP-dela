'use client';
import { Suspense } from 'react';
import { Laden } from '@/components/ui';
import { NbdVerlof } from '@/components/nbd/NbdVerlof';

export default function NbdVerlofPagina() {
  return <Suspense fallback={<Laden />}><NbdVerlof /></Suspense>;
}
