'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Anchor, ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import { useSessie, useDoor } from '@/components/sessie';
import { NaarNbd } from '@/components/nbd/NaarNbd';
import { useActie } from '@/components/toast';
import { Box, GeenToegang, Laden, Leeg, PaginaKop, Pill, Sectie } from '@/components/ui';
import { ForecastChart, Legenda } from '@/components/voorspelling/ForecastChart';
import { DagDetail, Heatmap, Ontwikkeling, clustersVoorScope } from '@/components/voorspelling/Onderdelen';
import { Begrippen, Betrouwbaarheid, Samenvatting, Uitgelegd, useTerugblik } from '@/components/voorspelling/Uitleg';
import { PlekkenVoorspelling } from '@/components/voorspelling/Plekken';
import { Morgen } from '@/components/voorspelling/Morgen';
import { useApp, vastleggenRoosterbasis, useOpslagwijze } from '@/lib/store/store';
import { useAlleRuns, useRunData, useTerugtest } from '@/lib/store/hooks';
import { lam, plekken, som, meldingenEind } from '@/lib/store/afgeleid';
import type { RunData } from '@/lib/model/types';
import type { Beleid } from '@/lib/rooster/types';
import { CLUSTERS, CLUSTER_NAAM, HORIZON_DAYS, REGIONS, REGION_CLUSTER, regionsInScope, scopeLabel } from '@/lib/model/config';
import { poissonBand } from '@/lib/model/poisson';
import { DAG_KORT, DAG_LANG, addDays, fmtD, fmtDJ, fmtMoment, toDay, weekday, diffDays } from '@/lib/dates';
import { nl, pct, pctS } from '@/lib/format';
import { afdrukken, downloadExcel } from '@/lib/export';
import { normRun } from '@/lib/capaciteit/normrun';
import { borgingWeek, lamNormWeek, normWeek } from '@/lib/capaciteit/norm';
import { clusterDag } from '@/lib/capaciteit/beschikbaarheid';
import { clusterVoorspeld } from '@/lib/capaciteit/plekkans';
import { kans1BUitleg } from '@/lib/rooster/kans1b';
import { todayIso } from '@/lib/dates';

/** Zo ver vooruit kan de uitleg per dag (daarna geldt hetzelfde seizoenspatroon). */
const VERDER_DAGEN = 365;

export default function VoorspellingPagina() {
  return <Suspense fallback={<Laden />}><NaarNbd naar="/nbd/capaciteit"><Voorspelling /></NaarNbd></Suspense>;
}

function Voorspelling() {
  const s = useSessie();
  const opslag = useOpslagwijze();
  const door = useDoor();
  const actie = useActie();
  const router = useRouter();
  const params = useSearchParams();
  const runs = useApp((x) => x.runs);
  const rbInfo = useApp((x) => x.roosterbasis);
  const beleid = useApp((x) => x.beleid);
  const normen = useApp((x) => x.normen);
  const meldingen = useApp((x) => x.meldingen);
  const runId = params.get('run') ?? runs[0]?.id ?? null;
  // zonder eigen meldingen: de vastgestelde regelplekken als voorspelling
  const norm = useMemo(() => (runs.length ? null : normRun(normen, todayIso())), [runs.length, normen]);
  const meta = runs.find((r) => r.id === runId) ?? runs[0] ?? norm?.meta ?? null;
  const runData = useRunData(norm ? null : meta?.id);
  const run = norm ? norm.data : runData;
  const rbMeta = rbInfo ? runs.find((r) => r.id === rbInfo.runId) ?? null : null;
  const rb = useRunData(rbMeta?.id);
  const alle = useAlleRuns();

  const alleRegios = s.regios.length === REGIONS.length;
  const [scope, setScope] = useState<string>(alleRegios ? 'NL' : `R:${s.regios[0]}`);
  const [sel, setSel] = useState<string | null>(null);
  const [uitlegRegio, setUitlegRegio] = useState<string | null>(null);
  // de dag van de uitleg: die van de grafiek, of verder vooruit (dan met de vastgestelde regelplekken)
  const [uitlegDag, setUitlegDag] = useState<string | null>(null);
  const verderRun = useMemo(() => normRun(normen, todayIso(), VERDER_DAGEN), [normen]);
  const verder = verderRun.data;
  useEffect(() => {
    if (run && (!sel || !run.dates.includes(sel))) setSel(run.dates[Math.min(3, run.dates.length - 1)]);
  }, [run, sel]);
  useEffect(() => setUitlegDag(null), [sel]);

  const regs = regionsInScope(scope);
  const terugblik = useTerugblik(runs, alle, meldingen, regs);
  const terugtest = useTerugtest();
  const reeks = useMemo(() => {
    if (!run) return null;
    return {
      dates: run.dates,
      nu: run.dates.map((d) => som(run, regs, d) ?? 0),
      basis: run.dates.map((d) => som(run, regs, d, true) ?? 0),
      roosterbasis: rb && rb.id !== run.id ? run.dates.map((d) => som(rb, regs, d)) : null,
    };
  }, [run, rb, regs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s.isPlanner) return <GeenToegang />;
  if (!s.regios.length) return <Leeg titel="Geen regio's">De voorspelling gaat over de meldingen per regio. De verwachting voor de nabestaandendesk staat bij Capaciteit.</Leeg>;
  if (!meta) return <Leeg titel="Nog geen voorspelling">{opslag !== 'database' ? 'Lees eerst meldingen in of laad de demo' : 'De beheerder leest eerst de meldingenhistorie in (Bronnen en model)'}; daarna verschijnt hier de eerste run.</Leeg>;
  if (!run || !reeks) return <Laden />;

  const gem = reeks.nu.reduce((a, b) => a + b, 0) / reeks.nu.length;
  const gemB = reeks.basis.reduce((a, b) => a + b, 0) / reeks.basis.length;
  const info = meta.info;
  const isLaatste = meta.id === runs[0]?.id;
  const isBasis = meta.id === rbInfo?.runId;
  const clusters = clustersVoorScope(scope);
  const eind = meldingen ? meldingenEind(meldingen) : null;
  const dagU = uitlegDag ?? sel;
  // binnen de voorspelling die run, daarna de vastgestelde regelplekken
  const runU = dagU && !run.dates.includes(dagU) ? verder : run;
  // de regio voor de uitleg: gekozen, anders de drukste op de gekozen dag
  const uitlegRegios = dagU ? [...regs].sort((a, b) => (lam(runU, b, dagU) ?? 0) - (lam(runU, a, dagU) ?? 0)) : regs;
  const regioUitleg = uitlegRegio && regs.includes(uitlegRegio) ? uitlegRegio : uitlegRegios[0];
  const kUitleg = dagU && regioUitleg ? plekken(runU, regioUitleg, dagU, beleid.alphaRegio) : null;
  const eersteU = run.dates[0], laatsteU = verder.dates[verder.dates.length - 1];
  const morgen = addDays(todayIso(), 1);
  const gisteren = addDays(todayIso(), -1);
  const gerealiseerd = sel && meldingen && eind && sel <= eind
    ? regs.reduce((acc, r) => acc + (meldingen.regios[r]?.[toDay(sel) - toDay(meldingen.start)] ?? 0), 0)
    : null;

  const exporteerExcel = () => {
    const kop = ['Regio', 'Cluster', ...run.dates];
    const regios = REGIONS.filter((r) => s.regios.includes(r));
    const clusterVan = (r: string) => Object.keys(CLUSTERS).find((c) => CLUSTERS[c].includes(r)) ?? '';
    return downloadExcel([
      { naam: `Plekken op ${Math.round(beleid.alphaRegio * 100)}%`, rijen: [kop, ...regios.map((r) => [r, clusterVan(r), ...run.dates.map((d) => plekken(run, r, d, beleid.alphaRegio))])] },
      { naam: 'Verwachte meldingen', rijen: [kop, ...regios.map((r) => [r, clusterVan(r), ...run.dates.map((d) => { const v = lam(run, r, d); return v == null ? null : Math.round(v * 100) / 100; })])] },
      {
        naam: scopeLabel(scope),
        rijen: [['Datum', 'Dag', 'Verwacht', 'Basismodel', 'Roosterbasis', 'Band 10%', 'Band 90%'], ...run.dates.map((d, i) => [d, DAG_KORT[weekday(toDay(d))], Math.round(reeks.nu[i] * 10) / 10, Math.round(reeks.basis[i] * 10) / 10, reeks.roosterbasis?.[i] != null ? Math.round(reeks.roosterbasis[i]! * 10) / 10 : null, poissonBand(0.1, reeks.nu[i]), poissonBand(0.9, reeks.nu[i])])],
      },
    ], `voorspelling-${meta.uitgegeven}`);
  };

  const printen = () => {
    const regios = clusters.flatMap((c) => CLUSTERS[c]).filter((r) => s.regios.includes(r));
    afdrukken({
      titel: `Regelplekken op ${Math.round(beleid.alphaRegio * 100)}% · ${scopeLabel(scope)}`,
      ondertitel: `Run van ${fmtDJ(meta.uitgegeven)}, ${fmtD(run.dates[0])} t/m ${fmtD(run.dates[run.dates.length - 1])}`,
      kop: ['Regio', ...run.dates.map((d) => `${DAG_KORT[weekday(toDay(d))]} ${d.slice(8)}`)],
      rijen: regios.map((r) => [r, ...run.dates.map((d) => plekken(run, r, d, beleid.alphaRegio))]),
      voet: [['Totaal', ...run.dates.map((d) => regios.reduce((acc, r) => acc + (plekken(run, r, d, beleid.alphaRegio) ?? 0), 0))]],
    });
  };

  return (
    <>
      <PaginaKop
        titel={`Komende ${run.dates.length} dagen`}
        lead={norm ? (
          <>
            Gemiddeld <b className="text-ink">{nl(gem, gem > 50 ? 0 : 1)}</b> meldingen per dag {scopeLabel(scope)}. Er is nog geen eigen meldingenhistorie ingelezen, dus dit is de verwachting uit de {normen.bron.toLowerCase()}: natura plus vrije markt, met het seizoen en de weekdag per regio.
            De plekken rekenen op {Math.round(beleid.alphaRegio * 100)}% per regio en {Math.round(beleid.alphaCluster * 100)}% per cluster.
          </>
        ) : (
          <>
            Gemiddeld <b className="text-ink">{nl(gem, gem > 50 ? 0 : 1)}</b> meldingen per dag {scopeLabel(scope)}, {pctS(gem / gemB - 1)} ten opzichte van het basismodel.
            Run van {fmtD(meta.uitgegeven)}{info.data_end ? `, meldingen t/m ${fmtD(info.data_end)}` : ''}.{info.notes.length ? ` ${info.notes.join('. ')}.` : ''}
          </>
        )}
        boven={norm ? <Pill soort="info">Vastgestelde regelplekken</Pill> : !isLaatste ? <Pill soort="warn">Je bekijkt een oudere run</Pill> : isBasis ? <Pill soort="warn">Dit is de roosterbasis</Pill> : undefined}
      >
        <label className="label"><span>Weergave</span>
          <select className="input w-auto min-w-[200px]" value={scope} onChange={(e) => setScope(e.target.value)}>
            {alleRegios && <option value="NL">Landelijk</option>}
            {Object.keys(CLUSTERS).filter((c) => CLUSTERS[c].some((r) => s.regios.includes(r))).map((c) => (
              <optgroup key={c} label={`Cluster ${CLUSTER_NAAM[c]}`}>
                {CLUSTERS[c].every((r) => s.regios.includes(r)) && <option value={`C:${c}`}>Cluster {CLUSTER_NAAM[c]} totaal</option>}
                {CLUSTERS[c].filter((r) => s.regios.includes(r)).map((r) => <option key={r} value={`R:${r}`}>{r}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {!norm && <label className="label"><span>Run</span>
          <select className="input w-auto" value={meta.id} onChange={(e) => router.replace(e.target.value === runs[0]?.id ? '/voorspelling' : `/voorspelling?run=${encodeURIComponent(e.target.value)}`)}>
            {runs.map((r, i) => <option key={r.id} value={r.id}>{fmtMoment(`${r.uitgegeven}T${r.gemaakt.slice(11, 16)}`)} · {r.soort}{i === 0 ? ' (laatste)' : ''}{r.id === rbInfo?.runId ? ' (roosterbasis)' : ''}</option>)}
          </select>
        </label>}
        <div className="flex gap-2 self-end">
          {!norm && <button type="button" className="btn" disabled={isBasis} onClick={() => actie(() => vastleggenRoosterbasis(meta.id, door), 'Deze run is vastgelegd als roosterbasis. Het rooster wordt daar standaard tegen getoetst.')}>
            <Anchor size={16} /> {isBasis ? 'Is roosterbasis' : 'Vastleggen als roosterbasis'}
          </button>}
          <button type="button" className="btn btn-ghost btn-icon" title="Excel downloaden" aria-label="Excel downloaden" onClick={() => actie(exporteerExcel)}><Download size={17} /></button>
          <button type="button" className="btn btn-ghost btn-icon" title="Afdrukken of PDF" aria-label="Afdrukken of PDF" onClick={() => actie(printen)}><Printer size={17} /></button>
        </div>
      </PaginaKop>

      <Samenvatting run={run} rb={rb && rb.id !== run.id ? rb : null} regios={regs} scopeNaam={scopeLabel(scope)} beleid={beleid} />

      {run.dates.includes(morgen) && (
        <Sectie
          className="!mt-0 mb-6"
          titel={`Morgen, ${DAG_LANG[weekday(toDay(morgen))]} ${fmtD(morgen)}`}
          lead={<>Per cluster en regio wat we verwachten, hoeveel het hoogstens wordt en de plekken die daarbij horen.{!norm && info.data_end && info.data_end < gisteren ? <> <b className="text-ink">De meldingen lopen t/m {fmtD(info.data_end)}.</b> Lees de meldingen t/m gisteren in en maak een nieuwe voorspelling: dan is morgen het scherpst.</> : null}</>}
        >
          <Morgen run={run} datum={morgen} regios={s.regios} clusters={clusters} alpha={beleid.alphaRegio} terugtest={norm ? null : terugtest} />
        </Sectie>
      )}

      <div className="box">
        <ForecastChart reeks={reeks} sel={sel} onSel={setSel} />
        <Legenda roosterbasis={!!reeks.roosterbasis} />
        <p className="note mt-2">{norm ? 'Dit zijn de vastgestelde regelplekken' : `Na deze ${HORIZON_DAYS} dagen rekent GRIP met de vastgestelde regelplekken`}: het volume uit de begroting, met het seizoen en de weekdag per regio. <Link href="/capaciteit" className="text-accent">Meer over de vastgestelde regelplekken</Link></p>
      </div>

      {sel && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <DagDetail run={run} meta={meta} rb={rb && rb.id !== run.id ? rb : null} datum={sel} regios={regs} scopeNaam={scopeLabel(scope)} alpha={beleid.alphaRegio} terugblik={norm ? undefined : terugblik} />
          {norm ? <Kans1BDag clusters={clusters} normen={normen} beleid={beleid} run={run} datum={sel} /> : <Ontwikkeling datum={sel} regios={regs} runs={runs} data={alle} rbId={rbInfo?.runId ?? null} huidigId={meta.id} gerealiseerd={gerealiseerd} />}
        </div>
      )}

      {dagU && regioUitleg && (
        <Sectie
          id="waarom"
          titel={kUitleg != null ? `Waarom ${kUitleg} plekken in ${regioUitleg}?` : `Plekken in ${regioUitleg}`}
          lead={<>{DAG_LANG[weekday(toDay(dagU))].replace(/^./, (x) => x.toUpperCase())} {fmtDJ(dagU)}{runU === verder && !norm ? <>, na de voorspelling van {run.dates.length} dagen: <b className="text-ink">volgens de vastgestelde regelplekken</b></> : ''}. Per plek hoe vaak hij valt, en voor wie: een melding uit de eigen regio of uit een andere regio in het cluster. Een melding gaat eerst naar een eigen plek, dan naar een vrije plek elders in het cluster. Pas als alle reguliere plekken in het cluster bezet zijn, valt er een 1B.</>}
          rechts={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1" role="group" aria-label="Dag van de uitleg">
                <button type="button" className="btn btn-ghost btn-icon" disabled={dagU <= eersteU} onClick={() => setUitlegDag(addDays(dagU, -1))} aria-label="Dag eerder"><ChevronLeft size={17} /></button>
                <input className="input w-auto" type="date" min={eersteU} max={laatsteU} value={dagU} onChange={(e) => { const d = e.target.value; if (d >= eersteU && d <= laatsteU) setUitlegDag(d); }} aria-label="Dag" />
                <button type="button" className="btn btn-ghost btn-icon" disabled={dagU >= laatsteU} onClick={() => setUitlegDag(addDays(dagU, 1))} aria-label="Dag later"><ChevronRight size={17} /></button>
              </div>
              {uitlegRegios.length > 1 && (
                <select className="input w-auto" value={regioUitleg} onChange={(e) => setUitlegRegio(e.target.value)} aria-label="Regio voor de uitleg">
                  {uitlegRegios.map((r) => <option key={r}>{r}</option>)}
                </select>
              )}
            </div>
          }
        >
          <PlekkenVoorspelling run={runU} datum={dagU} regio={regioUitleg} beleid={beleid} uitval={normen.uitval} />
          {!norm && runU === run && <div className="mt-5"><Kans1BDag clusters={clusters} normen={normen} beleid={beleid} run={run} datum={dagU} /></div>}
        </Sectie>
      )}

      {dagU && regioUitleg && (
        <Sectie titel="Wat betekent deze voorspelling?" lead={`Van het normale patroon, via de actuele signalen, naar een kans en het aantal plekken, voor ${fmtDJ(dagU)}. Kies een dag in de grafiek of hierboven bij de uitleg, en een regio.`}>
          <Uitgelegd run={runU} meta={runU === verder ? verderRun.meta : meta} datum={dagU} regios={uitlegRegios} regio={regioUitleg} onRegio={setUitlegRegio} beleid={beleid} normen={normen} />
        </Sectie>
      )}

      <Sectie
        titel="Plekken per regio"
        lead={<>Benodigde regelplekken op {Math.round(beleid.alphaRegio * 100)}% per regio volgens {norm ? 'de vastgestelde regelplekken' : 'deze run'}. Een getal met kader wijkt af van de roosterbasis{rbMeta ? ` (run van ${fmtD(rbMeta.uitgegeven)})` : ''}: rood hoger, blauw lager. De clusterregel toont de dekking bij uithelpen; goud is onder {Math.round(beleid.alphaCluster * 100)}%. Klik op een regio voor het rooster.</>}
      >
        <Heatmap run={run} rb={rb && rb.id !== run.id ? rb : null} dates={run.dates} clusters={clusters} alpha={beleid.alphaRegio} alphaCluster={beleid.alphaCluster} />
      </Sectie>

      {norm && sel && (
        <Sectie titel={`Te borgen in week ${normWeek(sel)}`} lead={`Regelplekken op ${Math.round(normen.dekkingRegio * 100)}% per regio (inclusief de 1B), plus het aandeel in de speling voor ${Math.round(normen.dekkingCluster * 100)}% per cluster. Uren: een plek ${normen.dienstUren} uur, een 1B ${nl(normen.beschikbaarKans * normen.dienstUren)} uur, een voorgang ${normen.voorgangUren} uur.`}>
          <Borging regios={regs} normen={normen} datum={sel} metSpeling={beleid.clusterSpeling} />
        </Sectie>
      )}

      {!norm && <>
      <Sectie titel="Hoe goed voorspellen we?" lead="Elke run wordt bewaard. Zodra een dag voorbij is, vergelijken we wat we voorspelden met wat er werkelijk binnenkwam.">
        <Betrouwbaarheid b={terugblik} scopeNaam={scopeLabel(scope)} />
      </Sectie>

      <Sectie titel="Signalen in deze run" lead="De actuele signalen waarmee deze run is bijgestuurd, op de uitgiftedatum.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Signaal label="Drukte afgelopen week" waarde={pctS(Math.exp(info.mom7) - 1)} uitleg="t.o.v. basismodel" />
          <Signaal label="Niveau afgelopen 4 weken" waarde={pctS(Math.exp(info.level28) - 1)} uitleg="t.o.v. basismodel" />
          <Signaal label="CBS-sterfte (4 weken)" waarde={info.cbs ? pctS(Math.exp(info.cbs) - 1) : '–'} uitleg="t.o.v. zelfde weken vorige 3 jaar" />
          <Signaal label="Rioolwater COVID" waarde={info.covid ? `${info.covid > 0 ? '+' : '−'}${nl(Math.abs(info.covid), 2)}` : '–'} uitleg="verdubbelingen t.o.v. jaarmediaan" />
          <Signaal label="Griep (Nivel)" waarde={info.flu ? nl(info.flu * 50 + 50, 0) : '–'} uitleg="consulten per 100.000" />
        </div>
        <p className="note mt-3">Uitgegeven {fmtDJ(meta.uitgegeven)}, soort: {meta.soort}. {diffDays(run.dates[0], meta.uitgegeven) === 1 ? 'De voorspelling begint de dag na uitgifte.' : ''}</p>
      </Sectie>
      </>}

      <Sectie titel="Begrippen" lead="De woorden op deze pagina in het kort.">
        <Begrippen />
      </Sectie>
    </>
  );
}

function Signaal({ label, waarde, uitleg }: { label: string; waarde: string; uitleg: string }) {
  return (
    <Box>
      <div className="display num text-[30px] font-semibold leading-none">{waarde}</div>
      <div className="mt-1.5 text-sm font-semibold">{label}</div>
      <div className="note">{uitleg}</div>
    </Box>
  );
}

/** Zonder eigen voorspelling: wat de regio's in de week van de gekozen dag moeten borgen, zoals de vastgestelde regelplekken. */
function Borging({ regios, normen, datum, metSpeling }: { regios: string[]; normen: Parameters<typeof borgingWeek>[0]; datum: string; metSpeling: boolean }) {
  const week = normWeek(datum);
  const rijen = regios.map((r) => ({ r, b: borgingWeek(normen, r, week, metSpeling) })).filter((x) => x.b);
  const tot = (f: (b: NonNullable<ReturnType<typeof borgingWeek>>) => number) => rijen.reduce((a, x) => a + f(x.b!), 0);
  const meldingen = (r: string) => Array.from({ length: 7 }, (_, d) => lamNormWeek(normen, r, week, d) ?? 0).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="scroll">
        <table className="tb">
          <thead><tr><th>Regio</th><th>Cluster</th><th className="r">Meldingen</th><th className="r">Regelplekken</th><th className="r">Waarvan 1B</th><th className="r">Voorgangen</th><th className="r">Eigen borging (uur)</th><th className="r">Speling (uur)</th><th className="r">Te borgen (uur)</th></tr></thead>
          <tbody>
            {rijen.map(({ r, b }) => (
              <tr key={r}>
                <td className="whitespace-nowrap font-semibold">{r}</td><td className="text-muted">{CLUSTER_NAAM[REGION_CLUSTER[r]]}</td><td className="r">{nl(meldingen(r))}</td>
                <td className="r">{b!.plekkenWeek}</td><td className="r">{b!.beschikbaar}</td><td className="r">{b!.voorgangen}</td>
                <td className="r">{nl(b!.urenEigen, 0)}</td><td className="r">{nl(b!.urenSpeling)}</td><td className="r font-semibold">{nl(b!.totaal, 0)}</td>
              </tr>
            ))}
            {rijen.length > 1 && (
              <tr className="font-semibold">
                <td>Totaal</td><td /><td className="r">{nl(rijen.reduce((a, x) => a + meldingen(x.r), 0), 0)}</td><td className="r">{tot((b) => b.plekkenWeek)}</td><td className="r">{tot((b) => b.beschikbaar)}</td><td className="r">{tot((b) => b.voorgangen)}</td>
                <td className="r">{nl(tot((b) => b.urenEigen), 0)}</td><td className="r">{nl(tot((b) => b.urenSpeling))}</td><td className="r">{nl(tot((b) => b.totaal), 0)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="note mt-2">Per regio en per week over het hele jaar, met de bezetting en de ruimte voor verlof: <Link className="font-semibold text-accent" href="/capaciteit">Capaciteit</Link>.</p>
    </>
  );
}

/** Per cluster op de gekozen dag: de kans dat er een 1B valt, met de plekken uit deze voorspelling. */
function Kans1BDag({ clusters, normen, beleid, run, datum }: { clusters: string[]; normen: Parameters<typeof borgingWeek>[0]; beleid: Beleid; run: RunData; datum: string }) {
  const rijen = clusters.map((c) => {
    const v = clusterVoorspeld(CLUSTERS[c], (r) => lam(run, r, datum), { alphaRegio: beleid.alphaRegio, alphaCluster: beleid.alphaCluster, beschikbaarPerDag: beleid.beschikbaarPerDag, speling: beleid.clusterSpeling });
    return { c, k: v ? clusterDag(v.dagen, normen.uitval, v.speling) : null };
  }).filter((x) => x.k);
  return (
    <Box>
      <h3 className="kop-s">Per cluster: kans dat een 1B valt, {DAG_LANG[weekday(toDay(datum))]} {fmtD(datum)}</h3>
      <p className="note mt-1">Een melding gaat eerst naar een vrije plek in het cluster; pas als alle reguliere plekken bezet zijn{normen.uitval > 0 ? `, ook door ziekte (${pct(normen.uitval, 1)} per dienst)` : ''}, valt er een 1B.</p>
      <div className="scroll mt-3">
        <table className="tb">
          <thead><tr><th>Cluster</th><th className="r">Meldingen</th><th className="r">Plekken</th><th className="r">1B</th><th className="r">Een 1B valt</th><th className="r">Per 1B</th><th className="r" title="Gemiddeld over de regio's: de kans als elke regio alles zelf moest opvangen">Zonder cluster</th></tr></thead>
          <tbody>
            {rijen.map(({ c, k }) => (
              <tr key={c} title={kans1BUitleg(k!, '', CLUSTER_NAAM[c], normen.uitval)}>
                <td className="font-semibold">{CLUSTER_NAAM[c]}</td><td className="r">{nl(k!.cluster.lam)}</td><td className="r">{k!.cluster.regulier}</td><td className="r">{k!.cluster.beschikbaar}</td>
                <td className="r">{pct(k!.cluster.minstensEen)}</td><td className="r font-semibold">{pct(k!.cluster.gemiddeld)}</td>
                <td className="r text-muted">{pct(k!.regios.reduce((a, r) => a + r.alleen, 0) / Math.max(1, k!.regios.length))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note mt-2">De borging rekent met een vaste kans van {pct(normen.beschikbaarKans, 1)}. Over het hele jaar per cluster: <Link className="font-semibold text-accent" href="/capaciteit">Capaciteit</Link>.</p>
    </Box>
  );
}
