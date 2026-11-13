'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import { Modal, Veld } from '@/components/ui';
import { useActie } from '@/components/toast';
import { useDoor } from '@/components/sessie';
import { useApp, verwijderVerschuiving, voegVerschuivingToe } from '@/lib/store/store';
import { fmtD, todayIso } from '@/lib/dates';
import { plural } from '@/lib/format';
import type { Verschuiving } from '@/lib/store/types';

/** De afspraken die een regio in een periode raken, voor een melding boven het rooster. */
export function verschuivingenVoor(lijst: Verschuiving[], regio: string, van: string, tot: string): Verschuiving[] {
  return lijst.filter((v) => (v.vanRegio === regio || v.naarRegio === regio) && v.van <= tot && v.tot >= van).sort((a, b) => a.van.localeCompare(b.van));
}

export function verschuivingTekst(v: Verschuiving, regio?: string): string {
  const periode = v.van === v.tot ? `op ${fmtD(v.van)}` : `${fmtD(v.van)} t/m ${fmtD(v.tot)}`;
  const n = plural(v.plekken, 'regelplek', 'regelplekken');
  if (regio === v.vanRegio) return `${v.naarRegio} doet ${n} van ${v.vanRegio}, ${periode}`;
  if (regio === v.naarRegio) return `${v.naarRegio} doet ${n} voor ${v.vanRegio}, ${periode}`;
  return `${n} van ${v.vanRegio} naar ${v.naarRegio}, ${periode}`;
}

/**
 * Regelplekken verschuiven binnen het cluster: heeft de ene regio te weinig mensen en de andere te veel, dan doet de
 * een zoveel plekken minder en de ander zoveel meer. De toets en Rooster maken rekenen met de nieuwe aantallen.
 */
export function Verschuiven({ open, onClose, regio, clusterNaam, clusterRegios, mag, standaardVan, standaardTot }: {
  open: boolean;
  onClose: () => void;
  regio: string;
  clusterNaam: string;
  clusterRegios: string[];
  /** Een verschuiving vastleggen of weghalen mag wie in beide regio's plant. */
  mag: (van: string, naar: string) => boolean;
  standaardVan: string;
  standaardTot: string;
}) {
  const actie = useActie();
  const door = useDoor();
  const vandaag = todayIso();
  const alle = useApp((x) => x.verschuivingen);
  const lopend = alle.filter((v) => v.tot >= vandaag && (clusterRegios.includes(v.vanRegio) || clusterRegios.includes(v.naarRegio))).sort((a, b) => a.van.localeCompare(b.van));
  const anderen = clusterRegios.filter((r) => r !== regio);
  const [f, setF] = useState({ vanRegio: regio, naarRegio: anderen[0] ?? '', plekken: 1, van: standaardVan, tot: standaardTot, opmerking: '' });
  useEffect(() => {
    if (open) setF({ vanRegio: regio, naarRegio: anderen[0] ?? '', plekken: 1, van: standaardVan < vandaag ? vandaag : standaardVan, tot: standaardTot, opmerking: '' });
  }, [open, regio, standaardVan, standaardTot]); // eslint-disable-line react-hooks/exhaustive-deps
  const geldig = f.vanRegio !== f.naarRegio && f.van <= f.tot && f.van >= vandaag && mag(f.vanRegio, f.naarRegio);

  return (
    <Modal open={open} onClose={onClose} breed titel={`Regelplekken verschuiven in cluster ${clusterNaam}`} voet={
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Sluiten</button>
        <button type="submit" form="verschuif-form" className="btn btn-teal" disabled={!geldig}>Vastleggen</button>
      </>
    }>
      <div className="grid gap-5">
        <p className="m-0 text-[14.5px]">
          Heeft de ene regio te weinig mensen en de andere te veel? Leg vast dat de een zoveel regelplekken minder doet en de ander zoveel meer. Het rooster, de toets en Rooster maken rekenen dan met de nieuwe aantallen, en de regio die minder doet, staat niet meer onterecht op tekort. In het cluster blijft het totaal gelijk.
        </p>
        <form id="verschuif-form" className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]" onSubmit={(e) => {
          e.preventDefault();
          if (!geldig) return;
          actie(() => { const v = voegVerschuivingToe({ ...f, door }); onClose(); return v; }, (v) => `Vastgelegd: ${verschuivingTekst(v)}.`);
        }}>
          <Veld label="Minder plekken in">
            <select className="input" value={f.vanRegio} onChange={(e) => { const vanRegio = e.target.value; setF((x) => ({ ...x, vanRegio, naarRegio: x.naarRegio === vanRegio ? clusterRegios.find((r) => r !== vanRegio) ?? '' : x.naarRegio })); }}>
              {clusterRegios.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Veld>
          <div className="hidden items-end pb-3 sm:flex"><ArrowRight size={18} className="text-muted" /></div>
          <Veld label="Meer plekken in">
            <select className="input" value={f.naarRegio} onChange={(e) => { const naarRegio = e.target.value; setF((x) => ({ ...x, naarRegio })); }}>
              {clusterRegios.filter((r) => r !== f.vanRegio).map((r) => <option key={r}>{r}</option>)}
            </select>
          </Veld>
          <Veld label="Regelplekken per dag">
            <select className="input" value={f.plekken} onChange={(e) => { const plekken = Number(e.target.value); setF((x) => ({ ...x, plekken })); }}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Veld>
          <div className="hidden sm:block" />
          <div className="grid grid-cols-2 gap-3">
            <Veld label="Van"><input className="input" type="date" min={vandaag} value={f.van} onChange={(e) => { const van = e.target.value; setF((x) => ({ ...x, van })); }} /></Veld>
            <Veld label="Tot en met"><input className="input" type="date" min={f.van} value={f.tot} onChange={(e) => { const tot = e.target.value; setF((x) => ({ ...x, tot })); }} /></Veld>
          </div>
          <Veld label="Toelichting (optioneel)" className="sm:col-span-3">
            <input className="input" maxLength={200} value={f.opmerking} onChange={(e) => { const opmerking = e.target.value; setF((x) => ({ ...x, opmerking })); }} placeholder="Bijvoorbeeld: twee collega's langdurig ziek" />
          </Veld>
          {!mag(f.vanRegio, f.naarRegio) && <p className="note m-0 sm:col-span-3">Alleen wie in beide regio&apos;s plant, legt dit vast.</p>}
        </form>

        <div>
          <div className="mb-2 font-semibold">Afspraken in het cluster</div>
          {lopend.length ? (
            <ul className="grid gap-1.5">
              {lopend.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-[14.5px]">
                  <span className="flex-1">{verschuivingTekst(v)}{v.opmerking ? <span className="note"> · {v.opmerking}</span> : null}<span className="note"> · {v.door}</span></span>
                  {mag(v.vanRegio, v.naarRegio) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => verwijderVerschuiving(v.id, door), 'Afspraak weggehaald.')} aria-label={`Weghalen: ${verschuivingTekst(v)}`}><Trash2 size={15} /> Weghalen</button>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="note m-0">Nog geen afspraken die lopen of nog komen.</p>}
        </div>
      </div>
    </Modal>
  );
}
