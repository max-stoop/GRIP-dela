'use client';
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Eraser, Search, Wand2 } from 'lucide-react';
import { Modal, Segment, Stat, Veld } from '@/components/ui';
import { DAG_KORT, fmtD, toDay, weekday } from '@/lib/dates';
import { uurTekst } from '@/lib/rooster/tijden';
import type { Cellen, Medewerker, TaakSoort, Tijden, Voorkeurprofiel } from '@/lib/rooster/types';
import type { NbdDag } from '@/lib/nbd/behoefte';
import { dienstTekst, TAAK_LABEL } from '@/lib/nbd/dienst';
import { NBD_OPEN, NBD_SLUIT, type NbdParameters } from '@/lib/nbd/parameters';
import { alBijMaandstart, klachtenStandaard, maandstartDagen, planTaken, takenOverzicht, takenWeg, trainingStandaard, zoekMaandstart, type KlachtenInstelling, type MaandstartPlan, type TakenInstelling } from '@/lib/nbd/taken';
import type { NbdWijziging } from '@/lib/nbd/voorstel';
import { cx, nl, pct, plural } from '@/lib/format';

type Tab = 'training' | 'maandstart';

const UREN = Array.from({ length: (NBD_SLUIT - NBD_OPEN) * 2 + 1 }, (_, i) => NBD_OPEN + i / 2);
const dagTekst = (d: string) => `${DAG_KORT[weekday(toDay(d))]} ${fmtD(d)}`;

function Venster({ van, tot, onVan, onTot }: { van: number; tot: number; onVan: (v: number) => void; onTot: (v: number) => void }) {
  return (
    <>
      <Veld label="Tussen">
        <select className="input" value={van} onChange={(e) => onVan(Number(e.target.value))}>
          {UREN.filter((u) => u < tot).map((u) => <option key={u} value={u}>{uurTekst(u)}</option>)}
        </select>
      </Veld>
      <Veld label="En">
        <select className="input" value={tot} onChange={(e) => onTot(Number(e.target.value))}>
          {UREN.filter((u) => u > van).map((u) => <option key={u} value={u}>{uurTekst(u)}</option>)}
        </select>
      </Veld>
    </>
  );
}

/** Eerst zie je wat GRIP voorstelt en wat het kost aan de telefoon; pas met Inplannen komt het in het rooster. */
export function TakenModal({ open, onClose, team, cellen, tijden, behoefte, p, maandDagen, vanaf, minVrijeWeekenden, profielen, onToepassen }: {
  open: boolean;
  onClose: () => void;
  team: Medewerker[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  behoefte: Record<string, NbdDag>;
  p: NbdParameters;
  /** Taken komen pas vanaf `vanaf`. */
  maandDagen: string[];
  vanaf: string;
  minVrijeWeekenden: number;
  profielen: Record<string, Voorkeurprofiel>;
  onToepassen: (w: NbdWijziging[], tekst: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('training');
  const [training, setTraining] = useState<TakenInstelling & { aan: boolean }>({ ...trainingStandaard(p), aan: true });
  const [klachten, setKlachten] = useState<KlachtenInstelling & { aan: boolean }>({ ...klachtenStandaard(p), aan: p.klachten > 0 });
  const [ms, setMs] = useState({ duur: 1, groepen: 3, dagen: 7, van: 8, tot: 20, verschuiven: true });
  const [msPlan, setMsPlan] = useState<MaandstartPlan | null>(null);
  useEffect(() => {
    if (!open) return;
    setTraining({ ...trainingStandaard(p), aan: true });
    setKlachten({ ...klachtenStandaard(p), aan: p.klachten > 0 });
    setMsPlan(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMsPlan(null); }, [ms, cellen, tijden]);

  const dates = useMemo(() => maandDagen.filter((d) => d >= vanaf), [maandDagen, vanaf]);
  const naam = (mid: string) => team.find((m) => m.id === mid)?.naam ?? '';
  const basis = { team, dates, cellen, tijden };
  const nu = useMemo(() => takenOverzicht({ team, dates, cellen, tijden }), [team, dates, cellen, tijden]);
  const plan = useMemo(() => (open && tab === 'training'
    ? planTaken({ ...basis, behoefte, p, training: training.aan ? training : null, klachten: klachten.aan ? klachten : null })
    : null), [open, tab, team, dates, cellen, tijden, behoefte, p, training, klachten]); // eslint-disable-line react-hooks/exhaustive-deps
  const al = useMemo(() => alBijMaandstart({ team, cellen, tijden }, maandDagen), [team, cellen, tijden, maandDagen]);
  // weghalen kan alleen wat nog moet komen
  const alVanaf = useMemo(() => alBijMaandstart({ team, cellen, tijden }, dates), [team, cellen, tijden, dates]);
  const msDagen = maandstartDagen(maandDagen, vanaf, ms.dagen);

  const zoek = () => setMsPlan(zoekMaandstart({ team, dagen: msDagen, cellen, tijden, behoefte, p, duur: ms.duur, groepen: ms.groepen, van: ms.van, tot: ms.tot, al, verschuiven: ms.verschuiven, minVrijeWeekenden, profielen }));
  const weg = (soorten: TaakSoort[]) => {
    const w = takenWeg(basis, soorten);
    onToepassen(w, `${soorten.map((s) => TAAK_LABEL[s].toLowerCase()).join(' en ')} weggehaald (${plural(w.length, 'dienst', 'diensten')})`);
  };

  const tel = (soort: TaakSoort) => plan?.geplaatst.filter((g) => g.soort === soort) ?? [];
  const tr = tel('training'), kl = tel('klachten');
  const urenVan = (l: { taak: { van: number; tot: number } }[]) => l.reduce((a, g) => a + g.taak.tot - g.taak.van, 0);
  const nietTraining = [...new Set(plan?.nietGelukt.filter((x) => x.soort === 'training' && x.mid).map((x) => x.mid!) ?? [])];
  const nietKlachten = plan?.nietGelukt.filter((x) => x.soort === 'klachten').reduce((a, x) => a + x.uren, 0) ?? 0;

  const voet = tab === 'training' ? (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Sluiten</button>
      <button type="button" className="btn btn-teal" disabled={!plan?.wijzigingen.length} onClick={() => plan && onToepassen(plan.wijzigingen, [tr.length ? `training ${nl(urenVan(tr))} uur` : '', kl.length ? `klachten ${nl(urenVan(kl))} uur` : ''].filter(Boolean).join(' en ') + ' ingepland')}>
        <Wand2 size={16} /> Inplannen
      </button>
    </>
  ) : (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Sluiten</button>
      {msPlan
        ? <button type="button" className="btn btn-teal" disabled={!msPlan.wijzigingen.length} onClick={() => onToepassen(msPlan.wijzigingen, `maandstart in ${plural(msPlan.groepen.length, 'groep', 'groepen')} ingepland`)}><CalendarCheck size={16} /> Maandstart inplannen</button>
        : <button type="button" className="btn btn-teal" disabled={!msDagen.length || !team.length} onClick={zoek}><Search size={16} /> Zoek beste tijd</button>}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} breed titel="Taken inplannen" voet={voet}>
      <Segment label="Soort taak" waarde={tab} onChange={setTab} opties={[['training', 'Training en klachten'], ['maandstart', 'Maandstart']]} />
      {tab === 'training' ? (
        <div className="mt-4 grid gap-4">
          <p className="lead">Tijdens een taak zit de medewerker niet aan de telefoon; het telt wel als werktijd. GRIP zet de blokken in de diensten die er staan, op de momenten waar zonder die medewerker nog genoeg mensen aan de telefoon zitten (Erlang C). Wat er al staat telt mee: opnieuw inplannen vult alleen aan.</p>
          <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-4"><input type="checkbox" checked={training.aan} onChange={(e) => setTraining({ ...training, aan: e.target.checked })} /> Training</label>
            <Veld label="Uur per medewerker per week"><input className="input" type="number" min={0.25} max={8} step={0.25} value={training.uren} onChange={(e) => setTraining({ ...training, uren: Math.max(0, Number(e.target.value) || 0) })} disabled={!training.aan} /></Veld>
            <Veld label="Blokken van hoogstens">
              <select className="input" value={training.blok} onChange={(e) => setTraining({ ...training, blok: Number(e.target.value) })} disabled={!training.aan}>
                {[0.5, 1, 1.5, 2].map((u) => <option key={u} value={u}>{nl(u)} uur</option>)}
              </select>
            </Veld>
            <Venster van={training.van} tot={training.tot} onVan={(v) => setTraining({ ...training, van: v })} onTot={(v) => setTraining({ ...training, tot: v })} />
            <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={training.werkdagen} onChange={(e) => setTraining({ ...training, werkdagen: e.target.checked })} disabled={!training.aan} /> Alleen op werkdagen (maandag tot en met vrijdag)</label>
          </fieldset>
          <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-4"><input type="checkbox" checked={klachten.aan} onChange={(e) => setKlachten({ ...klachten, aan: e.target.checked })} /> Klachten</label>
            <Veld label="Uur per week (team)"><input className="input" type="number" min={0.25} max={80} step={0.25} value={klachten.uren} onChange={(e) => setKlachten({ ...klachten, uren: Math.max(0, Number(e.target.value) || 0) })} disabled={!klachten.aan} /></Veld>
            <Veld label="Blokken van hoogstens">
              <select className="input" value={klachten.blok} onChange={(e) => setKlachten({ ...klachten, blok: Number(e.target.value) })} disabled={!klachten.aan}>
                {[0.5, 1, 1.5, 2].map((u) => <option key={u} value={u}>{nl(u)} uur</option>)}
              </select>
            </Veld>
            <Venster van={klachten.van} tot={klachten.tot} onVan={(v) => setKlachten({ ...klachten, van: v })} onTot={(v) => setKlachten({ ...klachten, tot: v })} />
            <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={klachten.werkdagen} onChange={(e) => setKlachten({ ...klachten, werkdagen: e.target.checked })} disabled={!klachten.aan} /> Alleen op werkdagen (maandag tot en met vrijdag)</label>
            <details className="sm:col-span-4">
              <summary className="cursor-pointer text-sm font-semibold text-accent">Wie behandelt klachten? {klachten.wie.length ? `${klachten.wie.length} gekozen` : 'Iedereen'}</summary>
              <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-3">
                {team.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={klachten.wie.includes(m.id)} onChange={(e) => setKlachten({ ...klachten, wie: e.target.checked ? [...klachten.wie, m.id] : klachten.wie.filter((x) => x !== m.id) })} />
                    <span className="truncate">{m.naam}</span>
                  </label>
                ))}
              </div>
            </details>
          </fieldset>
          {plan && (
            <div className="rounded-lg bg-soft p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat waarde={nl(urenVan(tr))} label="Uur training erbij" sub={`${plural(tr.length, 'blok', 'blokken')}, ${plural(new Set(tr.map((g) => g.mid)).size, 'medewerker', 'medewerkers')}`} />
                <Stat waarde={nl(urenVan(kl))} label="Uur klachten erbij" sub={`${plural(kl.length, 'blok', 'blokken')}, ${plural(new Set(kl.map((g) => g.mid)).size, 'medewerker', 'medewerkers')}`} />
                <Stat waarde={pct(plan.slNa, 1)} label="Service level" sub={`was ${pct(plan.slVoor, 1)}`} toon={plan.slNa >= p.serviceLevel ? 'teal' : 'rood'} />
                <Stat waarde={nl(plan.extraTekort)} label="Uur te weinig erbij" sub="aan de telefoon, de hele periode" toon={plan.extraTekort > 0.01 ? 'gold' : 'teal'} />
              </div>
              <p className="note mt-2">
                Van {fmtD(dates[0] ?? vanaf)} t/m {fmtD(dates[dates.length - 1] ?? vanaf)}. Staat er al: training {nl(nu.training.uren)} uur, klachten {nl(nu.klachten.uren)} uur.
                {nietTraining.length ? ` Geen training gelukt voor ${nietTraining.slice(0, 6).map(naam).join(', ')}${nietTraining.length > 6 ? ` en ${nietTraining.length - 6} anderen` : ''}: geen dienst op een werkdag in het venster.` : ''}
                {nietKlachten ? ` ${nl(nietKlachten)} uur klachten past niet: te weinig diensten in het venster.` : ''}
              </p>
            </div>
          )}
          {(nu.training.blokken > 0 || nu.klachten.blokken > 0) && (
            <div className="flex flex-wrap gap-2">
              {nu.training.blokken > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => weg(['training'])}><Eraser size={15} /> Training weghalen</button>}
              {nu.klachten.blokken > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => weg(['klachten'])}><Eraser size={15} /> Klachten weghalen</button>}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          <p className="lead">De maandstart doe je in groepen, zodat de desk bereikbaar blijft en iedereen één keer geweest is. GRIP zoekt de momenten waarop iedereen in een van de groepen kan, met zo weinig mogelijk mensen te weinig aan de telefoon. Wie op die momenten net niet werkt, krijgt een voorstel om de dienst te verschuiven (zelfde lengte, getoetst op ATW en CAO).</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Veld label="Groepen">
              <select className="input" value={ms.groepen} onChange={(e) => setMs({ ...ms, groepen: Number(e.target.value) })}>
                {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Veld>
            <Veld label="Duur">
              <select className="input" value={ms.duur} onChange={(e) => setMs({ ...ms, duur: Number(e.target.value) })}>
                {[0.5, 1, 1.5, 2].map((u) => <option key={u} value={u}>{nl(u)} uur</option>)}
              </select>
            </Veld>
            <Veld label="In de eerste">
              <select className="input" value={ms.dagen} onChange={(e) => setMs({ ...ms, dagen: Number(e.target.value) })}>
                <option value={7}>week van de maand</option>
                <option value={14}>twee weken van de maand</option>
              </select>
            </Veld>
            <div />
            <Venster van={ms.van} tot={ms.tot} onVan={(v) => setMs({ ...ms, van: v })} onTot={(v) => setMs({ ...ms, tot: v })} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={ms.verschuiven} onChange={(e) => setMs({ ...ms, verschuiven: e.target.checked })} /> Diensten verschuiven zodat iedereen kan</label>
          </div>
          <p className="note">
            {msDagen.length ? `Kan op ${msDagen.length === 1 ? dagTekst(msDagen[0]) : `${dagTekst(msDagen[0])} t/m ${dagTekst(msDagen[msDagen.length - 1])}`}.` : 'De eerste dagen van deze maand zijn al voorbij.'}
            {al.length ? ` ${plural(al.length, 'medewerker staat', 'medewerkers staan')} al ingepland voor de maandstart en ${al.length === 1 ? 'telt' : 'tellen'} niet meer mee.` : ''}
          </p>
          {msPlan && (
            <div className="grid gap-3">
              {msPlan.groepen.length ? msPlan.groepen.map((g, i) => (
                <div key={`${g.datum}-${g.van}`} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">Groep {i + 1}: {dagTekst(g.datum)}, {uurTekst(g.van)}–{uurTekst(g.tot)}</span>
                    <span className={cx('note', g.slNa < p.serviceLevel && 'text-rood')}>{plural(g.leden.length, 'medewerker', 'medewerkers')} · service level die dag {pct(g.slVoor)} → {pct(g.slNa)}</span>
                  </div>
                  <p className="mt-1 text-[13.5px] text-muted">{g.leden.map(naam).join(', ')}</p>
                </div>
              )) : <p className="banner">{msPlan.aantal === 0 ? 'Iedereen staat deze maand al ingepland voor de maandstart.' : `Geen moment gevonden: niemand die nog moet, werkt op deze dagen tussen ${uurTekst(ms.van)} en ${uurTekst(ms.tot)}.`}</p>}
              {msPlan.verschoven.length > 0 && (
                <div className="rounded-lg bg-soft p-3 text-[13.5px]">
                  <div className="font-semibold">Diensten die verschuiven</div>
                  <ul className="mt-1 grid gap-0.5">
                    {msPlan.verschoven.map((v) => <li key={v.mid}>{naam(v.mid)}, {dagTekst(v.datum)}: {dienstTekst(v.was)} wordt {dienstTekst(v.wordt)}</li>)}
                  </ul>
                </div>
              )}
              {msPlan.zonder.length > 0 && <p className="banner">Niet ingedeeld: {msPlan.zonder.map(naam).join(', ')}. Geen dienst op een van de dagen van de groepen; zet een dienst op zo&apos;n dag of kies meer dagen.</p>}
              <p className="note">Samen {nl(msPlan.extraTekort)} uur te weinig aan de telefoon erbij. Klik op Zoek beste tijd na een andere keuze hierboven.</p>
            </div>
          )}
          {alVanaf.length > 0 && <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => weg(['maandstart'])}><Eraser size={15} /> Maandstart weghalen (vanaf {fmtD(dates[0] ?? vanaf)})</button></div>}
        </div>
      )}
    </Modal>
  );
}
