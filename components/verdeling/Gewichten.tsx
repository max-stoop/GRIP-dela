'use client';
import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Sectie, Veld } from '@/components/ui';
import type { Parameters } from '@/lib/verdeling/types';

export interface GewichtVeld { key: keyof Parameters; label: string; hint: string; pct?: boolean }

/** Gewichten bewerken als tekst (een leeg vak tijdens het typen mag), pas met de knop toepassen. */
export function Gewichten({ titel = 'Gewichten', lead, velden, standaard, gewichten, setGewichten, bezig, knop = 'Opnieuw verdelen' }: {
  titel?: string;
  lead: string;
  velden: GewichtVeld[];
  /** De waarde als er niets is aangepast. */
  standaard: Parameters;
  gewichten: Partial<Parameters>;
  setGewichten: (g: Partial<Parameters>) => void;
  bezig: boolean;
  knop?: string;
}) {
  const toon = useCallback((g: GewichtVeld, w: Partial<Parameters>) => {
    const v = (w[g.key] ?? standaard[g.key]) as number;
    return String(g.pct ? Math.round(v * 100) : v);
  }, [standaard]);
  const vanGewichten = useCallback((w: Partial<Parameters>) => Object.fromEntries(velden.map((g) => [g.key, toon(g, w)])), [velden, toon]);
  const [tekst, setTekst] = useState<Record<string, string>>(() => vanGewichten(gewichten));
  useEffect(() => { setTekst(vanGewichten(gewichten)); }, [gewichten, vanGewichten]);
  const nieuw: Partial<Parameters> = {};
  let geldig = true;
  for (const g of velden) {
    const v = Number(tekst[g.key]?.replace(',', '.'));
    if (tekst[g.key]?.trim() === '' || !Number.isFinite(v) || v < 0) { geldig = false; continue; }
    const w = g.pct ? v / 100 : v;
    if (w !== standaard[g.key]) (nieuw as Record<string, number>)[g.key] = w;
  }
  const gewijzigd = JSON.stringify(nieuw) !== JSON.stringify(Object.fromEntries(Object.entries(gewichten).filter(([k, v]) => v !== standaard[k as keyof Parameters])));
  return (
    <Sectie titel={titel} lead={lead}>
      <div className="box">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {velden.map((g) => (
            <Veld key={g.key} label={g.label} hint={g.hint}>
              <input className="input" inputMode="decimal" value={tekst[g.key] ?? ''} aria-invalid={!Number.isFinite(Number(tekst[g.key]?.replace(',', '.'))) || undefined} onChange={(e) => setTekst({ ...tekst, [g.key]: e.target.value })} />
            </Veld>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="btn" disabled={bezig || !geldig || !gewijzigd} onClick={() => setGewichten(nieuw)}>{knop}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setGewichten({})}><RotateCcw size={16} /> Standaard</button>
          {!geldig && <span className="text-sm text-rood">Vul overal een getal van 0 of meer in.</span>}
        </div>
      </div>
    </Sectie>
  );
}
