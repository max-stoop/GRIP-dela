'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Info } from 'lucide-react';
import { DAG_KORT, DAG_LANG, MAAND_KORT, fmtD, month, toDay, weekday, dayOfMonth, diffDays } from '@/lib/dates';
import { nl, pct, pctS } from '@/lib/format';
import { CLUSTERS, CLUSTER_NAAM, PRIORS, REGION_CLUSTER, type FactorKey } from '@/lib/model/config';
import { poissonCdf, poissonQuantile } from '@/lib/model/poisson';
import type { RunData, RunMeta } from '@/lib/model/types';
import { factoren, lam, lamBasis, plekken, som } from '@/lib/store/afgeleid';
import { factorUitleg, somUitleg } from '@/lib/model/uitleg';
import { bucketVoor, type Betrouwbaarheid } from '@/lib/model/betrouwbaarheid';
import { Bandbreedte } from './Bandbreedte';
import { cx } from '@/lib/format';

const LABEL = (k: FactorKey) => (k === 'seas_tw' || k === 'seas_ts' ? 'Seizoensverwachting' : PRIORS[k].label);

/** terugblik: hoe goed eerdere runs uitkwamen; weglaten zonder eigen voorspellingen. */
export function DagDetail({ run, meta, rb, datum, regios, scopeNaam, alpha, terugblik }: { run: RunData; meta: RunMeta; rb: RunData | null; datum: string; regios: string[]; scopeNaam: string; alpha: number; terugblik?: Betrouwbaarheid | null }) {
  const nu = som(run, regios, datum) ?? 0, basis = som(run, regios, datum, true) ?? 0;
  const rbv = rb ? som(rb, regios, datum) : null;
  const kNu = regios.reduce((s, r) => s + (plekken(run, r, datum, alpha) ?? 0), 0);
  const kRb = rb && rbv != null ? regios.reduce((s, r) => s + (plekken(rb, r, datum, alpha) ?? 0), 0) : null;
  const [hover, setHover] = useState<FactorKey | null>(null);
  const [open, setOpen] = useState<FactorKey | null>(null);
  const agg = new Map<FactorKey, number>();
  for (const r of regios) {
    const w = lamBasis(run, r, datum) ?? 0;
    for (const [k, v] of Object.entries(factoren(run, r, datum))) agg.set(k as FactorKey, (agg.get(k as FactorKey) ?? 0) + w * (v ?? 0));
  }
  const h = diffDays(datum, meta.uitgegeven);
  // per factor de gemiddelde bijdrage (log-schaal) en het effect in procenten
  const rijen = [...agg.entries()].map(([k, v]) => ({ k, c: v / basis, v: Math.exp(v / basis) - 1 })).filter((x) => Math.abs(x.v) >= 0.0005).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const mx = Math.max(0.05, ...rijen.map((r) => Math.abs(r.v)));
  const zichtbaar = open ?? hover;
  const dd = toDay(datum);
  return (
    <div className="box">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="kop-s">{DAG_LANG[weekday(dd)]} {fmtD(datum)}</h3>
        <span className="note">over {h} {h === 1 ? 'dag' : 'dagen'}, {scopeNaam}</span>
      </div>
      <div className="my-4 flex flex-wrap gap-x-7 gap-y-3">
        <Kv waarde={nl(nu)} label="verwacht nu" />
        <Kv waarde={nl(basis)} label="basismodel" />
        {rbv != null && <Kv waarde={nl(rbv)} label="roosterbasis" />}
        <Kv waarde={String(kNu)} label={`plekken op ${Math.round(alpha * 100)}%`} accent />
        {kRb != null && <Kv waarde={String(kRb)} label="plekken roosterbasis" />}
      </div>
      <Bandbreedte lam={nu} scopeNaam={scopeNaam} vergelijking={terugblik ? bucketVoor(terugblik.buckets, h) : undefined} alpha={alpha} />
      {rijen.length ? (
        <div className="grid gap-1">
          {rijen.map(({ k, c, v }) => {
            const w = (Math.abs(v) / mx) * 50;
            const u = zichtbaar === k ? factorUitleg(k, { bijdrage: c, h, info: meta.info, eenRegio: regios.length === 1 }) : null;
            return (
              <div key={k} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(k); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}>
                <button type="button" className="grid w-full grid-cols-[minmax(0,180px)_1fr_60px] items-center gap-2.5 rounded py-1 text-left text-sm leading-tight hover:bg-soft"
                  aria-expanded={zichtbaar === k} onClick={() => { if (open === k) { setOpen(null); setHover(null); } else setOpen(k); }}>
                  <span className="min-w-0">{LABEL(k)} <Info size={13} className="inline align-[-2px] text-muted" aria-hidden /></span>
                  <span className="relative block h-3 rounded bg-soft">
                    <span className="absolute -bottom-0.5 -top-0.5 left-1/2 w-px bg-muted" />
                    <i className="absolute bottom-0 top-0 rounded" style={v >= 0 ? { left: '50%', width: `${w}%`, background: 'var(--red)' } : { right: '50%', width: `${w}%`, background: 'var(--teal)' }} />
                  </span>
                  <b className="num text-right">{pctS(v)}</b>
                </button>
                {u && (
                  <div className="mb-2 mt-1 rounded-lg bg-soft px-3 py-2 text-[13.5px] leading-relaxed" role="note">
                    <p className="m-0">{u.signaal}</p>
                    <p className="m-0 mt-1">{u.berekening}</p>
                    <p className="note m-0 mt-1">Waarom deze factor: {PRIORS[k].waarom}</p>
                  </div>
                )}
              </div>
            );
          })}
          <p className="mt-2 text-[14px]">Samen: <span className="num">{somUitleg(basis, nu, rijen.map((r) => r.v))}</span> verwacht.</p>
          <p className="note">Rood duwt de verwachting omhoog, teal omlaag, ten opzichte van het basismodel; de factoren stapelen op elkaar. Tik op een factor (of ga er met de muis op staan) voor de berekening.</p>
        </div>
      ) : (
        <p className="note">Op deze afstand is er nog geen actuele informatie; de verwachting is gelijk aan het basismodel.</p>
      )}
    </div>
  );
}

function Kv({ waarde, label, accent }: { waarde: string; label: string; accent?: boolean }) {
  return (
    <div>
      <b className={cx('display num block text-[30px] leading-none', accent && 'text-teal')}>{waarde}</b>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

/** Hoe de verwachting voor één doeldatum verschoof, van ver vooruit naar dichtbij. */
export function Ontwikkeling({ datum, regios, runs, data, rbId, huidigId, gerealiseerd }: { datum: string; regios: string[]; runs: RunMeta[]; data: Map<string, RunData> | null; rbId: string | null; huidigId: string; gerealiseerd: number | null }) {
  if (!data) return <div className="box"><h3 className="kop-s">Ontwikkeling van deze dag</h3><div className="skeleton mt-3 h-36" /></div>;
  const pts = runs
    .map((m) => {
      const d = data.get(m.id);
      const v = d ? som(d, regios, datum) : null;
      return v == null ? null : { h: diffDays(datum, m.uitgegeven), v, id: m.id };
    })
    .filter((p): p is { h: number; v: number; id: string } => p != null)
    .sort((a, b) => b.h - a.h);
  if (pts.length < 2) {
    return (
      <div className="box">
        <h3 className="kop-s">Ontwikkeling van deze dag</h3>
        <p className="note mt-2">Er is nog maar {pts.length} run voor deze datum. Bij elke dagelijkse run komt er een punt bij, zodat je ziet hoe de verwachting van twee maanden naar vier dagen vooruit verschuift.</p>
      </div>
    );
  }
  const W = 520, H = 180, pl = 40, pb = 24;
  const hmax = Math.max(...pts.map((p) => p.h)), hmin = Math.min(...pts.map((p) => p.h));
  const vs = [...pts.map((p) => p.v), ...(gerealiseerd != null ? [gerealiseerd] : [])];
  const vmin = Math.min(...vs) * 0.97, vmax = Math.max(...vs) * 1.03;
  const x = (h: number) => pl + (W - pl - 12) * (hmax === hmin ? 0.5 : (hmax - h) / (hmax - hmin));
  const y = (v: number) => 10 + (H - 10 - pb) * (1 - (v - vmin) / (vmax - vmin || 1));
  return (
    <div className="box">
      <h3 className="kop-s">Ontwikkeling van deze dag</h3>
      <p className="note mt-1">Verwachting per run, van ver vooruit naar dichtbij. Goud is de roosterbasis.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart mt-2 block h-auto w-full" role="img" aria-label="Verwachting per run voor deze datum">
        {[vmin, (vmin + vmax) / 2, vmax].map((v) => (
          <g key={v}><line className="grid" x1={pl} x2={W} y1={y(v)} y2={y(v)} /><text x={pl - 6} y={y(v) + 4} textAnchor="end">{nl(v, 0)}</text></g>
        ))}
        {gerealiseerd != null && (
          <g><line x1={pl} x2={W} y1={y(gerealiseerd)} y2={y(gerealiseerd)} stroke="var(--red)" strokeDasharray="5 4" strokeWidth={1.5} /><text x={W - 4} y={y(gerealiseerd) - 5} textAnchor="end" style={{ fill: 'var(--red)', fontWeight: 700 }}>werkelijk {gerealiseerd}</text></g>
        )}
        <path d={`M${pts.map((p) => `${x(p.h)},${y(p.v)}`).join('L')}`} fill="none" stroke="var(--accent)" strokeWidth={2} />
        {pts.map((p) => (
          <circle key={p.id} cx={x(p.h)} cy={y(p.v)} r={p.id === rbId || p.id === huidigId ? 5 : 3.5} fill={p.id === rbId ? 'var(--gold)' : 'var(--accent)'} stroke={p.id === huidigId ? 'var(--card)' : 'none'} strokeWidth={2}>
            <title>{`t−${p.h}: ${nl(p.v)}`}</title>
          </circle>
        ))}
        <text x={pl} y={H - 6}>t−{hmax}</text>
        <text x={W - 10} y={H - 6} textAnchor="end">t−{hmin}</text>
      </svg>
    </div>
  );
}

/** Benodigde plekken per regio en dag, met clusterdekking bij uithelpen. */
export function Heatmap({ run, rb, dates, clusters, alpha, alphaCluster }: { run: RunData; rb: RunData | null; dates: string[]; clusters: string[]; alpha: number; alphaCluster: number }) {
  let kmin = 99, kmax = 0;
  for (const r of Object.values(CLUSTERS).flat()) for (const d of dates) {
    const k = plekken(run, r, d, alpha);
    if (k != null) { kmin = Math.min(kmin, k); kmax = Math.max(kmax, k); }
  }
  const wk = (d: string, i: number) => (weekday(toDay(d)) === 1 && i ? 'wk' : '');
  return (
    <div className="scroll max-h-[640px]">
      <table className="hm">
        <thead>
          <tr>
            <th className="rn">Regio</th>
            {dates.map((d, i) => {
              const dd = toDay(d);
              // de maand boven de eerste dag en boven elke 1e van de maand
              const maand = i === 0 || dayOfMonth(dd) === 1 ? MAAND_KORT[month(dd) - 1] : '';
              return <th key={d} className={cx(weekday(dd) % 6 === 0 && 'we', wk(d, i))} title={fmtD(d)}><span className="block text-[10.5px] font-semibold text-accent">{maand || '\u00a0'}</span>{DAG_KORT[weekday(dd)]}<br />{dayOfMonth(dd)}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {clusters.map((c) => (
            <ClusterRijen key={c} c={c} run={run} rb={rb} dates={dates} alpha={alpha} alphaCluster={alphaCluster} kmin={kmin} kmax={kmax} wk={wk} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClusterRijen({ c, run, rb, dates, alpha, alphaCluster, kmin, kmax, wk }: { c: string; run: RunData; rb: RunData | null; dates: string[]; alpha: number; alphaCluster: number; kmin: number; kmax: number; wk: (d: string, i: number) => string }) {
  return (
    <>
      {CLUSTERS[c].map((r) => (
        <tr key={r}>
          <th className="rn"><Link href={`/rooster?regio=${encodeURIComponent(r)}`} title={`Rooster ${r}`}>{r}</Link></th>
          {dates.map((d, i) => {
            const k = plekken(run, r, d, alpha), kb = rb ? plekken(rb, r, d, alpha) : null;
            if (k == null) return <td key={d} className={cx('c', wk(d, i))}>–</td>;
            const a = Math.round(8 + (60 * (k - kmin)) / Math.max(1, kmax - kmin));
            const cls = kb == null ? '' : k > kb ? 'up' : k < kb ? 'down' : '';
            return (
              <td key={d} className={cx('c', cls, wk(d, i))} style={{ background: `color-mix(in srgb, var(--teal) ${a}%, var(--card))` }} title={`${r} ${fmtD(d)}: ${nl(lam(run, r, d)!)} verwacht, ${k} plekken${kb != null ? `, roosterbasis ${kb}` : ''}`}>
                {k}
              </td>
            );
          })}
        </tr>
      ))}
      <tr className="cl">
        <th className="rn">Cluster {CLUSTER_NAAM[c]} dekking</th>
        {dates.map((d, i) => {
          const L = CLUSTERS[c].reduce((s, r) => s + (lam(run, r, d) ?? 0), 0);
          const K = CLUSTERS[c].reduce((s, r) => s + (plekken(run, r, d, alpha) ?? 0), 0);
          const cov = poissonCdf(K, L), nodig = poissonQuantile(alphaCluster, L) - K;
          return (
            <td key={d} className={cx('c', cov < alphaCluster && 'short', wk(d, i))} title={`Cluster ${CLUSTER_NAAM[c]} ${fmtD(d)}: ${K} plekken, dekking ${pct(cov, 1)}${nodig > 0 ? `, ${nodig} flex nodig voor ${Math.round(alphaCluster * 100)}%` : ''}`}>
              {Math.round(cov * 100)}
            </td>
          );
        })}
      </tr>
    </>
  );
}

export function clustersVoorScope(scope: string): string[] {
  if (scope === 'NL') return Object.keys(CLUSTERS);
  if (scope.startsWith('C:')) return [scope.slice(2)];
  return [REGION_CLUSTER[scope.slice(2)]];
}
