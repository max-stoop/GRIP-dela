'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessie } from '@/components/sessie';
import { Laden } from '@/components/ui';

/** Startpagina: planners naar het dashboard (wie alleen de NBD doet: naar de nabestaandendesk), medewerkers naar hun eigen rooster. */
export default function Start() {
  const s = useSessie();
  const router = useRouter();
  const alleenNbd = s.nbd && !s.regios.length;
  useEffect(() => {
    router.replace(s.rol === 'medewerker' ? '/mijn-rooster' : alleenNbd ? '/nbd' : '/dashboard');
  }, [s.rol, alleenNbd, router]);
  return <Laden />;
}
