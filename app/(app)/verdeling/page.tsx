'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSessie } from '@/components/sessie';
import { GeenToegang, Laden, PaginaKop, Segment } from '@/components/ui';
import { NaarNbd } from '@/components/nbd/NaarNbd';
import { Verdelen } from '@/components/verdeling/Verdelen';
import { Simulatie } from '@/components/verdeling/Simulatie';

type Weergave = 'verdelen' | 'simulatie';

export default function VerdelingPagina() {
  return <Suspense fallback={<Laden />}><NaarNbd naar="/nbd"><Pagina /></NaarNbd></Suspense>;
}

/** De laatste stap van de keten: na voorspellen, rooster en bijsturen de meldingen van de dag verdelen. */
function Pagina() {
  const s = useSessie();
  const router = useRouter();
  const params = useSearchParams();
  const weergave: Weergave = params.get('weergave') === 'simulatie' ? 'simulatie' : 'verdelen';
  if (!s.isPlanner) return <GeenToegang />;
  return (
    <>
      <PaginaKop
        boven="Stap 4 · na voorspellen, rooster en bijsturen"
        titel={<>Meldingen <em>verdelen</em></>}
        lead="Om 07:00 alle meldingen van de dag in één keer naar de juiste uitvaartverzorgers: op reistijd, werkdruk en de plekken in de eigen regio en het cluster. Gesprekken om 10:00 of 13:00. Daarna zie je per cluster hoe groot de kans nog is dat de 1B valt."
      >
        <Segment<Weergave> label="Weergave" waarde={weergave} onChange={(w) => router.replace(w === 'simulatie' ? '/verdeling?weergave=simulatie' : '/verdeling', { scroll: false })} opties={[['verdelen', 'Verdelen'], ['simulatie', 'Simulatie']]} />
      </PaginaKop>
      {weergave === 'verdelen' ? <Verdelen /> : <Simulatie />}
    </>
  );
}
