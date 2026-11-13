'use client';
import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { GeenBedrijfsdata } from '@/components/shell/GeenBedrijfsdata';

/** Inloggen gaat via Microsoft (Entra ID); terug van een mislukte poging staat ?fout=entra in het adres. */
export function LoginFormulier({ omgeving }: { omgeving?: string }) {
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('fout') === 'entra') setFout('Inloggen is niet gelukt. Probeer het opnieuw.');
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
    <GeenBedrijfsdata omgeving={omgeving} />
    <div className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
      <div className="hero hidden flex-col justify-between p-12 lg:flex">
        <div className="merk relative">GRIP <em>Regelplekken</em></div>
        <div className="relative max-w-lg">
          <h1 className="wordmark text-white">Voorspellen, roosteren, <em style={{ color: 'var(--hero-sub)' }}>bijsturen.</em></h1>
          <p className="text-[17px] text-white/75">Per regio zien hoeveel regelplekken nodig zijn, een rooster maken dat dat dekt, het toetsen aan ATW, CAO en het roosterbeleid, en bijsturen als de voorspelling verandert.</p>
        </div>
        <div aria-hidden />
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="display mb-8 text-[26px] font-semibold lg:hidden">GRIP <em className="font-normal text-accent">Regelplekken</em></div>
          <div className="grid gap-4">
            <div>
              <h2 className="kop">Inloggen</h2>
              <p className="note mt-1">Met je werkaccount van Microsoft.</p>
            </div>
            {fout && <div className="banner banner-err" role="alert">{fout}</div>}
            <a className="btn w-full" href="/auth/entra"><LogIn size={17} /> Inloggen met je werkaccount</a>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
