'use client';
import Link from 'next/link';
import { AlertTriangle, Check, CircleDashed, Hourglass, X } from 'lucide-react';
import { CLUSTER_NAAM, REGION_CLUSTER } from '@/lib/model/config';
import { maandNaam, type Maand } from '@/lib/rooster/maand';
import { VASTSTELLING, type Vaststelling } from '@/lib/rooster/vaststelling';
import type { RegioRegel } from '@/lib/store/overzicht';
import { cx, nl } from '@/lib/format';

const STIJL: Record<Vaststelling, { pill: string; icoon: typeof Check }> = {
  goed: { pill: 'pill-ok', icoon: Check },
  wacht: { pill: 'pill-warn', icoon: Hourglass },
  afgekeurd: { pill: 'pill-bad', icoon: X },
  geen: { pill: 'pill-neutral', icoon: CircleDashed },
};

function Label({ v, cijfer }: { v: Vaststelling; cijfer: number | null }) {
  const { pill, icoon: Icoon } = STIJL[v];
  return <span className={cx('pill num gap-1 px-2', pill)}><Icoon size={12} strokeWidth={2.6} className={cijfer != null ? 'hidden sm:inline' : undefined} aria-hidden />{cijfer != null ? nl(cijfer) : '–'}</span>;
}

/** Elk vakje opent het rooster van die regio in die maand. */
export function RoostersPerMaand({ rijen, maanden, gekozen, onMaand }: { rijen: RegioRegel[]; maanden: Maand[]; gekozen: Maand; onMaand: (m: Maand) => void }) {
  const metTeam = rijen.filter((r) => r.team > 0);
  const zonder = rijen.length - metTeam.length;
  if (!metTeam.length) return <p className="box note">Nog geen regio met een team.</p>;
  return (
    <>
      <div className="scroll">
        <table className="tb">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] bg-card !pl-3 !pr-2">Regio</th>
              {maanden.map((m, i) => (
                <th key={m} className="!px-1.5">
                  <button type="button" className={cx('capitalize', m === gekozen ? 'text-ink underline decoration-2 underline-offset-4' : 'hover:text-ink')} onClick={() => onMaand(m)} aria-pressed={m === gekozen}>
                    <span className="sm:hidden">{maandNaam(m, false).slice(0, 3)}</span><span className="hidden sm:inline">{maandNaam(m, false)}{i === 0 ? ' (nu)' : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metTeam.map((r) => (
              <tr key={r.regio}>
                <td className="sticky left-0 z-[1] max-w-[112px] bg-card !py-2 !pl-3 !pr-2 align-middle sm:max-w-none">
                  <span className="block truncate font-semibold">{r.regio}</span>
                  <span className="note hidden text-[12px] sm:block">{CLUSTER_NAAM[REGION_CLUSTER[r.regio]]}</span>
                </td>
                {maanden.map((m) => {
                  const x = r.maanden.find((y) => y.maand === m);
                  if (!x) return <td key={m} />;
                  const status = VASTSTELLING[x.vaststelling];
                  const t = x.toets;
                  return (
                    <td key={m} className="!px-0.5 !py-1 align-middle">
                      <Link href={`/rooster?regio=${encodeURIComponent(r.regio)}&maand=${m}`}
                        title={`${r.regio}, ${maandNaam(m)}: ${status.lang}${t ? `; cijfer ${nl(t.cijfer)}` : '; nog geen rooster'}${t && t.hard > 0 ? '; overtreding ATW/CAO' : ''}${x.advies ? `; advies planner ${x.advies}` : ''}${x.publicatie === 'ja' ? '; online' : ''}`}
                        className={cx('flex flex-col items-start gap-1 rounded-md px-1 py-1 no-underline hover:bg-soft sm:px-1.5', m === gekozen && 'bg-soft')}>
                        <span className="flex items-center gap-1.5">
                          {t ? <Label v={x.vaststelling} cijfer={t.cijfer} /> : <span className="text-[12.5px] leading-tight text-muted">geen<span className="hidden sm:inline"> rooster</span></span>}
                          {x.advies && <i className={cx('advies-dot', x.advies)} aria-label={`advies ${x.advies}`} />}
                          {t && t.hard > 0 && <AlertTriangle size={14} className="text-rood" aria-label="overtreding ATW/CAO" />}
                        </span>
                        <span className="hidden text-[12px] text-muted sm:block">{status.kort}{x.publicatie === 'ja' ? ' · online' : ''}</span>
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {(['geen', 'wacht', 'goed', 'afgekeurd'] as const).map((v) => (
          <span key={v} className="inline-flex items-center gap-1.5"><Label v={v} cijfer={null} /> {VASTSTELLING[v].kort}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><i className="advies-dot groen" /><i className="advies-dot oranje" /><i className="advies-dot rood" /> advies van de planner</span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} className="text-rood" /> overtreding ATW/CAO</span>
      </div>
      <p className="note mt-1">Het getal is het roostercijfer van die maand.{zonder > 0 ? ` ${zonder} ${zonder === 1 ? 'regio' : "regio's"} zonder team staan er niet bij.` : ''}</p>
    </>
  );
}
