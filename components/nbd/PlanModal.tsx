'use client';
import { useEffect, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Modal, Segment, Spinner, Stat, Veld } from '@/components/ui';
import { fmtD } from '@/lib/dates';
import { isoRange } from '@/lib/dates';
import { voorstelBasis } from '@/lib/rooster/vingerafdruk';
import type { Cellen, Medewerker, Tijden, Voorkeurprofiel, Wens } from '@/lib/rooster/types';
import type { Verlof } from '@/lib/store/types';
import type { NbdDag } from '@/lib/nbd/behoefte';
import type { NbdParameters } from '@/lib/nbd/parameters';
import { behoudTaken, klachtenStandaard, planTaken, trainingStandaard } from '@/lib/nbd/taken';
import { nbdNa, samen } from '@/lib/nbd/ruil';
import { toetsNbd, type NbdToets } from '@/lib/nbd/toets';
import { maakNbdRooster, type NbdWijziging } from '@/lib/nbd/voorstel';
import { nl, pct, plural } from '@/lib/format';

type Modus = 'aanvullen' | 'opnieuw';

export function NbdPlanModal({ open, onClose, team, cellen, tijden, behoefteVan, p, profielen, wensen, aanvragen, minVrijeWeekenden, standaardVan, standaardTot, huidig, onToepassen }: {
  open: boolean;
  onClose: () => void;
  team: Medewerker[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  behoefteVan: (dates: string[]) => Record<string, NbdDag>;
  p: NbdParameters;
  profielen: Record<string, Voorkeurprofiel>;
  wensen: Wens[];
  aanvragen: Verlof[];
  minVrijeWeekenden: number;
  standaardVan: string;
  standaardTot: string;
  huidig: NbdToets;
  onToepassen: (w: NbdWijziging[], omschrijving: string) => void;
}) {
  const [van, setVan] = useState(standaardVan);
  const [tot, setTot] = useState(standaardTot);
  const [modus, setModus] = useState<Modus>('opnieuw');
  const [contract, setContract] = useState(p.aanvullenTotContract);
  const [taken, setTaken] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [uitkomst, setUitkomst] = useState<{ w: NbdWijziging[]; t: NbdToets; diensten: number; uren: number; mee: number; kwijt: number; maandstartKwijt: number; basis: string } | null>(null);
  const [verouderd, setVerouderd] = useState(false);
  useEffect(() => { if (open) { setVan(standaardVan); setTot(standaardTot); setUitkomst(null); setVerouderd(false); setContract(p.aanvullenTotContract); } }, [open, standaardVan, standaardTot, p.aanvullenTotContract]);
  /** Is dat bij toepassen anders, dan is de uitkomst verouderd. */
  const huidigeBasis = (dates: string[]) => voorstelBasis({ team, dates, cellen, overig: [tijden ?? null, team.map((m) => profielen[m.id] ?? null), wensen.filter((w) => w.datum >= van && w.datum <= tot), aanvragen, behoefteVan(dates), p, modus, contract, taken, minVrijeWeekenden] });
  useEffect(() => { setUitkomst(null); }, [van, tot, modus, contract, taken]);

  const bereken = () => {
    setBezig(true);
    // even de spinner laten zien; het rekenen duurt hooguit een paar seconden
    setTimeout(() => {
      try {
        const dates = isoRange(van, tot);
        const behoefte = behoefteVan(dates);
        const v = maakNbdRooster({ team, dates, cellen, tijden, behoefte, p, profielen, wensen, aanvragen, modus, minVrijeWeekenden, totContract: contract });
        let na = nbdNa(cellen, tijden, v.wijzigingen);
        // de taken van de oude diensten gaan mee waar ze passen (de maandstart zo nodig naar een ander moment)
        const b = behoudTaken({ team, dates, oudCellen: cellen, oudTijden: tijden, cellen: na.cellen, tijden: na.tijden });
        na = nbdNa(na.cellen, na.tijden, b.wijzigingen);
        let w = samen(v.wijzigingen, b.wijzigingen);
        // daarna meteen de training (en de klachten, als de capaciteitsplanning daar uren voor heeft) op de rustigste momenten
        if (taken) {
          const k = planTaken({ team, dates, cellen: na.cellen, tijden: na.tijden, behoefte, p, training: trainingStandaard(p), klachten: p.klachten > 0 ? klachtenStandaard(p) : null });
          na = nbdNa(na.cellen, na.tijden, k.wijzigingen);
          w = samen(w, k.wijzigingen);
        }
        const kwijt = b.kwijt.filter((x) => x.taak.soort === 'maandstart' || !taken);
        setVerouderd(false);
        setUitkomst({ basis: huidigeBasis(dates), w, t: toetsNbd({ team, dates, cellen: na.cellen, tijden: na.tijden, behoefte, p, profielen, wensen, aanvragen, minVrijeWeekenden }), diensten: v.diensten, uren: v.uren, mee: b.mee, kwijt: kwijt.length, maandstartKwijt: new Set(kwijt.filter((x) => x.taak.soort === 'maandstart').map((x) => x.mid)).size });
      } finally {
        setBezig(false);
      }
    }, 30);
  };

  return (
    <Modal open={open} onClose={onClose} breed titel="NBD-rooster maken" voet={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
      {uitkomst
        ? <button type="button" className="btn btn-teal" disabled={!uitkomst.w.length} onClick={() => {
          // vlak voor toepassen: is alles nog zoals toen het rooster werd berekend?
          if (huidigeBasis(isoRange(van, tot)) !== uitkomst.basis) { setUitkomst(null); setVerouderd(true); return; }
          onToepassen(uitkomst.w, `${plural(uitkomst.diensten, 'dienst', 'diensten')}, verwacht service level ${pct(uitkomst.t.sl, 1)}`);
        }}><Wand2 size={16} /> Toepassen</button>
        : <button type="button" className="btn btn-teal" disabled={bezig || van > tot || !team.length} onClick={bereken}>{bezig ? <Spinner /> : <Wand2 size={16} />} Rooster maken</button>}
    </>}>
      {verouderd && (
        <div className="banner mb-4 text-[15px]" role="alert">
          Het rooster of de gegevens zijn intussen gewijzigd (bijvoorbeeld door een collega, of verlof dat is goedgekeurd). Het berekende rooster paste daar niet meer bij en is niet toegepast. Maak het opnieuw.
        </div>
      )}
      <p className="lead">GRIP zet per dag, van 7:00 tot 22:30, diensten neer waar Erlang C per uur meer mensen vraagt dan er staan: van {nl(p.minDienst)} tot {nl(p.maxDienst)} uur werk, met de pauze erbij. Wie er komt, volgt uit de voorkeuren per uur (nooit op uren die niet kunnen, liefst in de graag-uren), de wensen, de contracturen (boven het contract alleen tot de maximale inzet, als het anders niet lukt) en de regels van de ATW en CAO ({nl(p.minRust)} uur rust, {p.weekRust} uur weekrust, hoogstens {p.maxWeekUren} uur per week, vrije weekenden) en de teamafspraak van hoogstens {p.maxAchtereen} dagen achter elkaar.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Veld label="Van"><input className="input" type="date" value={van} min={standaardVan} onChange={(e) => setVan(e.target.value)} /></Veld>
        <Veld label="Tot en met"><input className="input" type="date" value={tot} min={van} onChange={(e) => setTot(e.target.value)} /></Veld>
        <div className="label sm:col-span-2">
          <span>Wat gebeurt er met wat er al staat?</span>
          <Segment label="Bestaande diensten" waarde={modus} onChange={setModus} opties={[['opnieuw', 'Opnieuw plannen'], ['aanvullen', 'Alleen aanvullen']]} />
          <span className="note">{modus === 'opnieuw' ? 'Diensten in de periode worden opnieuw gepland. Training, klachten en de maandstart gaan mee naar de nieuwe dienst als ze daar passen; verlof en ziekte blijven staan.' : 'Wat er staat blijft staan; alleen waar te weinig mensen zijn, komt er iets bij.'}</span>
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={taken} onChange={(e) => setTaken(e.target.checked)} />
          <span>Training meteen inplannen <span className="note block">{nl(p.training)} uur per medewerker per week{p.klachten > 0 ? `, en ${nl(p.klachten)} uur klachten per week` : ''}, op de rustigste momenten in de diensten (zoals de capaciteitsplanning). De maandstart plan je daarna bij Taken.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={contract} onChange={(e) => setContract(e.target.checked)} />
          <span>Aanvullen tot de contracturen <span className="note block">Wie daarna nog uren over heeft, komt erbij op de drukste momenten. Dat geeft een hoger service level dan Erlang vraagt.</span></span>
        </label>
      </div>
      {uitkomst && (
        <div className="mt-4 rounded-lg bg-soft p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat waarde={nl(uitkomst.t.cijfer)} label="Cijfer" sub={`nu ${nl(huidig.cijfer)}`} />
            <Stat waarde={pct(uitkomst.t.sl, 1)} label="Service level" sub={`doel ${pct(p.serviceLevel)}`} toon={uitkomst.t.sl >= p.serviceLevel ? 'teal' : 'rood'} />
            <Stat waarde={uitkomst.diensten} label="Diensten" sub={`${nl(uitkomst.uren, 0)} uur werk`} />
            <Stat waarde={uitkomst.t.hard} label="ATW en CAO" sub={uitkomst.t.hard ? 'overtredingen' : 'geen overtredingen'} toon={uitkomst.t.hard ? 'rood' : 'teal'} />
          </div>
          <p className="note mt-2">{uitkomst.w.length ? `${plural(uitkomst.w.length, 'vakje verandert', 'vakjes veranderen')} van ${fmtD(van)} t/m ${fmtD(tot)}. Daarna kun je alles nog met de hand aanpassen of ongedaan maken.` : 'Er verandert niets: het rooster dekt de behoefte al.'}{uitkomst.mee ? ` ${plural(uitkomst.mee, 'taak gaat', 'taken gaan')} mee naar de nieuwe diensten.` : ''}</p>
          {uitkomst.maandstartKwijt > 0 && <p className="banner mt-2">{plural(uitkomst.maandstartKwijt, 'medewerker past', 'medewerkers passen')} niet meer in een maandstartgroep. Zoek bij Taken opnieuw de beste tijd voor hen.</p>}
        </div>
      )}
    </Modal>
  );
}
