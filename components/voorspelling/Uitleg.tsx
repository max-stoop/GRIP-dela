'use client';
import type { NormParameters } from '@/lib/capaciteit/parameters';
import { plekkenNorm } from '@/lib/capaciteit/norm';
import { clusterDag, type ClusterDag } from '@/lib/capaciteit/beschikbaarheid';
import { clusterVoorspeld } from '@/lib/capaciteit/plekkans';
import { useMemo } from 'react';
import { CalendarDays, SlidersHorizontal, Waves, Users, Lightbulb } from 'lucide-react';
import { Pill } from '@/components/ui';
import { DAG_KORT, DAG_LANG, fmtD, toDay, weekday, diffDays } from '@/lib/dates';
import { nl, pct, pctS } from '@/lib/format';
import { CLUSTERS, CLUSTER_NAAM, PRIORS, REGION_CLUSTER, type FactorKey } from '@/lib/model/config';
import { poissonBand, poissonCdf, poissonQuantile } from '@/lib/model/poisson';
import { betrouwbaarheid, verdeling, type Betrouwbaarheid as Kwaliteit } from '@/lib/model/betrouwbaarheid';
import { factoren, lam, lamBasis, plekken, som } from '@/lib/store/afgeleid';
import type { MeldingenData, RunData, RunMeta } from '@/lib/model/types';
import type { Beleid } from '@/lib/rooster/types';

const LABEL = (k: FactorKey) => (k === 'seas_tw' || k === 'seas_ts' ? 'de seizoensverwachting' : PRIORS[k].label.toLowerCase());

export function Samenvatting({ run, rb, regios, scopeNaam, beleid }: { run: RunData; rb: RunData | null; regios: string[]; scopeNaam: string; beleid: Beleid }) {
  const week = run.dates.slice(0, 7);
  const nu = week.map((d) => som(run, regios, d) ?? 0), basis = week.map((d) => som(run, regios, d, true) ?? 0);
  const tot = nu.reduce((a, b) => a + b, 0), totB = basis.reduce((a, b) => a + b, 0);
  const iMax = nu.indexOf(Math.max(...nu)), iMin = nu.indexOf(Math.min(...nu));
  // grootste bijsturing deze week, gewogen naar het basisvolume
  const agg = new Map<string, number>();
  let w = 0;
  for (const d of week) for (const r of regios) {
    const b = lamBasis(run, r, d) ?? 0;
    w += b;
    for (const [k, v] of Object.entries(factoren(run, r, d))) agg.set(k, (agg.get(k) ?? 0) + b * (v ?? 0));
  }
  const top = [...agg.entries()].map(([k, v]) => [k, Math.exp(v / Math.max(1, w)) - 1] as const).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  let op = 0, neer = 0;
  if (rb && rb.id !== run.id) {
    for (const d of run.dates) for (const r of regios) {
      const a = plekken(run, r, d, beleid.alphaRegio), b = plekken(rb, r, d, beleid.alphaRegio);
      if (a == null || b == null) continue;
      if (a > b) op++; else if (a < b) neer++;
    }
  }
  const verschil = tot / totB - 1;
  const fmtDag = (i: number) => `${DAG_LANG[weekday(toDay(week[i]))]} ${fmtD(week[i])}`;
  return (
    <div className="box mb-5 flex gap-4" style={{ borderColor: 'var(--teal)' }}>
      <Lightbulb size={22} className="mt-0.5 shrink-0 text-teal" />
      <div className="grid gap-1.5 text-[16px] leading-relaxed">
        <p className="m-0">
          <b>Komende 7 dagen verwachten we {nl(tot, 0)} meldingen {scopeNaam}.</b>{' '}
          Dat is {Math.abs(verschil) < 0.01 ? 'ongeveer wat normaal is' : `${pct(Math.abs(verschil), 1)} ${verschil > 0 ? 'meer' : 'minder'} dan normaal`} voor deze tijd van het jaar.
        </p>
        <p className="m-0">Drukste dag is {fmtDag(iMax)} ({nl(nu[iMax], nu[iMax] > 50 ? 0 : 1)}), rustigste {fmtDag(iMin)} ({nl(nu[iMin], nu[iMin] > 50 ? 0 : 1)}).
          {top && Math.abs(top[1]) >= 0.002 ? ` De grootste bijsturing komt van ${LABEL(top[0] as FactorKey)} (${pctS(top[1])}).` : ' Er is deze week weinig bijsturing: de verwachting volgt het normale patroon.'}
        </p>
        {rb && rb.id !== run.id && (op || neer) ? (
          <p className="m-0 text-muted">Ten opzichte van de roosterbasis is er op {op} regio-dag{op === 1 ? '' : 'en'} een plek meer nodig en op {neer} een plek minder. Die staan in de tabel hieronder met een kader.</p>
        ) : null}
      </div>
    </div>
  );
}

export function Uitgelegd({ run, meta, datum, regios, regio, onRegio, beleid, normen }: { run: RunData; meta: RunMeta; datum: string; regios: string[]; regio: string; onRegio: (r: string) => void; beleid: Beleid; normen?: NormParameters }) {
  // het cluster met de plekken uit deze voorspelling, zoals bij "Waarom zoveel plekken?"
  const cluster = useMemo(() => {
    const v = clusterVoorspeld(CLUSTERS[REGION_CLUSTER[regio]] ?? [regio], (r) => lam(run, r, datum), { alphaRegio: beleid.alphaRegio, alphaCluster: beleid.alphaCluster, beschikbaarPerDag: beleid.beschikbaarPerDag, speling: beleid.clusterSpeling });
    return v ? clusterDag(v.dagen, normen?.uitval ?? 0, v.speling) : null;
  }, [run, regio, datum, beleid.alphaRegio, beleid.alphaCluster, beleid.beschikbaarPerDag, beleid.clusterSpeling, normen?.uitval]);
  const l = lam(run, regio, datum), lb = lamBasis(run, regio, datum);
  if (l == null || lb == null) return null;
  const fac = Object.entries(factoren(run, regio, datum)).map(([k, v]) => [k as FactorKey, Math.exp(v ?? 0) - 1] as const).filter(([, v]) => Math.abs(v) >= 0.001).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const k = poissonQuantile(beleid.alphaRegio, l);
  const nB = Math.min(beleid.beschikbaarPerDag, k), kVast = k - nB;
  const lo = poissonBand(0.1, l), hi = poissonBand(0.9, l);
  const kans = poissonCdf(k, l);
  const kNorm = normen ? plekkenNorm(normen, regio, datum) : null;
  const h = diffDays(datum, meta.uitgegeven);
  const dag = `${DAG_LANG[weekday(toDay(datum))]} ${fmtD(datum)}`;

  const stappen = [
    {
      icoon: CalendarDays, titel: 'Wat is normaal', waarde: nl(lb),
      tekst: <>Het basismodel kijkt naar jaren historie van {regio}: seizoen, weekdag en feestdagen. Voor {dag} is normaal <b>{nl(lb)}</b> meldingen.</>,
    },
    {
      icoon: SlidersHorizontal, titel: 'Bijsturen', waarde: nl(l),
      tekst: fac.length
        ? <>Actuele signalen sturen bij: {fac.slice(0, 2).map(([f, v]) => `${LABEL(f)} ${pctS(v)}`).join(', ')}. Dat geeft een verwachting van <b>{nl(l)}</b>.</>
        : <>Op {h} dagen vooruit zijn er nog geen actuele signalen. De verwachting blijft <b>{nl(l)}</b>.</>,
    },
    {
      icoon: Waves, titel: 'Het blijft een kans', waarde: `${lo}–${hi}`,
      tekst: <>Een verwachting is een gemiddelde, geen belofte. Het werkelijke aantal schommelt: op 8 van de 10 van zulke dagen tussen <b>{lo} en {hi}</b>.</>,
    },
    {
      icoon: Users, titel: 'Zoveel plekken', waarde: String(k),
      tekst: <>Met <b>{k} regelplekken</b> ({kVast} vast{nB ? ` en ${nB} beschikbaarheidsdienst` : ''}) past het op {pct(kans)} van de dagen: de dekkingsgraad van {pct(beleid.alphaRegio)} uit het beleid.{kNorm != null ? <> De vastgestelde regelplekken voor deze dag: <b>{kNorm}</b>.</> : null} Komen er meer meldingen dan de vaste plekken, dan gaat de melding eerst naar een vrije plek elders in het cluster; pas als het hele cluster vol is, valt de 1B.</>,
    },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
      <div className="box">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="kop-s">Zo komt de voorspelling tot stand</h3>
          {regios.length > 1 && (
            <select className="input w-auto" value={regio} onChange={(e) => onRegio(e.target.value)} aria-label="Regio voor de uitleg">
              {regios.map((r) => <option key={r}>{r}</option>)}
            </select>
          )}
        </div>
        <ol className="grid gap-3 sm:grid-cols-2">
          {stappen.map((s, i) => (
            <li key={s.titel} className="relative rounded-xl border border-line p-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: ['var(--accent)', 'var(--gold)', 'var(--muted)', 'var(--teal)'][i] }}><s.icoon size={16} /></span>
                <span className="text-sm font-semibold text-muted">Stap {i + 1}</span>
                <span className="ml-auto display num text-[22px] font-semibold">{s.waarde}</span>
              </div>
              <div className="font-semibold">{s.titel}</div>
              <p className="note mt-1 text-[14px] text-ink">{s.tekst}</p>
            </li>
          ))}
        </ol>
      </div>
      <KansVerdeling lam={l} kVast={kVast} k={k} regio={regio} titel={`${regio}, ${DAG_KORT[weekday(toDay(datum))]} ${fmtD(datum)}`} cluster={cluster} />
    </div>
  );
}

/** Staafdiagram van P(aantal meldingen = k), gekleurd naar wie het opvangt. */
function KansVerdeling({ lam: l, kVast, k, titel, regio, cluster }: { lam: number; kVast: number; k: number; titel: string; regio: string; cluster?: ClusterDag | null }) {
  const d = useMemo(() => verdeling(l), [l]);
  const W = 460, H = 220, pl = 8, pb = 34, pt = 14;
  const pmax = Math.max(...d.map((x) => x.p));
  const bw = (W - pl * 2) / d.length;
  const x = (i: number) => pl + i * bw;
  const y = (p: number) => pt + (H - pt - pb) * (1 - p / pmax);
  const kleur = (kk: number) => (kk <= kVast ? 'var(--teal)' : kk <= k ? 'var(--plum)' : 'var(--red)');
  const idxK = d.findIndex((v) => v.k === k);
  return (
    <div className="box">
      <h3 className="kop-s">Hoeveel meldingen kunnen het worden?</h3>
      <p className="note mt-1">{titel}: de kans op elk aantal. Verwachting {nl(l)}.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart mt-3 block h-auto w-full" role="img" aria-label={`Kansverdeling rond ${nl(l)} meldingen`}>
        {d.map((v, i) => (
          <rect key={v.k} x={x(i) + 1} y={y(v.p)} width={Math.max(1, bw - 2)} height={y(0) - y(v.p)} rx={2} fill={kleur(v.k)} opacity={0.85}>
            <title>{`${v.k} meldingen: ${pct(v.p, 1)}`}</title>
          </rect>
        ))}
        {d.map((v, i) => (v.k % (d.length > 24 ? 5 : 2) === 0 ? <text key={`t${v.k}`} x={x(i) + bw / 2} y={H - pb + 16} textAnchor="middle">{v.k}</text> : null))}
        {idxK >= 0 && <line x1={x(idxK) + bw} x2={x(idxK) + bw} y1={pt - 6} y2={y(0)} stroke="var(--text)" strokeWidth={1.5} strokeDasharray="4 3" />}
        {idxK >= 0 && <text x={x(idxK) + bw - 4} y={pt + 4} textAnchor="end" style={{ fill: 'var(--text)', fontWeight: 700 }}>{k} plekken</text>}
        <text x={W / 2} y={H - 4} textAnchor="middle">aantal meldingen op deze dag</text>
      </svg>
      <div className="mt-2 grid gap-1 text-[14px]">
        <span className="flex items-center gap-2"><i className="inline-block h-3 w-3 rounded-sm bg-teal" /> Past met de vaste plekken van {regio}: <b>{pct(poissonCdf(kVast, l))}</b></span>
        {k > kVast && <span className="flex items-center gap-2"><i className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: 'var(--plum)' }} /> <span>Melding {kVast + 1}{k > kVast + 1 ? ` t/m ${k}` : ''}: eerst naar een vrije plek elders in het cluster, anders de 1B: <b>{pct(poissonCdf(k, l) - poissonCdf(kVast, l))}</b></span></span>}
        <span className="flex items-center gap-2"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--red)' }} /> Nog meer: het cluster vangt op, of de volgende dag: <b>{pct(1 - poissonCdf(k, l))}</b></span>
      </div>
      {cluster && (
        <p className="m-0 mt-3 rounded-lg bg-soft p-3 text-[14px]">
          Kans dat er echt een 1B valt in cluster {CLUSTER_NAAM[REGION_CLUSTER[regio]]}: <b>{pct(cluster.cluster.minstensEen)}</b>, gemiddeld per 1B <b>{pct(cluster.cluster.gemiddeld)}</b>.
          {' '}Dat is pas als alle {cluster.cluster.regulier} reguliere plekken in het cluster bezet zijn{cluster.cluster.uitval > 0 ? ', ook als er iemand ziek is' : ''}. Moest {regio} alles zelf opvangen, dan was het {pct(cluster.regios.find((r) => r.regio === regio)?.alleen ?? 0)}.
        </p>
      )}
    </div>
  );
}

/** Hoe goed eerdere runs uitkwamen voor deze regio's; `null` zolang de bewaarde runs nog laden. */
export function useTerugblik(runs: RunMeta[], data: Map<string, RunData> | null, meldingen: MeldingenData | null, regios: string[]): Kwaliteit | null {
  const sleutel = regios.join('|');
  return useMemo(() => {
    if (!data) return null;
    const lijst = runs.map((m) => ({ meta: m, data: data.get(m.id) })).filter((x): x is { meta: RunMeta; data: RunData } => !!x.data);
    return betrouwbaarheid(lijst, meldingen, sleutel.split('|'));
  }, [runs, data, meldingen, sleutel]);
}

export function Betrouwbaarheid({ b, scopeNaam }: { b: Kwaliteit | null; scopeNaam: string }) {
  if (!b) return <div className="skeleton h-48" />;
  if (!b.reeks.length) {
    return <p className="box note">Zodra er voorspellingen zijn voor dagen die al voorbij zijn, zie je hier hoe goed ze uitkwamen. Dat gebeurt vanzelf: elke dagelijkse run wordt bewaard en later vergeleken met de werkelijke meldingen.</p>;
  }
  const W = 760, H = 230, pl = 40, pb = 26, pt = 10;
  const vals = b.reeks.flatMap((p) => [p.werkelijk, p.lo, p.hi]);
  const vmin = Math.max(0, Math.floor(Math.min(...vals) * 0.9)), vmax = Math.ceil(Math.max(...vals) * 1.05);
  const n = b.reeks.length;
  const x = (i: number) => pl + ((W - pl - 10) * (i + 0.5)) / n;
  const y = (v: number) => pt + (H - pt - pb) * (1 - (v - vmin) / (vmax - vmin || 1));
  const band = `M${b.reeks.map((p, i) => `${x(i)},${y(p.lo)}`).join('L')}L${[...b.reeks].reverse().map((p, i) => `${x(n - 1 - i)},${y(p.hi)}`).join('L')}Z`;
  const binnen = b.reeks.filter((p) => p.werkelijk >= p.lo && p.werkelijk <= p.hi).length;
  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <div className="box">
        <h3 className="kop-s">Voorspeld tegenover werkelijk</h3>
        <p className="note mt-1">{scopeNaam}, laatste {n} dagen. De lijn is de voorspelling van minstens 4 dagen vooraf, de stippen zijn de werkelijke meldingen. {binnen} van de {n} dagen vielen binnen de band.</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart mt-3 block h-auto w-full" role="img" aria-label="Voorspelling tegenover werkelijke meldingen">
          {[vmin, (vmin + vmax) / 2, vmax].map((v) => <g key={v}><line className="grid" x1={pl} x2={W} y1={y(v)} y2={y(v)} /><text x={pl - 6} y={y(v) + 4} textAnchor="end">{Math.round(v)}</text></g>)}
          <path d={band} fill="color-mix(in srgb, var(--accent) 12%, transparent)" />
          <path d={`M${b.reeks.map((p, i) => `${x(i)},${y(p.verwacht)}`).join('L')}`} fill="none" stroke="var(--accent)" strokeWidth={2} />
          {b.reeks.map((p, i) => (
            <circle key={p.datum} cx={x(i)} cy={y(p.werkelijk)} r={3.5} fill={p.werkelijk >= p.lo && p.werkelijk <= p.hi ? 'var(--text)' : 'var(--red)'}>
              <title>{`${fmtD(p.datum)}: werkelijk ${p.werkelijk}, voorspeld ${nl(p.verwacht)} (${p.h} dagen vooraf)`}</title>
            </circle>
          ))}
          {b.reeks.map((p, i) => (i % 7 === 0 ? <text key={`d${p.datum}`} x={x(i)} y={H - 6} textAnchor="middle">{fmtD(p.datum)}</text> : null))}
        </svg>
      </div>
      <div className="box">
        <h3 className="kop-s">Nauwkeurigheid per afstand</h3>
        <p className="note mt-1">Hoe verder vooruit, hoe minder er bekend is. De band hoort in ongeveer 8 van de 10 gevallen te kloppen; bij weinig meldingen per dag iets vaker, omdat het om hele aantallen gaat.</p>
        <table className="tb mt-3">
          <thead><tr><th>Vooruit</th><th className="r">Afwijking</th><th className="r">Scheef</th><th className="r">Binnen band</th></tr></thead>
          <tbody>
            {b.buckets.map((k) => (
              <tr key={k.naam}>
                <td>{k.naam}<div className="text-[12px] text-muted">{k.punten} dagen</div></td>
                <td className="r">± {nl(k.mae)}</td>
                <td className="r">{pctS(k.bias)}</td>
                <td className="r"><Pill soort={Math.abs(k.inBand - k.inBandVerwacht) <= 0.07 ? 'ok' : Math.abs(k.inBand - k.inBandVerwacht) <= 0.15 ? 'warn' : 'bad'}>{pct(k.inBand)}</Pill><div className="text-[12px] text-muted">hoort {pct(k.inBandVerwacht)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note mt-2">Afwijking: gemiddeld verschil in meldingen per dag. Scheef: structureel te hoog (−) of te laag (+) voorspeld. Binnen band: per regio per dag.</p>
      </div>
    </div>
  );
}

const BEGRIPPEN: [string, string][] = [
  ['Verwachting', 'Het gemiddelde aantal meldingen dat je op zo’n dag mag verwachten. Een kommagetal (4,3), omdat het een gemiddelde is.'],
  ['Basismodel', 'Wat normaal is voor deze dag in deze regio, geleerd uit de historie: seizoen, weekdag en feestdagen.'],
  ['Bijsturing', 'Actuele signalen die de verwachting omhoog of omlaag duwen: recente drukte, weer, luchtkwaliteit, griep, rioolwater, CBS-sterfte en de seizoensverwachting.'],
  ['Bandbreedte (80%)', 'Het bereik waarin het werkelijke aantal op 8 van de 10 dagen valt. Bij een gekozen dag staat ook het bereik voor 19 van de 20 dagen (95%), en hoe vaak de band in het verleden klopte.'],
  ['Regelplekken', 'Zoveel plekken dat het werk op 80% van de dagen past (beleid § 3.1). De beschikbaarheidsdienst telt mee als regelplek.'],
  ['Beschikbaarheid (1B)', 'De laatste regelplek van de dag: open van 12:00 tot 15:00, en alleen werktijd als hij valt. In de planning en de borging telt hij 2 uur: hij valt ongeveer 1 op de 4 keer. Hoe vaak hij echt valt, hangt af van het hele cluster: een melding gaat eerst naar een vrije plek in het cluster.'],
  ['Vastgestelde regelplekken', 'De jaarnorm uit de begroting (Nieuwe vastgestelde regelplekken 2027). Daarmee rekent GRIP verlofruimte en capaciteit, en de dagen waarvoor nog geen voorspelling is.'],
  ['Clusterdekking', 'De kans dat de regio’s in een cluster samen genoeg plekken hebben als ze elkaar helpen (95%). Het verschil met de regio’s heet clusterspeling.'],
  ['Run', 'Eén keer voorspellen, met alles wat op dat moment bekend is. Elke run wordt bewaard.'],
  ['Roosterbasis', 'De run waarop het rooster is gemaakt. Nieuwere runs (bijvoorspellingen) laten zien waar je moet bijsturen.'],
  ['Vooruit (t−4)', 'Hoeveel dagen vóór de doeldatum de voorspelling is gemaakt. Dichterbij is scherper: dan is ook het weer bekend.'],
];

export function Begrippen() {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {BEGRIPPEN.map(([t, d]) => (
        <div key={t} className="rounded-xl border border-line bg-card p-3.5">
          <dt className="font-semibold">{t}</dt>
          <dd className="note m-0 mt-1">{d}</dd>
        </div>
      ))}
    </dl>
  );
}

