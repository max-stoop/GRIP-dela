'use client';
import { useState } from 'react';
import { Clock, Save, AlertTriangle } from 'lucide-react';
import { useDoor } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Pill } from '@/components/ui';
import { Dienst } from '@/components/ruil/RuilOnderdelen';
import { useApp, zetTijd, zichtbaarRooster } from '@/lib/store/store';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { tijdVan } from '@/lib/rooster/toets';
import { leesUur, openTijden, tijdBevindingen, uurTekst } from '@/lib/rooster/tijden';
import { fmtDag, fmtD, todayIso } from '@/lib/dates';
import type { DienstCode, Medewerker } from '@/lib/rooster/types';

/** Met de toets op ATW (dagduur en rust) erbij. */
export function TijdInvoer({ regio, medewerkerId, datum, code, compact }: { regio: string; medewerkerId: string; datum: string; code: DienstCode; compact?: boolean }) {
  const door = useDoor();
  const actie = useActie();
  const cellen = useApp((x) => zichtbaarRooster(x, regio));
  const tijden = useApp((x) => x.tijden[regio]);
  const beleid = useApp((x) => x.beleid);
  const huidig = tijdVan(code, tijden?.[medewerkerId]?.[datum]);
  const [start, setStart] = useState(huidig ? uurTekst(huidig.start) : '9:00');
  const [eind, setEind] = useState(huidig ? uurTekst(huidig.eind) : '17:00');
  const s = leesUur(start), e = leesUur(eind);
  const bevindingen = s != null && e != null ? tijdBevindingen(cellen, tijden, medewerkerId, datum, { start: s, eind: e }, beleid) : ['Vul tijden in als 9:00.'];
  const hard = bevindingen.some((b) => b.includes('ATW') || b.includes('na de begintijd'));
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="label"><span>{compact ? 'Van' : 'Begintijd'}</span><input className="input w-[78px]" inputMode="numeric" value={start} onChange={(x) => setStart(x.target.value)} aria-label="Begintijd" /></label>
        <label className="label"><span>{compact ? 'Tot' : 'Eindtijd'}</span><input className="input w-[78px]" inputMode="numeric" value={eind} onChange={(x) => setEind(x.target.value)} aria-label="Eindtijd" /></label>
        <button type="button" className="btn btn-sm" disabled={hard || s == null || e == null} onClick={() => actie(() => zetTijd(regio, medewerkerId, datum, { start: s!, eind: e! }, door), `Tijden ${fmtD(datum)} vastgelegd: ${start}–${eind}.`)}><Save size={15} /> Vastleggen</button>
        {s != null && e != null && e > s && <span className="note">{(e - s).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} uur{code === 'DG1' || code === 'DG2' ? `, gepland ${DIENSTEN[code].uren}` : ''}</span>}
      </div>
      {bevindingen.length > 0 && <ul className="grid gap-0.5">{bevindingen.map((b) => <li key={b} className="flex items-center gap-1.5 text-[13px] text-gold"><AlertTriangle size={13} /> {b}</li>)}</ul>}
    </div>
  );
}

/** ATW: 4 dagen vooraf bekend. */
export function OpenTijden({ regio, team }: { regio: string; team: Medewerker[] }) {
  const cellen = useApp((x) => x.rooster[regio]) ?? {};
  const tijden = useApp((x) => x.tijden[regio]);
  const beleid = useApp((x) => x.beleid);
  const [open, setOpen] = useState<string | null>(null);
  const lijst = openTijden(team, cellen, tijden, todayIso(), beleid);
  const naam = Object.fromEntries(team.map((m) => [m.id, m.naam]));
  if (!lijst.length) return <p className="flex items-center gap-2 text-[15px]"><Clock size={17} className="text-teal" /> Alle Dg-diensten in de komende {beleid.tijdenDagen + 7} dagen hebben vaste tijden.</p>;
  return (
    <ul className="grid gap-2">
      {lijst.map((o) => {
        const k = `${o.medewerkerId}|${o.datum}`;
        return (
          <li key={k} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-2 text-[14.5px]">
              <b className="w-[80px]">{fmtDag(o.datum)}</b>
              <Dienst code={o.code} klein />
              <span className="min-w-[140px] flex-1">{naam[o.medewerkerId]}</span>
              {o.teLaat ? <Pill soort="bad">te laat, binnen {beleid.tijdenDagen} dagen</Pill> : <Pill soort="warn">uiterlijk {fmtD(o.uiterlijk)}</Pill>}
              {open !== k && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(k)}><Clock size={14} /> Tijden vastleggen</button>}
            </div>
            {open === k && <div className="mt-2"><TijdInvoer regio={regio} medewerkerId={o.medewerkerId} datum={o.datum} code={o.code} compact /></div>}
          </li>
        );
      })}
    </ul>
  );
}
