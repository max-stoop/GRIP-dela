'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DAG_KORT, fmtD, toDay, weekday, dayOfMonth } from '@/lib/dates';
import { nl } from '@/lib/format';
import { poissonBand } from '@/lib/model/poisson';

interface ChartReeks {
  dates: string[];
  nu: number[];
  basis: (number | null)[];
  roosterbasis: (number | null)[] | null;
  /** Vanaf deze dag (index) voorbij de voorspelling: de vastgestelde regelplekken. */
  normVanaf?: number | null;
}

function useBreedte<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, Math.round(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Klik of pijltjestoetsen kiezen een dag. Voorbij de voorspelling (normVanaf) gelden de vastgestelde regelplekken. */
export function ForecastChart({ reeks, sel, onSel, hoogte = 300, compact = false }: { reeks: ChartReeks; sel?: string | null; onSel?: (d: string) => void; hoogte?: number; compact?: boolean }) {
  const [ref, W] = useBreedte<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { dates, nu, basis, roosterbasis } = reeks;
  const normVanaf = reeks.normVanaf ?? null;
  const isNorm = (i: number) => normVanaf != null && i >= normVanaf;
  const n = dates.length;
  if (!n) return <div ref={ref} />;
  const H = hoogte, padL = 40, padB = 26, padT = 10;
  const lo = nu.map((l) => poissonBand(0.1, l)), hi = nu.map((l) => poissonBand(0.9, l));
  const rb = roosterbasis ?? [];
  const alle = [...(compact ? nu : [...lo, ...hi]), ...[...basis, ...rb].filter((v): v is number => v != null)];
  const vmax = Math.max(...alle) * 1.04, vmin = Math.max(0, Math.floor(Math.min(...alle) * 0.8));
  const bw = (W - padL - 6) / n;
  const x = (i: number) => padL + i * bw;
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - vmin) / (vmax - vmin || 1));
  const ticks = [0, 1, 2, 3, 4].map((k) => vmin + ((vmax - vmin) * k) / 4);
  const pad = (vals: (number | null)[]) => {
    let s = '';
    vals.forEach((v, i) => { if (v != null) s += `${s ? 'L' : 'M'}${x(i) + bw / 2},${y(v)}`; });
    return s;
  };
  const band = `M${lo.map((v, i) => `${x(i) + bw / 2},${y(v)}`).join('L')}L${hi.map((_, i) => `${x(n - 1 - i) + bw / 2},${y(hi[n - 1 - i])}`).join('L')}Z`;
  // de eerste datum alleen als hij niet tegen het label van de eerste maand aan staat
  const eersteMaand = dates.findIndex((d, i) => i > 0 && dayOfMonth(toDay(d)) === 1);
  const beginLabel = eersteMaand < 0 || eersteMaand * bw >= 44;
  const selIdx = sel ? dates.indexOf(sel) : -1;
  const toonIdx = hover ?? (selIdx >= 0 ? selIdx : null);

  const kies = (i: number) => { if (onSel && i >= 0 && i < n) onSel(dates[i]); };
  const idxUitPunt = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.floor((((e.clientX - r.left) / r.width) * W - padL) / bw);
  };

  return (
    <div ref={ref} className="relative">
      <svg
        className="chart block w-full select-none"
        viewBox={`0 0 ${W} ${H}`}
        style={{ height: H }}
        role="img"
        aria-label="Verwachte meldingen per dag"
        tabIndex={onSel ? 0 : undefined}
        onKeyDown={(e) => {
          if (!onSel) return;
          if (e.key === 'ArrowRight') { e.preventDefault(); kies(Math.min(n - 1, (selIdx < 0 ? -1 : selIdx) + 1)); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); kies(Math.max(0, selIdx - 1)); }
        }}
        onPointerMove={(e) => { const i = idxUitPunt(e); setHover(i >= 0 && i < n ? i : null); }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => kies(idxUitPunt(e))}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={padL} x2={W} y1={y(v)} y2={y(v)} />
            <text x={padL - 6} y={y(v) + 4} textAnchor="end">{Math.round(v)}</text>
          </g>
        ))}
        {!compact && n > 7 && <rect x={x(3)} y={padT} width={bw * 4} height={H - padT - padB} fill="color-mix(in srgb, var(--gold) 13%, transparent)" />}
        {!compact && <path d={band} fill="color-mix(in srgb, var(--accent) 11%, transparent)" />}
        {dates.map((d, i) => {
          const dd = toDay(d), we = weekday(dd) % 6 === 0, isSel = d === sel, kleur = isNorm(i) ? 'var(--muted)' : 'var(--teal)';
          const fill = isSel ? 'var(--accent)' : `color-mix(in srgb, ${kleur} ${hover === i ? 80 : we ? 32 : 58}%, var(--card))`;
          return <rect key={d} x={x(i) + 1} y={y(nu[i])} width={Math.max(1, bw - 2)} height={Math.max(0, y(vmin) - y(nu[i]))} fill={fill} rx={Math.min(2, bw / 4)} />;
        })}
        {normVanaf != null && normVanaf < n && <line x1={x(normVanaf)} x2={x(normVanaf)} y1={padT} y2={H - padB} stroke="var(--muted)" strokeDasharray="3 3" />}
        {dates.map((d, i) => (dayOfMonth(toDay(d)) === 1 || (i === 0 && beginLabel) ? <text key={`t${d}`} x={x(i)} y={H - 8}>{fmtD(d)}</text> : null))}
        <path d={pad(basis)} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 3" />
        {rb.some((v) => v != null) && <path d={pad(rb)} fill="none" stroke="var(--gold)" strokeWidth={2} />}
        {!compact && n > 7 && <text x={x(3) + 4} y={padT + 14} style={{ fill: 'var(--gold)', fontWeight: 700 }}>t+4 tot t+7</text>}
      </svg>
      {toonIdx != null && hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-card px-3 py-2 text-[13px] shadow-card"
          style={{ left: Math.min(Math.max(0, x(toonIdx) + bw / 2 - 90), W - 190), width: 180 }}
        >
          <div className="font-bold">{DAG_KORT[weekday(toDay(dates[toonIdx]))]} {fmtD(dates[toonIdx])}</div>
          <div className="flex justify-between"><span className="text-muted">Verwacht</span><b className="num">{nl(nu[toonIdx])}</b></div>
          {isNorm(toonIdx) && <div className="text-muted">volgens de vastgestelde regelplekken</div>}
          {basis[toonIdx] != null && <div className="flex justify-between"><span className="text-muted">Basismodel</span><span className="num">{nl(basis[toonIdx]!)}</span></div>}
          {rb[toonIdx] != null && <div className="flex justify-between"><span className="text-muted">Roosterbasis</span><span className="num">{nl(rb[toonIdx]!)}</span></div>}
          {!compact && <div className="flex justify-between"><span className="text-muted">80%-band</span><span className="num">{lo[toonIdx]}–{hi[toonIdx]}</span></div>}
        </div>
      )}
    </div>
  );
}

export function Legenda({ roosterbasis, compact, norm }: { roosterbasis: boolean; compact?: boolean; norm?: boolean }) {
  const sw = 'inline-block h-2.5 w-3.5 rounded-sm align-[-1px] mr-1.5';
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
      <span><i className={sw} style={{ background: 'color-mix(in srgb, var(--teal) 58%, var(--card))' }} />Verwachting nu</span>
      <span><i className="mr-1.5 inline-block w-3.5 align-[3px]" style={{ borderTop: '2px dashed var(--muted)' }} />Basismodel</span>
      {roosterbasis && <span><i className="mr-1.5 inline-block w-3.5 align-[3px]" style={{ borderTop: '2px solid var(--gold)' }} />Roosterbasis</span>}
      {norm && <Link href="/capaciteit" className="text-muted hover:text-ink hover:underline"><i className={sw} style={{ background: 'color-mix(in srgb, var(--muted) 58%, var(--card))' }} />Verder vooruit: vastgestelde regelplekken</Link>}
      {!compact && <span><i className={sw} style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }} />80%-bandbreedte</span>}
    </div>
  );
}
