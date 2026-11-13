'use client';
import { Fragment } from 'react';
import { nlInt } from '@/lib/format';
import { ONDERDELEN, type Uitleg as UitlegData } from '@/lib/verdeling/uitleg';
import type { Kostenopbouw } from '@/lib/verdeling/types';

/** Waarom deze persoon en dit moment, met de kosten van de toewijzing ernaast. */
export function Uitleg({ u, kosten }: { u: UitlegData | undefined; kosten: Kostenopbouw }) {
  if (!u) return null;
  return (
    <div className="sticky left-0 grid max-w-[min(900px,calc(100vw-48px))] gap-4 py-2 md:grid-cols-[1fr_300px]">
      <div>
        <div className="font-semibold">{u.kop}</div>
        <ul className="mt-1 list-disc pl-5 text-[14px]">{u.regels.map((r) => <li key={r}>{r}</li>)}</ul>
        {u.vergelijking && <p className="mt-2 text-[14px]">{u.vergelijking}</p>}
        {u.verschil && u.verschil.length > 0 && (
          <ul className="mt-1 text-[13.5px]">
            {u.verschil.map((v) => <li key={v.label}>{v.label}: <b className={v.delta > 0 ? 'text-rood' : 'text-teal'}>{v.delta > 0 ? '+' : '−'}{nlInt(Math.abs(v.delta))} min</b></li>)}
          </ul>
        )}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 self-start text-[13.5px]" aria-label="Kosten van deze toewijzing">
        {ONDERDELEN.map((d) => (
          <Fragment key={d.key}>
            <dt title={d.uitleg} className="text-muted">{d.label}</dt>
            <dd className="text-right tabular-nums">{nlInt(kosten[d.key])} min</dd>
          </Fragment>
        ))}
        <dt className="border-t border-line pt-1 font-semibold">Totaal voor deze toewijzing</dt>
        <dd className="border-t border-line pt-1 text-right font-semibold tabular-nums">{nlInt(kosten.totaal)} min</dd>
      </dl>
    </div>
  );
}
