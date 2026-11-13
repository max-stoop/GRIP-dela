'use client';
import { useState } from 'react';
import { LogOut, ShieldAlert } from 'lucide-react';
import { afmelden } from '@/lib/auth/afmelden';
import { Spinner } from '@/components/ui';

/** Ingelogd, maar dit account staat niet in de gebruikerslijst van GRIP, of is regiomanager zonder regio's. */
export function GeenToegang({ email, reden }: { email: string; reden?: 'geen_regios' }) {
  const [bezig, setBezig] = useState(false);
  const uitloggen = async () => {
    setBezig(true);
    await afmelden();
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="box w-full max-w-md">
        <h1 className="kop flex items-center gap-2"><ShieldAlert size={22} className="text-gold" /> Geen toegang</h1>
        {reden === 'geen_regios' ? <>
          <p className="mt-3 text-[15px]">Je bent ingelogd{email ? <> als <b>{email}</b></> : ''} als regiomanager, maar er zijn nog geen regio&apos;s aan je account gekoppeld.</p>
          <p className="note mt-2">Vraag de beheerder om je regio&apos;s in te stellen (Instellingen, Gebruikers). Daarna log je opnieuw in.</p>
        </> : <>
          <p className="mt-3 text-[15px]">Je bent ingelogd{email ? <> als <b>{email}</b></> : ''}, maar dit account heeft nog geen toegang tot GRIP.</p>
          <p className="note mt-2">Vraag de beheerder om je toe te voegen, met je rol en je regio&apos;s. Daarna log je opnieuw in.</p>
        </>}
        <button type="button" className="btn mt-5 w-full" onClick={uitloggen} disabled={bezig}>{bezig ? <Spinner /> : <LogOut size={17} />} Uitloggen</button>
      </div>
    </main>
  );
}
