'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarHeart, Lock, Pencil, Wand2 } from 'lucide-react';
import { Box, GeenToegang, Groep, Leeg, Modal, PaginaKop, Pill, Sectie, Segment, Veld } from '@/components/ui';
import { useActie } from '@/components/toast';
import { useDoor, useSessie } from '@/components/sessie';
import { RondeVoortgang } from '@/components/voorkeur/Voorkeuren';
import { UUR_KEUZE, UurPatroonMini, UurVoorkeurEditor, uurSamenvatting } from '@/components/nbd/UurVoorkeuren';
import { openRonde, sluitRonde, useApp } from '@/lib/store/store';
import { addDays, DAG_KORT, DAG_LANG, fmtD, fmtMoment, isoWeek, toDay, todayIso } from '@/lib/dates';
import { maandEind, maandNaam, maandStart, maandVan, periodeNaam, volgendeMaand } from '@/lib/rooster/maand';
import { NBD, NBD_NAAM, tijdvakken } from '@/lib/nbd/parameters';
import { gewoneDag } from '@/lib/nbd/behoefte';
import { maxUren } from '@/lib/nbd/capaciteit';
import { voorkeurKort, weektype, wensTelling, type Weektype } from '@/lib/nbd/voorkeuren';
import { uurTekst } from '@/lib/rooster/tijden';
import { cx, nlUren } from '@/lib/format';
import type { Medewerker } from '@/lib/rooster/types';

/** Maandag eerst. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const VAK = tijdvakken();

export function NbdVoorkeuren() {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const vandaag = todayIso();
  const medewerkers = useApp((x) => x.medewerkers);
  const profielen = useApp((x) => x.profielen);
  const rondes = useApp((x) => x.rondes);
  const wensen = useApp((x) => x.wensen);
  const pub = useApp((x) => x.publicaties[NBD]);
  const team = useMemo(() => medewerkers.filter((m) => m.regio === NBD && m.actief && !m.extern).sort((a, b) => a.naam.localeCompare(b.naam)), [medewerkers]);
  const ronde = rondes.find((x) => x.regio === NBD && x.status === 'open') ?? null;
  const vorige = rondes.filter((x) => x.regio === NBD && x.status === 'gesloten').slice(0, 3);
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
    for (const w of wensen) if (w.regio === NBD && w.datum >= periode.van && w.datum <= periode.tot) m.set(w.medewerkerId, (m.get(w.medewerkerId) ?? 0) + 1);
    return m;
  }, [wensen, periode.van, periode.tot]);

  if (!s.isPlanner) return <GeenToegang />;
  const ingevuld = team.filter((m) => profielen[m.id]?.uren).length;

  return (
    <>
      <PaginaKop
        boven={<>{NBD_NAAM} · landelijk · open van 7:00 tot 22:30</>}
        titel={<>Voorkeuren <em>per uur</em></>}
        lead="Per medewerker, per weekdag en per uur: graag, kan niet of geen voorkeur, apart voor even en oneven weken als dat nodig is. Rooster maken plant nooit op uren die niet kunnen en zoekt de graag-uren op. Onderaan zie je of de wensen van het team de behoefte dekken."
      />

      {ronde ? (
        <Box titel={<span className="flex items-center gap-2"><CalendarHeart size={20} className="text-teal" /> Voorkeurenronde {periodeNaam(ronde)}</span>} rechts={<Pill soort="info">open tot {fmtD(ronde.deadline)}</Pill>}>
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="grid gap-2">
              <p className="text-[15px]">Medewerkers zien de ronde bij hun voorkeuren en kunnen hun voorkeuren per uur en wensen indienen. Geopend {fmtMoment(ronde.geopend)}{ronde.door !== 'demo' ? ` door ${ronde.door}` : ''}.</p>
              <RondeVoortgang ronde={ronde} team={team} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => actie(() => sluitRonde(ronde.id, door), 'Ronde gesloten.')}><Lock size={16} /> Ronde sluiten</button>
              <Link href={`/nbd/rooster?maand=${maandVan(ronde.van)}&plan=1`} className="btn btn-teal"><Wand2 size={16} /> Rooster maken uit voorkeuren</Link>
            </div>
          </div>
        </Box>
      ) : (
        <form className="box" onSubmit={(e) => { e.preventDefault(); actie(() => openRonde({ regio: NBD, ...f }, door), 'Voorkeurenronde geopend. De medewerkers van de NBD krijgen een bericht.'); }}>
          <h3 className="kop-s flex items-center gap-2"><CalendarHeart size={20} className="text-teal" /> Voorkeurenronde openen</h3>
          <p className="note mt-1">We roosteren per maand. Vraag het team om voor die maand hun voorkeuren per uur en wensen op te geven. Na de deadline maak je het maandrooster met één klik uit die voorkeuren.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end">
            <Veld label="Maand">
              <select className="input" value={maandVan(f.van)} onChange={(e) => setF(metMaand(e.target.value, f.deadline))}>
                {maanden.map((m) => <option key={m} value={m}>{maandNaam(m)}</option>)}
              </select>
            </Veld>
            <div className="note pb-2.5">{fmtD(f.van)} t/m {fmtD(f.tot)}</div>
            <Veld label="Invullen vóór"><input className="input" type="date" required min={vandaag} max={f.van} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Veld>
            <button className="btn btn-teal" disabled={!team.length}><CalendarHeart size={16} /> Ronde openen</button>
          </div>
          {vorige.length > 0 && <p className="note mt-3">Eerdere rondes: {vorige.map((r) => `${periodeNaam(r)} (${Object.keys(r.ingediend).length} ingediend)`).join(', ')}.</p>}
        </form>
      )}

      <Sectie titel="Het team" lead={`${ingevuld} van ${team.length} medewerkers hebben voorkeuren per uur. Wensen tellen voor ${fmtD(periode.van)} t/m ${fmtD(periode.tot)}.`}>
        {!team.length ? <Leeg titel="Nog geen team bij de NBD">Voeg eerst medewerkers toe bij Team of Rooster.</Leeg> : (
          <div className="scroll">
            <table className="tb">
              <thead><tr><th>Medewerker</th><th>Voorkeur</th><th>Even week</th><th>Oneven week</th><th className="r" title="Graag-uren per week, even / oneven">Graag (uur)</th><th className="r" title="Uren per week die niet kunnen, even / oneven">Kan niet (uur)</th><th className="r">Max dagen</th><th className="r">Wensen</th>{ronde && <th>Ronde</th>}<th>Bijgewerkt</th><th /></tr></thead>
              <tbody>
                {team.map((m) => {
                  const p = profielen[m.id];
                  const sam = uurSamenvatting(p?.uren);
                  return (
                    <tr key={m.id} className="klik" onClick={() => setBewerk(m)}>
                      <td className="whitespace-nowrap font-semibold">{m.naam}<div className="text-[12px] font-normal text-muted">{m.contract} uur{maxUren(m) > m.contract ? ` · max ${nlUren(maxUren(m))}` : ''}</div></td>
                      <td>{p?.uren ? voorkeurKort(p.uren) : <span className="note">nog niet ingevuld</span>}</td>
                      <td><UurPatroonMini uren={p?.uren} type="even" /></td>
                      <td><UurPatroonMini uren={p?.uren} type="oneven" /></td>
                      <td className={cx('r num', sam && Math.min(sam.graag.even, sam.graag.oneven) < m.contract && 'text-muted')}>{sam ? (sam.graag.even === sam.graag.oneven ? nlUren(sam.graag.even) : `${nlUren(sam.graag.even)} / ${nlUren(sam.graag.oneven)}`) : '–'}</td>
                      <td className="r num">{sam ? (sam.niet.even === sam.niet.oneven ? nlUren(sam.niet.even) : `${nlUren(sam.niet.even)} / ${nlUren(sam.niet.oneven)}`) : '–'}</td>
                      <td className="r">{p?.maxDagenPerWeek ?? '–'}</td>
                      <td className="r">{wensTel.get(m.id) ?? 0}</td>
                      {ronde && <td>{ronde.ingediend[m.id] ? <Pill soort="ok">ingediend</Pill> : <Pill soort="warn">nog niet</Pill>}</td>}
                      <td className="note whitespace-nowrap">{p?.bijgewerkt ? fmtMoment(p.bijgewerkt) : 'nooit'}</td>
                      <td className="r"><button type="button" className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); setBewerk(m); }} aria-label={`Voorkeuren van ${m.naam} bewerken`} title="Bewerken"><Pencil size={15} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Sectie>

      {team.length > 0 && <WensTegenBehoefte team={team} />}

      <Modal open={!!bewerk} onClose={() => setBewerk(null)} titel={bewerk ? `Voorkeuren per uur van ${bewerk.naam}` : ''} breed>
        {bewerk && <UurVoorkeurEditor medewerker={bewerk} onOpgeslagen={() => setBewerk(null)} />}
      </Modal>
    </>
  );
}

/** Zoals Gap wens en benodigd: rood als minder mensen willen dan nodig. */
function WensTegenBehoefte({ team }: { team: Medewerker[] }) {
  const profielen = useApp((x) => x.profielen);
  const p = useApp((x) => x.nbd);
  const vandaag = todayIso();
  const [type, setType] = useState<Weektype>(weektype(vandaag));
  const tel = useMemo(() => wensTelling(team, profielen, type), [team, profielen, type]);
  const nodig = useMemo(() => Object.fromEntries(WEEK.map((wd) => [wd, gewoneDag(p, wd).tijdvakken.map((v) => v.nodig)])) as Record<number, number[]>, [p]);
  let tekort = 0;
  for (const wd of WEEK) VAK.forEach((v, i) => { const gap = tel.graag[wd][i] - nodig[wd][i]; if (gap < 0) tekort += -gap * (v.tot - v.van); });

  return (
    <Sectie
      titel="Wens tegenover de behoefte"
      lead={<>Per weekdag en uur: hoeveel mensen er graag werken min hoeveel er aan de telefoon nodig zijn in een gewone week (Erlang C per uur). Rood: minder mensen willen dan nodig; daar plant het rooster ook mensen zonder voorkeur in. Deze week (week {isoWeek(toDay(vandaag))}) is een {weektype(vandaag)} week.</>}
      rechts={<Groep label="Week"><Segment label="Week" waarde={type} onChange={setType} opties={[['even', 'Even weken'], ['oneven', 'Oneven weken']]} /></Groep>}
    >
      <div className="box">
        <div className="scroll">
          <table className="uurraster">
            <thead>
              <tr>
                <th className="dag" />
                {VAK.map((v, i) => <th key={i} title={`${uurTekst(v.van)}–${uurTekst(v.tot)}`}>{v.van}</th>)}
              </tr>
            </thead>
            <tbody>
              {WEEK.map((wd) => (
                <tr key={wd}>
                  <th className="dag" scope="row">{DAG_KORT[wd]}</th>
                  {VAK.map((v, i) => {
                    const g = tel.graag[wd][i], n = nodig[wd][i], niet = tel.niet[wd][i], gap = g - n;
                    const kleur = gap < 0 ? `color-mix(in srgb, var(--red) ${Math.min(60, 18 + -gap * 12)}%, var(--card))` : gap === 0 ? 'var(--soft)' : `color-mix(in srgb, var(--teal) ${Math.min(50, 12 + gap * 8)}%, var(--card))`;
                    return (
                      <td key={i} className="gap" style={{ background: kleur }} title={`${DAG_LANG[wd]} ${uurTekst(v.van)}–${uurTekst(v.tot)}: ${g} graag, ${n} nodig, ${niet} kan niet`}>
                        {gap > 0 ? `+${gap}` : gap}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: UUR_KEUZE.n.kleur }} />minder graag dan nodig</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: UUR_KEUZE.g.kleur }} />meer graag dan nodig</span>
          <span>{tekort > 0 ? `Samen ${nlUren(tekort)} mensuur per week minder graag dan nodig.` : 'Op elk uur willen genoeg mensen graag werken.'}</span>
        </div>
      </div>
    </Sectie>
  );
}
