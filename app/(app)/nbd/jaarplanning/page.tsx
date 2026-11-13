'use client';
import { Suspense } from 'react';
import { Laden } from '@/components/ui';
import { Jaarplanning } from '@/components/verlof/Jaarplanning';

export default function NbdJaarplanningPagina() {
  return <Suspense fallback={<Laden />}><Jaarplanning nbd /></Suspense>;
}
