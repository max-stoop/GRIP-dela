'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Calculator, Check } from 'lucide-react';
import { useActie } from '@/components/toast';
import { Modal, Pill, Sectie } from '@/components/ui';
import { herberekenNorm, type NormVoorstel } from '@/lib/capaciteit/herberekenen';
import { volumePerJaar } from '@/lib/capaciteit/norm';
import { normenHerberekend, useApp } from '@/lib/store/store';
import { HORIZON_DAYS } from '@/lib/model/config';
import { fmtDJ } from '@/lib/dates';
import { cx, nl, nlInt, pctS } from '@/lib/format';

const DAG = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

/** Eerst zien wat er verandert, dan overnemen. */
export function VastgesteldePlekken() {
  const actie = useActie();
  const normen = useApp((x) => x.normen);
  const meldingen = useApp((x) => x.meldingen);
  const voorstel = useMemo(() => herberekenNorm(normen, meldingen), [normen, meldingen]);
  const [open, setOpen] = useState(false);
  const regios = Object.keys(normen.regios).sort();
  const volume = regios.reduce((a, r) => a + volumePerJaar(normen, r), 0);
  const eigen = voorstel ? regios.reduce((a, r) => a + voorstel.regios[r].meldingen, 0) : null;

  return (
    <Sectie
      id="vastgesteld"
      titel="Vastgestelde regelplekken"
      lead={<>Na de voorspelling van {HORIZON_DAYS} dagen rekent GRIP met de vastgestelde regelplekken: voor het rooster verder vooruit, de capaciteit en de verlofruimte. Opnieuw berekenen zet het seizoen, de weekdag en per regio het volume op de eigen meldingen. Natura, overlijdens, vrije markt en formatie uit de begroting blijven staan. Je ziet eerst wat er verandert.</>}
      rechts={<button type="button" className="btn" disabled={!voorstel} onClick={() => setOpen(true)}><Calculator size={16} /> Opnieuw berekenen</button>}
    >
      <div className="box grid gap-2 text-[15px]">
        <p>Bron: <b>{normen.bron}</b>.</p>
        <p>
          Volume volgens de vastgestelde regelplekken: <b className="num">{nlInt(volume)}</b> meldingen per jaar
          {voorstel && eigen != null ? <>; de eigen meldingen van {fmtDJ(voorstel.van)} t/m {fmtDJ(voorstel.tot)}: <b className="num">{nlInt(eigen)}</b> ({pctS(eigen / volume - 1)}).</> : '.'}
        </p>
        {!voorstel && <p className="note">Opnieuw berekenen kan vanaf 52 weken eigen meldingen.</p>}
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/capaciteit" className="font-semibold text-accent">Bekijken bij Capaciteit</Link>
          <Link href="/instellingen#normen" className="font-semibold text-accent">Aanpassen bij Instellingen</Link>
        </p>
      </div>
      {voorstel && <Voorstel open={open} voorstel={voorstel} onClose={() => setOpen(false)} onOvernemen={() => { setOpen(false); actie(() => normenHerberekend(voorstel), 'De vastgestelde regelplekken zijn opnieuw berekend en overgenomen.'); }} />}
    </Sectie>
  );
}

function Voorstel({ open, voorstel: v, onClose, onOvernemen }: { open: boolean; voorstel: NormVoorstel; onClose: () => void; onOvernemen: () => void }) {
  const normen = useApp((x) => x.normen);
  const regios = Object.keys(v.regios).sort();
  const oud = regios.reduce((a, r) => a + v.regios[r].volumeOud, 0), nieuw = regios.reduce((a, r) => a + v.regios[r].volume, 0);
  const piek = (s: number[]) => {
    const max = Math.max(...s), min = Math.min(...s);
    return `drukste week ${s.indexOf(max) + 1} (${pctS(max - 1)}), rustigste week ${s.indexOf(min) + 1} (${pctS(min - 1)})`;
  };
  return (
    <Modal open={open} onClose={onClose} breed titel="Vastgestelde regelplekken opnieuw berekenen" voet={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
      <button type="button" className="btn btn-teal" onClick={onOvernemen}><Check size={16} /> Overnemen</button>
    </>}>
      <div className="grid gap-4 text-[15px]">
        <p>Uit de eigen meldingen van {fmtDJ(v.van)} t/m {fmtDJ(v.tot)}. Landelijk volume per jaar: <b className="num">{nlInt(oud)}</b> wordt <b className="num">{nlInt(nieuw)}</b> ({pctS(nieuw / oud - 1)}).</p>
        <div className="grid gap-1">
          <div className="font-semibold">Seizoen</div>
          {v.seizoen
            ? <p>Nu {piek(normen.seizoen)}; nieuw {piek(v.seizoen)}.</p>
            : <p className="note">Blijft zoals het is: daarvoor zijn minstens twee jaar meldingen nodig.</p>}
        </div>
        <div className="grid gap-1">
          <div className="font-semibold">Weekdag</div>
          {v.dagIndex ? (
            <div className="scroll">
              <table className="tb">
                <thead><tr><th />{DAG.map((d) => <th key={d} className="r">{d}</th>)}</tr></thead>
                <tbody>
                  <tr><td>Nu</td>{normen.dagIndex.map((x, i) => <td key={i} className="r num">{nl(x, 3)}</td>)}</tr>
                  <tr><td>Nieuw</td>{v.dagIndex.map((x, i) => <td key={i} className="r num font-semibold">{nl(x, 3)}</td>)}</tr>
                </tbody>
              </table>
            </div>
          ) : <p className="note">Blijft zoals het is: daarvoor is minstens een jaar meldingen nodig.</p>}
        </div>
        <div className="grid gap-1">
          <div className="font-semibold">Volume per regio</div>
          <div className="scroll max-h-[340px]">
            <table className="tb">
              <thead><tr><th>Regio</th><th className="r">Meldingen 52 weken</th><th className="r">Volume nu</th><th className="r">Nieuw</th><th className="r">Verschil</th></tr></thead>
              <tbody>
                {regios.map((r) => {
                  const x = v.regios[r], d = x.volume / x.volumeOud - 1;
                  return (
                    <tr key={r}>
                      <td className="font-semibold">{r}{v.zonder.includes(r) && <> <Pill soort="warn">blijft</Pill></>}</td>
                      <td className="r num">{nlInt(x.meldingen)}</td>
                      <td className="r num">{nlInt(x.volumeOud)}</td>
                      <td className="r num">{nlInt(x.volume)}</td>
                      <td className={cx('r num', Math.abs(d) >= 0.05 && 'font-semibold text-gold')}>{pctS(d)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {v.zonder.length > 0 && <p className="note">Te weinig meldingen in de 52 weken, blijft gelijk: {v.zonder.join(', ')}.</p>}
        </div>
        <p className="note">Wat de begroting vastlegt (natura, overlijdens, vrije markt, amplitude, voorgangen en formatie) blijft staan. Terugzetten kan bij Instellingen.</p>
      </div>
    </Modal>
  );
}
