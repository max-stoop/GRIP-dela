'use client';
import { useMemo } from 'react';
import { clusterVoorspeld, plekKansen, procenten, type ClusterPlekken, type PlekKans } from '@/lib/capaciteit/plekkans';
import type { ClusterDag, RegioDag } from '@/lib/capaciteit/beschikbaarheid';
import { poissonBand, poissonCdf } from '@/lib/model/poisson';
import { CLUSTERS, CLUSTER_NAAM, REGION_CLUSTER } from '@/lib/model/config';
import { lam, plekken } from '@/lib/store/afgeleid';
import type { RunData } from '@/lib/model/types';
import type { Beleid } from '@/lib/rooster/types';
import { cx, nl, pct } from '@/lib/format';

/** Het cluster op één dag zoals het meetelt: per regio de verwachting en de plekken, plus clusterspeling en ziekte. */
interface PlekkenInvoer { dagen: RegioDag[]; speling: number; uitval: number }

/** Hoeveel plekken er nodig zijn volgens de voorspelling, voor de vraag "waarom zoveel?". */
interface Nodig {
  lam: number;
  /** Dekkingsgraad per regio (0,8). */
  alpha: number;
  k: number;
  /** Waar het getal vandaan komt, bijvoorbeeld "de roosterbasis". */
  bron?: string;
}

function usePlekKansen(invoer: PlekkenInvoer | null): ClusterPlekken | null {
  return useMemo(() => (invoer ? plekKansen(invoer.dagen, invoer.uitval, invoer.speling) : null), [invoer]);
}

const plekNaam = (p: PlekKans, aantal1B: number) => (p.soort === '1B' ? (aantal1B > 1 ? `${p.nr}e plek, 1B` : '1B') : `Plek ${p.nr}`);

/** Voor wie elke plek valt: een eigen melding of een uit het cluster. De 1B valt pas als het hele cluster vol is. */
function PlekkenUitleg({ c, regio, clusterNaam, uitval, nodig, compact, jouw1B }: {
  c: ClusterPlekken;
  regio: string;
  clusterNaam: string;
  uitval: number;
  nodig?: Nodig | null;
  /** Kleiner, voor in het rooster van een medewerker. */
  compact?: boolean;
  /** De medewerker heeft zelf de 1B: "jouw 1B". */
  jouw1B?: boolean;
}) {
  const r = c.regios.find((x) => x.regio === regio);
  if (!r) return null;
  const k = r.regulier + r.beschikbaar, K = c.regulier + c.beschikbaar;
  const regulier = r.plekken.filter((p) => p.soort === 'regulier');
  const b = r.plekken.filter((p) => p.soort === '1B');
  // de eerste plekken vallen (bijna) elke dag: samen in één regel
  const vast = regulier.filter((p) => p.valt >= 0.995).length;
  const rijen = r.plekken.slice(vast);
  const laatste = regulier.at(-1);
  const lo = poissonBand(0.1, r.lam), hi = poissonBand(0.9, r.lam);
  const anderen = c.regios.filter((x) => x.regio !== regio).map((x) => x.regio);
  // dicht bij de norm een decimaal, zodat 79,6% niet als 80% "te weinig" lijkt
  const pctN = (x: number) => (nodig && Math.abs(x - nodig.alpha) < 0.005 ? pct(x, 1) : pct(x));
  const ladder = nodig ? Array.from({ length: 5 }, (_, i) => nodig.k - 3 + i).filter((j) => j >= 0).map((j) => ({ j, p: poissonCdf(j, nodig.lam) })) : [];
  const deze1B = jouw1B ? 'jouw 1B' : 'de 1B';
  const pb = b.length ? procenten(b[0]) : null, pl = laatste ? procenten(laatste) : null;

  return (
    <div className="grid gap-4">
      <div className={cx('grid gap-3', compact ? 'grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4')}>
        <Tegel waarde={nl(r.lam)} label="meldingen verwacht" sub={`Op 8 van de 10 van zulke dagen ${lo} tot ${hi}.`} />
        <Tegel waarde={String(k)} label={`plekken in ${regio}`} sub={`${r.regulier} vast${r.beschikbaar ? ` en ${r.beschikbaar === 1 ? 'een' : r.beschikbaar} 1B` : ''}. Alleen genoeg op ${pct(r.genoeg)} van de dagen.`} />
        <Tegel waarde={String(K)} label={`plekken in cluster ${clusterNaam}`} sub={`${nl(c.lam)} meldingen verwacht${c.speling ? `, met ${c.speling} clusterspeling` : ''}. Samen genoeg op ${pct(c.genoeg)}.`} />
        {b.length > 0 && (
          <Tegel toon waarde={pb!.valt} label={`kans dat ${deze1B} valt`} sub={`${pb!.eigen} voor ${regio}, ${pb!.cluster} voor een andere regio.`} />
        )}
      </div>

      {nodig && ladder.length > 0 && (
        <div className="rounded-xl border border-line p-3.5">
          <div className="font-semibold">Waarom {nodig.k} plekken?</div>
          <p className="note mt-1 text-ink">
            Het kleinste aantal plekken waarmee alle meldingen van {regio} op minstens {pct(nodig.alpha)} van de dagen passen{nodig.bron ? `, volgens ${nodig.bron}` : ''}. De 1B telt mee als laatste plek.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ladder.map(({ j, p }) => (
              <span key={j} className={cx('rounded-lg border px-2.5 py-1 text-[14px] tabular-nums', j === nodig.k ? 'border-[color:var(--teal)] font-semibold' : 'border-line', p < nodig.alpha && 'text-muted')}>
                {j} plekken: <b>{pctN(p)}</b>{j === nodig.k ? ' ✓' : ''}
              </span>
            ))}
          </div>
          {nodig.k > 0 && (
            <p className="note mt-2 text-ink">
              Met {nodig.k - 1} plekken past het op {pctN(poissonCdf(nodig.k - 1, nodig.lam))} van de dagen: te weinig. Met {nodig.k} op {pctN(poissonCdf(nodig.k, nodig.lam))}.
              {k !== nodig.k ? ` In het rooster staan er ${k}.` : ''}
            </p>
          )}
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="font-semibold">Hoe vaak valt elke plek?</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--teal)' }} /> melding uit {regio}</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--accent)' }} /> melding uit een andere regio</span>
          </div>
        </div>
        <div className="grid gap-1.5">
          {vast > 0 && (
            <div className="grid grid-cols-[minmax(64px,auto)_1fr_auto] items-center gap-2.5 text-sm">
              <span className="font-semibold">{vast > 1 ? `Plek 1 t/m ${vast}` : 'Plek 1'}</span>
              <div className="h-3.5 rounded" style={{ background: 'var(--teal)' }} />
              <span className="text-muted">vrijwel elke dag</span>
            </div>
          )}
          {rijen.map((p) => { const t = procenten(p); return (
            <div key={p.nr} className="grid grid-cols-[minmax(64px,auto)_1fr_auto] items-center gap-2.5 text-sm">
              <span className="font-semibold">{p.soort === '1B' ? <span className="c-1B rounded px-1.5 py-0.5">{plekNaam(p, b.length)}</span> : plekNaam(p, b.length)}</span>
              <div className="relative h-3.5 overflow-hidden rounded bg-soft" title={`${plekNaam(p, b.length)}: valt op ${pct(p.valt, 1)} van de dagen, ${pct(p.eigen, 1)} voor ${regio} en ${pct(p.cluster, 1)} voor een andere regio`}>
                <i className="absolute inset-y-0 left-0" style={{ width: `${p.eigen * 100}%`, background: 'var(--teal)' }} />
                <i className="absolute inset-y-0" style={{ left: `${p.eigen * 100}%`, width: `${p.cluster * 100}%`, background: 'var(--accent)' }} />
              </div>
              <span className="num whitespace-nowrap text-right"><b>{t.valt}</b> <span className="text-muted">({t.eigen} + {t.cluster})</span></span>
            </div>
          ); })}
        </div>
      </div>

      <div className="grid gap-1.5 text-[14.5px] leading-relaxed">
        {laatste && pl && (
          <p className="m-0">
            <b>Plek {laatste.nr}</b>, de laatste vaste plek, valt op <b>{pl.valt}</b> van de dagen: {pl.eigen} voor een melding uit {regio} en {pl.cluster} voor een melding uit een andere regio{anderen.length ? ` (${anderen.join(', ')})` : ''}. Een melding gaat eerst naar een eigen plek; past hij daar niet, dan naar een vrije plek elders in het cluster.
          </p>
        )}
        {pb && (
          <p className="m-0">
            <b>{deze1B === 'de 1B' ? 'De 1B' : 'Jouw 1B'}</b> valt pas als alle {c.regulier} reguliere plekken in cluster {clusterNaam} bezet zijn: op <b>{pb.valt}</b> van de dagen. Dan is het {pb.eigen} voor een melding uit {regio} en {pb.cluster} voor een andere regio, als die zijn eigen 1B al heeft ingezet.
            {' '}Moest {regio} alles zelf opvangen, dan viel {deze1B} op {pct(1 - r.genoegZonder1B)} van de dagen.
            {b.length > 1 ? ` De ${b.length} 1B's vallen op ${b.map((x) => procenten(x).valt).join(', ')} van de dagen.` : ''}
          </p>
        )}
        {!compact && (r.helpt >= 0.05 || r.geholpen >= 0.05) && (
          <p className="m-0 text-muted">
            Gemiddeld neemt {regio} {nl(r.helpt)} melding per dag over van een andere regio, en gaan er {nl(r.geholpen)} meldingen uit {regio} naar een plek elders.
          </p>
        )}
        {uitval > 0 && <p className="m-0 text-muted">Ziekte telt mee ({pct(uitval, 1)} kans per dienst): wie op de dag zelf uitvalt, laat zijn werk aan de volgende plek.</p>}
      </div>
    </div>
  );
}

function Tegel({ waarde, label, sub, toon }: { waarde: string; label: string; sub: string; toon?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-line p-3">
      <div className={cx('display num text-[26px] font-semibold leading-none', toon ? 'text-gold' : 'text-ink')}>{waarde}</div>
      <div className="mt-1 text-[13.5px] font-semibold">{label}</div>
      <div className="note mt-0.5 text-[13px]">{sub}</div>
    </div>
  );
}

/** Op de voorspellingspagina: een regio op een dag, met de plekken uit deze voorspelling voor het hele cluster. */
export function PlekkenVoorspelling({ run, datum, regio, beleid, uitval }: { run: RunData; datum: string; regio: string; beleid: Beleid; uitval: number }) {
  const cluster = REGION_CLUSTER[regio];
  const invoer = useMemo(() => {
    const v = clusterVoorspeld(CLUSTERS[cluster] ?? [regio], (r) => lam(run, r, datum), { alphaRegio: beleid.alphaRegio, alphaCluster: beleid.alphaCluster, beschikbaarPerDag: beleid.beschikbaarPerDag, speling: beleid.clusterSpeling });
    return v ? { ...v, uitval } : null;
  }, [run, datum, regio, cluster, beleid.alphaRegio, beleid.alphaCluster, beleid.beschikbaarPerDag, beleid.clusterSpeling, uitval]);
  const c = usePlekKansen(invoer);
  const l = lam(run, regio, datum), k = plekken(run, regio, datum, beleid.alphaRegio);
  if (!c || l == null || k == null) return <p className="box note">Voor deze dag is er geen voorspelling voor alle regio&apos;s in het cluster.</p>;
  return (
    <div className="box">
      <PlekkenUitleg c={c} regio={regio} clusterNaam={CLUSTER_NAAM[cluster] ?? cluster} uitval={uitval} nodig={{ lam: l, alpha: beleid.alphaRegio, k }} />
    </div>
  );
}

/** Regio's waarvan je het rooster niet ziet, tellen met de vastgestelde plekken. */
export function PlekkenDag({ dag, regio, clusterNaam, uitval, nodig, compact, jouw1B }: {
  dag: ClusterDag | null | undefined;
  regio: string;
  clusterNaam: string;
  uitval: number;
  nodig?: Nodig | null;
  compact?: boolean;
  jouw1B?: boolean;
}) {
  const invoer = useMemo(() => (dag ? { dagen: dag.dagen, speling: dag.speling, uitval } : null), [dag, uitval]);
  const c = usePlekKansen(invoer);
  if (!dag || !c) return <p className="note m-0">Voor deze dag zijn er nog geen plekken bekend.</p>;
  const metRooster = dag.dagen.filter((d) => d.bron === 'rooster').map((d) => d.regio);
  const zonder = dag.dagen.filter((d) => d.bron === 'norm').map((d) => d.regio);
  return (
    <div className="grid gap-3">
      <PlekkenUitleg c={c} regio={regio} clusterNaam={clusterNaam} uitval={uitval} nodig={nodig} compact={compact} jouw1B={jouw1B} />
      {zonder.length > 0 && (
        <p className="note m-0">
          {metRooster.length ? `Met het rooster van ${metRooster.join(', ')}. ` : ''}Met de vastgestelde plekken (geen rooster{compact ? '' : ' of niet zichtbaar'}): {zonder.join(', ')}.
        </p>
      )}
    </div>
  );
}
