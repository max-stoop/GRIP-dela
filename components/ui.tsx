'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cx } from '@/lib/format';

export function PaginaKop({ titel, lead, children, boven }: { titel: ReactNode; lead?: ReactNode; children?: ReactNode; boven?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        {boven && <div className="kicker mb-1.5">{boven}</div>}
        <h1 className="wordmark">{titel}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  );
}

export function Sectie({ titel, lead, children, rechts, className, id }: { titel: ReactNode; lead?: ReactNode; children: ReactNode; rechts?: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('mt-9 scroll-mt-6', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="kop">{titel}</h2>
          {lead && <p className="lead mt-1.5">{lead}</p>}
        </div>
        {rechts && <div className="flex flex-wrap items-center gap-2">{rechts}</div>}
      </div>
      {children}
    </section>
  );
}

export function Box({ children, className, titel, rechts }: { children: ReactNode; className?: string; titel?: ReactNode; rechts?: ReactNode }) {
  return (
    <div className={cx('box', className)}>
      {(titel || rechts) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          {titel && <h3 className="kop-s">{titel}</h3>}
          {rechts}
        </div>
      )}
      {children}
    </div>
  );
}

type PillSoort = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export function Pill({ soort = 'neutral', children, title }: { soort?: PillSoort; children: ReactNode; title?: string }) {
  return <span className={`pill pill-${soort}`} title={title}>{children}</span>;
}

export function Stat({ waarde, label, sub, toon, groot }: { waarde: ReactNode; label: ReactNode; sub?: ReactNode; toon?: 'teal' | 'gold' | 'rood'; groot?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cx('display font-semibold leading-none', groot ? 'text-[50px]' : 'text-[32px]', toon === 'teal' && 'text-teal', toon === 'gold' && 'text-gold', toon === 'rood' && 'text-rood')}>{waarde}</div>
      <div className="mt-2 text-[13.5px] font-semibold">{label}</div>
      {sub && <div className="note mt-0.5">{sub}</div>}
    </div>
  );
}

export function Veld({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cx('label', className)}>
      <span>{label}</span>
      {children}
      {hint && <span className="note font-normal">{hint}</span>}
    </label>
  );
}

/** Een kop boven een groep knoppen. Geen label-element: dat zou een klik op een knop doorsturen naar de eerste knop. */
export function Groep({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cx('label', className)}>
      <span>{label}</span>
      {children}
      {hint && <span className="note font-normal">{hint}</span>}
    </div>
  );
}

export function Meter({ waarde, kleur }: { waarde: number; kleur?: string }) {
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(waarde * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(1, waarde)) * 100}%`, background: kleur }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className)} size={18} aria-hidden />;
}

export function Leeg({ titel, children, actie, icoon }: { titel: ReactNode; children?: ReactNode; actie?: ReactNode; icoon?: ReactNode }) {
  return (
    <div className="box flex flex-col items-start gap-3 py-8">
      {icoon && <div className="text-teal">{icoon}</div>}
      <h3 className="kop-s">{titel}</h3>
      {children && <div className="lead">{children}</div>}
      {actie}
    </div>
  );
}

export function Modal({ open, onClose, titel, children, voet, breed }: { open: boolean; onClose: () => void; titel: ReactNode; children: ReactNode; voet?: ReactNode; breed?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      style={breed ? { width: 'min(820px, calc(100vw - 32px))' } : undefined}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-48px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <h2 className="kop-s">{titel}</h2>
            <button type="button" className="btn btn-ghost btn-icon -mr-1 -mt-1 border-0" onClick={onClose} aria-label="Sluiten"><X size={18} /></button>
          </div>
          <div className="overflow-auto px-5 py-4">{children}</div>
          {voet && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{voet}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Segment<T extends string>({ opties, waarde, onChange, label }: { opties: [T, ReactNode][]; waarde: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-card p-0.5">
      {opties.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={waarde === v}
          onClick={() => onChange(v)}
          className={cx('shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[13.5px] font-semibold transition-colors', waarde === v ? 'bg-[color:var(--navy)] text-white' : 'text-muted hover:text-ink')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function GeenToegang() {
  return (
    <Leeg titel="Geen toegang">
      Deze pagina is niet beschikbaar voor jouw rol. Kies een onderdeel in het menu.
    </Leeg>
  );
}

export function Laden({ regels = 3 }: { regels?: number }) {
  return (
    <div className="grid gap-3" aria-busy>
      <div className="skeleton h-14 w-72" />
      {Array.from({ length: regels }, (_, i) => <div key={i} className="skeleton h-40 w-full" />)}
    </div>
  );
}

/**
 * Een getal dat je vrij kunt typen: de waarde gaat pas door als die tussen min en max ligt, en bij het verlaten van
 * het veld staat er weer de geldige waarde. (Begrenzen bij elke toets maakt van "28" eerst 4 en dan 40.)
 */
export function GetalInvoer({ waarde, onZet, min, max, stap = 1, disabled, label, className }: { waarde: number; onZet: (v: number) => void; min: number; max: number; stap?: number; disabled?: boolean; label?: string; className?: string }) {
  const [tekst, setTekst] = useState(String(waarde));
  useEffect(() => {
    if (Number(tekst.replace(',', '.')) !== waarde) setTekst(String(waarde));
  }, [waarde]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input className={cx('input', className)} type="number" inputMode="decimal" min={min} max={max} step={stap} value={tekst} disabled={disabled} aria-label={label}
      onChange={(e) => { setTekst(e.target.value); const v = Number(e.target.value.replace(',', '.')); if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onZet(v); }}
      onBlur={() => setTekst(String(waarde))} />
  );
}
