'use client';
import { Lock } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { ROL_LABEL } from '@/lib/store/types';

/** Waar een knop ontbreekt omdat alleen een bepaalde rol dit doet; wie mag wisselen, kan meteen overstappen. */
export function AlleenVoor({ rol, wat, paragraaf = '5.1' }: { rol: 'planner' | 'regiomanager'; wat: string; paragraaf?: string }) {
  const s = useSessie();
  const naam = ROL_LABEL[rol].toLowerCase();
  return (
    <span className="note inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Lock size={13} className="shrink-0" aria-hidden />
      <span>{wat} doet de {naam} (§ {paragraaf}).</span>
      {s.wisselRollen.includes(rol) && (
        <button type="button" className="font-semibold text-accent hover:underline" onClick={() => s.bekijkAls(rol)}>Bekijk als {naam}</button>
      )}
    </span>
  );
}

export function AlleenRegiomanager({ wat, paragraaf }: { wat: string; paragraaf?: string }) {
  return <AlleenVoor rol="regiomanager" wat={wat} paragraaf={paragraaf} />;
}
