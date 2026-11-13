'use client';
import { useState } from 'react';
import { Info } from 'lucide-react';
import { band, bandUitleg } from '@/lib/model/band';
import type { Bucket } from '@/lib/model/betrouwbaarheid';
import { Pill } from '@/components/ui';

const OORDEEL = {
  goed: { soort: 'ok', tekst: 'klopt goed' },
  smal: { soort: 'warn', tekst: 'te smal' },
  ruim: { soort: 'info', tekst: 'eerder te ruim' },
  weinig: { soort: 'neutral', tekst: 'nog weinig dagen' },
  geen: { soort: 'neutral', tekst: 'nog niet te zeggen' },
} as const;

/** Licht 95%, donker 80%, streep de verwachting. Erop wijzen geeft de uitleg; klikken zet hem vast. */
export function Bandbreedte({ lam, scopeNaam, vergelijking, alpha }: { lam: number; scopeNaam: string; vergelijking: Bucket | null | undefined; alpha: number }) {
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const b = band(lam);
  const zichtbaar = open || hover;
  const u = zichtbaar ? bandUitleg(lam, b, scopeNaam, vergelijking, alpha) : null;
  const span = Math.max(1, b.hi95 - b.lo95);
  const x = (v: number) => ((v - b.lo95) / span) * 100;
  return (
    <div className="mb-4" onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(false); }}>
      <button type="button" className="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left hover:bg-soft" aria-expanded={zichtbaar} onClick={() => { if (open) { setOpen(false); setHover(false); } else setOpen(true); }}>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
          <span>Waarschijnlijk <b className="num">{b.lo80} tot {b.hi80}</b> meldingen <Info size={13} className="inline align-[-2px] text-muted" aria-hidden /></span>
          <span className="text-[13px] text-muted">op 8 van de 10 dagen</span>
        </span>
        <span className="relative mt-2 block h-2.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)' }} aria-hidden>
          <span className="absolute inset-y-0 rounded-full" style={{ left: `${x(b.lo80)}%`, width: `${x(b.hi80) - x(b.lo80)}%`, background: 'color-mix(in srgb, var(--accent) 48%, transparent)' }} />
          <span className="absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded bg-ink" style={{ left: `${Math.min(100, Math.max(0, x(lam)))}%` }} />
        </span>
        <span className="mt-1 flex justify-between text-[12.5px] text-muted">
          <span className="num">{b.lo95}</span>
          <span>bijna zeker (19 van de 20 dagen)</span>
          <span className="num">{b.hi95}</span>
        </span>
      </button>
      {u && (
        <div className="mt-1 grid gap-1.5 rounded-lg bg-soft px-3 py-2 text-[13.5px] leading-relaxed" role="note">
          <p className="m-0">{u.wat}</p>
          <p className="m-0">{u.waarom}</p>
          {u.aanname && <p className="m-0">{u.aanname}</p>}
          {u.terug && <p className="m-0">{u.oordeel && <><Pill soort={OORDEEL[u.oordeel].soort}>{OORDEEL[u.oordeel].tekst}</Pill>{' '}</>}{u.terug}</p>}
          <p className="note m-0">{u.plekken}</p>
        </div>
      )}
    </div>
  );
}
