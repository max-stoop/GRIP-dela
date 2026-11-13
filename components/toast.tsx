'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cx } from '@/lib/format';

type Soort = 'ok' | 'fout' | 'info';
interface Toast { id: number; tekst: ReactNode; soort: Soort }

const Ctx = createContext<(tekst: ReactNode, soort?: Soort) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

let nr = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lijst, setLijst] = useState<Toast[]>([]);
  const weg = useCallback((id: number) => setLijst((l) => l.filter((t) => t.id !== id)), []);
  const toon = useCallback((tekst: ReactNode, soort: Soort = 'ok') => {
    const id = ++nr;
    setLijst((l) => [...l.slice(-3), { id, tekst, soort }]);
    setTimeout(() => weg(id), soort === 'fout' ? 9000 : 5000);
  }, [weg]);
  return (
    <Ctx.Provider value={toon}>
      {children}
      <div className="geen-print pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end" aria-live="polite">
        {lijst.map((t) => (
          <div
            key={t.id}
            role={t.soort === 'fout' ? 'alert' : 'status'}
            className={cx(
              'toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-card px-4 py-3 text-[15px] shadow-card',
              t.soort === 'ok' && 'border-teal',
              t.soort === 'fout' && 'border-rood',
              t.soort === 'info' && 'border-line',
            )}
          >
            <span className={cx('mt-0.5 shrink-0', t.soort === 'ok' && 'text-teal', t.soort === 'fout' && 'text-rood', t.soort === 'info' && 'text-accent')}>
              {t.soort === 'ok' ? <CheckCircle2 size={18} /> : t.soort === 'fout' ? <AlertTriangle size={18} /> : <Info size={18} />}
            </span>
            <div className="min-w-0 flex-1">{t.tekst}</div>
            <button type="button" onClick={() => weg(t.id)} className="text-muted hover:text-ink" aria-label="Sluiten"><X size={16} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Voert een actie uit en toont het resultaat of de fout als melding. */
export function useActie() {
  const toon = useToast();
  return useCallback(async <T,>(fn: () => Promise<T> | T, gelukt?: ReactNode | ((r: T) => ReactNode)): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (gelukt) toon(typeof gelukt === 'function' ? (gelukt as (r: T) => ReactNode)(r) : gelukt, 'ok');
      return r;
    } catch (e) {
      toon(e instanceof Error ? e.message : String(e), 'fout');
      return undefined;
    }
  }, [toon]);
}
