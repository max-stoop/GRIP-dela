'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Modal, Veld } from '@/components/ui';
import { fmtDag } from '@/lib/dates';
import { uurTekst } from '@/lib/rooster/tijden';
import type { DienstCode, Medewerker, Taak, TaakSoort } from '@/lib/rooster/types';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { dagdeel, DAGDEEL_LABEL, kwartier, netto, pastTaak, pauzeBegin, pauzeNodig, TAAK_LABEL, TAAK_SOORTEN, takenMeldingen, type NbdDienst } from '@/lib/nbd/dienst';
import { NBD_OPEN, NBD_SLUIT, type NbdParameters } from '@/lib/nbd/parameters';
import { nl, nlUren } from '@/lib/format';

/** De diensten van de regio's (1, 1M, 2, Dg) horen niet bij de NBD. */
const NBD_PALET: DienstCode[] = ['N', 'V', '-'];

/** Op een kwartier, binnen de openingstijden. */
const UREN = Array.from({ length: (NBD_SLUIT - NBD_OPEN) * 4 + 1 }, (_, i) => NBD_OPEN + i / 4);

export function DienstModal({ open, medewerker, datum, code, dienst, p, onClose, onBewaar }: {
  open: boolean;
  medewerker: Medewerker | null;
  datum: string;
  code: DienstCode;
  dienst: NbdDienst | null;
  p: NbdParameters;
  onClose: () => void;
  onBewaar: (code: DienstCode, dienst: NbdDienst | null) => void;
}) {
  const [soort, setSoort] = useState<DienstCode>('N');
  const [start, setStart] = useState(9);
  const [eind, setEind] = useState(17.5);
  const [pauze, setPauze] = useState(30);
  const [pb, setPb] = useState<number | null>(null);
  const [taken, setTaken] = useState<Taak[]>([]);
  // bij openen (of een ander vakje) de dienst zoals die staat; daarna blijft de invoer staan tot je bewaart, ook als
  // de app intussen gegevens van collega's bijleest
  useEffect(() => {
    if (!open) return;
    setSoort(NBD_PALET.includes(code) && code !== '-' ? code : 'N');
    setStart(dienst?.start ?? 9);
    setEind(dienst?.eind ?? 17.5);
    setPauze(dienst?.pauze ?? 30);
    setPb(dienst?.pauzeStart ?? null);
    setTaken(dienst?.taken?.map((k) => ({ ...k })) ?? []);
  }, [open, medewerker?.id, datum]); // eslint-disable-line react-hooks/exhaustive-deps

  const x: NbdDienst = useMemo(() => ({ start, eind, pauze, ...(pauze && pb != null ? { pauzeStart: pb } : {}), ...(taken.length ? { taken } : {}) }), [start, eind, pauze, pb, taken]);
  const werk = netto(x);
  const nodig = pauzeNodig(p, werk);
  const meldingen: string[] = [];
  if (soort === 'N') {
    if (eind <= start) meldingen.push('De eindtijd moet na de begintijd liggen.');
    else {
      if (werk < p.minDienst) meldingen.push(`Een dienst duurt minstens ${nl(p.minDienst)} uur werktijd.`);
      if (werk > p.maxDienst) meldingen.push(`Een dienst duurt hoogstens ${nl(p.maxDienst)} uur werktijd, zonder de pauze.`);
      if (pauze < nodig) meldingen.push(`Bij meer dan ${nl(p.pauzeNa)} uur werk hoort een pauze van minstens ${p.pauzeMinuten} minuten (ATW).`);
      const b = pauzeBegin(x);
      if (b != null && (b < start || b + pauze / 60 > eind)) meldingen.push('De pauze valt buiten de dienst.');
      if (start < p.open || eind > p.sluit) meldingen.push(`De desk is open van ${uurTekst(p.open)} tot ${uurTekst(p.sluit)}; daarbuiten telt de dienst niet mee in de bezetting.`);
      meldingen.push(...takenMeldingen(x));
    }
  }
  /** Het eerste uur (of korter) dat vrij is, buiten de pauze. */
  const nieuweTaak = (soort: TaakSoort) => {
    for (let t = start; t < eind - 1e-9; t += 0.25) {
      for (const duur of [1, 0.5, 0.25]) { const k = { soort, van: t, tot: t + duur }; if (pastTaak(x, k)) return setTaken([...taken, k]); }
    }
  };
  const zetTaak = (i: number, k: Taak) => setTaken(taken.map((y, j) => (j === i ? k : y)));
  const fout = soort === 'N' && meldingen.some((m) => !m.startsWith('De desk'));
  const pauzeOpties = UREN.filter((u) => u >= start + 0.5 && u + pauze / 60 <= eind - 0.5);
  // een oudere dienst buiten de openingstijden blijft te kiezen, zodat je hem kunt aanpassen
  const tijden = [...new Set([...UREN, start, eind])].sort((a, b) => a - b);

  return (
    <Modal open={open} onClose={onClose} titel={medewerker ? `${medewerker.naam}, ${fmtDag(datum)}` : 'Dienst'} voet={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
      <button type="button" className="btn" disabled={fout} onClick={() => onBewaar(soort, soort === 'N' ? x : null)}><Save size={16} /> Bewaren</button>
    </>}>
      <div role="radiogroup" aria-label="Soort" className="flex flex-wrap gap-1.5">
        {NBD_PALET.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={soort === c} onClick={() => setSoort(c)}
            className={`rounded-md border border-line px-3 py-1.5 text-[13.5px] font-semibold c-${c} ${soort === c ? 'outline outline-[3px] outline-offset-1 outline-[color:var(--plum)]' : ''}`}>
            {DIENSTEN[c].naam}
          </button>
        ))}
      </div>
      {soort === 'N' ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Veld label="Begin">
            <select className="input" value={start} onChange={(e) => { const v = Number(e.target.value); setStart(v); if (eind <= v) setEind(kwartier(v + 8)); }}>
              {tijden.filter((u) => u < NBD_SLUIT || u === start).map((u) => <option key={u} value={u}>{uurTekst(u)}</option>)}
            </select>
          </Veld>
          <Veld label="Eind">
            <select className="input" value={eind} onChange={(e) => setEind(Number(e.target.value))}>
              {tijden.filter((u) => u > start).map((u) => <option key={u} value={u}>{uurTekst(u)}</option>)}
            </select>
          </Veld>
          <Veld label="Pauze" hint="Telt niet als werktijd; in de pauze zit je niet aan de telefoon.">
            <select className="input" value={pauze} onChange={(e) => setPauze(Number(e.target.value))}>
              {[0, 15, 30, 45, 60].map((m) => <option key={m} value={m}>{m ? `${m} minuten` : 'geen'}</option>)}
            </select>
          </Veld>
          <Veld label="Pauze om">
            <select className="input" value={pb ?? ''} disabled={!pauze} onChange={(e) => setPb(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">in het midden</option>
              {pauzeOpties.map((u) => <option key={u} value={u}>{uurTekst(u)}</option>)}
            </select>
          </Veld>
          <p className="text-[14.5px] sm:col-span-2">
            {eind > start ? <><b>{nlUren(werk)} uur</b> werk{pauze ? `, pauze ${uurTekst(pauzeBegin(x) ?? start)}–${uurTekst((pauzeBegin(x) ?? start) + pauze / 60)}` : ''} · {DAGDEEL_LABEL[dagdeel(x)].toLowerCase()}</> : null}
          </p>
          <div className="grid gap-2 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13.5px] font-semibold">Taken in de dienst</span>
              <span className="flex flex-wrap gap-1.5">
                {TAAK_SOORTEN.map((s) => <button key={s} type="button" className="btn btn-ghost btn-sm" onClick={() => nieuweTaak(s)} disabled={eind <= start}><Plus size={14} /> {TAAK_LABEL[s]}</button>)}
              </span>
            </div>
            {taken.length ? (
              <ul className="grid gap-1.5">
                {taken.map((k, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <select className="input w-auto" aria-label="Soort taak" value={k.soort} onChange={(e) => zetTaak(i, { ...k, soort: e.target.value as TaakSoort })}>
                      {TAAK_SOORTEN.map((s) => <option key={s} value={s}>{TAAK_LABEL[s]}</option>)}
                    </select>
                    <select className="input w-auto" aria-label="Taak van" value={k.van} onChange={(e) => { const v = Number(e.target.value); zetTaak(i, { ...k, van: v, tot: Math.max(k.tot, v + 0.25) }); }}>
                      {UREN.filter((u) => u >= start && u < eind).map((u) => <option key={u} value={u}>{uurTekst(u)}</option>)}
                    </select>
                    <span className="text-muted">tot</span>
                    <select className="input w-auto" aria-label="Taak tot" value={k.tot} onChange={(e) => zetTaak(i, { ...k, tot: Number(e.target.value) })}>
                      {UREN.filter((u) => u > k.van && u <= eind).map((u) => <option key={u} value={u}>{uurTekst(u)}</option>)}
                    </select>
                    <button type="button" className="btn btn-ghost btn-icon" onClick={() => setTaken(taken.filter((_, j) => j !== i))} aria-label={`${TAAK_LABEL[k.soort]} weghalen`} title="Weghalen"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="note">Tijdens een taak zit je niet aan de telefoon; het telt wel als werktijd.</p>}
          </div>
          {meldingen.length > 0 && <ul className="grid gap-1 text-[14px] sm:col-span-2">{meldingen.map((m) => <li key={m} className={m.startsWith('De desk') ? 'note' : 'text-rood'}>{m}</li>)}</ul>}
        </div>
      ) : (
        <p className="note mt-4">{DIENSTEN[soort].uitleg}</p>
      )}
    </Modal>
  );
}
