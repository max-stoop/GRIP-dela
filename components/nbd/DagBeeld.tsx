'use client';
import { useMemo } from 'react';
import { fmtLang } from '@/lib/dates';
import { uurTekst } from '@/lib/rooster/tijden';
import type { Medewerker } from '@/lib/rooster/types';
import { kwartierenOpen, type NbdDag } from '@/lib/nbd/behoefte';
import { dienstTekst, netto, pauzeBegin, pauzeTekst, TAAK_KORT, taakTekst, type NbdDienst } from '@/lib/nbd/dienst';
import type { NbdParameters } from '@/lib/nbd/parameters';
import type { NbdDagUitkomst } from '@/lib/nbd/toets';
import { cx, nl, nlUren, pct } from '@/lib/format';

/** Per kwartier hoeveel mensen Erlang C vraagt en hoeveel er aan de telefoon zitten, met de diensten als balken. */
export function DagBeeld({ datum, dag, uitkomst, team, diensten, p, onDienst }: {
  datum: string;
  dag: NbdDag;
  uitkomst: Pick<NbdDagUitkomst, 'gepland' | 'sl'> | undefined;
  team: Medewerker[];
  diensten: Record<string, NbdDienst>;
  p: NbdParameters;
  onDienst?: (medewerkerId: string) => void;
}) {
  const ks = kwartierenOpen(p);
  const gepland = uitkomst?.gepland ?? ks.map(() => 0);
  const nodig = dag.kwartieren.map((k) => k.nodig);
  const max = Math.max(1, ...nodig, ...gepland) + 1;
  const B = 12, H = 150, W = ks.length * B;
  const y = (v: number) => H - (v / max) * H;
  const stap = (reeks: number[]) => reeks.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * B},${y(v)} L${(i + 1) * B},${y(v)}`).join(' ');
  const rijen = useMemo(() => team.filter((m) => diensten[m.id]).sort((a, b) => diensten[a.id].start - diensten[b.id].start || diensten[a.id].eind - diensten[b.id].eind), [team, diensten]);
  const van = Math.min(p.open, ...rijen.map((m) => diensten[m.id].start));
  const tot = Math.max(p.sluit, ...rijen.map((m) => diensten[m.id].eind));
  const x = (u: number) => ((u - van) / (tot - van)) * 100;
  const uren = Array.from({ length: Math.floor(tot) - Math.ceil(van) + 1 }, (_, i) => Math.ceil(van) + i);
  const tekort = nodig.reduce((a, n, i) => a + Math.max(0, n - gepland[i]), 0) / 4;

  return (
    <div className="box">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="kop-s capitalize">{fmtLang(datum)}</h3>
        <span className="note">
          {Math.round(dag.gesprekken)} gesprekken verwacht · {nl(dag.uren, 0)} uur aan de telefoon nodig · {uitkomst ? <>verwacht service level <b className={uitkomst.sl < p.serviceLevel ? 'text-rood' : 'text-teal'}>{pct(uitkomst.sl)}</b></> : null}
          {tekort > 0 ? ` · ${nl(tekort)} uur te weinig` : ''}
        </span>
      </div>
      <figure className="mt-3" aria-label={`Bezetting per kwartier op ${fmtLang(datum)}: nodig volgens Erlang C tegenover gepland`}>
        <svg viewBox={`-28 -6 ${W + 36} ${H + 26}`} className="w-full" role="img">
          {Array.from({ length: max + 1 }, (_, v) => v).filter((v) => v % Math.max(1, Math.ceil(max / 5)) === 0).map((v) => (
            <g key={v}>
              <line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={0.6} />
              <text x={-6} y={y(v) + 3.5} textAnchor="end" fontSize={9} fill="var(--muted)">{v}</text>
            </g>
          ))}
          {ks.map((t, i) => {
            const g = gepland[i], n = nodig[i];
            return <rect key={t} x={i * B + 1} width={B - 2} y={y(g)} height={H - y(g)} fill={g < n ? 'color-mix(in srgb, var(--red) 55%, transparent)' : 'color-mix(in srgb, var(--teal) 55%, transparent)'} rx={1.5}><title>{`${uurTekst(t)}: ${g} gepland, ${n} nodig, ${dag.kwartieren[i].gesprekken.toFixed(1).replace('.', ',')} gesprekken`}</title></rect>;
          })}
          <path d={stap(nodig)} fill="none" stroke="var(--plum)" strokeWidth={2} />
          {ks.map((t, i) => (t % 1 === 0 ? <text key={t} x={i * B} y={H + 14} fontSize={9} fill="var(--muted)" textAnchor="middle">{t}</text> : null))}
        </svg>
        <figcaption className="note mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0.5 w-4" style={{ background: 'var(--plum)' }} /> nodig volgens Erlang C ({pct(p.serviceLevel)} binnen {p.wachttijd} seconden)</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--teal) 55%, transparent)' }} /> aan de telefoon</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--red) 55%, transparent)' }} /> te weinig</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--plum) 70%, transparent)' }} /> taak (T training, K klachten, M maandstart): niet aan de telefoon</span>
        </figcaption>
      </figure>
      {rijen.length > 0 && (
        <div className="mt-4">
          <div className="relative ml-[150px] h-4 text-[11px] text-muted">
            {uren.map((u) => <span key={u} className="absolute -translate-x-1/2" style={{ left: `${x(u)}%` }}>{u}</span>)}
          </div>
          <ul className="grid gap-1">
            {rijen.map((m) => {
              const d = diensten[m.id], b = pauzeBegin(d);
              return (
                <li key={m.id} className="flex items-center gap-2 text-[13px]">
                  <span className="w-[142px] shrink-0 truncate">{m.naam}</span>
                  <button type="button" className={cx('relative h-5 flex-1 rounded-sm', onDienst ? 'cursor-pointer' : 'cursor-default')} onClick={() => onDienst?.(m.id)} title={`${m.naam}: ${dienstTekst(d)}, ${pauzeTekst(d)}, ${nlUren(netto(d))} uur werk${d.taken?.length ? `, ${d.taken.map(taakTekst).join(', ')}` : ''}`}>
                    <span className="absolute inset-y-0 rounded-sm bg-[color:var(--d1)]" style={{ left: `${x(d.start)}%`, width: `${x(d.eind) - x(d.start)}%` }} />
                    {b != null && <span className="absolute inset-y-0" style={{ left: `${x(b)}%`, width: `${x(b + d.pauze / 60) - x(b)}%`, background: 'repeating-linear-gradient(135deg, var(--card) 0 3px, transparent 3px 6px)' }} />}
                    {d.taken?.map((k) => <span key={`${k.soort}-${k.van}`} className="absolute inset-y-0 flex items-center justify-center rounded-sm text-[9.5px] font-bold text-white" style={{ left: `${x(k.van)}%`, width: `${x(k.tot) - x(k.van)}%`, background: 'color-mix(in srgb, var(--plum) 70%, transparent)' }}>{TAAK_KORT[k.soort]}</span>)}
                    <span className="absolute inset-y-0 flex items-center px-1.5 text-[11px] font-semibold" style={{ left: `${x(d.start)}%` }}>{dienstTekst(d)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
