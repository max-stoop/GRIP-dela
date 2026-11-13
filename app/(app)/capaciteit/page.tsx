'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { GeenToegang, Laden, PaginaKop, Pill, Sectie, Segment } from '@/components/ui';
import { useApp } from '@/lib/store/store';
import { CLUSTER_NAAM, CLUSTERS, HORIZON_DAYS, REGIONS, REGION_CLUSTER } from '@/lib/model/config';
import { clusterDag, kans1BJaar, normRegioDag, spelingOpDag } from '@/lib/capaciteit/beschikbaarheid';
import { normWeek, regiosVanCluster } from '@/lib/capaciteit/norm';
import { addDays, fmtLang, toDay, todayIso, weekdayMon } from '@/lib/dates';
import { borgingWeek, capaciteitWeek, regioJaar, WEKEN, type RegioJaar } from '@/lib/capaciteit/norm';
import { bezettingTeam } from '@/lib/capaciteit/verlof';
import { cx, nl, nlInt, pct } from '@/lib/format';
import { useWerkregio } from '@/lib/werkregio';
import { NaarNbd } from '@/components/nbd/NaarNbd';

type Bron = 'begroting' | 'team';

/** De capaciteit van de regio's. De nabestaandendesk heeft een eigen module (/nbd/capaciteit). */
export default function CapaciteitPagina() {
  return <Suspense fallback={<Laden />}><NaarNbd naar="/nbd/capaciteit"><Capaciteit /></NaarNbd></Suspense>;
}

function Capaciteit() {
  const s = useSessie();
  const normen = useApp((x) => x.normen);
  const beleid = useApp((x) => x.beleid);
  const medewerkers = useApp((x) => x.medewerkers);
  const [bron, setBron] = useState<Bron>('begroting');
  const mijnRegios = REGIONS.filter((r) => s.regios.includes(r)).sort();
  const [regio, setRegio] = useWerkregio(mijnRegios);

  // bij "team" rekenen we met de contracturen in GRIP; verzuim- en verlofnorm uit het beleid
  const n = useMemo(() => ({ ...normen, verzuim: beleid.verzuimNorm, verlof: beleid.verlofNorm }), [normen, beleid.verzuimNorm, beleid.verlofNorm]);
  const rijen = useMemo(() => mijnRegios.map((r) => {
    const team = bezettingTeam(medewerkers, r);
    return regioJaar(n, r, bron === 'team' && team ? () => team : undefined, beleid.clusterSpeling);
  }).filter((x): x is RegioJaar => !!x), [mijnRegios.join('|'), n, bron, medewerkers, beleid.clusterSpeling]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s.isPlanner) return <GeenToegang />;
  const som = (k: keyof RegioJaar) => rijen.reduce((a, r) => a + (r[k] as number), 0);
  const totaal = { volume: som('volume'), meldingen: som('meldingenPerDag'), plekken: som('plekkenPerWeek'), borging: som('borging'), bezetting: som('bezetting'), ruimte: som('ruimte') };

  return (
    <>
      <PaginaKop
        boven={normen.bron}
        titel={<>Capaciteit <em>en formatie</em></>}
        lead={<>
          Van volume naar ruimte: hoeveel meldingen, hoeveel regelplekken, hoeveel uren moet een regio borgen, en wat blijft er over na verzuim en verlof. Precies zoals de vastgestelde regelplekken. Na de voorspelling van {HORIZON_DAYS} dagen rekent ook het rooster hiermee.
          {s.isBeheerder ? <> <Link href="/model#vastgesteld" className="text-accent">Opnieuw berekenen</Link> uit de eigen meldingen of <Link href="/instellingen#normen" className="text-accent">aanpassen</Link>.</> : ' De beheerder past ze aan.'}
        </>}
      >
        <Segment label="Bezetting" waarde={bron} onChange={setBron} opties={[['begroting', 'Formatie uit de begroting'], ['team', "Teams in GRIP"]]} />
      </PaginaKop>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="De keten">
        {[
          ['Volume per jaar', nlInt(totaal.volume), 'natura plus vrije markt'],
          ['Meldingen per dag', nl(totaal.meldingen), 'basis x seizoen x weekdag'],
          ['Regelplekken per week', nlInt(totaal.plekken), `${pct(n.dekkingRegio)} per regio, incl. 1B`],
          ['Te borgen uren per week', nlInt(totaal.borging), 'plekken, 1B, voorgangen, speling'],
          ['Ruimte over per week', `${nlInt(totaal.ruimte)} uur`, `${nl(totaal.ruimte / n.urenPerFte)} fte na verzuim en verlof`],
        ].map(([t, v, sub], i) => (
          <li key={t} className={cx('list-none', i === 4 ? 'box-focus' : 'box')}>
            <div className="flex items-center gap-2 text-[13px] font-semibold opacity-80"><span className={cx('grid h-6 w-6 place-items-center rounded-full text-[12px]', i === 4 ? 'bg-white/15' : 'bg-soft')}>{i + 1}</span>{t}</div>
            <div className="display mt-2 text-[30px] font-semibold leading-none">{v}</div>
            <div className={cx('mt-1 text-[13px]', i === 4 ? 'opacity-80' : 'note')}>{sub}</div>
          </li>
        ))}
      </ol>

      <Sectie titel="Per regio" lead={`Gemiddeld over het jaar. Bezetting ${bron === 'team' ? 'uit de contracturen van de teams in GRIP' : 'uit de formatie in de begroting (fte x 40 uur)'}; verzuim ${pct(n.verzuim, 1)} en verlof ${pct(n.verlof, 1)} volgens norm.`}>
        <div className="scroll">
          <table className="tb">
            <thead>
              <tr>
                <th>Regio</th><th>Cluster</th><th className="r">Volume</th><th className="r">Meldingen/dag</th><th className="r">Amplitude</th><th className="r">Plekken/week</th>
                <th className="r">Eigen borging</th><th className="r">Speling</th><th className="r">Te borgen</th><th className="r">Bezetting</th><th className="r">Verzuim</th><th className="r">Verlof norm</th><th className="r">Ruimte</th><th className="r">In fte</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r.regio} className={cx('klik', r.regio === regio && 'bg-soft')} onClick={() => setRegio(r.regio)}>
                  <td className="whitespace-nowrap font-semibold">{r.regio}</td>
                  <td className="text-muted">{CLUSTER_NAAM[r.cluster]}</td>
                  <td className="r">{nlInt(r.volume)}</td>
                  <td className="r">{nl(r.meldingenPerDag)}</td>
                  <td className="r">{nl(r.amplitude, 2)}</td>
                  <td className="r">{nl(r.plekkenPerWeek)}</td>
                  <td className="r">{nlInt(r.urenEigen)}</td>
                  <td className="r">{nl(r.urenSpeling)}</td>
                  <td className="r font-semibold">{nlInt(r.borging)}</td>
                  <td className="r">{nlInt(r.bezetting)}</td>
                  <td className="r">{nlInt(r.verzuim)}</td>
                  <td className="r">{nlInt(r.verlofNorm)}</td>
                  <td className={cx('r font-semibold', r.ruimte < 0 ? 'text-rood' : 'text-teal')}>{nlInt(r.ruimte)}</td>
                  <td className={cx('r', r.ruimte < 0 && 'text-rood')}>{nl(r.ruimteMdw)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>Totaal</td><td /><td className="r">{nlInt(totaal.volume)}</td><td className="r">{nl(totaal.meldingen)}</td><td /><td className="r">{nlInt(totaal.plekken)}</td>
                <td className="r">{nlInt(som('urenEigen'))}</td><td className="r">{nlInt(som('urenSpeling'))}</td><td className="r">{nlInt(totaal.borging)}</td><td className="r">{nlInt(totaal.bezetting)}</td><td className="r">{nlInt(som('verzuim'))}</td><td className="r">{nlInt(som('verlofNorm'))}</td>
                <td className={cx('r', totaal.ruimte < 0 ? 'text-rood' : 'text-teal')}>{nlInt(totaal.ruimte)}</td><td className="r">{nl(totaal.ruimte / n.urenPerFte)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note mt-2">Ruimte over = bezetting min verzuim min verlof volgens norm min de te borgen uren. Negatief betekent: meer uren nodig dan de formatie levert, op te vangen met externen of meeruren (beleid § 3.5).</p>
      </Sectie>

      {regio && <RegioWeken regio={regio} n={n} bron={bron} />}
      {regio && <Kans1B regio={regio} n={n} regios={mijnRegios} />}
    </>
  );
}

function RegioWeken({ regio, n, bron }: { regio: string; n: Parameters<typeof borgingWeek>[0]; bron: Bron }) {
  const medewerkers = useApp((x) => x.medewerkers);
  const beleid = useApp((x) => x.beleid);
  const team = bezettingTeam(medewerkers, regio);
  const weken = useMemo(() => Array.from({ length: WEKEN }, (_, i) => {
    const b = borgingWeek(n, regio, i + 1, beleid.clusterSpeling)!;
    const c = capaciteitWeek(n, regio, i + 1, { bezetting: bron === 'team' && team ? team : undefined, metSpeling: beleid.clusterSpeling })!;
    return { w: i + 1, b, c };
  }), [n, regio, bron, team, beleid.clusterSpeling]);
  const W = 860, H = 240, pl = 44, pb = 28, pt = 12;
  const max = Math.max(...weken.map((x) => Math.max(x.b.totaal, x.c.bezetting - x.c.verzuim - x.c.verlofNorm))) * 1.1;
  const bw = (W - pl - 6) / WEKEN;
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / max);
  const delen: [keyof typeof weken[0]['b'], string, string][] = [
    ['urenRegulier', `Regelplekken (${nl(n.dienstUren, 0)} uur)`, 'var(--d1m)'],
    ['urenBeschikbaar', `Beschikbaarheid (${nl(n.beschikbaarKans * n.dienstUren)} uur)`, 'var(--plum)'],
    ['urenVoorgangen', 'Voorgangen (4 uur)', 'var(--teal)'],
    ['urenSpeling', 'Clusterspeling', 'var(--muted)'],
  ];
  const zomer = weken.slice(26, 35), winter = [...weken.slice(0, 9), ...weken.slice(48)];
  const gemRuimte = (l: typeof weken) => l.reduce((a, x) => a + x.c.ruimte, 0) / l.length;
  return (
    <Sectie titel={`${regio} per week`} lead="Wat de regio per week moet borgen, tegenover wat het team levert na verzuim en verlof volgens norm. Door het seizoenspatroon is er in de zomer meer ruimte dan in de winter." rechts={<Link href={`/jaarplanning?regio=${encodeURIComponent(regio)}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent">Jaarplanning verlof <ArrowRight size={15} /></Link>}>
      <div className="box">
        <div className="mb-3 flex flex-wrap gap-2">
          <Pill soort={gemRuimte(winter) < 0 ? 'bad' : 'ok'}>Winter: {nlInt(gemRuimte(winter))} uur per week over</Pill>
          <Pill soort={gemRuimte(zomer) < 0 ? 'bad' : 'ok'}>Zomer: {nlInt(gemRuimte(zomer))} uur per week over</Pill>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="chart block h-auto w-full min-w-[640px]" role="img" aria-label={`Te borgen uren per week in ${regio}`}>
            {[0, max / 2, max].map((v) => <g key={v}><line x1={pl} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={pl - 6} y={y(v) + 4} textAnchor="end">{nlInt(v)}</text></g>)}
            {weken.map((x, i) => {
              let acc = 0;
              const bx = pl + i * bw + 1.5, bwi = bw - 3;
              return (
                <g key={x.w}>
                  <title>{`Week ${x.w}: te borgen ${nlInt(x.b.totaal)} uur (${x.b.plekkenWeek} plekken), beschikbaar ${nlInt(x.c.bezetting - x.c.verzuim - x.c.verlofNorm)} uur, ruimte ${nlInt(x.c.ruimte)}`}</title>
                  {delen.map(([k, , kleur]) => {
                    const v = x.b[k] as number;
                    const y0 = y(acc), y1 = y(acc + v);
                    acc += v;
                    return v > 0 ? <rect key={k} x={bx} y={y1} width={bwi} height={Math.max(0, y0 - y1 - 1)} fill={kleur} /> : null;
                  })}
                  {(x.w === 1 || x.w % 4 === 0) && <text x={bx + bwi / 2} y={H - 9} textAnchor="middle">{x.w}</text>}
                </g>
              );
            })}
            <polyline fill="none" stroke="var(--navy)" strokeWidth={2.5} points={weken.map((x, i) => `${pl + i * bw + bw / 2},${y(x.c.bezetting - x.c.verzuim - x.c.verlofNorm)}`).join(' ')} />
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[13px] text-muted">
          {delen.map(([, l, kleur]) => <span key={l} className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: kleur }} />{l}</span>)}
          <span className="flex items-center gap-1.5"><i className="inline-block h-[3px] w-4 rounded" style={{ background: 'var(--navy)' }} /> Beschikbaar na verzuim en verlof</span>
        </div>
      </div>
    </Sectie>
  );
}

/**
 * De kans dat een 1B valt: eerst alle reguliere plekken in het cluster, met ziekte als die is ingesteld. Gemiddeld over het jaar per
 * cluster, en een voorbeeld voor morgen in de gekozen regio.
 */
function Kans1B({ regio, n, regios }: { regio: string; n: Parameters<typeof borgingWeek>[0]; regios: string[] }) {
  const cluster = REGION_CLUSTER[regio];
  const clusters = Object.keys(CLUSTERS).filter((c) => CLUSTERS[c].some((r) => regios.includes(r)));
  const jaar = useMemo(() => clusters.map((c) => ({ c, j: kans1BJaar(n, c), zonder: kans1BJaar(n, c, 0) })), [n, clusters.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const morgen = addDays(todayIso(), 1);
  const voorbeeld = useMemo(() => {
    const week = normWeek(morgen), dag = weekdayMon(toDay(morgen));
    const dagen = regiosVanCluster(n, cluster).map((r) => normRegioDag(n, r, week, dag)!).filter(Boolean);
    return { dagen, c: clusterDag(dagen, n.uitval, spelingOpDag(n, cluster, week, dag)) };
  }, [n, cluster, morgen]);
  const eigen = voorbeeld.dagen.find((d) => d.regio === regio);
  const alleen = voorbeeld.c.regios.find((r) => r.regio === regio)?.alleen ?? 0;
  const k = voorbeeld.c.cluster;
  const anderen = voorbeeld.dagen.filter((d) => d.regio !== regio).map((d) => d.regio);

  return (
    <Sectie
      titel="Kans dat een 1B valt"
      lead={<>Een melding gaat eerst naar een vrije reguliere plek, en niet alleen in de eigen regio: zolang er ergens in het cluster een plek vrij is, neemt een collega hem over. Pas als alle reguliere plekken in het cluster bezet zijn{n.uitval > 0 ? ', ook doordat iemand ziek is' : ''}, valt er een 1B. Daardoor valt een 1B minder vaak dan je per regio zou denken. De borging rekent met een vaste kans van {pct(n.beschikbaarKans, 1)}.</>}
    >
      {eigen && (
        <div className="box mb-4">
          <h3 className="kop-s">Voorbeeld: {regio}, {fmtLang(morgen)}</h3>
          <ol className="mt-2 grid gap-2 text-[14.5px]">
            <li><b>{nl(eigen.lam)}</b> meldingen verwacht, met <b>{eigen.diensten.length}</b> reguliere plekken en <b>{eigen.beschikbaar}</b> 1B ({eigen.diensten.length + eigen.beschikbaar} regelplekken op {pct(n.dekkingRegio)}).</li>
            <li>Als {regio} alles zelf moest opvangen, viel de 1B bij melding {eigen.diensten.length + 1}{n.uitval > 0 ? ' of als iemand ziek is' : ''}: kans <b>{pct(alleen)}</b>.</li>
            <li>Maar die melding gaat eerst naar een vrije plek in {anderen.join(', ')}. Samen verwacht cluster {CLUSTER_NAAM[cluster]} <b>{nl(k.lam)}</b> meldingen op <b>{k.regulier}</b> reguliere plekken{voorbeeld.c.speling ? <> (waarvan {voorbeeld.c.speling} clusterspeling)</> : null}{n.uitval > 0 ? <>; door ziekte ({pct(n.uitval, 1)} per dienst) vallen er naar verwachting {nl(k.uitval)} uit</> : null}.</li>
            <li>Kans dat er in het cluster een 1B valt: <b>{pct(k.minstensEen)}</b>. Er staan {k.beschikbaar} 1B&apos;s; de eerste valt in {pct(k.perPlek[0] ?? 0)}, {k.perPlek.slice(1).map((p, i) => `de ${i + 2}e in ${pct(p)}`).join(', ')}. Gemiddeld per 1B: <b>{pct(k.gemiddeld)}</b>.</li>
          </ol>
        </div>
      )}
      <div className="scroll">
        <table className="tb">
          <thead>
            <tr>
              <th>Cluster</th><th className="r">1B per dag</th><th className="r">Kans dat er een 1B valt</th><th className="r">Gemiddeld per 1B</th>
              <th className="r">Winter</th><th className="r">Zomer</th>{n.uitval > 0 && <th className="r">Zonder ziekte</th>}<th className="r">Als elke regio alles zelf opvangt</th>
            </tr>
          </thead>
          <tbody>
            {jaar.map(({ c, j, zonder }) => (
              <tr key={c} className={cx(c === cluster && 'bg-soft')}>
                <td className="font-semibold">{CLUSTER_NAAM[c]}</td>
                <td className="r">{nl(j.beschikbaarPerDag, 0)}</td>
                <td className="r">{pct(j.minstensEen)}</td>
                <td className="r font-semibold">{pct(j.gemiddeld)}</td>
                <td className="r">{pct(j.winter)}</td>
                <td className="r">{pct(j.zomer)}</td>
                {n.uitval > 0 && <td className="r">{pct(zonder.gemiddeld)}</td>}
                <td className="r">{pct(j.regios.reduce((a, r) => a + r.alleen, 0) / Math.max(1, j.regios.length))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note mt-2">
        Gemiddeld over het jaar volgens de vastgestelde regelplekken: per regio de plekken op {pct(n.dekkingRegio)} min de 1B, plus de clusterspeling voor {pct(n.dekkingCluster)}. {n.uitval > 0 ? <>Ziekte: {pct(n.uitval, 1)} kans per dienst dat iemand op de dag zelf uitvalt; een 2 die uitvalt, kost twee plekken.</> : <>Ziekte telt niet mee; onder Instellingen kun je een kans op uitval op de dag invullen (kort verzuim).</>} In het rooster staat per dag de kans met de diensten die er echt staan.
      </p>
    </Sectie>
  );
}

