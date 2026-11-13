'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarHeart, ChevronLeft, ChevronRight, Download, Eraser, ListChecks, Redo2, Send, Undo2, UserPlus, Users, Wand2, X } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { useActie, useToast } from '@/components/toast';
import { GeenToegang, Laden, Leeg, Modal, PaginaKop } from '@/components/ui';
import { MedewerkerModal, type MedewerkerInvoer } from '@/components/rooster/Panelen';
import { Vaststellen } from '@/components/rooster/Vaststellen';
import { DienstModal } from '@/components/nbd/DienstModal';
import { DagBeeld } from '@/components/nbd/DagBeeld';
import { NbdScorePaneel } from '@/components/nbd/ScorePaneel';
import { NbdPlanModal } from '@/components/nbd/PlanModal';
import { TakenModal } from '@/components/nbd/TakenModal';
import { bewaarMedewerker, publiceer, useApp, verwijderMedewerker, voorbeeldTeamToevoegen, zetNbdDiensten, useOpslagwijze } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import type { ToetsTegen } from '@/lib/store/afgeleid';
import { wijzigingenSindsPublicatie } from '@/lib/store/overzicht';
import { addDays, DAG_KORT, dayOfMonth, fmtD, fmtDag, isoWeek, MAAND_KORT, month, toDay, todayIso, weekday } from '@/lib/dates';
import { DIENSTEN, WENS_LABEL } from '@/lib/rooster/diensten';
import { BEHOEFTE_BRON, LEGE_CELLEN, dagVoorkeurOp, type DienstCode, type Medewerker, inRooster } from '@/lib/rooster/types';
import { isMaand, maandDagen, maandNaam, maandVan, periodeNaam, volgendeMaand, type Maand } from '@/lib/rooster/maand';
import { uurTekst } from '@/lib/rooster/tijden';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { maxUren } from '@/lib/nbd/capaciteit';
import { uurVoorkeurDag, voorkeurKort } from '@/lib/nbd/voorkeuren';
import { nbdBehoefte } from '@/lib/nbd/behoefte';
import { dagdeel, DAGDEEL_LABEL, dienstTekst, netto, pauzeTekst, TAAK_KORT, TAAK_LABEL, taakTekst, type NbdDienst } from '@/lib/nbd/dienst';
import { nbdDienst } from '@/lib/nbd/blokken';
import { nbdAdviesVoorstel, nbdWensOk, toetsNbd } from '@/lib/nbd/toets';
import type { NbdWijziging } from '@/lib/nbd/voorstel';
import { downloadExcel } from '@/lib/export';
import { cx, nl, nlUren, pct, plural } from '@/lib/format';

/** Zoals het rooster van een regio, maar elke dienst heeft eigen tijden met pauze en de behoefte komt uit Erlang C. */
export function NbdRooster() {
  const s = useSessie();
  const opslag = useOpslagwijze();
  const door = useDoor();
  const actie = useActie();
  const toon = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const vandaag = todayIso();
  const regio = NBD;

  const goedkeuringen = useApp((x) => x.goedkeuringen[regio]);
  const beleid = useApp((x) => x.beleid);
  const standaardMaand = useMemo(() => {
    const m0 = maandVan(vandaag);
    for (let i = 0; i <= beleid.publicatieMaanden; i++) { const m = volgendeMaand(m0, i); if (!(goedkeuringen?.[m]?.status === 'goedgekeurd' && goedkeuringen[m].advies)) return m; }
    return m0;
  }, [goedkeuringen, vandaag, beleid.publicatieMaanden]);
  const maandParam = params.get('maand');
  const maand: Maand = isMaand(maandParam) ? maandParam : standaardMaand;
  const naarMaand = (m: Maand) => router.replace(`/nbd/rooster?maand=${m}`, { scroll: false });
  useEffect(() => {
    if (!isMaand(maandParam)) router.replace(`/nbd/rooster?maand=${standaardMaand}`, { scroll: false });
  }, [maandParam, standaardMaand, router]);

  const [versie, setVersie] = useState<ToetsTegen>('basis');
  const [undo, setUndo] = useState<NbdWijziging[][]>([]);
  const [redo, setRedo] = useState<NbdWijziging[][]>([]);
  const [bewerk, setBewerk] = useState<{ mid: string; datum: string } | null>(null);
  const [mwBewerk, setMwBewerk] = useState<Medewerker | null | 'nieuw'>(null);
  const [dag, setDag] = useState<string | null>(null);
  const [plan, setPlan] = useState(false);
  const [takenOpen, setTakenOpen] = useState(false);
  const [bevestig, setBevestig] = useState<null | 'leeg' | 'publiceer'>(null);
  const [pubPeriode, setPubPeriode] = useState<{ van: string; tot: string } | null>(null);

  const medewerkers = useApp((x) => x.medewerkers);
  const cellen = useApp((x) => x.rooster[regio]) ?? LEGE_CELLEN;
  const tijden = useApp((x) => x.tijden[regio]);
  const p = useApp((x) => x.nbd);
  const normen = useApp((x) => x.normen);
  const wensenAlle = useApp((x) => x.wensen);
  const verlofAlle = useApp((x) => x.verlof);
  const profielen = useApp((x) => x.profielen);
  const pub = useApp((x) => x.publicaties[regio]);
  const ronde = useApp((x) => x.rondes.find((r) => r.regio === regio && r.status === 'open') ?? null);
  const { laatste, laatsteData, basis, basisData, klaar } = useRuns();

  const team = useMemo(() => medewerkers.filter((m) => m.regio === regio && inRooster(m)).sort((a, b) => Number(!!a.extern) - Number(!!b.extern) || a.naam.localeCompare(b.naam)), [medewerkers, regio]);
  const dates = useMemo(() => maandDagen(maand), [maand]);
  const toetsDates = useMemo(() => dates.filter((d) => d >= vandaag), [dates, vandaag]);
  const wensen = useMemo(() => wensenAlle.filter((w) => w.regio === regio), [wensenAlle, regio]);
  const aanvragen = useMemo(() => verlofAlle.filter((v) => v.regio === regio && v.status === 'aangevraagd'), [verlofAlle, regio]);
  const behoefteVan = useCallback((ds: string[]) => nbdBehoefte({ basis: basisData, laatste: laatsteData, norm: normen }, p, ds, versie), [basisData, laatsteData, normen, p, versie]);
  const behoefte = useMemo(() => behoefteVan(dates), [behoefteVan, dates]);
  const invoer = useMemo(() => ({ team, cellen, tijden, behoefte, p, profielen, wensen, aanvragen, minVrijeWeekenden: beleid.minVrijeWeekenden, weging: beleid.weging }), [team, cellen, tijden, behoefte, p, profielen, wensen, aanvragen, beleid.minVrijeWeekenden, beleid.weging]);
  // de toets vanaf vandaag (voor het cijfer en het advies), en de hele maand (voor de regels onder het rooster)
  const t = useMemo(() => toetsNbd({ ...invoer, dates: toetsDates.length ? toetsDates : dates }), [invoer, toetsDates, dates]);
  const alles = useMemo(() => toetsNbd({ ...invoer, dates }), [invoer, dates]);
  const perDag = useMemo(() => new Map(alles.perDag.map((d) => [d.datum, d])), [alles]);
  const adviesInfo = useMemo(() => {
    const v = nbdAdviesVoorstel(t, p, vandaag);
    return { voorstel: v, samenvatting: `Cijfer ${nl(t.cijfer)}, verwacht service level ${pct(t.sl, 1)} · ${t.wensen.totaal ? `${t.wensen.gehonoreerd} van ${t.wensen.totaal} wensen gehonoreerd` : 'geen wensen'}.` };
  }, [t, p, vandaag]);

  useEffect(() => { setUndo([]); setRedo([]); setDag(null); }, [maand]);
  useEffect(() => { if (params.get('plan')) setPlan(true); }, [params]);

  const dienstVan = useCallback((mid: string, d: string) => nbdDienst(cellen, tijden, mid, d), [cellen, tijden]);
  const zet = useCallback((w: NbdWijziging[], bewaarUndo = true) => {
    if (!w.length) return;
    const terug: NbdWijziging[] = w.map(([m, d]) => [m, d, cellen[m]?.[d] ?? '-', nbdDienst(cellen, tijden, m, d)]);
    zetNbdDiensten(w);
    if (bewaarUndo) { setUndo((u) => [...u.slice(-49), terug]); setRedo([]); }
    return terug;
  }, [cellen, tijden]);
  const doeUndo = () => { const st = undo.at(-1); if (!st) return; const terug = zet(st, false); setUndo((u) => u.slice(0, -1)); if (terug) setRedo((r) => [...r, terug]); };
  const doeRedo = () => { const st = redo.at(-1); if (!st) return; const terug = zet(st, false); setRedo((r) => r.slice(0, -1)); if (terug) setUndo((u) => [...u, terug]); };

  if (!s.isPlanner) return <GeenToegang />;
  if (!klaar) return <Laden />;

  const toekomst = dates.filter((d) => d > vandaag);
  const bewerkbaar = dates.filter((d) => d >= vandaag);
  const bronnen = [...new Set(Object.values(behoefte).map((b) => b.bron))];
  const versieTekst = versie === 'norm' ? 'het gemiddelde jaar'
    : `${versie === 'basis' && basis ? `roosterbasis van ${fmtD(basis.uitgegeven)}` : laatste ? `laatste voorspelling van ${fmtD(laatste.uitgegeven)}` : 'het gemiddelde jaar'}${bronnen.length > 1 ? `, verder ${bronnen.filter((b) => b !== versie).map((b) => BEHOEFTE_BRON[b]).join(' en ')}` : ''}`;
  const wijzigingen = wijzigingenSindsPublicatie(cellen, pub, team);
  const wk = (d: string, i: number) => (weekday(toDay(d)) === 1 && i > 0 ? 'wk' : '');
  const maandKop = dates.map((d, i) => (i === 0 || dayOfMonth(toDay(d)) === 1 ? MAAND_KORT[month(toDay(d)) - 1] : ''));
  const wensMap = new Map(wensen.map((w) => [`${w.medewerkerId}|${w.datum}`, w]));
  const aanvraagSet = new Set<string>();
  for (const v of aanvragen) for (const d of dates) if (d >= v.van && d <= v.tot) aanvraagSet.add(`${v.medewerkerId}|${d}`);
  const bewerkM = bewerk ? team.find((m) => m.id === bewerk.mid) ?? null : null;

  const leegmaken = () => {
    const w: NbdWijziging[] = [];
    for (const e of team) for (const d of toekomst) { const x = cellen[e.id]?.[d]; if (x && x !== 'V' && x !== 'Z') w.push([e.id, d, '-', null]); }
    zet(w);
    setBevestig(null);
    toon(`${plural(w.length, 'dienst', 'diensten')} gewist. Verlof en ziekte bleven staan. Ongedaan maken kan.`);
  };

  const exporteer = () => {
    const kop = ['Medewerker', 'Contract', ...dates.map((d) => `${DAG_KORT[weekday(toDay(d))]} ${fmtD(d)}`), 'Uren', 'Norm'];
    const rijen = team.map((e) => [e.naam, e.contract, ...dates.map((d) => {
      const x = dienstVan(e.id, d), c = cellen[e.id]?.[d];
      return x ? `${dienstTekst(x)}${x.pauze ? ` (p ${uurTekst(x.pauzeStart ?? (x.start + (x.eind - x.start - x.pauze / 60) / 2))})` : ''}${x.taken?.length ? ` ${x.taken.map((k) => `${TAAK_KORT[k.soort]} ${uurTekst(k.van)}–${uurTekst(k.tot)}`).join(' ')}` : ''}` : c && c !== '-' ? c : '';
    }), Math.round((alles.perMedewerker[e.id]?.uren ?? 0) * 100) / 100, Math.round(alles.perMedewerker[e.id]?.norm ?? 0)]);
    const voet = [
      ['Nodig (uur aan de telefoon)', '', ...dates.map((d) => Math.round((perDag.get(d)?.nodigUren ?? 0) * 10) / 10)],
      ['Gepland (uur aan de telefoon)', '', ...dates.map((d) => Math.round((perDag.get(d)?.geplandUren ?? 0) * 10) / 10)],
      ['Service level (verwacht)', '', ...dates.map((d) => (perDag.get(d) ? `${Math.round(perDag.get(d)!.sl * 100)}%` : ''))],
    ];
    return downloadExcel([
      { naam: 'Rooster NBD', rijen: [kop, ...rijen, [], ...voet] },
      { naam: 'Toets', rijen: [['Cijfer', nl(t.cijfer)], ['Service level', pct(t.sl, 1)], ['Getoetst tegen', versieTekst], [], ['Regel', 'Niveau', 'Aantal', 'Waar'], ...t.checks.map((c) => [c.naam, c.niveau, c.items.length, c.items.join(', ')])] },
    ], `rooster-nbd-${dates[0]}`);
  };

  return (
    <>
      <PaginaKop
        boven={<>{NBD_NAAM} · landelijk · open van 7:00 tot 22:30</>}
        titel={<>Rooster <em>NBD</em></>}
        lead={<>Per uur zoveel mensen aan de telefoon als Erlang C vraagt: {pct(p.serviceLevel)} van de gesprekken binnen {p.wachttijd} seconden, {p.aht} seconden per gesprek. Het aantal gesprekken beweegt mee met de overlijdens in de regio&apos;s. Elke dienst heeft eigen tijden, van {nl(p.minDienst)} tot {nl(p.maxDienst)} uur werk; de pauze telt niet mee. <Link href="/nbd/capaciteit" className="font-semibold text-accent">Capaciteit en Erlang</Link></>}
      >
        <label className="label"><span>Toetsen tegen</span>
          <select className="input w-auto" value={versie} onChange={(e) => setVersie(e.target.value as ToetsTegen)}>
            <option value="basis">Roosterbasis</option><option value="laatste">Laatste voorspelling</option><option value="norm">Gemiddeld jaar</option>
          </select>
        </label>
      </PaginaKop>

      {!laatsteData && versie !== 'norm' && <div className="banner banner-info mb-4">Er is nog geen voorspelling. De gesprekken volgen het gemiddelde jaar (de vastgestelde regelplekken van de regio&apos;s, landelijk opgeteld).</div>}
      {ronde && (
        <div className="banner banner-ok mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <CalendarHeart size={18} className="text-accent" />
          <span>Voorkeurenronde {periodeNaam(ronde)}: <b>{Object.keys(ronde.ingediend).length} van {team.length}</b> ingediend, deadline {fmtD(ronde.deadline)}.</span>
          <span className="flex-1" />
          <Link href="/nbd/voorkeuren" className="text-sm font-semibold text-accent">Voorkeuren bekijken</Link>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => naarMaand(volgendeMaand(maand, -1))} aria-label="Vorige maand"><ChevronLeft size={17} /></button>
          <span className="display min-w-[150px] text-center text-[19px] font-semibold capitalize" aria-live="polite">{maandNaam(maand)}</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => naarMaand(volgendeMaand(maand))} aria-label="Volgende maand"><ChevronRight size={17} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => naarMaand(maandVan(vandaag))} disabled={maand === maandVan(vandaag)}>Deze maand</button>
        </div>
        <div className="flex-1" />
        <button type="button" className="btn btn-ghost btn-icon" onClick={doeUndo} disabled={!undo.length} title="Ongedaan maken" aria-label="Ongedaan maken"><Undo2 size={17} /></button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={doeRedo} disabled={!redo.length} title="Opnieuw" aria-label="Opnieuw"><Redo2 size={17} /></button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBevestig('leeg')} disabled={!team.length || !toekomst.length}><Eraser size={15} /> Leegmaken</button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => actie(exporteer)} title="Excel downloaden" aria-label="Excel downloaden" disabled={!team.length}><Download size={17} /></button>
        <button type="button" className="btn btn-ghost" onClick={() => setTakenOpen(true)} disabled={!team.length || !toekomst.length} title="Training, klachten en de maandstart inplannen"><ListChecks size={16} /> Taken</button>
        <button type="button" className="btn btn-teal" onClick={() => setPlan(true)} disabled={!team.length || !bewerkbaar.length}><Wand2 size={16} /> Rooster maken</button>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {team.length ? (
            <div className="scroll max-h-[calc(100vh-180px)]">
              <table className="rs">
                <thead>
                  <tr>
                    <th className="nm"><span className="text-[13px] text-muted">Medewerker</span><small>uren werk / norm</small></th>
                    {dates.map((d, i) => {
                      const n = toDay(d);
                      return (
                        <th key={d} className={cx(weekday(n) % 6 === 0 && 'we', d === vandaag && 'vandaag', wk(d, i))} title={`${fmtDag(d)}, week ${isoWeek(n)}. Klik voor het dagbeeld.`}>
                          <button type="button" className={cx('block w-full', dag === d && 'underline decoration-2 underline-offset-2')} onClick={() => setDag(dag === d ? null : d)} aria-label={`Dagbeeld ${fmtDag(d)}`}>
                            <span className="block text-[10px] font-bold uppercase leading-none opacity-70">{maandKop[i] || ' '}</span>
                            {DAG_KORT[weekday(n)]}<br />{dayOfMonth(n)}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {team.map((e) => {
                    const u = alles.perMedewerker[e.id];
                    const afw = u && u.norm > 0 ? (u.uren - u.norm) / u.norm : 0;
                    const pr = profielen[e.id];
                    return (
                      <tr key={e.id}>
                        <th className="nm">
                          <button type="button" className="block w-full text-left" onClick={() => setMwBewerk(e)} title="Klik om te bewerken">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate">{e.naam}</span>
                              {u && <span className={cx('num text-[12px] font-bold', Math.abs(afw) > 0.1 ? 'text-rood' : 'text-muted')}>{Math.round(u.uren)}/{Math.round(u.norm)}u</span>}
                            </span>
                            <small>{e.extern ? `extern · max ${e.contract} uur` : `${e.contract} uur${maxUren(e) > e.contract ? ` · max ${nlUren(maxUren(e))}` : ''}${pr?.uren ? ` · ${voorkeurKort(pr.uren)}` : pr && pr.dienst !== 'geen' ? ` · liefst ${pr.dienst}` : ''}`}</small>
                          </button>
                        </th>
                        {dates.map((d, c) => {
                          const code = (cellen[e.id]?.[d] ?? '-') as DienstCode;
                          const x = code === 'N' ? dienstVan(e.id, d) : null;
                          const k = `${e.id}|${d}`;
                          const w = wensMap.get(k);
                          const ok = w ? nbdWensOk(w.soort, x, !!DIENSTEN[code]?.werk) : null;
                          const mark = alles.markering[e.id]?.[d];
                          const vk = pr?.uren ? uurVoorkeurDag(pr.uren, d, x) : pr ? dagVoorkeurOp(pr.dagen[weekday(toDay(d))], w?.soort) : undefined;
                          const kan = d >= vandaag;
                          const titel = [
                            `${e.naam}, ${fmtDag(d)}: ${x ? `${dienstTekst(x)}, ${pauzeTekst(x)}, ${nlUren(netto(x))} uur werk (${DAGDEEL_LABEL[dagdeel(x)].toLowerCase()})` : code === 'N' ? 'dienst zonder tijden' : DIENSTEN[code].naam}`,
                            x?.taken?.length ? x.taken.map(taakTekst).join(', ') : '',
                            w ? `Wens: ${WENS_LABEL[w.soort]}${ok === false ? ', niet gehonoreerd' : ''}` : '',
                            aanvraagSet.has(k) ? 'Verlof aangevraagd, nog niet beoordeeld' : '',
                            pr?.uren ? (vk === 'niet' ? 'Kan niet op (een deel van) deze uren' : vk === 'graag' ? 'Werkt graag op deze uren' : '') : vk === 'niet' ? 'Kan niet op deze weekdag' : vk === 'liever_niet' ? 'Werkt liever niet op deze weekdag' : vk === 'graag' ? 'Werkt graag op deze weekdag' : '',
                            mark ? (mark === 'hard' ? 'Overtreding ATW/CAO, zie de toets' : 'Let op, zie de toets') : '',
                          ].filter(Boolean).join('\n');
                          return (
                            <td key={d} title={titel}
                              className={cx('s', `c-${code}`, weekday(toDay(d)) % 6 === 0 && 'we', wk(d, c), mark === 'hard' ? 'x' : mark === 'let' && 'let', !kan && 'verleden', w && w.soort !== 'neutraal' && 'wens', ok && 'ok', vk === 'niet' && 'vk-niet', vk === 'liever_niet' && 'vk-lieverniet', vk === 'graag' && 'vk-graag', aanvraagSet.has(k) && 'outline-dashed outline-2 -outline-offset-[3px] outline-[color:var(--gold)]', x && 'nbd')}
                              onClick={() => kan && setBewerk({ mid: e.id, datum: d })}
                              onKeyDown={(ev) => { if (kan && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); setBewerk({ mid: e.id, datum: d }); } }}
                              tabIndex={kan ? 0 : -1}
                              role="gridcell"
                              aria-label={titel.split('\n')[0]}
                            >
                              {x ? <span className="block leading-[1.05]">{uurTekst(x.start)}<br />{uurTekst(x.eind)}</span> : code === '-' ? '' : code}
                              {x?.taken?.length ? <span className="taken" aria-hidden>{[...new Set(x.taken.map((k) => TAAK_KORT[k.soort]))].join('')}</span> : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="nm" title="Uren aan de telefoon die Erlang C vraagt">Nodig (uur)</th>
                    {dates.map((d, i) => <td key={d} className={cx(wk(d, i), behoefte[d]?.bron === 'norm' && 'font-normal italic')} title={behoefte[d] ? `${Math.round(behoefte[d].gesprekken)} gesprekken verwacht, piek ${behoefte[d].piek} mensen, volgens ${BEHOEFTE_BRON[behoefte[d].bron]}` : undefined}>{behoefte[d] ? Math.round(behoefte[d].uren) : '–'}</td>)}
                  </tr>
                  <tr>
                    <th className="nm" title="Uren aan de telefoon, zonder pauzes">Gepland (uur)</th>
                    {dates.map((d, i) => { const u = perDag.get(d); return <td key={d} className={cx(wk(d, i), u && u.tekortUren > 0.5 && 'low', u && u.overUren > u.nodigUren * 0.25 && 'high')} title={u ? `${nl(u.geplandUren)} uur gepland, ${nl(u.tekortUren)} uur te weinig, ${nl(u.overUren)} uur meer dan nodig` : undefined}>{u ? Math.round(u.geplandUren) : ''}</td>; })}
                  </tr>
                  <tr>
                    <th className="nm" title={`Verwacht deel van de gesprekken binnen ${p.wachttijd} seconden (Erlang C)`}>Service level %</th>
                    {dates.map((d, i) => { const u = perDag.get(d); return <td key={d} className={cx('text-[11px]', wk(d, i), u && u.sl < p.serviceLevel && 'low')}>{u ? Math.round(u.sl * 100) : ''}</td>; })}
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <Leeg titel="Nog geen medewerkers bij de NBD" icoon={<Users size={28} />} actie={
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn" onClick={() => setMwBewerk('nieuw')}><UserPlus size={16} /> Medewerker toevoegen</button>
                {opslag !== 'database' && <button type="button" className="btn btn-ghost" onClick={() => voorbeeldTeamToevoegen(regio)}>Voorbeeldteam toevoegen</button>}
              </div>
            }>Voeg de medewerkers van de nabestaandendesk toe, met hun voorkeuren per uur. Daarna kun je het rooster laten maken.</Leeg>
          )}
          {team.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
              <span>Klik op een vakje om een dienst te zetten, op een datum voor het dagbeeld.</span>
              <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent" style={{ borderTopColor: 'var(--gold)' }} />wens</span>
              <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ boxShadow: 'inset 0 0 0 2px var(--red)' }} />ATW/CAO</span>
              <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ boxShadow: 'inset 0 0 0 2px var(--gold)' }} />let op</span>
              <span><b className="text-[color:var(--plum)]">T</b> {TAAK_LABEL.training.toLowerCase()} · <b className="text-[color:var(--plum)]">K</b> {TAAK_LABEL.klachten.toLowerCase()} · <b className="text-[color:var(--plum)]">M</b> {TAAK_LABEL.maandstart.toLowerCase()} (niet aan de telefoon)</span>
              <span className="italic">schuin = het gemiddelde jaar (geen voorspelling)</span>
              <button type="button" className="ml-auto inline-flex items-center gap-1.5 font-semibold text-accent" onClick={() => setMwBewerk('nieuw')}><UserPlus size={15} /> Medewerker toevoegen</button>
            </div>
          )}
          {dag && behoefte[dag] && (
            <div className="mt-4">
              <div className="mb-2 flex justify-end"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setDag(null)}><X size={14} /> Dagbeeld sluiten</button></div>
              <DagBeeld datum={dag} dag={behoefte[dag]} uitkomst={perDag.get(dag)} team={team} p={p}
                diensten={Object.fromEntries(team.map((m) => [m.id, dienstVan(m.id, dag)]).filter(([, x]) => x)) as Record<string, NbdDienst>}
                onDienst={dag >= vandaag ? (mid) => setBewerk({ mid, datum: dag }) : undefined} />
            </div>
          )}
        </div>

        <aside className="grid gap-4">
          {team.length > 0 && <NbdScorePaneel t={t} p={p} versieTekst={versieTekst} />}
          {team.length > 0 && (
            <Vaststellen
              regio={regio} maand={maand} maanden={goedkeuringen} onMaand={naarMaand} tot={dates[dates.length - 1]} t={t} advies={adviesInfo}
              pub={pub} wijzigingen={wijzigingen} goedkeuring={goedkeuringen?.[maand]} verplicht={beleid.goedkeuringVerplicht} publicatieMaanden={beleid.publicatieMaanden}
              bewerkbaar={bewerkbaar.length > 0} onPubliceer={(van, tot) => { setPubPeriode({ van, tot }); setBevestig('publiceer'); }}
            />
          )}
        </aside>
      </div>

      <DienstModal
        open={!!bewerk} medewerker={bewerkM} datum={bewerk?.datum ?? vandaag} p={p}
        code={bewerk ? ((cellen[bewerk.mid]?.[bewerk.datum] ?? '-') as DienstCode) : '-'}
        dienst={bewerk ? dienstVan(bewerk.mid, bewerk.datum) : null}
        onClose={() => setBewerk(null)}
        onBewaar={(code, x) => { if (bewerk) zet([[bewerk.mid, bewerk.datum, code, x]]); setBewerk(null); }}
      />

      <TakenModal
        open={takenOpen} onClose={() => setTakenOpen(false)} team={team} cellen={cellen} tijden={tijden} behoefte={behoefte} p={p}
        maandDagen={dates} vanaf={dates.find((d) => d > vandaag) ?? addDays(vandaag, 1)} minVrijeWeekenden={beleid.minVrijeWeekenden} profielen={profielen}
        onToepassen={(w, tekst) => { zet(w); setTakenOpen(false); toon(`${tekst.charAt(0).toUpperCase()}${tekst.slice(1)}. Ongedaan maken kan.`); }}
      />

      <NbdPlanModal
        open={plan} onClose={() => setPlan(false)} team={team} cellen={cellen} tijden={tijden} behoefteVan={behoefteVan} p={p}
        profielen={profielen} wensen={wensen} aanvragen={aanvragen} minVrijeWeekenden={beleid.minVrijeWeekenden}
        standaardVan={bewerkbaar[0] ?? dates[0]} standaardTot={dates[dates.length - 1]} huidig={t}
        onToepassen={(w, oms) => { zet(w); setPlan(false); toon(`Rooster gemaakt (${oms}). Je kunt alles nog aanpassen of ongedaan maken.`); }}
      />

      <MedewerkerModal
        open={mwBewerk !== null}
        mw={mwBewerk === 'nieuw' ? null : mwBewerk}
        regio={regio}
        onClose={() => setMwBewerk(null)}
        onBewaar={(m: MedewerkerInvoer) => { bewaarMedewerker({ ...m, regio }); setMwBewerk(null); toon(`${m.naam} is opgeslagen.`); }}
        onVerwijder={(id) => { verwijderMedewerker(id); setMwBewerk(null); toon('Medewerker verwijderd.'); }}
      />

      <Modal
        open={bevestig !== null}
        onClose={() => setBevestig(null)}
        titel={bevestig === 'leeg' ? 'Rooster leegmaken?' : 'Rooster NBD publiceren?'}
        voet={<>
          <button type="button" className="btn btn-ghost" onClick={() => setBevestig(null)}>Annuleren</button>
          {bevestig === 'leeg'
            ? <button type="button" className="btn btn-danger" onClick={leegmaken}><Eraser size={16} /> Leegmaken</button>
            : <button type="button" className="btn" onClick={() => actie(() => { publiceer(regio, pubPeriode?.van ?? vandaag, pubPeriode?.tot ?? dates[dates.length - 1], door); setBevestig(null); }, 'Rooster gepubliceerd. Medewerkers zien de nieuwe versie.')}><Send size={16} /> Publiceren</button>}
        </>}
      >
        {bevestig === 'leeg'
          ? <p>Alle diensten vanaf morgen in {maandNaam(maand)} worden gewist. Verlof en ziekte blijven staan. Je kunt dit ongedaan maken zolang je op deze pagina blijft.</p>
          : <>
              <p>Het rooster van {fmtD(pubPeriode?.van ?? vandaag)} t/m {fmtD(pubPeriode?.tot ?? dates[dates.length - 1])} wordt zichtbaar voor de medewerkers van de NBD.</p>
              {t.hard > 0 && <p className="banner banner-err mt-3">Let op: dit rooster heeft {plural(t.hard, 'harde overtreding', 'harde overtredingen')} van ATW of CAO.</p>}
            </>}
      </Modal>
    </>
  );
}
