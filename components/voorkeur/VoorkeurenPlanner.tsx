'use client';
import { useMemo, useState } from 'react';
import { isNbd } from '@/lib/nbd/parameters';
import Link from 'next/link';
import { CalendarHeart, Lock, Wand2, Pencil } from 'lucide-react';
import { Box, Leeg, Modal, Pill, Veld } from '@/components/ui';
import { useActie } from '@/components/toast';
import { useDoor } from '@/components/sessie';
import { PatroonMini, ProfielEditor, RondeVoortgang } from '@/components/voorkeur/Voorkeuren';
import { openRonde, sluitRonde, useApp } from '@/lib/store/store';
import { addDays, fmtD, fmtMoment, todayIso } from '@/lib/dates';
import { maandEind, maandNaam, maandStart, maandVan, periodeNaam, volgendeMaand } from '@/lib/rooster/maand';
import { cx } from '@/lib/format';
import { dienstVoorkeur } from '@/lib/rooster/analyse';
import { opVolgorde, type Medewerker, type Voorkeurprofiel, type Voorkeurronde, type Wens } from '@/lib/rooster/types';
import { weekendNaam } from '@/lib/rooster/weekend';

const TWEE: Record<string, string> = { graag: 'graag', neutraal: '–', liever_niet: 'liever niet', niet: 'kan niet' };

export function VoorkeurenPlanner({ regios, regio, kiesRegio }: { regios: string[]; regio: string; kiesRegio: (r: string) => void }) {
  const rondes = useApp((x) => x.rondes);
  const medewerkers = useApp((x) => x.medewerkers);
  const profielen = useApp((x) => x.profielen);
  const wensen = useApp((x) => x.wensen);

  if (regio === 'alle') {
    return (
      <>
        <p className="lead mb-3">Kies een regio om voorkeuren te bekijken of een voorkeurenronde te openen.</p>
        <div className="scroll">
          <table className="tb">
            <thead><tr><th>Regio</th><th>Voorkeurenronde</th><th>Ingediend</th><th className="r">Vaste voorkeuren ingevuld</th><th /></tr></thead>
            <tbody>
              {regios.map((r) => {
                const team = medewerkers.filter((m) => m.regio === r && m.actief && !m.extern);
                const ronde = rondes.find((x) => x.regio === r && x.status === 'open');
                const n = ronde ? team.filter((m) => ronde.ingediend[m.id]).length : 0;
                return (
                  <tr key={r} className="klik" onClick={() => kiesRegio(r)}>
                    <td className="font-semibold">{r}</td>
                    <td>{ronde ? <>{periodeNaam(ronde)} <span className="note">· deadline {fmtD(ronde.deadline)}</span></> : <span className="note">geen open ronde</span>}</td>
                    <td>{ronde ? <Pill soort={n === team.length ? 'ok' : n >= team.length / 2 ? 'warn' : 'bad'}>{n} van {team.length}</Pill> : ''}</td>
                    <td className="r">{team.filter((m) => profielen[m.id]?.bijgewerkt).length} van {team.length}</td>
                    <td className="r"><button type="button" className="text-sm font-semibold text-accent">Bekijken</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return <RegioVoorkeuren regio={regio} team={medewerkers.filter((m) => m.regio === regio && m.actief && !m.extern).sort(opVolgorde)} profielen={profielen} wensen={wensen} rondes={rondes} />;
}

function RegioVoorkeuren({ regio, team, profielen, wensen, rondes }: { regio: string; team: Medewerker[]; profielen: Record<string, Voorkeurprofiel>; wensen: Wens[]; rondes: Voorkeurronde[] }) {
  const nbd = isNbd(regio);
  const door = useDoor();
  const actie = useActie();
  const pub = useApp((x) => x.publicaties[regio]);
  const vandaag = todayIso();
  const ronde = rondes.find((x) => x.regio === regio && x.status === 'open') ?? null;
  const vorige = rondes.filter((x) => x.regio === regio && x.status === 'gesloten').slice(0, 3);
  // we roosteren per maand: standaard de eerste maand na wat al gepubliceerd is
  const eerste = volgendeMaand(maandVan(vandaag));
  const voorstelMaand = pub && pub.tot >= vandaag && maandVan(addDays(pub.tot, 1)) > eerste ? maandVan(addDays(pub.tot, 1)) : eerste;
  const maanden = Array.from({ length: 6 }, (_, i) => volgendeMaand(eerste, i));
  const metMaand = (m: string, deadline: string) => {
    const uiterlijk = addDays(maandStart(m), -1);
    return { van: maandStart(m), tot: maandEind(m), deadline: deadline > uiterlijk ? uiterlijk : deadline };
  };
  const [f, setF] = useState(() => metMaand(voorstelMaand, addDays(vandaag, 7)));
  const [bewerk, setBewerk] = useState<Medewerker | null>(null);
  const periode = ronde ?? { van: f.van, tot: f.tot };
  const wensTel = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of wensen) if (w.regio === regio && w.datum >= periode.van && w.datum <= periode.tot) m.set(w.medewerkerId, (m.get(w.medewerkerId) ?? 0) + 1);
    return m;
  }, [wensen, regio, periode.van, periode.tot]);

  if (!team.length) return <Leeg titel={`Nog geen team in ${regio}`}>Voeg eerst medewerkers toe op de roosterpagina.</Leeg>;

  return (
    <div className="grid gap-5">
      {ronde ? (
        <Box titel={<span className="flex items-center gap-2"><CalendarHeart size={20} className="text-teal" /> Voorkeurenronde {periodeNaam(ronde)}</span>} rechts={<Pill soort="info">open tot {fmtD(ronde.deadline)}</Pill>}>
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="grid gap-2">
              <p className="text-[15px]">Medewerkers zien de ronde bij hun voorkeuren en kunnen hun weekpatroon en wensen indienen. Geopend {fmtMoment(ronde.geopend)}{ronde.door !== 'demo' ? ` door ${ronde.door}` : ''}.</p>
              <RondeVoortgang ronde={ronde} team={team} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => actie(() => sluitRonde(ronde.id, door), 'Ronde gesloten.')}><Lock size={16} /> Ronde sluiten</button>
              <Link href={`/rooster?regio=${encodeURIComponent(regio)}&maand=${maandVan(ronde.van)}&plan=1`} className="btn btn-teal"><Wand2 size={16} /> Rooster maken uit voorkeuren</Link>
            </div>
          </div>
        </Box>
      ) : (
        <form className="box" onSubmit={(e) => { e.preventDefault(); actie(() => openRonde({ regio, ...f }, door), `Voorkeurenronde geopend. De medewerkers van ${regio} krijgen een bericht.`); }}>
          <h3 className="kop-s flex items-center gap-2"><CalendarHeart size={20} className="text-teal" /> Voorkeurenronde openen</h3>
          <p className="note mt-1">We roosteren per maand. Vraag het team om voor die maand hun vaste voorkeuren en wensen op te geven. Na de deadline maak je het maandrooster met één klik uit die voorkeuren.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end">
            <Veld label="Maand">
              <select className="input" value={maandVan(f.van)} onChange={(e) => setF(metMaand(e.target.value, f.deadline))}>
                {maanden.map((m) => <option key={m} value={m}>{maandNaam(m)}</option>)}
              </select>
            </Veld>
            <div className="note pb-2.5">{fmtD(f.van)} t/m {fmtD(f.tot)}</div>
            <Veld label="Invullen vóór"><input className="input" type="date" required min={vandaag} max={f.van} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Veld>
            <button className="btn btn-teal"><CalendarHeart size={16} /> Ronde openen</button>
          </div>
          {vorige.length > 0 && <p className="note mt-3">Eerdere rondes: {vorige.map((r) => `${periodeNaam(r)} (${Object.keys(r.ingediend).length} ingediend)`).join(', ')}.</p>}
        </form>
      )}

      <div>
        <h3 className="kop-s mb-1">Vaste voorkeuren van het team</h3>
        <p className="note mb-3">Weekpatroon per medewerker. Het voorstel plant nooit op een &quot;kan niet&quot;-dag en vermijdt &quot;liever niet&quot; waar het kan. Wensen tellen voor de periode {fmtD(periode.van)} t/m {fmtD(periode.tot)}.</p>
        <div className="scroll">
          <table className="tb">
            <thead><tr><th>Medewerker</th><th>Weekpatroon</th><th>{nbd ? 'Dagdeel' : 'Regeldienst'}</th>{!nbd && <th>Dubbele dienst</th>}<th className="r">Max dagen</th><th className="r">Wensen</th>{ronde && <th>Ronde</th>}<th>Bijgewerkt</th><th /></tr></thead>
            <tbody>
              {team.map((m) => {
                const p = profielen[m.id];
                const vk = dienstVoorkeur(m, p ?? null);
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap font-semibold">{m.naam}<div className="text-[12px] font-normal text-muted">{m.contract} uur{nbd ? '' : ` · ${weekendNaam(m, todayIso())}`}</div></td>
                    <td><PatroonMini p={p} />{p?.opmerking ? <div className="note mt-1 max-w-[260px] truncate" title={p.opmerking}>“{p.opmerking}”</div> : null}</td>
                    <td>{nbd ? (p && p.dienst !== 'geen' ? p.dienst : '–') : vk === 'O' ? 'ochtend' : vk === 'M' ? 'middag' : '–'}</td>
                    {!nbd && <td>{TWEE[p?.twee ?? 'neutraal']}</td>}
                    <td className="r">{p?.maxDagenPerWeek ?? '–'}</td>
                    <td className="r">{wensTel.get(m.id) ?? 0}</td>
                    {ronde && <td>{ronde.ingediend[m.id] ? <Pill soort="ok">ingediend</Pill> : <Pill soort="warn">nog niet</Pill>}</td>}
                    <td className={cx('note whitespace-nowrap')}>{p?.bijgewerkt ? fmtMoment(p.bijgewerkt) : 'nooit'}</td>
                    <td className="r"><button type="button" className="btn btn-ghost btn-icon" onClick={() => setBewerk(m)} aria-label={`Voorkeuren van ${m.naam} bewerken`} title="Bewerken"><Pencil size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!bewerk} onClose={() => setBewerk(null)} titel={bewerk ? `Voorkeuren van ${bewerk.naam}` : ''} breed>
        {bewerk && <ProfielEditor medewerker={bewerk} onOpgeslagen={() => setBewerk(null)} />}
      </Modal>
    </div>
  );
}
