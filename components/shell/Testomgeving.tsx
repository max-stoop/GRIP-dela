'use client';
import { useState } from 'react';
import { FlaskConical, LogOut, RotateCcw, Sparkles } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Modal } from '@/components/ui';
import { laadDemo, startTest, stopTest, testOpnieuw, useOpslagwijze, useTaak } from '@/lib/store/store';

/** Een kopie van alle gegevens om te zien hoe een rooster werkt; er gaat niets naar de gedeelde database. */
export function TestBalk() {
  const s = useSessie();
  const opslag = useOpslagwijze();
  const actie = useActie();
  const taak = useTaak();
  const [vraag, setVraag] = useState<null | 'start' | 'stop'>(null);
  const [bezig, setBezig] = useState(false);
  const doe = (fn: () => Promise<void>, klaar: string) => {
    setBezig(true);
    actie(async () => { try { await fn(); } finally { setBezig(false); setVraag(null); } }, klaar);
  };

  if (opslag !== 'test') {
    // wie plant (of beheert) kan testen; een medewerker niet
    if (s.echt.rol === 'medewerker') return null;
    return (
      <div className="geen-print flex justify-end px-4 pt-3 sm:px-6 lg:px-8">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVraag('start')} title="Alles uitproberen in een kopie van de gegevens; er wordt niets opgeslagen">
          <FlaskConical size={15} /> Test
        </button>
        <Modal open={vraag === 'start'} onClose={() => setVraag(null)} titel="Testomgeving starten?" voet={<>
          <button type="button" className="btn btn-ghost" onClick={() => setVraag(null)}>Annuleren</button>
          <button type="button" className="btn" disabled={bezig || !!taak} onClick={() => doe(startTest, 'Je zit in de testomgeving. Niets wordt opgeslagen in de gedeelde database.')}><FlaskConical size={16} /> Starten</button>
        </>}>
          <p>Je krijgt een kopie van alle gegevens: alle regio&apos;s en de nabestaandendesk. Probeer alles uit: een rooster maken, bijsturen, verlof en ruilen, taken inplannen, advies geven, goedkeuren en publiceren. Met Bekijk als (in het menu linksonder) zie je het ook als regiomanager of medewerker.</p>
          <p className="mt-3">Alles blijft in deze browser. {opslag === 'database' ? 'Er gaat niets naar de gedeelde database en collega’s zien er niets van.' : 'Je eigen gegevens in deze browser blijven zoals ze zijn.'} Met <b>Terug naar echt</b> gooi je de test weg.</p>
        </Modal>
      </div>
    );
  }

  return (
    <div className="testbalk geen-print z-30 lg:sticky lg:top-0" role="status">
      <div className="mx-auto flex max-w-app flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <span className="flex w-full min-w-0 items-start gap-2 text-[14px] sm:w-auto sm:flex-1"><FlaskConical size={18} className="mt-0.5 shrink-0" /><span><b>Testomgeving.</b> Je werkt in een kopie; niets wordt opgeslagen in de gedeelde database.</span></span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={bezig || !!taak} onClick={() => doe(testOpnieuw, 'Opnieuw begonnen met een kopie van de echte gegevens.')}><RotateCcw size={15} /> Opnieuw beginnen</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={bezig || !!taak} onClick={() => doe(laadDemo, 'Demo geladen in de testomgeving: alle regio’s en de NBD.')}><Sparkles size={15} /> Demo laden</button>
        <button type="button" className="btn btn-sm" disabled={bezig || !!taak} title={taak ? `Wacht tot ${taak.naam.toLowerCase()} klaar is` : undefined} onClick={() => setVraag('stop')}><LogOut size={15} /> Terug naar echt</button>
      </div>
      <Modal open={vraag === 'stop'} onClose={() => setVraag(null)} titel="Terug naar de echte gegevens?" voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setVraag(null)}>In de test blijven</button>
        <button type="button" className="btn" disabled={bezig || !!taak} onClick={() => doe(stopTest, 'Terug bij de echte gegevens. De test is weggegooid.')}><LogOut size={16} /> Terug naar echt</button>
      </>}>
        <p>Alles wat je in de test hebt gedaan, wordt weggegooid. De echte gegevens zijn niet veranderd.</p>
      </Modal>
    </div>
  );
}
