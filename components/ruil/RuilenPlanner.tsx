'use client';
/** Ruilen beoordelen, voor de regio's of de NBD (elk een eigen pagina). */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { AlleenRegiomanager } from '@/components/Rechten';
import { useActie } from '@/components/toast';
import { Leeg, Modal, PaginaKop, Pill, Segment, Veld } from '@/components/ui';
import { periode, RuilRegel, RUIL_STATUS, ToetsUitkomst } from '@/components/ruil/RuilOnderdelen';
import { accepteerRuil, beoordeelRuil, toetsRuil, useApp } from '@/lib/store/store';
import type { Ruil } from '@/lib/store/types';
import { fmtMoment, todayIso } from '@/lib/dates';
import { cel } from '@/lib/rooster/toets';
import { inRooster } from '@/lib/rooster/types';

export function useNamen() {
  const mw = useApp((x) => x.medewerkers);
  return useMemo(() => Object.fromEntries(mw.map((m) => [m.id, m.naam])), [mw]);
}

export function RuilenPlanner({ regios: mijnRegios, boven, titel }: { regios: string[]; boven?: React.ReactNode; titel?: React.ReactNode }) {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const namen = useNamen();
  const vandaag = todayIso();
  const [regio, setRegio] = useState('alle');
  const regios = regio === 'alle' ? mijnRegios : [regio];
  const ruil = useApp((x) => x.ruil.filter((r) => regios.includes(r.regio)));
  const auto = useApp((x) => x.beleid.ruilAutomatisch);
  const medewerkers = useApp((x) => x.medewerkers);
  const rooster = useApp((x) => x.rooster);
  const wacht = ruil.filter((r) => r.status === 'wacht_planner');
  const open = ruil.filter((r) => r.status === 'open' && r.datum > vandaag);
  const [tab, setTab] = useState<'wacht' | 'open' | 'alles'>('wacht');
  const [afwijzen, setAfwijzen] = useState<Ruil | null>(null);
  const [reden, setReden] = useState('');
  const [toewijzen, setToewijzen] = useState<Record<string, string>>({});

  return (
    <>
      <PaginaKop boven={boven} titel={titel ?? 'Ruilen'} lead={<>Keur ruilen goed met de toets op ATW, CAO en dekking ernaast. {auto ? 'Ruilen van diensten zonder bevindingen worden automatisch goedgekeurd.' : 'Elke ruil vraagt een goedkeuring.'} Over verlof ruilen besluit de regiomanager.{s.isBeheerder ? <> <Link className="font-semibold text-accent" href="/instellingen">Instellen</Link></> : null}</>}>
        {mijnRegios.length > 1 && (
          <label className="label"><span>Regio</span>
            <select className="input w-auto min-w-[200px]" value={regio} onChange={(e) => setRegio(e.target.value)}>
              <option value="alle">Alle regio&apos;s</option>
              {mijnRegios.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
      </PaginaKop>
      <div className="mb-5"><Segment label="Onderdeel" waarde={tab} onChange={setTab} opties={[['wacht', `Wacht op goedkeuring${wacht.length ? ` (${wacht.length})` : ''}`], ['open', `Open aanbod${open.length ? ` (${open.length})` : ''}`], ['alles', 'Geschiedenis']]} /></div>

      {tab === 'wacht' && (wacht.length ? (
        <div className="grid gap-4">
          {wacht.map((r) => {
            const t = toetsRuil(r, r.ontvangerId!);
            return (
              <div key={r.id} className="box grid gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-[15px]"><RuilRegel r={r} namen={namen} /><div className="note mt-1">{r.regio} · gevraagd {fmtMoment(r.gemaakt)}{r.geaccepteerd ? ` · akkoord ${fmtMoment(r.geaccepteerd)}` : ''}{r.opmerking ? ` · “${r.opmerking}”` : ''}</div></div>
                  {r.soort === 'verlof' && !s.mag('verlof.besluiten') ? <AlleenRegiomanager wat="Het besluit over verlof ruilen" paragraaf="4.1" /> : (
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost" onClick={() => { setAfwijzen(r); setReden(''); }}><X size={16} /> Afwijzen</button>
                      <button type="button" className="btn btn-teal" onClick={() => actie(() => beoordeelRuil(r.id, 'goedgekeurd', door), 'Ruil goedgekeurd en in het rooster verwerkt.')}><Check size={16} /> Goedkeuren</button>
                    </div>
                  )}
                </div>
                {r.soort === 'verlof' && <p className="note">Na goedkeuring wisselen beide medewerkers hun roosterrij in {periode(r.datum, r.tot)} en {periode(r.tegenDatum ?? r.datum, r.tegenTot)}; het verlof verhuist mee. De bezetting per dag blijft gelijk.</p>}
                <ToetsUitkomst t={t} />
              </div>
            );
          })}
        </div>
      ) : <Leeg titel="Niets te beoordelen" icoon={<Check size={28} />}>Er wachten geen ruilen op goedkeuring.</Leeg>)}

      {tab === 'open' && (open.length ? (
        <div className="grid gap-4">
          {open.map((r) => {
            const kandidaten = medewerkers.filter((m) => m.regio === r.regio && inRooster(m) && m.id !== r.aanbiederId && cel(rooster[r.regio] ?? {}, m.id, r.datum) === '-');
            const keuze = toewijzen[r.id] ?? '';
            return (
              <div key={r.id} className="box grid gap-3">
                <div className="text-[15px]"><RuilRegel r={r} namen={namen} /><div className="note mt-1">{r.regio} · {fmtMoment(r.gemaakt)}{r.opmerking ? ` · “${r.opmerking}”` : ''}</div></div>
                {r.soort === 'aanbieden' ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Veld label="Toewijzen aan" className="min-w-[240px]">
                      <select className="input" value={keuze} onChange={(e) => setToewijzen({ ...toewijzen, [r.id]: e.target.value })}>
                        <option value="">Kies een collega die vrij is</option>
                        {kandidaten.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
                      </select>
                    </Veld>
                    <button type="button" className="btn" disabled={!keuze} onClick={() => actie(() => { accepteerRuil(r.id, keuze, door); beoordeelRuil(r.id, 'goedgekeurd', door); }, 'Dienst toegewezen en verwerkt.')}><Check size={16} /> Toewijzen en goedkeuren</button>
                  </div>
                ) : <p className="note">Wacht op akkoord van {namen[r.ontvangerId ?? ''] ?? 'de collega'}.</p>}
                {keuze && <ToetsUitkomst t={toetsRuil(r, keuze)} />}
              </div>
            );
          })}
        </div>
      ) : <Leeg titel="Geen open aanbod">Er staan geen diensten open die nog niemand heeft overgenomen.</Leeg>)}

      {tab === 'alles' && <RuilTabel lijst={[...ruil].sort((a, b) => b.gemaakt.localeCompare(a.gemaakt))} namen={namen} metRegio />}

      <Modal open={!!afwijzen} onClose={() => setAfwijzen(null)} titel="Ruil afwijzen" voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setAfwijzen(null)}>Annuleren</button>
        <button type="button" className="btn btn-danger" onClick={() => { actie(() => beoordeelRuil(afwijzen!.id, 'afgewezen', door, reden.trim() || undefined), 'Ruil afgewezen.'); setAfwijzen(null); }}><X size={16} /> Afwijzen</button>
      </>}>
        <Veld label="Reden (beide medewerkers zien deze)"><textarea className="input min-h-[80px]" autoFocus value={reden} onChange={(e) => setReden(e.target.value)} /></Veld>
      </Modal>
    </>
  );
}

export function RuilTabel({ lijst, namen, metRegio, acties }: { lijst: Ruil[]; namen: Record<string, string>; metRegio?: boolean; acties?: (r: Ruil) => React.ReactNode }) {
  if (!lijst.length) return <Leeg titel="Nog geen ruilen" />;
  return (
    <div className="scroll">
      <table className="tb">
        <thead><tr><th>Ruil</th>{metRegio && <th>Regio</th>}<th>Status</th><th>Laatst bijgewerkt</th>{acties && <th />}</tr></thead>
        <tbody>
          {lijst.map((r) => (
            <tr key={r.id}>
              <td><RuilRegel r={r} namen={namen} />{r.reden ? <div className="note">{r.reden}</div> : null}</td>
              {metRegio && <td>{r.regio}</td>}
              <td><Pill soort={RUIL_STATUS[r.status][0]}>{RUIL_STATUS[r.status][1]}</Pill></td>
              <td className="note whitespace-nowrap">{fmtMoment(r.beoordeeld ?? r.geaccepteerd ?? r.gemaakt)}</td>
              {acties && <td className="r">{acties(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
