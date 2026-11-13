'use client';
import { Suspense } from 'react';
import { Laden } from '@/components/ui';
import { NbdRooster } from '@/components/nbd/NbdRooster';

export default function NbdRoosterPagina() {
  return <Suspense fallback={<Laden />}><NbdRooster /></Suspense>;
}
